// src/tui/TuiAgenda.jsx
// Private shared agenda at /agenda. Not linked from anywhere; the page is only
// a login screen until the worker accepts a passphrase, and every item comes
// from the worker after that. See worker/src/agenda.js.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ASCII_DIVIDER } from "../utils/ascii";
import { AgendaError, agendaClient, clearSession, loadSession } from "../utils/agendaApi";
import { addDays, daysBetween, monthGrid, monthOf, todayIso, addMonths } from "../utils/agendaDates";
import { itemState } from "../utils/agendaStatus";
import { expandYearly, isAppointment } from "../utils/agendaSpecial";
import { guessKind, guessReason, parseIcs } from "../utils/ics";
import AgendaLogin from "./agenda/AgendaLogin";
import AgendaList from "./agenda/AgendaList";
import AgendaMonth from "./agenda/AgendaMonth";
import AgendaDetail from "./agenda/AgendaDetail";
import AgendaForm from "./agenda/AgendaForm";
import AgendaBusySheet from "./agenda/AgendaBusySheet";
import AgendaImport from "./agenda/AgendaImport";
import { BTN_ACTIVE, BTN_ATTENTION, BTN_PRIMARY, BTN_PLAIN, SAMEN_COLOR } from "./agenda/ui";

const REFRESH_MS = 60_000;
// Focus and visibility often fire together; one check is enough.
const REFRESH_MIN_GAP_MS = 3_000;
const MAX_FETCH_DAYS = 366;
const LIST_AHEAD_DAYS = 120;
const LIST_STRETCH_DAYS = 366;
const SEEN_FLUSH_MS = 800;
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const IMPORT_RANGE_DAYS = 365;

const DROP_BOX = [
    "+------------------------------+",
    "|                              |",
    "|  LAAT LOS OM TE IMPORTEREN   |",
    "|  .ICS · ROOSTER · AGENDA     |",
    "|                              |",
    "+------------------------------+",
].join("\n");

function isCalendarFile(file) {
    return /\.(ics|ical|icalendar|ifb)$/i.test(file.name) || file.type === "text/calendar";
}

// Keeps the page out of search engines and the tab title generic.
function usePrivatePage() {
    useEffect(() => {
        const meta = document.createElement("meta");
        meta.name = "robots";
        meta.content = "noindex, nofollow, noarchive";
        document.head.appendChild(meta);
        const title = document.title;
        document.title = "agenda";
        return () => {
            meta.remove();
            document.title = title;
        };
    }, []);
}

function overlaps(event, from, to) {
    return event.startDate <= to && event.endDate >= from;
}

function gridRange(ym) {
    const weeks = monthGrid(ym);
    return { from: weeks[0].days[0], to: weeks[weeks.length - 1].days[6] };
}

function chunks(from, to) {
    const parts = [];
    let start = from;
    while (start <= to) {
        const end = daysBetween(start, to) > MAX_FETCH_DAYS - 1 ? addDays(start, MAX_FETCH_DAYS - 1) : to;
        parts.push([start, end]);
        start = addDays(end, 1);
    }
    return parts;
}

function makePeople(profile) {
    const list = profile.people;
    const ids = list.map((p) => p.id);
    const find = (id) => list.find((p) => p.id === id);
    return {
        me: profile.me,
        ids,
        nameOf: (id) => (id === "samen" ? "SAMEN" : find(id)?.name ?? String(id).toUpperCase()),
        colorOf: (id) => (id === "samen" ? SAMEN_COLOR : find(id)?.color ?? "#aaaaaa"),
        otherOf: (id) => ids.find((x) => x !== id) ?? id,
    };
}

function Shell({ people, onLogout, status, children, bar, dropProps, dropping }) {
    return (
        <div className="min-h-[100dvh] w-full bg-[#050505] text-[#f0f0f0] font-mono" {...dropProps}>
            {dropping && (
                <div aria-hidden="true" className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center pointer-events-none px-[2ch]">
                    <pre className="text-white font-bold">{DROP_BOX}</pre>
                </div>
            )}
            <header className="sticky top-0 z-30 bg-[#050505]/95 backdrop-blur-md px-[2ch]">
                <div className="max-w-[72ch] mx-auto">
                    <div className="flex items-center justify-between gap-x-[2ch] min-h-[3lh]">
                        <span className="uppercase font-bold min-w-0 truncate">
                            <Link to="/" className="hover:bg-white hover:text-black">sisyfuz</Link>
                            <span className="text-neutral-500"> // </span>
                            agenda
                        </span>
                        {people && (
                            <span className="flex items-center gap-x-[1ch] shrink-0 uppercase">
                                {status}
                                <span className="font-bold" style={{ color: people.colorOf(people.me) }}>
                                    <span className="cell">●</span> {people.nameOf(people.me)}
                                </span>
                                <button type="button" onClick={() => onLogout("")} className={`${BTN_PLAIN} -mr-[1ch]`}>
                                    [UIT]
                                </button>
                            </span>
                        )}
                    </div>
                    <div aria-hidden="true" className="text-neutral-700 overflow-hidden whitespace-nowrap">{ASCII_DIVIDER}</div>
                </div>
            </header>

            <main
                id="main-content"
                tabIndex={-1}
                className={`px-[2ch] pt-[1lh] outline-none ${bar ? "pb-[calc(6lh+env(safe-area-inset-bottom))]" : "pb-[3lh]"}`}
            >
                <div className="max-w-[72ch] mx-auto">{children}</div>
            </main>

            {bar && (
                <nav
                    aria-label="Agenda"
                    className="fixed bottom-0 inset-x-0 z-40 bg-[#050505]/95 backdrop-blur-md px-[2ch] pb-[env(safe-area-inset-bottom)]"
                >
                    <div className="max-w-[72ch] mx-auto">
                        <div aria-hidden="true" className="text-neutral-800 overflow-hidden whitespace-nowrap">{ASCII_DIVIDER}</div>
                        {/* Buttons carry their own 1ch padding, so no extra gap; very narrow phones scroll. */}
                        <div className="flex items-center -mx-[1ch] overflow-x-auto no-scrollbar">{bar}</div>
                    </div>
                </nav>
            )}
        </div>
    );
}

export default function TuiAgenda() {
    usePrivatePage();
    const [session, setSession] = useState(loadSession);
    const [profile, setProfile] = useState(null);
    const [notice, setNotice] = useState("");
    // GitHub Pages cannot send frame-blocking headers, so refuse to run inside a
    // frame: another site could otherwise overlay it and steer taps (clickjacking).
    const [framed] = useState(() => {
        try {
            return window.top !== window.self;
        } catch {
            return true;
        }
    });

    const logout = useCallback((message = "") => {
        clearSession();
        setSession(null);
        setProfile(null);
        setNotice(message);
    }, []);

    if (framed) {
        return (
            <Shell>
                <a href="/agenda" target="_top" rel="noopener" className="uppercase text-white underline">
                    [OPEN IN EEN EIGEN VENSTER]
                </a>
            </Shell>
        );
    }

    if (!session) {
        return (
            <Shell>
                <AgendaLogin
                    notice={notice}
                    onLoggedIn={(data) => {
                        setSession({ token: data.token, expiresAt: data.expiresAt });
                        setProfile({ me: data.me, people: data.people });
                        setNotice("");
                    }}
                />
            </Shell>
        );
    }

    return <AgendaApp key={session.token} token={session.token} initialProfile={profile} onLogout={logout} />;
}

function AgendaApp({ token, initialProfile, onLogout }) {
    const api = useMemo(() => agendaClient(token), [token]);
    const [profile, setProfile] = useState(initialProfile);
    const [today, setToday] = useState(todayIso);
    const [events, setEvents] = useState({});
    const [view, setView] = useState("lijst");
    const [listRange, setListRange] = useState(() => ({ from: todayIso(), to: addDays(todayIso(), LIST_AHEAD_DAYS) }));
    const [ym, setYm] = useState(() => monthOf(todayIso()));
    const [selected, setSelected] = useState(todayIso);
    const [sheet, setSheet] = useState(null);
    const [busy, setBusy] = useState(false);
    const [sheetError, setSheetError] = useState("");
    const [loading, setLoading] = useState(0);
    const [syncError, setSyncError] = useState("");
    const [newIds, setNewIds] = useState(() => new Set());

    const loadedRef = useRef(null);
    const revRef = useRef(null);
    const lastRefreshRef = useRef(0);
    const me = profile?.me;

    // A 401 anywhere means the session is gone (expired, or a passphrase changed).
    const handleAuth = useCallback(
        (err) => {
            if (err instanceof AgendaError && err.status === 401) {
                onLogout("JE BENT UITGELOGD. LOG OPNIEUW IN.");
                return true;
            }
            return false;
        },
        [onLogout]
    );

    useEffect(() => {
        if (profile) return;
        let cancelled = false;
        api.me()
            .then((data) => !cancelled && setProfile({ me: data.me, people: data.people }))
            .catch((err) => !cancelled && !handleAuth(err) && setSyncError(err.message));
        return () => {
            cancelled = true;
        };
    }, [api, profile, handleAuth]);

    const upsert = useCallback((event) => setEvents((prev) => ({ ...prev, [event.id]: event })), []);

    // Replaces everything known in [from, to] with what the worker returned, so
    // items the other person deleted disappear too.
    const applyRange = useCallback(
        (from, to, list) => {
            setEvents((prev) => {
                const next = {};
                // Yearly items come back with every range, so they are replaced too.
                for (const [id, e] of Object.entries(prev)) if (!overlaps(e, from, to) && e.repeat !== "jaarlijks") next[id] = e;
                for (const e of list) next[e.id] = e;
                return next;
            });
            if (!me) return;
            const unseen = list.filter((e) => isAppointment(e) && e.updatedBy !== me && !e.status?.[me]?.seenAt).map((e) => e.id);
            if (unseen.length) setNewIds((prev) => new Set([...prev, ...unseen]));
        },
        [me]
    );

    // Returns the revision the data belongs to, or null when loading failed.
    const fetchRange = useCallback(
        async (from, to) => {
            setLoading((n) => n + 1);
            try {
                const parts = await Promise.all(chunks(from, to).map(([a, b]) => api.events(a, b)));
                applyRange(from, to, parts.flatMap((p) => p.events));
                setSyncError("");
                return Math.min(...parts.map((p) => p.rev ?? 0));
            } catch (err) {
                if (!handleAuth(err)) setSyncError(err.message);
                return null;
            } finally {
                setLoading((n) => n - 1);
            }
        },
        [api, applyRange, handleAuth]
    );

    // Loads whatever part of [from, to] is not loaded yet.
    const ensureRange = useCallback(
        async (from, to) => {
            const cur = loadedRef.current;
            const missing = [];
            if (!cur) missing.push([from, to]);
            else {
                if (from < cur.from) missing.push([from, addDays(cur.from, -1)]);
                if (to > cur.to) missing.push([addDays(cur.to, 1), to]);
            }
            if (!missing.length) return;
            loadedRef.current = cur ? { from: from < cur.from ? from : cur.from, to: to > cur.to ? to : cur.to } : { from, to };
            const results = await Promise.all(missing.map(([a, b]) => fetchRange(a, b)));
            if (results.includes(null)) loadedRef.current = cur;
            // Only a load of everything says which revision all loaded items are at.
            else if (!cur) revRef.current = Math.min(...results);
        },
        [fetchRange]
    );

    // Asks the worker for one number first and reloads only when something changed,
    // so polling costs a single row instead of every visible item.
    const refresh = useCallback(async () => {
        setToday(todayIso());
        const cur = loadedRef.current;
        const t = Date.now();
        if (!cur || t - lastRefreshRef.current < REFRESH_MIN_GAP_MS) return;
        lastRefreshRef.current = t;
        try {
            const { rev } = await api.rev();
            if (rev === revRef.current) {
                setSyncError("");
                return;
            }
            if ((await fetchRange(cur.from, cur.to)) !== null) revRef.current = rev;
        } catch (err) {
            if (!handleAuth(err)) setSyncError(err.message);
        }
    }, [api, fetchRange, handleAuth]);

    // First load: the list ahead plus this month's grid.
    useEffect(() => {
        if (!me) return;
        const t = todayIso();
        const grid = gridRange(monthOf(t));
        const listTo = addDays(t, LIST_AHEAD_DAYS);
        ensureRange(grid.from < t ? grid.from : t, grid.to > listTo ? grid.to : listTo);
    }, [me, ensureRange]);

    // Keep both phones in step: refresh every minute while visible and on return.
    useEffect(() => {
        if (!me) return undefined;
        const onVisible = () => {
            if (document.visibilityState === "visible") refresh();
        };
        const timer = setInterval(onVisible, REFRESH_MS);
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", onVisible);
        };
    }, [me, refresh]);

    // ---- Seen and read ----
    // Seen: the item has been on screen. Read: it was opened, hovered on or
    // pressed and held (AgendaItem). Both are batched into one call per level.
    const seenQueues = useRef({ seen: new Set(), read: new Set() });
    const seenTimer = useRef(null);
    const observerRef = useRef(null);
    const flushRef = useRef(() => {});

    const flushSeen = useCallback(async () => {
        seenTimer.current = null;
        const queues = seenQueues.current;
        const read = [...queues.read];
        const seen = [...queues.seen].filter((id) => !queues.read.has(id));
        queues.read.clear();
        queues.seen.clear();
        if (!me) return;
        const batches = [
            ["read", read],
            ["seen", seen],
        ].filter(([, ids]) => ids.length);
        await Promise.all(
            batches.map(async ([level, ids]) => {
                try {
                    const { seenAt, readAt } = await api.seen(ids, level);
                    setEvents((prev) => {
                        const next = { ...prev };
                        for (const id of ids) {
                            const e = next[id];
                            if (!e) continue;
                            const mine = e.status?.[me] ?? {};
                            next[id] = {
                                ...e,
                                status: {
                                    ...e.status,
                                    [me]: { ...mine, seenAt: mine.seenAt || seenAt, readAt: mine.readAt || readAt || null },
                                },
                            };
                        }
                        return next;
                    });
                } catch (err) {
                    handleAuth(err);
                }
            })
        );
    }, [api, me, handleAuth]);

    useEffect(() => {
        flushRef.current = flushSeen;
    }, [flushSeen]);

    const queueSeen = useCallback((id, { level = "seen", now = false } = {}) => {
        seenQueues.current[level].add(id);
        if (now) {
            clearTimeout(seenTimer.current);
            flushRef.current();
        } else if (!seenTimer.current) {
            seenTimer.current = setTimeout(() => flushRef.current(), SEEN_FLUSH_MS);
        }
    }, []);

    const markRead = useCallback((id) => queueSeen(id, { level: "read" }), [queueSeen]);

    const trackSeen = useCallback(
        (el) => {
            if (!el || !window.IntersectionObserver) return;
            if (!observerRef.current) {
                observerRef.current = new window.IntersectionObserver(
                    (entries) => {
                        if (document.visibilityState !== "visible") return;
                        for (const entry of entries) {
                            if (!entry.isIntersecting) continue;
                            observerRef.current?.unobserve(entry.target);
                            queueSeen(entry.target.dataset.seenId);
                        }
                    },
                    { threshold: 0.6 }
                );
            }
            observerRef.current.observe(el);
        },
        [queueSeen]
    );

    useEffect(
        () => () => {
            observerRef.current?.disconnect();
            clearTimeout(seenTimer.current);
        },
        []
    );

    // ---- Actions ----
    const closeSheet = useCallback(() => {
        setSheet(null);
        setSheetError("");
    }, []);

    const openDetail = useCallback(
        (id) => {
            setSheetError("");
            setSheet({ type: "detail", id });
            const e = events[id];
            if (e && me && e.updatedBy !== me && !e.status?.[me]?.readAt) queueSeen(id, { level: "read", now: true });
        },
        [events, me, queueSeen]
    );

    const openForm = useCallback((date, id = null, kind = "afspraak") => {
        setSheetError("");
        setSheet({ type: "form", id, date, kind });
    }, []);

    // A merged busy line opens its blocks; a single block opens directly.
    const openBusy = useCallback(
        (group, day) => {
            if (group.items.length === 1) openDetail(group.items[0].id);
            else setSheet({ type: "busy", day, group: { ...group, ids: group.items.map((e) => e.id) } });
        },
        [openDetail]
    );

    // ---- Import: .ics files from the [IMPORT] button or dropped on the page ----
    const fileInputRef = useRef(null);
    const dragDepth = useRef(0);
    const [dropping, setDropping] = useState(false);
    const [notice, setNotice] = useState("");

    const readFiles = async (fileList) => {
        const files = [...(fileList || [])];
        if (!files.length) return;
        setNotice("");
        const bad = files.find((f) => !isCalendarFile(f));
        if (bad) {
            setNotice(`${bad.name.toUpperCase()} IS GEEN AGENDABESTAND (.ICS).`);
            return;
        }
        if (files.some((f) => f.size > IMPORT_MAX_BYTES)) {
            setNotice("DAT BESTAND IS TE GROOT (MAX. 5 MB).");
            return;
        }
        try {
            const t = todayIso();
            const range = { from: addDays(t, -IMPORT_RANGE_DAYS), to: addDays(t, IMPORT_RANGE_DAYS) };
            const results = await Promise.all(files.map(async (f) => ({ file: f, ...parseIcs(await f.text(), range) })));
            const items = results.flatMap((r) => r.items);
            if (!items.length) {
                setNotice("GEEN ITEMS GEVONDEN IN DAT BESTAND.");
                return;
            }
            const names = results.map((r) => r.calendarName || r.file.name.replace(/\.[^.]+$/, ""));
            setSheet({
                type: "import",
                parsed: {
                    items,
                    label: names.join(", "),
                    reason: guessReason(...names, ...results.map((r) => r.file.name)),
                    ...guessKind(...names, ...results.map((r) => r.file.name)),
                    cancelled: results.reduce((n, r) => n + r.cancelled, 0),
                    truncated: results.some((r) => r.truncated),
                },
            });
        } catch {
            setNotice("DAT BESTAND KON NIET WORDEN GELEZEN.");
        }
    };

    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    const dropProps = {
        onDragEnter: (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current += 1;
            setDropping(true);
        },
        onDragOver: (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (e) => {
            if (!hasFiles(e)) return;
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDropping(false);
        },
        onDrop: (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current = 0;
            setDropping(false);
            readFiles(e.dataTransfer.files);
        },
    };

    const fail = (err) => {
        if (handleAuth(err)) return;
        if (err.status === 409 && err.data?.event) {
            upsert(err.data.event);
            setSheet({ type: "detail", id: err.data.event.id });
            setSheetError("IEMAND ANDERS HEEFT DIT NET AANGEPAST. BEKIJK HET EN PROBEER OPNIEUW.");
            return;
        }
        if (err.status === 404 && sheet?.id) {
            setEvents((prev) => {
                const next = { ...prev };
                delete next[sheet.id];
                return next;
            });
            setSheet(null);
            setSyncError("DAT ITEM BESTAAT NIET MEER.");
            return;
        }
        setSheetError(err.message.toUpperCase());
    };

    const save = async (payload) => {
        setBusy(true);
        setSheetError("");
        try {
            const { event } = sheet.id ? await api.update(sheet.id, payload) : await api.create(payload);
            upsert(event);
            // Stretch the list to show a new item just outside it, but not for yearly
            // days (they show up every year anyway) or items years away (a birthday
            // from 1958 would otherwise load decades of empty ranges).
            const outside = event.startDate < listRange.from || event.startDate > listRange.to;
            const near = Math.min(
                Math.abs(daysBetween(event.startDate, listRange.from)),
                Math.abs(daysBetween(event.startDate, listRange.to))
            ) <= LIST_STRETCH_DAYS;
            if (outside && near && event.repeat !== "jaarlijks") {
                const from = event.startDate < listRange.from ? event.startDate : listRange.from;
                const to = event.startDate > listRange.to ? event.startDate : listRange.to;
                setListRange({ from, to });
                ensureRange(from, to);
            }
            setSheet({ type: "detail", id: event.id });
        } catch (err) {
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    const respond = async (id, response) => {
        setBusy(true);
        try {
            const { event } = await api.respond(id, response);
            upsert(event);
            setNewIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            setSyncError("");
        } catch (err) {
            if (sheet) fail(err);
            else if (!handleAuth(err)) setSyncError(err.message.toUpperCase());
        } finally {
            setBusy(false);
        }
    };

    const remove = async (id) => {
        setBusy(true);
        try {
            await api.remove(id);
            setEvents((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            setSheet(null);
        } catch (err) {
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    const changeMonth = (n) => {
        const next = addMonths(ym, n);
        setYm(next);
        const t = todayIso();
        const tm = monthOf(t);
        setSelected(tm.year === next.year && tm.month === next.month ? t : `${next.year}-${String(next.month + 1).padStart(2, "0")}-01`);
        const grid = gridRange(next);
        ensureRange(grid.from, grid.to);
    };

    const goToday = () => {
        const t = todayIso();
        setYm(monthOf(t));
        setSelected(t);
    };

    // Yearly special days are placed in every year the list and month can show.
    const grid = gridRange(ym);
    const fromYear = Number((listRange.from < grid.from ? listRange.from : grid.from).slice(0, 4));
    const toYear = Number((listRange.to > grid.to ? listRange.to : grid.to).slice(0, 4));
    const list = useMemo(() => expandYearly(Object.values(events), fromYear, toYear), [events, fromYear, toYear]);
    const people = useMemo(() => (profile ? makePeople(profile) : null), [profile]);

    // ---- Render ----
    if (!profile) {
        return (
            <Shell>
                <p className="text-neutral-500 uppercase animate-pulse">[ LADEN... ]</p>
                {syncError && <p className="text-[#ff4d4d] uppercase">{syncError}</p>}
            </Shell>
        );
    }

    const waiting = list.filter((e) => e.endDate >= today && itemState(e, me, people.ids).needsMyAnswer).length;
    const itemProps = { people, newIds, trackSeen, onRead: markRead, onOpen: openDetail, onOpenBusy: openBusy, onRespond: respond, busy };
    const sheetEvent = sheet?.id ? events[sheet.id] : null;

    const status = syncError ? (
        <button type="button" onClick={refresh} className={BTN_ATTENTION} title={syncError}>
            [OFFLINE ↻]
        </button>
    ) : loading > 0 ? (
        <span className="text-neutral-600" aria-live="polite">SYNC…</span>
    ) : null;

    const bar = (
        <>
            <button type="button" onClick={() => setView("lijst")} aria-pressed={view === "lijst"} className={view === "lijst" ? BTN_ACTIVE : BTN_PLAIN}>
                [LIJST]
            </button>
            <button type="button" onClick={() => setView("maand")} aria-pressed={view === "maand"} className={view === "maand" ? BTN_ACTIVE : BTN_PLAIN}>
                [MAAND]
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} className={BTN_PLAIN} title="Importeer een agendabestand (.ics)">
                [IMPORT]
            </button>
            <button
                type="button"
                onClick={() => openForm(view === "maand" ? selected : today, null, "bijzonder")}
                className={BTN_ATTENTION}
                aria-label="Bijzondere dag toevoegen: verjaardag, jubileum of anders"
            >
                [★ DAG]
            </button>
            <button type="button" onClick={() => openForm(view === "maand" ? selected : today)} className={`${BTN_PRIMARY} ml-auto`}>
                [+ NIEUW]
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept=".ics,.ical,.icalendar,.ifb,text/calendar"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                    readFiles(e.target.files);
                    e.target.value = "";
                }}
            />
        </>
    );

    return (
        <Shell people={people} onLogout={onLogout} status={status} bar={bar} dropProps={dropProps} dropping={dropping}>
            {notice && (
                <p className="text-[#f7e463] uppercase mb-[1lh]" role="alert">
                    {notice}{" "}
                    <button type="button" onClick={() => setNotice("")} className="text-neutral-400 hover:bg-white hover:text-black">[OK]</button>
                </p>
            )}
            {waiting > 0 && (
                <p className="text-[#f7e463] uppercase mb-[1lh]" role="status">
                    <span className="cell">?</span> {waiting} {waiting === 1 ? "ITEM WACHT" : "ITEMS WACHTEN"} OP JOUW ANTWOORD
                </p>
            )}
            {syncError && <p className="text-[#f7e463] uppercase mb-[1lh]">{syncError}</p>}

            {view === "lijst" ? (
                <AgendaList
                    events={list}
                    from={listRange.from}
                    to={listRange.to}
                    today={today}
                    loading={loading > 0}
                    itemProps={itemProps}
                    onEarlier={() => {
                        const from = addDays(listRange.from, -30);
                        setListRange((r) => ({ ...r, from }));
                        ensureRange(from, listRange.to);
                    }}
                    onLater={() => {
                        const to = addDays(listRange.to, 90);
                        setListRange((r) => ({ ...r, to }));
                        ensureRange(listRange.from, to);
                    }}
                />
            ) : (
                <AgendaMonth
                    events={list}
                    ym={ym}
                    selected={selected}
                    today={today}
                    itemProps={itemProps}
                    onSelect={setSelected}
                    onMonth={changeMonth}
                    onToday={goToday}
                    onNew={(date) => openForm(date)}
                />
            )}

            {sheet?.type === "detail" && sheetEvent && (
                <AgendaDetail
                    event={sheetEvent}
                    people={people}
                    busy={busy}
                    error={sheetError}
                    onClose={closeSheet}
                    onEdit={(e) => openForm(e.startDate, e.id)}
                    onRespond={respond}
                    onDelete={remove}
                />
            )}
            {sheet?.type === "busy" && (
                <AgendaBusySheet
                    group={{ ...sheet.group, items: sheet.group.ids.map((id) => events[id]).filter(Boolean) }}
                    day={sheet.day}
                    people={people}
                    onClose={closeSheet}
                    onOpen={openDetail}
                />
            )}
            {sheet?.type === "import" && (
                <AgendaImport
                    parsed={sheet.parsed}
                    today={today}
                    people={people}
                    onImport={async (batch) => {
                        try {
                            return await api.importEvents(batch);
                        } catch (err) {
                            handleAuth(err);
                            throw err;
                        }
                    }}
                    onClose={() => {
                        closeSheet();
                        refresh();
                    }}
                />
            )}
            {sheet?.type === "form" && (
                <AgendaForm
                    key={sheet.id || "new"}
                    event={sheet.id ? events[sheet.id] : null}
                    date={sheet.date}
                    kind={sheet.kind}
                    people={people}
                    busy={busy}
                    error={sheetError}
                    onClose={closeSheet}
                    onSave={save}
                />
            )}
        </Shell>
    );
}

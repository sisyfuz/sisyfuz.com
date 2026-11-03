// src/tui/TuiAgenda.jsx
// Private shared agenda at /agenda. Not linked from anywhere; the page is only
// a login screen until the worker accepts a passphrase, and every item comes
// from the worker after that. See worker/src/agenda.js.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import TermScrollSnap from "../components/TermScrollSnap";
import { AgendaError, agendaClient, clearSession, loadSession } from "../utils/agendaApi";
import { addDays, daysBetween, monthGrid, monthOf, todayIso, addMonths } from "../utils/agendaDates";
import { itemState } from "../utils/agendaStatus";
import { expandYearly, isAppointment } from "../utils/agendaSpecial";
import { editBody, expandRepeats, firstOccurrence, occurrenceOf, seriesEnd } from "../utils/agendaRepeat";
import { guessKind, guessReason, parseIcs } from "../utils/ics";
import AgendaLogin from "./agenda/AgendaLogin";
import AgendaList from "./agenda/AgendaList";
import AgendaMonth from "./agenda/AgendaMonth";
import AgendaDetail from "./agenda/AgendaDetail";
import AgendaForm from "./agenda/AgendaForm";
import AgendaBusySheet from "./agenda/AgendaBusySheet";
import AgendaImport from "./agenda/AgendaImport";
import AgendaLibrary from "./agenda/AgendaLibrary";
import AgendaStickerLook from "./agenda/AgendaStickerLook";
import AgendaStickerTray from "./agenda/AgendaStickerTray";
import AgendaStyleSheet from "./agenda/AgendaStyleSheet";
import PixelEditor from "./agenda/PixelEditor";
import PixelImport from "./agenda/PixelImport";
import useStickers, { clearStickerCache } from "./agenda/useStickers";
import useStickerDrag from "./agenda/useStickerDrag";
import StickerImage from "./agenda/StickerImage";
import { base64PngToPixels, SMALL_SIZE, STICKER_SIZE, stickerPayload } from "../utils/agendaPixelFormat";
import { styleChanges } from "../utils/agendaStyle";
import { stepRot, stepScale } from "../utils/agendaTransform";
import { BTN_ACTIVE, BTN_ATTENTION, BTN_PRIMARY, BTN_PLAIN, BTN_RED, SAMEN_COLOR, TRAY_ROWS } from "./agenda/ui";

const REFRESH_MS = 60_000;
// Dividers are clipped to their container, so make them long enough for desktop.
const RULE = "-".repeat(240);
// Focus and visibility often fire together; one check is enough.
const REFRESH_MIN_GAP_MS = 3_000;
const MAX_FETCH_DAYS = 366;
const LIST_AHEAD_DAYS = 120;
const LIST_STRETCH_DAYS = 366;
const SEEN_FLUSH_MS = 800;
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const IMPORT_RANGE_DAYS = 365;
// The worker takes at most this many new pictures per request.
const STICKER_BATCH = 10;
// A stuck sticker is picked up by holding it this long (touch) or by three taps,
// each within STICKER_TAP_MS of the last; a mouse just drags it.
const STICKER_HOLD_MS = 300;
const STICKER_TAP_MS = 350;
// Size and rotation taps are saved together once they stop for this long.
const STICKER_LOOK_SAVE_MS = 400;

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

// Keeps the page out of search engines and the tab title generic. Fields use the
// grid's 12px font, so on this page the viewport also stops iOS from zooming in
// on them (pinch zoom keeps working on iOS).
function usePrivatePage() {
    useEffect(() => {
        const meta = document.createElement("meta");
        meta.name = "robots";
        meta.content = "noindex, nofollow, noarchive";
        document.head.appendChild(meta);
        const title = document.title;
        document.title = "agenda";
        const viewport = document.querySelector('meta[name="viewport"]');
        const viewportBefore = viewport?.getAttribute("content");
        viewport?.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1.0");
        return () => {
            meta.remove();
            document.title = title;
            if (viewport && viewportBefore) viewport.setAttribute("content", viewportBefore);
        };
    }, []);
}

// The desktop layout (month and list side by side) starts at Tailwind's lg.
const DESKTOP_QUERY = "(min-width: 1024px)";

function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = () => setMatches(mq.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [query]);
    return matches;
}

/** True when a key press is meant for a field, not for a shortcut. */
function isTyping(target) {
    return target instanceof window.HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

// A series counts from its start until its last occurrence ends (null = never).
function overlaps(event, from, to) {
    const end = seriesEnd(event);
    return event.startDate <= to && (end === null || end >= from);
}

// The occurrence of `event` to show for `date`: that date when it is one, else
// the series' first. Null for an item that does not repeat.
function shownDate(event, date) {
    if (!event.rule) return null;
    return date && expandRepeats([event], date, date).some((o) => o.occurrenceDate === date) ? date : firstOccurrence(event);
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

// `barRows` is how tall the bottom bar is (the sticker tray needs more than 4).
function Shell({ people, onLogout, status, children, bar, barRows = 4, bin = false, actions, dropProps, dropping }) {
    return (
        <div className="agenda-root relative min-h-[100dvh] w-full bg-[#050505] text-[#f0f0f0] font-mono" {...dropProps}>
            <TermScrollSnap />
            {dropping && (
                <div aria-hidden="true" className="fixed inset-0 z-[60] bg-black/90 pointer-events-none px-[2ch] pt-[4lh]">
                    <pre className="text-white font-bold">{DROP_BOX}</pre>
                </div>
            )}
            <header className="sticky top-0 z-30 bg-[#050505]/95 backdrop-blur-md px-[2ch] lg:px-[4ch]">
                <div className="term-snap max-w-[72ch] lg:max-w-none">
                    <div className="flex items-center justify-between gap-x-[2ch] min-h-[3lh]">
                        <span className="uppercase font-bold min-w-0 truncate">
                            <Link to="/" className="hover:bg-white hover:text-black focus-visible:outline-none focus-visible:bg-white focus-visible:text-black">sisyfuz</Link>
                            <span className="text-neutral-500"> // </span>
                            agenda
                        </span>
                        {people && (
                            <span className="flex items-center gap-x-[1ch] shrink-0 uppercase">
                                {actions && <span className="flex items-center mr-[2ch]">{actions}</span>}
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
                    <div aria-hidden="true" className="text-neutral-700 overflow-hidden whitespace-nowrap">{RULE}</div>
                </div>
            </header>

            <main
                id="main-content"
                tabIndex={-1}
                className="px-[2ch] lg:px-[4ch] pt-[1lh] outline-none"
                style={{ paddingBottom: bar ? `calc(${barRows + 2}lh + env(safe-area-inset-bottom))` : "3lh" }}
            >
                <div className="term-snap max-w-[72ch] lg:max-w-none">{children}</div>
            </main>

            {bar && (
                <nav
                    aria-label="Agenda"
                    className="term-dock left-0 right-0 z-40 bg-[#050505]/95 backdrop-blur-md px-[2ch]"
                    style={barRows === 4 ? undefined : { top: `calc(var(--term-view-bottom) - ${barRows}lh)` }}
                    data-sticker-bin={bin || undefined}
                >
                    <div className="term-snap max-w-[72ch]">
                        <div aria-hidden="true" className="text-neutral-800 overflow-hidden whitespace-nowrap">{RULE}</div>
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
        clearStickerCache();
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
    // Bumped whenever the worker's rev moves on, so the sticker library refreshes too.
    const [revSeen, setRevSeen] = useState(0);
    const library = useStickers(api, revSeen);
    // On top of any sheet: the library, and the editor or import above that.
    const [picker, setPicker] = useState(null);
    const [studio, setStudio] = useState(null);
    const [studioBusy, setStudioBusy] = useState(false);
    const [studioError, setStudioError] = useState("");
    // The sticker tray (drag a sticker onto an item) is open.
    const [tray, setTray] = useState(false);
    // Stickers stuck on days (month grid or list), by id.
    const [daySticks, setDaySticks] = useState({});
    // A stuck sticker picked up with three taps, waiting to be dragged:
    // { kind: "item", eventId, id, stickerId } or { kind: "day", id, stickerId }.
    const [lifted, setLifted] = useState(null);
    // Choosing items to give a colour or logo: a Set of ids, or null.
    const [selection, setSelection] = useState(null);

    const isDesktop = useMediaQuery(DESKTOP_QUERY);
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
    // Sticker changes shown but not saved yet, by sticker id: { kind, eventId, obj }
    // (obj null = taken off). A sync that arrives meanwhile must not undo them.
    const unsaved = useRef(new Map());
    const keepUnsaved = (kind, next) => {
        for (const [id, u] of unsaved.current) {
            if (u.kind !== kind) continue;
            if (kind === "day") {
                if (u.obj) next[id] = u.obj;
                else delete next[id];
            } else if (next[u.eventId]) {
                const e = next[u.eventId];
                const rest = (e.placements ?? []).filter((p) => p.id !== id);
                next[u.eventId] = { ...e, placements: u.obj ? [...rest, u.obj].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)) : rest };
            }
        }
        return next;
    };

    const applyRange = useCallback(
        (from, to, list) => {
            setEvents((prev) => {
                const next = {};
                // Yearly items come back with every range, so they are replaced too.
                for (const [id, e] of Object.entries(prev)) if (!overlaps(e, from, to) && e.repeat !== "jaarlijks") next[id] = e;
                for (const e of list) next[e.id] = e;
                return keepUnsaved("item", next);
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
                const parts = await Promise.all(chunks(from, to).map(([a, b]) => Promise.all([api.events(a, b), api.daySticks(a, b)])));
                applyRange(from, to, parts.flatMap(([p]) => p.events));
                setDaySticks((prev) => {
                    const next = {};
                    for (const [id, d] of Object.entries(prev)) if (d.day < from || d.day > to) next[id] = d;
                    for (const [, p] of parts) for (const d of p.daySticks) next[d.id] = d;
                    return keepUnsaved("day", next);
                });
                setSyncError("");
                return Math.min(...parts.flatMap(([a, b]) => [a.rev ?? 0, b.rev ?? 0]));
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
            setRevSeen(rev);
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

    // `date` is the occurrence that was tapped, for an item that repeats.
    const openDetail = useCallback(
        (id, date = null) => {
            setSheetError("");
            setSheet({ type: "detail", id, date });
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
            if (group.items.length === 1) openDetail(group.items[0].id, group.items[0].occurrenceDate ?? null);
            else setSheet({ type: "busy", day, group: { ...group, ids: group.items.map((e) => [e.id, e.occurrenceDate ?? null]) } });
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
        // Pictures dropped on the page go to the sticker import instead.
        if (files.every((f) => /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.type) || /\.svg$/i.test(f.name))) {
            openStudio("import", null, { files });
            return;
        }
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
            setSheet({ type: "detail", id: err.data.event.id, date: sheet?.date ?? null });
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

    // `scope` says which occurrences of a series an edit is for ("deze",
    // "volgende" or "alle"); the form asks when a series' content changed.
    const save = async ({ contentChanged, scope = null, ...payload }) => {
        setBusy(true);
        setSheetError("");
        try {
            let event = sheet.id ? events[sheet.id] : null;
            if (!event) ({ event } = await api.create(payload));
            else {
                // Only colour or logo changed: that is cosmetic, no new akkoord needed.
                if (contentChanged && event.rule && scope) {
                    const data = await api.update(sheet.id, editBody(event, shownDate(event, sheet.date), payload, scope));
                    if (data.series) upsert(data.series);
                    event = data.event;
                } else if (contentChanged) ({ event } = await api.update(sheet.id, payload));
                const changes = styleChanges(event, payload);
                if (Object.keys(changes).length) [event] = (await api.style({ ids: [event.id], ...changes })).events;
            }
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
            setSheet({ type: "detail", id: event.id, date: shownDate(event, payload.startDate) });
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

    // For one occurrence of a series, `scope` "deze" or "volgende" with its `date`;
    // the worker answers with what is left of the series and what went with it.
    const remove = async (id, scope = null, date = null) => {
        setBusy(true);
        try {
            const data = await api.remove(id, scope, date);
            setEvents((prev) => {
                const next = { ...prev };
                for (const gone of data.deleted ?? (data.event ? [] : [id])) delete next[gone];
                if (data.event) next[data.event.id] = data.event;
                return next;
            });
            setSheet(null);
        } catch (err) {
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    // ---- Stickers, logos and colours ----
    const openStudio = (type, onSaved = null, extra = {}) => {
        setStudioError("");
        setStudio({ type, onSaved, ...extra });
    };

    const editSticker = async (sticker) => {
        try {
            const [pixels, smallPixels] = await Promise.all([
                base64PngToPixels(sticker.png, STICKER_SIZE),
                base64PngToPixels(sticker.pngSmall, SMALL_SIZE),
            ]);
            openStudio("editor", null, { sticker, initial: { name: sticker.name, pixels, smallPixels } });
        } catch {
            setSheetError("DAT PLAATJE KON NIET WORDEN GEOPEND.");
        }
    };

    // New pictures go up in batches; `onSaved` (from the form or the style sheet)
    // gets the first one, so it can become the logo right away.
    const saveStudio = async (items) => {
        setStudioBusy(true);
        setStudioError("");
        try {
            const saved = [];
            if (studio.sticker) saved.push(await library.update(studio.sticker.id, stickerPayload(items[0])));
            else {
                const payloads = items.map(stickerPayload);
                for (let i = 0; i < payloads.length; i += STICKER_BATCH) saved.push(...(await library.save(payloads.slice(i, i + STICKER_BATCH))));
            }
            studio.onSaved?.(saved[0]);
            setStudio(null);
        } catch (err) {
            if (!handleAuth(err)) setStudioError(err.message.toUpperCase());
        } finally {
            setStudioBusy(false);
        }
    };

    const archiveSticker = async (id) => {
        try {
            await library.archive(id);
        } catch (err) {
            if (!handleAuth(err)) setSheetError(err.message.toUpperCase());
        }
    };

    // Puts the changed placement into its item (or drops it when `placement` is null).
    const setPlacement = (eventId, placementId, placement) =>
        setEvents((prev) => {
            const e = prev[eventId];
            if (!e) return prev;
            const rest = (e.placements ?? []).filter((p) => p.id !== placementId);
            return { ...prev, [eventId]: { ...e, placements: placement ? [...rest, placement].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)) : rest } };
        });

    // Opens the tray; from an item, that item (that occurrence) is scrolled into view to drop on.
    const openTray = (eventId = null, date = null) => {
        setSheet(null);
        setPicker(null);
        setSelection(null);
        setTray(true);
        if (eventId) {
            window.requestAnimationFrame(() =>
                document
                    .querySelector(`[data-item-id="${eventId}"]${date ? `[data-occurrence="${date}"]` : ""}`)
                    ?.scrollIntoView({ block: "center", behavior: "smooth" })
            );
        }
    };

    const setDaySticker = (id, d) =>
        setDaySticks((prev) => {
            const next = { ...prev };
            if (d) next[id] = d;
            else delete next[id];
            return next;
        });

    // Puts a stuck sticker in place (or takes it away with null). `ref` says where
    // it lives: { kind: "item", eventId, id } or { kind: "day", id }.
    const putStuck = (ref, obj) => (ref.kind === "item" ? setPlacement(ref.eventId, ref.id, obj) : setDaySticker(ref.id, obj));
    // Shown now, saved later: kept through syncs until `saved` (or a failure) clears it.
    const showStuck = (ref, obj) => {
        unsaved.current.set(ref.id, { kind: ref.kind, eventId: ref.eventId, obj });
        putStuck(ref, obj);
    };
    const savedStuck = (ref, obj) => {
        unsaved.current.delete(ref.id);
        if (obj !== undefined) putStuck(ref, obj);
    };

    // Sticker changes show at once and are saved after; when saving fails, say so
    // and reload what is on screen, which puts the sticker back where it was.
    const stickerFailed = (err) => {
        unsaved.current.clear();
        if (handleAuth(err)) return;
        // A notice, not the sync error: the reload below clears that one when it works.
        setNotice(`STICKER NIET OPGESLAGEN (${err.message.toUpperCase().replace(/\.$/, "")}). HIJ IS TERUGGEZET.`);
        const cur = loadedRef.current;
        if (cur) fetchRange(cur.from, cur.to);
    };

    const removeStuck = async (ref) => {
        setLifted(null);
        showStuck(ref, null);
        try {
            await (ref.kind === "item" ? api.unplace(ref.id) : api.unstickDay(ref.id));
            savedStuck(ref);
            setSyncError("");
        } catch (err) {
            stickerFailed(err);
        }
    };

    // The newest events and day stickers, for saves that run a moment later.
    const latest = useRef({ events, daySticks });
    useEffect(() => {
        latest.current = { events, daySticks };
    });
    const stuckNow = (ref) =>
        ref.kind === "item" ? latest.current.events[ref.eventId]?.placements?.find((p) => p.id === ref.id) : latest.current.daySticks[ref.id];

    // Size and rotation changes show at once and are saved together a moment
    // later, with the sticker's current spot. One still being created waits for
    // its real id (`pendingLook`).
    const lookTimers = useRef({});
    const pendingLook = useRef({});
    useEffect(() => () => Object.values(lookTimers.current).forEach(clearTimeout), []);
    const saveLookSoon = (ref) => {
        clearTimeout(lookTimers.current[ref.id]);
        lookTimers.current[ref.id] = setTimeout(async () => {
            delete lookTimers.current[ref.id];
            const cur = unsaved.current.get(ref.id)?.obj ?? stuckNow(ref);
            if (!cur) return;
            const look = { scale: cur.scale ?? 1, rot: cur.rot ?? 0 };
            try {
                const saved =
                    ref.kind === "item"
                        ? (await api.movePlacement(ref.id, { x: cur.x, y: cur.y, ...look })).placement
                        : (await api.moveDaySticker(ref.id, { view: cur.view, day: cur.day, dx: cur.dx, dy: cur.dy, ...look })).daySticker;
                if (!lookTimers.current[ref.id]) savedStuck(ref, saved);
            } catch (err) {
                stickerFailed(err);
            }
        }, STICKER_LOOK_SAVE_MS);
    };
    // `liftedNow` is `lifted` without waiting for a render, so taps that follow
    // each other quickly each build on the one before.
    const liftedNow = useRef(lifted);
    useEffect(() => {
        liftedNow.current = lifted;
    }, [lifted]);
    const changeLook = (what, dir) => {
        const ref = liftedNow.current;
        const cur = ref && (unsaved.current.get(ref.id)?.obj ?? stuckNow(ref));
        if (!cur) return;
        const scale = ref.scale ?? cur.scale ?? 1;
        const rot = ref.rot ?? cur.rot ?? 0;
        const look = what === "scale" ? { scale: stepScale(scale, dir), rot } : { scale, rot: stepRot(rot, dir) };
        liftedNow.current = { ...ref, ...look };
        setLifted(liftedNow.current);
        showStuck(ref, { ...cur, ...look });
        if (ref.id.startsWith("tmp-")) pendingLook.current[ref.id] = true;
        else saveLookSoon(ref);
    };

    // A sticker let go somewhere: from the tray it sticks there; a stuck one moves
    // there (also from a day onto an item and back), keeping its size and
    // rotation; on the bin it comes off. What you dropped stays picked up, so the
    // size and rotation buttons are right there.
    const dropSticker = async (target, sticker, payload) => {
        const from = payload?.from ?? null;
        setLifted(null);
        if (target.kind === "bin") {
            if (from) removeStuck(from);
            return;
        }
        const look = { scale: from?.scale ?? 1, rot: from?.rot ?? 0 };
        const daySpot = target.kind === "day" ? { view: target.view, day: target.day, dx: target.dx, dy: target.dy } : null;
        try {
            const sameCard = from?.kind === "item" && target.kind === "item" && from.eventId === target.eventId && (from.occurrenceDate ?? null) === target.occurrenceDate;
            if (sameCard) {
                const old = events[from.eventId]?.placements?.find((p) => p.id === from.id);
                showStuck(from, { ...old, ...target.spot });
                setLifted(from);
                const saved = (await api.movePlacement(from.id, target.spot)).placement;
                if (!lookTimers.current[from.id]) savedStuck(from, saved);
            } else if (from?.kind === "day" && daySpot) {
                showStuck(from, { ...daySticks[from.id], ...daySpot });
                setLifted(from);
                const saved = (await api.moveDaySticker(from.id, daySpot)).daySticker;
                if (!lookTimers.current[from.id]) savedStuck(from, saved);
            } else {
                // New here: shown with a temporary id until the worker answers.
                const tmp = `tmp-${Date.now()}`;
                const here = daySpot ? { kind: "day", id: tmp } : { kind: "item", eventId: target.eventId, occurrenceDate: target.occurrenceDate, id: tmp };
                const base = { id: tmp, stickerId: sticker.id, placedBy: me, createdAt: new Date().toISOString(), ...look };
                showStuck(here, daySpot ? { ...base, ...daySpot } : { ...base, eventId: target.eventId, occurrenceDate: target.occurrenceDate, ...target.spot });
                setLifted({ ...here, stickerId: sticker.id, ...look });
                if (from) showStuck(from, null);
                const made = daySpot
                    ? (await api.stickDay({ ...daySpot, stickerId: sticker.id, ...look })).daySticker
                    : (await api.place({ eventId: target.eventId, stickerId: sticker.id, occurrenceDate: target.occurrenceDate, ...target.spot, ...look })).placement;
                const real = { ...here, id: made.id };
                // Size or rotation changed while it was being created: keep those.
                const changed = pendingLook.current[tmp] ? stuckNow(here) : null;
                delete pendingLook.current[tmp];
                savedStuck(here, null);
                if (changed) showStuck(real, { ...made, scale: changed.scale, rot: changed.rot });
                else putStuck(real, made);
                setLifted((prev) => (prev?.id === tmp ? { ...prev, id: made.id } : prev));
                if (changed) saveLookSoon(real);
                if (from) {
                    await (from.kind === "item" ? api.unplace(from.id) : api.unstickDay(from.id));
                    savedStuck(from);
                }
            }
            setSyncError("");
        } catch (err) {
            stickerFailed(err);
        }
    };
    const { active: dragging, start: startDrag, ghostRef: dragGhostRef, previewRef: dragPreviewRef } = useStickerDrag(dropSticker);

    // Pressing a stuck sticker: hold it (or drag with a mouse) to pick it up and
    // move it in one go; three taps pick it up too; fewer act like a tap on what
    // it sits on (`onFew`).
    const stuckTaps = useRef({ id: null, count: 0, timer: null });
    useEffect(() => () => clearTimeout(stuckTaps.current.timer), []);
    const tapStuck = (ref, onFew) => {
        const t = stuckTaps.current;
        clearTimeout(t.timer);
        t.count = t.id === ref.id ? t.count + 1 : 1;
        t.id = ref.id;
        if (t.count >= 3) {
            t.count = 0;
            setTray(false);
            setSelection(null);
            setLifted(ref);
            return;
        }
        t.timer = setTimeout(() => {
            t.count = 0;
            onFew?.();
        }, STICKER_TAP_MS);
    };
    const pressStuck = (e, ref, onFew) => {
        const sticker = library.byId[ref.stickerId];
        if (lifted?.id === ref.id) {
            startDrag(e, sticker, { now: true, payload: { from: ref } });
            return;
        }
        startDrag(e, sticker, { hold: e.pointerType === "mouse" ? 0 : STICKER_HOLD_MS, payload: { from: ref }, onTap: () => tapStuck(ref, onFew) });
    };

    const toggleSelect = useCallback(
        (id) =>
            setSelection((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            }),
        []
    );

    const applyStyle = async (body) => {
        setBusy(true);
        setSheetError("");
        try {
            const { events: changed } = await api.style({ ids: [...selection], ...body });
            changed.forEach(upsert);
            setSheet(null);
            setSelection(null);
        } catch (err) {
            if (!handleAuth(err)) setSheetError(err.message.toUpperCase());
        } finally {
            setBusy(false);
        }
    };

    // On desktop the list sits next to the month: picking a day there scrolls the
    // list to it, so the list is stretched first when the day lies outside it.
    const selectDay = (day) => {
        setSelected(day);
        if (!isDesktop || (day >= listRange.from && day <= listRange.to)) return;
        const from = day < listRange.from ? day : listRange.from;
        const to = day > listRange.to ? day : listRange.to;
        setListRange({ from, to });
        ensureRange(from, to);
    };

    const changeMonth = (n) => {
        const next = addMonths(ym, n);
        setYm(next);
        const t = todayIso();
        const tm = monthOf(t);
        selectDay(tm.year === next.year && tm.month === next.month ? t : `${next.year}-${String(next.month + 1).padStart(2, "0")}-01`);
        const grid = gridRange(next);
        ensureRange(grid.from, grid.to);
    };

    const goToday = () => {
        const t = todayIso();
        setYm(monthOf(t));
        selectDay(t);
    };

    // The day new items start on: the picked day where a month is shown, else today.
    const formDay = isDesktop || view === "maand" ? selected : today;

    // Keyboard shortcuts (shown under the month on desktop). Not while typing or
    // while a panel is open; Escape is handled by the panel itself.
    useEffect(() => {
        if (!profile) return undefined;
        const onKey = (e) => {
            if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || sheet || picker || studio || isTyping(e.target)) return;
            if (lifted && !dragging) {
                const step = { "+": ["scale", 1], "=": ["scale", 1], "-": ["scale", -1], "[": ["rot", -1], "]": ["rot", 1] }[e.key];
                if (step) {
                    e.preventDefault();
                    changeLook(...step);
                    return;
                }
            }
            if (e.key === "Escape" && (lifted || selection || tray)) {
                setLifted(null);
                setSelection(null);
                setTray(false);
                return;
            }
            const monthShown = isDesktop || view === "maand";
            const actions = {
                n: () => openForm(formDay),
                d: () => openForm(formDay, null, "bijzonder"),
                i: () => fileInputRef.current?.click(),
                t: goToday,
                l: () => setView("lijst"),
                m: () => setView("maand"),
                arrowleft: monthShown ? () => changeMonth(-1) : null,
                arrowright: monthShown ? () => changeMonth(1) : null,
            };
            const action = actions[e.key.toLowerCase()];
            if (!action) return;
            e.preventDefault();
            action();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    // Yearly special days are placed in every year the list and month can show.
    const grid = gridRange(ym);
    const fromYear = Number((listRange.from < grid.from ? listRange.from : grid.from).slice(0, 4));
    const toYear = Number((listRange.to > grid.to ? listRange.to : grid.to).slice(0, 4));
    // Repeating items get one occurrence per time they happen in that stretch.
    const shownFrom = listRange.from < grid.from ? listRange.from : grid.from;
    const shownTo = listRange.to > grid.to ? listRange.to : grid.to;
    const list = useMemo(
        () => expandRepeats(expandYearly(Object.values(events), fromYear, toYear), shownFrom, shownTo),
        [events, fromYear, toYear, shownFrom, shownTo]
    );
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

    // A series waits for one answer, however often it shows.
    const waiting = new Set(list.filter((e) => e.endDate >= today && itemState(e, me, people.ids).needsMyAnswer).map((e) => e.id)).size;
    const itemProps = {
        people,
        newIds,
        trackSeen,
        onRead: markRead,
        onOpen: openDetail,
        onOpenBusy: openBusy,
        onRespond: respond,
        busy,
        stickersById: library.byId,
        selection,
        onToggleSelect: toggleSelect,
        stickerHiddenId: dragging?.payload?.from?.id ?? null,
        stickerLiftedId: lifted?.id ?? null,
        onStickerPress: pressStuck,
    };
    const dayStickers = {
        items: Object.values(daySticks),
        stickersById: library.byId,
        hiddenId: dragging?.payload?.from?.id ?? null,
        liftedId: lifted?.id ?? null,
        onPress: (e, d) =>
            pressStuck(e, { kind: "day", id: d.id, stickerId: d.stickerId, scale: d.scale ?? 1, rot: d.rot ?? 0 }, () => d.view === "maand" && selectDay(d.day)),
    };
    // While a stuck sticker is picked up, the bottom bar is a bin to drop it on.
    const binOpen = Boolean(dragging?.payload?.from);
    const lookControls = lifted && <AgendaStickerLook look={lifted} onChange={changeLook} onDone={() => setLifted(null)} />;
    // A repeating item's sheets show the occurrence that was opened.
    const sheetSeries = sheet?.id ? events[sheet.id] : null;
    const sheetEvent = sheetSeries && occurrenceOf(sheetSeries, shownDate(sheetSeries, sheet.date));

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
                onClick={() => openForm(formDay, null, "bijzonder")}
                className={BTN_ATTENTION}
                aria-label="Bijzondere dag toevoegen: verjaardag, jubileum of anders"
            >
                [★ DAG]
            </button>
            <button type="button" onClick={() => openForm(formDay)} className={`${BTN_PRIMARY} ml-auto`}>
                [+ NIEUW]
            </button>
        </>
    );

    // While sticking a sticker on or choosing items, the bar at the bottom (also on
    // desktop) holds just that.
    const modeBar = binOpen ? (
        <span className="text-[#ff4d4d] uppercase px-[1ch] min-w-0 truncate">
            <span className="cell">✕</span> LAAT HIER LOS OM WEG TE HALEN
        </span>
    ) : lifted && !tray ? (
        lookControls
    ) : tray ? (
        <AgendaStickerTray
            stickers={library.choices}
            draggingId={dragging && !dragging.payload ? dragging.sticker.id : null}
            onStart={startDrag}
            onDraw={() => openStudio("editor")}
            onImport={() => openStudio("import")}
            onManage={() => setPicker({})}
            look={lookControls}
            onClose={() => setTray(false)}
        />
    ) : selection ? (
        <>
            <span className="text-neutral-400 uppercase px-[1ch] whitespace-nowrap">{selection.size} GEKOZEN</span>
            <button
                type="button"
                disabled={!selection.size}
                onClick={() => {
                    setSheetError("");
                    setSheet({ type: "style" });
                }}
                className={`${BTN_PRIMARY} ml-auto`}
            >
                [KLEUR / LOGO]
            </button>
            <button type="button" onClick={() => setSelection(null)} className={BTN_PLAIN}>
                [KLAAR]
            </button>
        </>
    ) : null;

    const toolbar = !modeBar && (
        <div className="flex flex-wrap gap-x-[1ch] -ml-[1ch] mb-[1lh]">
            <button type="button" onClick={() => openTray()} className={BTN_PLAIN} title="Sleep stickers op een dag of afspraak">
                <span>[<span className="cell">★</span> STICKERS]</span>
            </button>
            <button type="button" onClick={() => setPicker({})} className={BTN_PLAIN} title="Teken of laad plaatjes in: je stickers en logo's">
                <span>[<span className="cell">✎</span> PLAATJES MAKEN]</span>
            </button>
            <button type="button" onClick={() => setSelection(new Set())} className={BTN_PLAIN} title="Kies items om ze een kleur of logo te geven">
                [KIES]
            </button>
        </div>
    );

    // Desktop: the same actions in the header (no view switch: both are shown).
    const actions = (
        <>
            <button type="button" onClick={() => fileInputRef.current?.click()} className={BTN_PLAIN} title="Importeer een agendabestand (.ics) · I">
                [IMPORT]
            </button>
            <button type="button" onClick={() => openForm(formDay, null, "bijzonder")} className={BTN_ATTENTION} title="Bijzondere dag · D">
                [★ DAG]
            </button>
            <button type="button" onClick={() => openForm(formDay)} className={BTN_PRIMARY} title="Nieuw · N">
                [+ NIEUW]
            </button>
        </>
    );

    const notices = (
        <>
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
        </>
    );

    const fileInput = (
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
    );

    return (
        <Shell
            people={people}
            onLogout={onLogout}
            status={status}
            bar={modeBar ?? (isDesktop ? null : bar)}
            barRows={tray && !binOpen ? TRAY_ROWS : 4}
            bin={binOpen}
            actions={isDesktop ? actions : null}
            dropProps={dropProps}
            dropping={dropping}
        >
            {fileInput}
            {isDesktop ? (
                // Month (80ch, stays in view) beside the list; panels dock over the list.
                <div className="grid gap-x-[4ch]" style={{ gridTemplateColumns: "80ch minmax(0, 1fr)" }}>
                    <aside className="sticky top-[4lh] self-start max-h-[calc(100dvh-4lh)] overflow-y-auto no-scrollbar pb-[1lh]">
                        <AgendaMonth
                            events={list}
                            ym={ym}
                            selected={selected}
                            today={today}
                            itemProps={itemProps}
                            dayStickers={dayStickers}
                            onSelect={selectDay}
                            wide={isDesktop}
                            onMonth={changeMonth}
                            onToday={goToday}
                            onNew={(date) => openForm(date)}
                        />
                    </aside>
                    <div className="min-w-0">
                        {notices}
                        {toolbar}
                    <AgendaList
                            events={list}
                            from={listRange.from}
                            to={listRange.to}
                            today={today}
                            loading={loading > 0}
                            itemProps={itemProps}
                            dayStickers={dayStickers}
                            focusDay={isDesktop ? selected : null}
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
                    </div>
                </div>
            ) : (
                <>
                    {notices}
                    {toolbar}
                    {view === "lijst" ? (
                    <AgendaList
                        events={list}
                        from={listRange.from}
                        to={listRange.to}
                        today={today}
                        loading={loading > 0}
                        itemProps={itemProps}
                        dayStickers={dayStickers}
                        focusDay={isDesktop ? selected : null}
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
                        dayStickers={dayStickers}
                        onSelect={selectDay}
                        wide={isDesktop}
                        onMonth={changeMonth}
                        onToday={goToday}
                        onNew={(date) => openForm(date)}
                    />
                    )}
                </>
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
                    stickersById={library.byId}
                    onAddSticker={openTray}
                    onRemoveSticker={(eventId, id) => removeStuck({ kind: "item", eventId, id })}
                />
            )}
            {sheet?.type === "busy" && (
                <AgendaBusySheet
                    group={{ ...sheet.group, items: sheet.group.ids.filter(([id]) => events[id]).map(([id, date]) => occurrenceOf(events[id], date)) }}
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
                    event={sheetEvent}
                    date={sheet.date}
                    kind={sheet.kind}
                    people={people}
                    stickers={library.choices}
                    busy={busy}
                    error={sheetError}
                    onClose={closeSheet}
                    onSave={save}
                    onStudio={openStudio}
                />
            )}
            {sheet?.type === "style" && selection && (
                <AgendaStyleSheet
                    events={[...selection].map((id) => events[id]).filter(Boolean)}
                    stickers={library.choices}
                    busy={busy}
                    error={sheetError}
                    onApply={applyStyle}
                    onStudio={openStudio}
                    onClose={closeSheet}
                />
            )}
            {picker && (
                <AgendaLibrary
                    stickers={library.choices}
                    busy={busy}
                    error={sheetError}
                    onDraw={() => openStudio("editor")}
                    onImport={() => openStudio("import")}
                    onEdit={editSticker}
                    onArchive={archiveSticker}
                    onStick={() => openTray()}
                    onClose={() => setPicker(null)}
                />
            )}
            {/* In <body>: the bottom bar's backdrop blur would make `fixed` count from the bar. */}
            {dragging &&
                createPortal(
                    <>
                        <span ref={dragPreviewRef} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[69] opacity-40 invisible">
                            <StickerImage sticker={dragging.sticker} scale={dragging.payload?.from?.scale ?? 1} rot={dragging.payload?.from?.rot ?? 0} />
                        </span>
                        <span ref={dragGhostRef} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[70]">
                            <StickerImage sticker={dragging.sticker} scale={dragging.payload?.from?.scale ?? 1} rot={dragging.payload?.from?.rot ?? 0} />
                        </span>
                    </>,
                    document.body
                )}
            {studio?.type === "editor" && (
                <PixelEditor
                    key={`editor-${studio.sticker?.id || "new"}`}
                    initial={studio.initial}
                    busy={studioBusy}
                    error={studioError}
                    onSave={(item) => saveStudio([item])}
                    onClose={() => setStudio(null)}
                />
            )}
            {studio?.type === "import" && (
                <PixelImport
                    files={studio.files}
                    busy={studioBusy}
                    error={studioError}
                    onSave={saveStudio}
                    onEdit={(item) => openStudio("editor", studio.onSaved, { initial: { name: item.name, pixels: item.pixels } })}
                    onClose={() => setStudio(null)}
                />
            )}
        </Shell>
    );
}

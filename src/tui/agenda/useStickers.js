// src/tui/agenda/useStickers.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The shared library of stickers and logos. It is kept in IndexedDB on this
// device, so opening the agenda only fetches what changed since the newest
// `updatedAt` it already has. Storage can be missing (private mode) or throw;
// then it just loads everything from the worker.
const DB_NAME = "agenda-stickers";
const STORE = "stickers";

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore(mode, work) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const result = work(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(result?.result ?? result);
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

async function readCache() {
    try {
        return (await withStore("readonly", (store) => store.getAll())) ?? [];
    } catch {
        return [];
    }
}

async function writeCache(stickers) {
    if (!stickers.length) return;
    try {
        await withStore("readwrite", (store) => stickers.forEach((s) => store.put(s)));
    } catch {
        // the next load fetches them again
    }
}

/** Forgets the library on this device (on logout). */
export async function clearStickerCache() {
    try {
        await withStore("readwrite", (store) => store.clear());
    } catch {
        // nothing stored
    }
}

const newest = (list) => list.reduce((max, s) => (s.updatedAt > max ? s.updatedAt : max), "");

/**
 * `refreshKey` is anything that changes when the agenda's rev changes; each change
 * fetches what is new. Returns every sticker by id (archived ones too, so old
 * placements and logos still draw) and the list to pick from (not archived, newest
 * first).
 */
export default function useStickers(api, refreshKey) {
    const [byId, setById] = useState({});
    const since = useRef("");
    const loading = useRef(null);

    const merge = useCallback((list) => {
        if (!list.length) return;
        const top = newest(list);
        if (top > since.current) since.current = top;
        setById((prev) => {
            const next = { ...prev };
            for (const s of list) next[s.id] = s;
            return next;
        });
    }, []);

    const refresh = useCallback(() => {
        if (loading.current) return loading.current;
        loading.current = (async () => {
            try {
                const { stickers } = await api.stickers(since.current || undefined);
                merge(stickers);
                writeCache(stickers);
            } catch {
                // offline or logged out: keep what we have
            } finally {
                loading.current = null;
            }
        })();
        return loading.current;
    }, [api, merge]);

    useEffect(() => {
        let live = true;
        readCache().then((cached) => {
            if (!live) return;
            merge(cached);
            refresh();
        });
        return () => {
            live = false;
        };
    }, [merge, refresh]);

    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        refresh();
    }, [refreshKey, refresh]);

    const save = useCallback(
        async (payloads) => {
            const { stickers } = await api.createStickers(payloads);
            merge(stickers);
            writeCache(stickers);
            return stickers;
        },
        [api, merge]
    );

    const update = useCallback(
        async (id, payload) => {
            const { sticker } = await api.updateSticker(id, payload);
            merge([sticker]);
            writeCache([sticker]);
            return sticker;
        },
        [api, merge]
    );

    const archive = useCallback(
        async (id) => {
            await api.archiveSticker(id);
            await refresh();
        },
        [api, refresh]
    );

    const choices = useMemo(
        () => Object.values(byId).filter((s) => !s.archived).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        [byId]
    );

    return { byId, choices, refresh, save, update, archive };
}

// src/utils/agendaApi.js
// Client for the private agenda routes on the sisyfuz-counter worker.
// The session token lives in localStorage; nothing else is stored on the device.

const API_BASE = import.meta.env?.VITE_AGENDA_API || "https://sisyfuz-counter.sisyfuz.workers.dev";
const TOKEN_KEY = "sisyfuz:agenda-session";

export class AgendaError extends Error {
    constructor(message, status, data = {}) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

export function loadSession() {
    try {
        const raw = localStorage.getItem(TOKEN_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session?.token || !(session.expiresAt > Date.now())) {
            localStorage.removeItem(TOKEN_KEY);
            return null;
        }
        return session;
    } catch {
        return null;
    }
}

function saveSession(session) {
    try {
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: session.token, expiresAt: session.expiresAt }));
    } catch {
        // Private browsing: the session then only lasts until the tab closes.
    }
}

export function clearSession() {
    try {
        localStorage.removeItem(TOKEN_KEY);
    } catch {
        // ignore
    }
}

async function request(path, { method = "GET", body, token } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer",
        });
    } catch {
        throw new AgendaError("Geen verbinding. Probeer het zo opnieuw.", 0);
    }
    let data = {};
    try {
        data = await res.json();
    } catch {
        // non-JSON error page
    }
    if (!res.ok) throw new AgendaError(data.error || `Er ging iets mis (${res.status}).`, res.status, data);
    return data;
}

export async function login(passphrase) {
    const data = await request("/agenda/login", { method: "POST", body: { passphrase } });
    saveSession(data);
    return data;
}

/** Step 1 of choosing your own password: whose one-time code is this? */
export function checkSetupCode(code) {
    return request("/agenda/setup/check", { method: "POST", body: { code } });
}

/** Step 2: store your own password (the worker keeps only a hash) and log in. */
export async function choosePassword(code, passphrase) {
    const data = await request("/agenda/setup", { method: "POST", body: { code, passphrase } });
    saveSession(data);
    return data;
}

/** Binds the API calls to a session token. */
export function agendaClient(token) {
    return {
        me: () => request("/agenda/me", { token }),
        /** One number that changes with every change; cheap to poll. */
        rev: () => request("/agenda/rev", { token }),
        events: (from, to) => request(`/agenda/events?from=${from}&to=${to}`, { token }),
        create: (event) => request("/agenda/events", { method: "POST", body: event, token }),
        update: (id, event) => request(`/agenda/events/${id}`, { method: "PATCH", body: event, token }),
        remove: (id) => request(`/agenda/events/${id}`, { method: "DELETE", token }),
        respond: (id, response) => request(`/agenda/events/${id}/response`, { method: "POST", body: { response }, token }),
        importEvents: (events) => request("/agenda/import", { method: "POST", body: { events }, token }),
        /** level "seen": it was on screen; "read": opened, hovered on or held. */
        seen: (ids, level = "seen") => request("/agenda/seen", { method: "POST", body: { ids, level }, token }),
    };
}

// test/helpers/fakeD1.js
// Minimal in-memory stand-in for a Cloudflare D1 binding, backed by node:sqlite.
// Covers the API the worker uses: prepare().bind().first()/all()/run() and batch().
import { DatabaseSync } from "node:sqlite";

const RETURNS_ROWS = /^\s*(SELECT|WITH)\b|\bRETURNING\b/i;

export function createFakeD1() {
    const db = new DatabaseSync(":memory:");

    const plain = (row) => (row ? { ...row } : row);

    function statement(sql, params = []) {
        const exec = () => {
            const stmt = db.prepare(sql);
            if (RETURNS_ROWS.test(sql)) {
                const rows = stmt.all(...params).map(plain);
                return { results: rows, success: true, meta: { changes: rows.length } };
            }
            const info = stmt.run(...params);
            return { results: [], success: true, meta: { changes: Number(info.changes) } };
        };
        return {
            bind: (...values) => statement(sql, values),
            async first(column) {
                const row = exec().results[0] ?? null;
                if (row === null) return null;
                return column ? row[column] : row;
            },
            async all() {
                return exec();
            },
            async run() {
                return exec();
            },
            exec,
        };
    }

    return {
        sqlite: db,
        prepare: (sql) => statement(sql),
        async batch(statements) {
            db.exec("BEGIN");
            try {
                const results = statements.map((s) => s.exec());
                db.exec("COMMIT");
                return results;
            } catch (err) {
                db.exec("ROLLBACK");
                throw err;
            }
        },
    };
}

# Words page redesign, "I know it", and SQLite storage

Date: 2026-10-10 · Status: APPROVED

## Goal
1. Make the Words page pleasant and fast to use.
2. Let the user mark words as known ("I know it") with one click, a keyboard key, or a triage run.
3. Store all progress in a real SQLite file on disk instead of browser IndexedDB.

## Decisions made with the user
- SQLite because the user wants **a real file on disk** (survives clearing the browser, independent of origin/port).
- "Known" = badge on the word, card skipped in Review, counted on the dashboard.
- All three shortcuts: one-click ✓ per row, keyboard keys, triage mode.
- Existing IndexedDB data is migrated **automatically, once**.
- Two-pane layout (list left, detail right; stacked on narrow screens).
- Zero npm dependencies stays: use Node's built-in `node:sqlite` (Node ≥ 22.13; verified on Node 24.14 / SQLite 3.51, prints an ExperimentalWarning).

## Storage

### Server
- `tools/store.mjs` (new): all SQLite code. `openStore(path)` returns functions used by the server. Opened with `DatabaseSync`, file `data/nor-tutor.db` (gitignored); `:memory:` in tests.
- Tables (each row keeps today's object as JSON so the browser-side shapes do not change):
  - `cards (word_id TEXT PRIMARY KEY, data TEXT NOT NULL)`
  - `known (word_id TEXT PRIMARY KEY, data TEXT NOT NULL)` — data `{ wordId, timestamp }`
  - `reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)`
  - `tests (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)`
  - Word ids are stored as JSON-stringified keys so numeric and string ids round-trip exactly.
- Operations: `getAll(store)`, `add(store, obj)` (fails with conflict if the key exists), `put(store, obj)` (upsert; keyed stores only), `del(store, key)` (keyed stores only), `loadState()`, `replaceState(state)` (one transaction: clear all four tables, insert all; rolled back on any error).
- `tools/serve.mjs` gains JSON routes under `/api/`:
  - `GET /api/state` → `{ cards, reviews, tests, known }`
  - `GET /api/:store` → array
  - `POST /api/:store` → add; `409` on key conflict
  - `PUT /api/:store` → put
  - `DELETE /api/:store/:key` → del
  - `PUT /api/state` → replaceState, body validated with `parseBackup` rules from `src/backup.js`
- Trust boundary checks on every `/api/` request: `Host` must be `127.0.0.1:5173`; for writes, `Origin` must be `http://127.0.0.1:5173` and `Content-Type` must be `application/json` (blocks other websites and DNS rebinding from writing to the DB). Store names come from a fixed whitelist. Request bodies over 5 MB are rejected. Keyed stores require a `wordId`. Errors return JSON `{ error }` with 4xx/5xx; the DB is never left half-written.
- Static file serving is unchanged (dotfile block, path containment). `data/nor-tutor.db` must not be served: block `.db` files under `data/`.

### Browser
- `src/db.js` keeps its exported interface (`openDb, getAll, put, add, loadState, replaceState`) and adds `del(db, store, key)`. Implementation switches to `fetch` against `/api/`. A `409` from add surfaces as an error with `name === 'ConstraintError'` so `explore.js` keeps working unchanged in that respect.
- `loadState` now also returns `known`.

### One-time migration
- In `openDb()`: if `GET /api/state` is all empty **and** `indexedDB.databases()` lists `nor-tutor`, read the old IndexedDB stores (read-only, old code path kept only for this), `PUT /api/state` with them (`known: []`), and show a one-line notice "Moved your progress from the browser into data/nor-tutor.db". The IndexedDB data is left in place as a fallback, never deleted.
- If migration fails (validation or network), the app keeps running, shows the reason, and leaves SQLite empty; because IndexedDB is untouched, migration is retried on the next load. No data is lost.

### Backup format
- `BACKUP_VERSION` → 2: adds `known` (array of `{ wordId, timestamp }`, unique wordId). `parseBackup` accepts v1 (treats `known` as `[]`) and v2.

## Words page (`src/views/explore.js`, `styles.css`)
- Header: "Words", a "Triage unmarked ▶" button, search box (`/` focuses it).
- Filter chips with counts: All · Unmarked · Known · In deck. *Unmarked* = neither known nor in deck. Filter combines with search.
- Left pane list (frequency order): lemma, POS, gloss in small text, status badge ("Known" / "In deck" as text, not colour only), one-click ✓ on unmarked rows. Selected row highlighted, `aria-selected`.
- Right pane detail: large lemma + POS, gloss, Norwegian definition, forms, notes, phrase chips, examples as quote blocks with English below; buttons **✓ I know it (K)** / **Unmark known** and **+ Add to deck (A)** / **In deck**.
- Under 720px the panes stack.
- Keys (ignored while typing in an input, except `Esc` which leaves the search box): `j`/`k` or ↓/↑ move selection, `Enter` opens, `K` toggles known, `A` adds to deck, `/` focuses search. A key legend is shown at the bottom.
- Triage mode (inside the Words view): queue = unmarked words by rank. Shows lemma; `Space` reveals meaning; `K` known, `A` add to deck, `S`/→ skip, `Esc` back to list. Shows progress "n / total" and a done screen.
- Marking known never deletes a card. Unmarking deletes the `known` row only.

## Other views
- Review: skip cards whose word is in `known`.
- Dashboard: tile "Marked known" with count and % of the word list.
- Data: export/import include `known`.

## Pure logic (unit-tested)
- `src/search.js`: `filterWords(words, { query, filter, known, inDeck })` and `countByFilter(...)`, built on `searchWords`.
- Triage queue order (unmarked, by rank).
- `tools/store.mjs` with `:memory:`: add/put/del/getAll, add conflict, replaceState rollback, id round-trip.
- `src/backup.js`: v1 and v2 parsing, duplicate/invalid `known` rejected.

## Verification
- `npm test` green.
- Manual in browser (Playwright): migration from existing IndexedDB data, Words keys and triage, Review skips known, dashboard tile, export/import round-trip.

## Docs
- README and CLAUDE.md: Node ≥ 22.13, data lives in `data/nor-tutor.db`, drop the "always use 127.0.0.1 or data looks empty" warning (still the only served address), mention `node:sqlite` ExperimentalWarning is expected.

## Out of scope
- Undo toasts, bulk marking, multi-device sync, SQL-level reporting columns.

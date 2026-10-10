# Words Redesign, Known Words, SQLite Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store progress in a SQLite file on disk, add "I know it" marking (one-click, keyboard, triage), and redesign the Words page as a two-pane browser.

**Architecture:** The dev server (`tools/serve.mjs`) owns a SQLite database through Node's built-in `node:sqlite` (`tools/store.mjs`) and exposes a small JSON API (`tools/api.mjs`). `src/db.js` keeps its exported functions but talks to that API with `fetch`, so views barely change; on first load it copies any old IndexedDB data across once. Row validation lives in one place (`src/backup.js`) and is shared by backup import and the API.

**Tech Stack:** Node ≥ 22.13 (`node:sqlite`, `node:test`, `node:http`), vanilla JS ES modules, no npm dependencies, Chart.js 4.4.1 from CDN (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-10-words-ui-sqlite-design.md`

## Global Constraints

- No build step, no npm dependencies. SQLite comes from built-in `node:sqlite` (`DatabaseSync`). Node ≥ 22.13. Node 24 prints `ExperimentalWarning: SQLite is an experimental feature`; that is expected.
- Database file: `data/nor-tutor.db` (gitignored, never served over HTTP).
- Stores: `cards`, `reviews`, `tests`, `known`. Keyed stores (`cards`, `known`) are keyed by `wordId`; ids are stored as `JSON.stringify(wordId)` so `1` and `'1'` stay distinct.
- API only at `http://127.0.0.1:5173`: `Host` must equal `127.0.0.1:5173`; every non-GET needs `Origin: http://127.0.0.1:5173` and `Content-Type: application/json`; bodies over 5 MB → 413.
- `BACKUP_VERSION` = 2 (adds `known: [{ wordId, timestamp }]`); version 1 backups still import with `known: []`.
- Marking a word known never deletes its review card; Review skips cards of known words.
- **Deviation from spec, decided while planning:** list navigation is ↑/↓ only (no `j`/`k`), because `k` (move up) and `K` (mark known) would be the same key once case is ignored. Keys are matched case-insensitively.
- Pure modules (`srs`, `estimator`, `pseudowords`, `stats`, `search`, `backup`, `wordsSchema`, `rng`) must not touch `document`, `window`, `indexedDB` or `fetch`.
- **User control:** every task ends by showing `git diff --stat` and the changed files to the user. **Do not commit until the user says OK.** Commit messages are Conventional Commits and end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run commands from `C:\Users\asahi\source\nor-tutor`. Tests: `npm test`.

## Review Focus

1. **App opened at `http://localhost:5173`, or server not running** → a readable message saying to open `http://127.0.0.1:5173` / start `npm start`, not a blank page. (Task 3 test for the 403 text; Task 4 network-error message; Task 8 manual check.)
2. **Word ids that are numeric vs string, or contain `/`** → stored, listed and deleted exactly. (Task 2 and Task 3 tests.)
3. **Marking the last unmarked word while the "Unmarked" filter is on, or at the end of the list** → selection moves to the neighbour / list shows "No matching words.", no crash. (Task 6 manual check.)
4. **Pressing K twice quickly, or the save failing** → one write, UI ends in the true state, error shown on failure. (Task 6 busy guard + manual check.)
5. **Importing an old v1 backup, or a malformed one, after the upgrade** → v1 imports with no known words; malformed changes nothing. (Task 1 and Task 3 tests.)

---

### Task 1: Backup format v2 and shared row validation

**Files:**
- Modify: `src/backup.js` (whole file)
- Test: `tests/backup.test.js`

**Interfaces:**
- Produces: `BACKUP_VERSION = 2`; `STORES = ['cards', 'reviews', 'tests', 'known']`; `validRow(store: string, row: unknown): boolean`; `serialize({ cards, reviews, tests, known }, now): string`; `parseBackup(text): { cards, reviews, tests, known }`.

- [ ] **Step 1: Update tests.** In `tests/backup.test.js` change the import line and the `state` fixture, and append three tests:

```js
import { serialize, parseBackup, validRow, STORES, BACKUP_VERSION } from '../src/backup.js';

const state = {
  cards: [{ wordId: 1, ease: 2.5, interval: 6, reps: 2, lapses: 0, due: 1000 }],
  reviews: [{ wordId: 1, timestamp: 900, grade: 'good', ms: 2500, prevInterval: 1 }],
  tests: [{ timestamp: 800, estimate: 4200, ciLow: 3900, ciHigh: 4500, bands: [{ band: 'b1', pCorrected: 0.9 }] }],
  known: [{ wordId: 1, timestamp: 950 }],
};
```

```js
test('v1 backups still import, with no known words (Review Focus 5)', () => {
  const { known, ...v1 } = state;
  assert.deepEqual(parseBackup(JSON.stringify({ version: 1, ...v1 })), { ...v1, known: [] });
});

test('v2 rejects missing, malformed or duplicate known rows', () => {
  const v2 = (known) => JSON.stringify({ version: 2, ...state, known });
  assert.throws(() => parseBackup(v2(undefined)), /"known" must be an array/);
  assert.throws(() => parseBackup(v2([{ wordId: 1 }])), /Invalid known word at index 0/);
  assert.throws(() => parseBackup(v2([{ wordId: null, timestamp: 1 }])), /Invalid known word at index 0/);
  assert.throws(() => parseBackup(v2([{ wordId: 1, timestamp: 1 }, { wordId: 1, timestamp: 2 }])), /Duplicate known word 1/);
});

test('validRow checks one row of a named store', () => {
  assert.deepEqual(STORES, ['cards', 'reviews', 'tests', 'known']);
  assert.equal(validRow('known', { wordId: 'x', timestamp: 1 }), true);
  assert.equal(validRow('known', { wordId: 'x' }), false);
  assert.equal(validRow('cards', state.cards[0]), true);
  assert.equal(validRow('toString', {}), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/backup.test.js`
Expected: FAIL — `validRow`/`STORES` not exported; round trip fails because `known` is dropped.

- [ ] **Step 3: Replace `src/backup.js`**

```js
import { GRADES } from './srs.js';

export const BACKUP_VERSION = 2;
export const STORES = ['cards', 'reviews', 'tests', 'known'];

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isId = (x) => typeof x === 'number' || typeof x === 'string';
const isGrade = (g) => typeof g === 'string' && Object.hasOwn(GRADES, g);

const ROW_CHECKS = {
  cards: (c) => isObj(c) && isId(c.wordId) && num(c.ease) && num(c.interval) && num(c.reps) && num(c.lapses) && num(c.due),
  reviews: (r) =>
    isObj(r) &&
    isId(r.wordId) &&
    num(r.timestamp) &&
    isGrade(r.grade) &&
    (r.ms === undefined || num(r.ms)) &&
    (r.prevInterval === undefined || num(r.prevInterval)),
  tests: (t) =>
    isObj(t) &&
    num(t.timestamp) &&
    num(t.estimate) &&
    num(t.ciLow) &&
    num(t.ciHigh) &&
    Array.isArray(t.bands) &&
    t.bands.every((b) => isObj(b) && typeof b.band === 'string' && num(b.pCorrected)),
  known: (k) => isObj(k) && isId(k.wordId) && num(k.timestamp),
};
const LABELS = { cards: 'card', reviews: 'review', tests: 'test', known: 'known word' };
const DUPLICATE = { cards: (id) => `Duplicate card for word ${id}`, known: (id) => `Duplicate known word ${id}` };

export const validRow = (store, row) => Object.hasOwn(ROW_CHECKS, store) && ROW_CHECKS[store](row);

export function serialize({ cards, reviews, tests, known }, now) {
  return JSON.stringify(
    { version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), cards, reviews, tests, known },
    null,
    2,
  );
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Backup is not valid JSON');
  }
  if (data === null || typeof data !== 'object') throw new Error('File is not a backup');
  if (data.version !== 1 && data.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${data.version}`);
  if (data.version === 1) data = { ...data, known: [] }; // v1 predates known words
  const out = {};
  for (const store of STORES) {
    const rows = data[store];
    if (!Array.isArray(rows)) throw new Error(`Backup field "${store}" must be an array`);
    const seen = new Set();
    rows.forEach((row, i) => {
      if (!validRow(store, row)) throw new Error(`Invalid ${LABELS[store]} at index ${i}`);
      if (!DUPLICATE[store]) return;
      if (seen.has(row.wordId)) throw new Error(DUPLICATE[store](row.wordId));
      seen.add(row.wordId);
    });
    out[store] = rows;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (existing backup tests unchanged in behaviour; `views/data.js` still works because `parseBackup` now also returns `known`).

- [ ] **Step 5: Show `git diff --stat` and the diff; after the user's OK commit**

```bash
git add src/backup.js tests/backup.test.js
git commit -m "feat: backup v2 with known words and shared row validation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: SQLite store

**Files:**
- Create: `tools/store.mjs`
- Test: `tests/store.test.js`

**Interfaces:**
- Consumes: `STORES` from `src/backup.js` (Task 1).
- Produces: `openStore(path: string)` → `{ getAll(store), add(store, row), put(store, row), del(store, wordId), loadState(), replaceState({cards,reviews,tests,known}), close() }`; `KEYED: Set<'cards'|'known'>`; `class ConflictError extends Error` (thrown by `add` on an existing key).

- [ ] **Step 1: Write the failing test** `tests/store.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, ConflictError } from '../tools/store.mjs';

const card = (wordId, reps = 0) => ({ wordId, ease: 2.5, interval: 0, reps, lapses: 0, due: 1 });

test('starts empty', () => {
  assert.deepEqual(openStore(':memory:').loadState(), { cards: [], reviews: [], tests: [], known: [] });
});

test('unkeyed stores keep insertion order', () => {
  const s = openStore(':memory:');
  s.add('reviews', { wordId: 1, timestamp: 2, grade: 'good' });
  s.add('reviews', { wordId: 1, timestamp: 1, grade: 'again' });
  assert.deepEqual(s.getAll('reviews').map((r) => r.timestamp), [2, 1]);
});

test('add on a keyed store refuses an existing key', () => {
  const s = openStore(':memory:');
  s.add('known', { wordId: 1, timestamp: 1 });
  assert.throws(() => s.add('known', { wordId: 1, timestamp: 2 }), ConflictError);
  assert.deepEqual(s.getAll('known'), [{ wordId: 1, timestamp: 1 }]);
});

test('numeric and string ids are different keys and round-trip exactly (Review Focus 2)', () => {
  const s = openStore(':memory:');
  s.add('known', { wordId: 1, timestamp: 1 });
  s.add('known', { wordId: '1', timestamp: 2 });
  s.add('known', { wordId: 'a/b', timestamp: 3 });
  assert.deepEqual(s.getAll('known').map((k) => k.wordId), [1, '1', 'a/b']);
  s.del('known', '1');
  s.del('known', 'a/b');
  assert.deepEqual(s.getAll('known').map((k) => k.wordId), [1]);
});

test('put upserts keyed rows', () => {
  const s = openStore(':memory:');
  s.put('cards', card(1));
  s.put('cards', card(1, 3));
  assert.deepEqual(s.getAll('cards'), [card(1, 3)]);
});

test('put/del need a keyed store; unknown store names are refused', () => {
  const s = openStore(':memory:');
  assert.throws(() => s.put('reviews', { wordId: 1, timestamp: 1, grade: 'good' }), /keyed/);
  assert.throws(() => s.del('tests', 1), /keyed/);
  assert.throws(() => s.getAll('cards; DROP TABLE known'), /unknown store/);
});

test('replaceState swaps all stores', () => {
  const s = openStore(':memory:');
  s.add('known', { wordId: 9, timestamp: 1 });
  const next = { cards: [card(1)], reviews: [], tests: [], known: [{ wordId: 2, timestamp: 5 }] };
  s.replaceState(next);
  assert.deepEqual(s.loadState(), next);
});

test('replaceState rolls back on failure, keeping old data', () => {
  const s = openStore(':memory:');
  s.add('known', { wordId: 9, timestamp: 1 });
  assert.throws(() => s.replaceState({ cards: [card(1), card(1)], reviews: [], tests: [], known: [] }), ConflictError);
  assert.deepEqual(s.loadState(), { cards: [], reviews: [], tests: [], known: [{ wordId: 9, timestamp: 1 }] });
});

test('data survives closing and reopening the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nor-tutor-'));
  try {
    const path = join(dir, 'test.db');
    const a = openStore(path);
    a.add('known', { wordId: 7, timestamp: 1 });
    a.close();
    const b = openStore(path);
    assert.deepEqual(b.getAll('known'), [{ wordId: 7, timestamp: 1 }]);
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/store.test.js`
Expected: FAIL — cannot find module `../tools/store.mjs`.

- [ ] **Step 3: Create `tools/store.mjs`**

```js
import { DatabaseSync } from 'node:sqlite';
import { STORES } from '../src/backup.js';

export const KEYED = new Set(['cards', 'known']);

export class ConflictError extends Error {
  name = 'ConflictError';
}

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (word_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS known (word_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tests (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
  `);
  // Store names are interpolated into SQL, so they must come from the fixed list.
  const table = (store) => {
    if (!STORES.includes(store)) throw new Error(`unknown store: ${store}`);
    return store;
  };
  const keyed = (store) => {
    if (!KEYED.has(table(store))) throw new Error(`${store} is not a keyed store`);
    return store;
  };
  // JSON keeps 1 and '1' apart, matching how the browser compares ids.
  const key = (wordId) => JSON.stringify(wordId);

  const getAll = (store) =>
    db.prepare(`SELECT data FROM ${table(store)} ORDER BY rowid`).all().map((r) => JSON.parse(r.data));

  function add(store, row) {
    if (!KEYED.has(table(store))) {
      db.prepare(`INSERT INTO ${store} (data) VALUES (?)`).run(JSON.stringify(row));
      return;
    }
    const { changes } = db
      .prepare(`INSERT INTO ${store} (word_id, data) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(key(row.wordId), JSON.stringify(row));
    if (changes === 0) throw new ConflictError(`${store} already has word ${row.wordId}`);
  }

  const put = (store, row) => {
    db.prepare(`INSERT INTO ${keyed(store)} (word_id, data) VALUES (?, ?) ON CONFLICT (word_id) DO UPDATE SET data = excluded.data`)
      .run(key(row.wordId), JSON.stringify(row));
  };

  const del = (store, wordId) => {
    db.prepare(`DELETE FROM ${keyed(store)} WHERE word_id = ?`).run(key(wordId));
  };

  const loadState = () => Object.fromEntries(STORES.map((s) => [s, getAll(s)]));

  function replaceState(state) {
    db.exec('BEGIN');
    try {
      for (const s of STORES) db.exec(`DELETE FROM ${s}`);
      for (const s of STORES) for (const row of state[s]) add(s, row);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  return { getAll, add, put, del, loadState, replaceState, close: () => db.close() };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS (an `ExperimentalWarning` about SQLite in the output is expected).

- [ ] **Step 5: Show the diff; after the user's OK commit**

```bash
git add tools/store.mjs tests/store.test.js
git commit -m "feat: add SQLite store on node:sqlite" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: JSON API and server wiring

**Files:**
- Create: `tools/api.mjs`
- Modify: `tools/serve.mjs` (whole file), `.gitignore`, `.claude/hooks/run-tests.mjs:7` (untracked, local only)
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: `openStore`, `KEYED`, `ConflictError` (Task 2); `parseBackup`, `validRow`, `STORES` (Task 1).
- Produces: `createApi(store, origin: string)` → `async (req, res, rawPath: string) => void` (rawPath is the undecoded URL pathname starting with `/api/`). Routes: `GET /api/state`, `PUT /api/state` (body = backup object with `version`), `GET /api/:store`, `POST /api/:store` (add; 409 on conflict), `PUT /api/:store` (keyed only), `DELETE /api/:store/:key` (keyed only; key = `encodeURIComponent(JSON.stringify(wordId))`). Errors: JSON `{ error }`.

- [ ] **Step 1: Write the failing test** `tests/api.test.js`

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { openStore } from '../tools/store.mjs';
import { createApi } from '../tools/api.mjs';

let server, port, origin;

before(async () => {
  let api;
  server = createServer((req, res) => api(req, res, new URL(req.url, 'http://x').pathname));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  api = createApi(openStore(':memory:'), origin);
});
after(() => server.close());

function call(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: { origin, 'content-type': 'application/json', ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : undefined }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

const empty = { cards: [], reviews: [], tests: [], known: [] };
const reset = () => call('PUT', '/api/state', { body: { version: 2, ...empty } });
const card = (wordId, reps = 0) => ({ wordId, ease: 2.5, interval: 0, reps, lapses: 0, due: 1 });
const keyPath = (store, id) => `/api/${store}/${encodeURIComponent(JSON.stringify(id))}`;

test('state starts empty', async () => {
  assert.equal((await reset()).status, 204);
  assert.deepEqual(await call('GET', '/api/state'), { status: 200, body: empty });
});

test('add, conflict, list and delete a known word with a slash in its id (Review Focus 2)', async () => {
  await reset();
  const row = { wordId: 'a/b', timestamp: 1 };
  assert.equal((await call('POST', '/api/known', { body: row })).status, 204);
  assert.equal((await call('POST', '/api/known', { body: row })).status, 409);
  assert.deepEqual((await call('GET', '/api/known')).body, [row]);
  assert.equal((await call('DELETE', keyPath('known', 'a/b'))).status, 204);
  assert.deepEqual((await call('GET', '/api/known')).body, []);
});

test('put upserts a card; put on reviews and delete on tests are not allowed', async () => {
  await reset();
  await call('PUT', '/api/cards', { body: card(1) });
  await call('PUT', '/api/cards', { body: card(1, 4) });
  assert.deepEqual((await call('GET', '/api/cards')).body, [card(1, 4)]);
  assert.equal((await call('PUT', '/api/reviews', { body: { wordId: 1, timestamp: 1, grade: 'good' } })).status, 405);
  assert.equal((await call('DELETE', keyPath('tests', 1))).status, 405);
});

test('rejects invalid rows, bad JSON, unknown stores and bad keys', async () => {
  assert.equal((await call('POST', '/api/known', { body: { wordId: 1 } })).status, 400);
  assert.equal((await call('POST', '/api/known', { body: '{oops' })).status, 400);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('DELETE', '/api/known/%7Bnot-json')).status, 400);
});

test('rejects other hosts, other origins and non-JSON bodies (Review Focus 1)', async () => {
  const row = { wordId: 5, timestamp: 1 };
  const wrongHost = await call('GET', '/api/state', { headers: { host: `localhost:${port}` } });
  assert.equal(wrongHost.status, 403);
  assert.match(wrongHost.body.error, /127\.0\.0\.1/);
  assert.equal((await call('POST', '/api/known', { body: row, headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/api/known', { body: row, headers: { 'content-type': 'text/plain' } })).status, 415);
});

test('PUT /api/state validates the whole backup and changes nothing on error (Review Focus 5)', async () => {
  await reset();
  await call('POST', '/api/known', { body: { wordId: 9, timestamp: 1 } });
  const bad = await call('PUT', '/api/state', { body: { version: 2, ...empty, cards: [card(1), card(1)] } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Duplicate card/);
  assert.deepEqual((await call('GET', '/api/known')).body, [{ wordId: 9, timestamp: 1 }]);
  assert.equal((await call('PUT', '/api/state', { body: { version: 1, cards: [card(1)], reviews: [], tests: [] } })).status, 204);
  assert.deepEqual((await call('GET', '/api/state')).body, { ...empty, cards: [card(1)] });
});

test('oversized bodies are refused', async () => {
  const big = JSON.stringify({ wordId: 1, timestamp: 1, pad: 'x'.repeat(5 * 1024 * 1024) });
  assert.equal((await call('POST', '/api/known', { body: big })).status, 413);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/api.test.js`
Expected: FAIL — cannot find module `../tools/api.mjs`.

- [ ] **Step 3: Create `tools/api.mjs`**

```js
import { parseBackup, validRow, STORES } from '../src/backup.js';
import { KEYED, ConflictError } from './store.mjs';

const MAX_BODY = 5 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk); // keep draining so the client gets the 413 instead of a reset
  }
  if (size > MAX_BODY) throw new HttpError(413, 'Request body is too large');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

function parseKey(segment) {
  let key;
  try {
    key = JSON.parse(decodeURIComponent(segment));
  } catch {
    throw new HttpError(400, 'Bad key');
  }
  if (typeof key !== 'number' && typeof key !== 'string') throw new HttpError(400, 'Bad key');
  return key;
}

// Host check stops DNS rebinding; Origin + JSON content type stop other websites from writing.
export function createApi(store, origin) {
  const host = new URL(origin).host;
  return async function handleApi(req, res, rawPath) {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      if (req.headers.host !== host) throw new HttpError(403, `Open the app at ${origin}`);
      if (req.method !== 'GET' && req.headers.origin !== origin) throw new HttpError(403, 'Request from another site refused');
      const [name, keySegment, ...rest] = rawPath.slice('/api/'.length).split('/');
      if (rest.length) throw new HttpError(404, 'Not found');

      if (name === 'state' && keySegment === undefined) {
        if (req.method === 'GET') return send(200, store.loadState());
        if (req.method !== 'PUT') throw new HttpError(405, 'Method not allowed');
        const body = await readJson(req);
        let state;
        try {
          state = parseBackup(JSON.stringify(body));
        } catch (e) {
          throw new HttpError(400, e.message);
        }
        store.replaceState(state);
        return send(204);
      }

      if (!STORES.includes(name)) throw new HttpError(404, 'Not found');
      if (keySegment !== undefined) {
        if (req.method !== 'DELETE' || !KEYED.has(name)) throw new HttpError(405, 'Method not allowed');
        store.del(name, parseKey(keySegment));
        return send(204);
      }
      if (req.method === 'GET') return send(200, store.getAll(name));
      if (req.method !== 'POST' && !(req.method === 'PUT' && KEYED.has(name))) throw new HttpError(405, 'Method not allowed');
      const row = await readJson(req);
      if (!validRow(name, row)) throw new HttpError(400, `Invalid ${name} row`);
      if (req.method === 'POST') store.add(name, row);
      else store.put(name, row);
      return send(204);
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      if (e instanceof ConflictError) return send(409, { error: e.message });
      console.error(e);
      return send(500, { error: 'Internal error' });
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/api.test.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Replace `tools/serve.mjs`**

Static serving switches to an extension allow-list, which also guarantees the `.db` file (and Windows aliases like `nor-tutor.db.` or `nor-tutor.db::$DATA`) is never served.

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { createApi } from './api.mjs';

const HOST = '127.0.0.1';
const PORT = 5173;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const api = createApi(openStore(join(root, 'data', 'nor-tutor.db')), `http://${HOST}:${PORT}`);

createServer(async (req, res) => {
  let file;
  try {
    const rawPath = new URL(req.url, 'http://localhost').pathname;
    if (rawPath.startsWith('/api/')) return await api(req, res, rawPath);
    const path = decodeURIComponent(rawPath);
    if (path.split('/').some((s) => s.startsWith('.'))) {
      res.writeHead(404).end('Not found');
      return;
    }
    file = resolve(join(root, normalize(path === '/' ? '/index.html' : path)));
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  // Only known asset types are served: keeps data/nor-tutor.db and its journal files private.
  const type = types[extname(file).toLowerCase()];
  if (!type) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': type }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, HOST, () => console.log(`http://${HOST}:${PORT}`));
```

- [ ] **Step 6: Ignore the database.** Append to `.gitignore`:

```
data/nor-tutor.db*
```

- [ ] **Step 7: Make the local test hook watch `tools/*.mjs` too.** In `.claude/hooks/run-tests.mjs` (untracked) replace line 7's regex:

```js
if (!/[\\/](src|tests|tools)[\\/].*\.m?js$/.test(file)) process.exit(0);
```

- [ ] **Step 8: Smoke-test the server**

Run: `npm start` in the background, then
`curl -s http://127.0.0.1:5173/api/state` → `{"cards":[],"reviews":[],"tests":[],"known":[]}`
`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/data/nor-tutor.db` → `404`
`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/` → `200`
Stop the server. Then `npm test` → all PASS.

- [ ] **Step 9: Show the diff; after the user's OK commit**

```bash
git add tools/api.mjs tools/serve.mjs tests/api.test.js .gitignore
git commit -m "feat: serve progress from SQLite through a localhost JSON API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Browser db layer over the API, one-time migration

**Files:**
- Modify: `src/db.js` (whole file), `src/app.js:26-35` (after `openDb`), `styles.css` (append `.notice`)

**Interfaces:**
- Consumes: API routes (Task 3); `BACKUP_VERSION`, `STORES` (Task 1).
- Produces (same names as before, plus `del`): `openDb(): Promise<{ notice: string|null }>`; `getAll(db, store)`; `add(db, store, obj)` (rejects with `err.name === 'ConstraintError'` on 409); `put(db, store, obj)`; `del(db, store, wordId)`; `loadState(db): { cards, reviews, tests, known }`; `replaceState(db, { cards, reviews, tests, known })`.

- [ ] **Step 1: Replace `src/db.js`**

```js
import { BACKUP_VERSION, STORES } from './backup.js';

const OLD_DB = 'nor-tutor'; // IndexedDB name used before the SQLite switch

async function api(method, path, body) {
  const init = body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init).catch(() => {
    throw new Error('Cannot reach the local server. Start it with npm start and open http://127.0.0.1:5173');
  });
  if (res.ok) return res.status === 204 ? undefined : res.json();
  const err = new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  if (res.status === 409) err.name = 'ConstraintError'; // the name IndexedDB used; views rely on it
  throw err;
}

export const getAll = (db, store) => api('GET', `/api/${store}`);
export const add = (db, store, obj) => api('POST', `/api/${store}`, obj);
export const put = (db, store, obj) => api('PUT', `/api/${store}`, obj);
export const del = (db, store, wordId) => api('DELETE', `/api/${store}/${encodeURIComponent(JSON.stringify(wordId))}`);
export const loadState = (db) => api('GET', '/api/state');
export const replaceState = (db, state) => api('PUT', '/api/state', { version: BACKUP_VERSION, ...state });

// On first run after the switch, copy the old IndexedDB data into SQLite once. The old data is left in place.
export async function openDb() {
  const db = { notice: null };
  const state = await loadState(db);
  if (STORES.some((s) => state[s].length > 0)) return db;
  const dbs = (await indexedDB.databases?.()) ?? [];
  if (!dbs.some((d) => d.name === OLD_DB)) return db;
  try {
    const old = await readOldDb();
    if (old.cards.length + old.reviews.length + old.tests.length === 0) return db;
    await replaceState(db, { ...old, known: [] });
    db.notice = `Moved your progress (${old.cards.length} cards, ${old.reviews.length} reviews, ${old.tests.length} tests) from the browser into data/nor-tutor.db.`;
  } catch (e) {
    db.notice = `Could not move your old browser data yet (${e.message}). It is still in the browser; the move will be retried next time.`;
  }
  return db;
}

function readOldDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OLD_DB);
    req.onupgradeneeded = () => req.transaction.abort(); // never create or change the old database
    req.onerror = () => reject(req.error ?? new Error('could not open old browser data'));
    req.onsuccess = () => {
      const idb = req.result;
      const out = { cards: [], reviews: [], tests: [] };
      const names = Object.keys(out).filter((n) => idb.objectStoreNames.contains(n));
      if (names.length === 0) {
        idb.close();
        resolve(out);
        return;
      }
      const t = idb.transaction(names);
      for (const n of names) {
        const r = t.objectStore(n).getAll();
        r.onsuccess = () => (out[n] = r.result);
      }
      t.oncomplete = () => {
        idb.close();
        resolve(out);
      };
      t.onerror = () => {
        idb.close();
        reject(t.error);
      };
    };
  });
}
```

- [ ] **Step 2: Show the migration notice.** In `src/app.js`, directly after the `if (errors.length) throw …` line, add:

```js
    if (db.notice) document.body.insertBefore(h('p', { class: 'notice', role: 'status' }, db.notice), document.getElementById('app'));
```

Append to `styles.css`:

```css
.notice { margin: 0; padding: 8px 16px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--accent) 14%, var(--card)); }
```

- [ ] **Step 3: Verify**

Run: `npm test` → all PASS. Start `npm start`, open `http://127.0.0.1:5173` in the browser (Playwright): every page loads with no console errors; on Words click "Add to review deck" on one word, reload → still "In your deck"; `curl -s http://127.0.0.1:5173/api/cards` shows the card. Remove that test card afterwards with `PUT /api/state` from the Data page import only if the user wants a clean DB (ask).

- [ ] **Step 4: Show the diff; after the user's OK commit**

```bash
git add src/db.js src/app.js styles.css
git commit -m "feat: browser storage goes through the SQLite API, with one-time IndexedDB migration" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Word status, filters and triage order (pure)

**Files:**
- Modify: `src/search.js` (append)
- Test: `tests/search.test.js` (append)

**Interfaces:**
- Produces: `wordStatus(id, known: Set, inDeck: Set): 'known'|'deck'|'unmarked'` (known wins over deck); `filterWords(words, query, filter: 'all'|'unmarked'|'known'|'deck', known, inDeck, limit = 50)` (search order from `searchWords`; pass `Infinity` for no limit — this is also the triage queue); `countByFilter(words, known, inDeck): { all, unmarked, known, deck }`.

- [ ] **Step 1: Write the failing tests.** Change the import in `tests/search.test.js` to

```js
import { searchWords, filterWords, countByFilter, wordStatus } from '../src/search.js';
```

and append:

```js
const known = new Set([2]); // ære
const inDeck = new Set([2, 3]); // ære (known wins), ørret

test('wordStatus: known wins over in deck', () => {
  assert.equal(wordStatus(2, known, inDeck), 'known');
  assert.equal(wordStatus(3, known, inDeck), 'deck');
  assert.equal(wordStatus(1, known, inDeck), 'unmarked');
});

test('countByFilter splits all words into unmarked, known and deck', () => {
  assert.deepEqual(countByFilter(words, known, inDeck), { all: 6, unmarked: 4, known: 1, deck: 1 });
});

test('filterWords combines status filter with search and limit', () => {
  assert.deepEqual(lemmas(filterWords(words, '', 'unmarked', known, inDeck)), ['hus', 'åpen', 'forhus', 'bolig']);
  assert.deepEqual(lemmas(filterWords(words, 'hus', 'unmarked', known, inDeck)), ['hus', 'forhus', 'bolig']);
  assert.deepEqual(lemmas(filterWords(words, '', 'known', known, inDeck)), ['ære']);
  assert.deepEqual(lemmas(filterWords(words, '', 'deck', known, inDeck)), ['ørret']);
  assert.deepEqual(lemmas(filterWords(words, '', 'all', known, inDeck, 2)), ['hus', 'ære']);
});

test('triage queue: every unmarked word by rank, no limit', () => {
  const many = Array.from({ length: 120 }, (_, i) => w(i + 1, `ord${i + 1}`));
  const q = filterWords(many, '', 'unmarked', new Set([1]), new Set(), Infinity);
  assert.equal(q.length, 119);
  assert.equal(q[0].lemma, 'ord2');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/search.test.js`
Expected: FAIL — `filterWords` is not exported.

- [ ] **Step 3: Append to `src/search.js`**

```js
export const wordStatus = (id, known, inDeck) => (known.has(id) ? 'known' : inDeck.has(id) ? 'deck' : 'unmarked');

export function filterWords(words, query, filter, known, inDeck, limit = 50) {
  const pool = filter === 'all' ? words : words.filter((w) => wordStatus(w.id, known, inDeck) === filter);
  return searchWords(pool, query, limit);
}

export function countByFilter(words, known, inDeck) {
  const counts = { all: words.length, unmarked: 0, known: 0, deck: 0 };
  for (const w of words) counts[wordStatus(w.id, known, inDeck)]++;
  return counts;
}
```

- [ ] **Step 4: Run tests** — `npm test` → all PASS.

- [ ] **Step 5: Show the diff; after the user's OK commit**

```bash
git add src/search.js tests/search.test.js
git commit -m "feat: word status filters and counts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Words page redesign with known marking, keys and triage

**Files:**
- Modify: `src/views/explore.js` (whole file), `styles.css` (palette + append)

**Interfaces:**
- Consumes: `getAll`, `add`, `del` (Task 4); `filterWords`, `countByFilter`, `wordStatus` (Task 5); `newCard` (`src/srs.js`); `h` (`src/dom.js` — note `class: null` would become the string "null", so pass `''`).

- [ ] **Step 1: Replace `src/views/explore.js`**

```js
import { h } from '../dom.js';
import { filterWords, countByFilter, wordStatus } from '../search.js';
import { getAll, add, del } from '../db.js';
import { newCard } from '../srs.js';

// shortcut: the list shows the first 200 matches; add paging if the full word list makes this feel cut off
const LIST_LIMIT = 200;
const FILTERS = [['all', 'All'], ['unmarked', 'Unmarked'], ['known', 'Known'], ['deck', 'In deck']];
const kbd = (k) => h('kbd', {}, k);
const badge = (status) => h('span', { class: `badge ${status}` }, status === 'known' ? 'Known' : 'In deck');

export async function render(root, { words, db }) {
  const [cards, knownRows] = await Promise.all([getAll(db, 'cards'), getAll(db, 'known')]);
  const inDeck = new Set(cards.map((c) => c.wordId));
  const known = new Set(knownRows.map((k) => k.wordId));
  const busy = new Set(); // word ids with a save in flight; set synchronously to block double activation
  let filter = 'all';
  let results = [];
  let sel = 0;
  let triageKey = null; // key handler while triage mode is open

  const errorBox = h('div', { role: 'alert' });
  const fail = (e, what) => errorBox.replaceChildren(h('p', { class: 'error' }, `Could not ${what} (${e.message}). Please try again.`));

  const search = h('input', { type: 'search', placeholder: 'Search Norwegian or English…', 'aria-label': 'Search words (shortcut /)' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' });
  const list = h('ul', { class: 'word-list', 'aria-label': 'Words' });
  const detail = h('div', { class: 'detail' });
  const triageBtn = h('button', { onclick: () => startTriage() }, 'Triage unmarked ▶');
  const listView = h('div', {},
    search,
    chips,
    h('div', { class: 'panes' }, list, detail),
    h('p', { class: 'muted keys' },
      kbd('↑'), kbd('↓'), ' move · ', kbd('Enter'), ' show · ', kbd('K'), ' I know it · ',
      kbd('A'), ' add to deck · ', kbd('/'), ' search · ', kbd('Esc'), ' leave search'),
  );
  const triageView = h('div', { hidden: true });

  // Returns true when the word ends up in the requested state.
  async function setKnown(w, value) {
    if (busy.has(w.id)) return false;
    if (known.has(w.id) === value) return true;
    busy.add(w.id);
    value ? known.add(w.id) : known.delete(w.id);
    errorBox.replaceChildren();
    refresh();
    try {
      if (value) await add(db, 'known', { wordId: w.id, timestamp: Date.now() });
      else await del(db, 'known', w.id);
      return true;
    } catch (e) {
      if (value && e?.name === 'ConstraintError') return true; // already marked elsewhere
      value ? known.delete(w.id) : known.add(w.id);
      fail(e, value ? 'mark this word as known' : 'unmark this word');
      return false;
    } finally {
      busy.delete(w.id);
      refresh();
    }
  }

  async function addToDeck(w) {
    if (busy.has(w.id)) return false;
    if (inDeck.has(w.id)) return true;
    busy.add(w.id);
    inDeck.add(w.id);
    errorBox.replaceChildren();
    refresh();
    try {
      // add() (not put) so a card created elsewhere is never overwritten.
      await add(db, 'cards', newCard(w.id, Date.now()));
      return true;
    } catch (e) {
      if (e?.name === 'ConstraintError') return true; // already in the deck (added elsewhere)
      inDeck.delete(w.id);
      fail(e, 'add this word to your deck');
      return false;
    } finally {
      busy.delete(w.id);
      refresh();
    }
  }

  function refresh() {
    if (triageKey) return; // the list is redrawn when triage closes
    const counts = countByFilter(words, known, inDeck);
    results = filterWords(words, search.value, filter, known, inDeck, LIST_LIMIT);
    sel = Math.max(0, Math.min(sel, results.length - 1));
    chips.replaceChildren(...FILTERS.map(([key, label]) =>
      h('button', { class: 'chip', 'aria-pressed': String(filter === key), onclick: () => { filter = key; sel = 0; refresh(); } },
        label, h('span', { class: 'count' }, counts[key]))));
    const hadFocus = list.contains(document.activeElement);
    list.replaceChildren(...(results.length === 0
      ? [h('li', { class: 'muted empty' }, 'No matching words.')]
      : results.map(row)));
    const current = list.querySelector('.selected');
    current?.scrollIntoView({ block: 'nearest' });
    if (hadFocus) current?.querySelector('.word-main')?.focus();
    showDetail(results[sel]);
  }

  function row(w, i) {
    const status = wordStatus(w.id, known, inDeck);
    return h('li', { class: i === sel ? 'selected' : '' },
      h('button', { class: 'word-main', 'aria-current': i === sel ? 'true' : null, onclick: () => { sel = i; refresh(); } },
        h('span', { class: 'lemma', lang: 'nb' }, w.lemma),
        h('span', { class: 'pos' }, w.pos),
        h('span', { class: 'gloss' }, w.gloss_en)),
      status === 'unmarked'
        ? h('button', { class: 'tick', title: 'I know it', 'aria-label': `Mark ${w.lemma} as known`, disabled: busy.has(w.id), onclick: () => setKnown(w, true) }, '✓')
        : badge(status));
  }

  function showDetail(w) {
    if (!w) {
      detail.replaceChildren(h('div', { class: 'card muted' }, 'No word selected.'), errorBox);
      return;
    }
    const isKnown = known.has(w.id);
    const status = wordStatus(w.id, known, inDeck);
    detail.replaceChildren(h('article', { class: 'card word-detail' },
      h('header', {}, h('h2', { lang: 'nb' }, w.lemma), h('span', { class: 'pos' }, w.pos), status === 'unmarked' ? null : badge(status)),
      h('p', { class: 'gloss-big' }, w.gloss_en),
      h('p', { lang: 'nb' }, w.def_no),
      w.forms.length ? h('p', {}, h('span', { class: 'muted' }, 'Forms: '), h('span', { lang: 'nb' }, w.forms.join(' · '))) : null,
      w.notes ? h('p', { class: 'notes', lang: 'nb' }, w.notes) : null,
      w.collocations.length
        ? h('section', {}, h('h3', {}, 'Common phrases'), h('div', { class: 'chips' }, w.collocations.map((c) => h('span', { class: 'chip', lang: 'nb' }, c))))
        : null,
      h('h3', {}, 'Examples'),
      w.examples.map((e) => h('blockquote', {}, h('p', { lang: 'nb' }, e.no), h('p', { class: 'muted' }, e.en))),
      h('div', { class: 'row actions' },
        h('button', { class: isKnown ? '' : 'primary', disabled: busy.has(w.id), onclick: () => setKnown(w, !isKnown) },
          isKnown ? 'Unmark known' : '✓ I know it', kbd('K')),
        h('button', { disabled: busy.has(w.id) || inDeck.has(w.id) || isKnown, onclick: () => addToDeck(w) },
          inDeck.has(w.id) ? 'In deck' : '+ Add to deck', kbd('A'))),
      errorBox,
    ));
  }

  function startTriage() {
    const queue = filterWords(words, '', 'unmarked', known, inDeck, Infinity);
    let i = 0;
    let revealed = false;
    let acting = false;
    const reveal = () => { revealed = true; show(); };
    const act = async (what) => {
      if (acting || i >= queue.length) return;
      acting = true;
      const w = queue[i];
      const ok = what === 'skip' || (what === 'known' ? await setKnown(w, true) : await addToDeck(w));
      acting = false;
      if (!ok) return; // error is shown, card stays
      i++;
      revealed = false;
      errorBox.replaceChildren();
      show();
    };

    function show() {
      if (i >= queue.length) {
        triageView.replaceChildren(h('div', { class: 'card triage', tabindex: '-1' },
          h('h2', {}, 'All done'),
          h('p', {}, queue.length ? `You went through ${queue.length} unmarked word(s).` : 'There are no unmarked words.'),
          h('button', { class: 'primary', onclick: stopTriage }, 'Back to the list')));
        triageView.firstChild.focus();
        return;
      }
      const w = queue[i];
      triageView.replaceChildren(h('div', { class: 'card triage', tabindex: '-1' },
        h('p', { class: 'muted' }, `${i + 1} / ${queue.length}`),
        h('div', { class: 'big', lang: 'nb' }, w.lemma),
        h('p', { class: 'muted' }, w.pos),
        revealed
          ? h('div', {}, h('p', { class: 'gloss-big' }, w.gloss_en), h('p', { lang: 'nb' }, w.def_no))
          : h('button', { onclick: reveal }, 'Show meaning', kbd('Space')),
        h('div', { class: 'row actions' },
          h('button', { class: 'primary', onclick: () => act('known') }, '✓ I know it', kbd('K')),
          h('button', { onclick: () => act('deck') }, '+ Add to deck', kbd('A')),
          h('button', { onclick: () => act('skip') }, 'Skip', kbd('S'))),
        h('button', { class: 'link', onclick: stopTriage }, 'Back to the list', kbd('Esc')),
        errorBox));
      triageView.firstChild.focus(); // keeps Space away from whichever button was clicked
    }

    triageKey = (key) => {
      if (key === 'Escape') stopTriage();
      else if (key === ' ') { if (!revealed) reveal(); }
      else if (key === 'k') act('known');
      else if (key === 'a') act('deck');
      else if (key === 's' || key === 'ArrowRight') act('skip');
      else return false;
      return true;
    };
    listView.hidden = true;
    triageBtn.hidden = true;
    triageView.hidden = false;
    errorBox.replaceChildren();
    show();
  }

  function stopTriage() {
    triageKey = null;
    triageView.hidden = true;
    triageView.replaceChildren();
    listView.hidden = false;
    triageBtn.hidden = false;
    errorBox.replaceChildren();
    refresh();
    triageBtn.focus();
  }

  function listKey(key) {
    const w = results[sel];
    if (key === '/') search.focus();
    else if (key === 'ArrowDown' || key === 'ArrowUp') { sel += key === 'ArrowDown' ? 1 : -1; refresh(); }
    else if (key === 'Enter') detail.scrollIntoView({ block: 'nearest' });
    else if (key === 'k' && w) setKnown(w, !known.has(w.id));
    else if (key === 'a' && w && !known.has(w.id)) addToDeck(w);
    else return false;
    return true;
  }

  function onKey(e) {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; } // navigated away
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return; // native button activation
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ((triageKey ?? listKey)(key)) e.preventDefault();
  }

  search.addEventListener('input', () => { sel = 0; refresh(); });
  document.addEventListener('keydown', onKey);
  root.replaceChildren(h('div', { class: 'words-page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Words'), triageBtn),
    listView,
    triageView,
  ));
  refresh();
}
```

- [ ] **Step 2: Styles.** In `styles.css` add `--good: #2e7d4f;` to the light `:root` and `--good: #7fd1a0;` to the dark `:root`, then append:

```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
main:has(.words-page) { max-width: 1100px; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.chip { display: inline-block; padding: 3px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); font-size: .9rem; }
button.chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.chip .count { margin-left: 6px; opacity: .75; }
.panes { display: grid; grid-template-columns: minmax(240px, 1fr) 1.5fr; gap: 16px; align-items: start; }
.word-list { list-style: none; margin: 0; padding: 0; max-height: 70vh; overflow: auto; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
.word-list li { display: flex; align-items: center; gap: 6px; padding: 2px 8px 2px 2px; border-bottom: 1px solid var(--line); }
.word-list li:last-child { border-bottom: 0; }
.word-list li.selected { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.word-list li.empty { padding: 12px; }
.word-main { flex: 1; min-width: 0; text-align: left; border: 0; background: none; padding: 6px 8px; }
.word-main .lemma { font-weight: 600; }
.word-main .pos { margin-left: 8px; color: var(--muted); font-size: .8rem; }
.word-main .gloss { display: block; color: var(--muted); font-size: .85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tick { padding: 2px 10px; }
.badge { font-size: .75rem; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.badge.known { color: var(--good); border-color: var(--good); }
.detail { position: sticky; top: 12px; }
.detail .card { margin-top: 0; }
.word-detail header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; }
.word-detail h2 { margin: 0; font-size: 2rem; }
.pos { color: var(--muted); }
.gloss-big { font-size: 1.15rem; font-weight: 600; }
.notes { font-style: italic; }
blockquote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid var(--accent); background: var(--bg); border-radius: 0 6px 6px 0; }
blockquote p { margin: 2px 0; }
.actions { margin-top: 16px; }
kbd { margin-left: 8px; padding: 0 5px; font: .75rem ui-monospace, monospace; border: 1px solid currentColor; border-bottom-width: 2px; border-radius: 4px; opacity: .7; }
.keys kbd { margin: 0 2px; }
.triage { max-width: 520px; margin: 24px auto; text-align: center; }
.triage:focus { outline: none; }
.triage .actions { justify-content: center; }
button.link { margin-top: 12px; border: 0; background: none; color: var(--accent); text-decoration: underline; }
@media (max-width: 720px) {
  .panes { grid-template-columns: 1fr; }
  .detail { position: static; }
  .word-list { max-height: 45vh; }
}
```

- [ ] **Step 3: Verify in the browser (Playwright at 1280×800 and 400×800, light and dark)**

Run: `npm test` → PASS. Start `npm start`, open `http://127.0.0.1:5173/#/explore`, check:
1. Two panes, chips show counts that add up to All; the first word is selected and shown.
2. ↑/↓ moves the selection and the detail follows; `/` focuses search, typing filters, `Esc` leaves it and keys work again.
3. Click ✓ on a row → badge "Known", Known count +1; reload → still known (stored in SQLite: `curl -s http://127.0.0.1:5173/api/known`).
4. **Review Focus 3:** with "Unmarked" selected, press `K` repeatedly until no unmarked words remain → each press moves to the next word; at the end the list shows "No matching words." and the detail "No word selected."; no console errors.
5. **Review Focus 4:** press `K` twice very fast on one word → exactly one row in `/api/known` (or none, after a toggle back), UI badge matches. Stop the server and press `K` → red error under the buttons, state rolls back; restart the server.
6. `A` adds to deck (button becomes "In deck"); on a known word `A` does nothing and the button is disabled.
7. Triage: "Triage unmarked ▶" → progress "1 / N", `Space` reveals meaning, `K`/`A`/`S` advance, `Esc` returns to the list with counts updated; done screen at the end.
8. At 400px wide the panes stack; Tab shows a visible focus ring on rows, chips and buttons.
9. Navigate to Dashboard and press `K` → nothing happens there (listener removed), no errors.
Afterwards restore the user's DB state if test marks should not stay (ask the user).

- [ ] **Step 4: Show the diff and a screenshot; after the user's OK commit**

```bash
git add src/views/explore.js styles.css
git commit -m "feat: two-pane Words page with I-know-it marking, keyboard shortcuts and triage" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Review skips known words; dashboard and data page show known

**Files:**
- Modify: `src/views/review.js:7-20`, `src/views/dashboard.js:11-25`, `src/views/data.js:5,52`

**Interfaces:**
- Consumes: `getAll(db, 'known')`, `loadState(db).known` (Task 4).

- [ ] **Step 1: `src/views/review.js`.** Replace `const cards = await getAll(db, 'cards');` with

```js
  const [cards, knownRows] = await Promise.all([getAll(db, 'cards'), getAll(db, 'known')]);
  const known = new Set(knownRows.map((k) => k.wordId)); // known words stay in the deck but are not reviewed
```

change the empty-deck text `' and choose "Add to review deck".'` to `' and choose "+ Add to deck".'`, and change the queue line to

```js
  const queue = dueCards(cards, Date.now()).filter((c) => byId.has(c.wordId) && !known.has(c.wordId));
```

- [ ] **Step 2: `src/views/dashboard.js`.** Change the signature and first line to

```js
export async function render(root, { words, db }) {
  const { reviews, tests, known } = await loadState(db);
```

and insert after the "Estimated vocabulary" tile:

```js
    tile('Marked known', String(known.length), `${Math.round((known.length / words.length) * 100)}% of ${fmt(words.length)} words in the list`),
```

- [ ] **Step 3: `src/views/data.js`.** Change `counts` to

```js
const counts = (d) => `${d.cards.length} cards, ${d.reviews.length} reviews, ${d.tests.length} tests, ${d.known.length} known words`;
```

and the intro text to `'Your progress is stored in data/nor-tutor.db on this computer. Export a backup regularly.'`

- [ ] **Step 4: Verify in the browser.** `npm test` → PASS. With one word in the deck and due, mark it known on Words → Review says nothing is due; unmark → it is due again with its old schedule. Dashboard shows "Marked known" with the right count and %. Data: export → file has `"version": 2` and `known`; import a v1 backup from before the change → succeeds, confirm dialog lists "0 known words" for the file.

- [ ] **Step 5: Show the diff; after the user's OK commit**

```bash
git add src/views/review.js src/views/dashboard.js src/views/data.js
git commit -m "feat: review skips known words; dashboard and data page count them" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs and end-to-end check

**Files:**
- Modify: `README.md`, `CLAUDE.md` (currently untracked from `/init` — ask the user whether to commit it, together with `.claude/`, in this task)

- [ ] **Step 1: `README.md`.** Replace the lines

```
- `npm test` runs the unit tests (Node 20+)

Your data lives in your browser (IndexedDB). Use the Data page to export a JSON backup.
```

with

```
- `npm test` runs the unit tests (Node 22.13+)

Your progress lives in `data/nor-tutor.db` (SQLite, through Node's built-in `node:sqlite`; Node prints an "ExperimentalWarning: SQLite" line on start, which is expected). Use the Data page to export a JSON backup.
```

and replace the first "Good to know" bullet (data per browser origin) with

```
- Open the app at http://127.0.0.1:5173. The server refuses other addresses such as http://localhost:5173 on purpose, so other websites cannot reach your data.
- The first start after the SQLite switch copies any progress from the browser (IndexedDB) into `data/nor-tutor.db` once and shows a notice. The browser copy is left untouched.
```

In the Pages list change the Words line to `- **Words** – search and filter, meanings, forms, phrases, examples; mark words "I know it" (✓, K key, or triage mode)`.

- [ ] **Step 2: `CLAUDE.md`.** Replace the second Constraints bullet with

```
- User data lives in SQLite `data/nor-tutor.db` via built-in `node:sqlite` (Node ≥ 22.13): `tools/store.mjs` (tables) + `tools/api.mjs` (JSON API, Host/Origin/Content-Type checks — keep them), served by `tools/serve.mjs`. The browser only talks to it through `src/db.js`. Row rules live in `validRow`/`STORES` in `src/backup.js`, shared by backup import and the API.
```

In Testing, add `store and api (tools/*.mjs, against ':memory:' and an ephemeral port)` to the list of unit-tested modules. In Gotchas replace the 127.0.0.1 bullet with

```
- Always open http://127.0.0.1:5173: the API answers 403 for any other Host (localhost included) by design.
```

- [ ] **Step 3: End-to-end check, including migration (Review Focus 1)**

1. `npm test` → all PASS.
2. Stop the server. Rename `data/nor-tutor.db` to `data/nor-tutor.db.bak`. Start `npm start`.
3. In Playwright on `http://127.0.0.1:5173`, run in the page:
   ```js
   await new Promise((ok, ko) => { const r = indexedDB.open('nor-tutor', 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('cards', { keyPath: 'wordId' }); d.createObjectStore('reviews', { autoIncrement: true }); d.createObjectStore('tests', { autoIncrement: true }); }; r.onsuccess = () => { const t = r.result.transaction('cards', 'readwrite'); t.objectStore('cards').put({ wordId: 1, ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0 }); t.oncomplete = () => { r.result.close(); ok(); }; t.onerror = ko; }; r.onerror = ko; });
   ```
   Reload → notice "Moved your progress (1 cards, 0 reviews, 0 tests)…"; Review shows the card. Reload again → no notice.
4. Open `http://localhost:5173` → error text says to open http://127.0.0.1:5173.
5. Stop the server, delete the test `data/nor-tutor.db`, rename `data/nor-tutor.db.bak` back. Start again and confirm the user's data is there.

- [ ] **Step 4: Show the diff; after the user's OK commit**

```bash
git add README.md
git commit -m "docs: SQLite storage, known words, Node 22.13+" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `CLAUDE.md .claude/` to `git add` only if the user agreed in this task.)

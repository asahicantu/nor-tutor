# Gamified Dashboard and Design Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a vivid design foundation and derived gamification (XP, levels, streak, daily quest, badges) to the Dashboard, nav and Review completion screen, persisting earned badges in the existing SQLite database.

**Architecture:** A pure `src/gamify.js` derives XP/level/streak/quest/badges from `loadState()` data. One new keyed SQLite table `awards` (backup v4) records when each badge was first earned. A small DOM helper module `src/gamui.js` holds the ring, XP bar, toast, badge tile, claim and reward helpers; views and `styles.css` consume it.

**Tech Stack:** Plain ES modules (no build, no dependencies), `node:sqlite` via `tools/store.mjs`, `node:test`, Chart.js from CDN (optional).

**Spec:** `docs/superpowers/specs/2026-10-10-design-foundation-dashboard-design.md`

## Base state (read first)

This plan was written against the **main checkout's working tree**, which has uncommitted work (`src/wordstatus.js`, `src/actions.js`, phrases/grammar views, store/api tests, `tools/store.mjs`, `tools/api.mjs`, SQLite `src/db.js`). A worktree created from `HEAD` does **not** contain it. **Before Task 1, the user must commit (or otherwise carry over) that working tree** and the executor must branch from it. If `tools/store.mjs` does not exist in the executor's checkout, stop and ask.

## Global Constraints

- Zero dependencies, no build step, no TypeScript; plain ES modules loaded by the browser. Chart.js stays an optional CDN global (charts degrade to a notice offline).
- All user data in SQLite via `/api/` (`tools/store.mjs`, `src/db.js`); no new server routes, no runtime API calls.
- Unit-test only pure modules (`gamify`, `backup`, `stats`, `store`, `api`). Browser modules (`app.js`, `db.js`, `dom.js`, `charts.js`, `gamui.js`, `views/`) are checked manually via `npm start` at http://127.0.0.1:5173.
- Tests use fixed `Date.UTC(...)` timestamps; never `Date.now()` or `Math.random()` in tests.
- Backup import (`src/backup.js`) is a trust boundary: keep strict validation, bump `BACKUP_VERSION` (3 → 4).
- Word ids are join keys: never renumber or reuse.
- Meaning is never carried by colour alone (always a text label); `prefers-reduced-motion` disables animation; touch targets ≥ 44px; works at 375px; AA contrast.
- Conventional commits, small and reviewable. **Never commit without the user reviewing the change first**: every "Commit" step below means "show the diff, wait for the user's OK, then commit".

## Review Focus

- Existing `data/nor-tutor.db` created before this change has no `awards` table → must open and work (Task 1 test).
- Backup v1–v3 files import with `awards: []`; a numeric or duplicate `awardId` is rejected (Task 1 tests).
- Brand-new learner with no data → quest `{ done: 0, goal: 1 }`, level 1 at 0%, no `NaN` or divide-by-zero (Task 2 tests).
- Review done just after local midnight counts toward the new day's quest (Task 2 test with a timezone offset).
- Two tabs or a reload claiming the same badge → server `409`, UI ignores it and shows no duplicate toast (Task 1 api test, Task 3 `claimBadges` handles `ConstraintError`).

---

### Task 1: `awards` store (SQLite + backup v4)

**Files:**
- Modify: `src/backup.js`
- Modify: `tools/store.mjs:15-20` (add table)
- Test: `tests/backup.test.js`, `tests/store.test.js`, `tests/api.test.js`

**Interfaces:**
- Consumes: existing `STORES`, `KEY_FIELD`, `ROW_CHECKS`, `openStore`, `createApi`.
- Produces: store name `'awards'`; row shape `{ awardId: string, timestamp: number }`; `loadState()` / `GET /api/state` now include `awards: []`; `BACKUP_VERSION === 4`. `src/db.js` and `tools/api.mjs` need no change.

- [ ] **Step 1: Update existing tests to the 7-store shape and add new failing tests**

In `tests/backup.test.js`:
- Add to the `state` fixture: `awards: [{ awardId: 'first-test', timestamp: 990 }],`
- Replace the v1 test body (line 15-17) with:
```js
test('v1 backups still import, with the newer stores empty', () => {
  const { known, unknown, phrases, awards, ...v1 } = state;
  assert.deepEqual(parseBackup(JSON.stringify({ version: 1, ...v1 })), { ...v1, known: [], unknown: [], phrases: [], awards: [] });
});

test('v3 backups import with awards empty; v4 validates awards', () => {
  const { awards, ...v3 } = state;
  assert.deepEqual(parseBackup(JSON.stringify({ version: 3, ...v3 })).awards, []);
  const v4 = (a) => JSON.stringify({ version: 4, ...state, awards: a });
  assert.deepEqual(parseBackup(v4(state.awards)).awards, state.awards);
  assert.throws(() => parseBackup(v4(undefined)), /"awards" must be an array/);
  assert.throws(() => parseBackup(v4([{ awardId: 5, timestamp: 1 }])), /Invalid award at index 0/);
  assert.throws(() => parseBackup(v4([{ awardId: 'a' }])), /Invalid award at index 0/);
  assert.throws(() => parseBackup(v4([{ awardId: 'a', timestamp: 1 }, { awardId: 'a', timestamp: 2 }])), /Duplicate award a/);
});
```
- Change the `STORES` assertion (line 29) to `['cards', 'reviews', 'tests', 'known', 'unknown', 'phrases', 'awards']`, and add `assert.equal(validRow('awards', { awardId: 'x', timestamp: 1 }), true);` right after it.

In `tests/store.test.js`: add `import { DatabaseSync } from 'node:sqlite';` to the imports; replace every `phrases: []` inside the four state literals (lines 11, 56, 64, 65) with `phrases: [], awards: []`; append:
```js
test('awards: add refuses a duplicate id', () => {
  const s = openStore(':memory:');
  s.add('awards', { awardId: 'first-test', timestamp: 1 });
  assert.throws(() => s.add('awards', { awardId: 'first-test', timestamp: 2 }), ConflictError);
  assert.deepEqual(s.getAll('awards'), [{ awardId: 'first-test', timestamp: 1 }]);
});

test('opens a database created before the awards table existed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nt-'));
  try {
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec('CREATE TABLE cards (word_id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    old.close();
    const s = openStore(path);
    assert.deepEqual(s.loadState().awards, []);
    s.add('awards', { awardId: 'first-test', timestamp: 1 });
    assert.equal(s.getAll('awards').length, 1);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

In `tests/api.test.js`: change line 38 to `const empty = { cards: [], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [] };` and append:
```js
test('awards: POST once, second POST is 409, bad row is 400', async () => {
  await reset();
  assert.equal((await call('POST', '/api/awards', { body: { awardId: 'first-test', timestamp: 1 } })).status, 204);
  assert.equal((await call('POST', '/api/awards', { body: { awardId: 'first-test', timestamp: 2 } })).status, 409);
  assert.equal((await call('POST', '/api/awards', { body: { awardId: 7, timestamp: 2 } })).status, 400);
  assert.deepEqual((await call('GET', '/api/awards')).body, [{ awardId: 'first-test', timestamp: 1 }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (STORES assertion, `awards` unknown store, 404 on `/api/awards`).

- [ ] **Step 3: Implement**

`src/backup.js` edits:
- `export const BACKUP_VERSION = 4;`
- `export const STORES = ['cards', 'reviews', 'tests', 'known', 'unknown', 'phrases', 'awards'];`
- `const ADDED_IN = { known: 2, unknown: 3, phrases: 3, awards: 4 };`
- `export const KEY_FIELD = { cards: 'wordId', known: 'wordId', unknown: 'wordId', phrases: 'phraseId', awards: 'awardId' };`
- In `ROW_CHECKS` add: `awards: (a) => isObj(a) && typeof a.awardId === 'string' && a.awardId !== '' && num(a.timestamp),`
- In `LABELS` add `awards: 'award'`; in `DUPLICATE` add `awards: (id) => \`Duplicate award ${id}\`,`

`tools/store.mjs`: inside the `db.exec` template add the line
`    CREATE TABLE IF NOT EXISTS awards (word_id TEXT PRIMARY KEY, data TEXT NOT NULL);`
(the column is named `word_id` for all keyed tables; the value is the JSON-stringified `awardId`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all).

- [ ] **Step 5: Commit** (after the user reviews the diff)

```bash
git add src/backup.js tools/store.mjs tests/backup.test.js tests/store.test.js tests/api.test.js
git commit -m "feat: awards store and backup v4"
```

---

### Task 2: `src/gamify.js` (pure rules)

**Files:**
- Create: `src/gamify.js`
- Test: `tests/gamify.test.js`

**Interfaces:**
- Consumes: `dueCards` (`src/srs.js`), `streakDays` (`src/stats.js`: `(rows with .timestamp, now, offsetMs) → number`). State shape = `loadState()` result: `{ cards, reviews, tests, known, unknown, phrases, awards }` (`phrases` rows are `{ phraseId, seen, got, lastAt }`).
- Produces:
  - `DAILY_GOAL = 20`
  - `xpTotal(state) → number`
  - `reviewXp({ again, hard, good, easy }) → number`
  - `levelInfo(xp) → { level, into, needed, pct }` (level n starts at `50*n*(n-1)` XP)
  - `streak(state, now, offset) → number`
  - `dailyQuest(state, now, offset) → { done, goal, pct, complete }`
  - `badges(state, now, offset) → [{ id, title, text, value, target, earned }]`
  - `newBadges(state, awards, now, offset) → badge[]` (earned, not in `awards`)

- [ ] **Step 1: Write the failing tests**

`tests/gamify.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpTotal, reviewXp, levelInfo, streak, dailyQuest, badges, newBadges, DAILY_GOAL } from '../src/gamify.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 11, 12);
const none = { cards: [], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [] };
const rv = (timestamp, grade = 'good') => ({ wordId: 1, timestamp, grade });
const card = (due) => ({ wordId: 1, ease: 2.5, interval: 0, reps: 0, lapses: 0, due });
const aTest = (timestamp) => ({ timestamp, estimate: 1, ciLow: 1, ciHigh: 1, bands: [] });

test('xpTotal adds every learning event', () => {
  const s = {
    ...none,
    reviews: [rv(1), rv(2, 'again')],
    tests: [aTest(1)],
    known: [{ wordId: 1, timestamp: 1 }, { wordId: 2, timestamp: 1 }],
    cards: [card(1)],
    phrases: [{ phraseId: 'p', seen: 4, got: 3, lastAt: 1 }],
  };
  assert.equal(xpTotal(s), 10 + 2 + 50 + 10 + 3 + 15);
  assert.equal(xpTotal(none), 0);
});

test('reviewXp matches the per-review rule', () => {
  assert.equal(reviewXp({ again: 1, hard: 1, good: 2, easy: 0 }), 3 * 10 + 2);
});

test('levelInfo: level n starts at 50*n*(n-1) XP, safe at 0', () => {
  assert.deepEqual(levelInfo(0), { level: 1, into: 0, needed: 100, pct: 0 });
  assert.deepEqual(levelInfo(99), { level: 1, into: 99, needed: 100, pct: 99 });
  assert.deepEqual(levelInfo(100), { level: 2, into: 0, needed: 200, pct: 0 });
  assert.deepEqual(levelInfo(450), { level: 3, into: 150, needed: 300, pct: 50 });
});

test('streak counts reviews and tests on consecutive days; none means 0', () => {
  assert.equal(streak(none, NOW, 0), 0);
  const s = { ...none, reviews: [rv(NOW), rv(NOW - DAY)], tests: [aTest(NOW - 2 * DAY)] };
  assert.equal(streak(s, NOW, 0), 3);
});

test('dailyQuest: new learner has a completable goal of 1, no NaN', () => {
  assert.deepEqual(dailyQuest(none, NOW, 0), { done: 0, goal: 1, pct: 0, complete: false });
});

test('dailyQuest: goal shrinks to what is available, caps at DAILY_GOAL', () => {
  const s = { ...none, cards: [card(NOW - 1)], reviews: [rv(NOW - 1000), rv(NOW - 2000)] };
  assert.deepEqual(dailyQuest(s, NOW, 0), { done: 2, goal: 3, pct: 67, complete: false });
  const finished = { ...none, reviews: [rv(NOW - 1000)] };
  assert.deepEqual(dailyQuest(finished, NOW, 0), { done: 1, goal: 1, pct: 100, complete: true });
  const many = { ...none, cards: Array.from({ length: 30 }, () => card(NOW - 1)) };
  assert.equal(dailyQuest(many, NOW, 0).goal, DAILY_GOAL);
});

test('dailyQuest respects the local day boundary', () => {
  const now = Date.UTC(2026, 9, 11, 23, 30);
  const offset = 2 * 3600000; // local time is 01:30 on the 12th
  const s = { ...none, reviews: [rv(Date.UTC(2026, 9, 11, 21, 0)), rv(Date.UTC(2026, 9, 11, 22, 30))] };
  assert.equal(dailyQuest(s, now, offset).done, 1); // 21:00Z is still the 11th locally
});

test('badges report progress and earned state', () => {
  const b = Object.fromEntries(badges({ ...none, tests: [aTest(1)] }, NOW, 0).map((x) => [x.id, x]));
  assert.equal(b['first-test'].earned, true);
  assert.equal(b['first-review'].earned, false);
  assert.deepEqual([b['deck-10'].value, b['deck-10'].target], [0, 10]);
});

test('newBadges excludes ones already awarded', () => {
  const s = { ...none, tests: [aTest(1)], reviews: [rv(1)] };
  assert.deepEqual(newBadges(s, [], NOW, 0).map((x) => x.id).sort(), ['first-review', 'first-test']);
  assert.deepEqual(newBadges(s, [{ awardId: 'first-test', timestamp: 1 }], NOW, 0).map((x) => x.id), ['first-review']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/gamify.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/gamify.js`**

```js
import { dueCards } from './srs.js';
import { streakDays } from './stats.js';

const DAY = 86400000;
export const DAILY_GOAL = 20;
const XP = { remembered: 10, forgotten: 2, test: 50, known: 5, card: 3, phrase: 5 };
const start = (n) => 50 * n * (n - 1); // XP at which level n begins

export function xpTotal({ reviews, tests, known, cards, phrases }) {
  const remembered = reviews.filter((r) => r.grade !== 'again').length;
  return (
    remembered * XP.remembered + (reviews.length - remembered) * XP.forgotten +
    tests.length * XP.test + known.length * XP.known + cards.length * XP.card +
    phrases.reduce((sum, p) => sum + p.got * XP.phrase, 0)
  );
}

export const reviewXp = ({ again, hard, good, easy }) => (hard + good + easy) * XP.remembered + again * XP.forgotten;

export function levelInfo(xp) {
  let level = 1;
  while (xp >= start(level + 1)) level++;
  const into = xp - start(level);
  const needed = start(level + 1) - start(level);
  return { level, into, needed, pct: Math.round((into / needed) * 100) };
}

export const streak = ({ reviews, tests }, now, offset = 0) => streakDays([...reviews, ...tests], now, offset);

export function dailyQuest({ cards, reviews }, now, offset = 0) {
  const today = Math.floor((now + offset) / DAY);
  const done = reviews.filter((r) => Math.floor((r.timestamp + offset) / DAY) === today).length;
  const goal = Math.min(DAILY_GOAL, Math.max(1, done + dueCards(cards, now).length));
  return { done, goal, pct: Math.min(100, Math.round((done / goal) * 100)), complete: done >= goal };
}

const BADGES = [
  { id: 'first-test', title: 'First test', text: 'Take the vocabulary test', metric: 'tests', target: 1 },
  { id: 'first-review', title: 'First review', text: 'Review a card', metric: 'reviews', target: 1 },
  { id: 'deck-10', title: 'Deck builder', text: 'Add 10 cards to your deck', metric: 'cards', target: 10 },
  { id: 'known-50', title: 'Word collector', text: 'Mark 50 words as known', metric: 'known', target: 50 },
  { id: 'streak-3', title: 'On a roll', text: 'Study 3 days in a row', metric: 'streak', target: 3 },
  { id: 'streak-7', title: 'Week warrior', text: 'Study 7 days in a row', metric: 'streak', target: 7 },
  { id: 'reviews-100', title: 'Century', text: 'Answer 100 reviews', metric: 'reviews', target: 100 },
  { id: 'level-5', title: 'Level 5', text: 'Reach level 5', metric: 'level', target: 5 },
];

export function badges(state, now, offset = 0) {
  const m = {
    tests: state.tests.length, reviews: state.reviews.length, cards: state.cards.length, known: state.known.length,
    streak: streak(state, now, offset), level: levelInfo(xpTotal(state)).level,
  };
  return BADGES.map(({ metric, ...b }) => ({ ...b, value: Math.min(m[metric], b.target), earned: m[metric] >= b.target }));
}

export function newBadges(state, awards, now, offset = 0) {
  const have = new Set(awards.map((a) => a.awardId));
  return badges(state, now, offset).filter((b) => b.earned && !have.has(b.id));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/gamify.test.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit** (after the user reviews the diff)

```bash
git add src/gamify.js tests/gamify.test.js
git commit -m "feat: derived XP, level, streak, quest and badges"
```

---

### Task 3: Design tokens, components and `src/gamui.js`

**Files:**
- Modify: `styles.css` (tokens lines 1-17, `.hero` lines 598-599, append new section)
- Create: `src/gamui.js`

**Interfaces:**
- Consumes: `h` (`src/dom.js`), `loadState`, `add` (`src/db.js`), `gamify.js` exports from Task 2.
- Produces (all from `src/gamui.js`):
  - `tzOffset() → number` (ms)
  - `ring(pct, label) → SVGElement` (`role=progressbar`)
  - `xpBar(info) → HTMLElement` (`info` = `levelInfo()` result)
  - `badgeTile(badge) → HTMLElement`
  - `toast(text) → void`
  - `confetti() → HTMLElement` (decorative, `aria-hidden`)
  - `claimBadges(db, state, now, offset) → Promise<badge[]>` (writes new `awards`, returns the ones newly stored; ignores `ConstraintError`)
  - `reward(db, gain, into) → Promise<void>` (fills `into` with level-up, quest status, XP bar, and toasts new badges)
  - `renderChip(db) → Promise<void>` (fills `#nav-chip`)
- CSS classes: `.ringwrap .ringtext .ring .ring-bg .ring-fg .xpbar .badges .badgetile .badgetile.earned .toasts .toast .confetti .celebrate .hero-main .navchip`.

- [ ] **Step 1: Replace tokens in `styles.css`**

Replace the `:root { ... }` block and the dark `@media` block (lines 1-17) with:
```css
:root {
  --bg: #f5f4fb; --fg: #1b1a2e; --muted: #55536b; --card: #ffffff; --line: #dcdaea;
  --accent: #4f46e5; --accent-fg: #ffffff; --bad: #b3261e;
  --def: #1a56a0; --trans: #176a38; --known: #0d6868; --review: #8a5200; --context: #6b3fa0; --xp: #92400e; --flame: #c2410c;
  --hero-a: #4f46e5; --hero-b: #7c3aed; --hero-fg: #ffffff;
  --radius: 14px; --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 40px;
  --shadow: 0 2px 10px rgba(40, 30, 110, .08);
  --focus: #4f46e5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f0e1a; --fg: #ebeaf5; --muted: #a9a7c2; --card: #1a1930; --line: #302e4d;
    --accent: #a5b4fc; --accent-fg: #1e1b4b; --bad: #f2928b;
    --def: #8fbcf5; --trans: #7ed3a0; --known: #6fd0d0; --review: #f0b455; --context: #c3a2ee; --xp: #fbbf24; --flame: #fb923c;
    --hero-a: #3730a3; --hero-b: #5b21b6;
    --shadow: 0 2px 10px rgba(0, 0, 0, .4);
    --focus: #c7d2fe;
  }
}
```

- [ ] **Step 2: Replace the `.hero` rules**

Replace
```css
.hero { padding: var(--s5); border-width: 2px; border-color: var(--accent); }
.hero p { margin: 0 0 var(--s4); color: var(--muted); max-width: 60ch; }
```
with
```css
.hero { padding: var(--s5); border: 0; color: var(--hero-fg); background: linear-gradient(135deg, var(--hero-a), var(--hero-b)); box-shadow: var(--shadow); }
.hero p { margin: 0 0 var(--s4); color: var(--hero-fg); opacity: .92; max-width: 60ch; }
.hero a { color: var(--hero-fg); }
.hero .btn.primary, .hero button.primary { background: #fff; color: #3730a3; border-color: #fff; }
.hero .btn, .hero button { border-color: rgba(255, 255, 255, .6); }
.hero .btn:not(.primary), .hero button:not(.primary) { background: transparent; color: var(--hero-fg); }
.card { box-shadow: var(--shadow); }
```

- [ ] **Step 3: Append the gamification CSS at the end of `styles.css`**

```css
/* gamification */
.hero-main { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s5); }
.ringwrap { position: relative; width: 120px; height: 120px; flex: none; }
.ring { width: 100%; height: 100%; }
.ring circle { fill: none; stroke-width: 9; }
.ring-bg { stroke: rgba(255, 255, 255, .25); }
.ring-fg { stroke: #fde68a; stroke-linecap: round; }
.ringtext { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.15; text-align: center; }
.ringtext strong { font-size: 1.5rem; }
.ringtext small { font-size: .75rem; opacity: .9; }
.xpbar { margin: var(--s3) 0; }
.xpbar .progress > span { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.xpbar strong { color: var(--xp); }
.badges { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--s3); margin-top: var(--s3); }
.badgetile { display: flex; flex-direction: column; gap: var(--s1); padding: var(--s3); border: 1px dashed var(--line); border-radius: var(--radius); background: var(--card); }
.badgetile.earned { border: 2px solid var(--xp); background: color-mix(in srgb, var(--xp) 10%, var(--card)); }
.toasts { position: fixed; right: var(--s4); bottom: var(--s4); z-index: 50; display: grid; gap: var(--s2); max-width: min(360px, calc(100vw - 2 * var(--s4))); }
.toast { padding: var(--s3) var(--s4); border-radius: var(--radius); background: var(--fg); color: var(--bg); box-shadow: var(--shadow); font-weight: 600; }
.navchip { display: inline-flex; gap: var(--s3); align-items: center; margin-left: var(--s3); padding: 2px var(--s3); border-radius: 999px; background: color-mix(in srgb, var(--accent) 14%, var(--card)); font-size: .85rem; font-weight: 600; white-space: nowrap; }
.navchip .flame { color: var(--flame); }
.confetti { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.confetti span { position: absolute; top: -12px; left: calc(var(--i) * 7%); width: 8px; height: 14px; border-radius: 2px; background: hsl(calc(var(--i) * 47), 90%, 62%); }
.celebrate { position: relative; overflow: hidden; }
@media (prefers-reduced-motion: no-preference) {
  .ring-fg { transition: stroke-dasharray .6s ease; }
  .celebrate { animation: pop .35s ease-out; }
  .confetti span { animation: fall 1.6s ease-in forwards; animation-delay: calc(var(--i) * 70ms); }
  .toast { animation: pop .25s ease-out; }
}
@media (prefers-reduced-motion: reduce) { .confetti { display: none; } }
@keyframes pop { from { transform: scale(.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes fall { to { transform: translateY(260px) rotate(300deg); opacity: 0; } }
@media (max-width: 640px) { .navchip { margin-left: var(--s2); } .ringwrap { width: 96px; height: 96px; } }
```

- [ ] **Step 4: Create `src/gamui.js`**

```js
// Browser-only helpers for the gamification UI. Rules live in gamify.js; this file only draws and writes awards.
import { h } from './dom.js';
import { loadState, add } from './db.js';
import { xpTotal, levelInfo, streak, dailyQuest, newBadges } from './gamify.js';

export const tzOffset = () => -new Date().getTimezoneOffset() * 60000;

const svg = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

export function ring(pct, label) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const el = svg('svg', { viewBox: '0 0 100 100', class: 'ring', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': label });
  el.append(
    svg('circle', { cx: 50, cy: 50, r, class: 'ring-bg' }),
    svg('circle', { cx: 50, cy: 50, r, class: 'ring-fg', 'stroke-dasharray': `${(c * pct) / 100} ${c}`, transform: 'rotate(-90 50 50)' }),
  );
  return el;
}

export const xpBar = ({ level, into, needed, pct }) =>
  h('div', { class: 'xpbar' },
    h('div', { class: 'row between' }, h('strong', {}, `Level ${level}`), h('span', { class: 'muted' }, `${into} / ${needed} XP to next level`)),
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'XP to next level', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: `width:${pct}%` })));

export const badgeTile = (b) =>
  h('div', { class: `badgetile${b.earned ? ' earned' : ''}` },
    h('strong', {}, b.title),
    h('span', { class: 'muted' }, b.text),
    h('span', { class: 'badge' }, b.earned ? 'Earned' : `${b.value} / ${b.target}`));

export function toast(text) {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const el = h('div', { class: 'toast' }, text);
  box.append(el);
  setTimeout(() => el.remove(), 6000);
}

export const confetti = () =>
  h('div', { class: 'confetti', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, i) => h('span', { style: `--i:${i}` })));

// Stores each newly earned badge once. A 409 (ConstraintError) means another tab already did; any other
// failure stops quietly and is retried on the next load, because badges are derived and nothing is lost.
export async function claimBadges(db, state, now, offset) {
  const got = [];
  for (const b of newBadges(state, state.awards, now, offset)) {
    try {
      await add(db, 'awards', { awardId: b.id, timestamp: now });
      state.awards.push({ awardId: b.id, timestamp: now });
      got.push(b);
    } catch (e) {
      if (e?.name !== 'ConstraintError') break;
    }
  }
  return got;
}

// After a review session: level-up line, quest status, XP bar, and toasts for new badges.
export async function reward(db, gain, into) {
  const state = await loadState(db);
  const now = Date.now();
  const offset = tzOffset();
  const total = xpTotal(state);
  const after = levelInfo(total);
  const q = dailyQuest(state, now, offset);
  into.replaceChildren(
    after.level > levelInfo(total - gain).level ? h('p', {}, h('strong', {}, `Level up! You are now level ${after.level}.`)) : null,
    h('p', {}, q.complete ? 'Daily quest complete!' : `Daily quest: ${q.done} of ${q.goal} reviews done today.`),
    xpBar(after));
  for (const b of await claimBadges(db, state, now, offset)) toast(`Badge earned: ${b.title}`);
}

export async function renderChip(db) {
  const el = document.getElementById('nav-chip');
  if (!el) return;
  const state = await loadState(db);
  const days = streak(state, Date.now(), tzOffset());
  el.replaceChildren(
    h('span', {}, `Level ${levelInfo(xpTotal(state)).level}`),
    h('span', { class: 'flame', 'aria-label': `${days}-day streak` }, `\u{1F525} ${days}`));
  el.hidden = false;
}
```

- [ ] **Step 5: Verify in the browser**

Run: `npm start`, open http://127.0.0.1:5173. Check the existing views still render with the new palette and gradient hero (Review's "Done" card and the fresh Dashboard are `.hero`; buttons inside must be readable in light and dark). Console shows no errors.
Expected: no layout or contrast regressions; `npm test` still passes.

- [ ] **Step 6: Commit** (after the user reviews the diff)

```bash
git add styles.css src/gamui.js
git commit -m "feat: vivid design tokens and gamification UI helpers"
```

---

### Task 4: Dashboard (Today / Progress tabs, quest, level, badges)

**Files:**
- Modify: `src/views/dashboard.js` (replace the non-fresh branch; keep the fresh-user welcome branch as is)

**Interfaces:**
- Consumes: Task 2 and Task 3 exports; existing `buildStatus`, `mostMissed`, `vocabSeries`, `dailyAccuracy`, charts helpers.
- Produces: `render(root, ctx)` unchanged signature.

- [ ] **Step 1: Update imports**

Replace the first six import lines with:
```js
import { h, no } from '../dom.js';
import { loadState } from '../db.js';
import { vocabSeries, dailyAccuracy } from '../stats.js';
import { dueCards } from '../srs.js';
import { buildStatus, mostMissed } from '../wordstatus.js';
import { lineChart, barChart, accent, softAccent } from '../charts.js';
import { xpTotal, levelInfo, streak, dailyQuest, badges } from '../gamify.js';
import { ring, xpBar, badgeTile, claimBadges, toast, tzOffset } from '../gamui.js';
```
And change `const offset = -new Date().getTimezoneOffset() * 60000;` to `const offset = tzOffset();`.

- [ ] **Step 2: Replace everything from `const missed = mostMissed(...)` to the end of `render`**

Keep the existing `hero` constant (it already handles test / due / missed words / caught up). Then:
```js
  const missed = mostMissed(status, 6).filter((r) => byId.has(r.wordId));
  const pct = Math.round((known.length / words.length) * 100);
  const quest = dailyQuest(state, now, offset);
  const level = levelInfo(xpTotal(state));
  const awarded = new Set(state.awards.map((a) => a.awardId));
  const all = badges(state, now, offset).map((b) => ({ ...b, earned: b.earned || awarded.has(b.id) }));
  const nextBadge = all.filter((b) => !b.earned).sort((a, b) => b.value / b.target - a.value / a.target)[0];

  const series = vocabSeries(tests);
  const days = dailyAccuracy(reviews, offset);
  const canvases = [h('canvas', { role: 'img', 'aria-label': 'Estimated vocabulary after each test' }), h('canvas', { role: 'img', 'aria-label': 'Share remembered per day' })];
  const chartCard = (title, explain, empty, cta, ready, canvas) =>
    h('section', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted' }, explain),
      typeof Chart === 'undefined' ? h('p', { class: 'muted' }, 'Charts need Chart.js from the internet, which could not be loaded.')
        : ready ? h('div', { class: 'chart' }, canvas) : h('div', { class: 'empty' }, h('p', {}, empty), link(cta[0], cta[1], 'btn primary')));

  const today = h('div', { role: 'tabpanel', id: 'panel-0', 'aria-labelledby': 'tab-0' },
    h('section', { class: 'card hero' },
      h('div', { class: 'hero-main' },
        h('div', {}, h('h2', {}, hero.title), h('p', {}, hero.text), link(hero.href, hero.label)),
        h('div', { class: 'ringwrap' }, ring(quest.pct, "Today's quest"),
          h('div', { class: 'ringtext' }, h('strong', {}, `${quest.done}/${quest.goal}`), h('small', {}, quest.complete ? 'Quest done!' : 'reviews today'))))),
    h('section', { class: 'card' }, xpBar(level)),
    h('div', { class: 'tiles' },
      tile('Words you know', String(known.length), `of ${words.length} in the list`),
      tile('Still learning', String(learning), 'Words you missed'),
      tile('In review deck', String(cards.length), `${due} due now`),
      tile('Day streak', String(streak(state, now, offset)), 'Days in a row you studied')),
    nextBadge ? h('section', { class: 'card' }, h('h3', {}, 'Next badge'), badgeTile(nextBadge)) : null,
    h('details', {}, h('summary', {}, `All badges (${all.filter((b) => b.earned).length} of ${all.length} earned)`), h('div', { class: 'badges' }, all.map(badgeTile))),
    missed.length
      ? h('section', { class: 'card' },
          h('h3', {}, 'Words you miss most'),
          h('ul', { class: 'plain missed' }, missed.map((r) => {
            const w = byId.get(r.wordId);
            return h('li', {}, no(w.lemma, 'strong'), ' ', h('span', { class: 'trans' }, w.gloss_en), h('span', { class: 'badge' }, `${r.count}×`));
          })),
          link('#/explore', 'Work on these words', 'btn'))
      : null);

  const progress = h('div', { role: 'tabpanel', id: 'panel-1', 'aria-labelledby': 'tab-1', hidden: true },
    h('section', { class: 'card' },
      h('h3', {}, 'Vocabulary coverage'),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: `width:${pct}%` })),
      h('p', { class: 'muted' }, `${pct}% of the word list marked as known.` + (latest ? ` Your last test estimated about ${fmt(latest.estimate)} of ${fmt(latest.listSize ?? words.length)}.` : ''))),
    chartCard('How many words you know', 'Your test estimate after each test. Dashed lines show the likely range. Based on your own answers, so it can run high if you over-claim.', 'Take the test more than once to see how you improve.', ['#/test', 'Take the test'], series.length > 0, canvases[0]),
    chartCard('Answers you remembered each day', 'The share of review answers that were not "Again". Higher means the words are sticking.', 'Do a review session and your results will appear here.', ['#/review', 'Start a review'], days.length > 0, canvases[1]),
    h('details', {}, h('summary', {}, 'What do these numbers mean?'),
      h('p', {}, 'The estimate is how many words of the list you likely know, with a range because a test samples only some words. "Remembered" is the share of review answers that were not "Again". XP and levels only count real study: reviews, tests, words marked known, cards added and sentences you got right.')));

  const panels = [today, progress];
  let drawn = false;
  const tabs = ['Today', 'Progress'].map((label, i) =>
    h('button', { class: 'tab', role: 'tab', id: `tab-${i}`, 'aria-selected': String(i === 0), 'aria-controls': `panel-${i}`, onclick: () => select(i) }, label));
  function select(i) {
    tabs.forEach((t, n) => t.setAttribute('aria-selected', String(n === i)));
    panels.forEach((p, n) => (p.hidden = n !== i));
    if (i === 1 && !drawn) {
      drawn = true; // Chart.js sizes badly inside a hidden panel, so draw on first show
      drawCharts();
    }
  }

  root.replaceChildren(h('h1', {}, 'Your dashboard'), h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Dashboard sections' }, tabs), today, progress);

  function drawCharts() {
    if (typeof Chart === 'undefined') return;
    const main = accent();
    if (series.length) {
      const faint = { borderColor: softAccent(), borderDash: [5, 4], pointRadius: series.length === 1 ? 3 : 0 };
      lineChart(canvases[0], series.map((s) => new Date(s.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })), [
        { label: 'Estimate', data: series.map((s) => s.estimate), borderColor: main, backgroundColor: main, pointRadius: 4 },
        { label: 'Upper range', data: series.map((s) => s.ciHigh), ...faint },
        { label: 'Lower range', data: series.map((s) => s.ciLow), ...faint },
      ]);
    }
    if (days.length) {
      barChart(canvases[1], days.map((d) => d.day), [{ label: 'Remembered (%)', data: days.map((d) => Math.round(d.accuracy * 100)), backgroundColor: main }], { max: 100 });
    }
  }

  claimBadges(db, state, now, offset).then((got) => got.forEach((b) => toast(`Badge earned: ${b.title}`))).catch(() => {});
}
```
(The `fresh` welcome branch above is untouched; it needs no gamification.)

- [ ] **Step 3: Verify in the browser** (`npm start`, http://127.0.0.1:5173)

Checks, each expected to hold:
1. Fresh database (move `data/nor-tutor.db` aside first, restore after): welcome screen still shows, no console errors.
2. After a test: Today tab shows hero with ring `0/1`, XP bar "Level 1" with 50/100 XP, tiles, "Next badge", a toast "Badge earned: First test" appears once; reload → no second toast.
3. `SELECT * FROM awards` in the SQLite file (or `GET /api/awards` in the browser) shows `first-test`.
4. Progress tab: charts draw at full size on first open; with no data they show the empty message plus a button.
5. Keyboard: Tab reaches both tabs, Enter/Space switches; `aria-selected` follows. 375px width: no horizontal scroll; dark mode readable; with reduced motion the ring does not animate.

- [ ] **Step 4: Commit** (after the user reviews the diff)

```bash
git add src/views/dashboard.js
git commit -m "feat: gamified dashboard with Today and Progress tabs"
```

---

### Task 5: Nav chip, Review celebration, docs

**Files:**
- Modify: `index.html`, `src/app.js`, `src/views/review.js`, `README.md`

**Interfaces:**
- Consumes: `renderChip`, `reward`, `confetti` (Task 3), `reviewXp` (Task 2).

- [ ] **Step 1: Add the chip to `index.html`**

After the `<a class="quiet" href="#/data">Data</a>` line add:
```html
    <span id="nav-chip" class="navchip" hidden></span>
```

- [ ] **Step 2: Refresh the chip on every navigation in `src/app.js`**

Add `import { renderChip } from './gamui.js';` after the `validateWords` import, and inside `go()` right after `window.scrollTo(0, 0);` add:
```js
      renderChip(db).catch(() => {}); // cosmetic: a failure must not block the view
```

- [ ] **Step 3: Celebrate in `src/views/review.js`**

Add imports: `import { reviewXp } from '../gamify.js';` and `import { confetti, reward } from '../gamui.js';`.
Replace the whole `function done() { ... }` (lines 462-470) with:
```js
    function done() {
      keys = {};
      const gain = reviewXp(tally);
      const extra = h('div', { role: 'status' });
      page(h('div', { class: 'card hero celebrate' },
        confetti(),
        h('h2', {}, `Done: ${total} ${total === 1 ? 'card' : 'cards'} reviewed`),
        h('p', {}, `${tally.good + tally.easy + tally.hard} remembered, ${tally.again} to see again soon. `, h('strong', {}, `+${gain} XP`)),
        extra,
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: () => render(root, { words, db }) }, 'Back to Review'),
          h('a', { class: 'btn', href: '#/dashboard' }, 'Dashboard'))));
      reward(db, gain, extra).catch(() => {}); // the summary above is already complete; the extras are a bonus
    }
```

- [ ] **Step 4: Document in `README.md`**

Append a short section:
```md
## Progress and rewards
XP, levels, streaks and the daily quest are calculated from your review, test, deck and known-word history, so they never go out of sync. Only earned badges are stored (table `awards` in `data/nor-tutor.db`, included in Data export/import, backup version 4). Rewards come from real study only.
```

- [ ] **Step 5: Verify in the browser and run tests**

Run: `npm test` → PASS. Then `npm start` and:
1. Do a 3-card review: the Done card shows confetti (not with reduced motion), `+N XP`, quest line "Daily quest: x of y", XP bar; a first-review badge toast appears once. A level-up shows "Level up!" when XP crosses 100.
2. Nav shows "Level N 🔥 days" on every page and updates after navigating.
3. Data → Export contains `"version": 4` and `awards`; importing an old v3 file works and the Dashboard still loads.
4. Stop the server mid-session: the review error path still works and no uncaught errors appear from the reward call.

- [ ] **Step 6: Commit** (after the user reviews the diff)

```bash
git add index.html src/app.js src/views/review.js README.md
git commit -m "feat: nav level chip, review celebration, docs"
```

---

## Self-review

- **Spec coverage:** storage `awards` + backup v4 (Task 1); XP/level/streak/quest/badges and `newBadges` (Task 2); tokens, meaning colours kept, ring, XP bar, badge tile, toast, celebration, reduced motion (Task 3); nav chip (Task 5); Today/Progress tabs, hero, tiles, next badge, chart empty-state buttons, explainer and caveat (Task 4); review reward (Task 5); tests listed in spec (Tasks 1-2); verification checklist (Tasks 4-5). `nextAction`/`gettingStarted` already exist in `src/stats.js` with tests, so they are not re-added; the existing richer hero logic (missed words) is kept rather than the spec's three-case version.
- **Deliberate deviations from the spec text:** phrase XP uses aggregate `got * 5`; streak excludes phrases (rows hold totals only); quest goal shrinks to what is available; `newBadges` returns badge objects. The spec was updated to match.
- **Out of spec, noted:** the explicit "Getting started" 3-step checklist is not built because the existing fresh-user welcome screen already covers first-run guidance.
- **Types:** `levelInfo` → `{ level, into, needed, pct }` is consumed by `xpBar`; `dailyQuest` → `{ done, goal, pct, complete }` by the hero and `reward`; `badges()` entries by `badgeTile`; names match across tasks.

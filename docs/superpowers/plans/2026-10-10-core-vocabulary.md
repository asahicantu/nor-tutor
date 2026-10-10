# Core + Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, single-user web app that estimates Norwegian vocabulary size, lets the learner explore words, reviews them with spaced repetition, and charts progress.

**Architecture:** Static site with ES modules and no build step. All logic that can be pure (SRS, estimator, stats, search, backup validation) lives in DOM-free modules covered by `node --test`. Thin view modules render into `#app` using a tiny `h()` helper and talk to IndexedDB through `src/db.js`. Chart.js (pinned) draws the charts.

**Tech Stack:** Node 24 (tests + dev server only), vanilla JS ES modules, IndexedDB, Chart.js 4.4.1 from jsDelivr.

**Spec:** `docs/superpowers/specs/2026-10-10-core-vocabulary-design.md`

## Global Constraints

- No build step, no runtime npm dependencies; the only external script is Chart.js `4.4.1` from `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js`.
- All user data stays in the browser (IndexedDB); JSON export/import is the only backup path.
- Word records carry both `gloss_en` (English) and `def_no` (Norwegian definition).
- Frequency bands are rank ranges 1–1000, 1001–2000, 2001–4000, 4001–8000, 8001–16000, 16001–32000, 32001–64000.
- Test guess correction: `p_corrected = (p_b − f) / (1 − f)` clamped to [0, 1]; 95% CI by summing per-band variances in quadrature.
- Pure modules (`srs`, `estimator`, `pseudowords`, `stats`, `search`, `backup`, `wordsSchema`, `rng`) must not touch `document`, `window`, or `indexedDB`.
- **User control:** every task ends with showing `git diff --stat` and the changed files to the user. **Do not commit until the user says OK.** Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run commands from `C:\Users\asahi\source\nor-tutor`. Tests: `npm test`.

## Review Focus

Inputs the spec implies but no obvious happy-path test covers, most likely first:

1. **User marks every nonsense word as "known"** → false-alarm rate 100%, estimate undefined. Expect: clear message, nothing saved. (Task 3 unit test; Task 9 manual check.)
2. **Importing a corrupted or foreign JSON file** → must be rejected with a readable error and must NOT erase existing data. (Task 4 unit tests; Task 8 atomic replace; Task 13 manual check.)
3. **Opening Review with no cards, or with cards but none due** → friendly empty state, no crash. (Task 10 manual check.)
4. **Dashboard with zero tests/reviews, or exactly one test** → empty-state text and a single-point chart, not a blank or broken canvas. (Task 12 manual check.)
5. **Searching with Norwegian letters and mixed case** (`Ø`, `æ`, `Å`) → matches `ørret`, `ære`, `åpen`. (Task 7 unit test.)

---

### Task 1: Project scaffold and seeded RNG

**Files:**
- Create: `package.json`, `.gitignore`, `README.md`, `tools/serve.mjs`, `src/rng.js`
- Test: `tests/rng.test.js`

**Interfaces:**
- Produces: `mulberry32(seed: number): () => number` (floats in [0,1)); `shuffle<T>(arr: T[], rng): T[]` (returns a new array, input untouched).

- [ ] **Step 1: Create `package.json`, `.gitignore`, `README.md`**

`package.json`:
```json
{
  "name": "nor-tutor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "start": "node tools/serve.mjs"
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
*.log
```

`README.md`:
```markdown
# nor-tutor

Local tutor for Norwegian Bokmål (B2 and beyond).

- `npm start` serves the app at http://127.0.0.1:5173
- `npm test` runs the unit tests (Node 20+)

Your data lives in your browser (IndexedDB). Use the Data page to export a JSON backup.
```

- [ ] **Step 2: Create `tools/serve.mjs`** (static file server, localhost only)

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = resolve(join(root, normalize(path === '/' ? '/index.html' : path)));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(5173, '127.0.0.1', () => console.log('http://127.0.0.1:5173'));
```

- [ ] **Step 3: Write the failing test** `tests/rng.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, shuffle } from '../src/rng.js';

test('mulberry32 is deterministic for a seed', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});

test('mulberry32 differs across seeds and stays in [0,1)', () => {
  const a = mulberry32(1), b = mulberry32(2);
  assert.notEqual(a(), b());
  const r = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});

test('shuffle keeps elements, does not mutate input, is deterministic', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const copy = input.slice();
  const out = shuffle(input, mulberry32(3));
  assert.deepEqual(input, copy);
  assert.deepEqual(out.slice().sort((x, y) => x - y), copy);
  assert.deepEqual(out, shuffle(input, mulberry32(3)));
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module `../src/rng.js`.

- [ ] **Step 5: Implement `src/rng.js`**

```js
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test`
Expected: 3 tests PASS.

- [ ] **Step 7: Show `git status` + `git diff --stat` to the user; commit only after OK**

```bash
git add package.json .gitignore README.md tools src/rng.js tests/rng.test.js
git commit -m "chore: scaffold project with test runner, dev server and seeded RNG"
```

---

### Task 2: Spaced-repetition scheduler (`srs.js`)

**Files:**
- Create: `src/srs.js`
- Test: `tests/srs.test.js`

**Interfaces:**
- Produces:
  - `GRADES = { again: 1, hard: 3, good: 4, easy: 5 }`
  - `newCard(wordId, now): Card` where `Card = { wordId, ease, interval, reps, lapses, due }` (`interval` in days, `due` in ms epoch)
  - `review(card, grade: keyof GRADES, now): Card` (pure; throws `RangeError` on unknown grade)
  - `dueCards(cards, now): Card[]` (due ≤ now, earliest first)

Scheduling rules (SM-2 variant): grade < 3 → `reps=0`, `lapses+1`, `interval=1`, `ease=max(1.3, ease−0.2)`. Otherwise `ease = max(1.3, ease + 0.1 − (5−q)(0.08 + (5−q)·0.02))`, then `interval = 1` if `reps==0`, `6` if `reps==1`, else `round(interval × ease)` using the updated ease; `reps+1`.

- [ ] **Step 1: Write the failing test** `tests/srs.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCard, review, dueCards, GRADES } from '../src/srs.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 10);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

test('new card is due immediately with default ease', () => {
  const c = newCard('w1', T0);
  assert.deepEqual(c, { wordId: 'w1', ease: 2.5, interval: 0, reps: 0, lapses: 0, due: T0 });
});

test('good: intervals go 1, 6, then multiply by ease', () => {
  let c = newCard('w1', T0);
  c = review(c, 'good', T0);
  assert.equal(c.interval, 1); assert.equal(c.reps, 1); assert.equal(c.due, T0 + DAY);
  c = review(c, 'good', T0 + DAY);
  assert.equal(c.interval, 6);
  c = review(c, 'good', T0 + 7 * DAY);
  assert.equal(c.interval, 15); // round(6 * 2.5)
  close(c.ease, 2.5);
});

test('easy raises ease, hard lowers it', () => {
  close(review(newCard('a', T0), 'easy', T0).ease, 2.6);
  close(review(newCard('a', T0), 'hard', T0).ease, 2.36);
});

test('again resets reps, counts a lapse, schedules 1 day, lowers ease', () => {
  let c = newCard('a', T0);
  c = review(c, 'good', T0);
  c = review(c, 'good', T0);
  c = review(c, 'again', T0);
  assert.equal(c.reps, 0); assert.equal(c.lapses, 1); assert.equal(c.interval, 1);
  close(c.ease, 2.3);
});

test('ease never drops below 1.3', () => {
  let c = newCard('a', T0);
  for (let i = 0; i < 20; i++) c = review(c, 'again', T0);
  close(c.ease, 1.3);
});

test('review does not mutate its input; unknown grade throws', () => {
  const c = newCard('a', T0);
  const snapshot = { ...c };
  review(c, 'good', T0);
  assert.deepEqual(c, snapshot);
  assert.throws(() => review(c, 'perfect', T0), RangeError);
  assert.deepEqual(Object.keys(GRADES), ['again', 'hard', 'good', 'easy']);
});

test('dueCards returns only due cards, earliest first', () => {
  const a = { ...newCard('a', T0), due: T0 + 2 * DAY };
  const b = { ...newCard('b', T0), due: T0 - DAY };
  const c = { ...newCard('c', T0), due: T0 };
  assert.deepEqual(dueCards([a, b, c], T0).map((x) => x.wordId), ['b', 'c']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module `../src/srs.js`.

- [ ] **Step 3: Implement `src/srs.js`**

```js
const DAY = 86400000;

export const GRADES = { again: 1, hard: 3, good: 4, easy: 5 };

export function newCard(wordId, now) {
  return { wordId, ease: 2.5, interval: 0, reps: 0, lapses: 0, due: now };
}

export function review(card, grade, now) {
  const q = GRADES[grade];
  if (q === undefined) throw new RangeError(`unknown grade: ${grade}`);
  let { ease, interval, reps, lapses } = card;
  if (q < 3) {
    reps = 0;
    lapses += 1;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * ease);
    reps += 1;
  }
  return { ...card, ease, interval, reps, lapses, due: now + interval * DAY };
}

export function dueCards(cards, now) {
  return cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Show diff to user; commit after OK**

```bash
git add src/srs.js tests/srs.test.js
git commit -m "feat: add SM-2 style spaced-repetition scheduler"
```

---

### Task 3: Pseudo-words and vocabulary estimator

**Files:**
- Create: `src/pseudowords.js`, `src/estimator.js`
- Test: `tests/pseudowords.test.js`, `tests/estimator.test.js`

**Interfaces:**
- Consumes: `shuffle` from `src/rng.js`.
- Produces:
  - `generatePseudoWords(count, rng, realWords: string[]): string[]` — unique, lowercase, ≥4 letters, none in `realWords`.
  - `BANDS: {id, from, to}[]` (ids `b1`…`b7`); `bandOf(rank): Band|null`; `bandSizes(words): Record<bandId, number>`.
  - `sampleTest(words, rng, {perBand=20, pseudoRatio=0.2}={}): Item[]` where `Item = {kind:'word'|'pseudo', band: string|null, wordId?, text}`; throws `Error('no words to sample')` on empty list.
  - `scoreTest(responses: {kind, band, known:boolean}[], sizes): Result` where `Result = {estimate, ciLow, ciHigh, falseAlarmRate, pseudoTotal, listSize, bands:[{band,size,sampled,known,pCorrected}]}`; throws `RangeError` if false-alarm rate ≥ 1; throws `Error` if a band with size>0 has no responses.

- [ ] **Step 1: Write failing tests** `tests/pseudowords.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePseudoWords } from '../src/pseudowords.js';
import { mulberry32 } from '../src/rng.js';

test('generates the requested number of unique lowercase words', () => {
  const words = generatePseudoWords(30, mulberry32(1), ['hus']);
  assert.equal(words.length, 30);
  assert.equal(new Set(words).size, 30);
  for (const w of words) {
    assert.match(w, /^[a-zæøå]{4,}$/);
  }
});

test('is deterministic for a seed', () => {
  assert.deepEqual(generatePseudoWords(10, mulberry32(5), []), generatePseudoWords(10, mulberry32(5), []));
});

test('never returns a word from the real list', () => {
  const first = generatePseudoWords(20, mulberry32(1), []);
  const second = generatePseudoWords(20, mulberry32(2), first);
  for (const w of second) assert.ok(!first.includes(w));
});
```

`tests/estimator.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, bandOf, bandSizes, sampleTest, scoreTest } from '../src/estimator.js';
import { mulberry32 } from '../src/rng.js';

const near = (a, b, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);

function makeWords(perBand) {
  const words = [];
  for (const b of BANDS) {
    for (let i = 0; i < perBand; i++) {
      const rank = b.from + i;
      words.push({ id: `w${rank}`, lemma: `ord${rank}`, rank });
    }
  }
  return words;
}

function resp(band, n, known, kind = 'word') {
  return Array.from({ length: n }, (_, i) => ({ kind, band, known: i < known }));
}

test('bandOf maps ranks to bands and rejects out-of-range', () => {
  assert.equal(bandOf(1).id, 'b1');
  assert.equal(bandOf(1000).id, 'b1');
  assert.equal(bandOf(1001).id, 'b2');
  assert.equal(bandOf(64000).id, 'b7');
  assert.equal(bandOf(64001), null);
});

test('bandSizes counts words per band', () => {
  const s = bandSizes(makeWords(3));
  assert.deepEqual(Object.values(s), [3, 3, 3, 3, 3, 3, 3]);
});

test('sampleTest: perBand words per band, 20% pseudo, no duplicates, deterministic', () => {
  const words = makeWords(30);
  const items = sampleTest(words, mulberry32(9));
  const real = items.filter((i) => i.kind === 'word');
  const pseudo = items.filter((i) => i.kind === 'pseudo');
  assert.equal(real.length, 140);
  assert.equal(pseudo.length, 28);
  assert.equal(new Set(real.map((i) => i.wordId)).size, 140);
  for (const b of BANDS) assert.equal(real.filter((i) => i.band === b.id).length, 20);
  assert.deepEqual(items, sampleTest(words, mulberry32(9)));
});

test('sampleTest: a small band yields all its words; empty list throws', () => {
  const items = sampleTest(makeWords(5), mulberry32(1));
  assert.equal(items.filter((i) => i.kind === 'word' && i.band === 'b1').length, 5);
  assert.throws(() => sampleTest([], mulberry32(1)), /no words to sample/);
});

test('scoreTest: everything known, no nonsense words -> full list, zero-width CI', () => {
  const r = scoreTest([...resp('b1', 20, 20), ...resp('b2', 20, 20)], { b1: 100, b2: 100 });
  assert.equal(r.estimate, 200);
  assert.equal(r.ciLow, 200);
  assert.equal(r.ciHigh, 200);
  assert.equal(r.listSize, 200);
});

test('scoreTest: half known gives half the band with a symmetric 95% CI', () => {
  const r = scoreTest(resp('b1', 20, 10), { b1: 1000 });
  assert.equal(r.estimate, 500);
  near(r.ciLow, 283);
  near(r.ciHigh, 717);
});

test('scoreTest: guessing correction uses the false-alarm rate', () => {
  const responses = [...resp('b1', 20, 15), ...resp('', 8, 4, 'pseudo')];
  const r = scoreTest(responses, { b1: 1000 });
  assert.equal(r.falseAlarmRate, 0.5);
  assert.equal(r.estimate, 500); // (0.75 - 0.5) / 0.5 = 0.5
});

test('scoreTest: known rate below false-alarm rate clamps to zero', () => {
  const responses = [...resp('b1', 20, 2), ...resp('', 4, 2, 'pseudo')];
  assert.equal(scoreTest(responses, { b1: 1000 }).estimate, 0);
});

test('scoreTest: sampling the whole band has no sampling variance', () => {
  const r = scoreTest(resp('b1', 10, 5), { b1: 10 });
  assert.equal(r.estimate, 5);
  assert.equal(r.ciLow, 5);
  assert.equal(r.ciHigh, 5);
});

test('scoreTest: all nonsense words marked known -> RangeError (Review Focus 1)', () => {
  const responses = [...resp('b1', 20, 20), ...resp('', 5, 5, 'pseudo')];
  assert.throws(() => scoreTest(responses, { b1: 1000 }), RangeError);
});

test('scoreTest: empty bands are skipped, missing responses for a real band throw', () => {
  const r = scoreTest(resp('b1', 10, 10), { b1: 50, b2: 0 });
  assert.equal(r.bands.length, 1);
  assert.throws(() => scoreTest(resp('b1', 10, 10), { b1: 50, b2: 50 }), /no responses for band b2/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/pseudowords.js`**

```js
const ONSETS = ['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'sk', 'st', 'tr', 'kl', 'br', 'fr'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'y', 'æ', 'ø', 'å', 'ei', 'au'];
const END_CODAS = ['', 'n', 'r', 'l', 't', 'k', 'm', 's', 'g', 'nd', 'st', 'rk', 'ld'];
const MID_CODAS = ['', 'n', 'r', 'l', 't'];

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

export function generatePseudoWords(count, rng, realWords) {
  const real = new Set(realWords.map((w) => w.toLowerCase()));
  const out = new Set();
  let guard = 0;
  while (out.size < count) {
    if (++guard > count * 200 + 1000) throw new Error('could not generate enough pseudo-words');
    const syllables = 2 + Math.floor(rng() * 2);
    let w = '';
    for (let i = 0; i < syllables; i++) {
      w += pick(ONSETS, rng) + pick(VOWELS, rng) + pick(i === syllables - 1 ? END_CODAS : MID_CODAS, rng);
    }
    if (w.length < 4 || real.has(w)) continue;
    out.add(w);
  }
  return [...out];
}
```

- [ ] **Step 4: Implement `src/estimator.js`**

```js
import { shuffle } from './rng.js';
import { generatePseudoWords } from './pseudowords.js';

export const BANDS = [
  { id: 'b1', from: 1, to: 1000 },
  { id: 'b2', from: 1001, to: 2000 },
  { id: 'b3', from: 2001, to: 4000 },
  { id: 'b4', from: 4001, to: 8000 },
  { id: 'b5', from: 8001, to: 16000 },
  { id: 'b6', from: 16001, to: 32000 },
  { id: 'b7', from: 32001, to: 64000 },
];

const Z95 = 1.96;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function bandOf(rank) {
  return BANDS.find((b) => rank >= b.from && rank <= b.to) ?? null;
}

export function bandSizes(words) {
  const sizes = Object.fromEntries(BANDS.map((b) => [b.id, 0]));
  for (const w of words) {
    const b = bandOf(w.rank);
    if (b) sizes[b.id]++;
  }
  return sizes;
}

export function sampleTest(words, rng, { perBand = 20, pseudoRatio = 0.2 } = {}) {
  if (words.length === 0) throw new Error('no words to sample');
  const items = [];
  for (const band of BANDS) {
    const pool = words.filter((w) => bandOf(w.rank)?.id === band.id);
    for (const w of shuffle(pool, rng).slice(0, perBand)) {
      items.push({ kind: 'word', band: band.id, wordId: w.id, text: w.lemma });
    }
  }
  const nPseudo = Math.ceil(items.length * pseudoRatio);
  const pseudo = generatePseudoWords(nPseudo, rng, words.map((w) => w.lemma));
  for (const text of pseudo) items.push({ kind: 'pseudo', band: null, text });
  return shuffle(items, rng);
}

export function scoreTest(responses, sizes) {
  const pseudo = responses.filter((r) => r.kind === 'pseudo');
  const f = pseudo.length ? pseudo.filter((r) => r.known).length / pseudo.length : 0;
  if (f >= 1) throw new RangeError('false-alarm rate is 100%: estimate is undefined');

  let estimate = 0;
  let variance = 0;
  let listSize = 0;
  const bands = [];
  for (const band of BANDS) {
    const size = sizes[band.id] ?? 0;
    if (size === 0) continue;
    listSize += size;
    const rs = responses.filter((r) => r.kind === 'word' && r.band === band.id);
    if (rs.length === 0) throw new Error(`no responses for band ${band.id}`);
    const n = rs.length;
    const k = rs.filter((r) => r.known).length;
    const p = k / n;
    const pCorrected = clamp((p - f) / (1 - f), 0, 1);
    estimate += size * pCorrected;
    const fpc = Math.max(0, 1 - n / size);
    variance += (size * size * ((p * (1 - p)) / n) * fpc) / (1 - f) ** 2;
    bands.push({ band: band.id, size, sampled: n, known: k, pCorrected });
  }
  const sd = Math.sqrt(variance);
  return {
    estimate: Math.round(estimate),
    ciLow: Math.round(clamp(estimate - Z95 * sd, 0, listSize)),
    ciHigh: Math.round(clamp(estimate + Z95 * sd, 0, listSize)),
    falseAlarmRate: f,
    pseudoTotal: pseudo.length,
    listSize,
    bands,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test`
Expected: all PASS. If a CI-bound assertion fails by more than the tolerance, recompute by hand: sd = 1000·√(0.25/20·(1−20/1000)) ≈ 110.7 → ±217.

- [ ] **Step 6: Show diff to user; commit after OK**

```bash
git add src/pseudowords.js src/estimator.js tests/pseudowords.test.js tests/estimator.test.js
git commit -m "feat: add vocabulary-size estimator with guess correction and pseudo-words"
```

---

### Task 4: Backup serialisation and validation (`backup.js`)

**Files:**
- Create: `src/backup.js`
- Test: `tests/backup.test.js`

**Interfaces:**
- Consumes: `GRADES` from `src/srs.js`.
- Produces: `BACKUP_VERSION = 1`; `serialize({cards, reviews, tests}, now): string`; `parseBackup(text): {cards, reviews, tests}` (throws `Error` with a readable message on any problem).

- [ ] **Step 1: Write the failing test** `tests/backup.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parseBackup, BACKUP_VERSION } from '../src/backup.js';

const state = {
  cards: [{ wordId: 1, ease: 2.5, interval: 6, reps: 2, lapses: 0, due: 1000 }],
  reviews: [{ wordId: 1, timestamp: 900, grade: 'good', ms: 2500, prevInterval: 1 }],
  tests: [{ timestamp: 800, estimate: 4200, ciLow: 3900, ciHigh: 4500, bands: [] }],
};

test('round trip preserves data', () => {
  const text = serialize(state, Date.UTC(2026, 9, 10));
  assert.equal(JSON.parse(text).version, BACKUP_VERSION);
  assert.deepEqual(parseBackup(text), state);
});

test('rejects non-JSON', () => {
  assert.throws(() => parseBackup('not json {'), /not valid JSON/);
});

test('rejects wrong version and non-objects', () => {
  assert.throws(() => parseBackup(JSON.stringify({ version: 99, cards: [], reviews: [], tests: [] })), /Unsupported backup version: 99/);
  assert.throws(() => parseBackup('[]'), /Unsupported backup version/);
  assert.throws(() => parseBackup('null'), /not a backup/);
});

test('rejects missing arrays', () => {
  assert.throws(() => parseBackup(JSON.stringify({ version: 1, cards: [], reviews: [] })), /"tests" must be an array/);
});

test('rejects malformed rows', () => {
  const bad = (patch) => JSON.stringify({ version: 1, ...state, ...patch });
  assert.throws(() => parseBackup(bad({ cards: [{ wordId: 1 }] })), /card/);
  assert.throws(() => parseBackup(bad({ reviews: [{ wordId: 1, timestamp: 1, grade: 'wow' }] })), /review/);
  assert.throws(() => parseBackup(bad({ tests: [{ timestamp: 'x', estimate: 1 }] })), /test/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/backup.js`**

```js
import { GRADES } from './srs.js';

export const BACKUP_VERSION = 1;

const num = (x) => typeof x === 'number' && Number.isFinite(x);

export function serialize({ cards, reviews, tests }, now) {
  return JSON.stringify(
    { version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), cards, reviews, tests },
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
  if (data.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${data.version}`);
  for (const key of ['cards', 'reviews', 'tests']) {
    if (!Array.isArray(data[key])) throw new Error(`Backup field "${key}" must be an array`);
  }
  data.cards.forEach((c, i) => {
    const ok = c && c.wordId !== undefined && c.wordId !== null && num(c.ease) && num(c.interval) && num(c.due);
    if (!ok) throw new Error(`Invalid card at index ${i}`);
  });
  data.reviews.forEach((r, i) => {
    const ok = r && r.wordId !== undefined && r.wordId !== null && num(r.timestamp) && r.grade in GRADES;
    if (!ok) throw new Error(`Invalid review at index ${i}`);
  });
  data.tests.forEach((t, i) => {
    if (!(t && num(t.timestamp) && num(t.estimate))) throw new Error(`Invalid test at index ${i}`);
  });
  return { cards: data.cards, reviews: data.reviews, tests: data.tests };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Show diff to user; commit after OK**

```bash
git add src/backup.js tests/backup.test.js
git commit -m "feat: add backup serialisation with strict validation"
```

---

### Task 5: Word schema validator and sample word list

**Files:**
- Create: `src/wordsSchema.js`, `data/words.json`
- Test: `tests/wordsSchema.test.js`

**Interfaces:**
- Consumes: `bandOf` from `src/estimator.js`.
- Produces: `validateWords(words): string[]` (empty array = valid). Word record: `{id, lemma, rank, pos, gloss_en, def_no, forms[], notes, collocations[], examples:[{no,en}]}`.

`data/words.json` is a **14-word SAMPLE** (two per band, illustrative ranks) so the app is usable end-to-end. The real frequency list is a separate follow-up (word-list licence still open). **The user should proofread these Norwegian entries.**

- [ ] **Step 1: Write the failing test** `tests/wordsSchema.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWords } from '../src/wordsSchema.js';
import { BANDS, bandOf } from '../src/estimator.js';

const good = () => ({
  id: 1, lemma: 'hus', rank: 310, pos: 'noun', gloss_en: 'house', def_no: 'Bygning.',
  forms: ['hus'], notes: '', collocations: [], examples: [{ no: 'Et hus.', en: 'A house.' }],
});

test('data/words.json is valid and covers every band', async () => {
  const words = JSON.parse(await readFile(new URL('../data/words.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateWords(words), []);
  for (const b of BANDS) assert.ok(words.some((w) => bandOf(w.rank)?.id === b.id), `no word in ${b.id}`);
});

test('accepts a good record', () => assert.deepEqual(validateWords([good()]), []));

test('rejects non-array and empty list', () => {
  assert.ok(validateWords({}).length > 0);
  assert.ok(validateWords([]).length > 0);
});

test('rejects duplicate ids, duplicate ranks, bad ranks', () => {
  const a = good(), b = { ...good(), lemma: 'gå' };
  assert.ok(validateWords([a, b]).some((e) => /duplicate id/.test(e)));
  const c = { ...good(), id: 2, lemma: 'gå' };
  assert.ok(validateWords([a, c]).some((e) => /duplicate rank/.test(e)));
  assert.ok(validateWords([{ ...good(), rank: 0 }]).some((e) => /rank/.test(e)));
  assert.ok(validateWords([{ ...good(), rank: 1.5 }]).some((e) => /rank/.test(e)));
});

test('rejects missing glosses, definitions and examples', () => {
  assert.ok(validateWords([{ ...good(), gloss_en: '' }]).some((e) => /gloss_en/.test(e)));
  assert.ok(validateWords([{ ...good(), def_no: ' ' }]).some((e) => /def_no/.test(e)));
  assert.ok(validateWords([{ ...good(), examples: [] }]).some((e) => /examples/.test(e)));
  assert.ok(validateWords([{ ...good(), examples: [{ no: 'x' }] }]).some((e) => /examples/.test(e)));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/wordsSchema.js`**

```js
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

export function validateWords(words) {
  if (!Array.isArray(words)) return ['word list must be an array'];
  if (words.length === 0) return ['word list is empty'];
  const errors = [];
  const ids = new Set();
  const ranks = new Set();
  words.forEach((w, i) => {
    const tag = `word #${i} (${w?.lemma ?? '?'})`;
    if (w?.id === undefined || w?.id === null) errors.push(`${tag}: missing id`);
    else if (ids.has(w.id)) errors.push(`${tag}: duplicate id ${w.id}`);
    else ids.add(w.id);
    if (!Number.isInteger(w?.rank) || w.rank < 1) errors.push(`${tag}: rank must be a positive integer`);
    else if (ranks.has(w.rank)) errors.push(`${tag}: duplicate rank ${w.rank}`);
    else ranks.add(w.rank);
    for (const key of ['lemma', 'pos', 'gloss_en', 'def_no']) {
      if (!nonEmpty(w?.[key])) errors.push(`${tag}: ${key} must be a non-empty string`);
    }
    if (!Array.isArray(w?.forms)) errors.push(`${tag}: forms must be an array`);
    if (!Array.isArray(w?.collocations)) errors.push(`${tag}: collocations must be an array`);
    const ex = w?.examples;
    if (!Array.isArray(ex) || ex.length === 0 || !ex.every((e) => nonEmpty(e?.no) && nonEmpty(e?.en))) {
      errors.push(`${tag}: examples must be a non-empty array of {no, en}`);
    }
  });
  return errors;
}
```

- [ ] **Step 4: Create `data/words.json`** (sample list, UTF-8)

```json
[
  { "id": 1, "lemma": "gå", "rank": 120, "pos": "verb", "gloss_en": "to walk; to go",
    "def_no": "Bevege seg framover på bena.",
    "forms": ["gå", "går", "gikk", "gått"],
    "notes": "Brukes også om tid og apparater: «Klokka går», «Toget går kl. 8».",
    "collocations": ["gå tur", "gå på skole", "gå i stykker"],
    "examples": [{ "no": "Hun går til jobben hver dag.", "en": "She walks to work every day." }] },
  { "id": 2, "lemma": "hus", "rank": 310, "pos": "noun (et)", "gloss_en": "house; building",
    "def_no": "Bygning som folk bor eller arbeider i.",
    "forms": ["hus", "huset", "hus", "husene"],
    "notes": "Intetkjønn: et hus. Flertall er lik entall: to hus.",
    "collocations": ["bygge hus", "kjøpe hus", "hus og hjem"],
    "examples": [{ "no": "Vi bor i et gammelt hus ved sjøen.", "en": "We live in an old house by the sea." }] },
  { "id": 3, "lemma": "ansvar", "rank": 1450, "pos": "noun (et)", "gloss_en": "responsibility",
    "def_no": "Plikt til å svare for noe og ta konsekvensene av det.",
    "forms": ["ansvar", "ansvaret", "ansvar", "ansvarene"],
    "notes": "Intetkjønn. Ofte «ta ansvar» og «ha ansvar for».",
    "collocations": ["ta ansvar", "ha ansvar for noe", "fraskrive seg ansvar"],
    "examples": [{ "no": "Du må ta ansvar for det du har gjort.", "en": "You have to take responsibility for what you have done." }] },
  { "id": 4, "lemma": "forskjell", "rank": 1800, "pos": "noun (en)", "gloss_en": "difference",
    "def_no": "Det som gjør at to ting ikke er like.",
    "forms": ["forskjell", "forskjellen", "forskjeller", "forskjellene"],
    "notes": "«Det gjør ingen forskjell» = it makes no difference.",
    "collocations": ["stor forskjell", "gjøre en forskjell", "forskjell på A og B"],
    "examples": [{ "no": "Det er stor forskjell på bokmål og nynorsk.", "en": "There is a big difference between Bokmål and Nynorsk." }] },
  { "id": 5, "lemma": "tilfeldig", "rank": 2600, "pos": "adjective", "gloss_en": "random; coincidental",
    "def_no": "Som skjer uten plan eller årsak.",
    "forms": ["tilfeldig", "tilfeldig", "tilfeldige"],
    "notes": "Adverb: tilfeldigvis (by chance).",
    "collocations": ["tilfeldig valgt", "et tilfeldig møte", "helt tilfeldig"],
    "examples": [{ "no": "Vi møttes helt tilfeldig på toget.", "en": "We met completely by chance on the train." }] },
  { "id": 6, "lemma": "oppdage", "rank": 3100, "pos": "verb", "gloss_en": "to discover; to notice",
    "def_no": "Få øye på eller finne ut noe som en ikke visste fra før.",
    "forms": ["oppdage", "oppdager", "oppdaget", "oppdaget"],
    "notes": "Brukes også om å legge merke til noe: «Jeg oppdaget at lommeboka var borte».",
    "collocations": ["oppdage en feil", "bli oppdaget", "oppdage for sent"],
    "examples": [{ "no": "Jeg oppdaget for sent at jeg hadde glemt billetten.", "en": "I noticed too late that I had forgotten the ticket." }] },
  { "id": 7, "lemma": "forbruker", "rank": 5200, "pos": "noun (en)", "gloss_en": "consumer",
    "def_no": "Person som kjøper og bruker varer og tjenester.",
    "forms": ["forbruker", "forbrukeren", "forbrukere", "forbrukerne"],
    "notes": "Vanlig i sammensetninger: forbrukerrettigheter, forbrukerråd.",
    "collocations": ["forbrukerrettigheter", "norske forbrukere", "forbrukernes interesser"],
    "examples": [{ "no": "Forbrukerne ønsker lavere priser.", "en": "Consumers want lower prices." }] },
  { "id": 8, "lemma": "bærekraftig", "rank": 6100, "pos": "adjective", "gloss_en": "sustainable",
    "def_no": "Som kan fortsette over lang tid uten å tømme ressursene eller skade miljøet.",
    "forms": ["bærekraftig", "bærekraftig", "bærekraftige"],
    "notes": "Substantiv: bærekraft.",
    "collocations": ["bærekraftig utvikling", "bærekraftig landbruk", "bærekraftige løsninger"],
    "examples": [{ "no": "Kommunen satser på bærekraftige løsninger for transport.", "en": "The municipality is investing in sustainable transport solutions." }] },
  { "id": 9, "lemma": "utålmodig", "rank": 9500, "pos": "adjective", "gloss_en": "impatient",
    "def_no": "Som ikke orker å vente og vil ha ting til å skje raskt.",
    "forms": ["utålmodig", "utålmodig", "utålmodige"],
    "notes": "Motsatt: tålmodig. Substantiv: utålmodighet.",
    "collocations": ["bli utålmodig", "vente utålmodig"],
    "examples": [{ "no": "Barna ventet utålmodig på julaften.", "en": "The children waited impatiently for Christmas Eve." }] },
  { "id": 10, "lemma": "vedtekt", "rank": 11000, "pos": "noun (en/ei)", "gloss_en": "statute; bylaw",
    "def_no": "Skrevet regel for hvordan en forening eller organisasjon skal fungere.",
    "forms": ["vedtekt", "vedtekten", "vedtekter", "vedtektene"],
    "notes": "Oftest i flertall: foreningens vedtekter.",
    "collocations": ["endre vedtektene", "i henhold til vedtektene", "foreningens vedtekter"],
    "examples": [{ "no": "Ifølge vedtektene skal årsmøtet holdes i mars.", "en": "According to the bylaws, the annual meeting is to be held in March." }] },
  { "id": 11, "lemma": "sjenerøs", "rank": 17000, "pos": "adjective", "gloss_en": "generous",
    "def_no": "Som gir gjerne og mye, for eksempel penger, tid eller omtanke.",
    "forms": ["sjenerøs", "sjenerøst", "sjenerøse"],
    "notes": "Brukes også om ting: en sjenerøs porsjon.",
    "collocations": ["sjenerøs gave", "sjenerøs med tiden", "en sjenerøs porsjon"],
    "examples": [{ "no": "Onkelen min er alltid sjenerøs når det gjelder gaver.", "en": "My uncle is always generous when it comes to gifts." }] },
  { "id": 12, "lemma": "ruvende", "rank": 24000, "pos": "adjective", "gloss_en": "towering; imposing",
    "def_no": "Som er stor og trekker oppmerksomhet til seg.",
    "forms": ["ruvende"],
    "notes": "Kommer av verbet «å ruve»; ofte om fjell, bygninger eller personer.",
    "collocations": ["en ruvende skikkelse", "et ruvende fjell"],
    "examples": [{ "no": "En ruvende skikkelse sto i døråpningen.", "en": "An imposing figure stood in the doorway." }] },
  { "id": 13, "lemma": "sneversynt", "rank": 36000, "pos": "adjective", "gloss_en": "narrow-minded",
    "def_no": "Som har et begrenset syn og ikke vil se andre synspunkter.",
    "forms": ["sneversynt", "sneversynt", "sneversynte"],
    "notes": "Motsatt: vidsynt.",
    "collocations": ["en sneversynt holdning", "sneversynt syn på noe"],
    "examples": [{ "no": "Det er sneversynt å avvise ideen uten å høre argumentene.", "en": "It is narrow-minded to reject the idea without hearing the arguments." }] },
  { "id": 14, "lemma": "langtekkelig", "rank": 40000, "pos": "adjective", "gloss_en": "tedious; long-winded",
    "def_no": "Som er lang og kjedelig å lese eller høre på.",
    "forms": ["langtekkelig", "langtekkelig", "langtekkelige"],
    "notes": "Ofte om tekster, taler eller forklaringer.",
    "collocations": ["en langtekkelig forklaring", "langtekkelig prat"],
    "examples": [{ "no": "Foredraget var langtekkelig og uten poeng.", "en": "The lecture was tedious and pointless." }] }
]
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Show diff to user (ask them to proofread `data/words.json`); commit after OK**

```bash
git add src/wordsSchema.js data/words.json tests/wordsSchema.test.js
git commit -m "feat: add word-list schema validator and 14-word sample list"
```

---

### Task 6: Dashboard statistics (`stats.js`)

**Files:**
- Create: `src/stats.js`
- Test: `tests/stats.test.js`

**Interfaces:**
- Produces:
  - `vocabSeries(tests): {t, estimate, ciLow, ciHigh}[]` sorted by time
  - `dailyAccuracy(reviews, tzOffsetMs=0): {day:'YYYY-MM-DD', reviews, accuracy}[]` (accuracy = share with grade ≠ `again`)
  - `streakDays(reviews, now, tzOffsetMs=0): number` (consecutive days with ≥1 review, ending today, or yesterday if none today)
  - `MATURE_DAYS = 21`; `retentionRate(reviews): number|null` (recall share among reviews whose `prevInterval ≥ 21`)
  - `studyMinutes(reviews): number`
  - `bandProfile(test|undefined): {band, known}[]`

- [ ] **Step 1: Write the failing test** `tests/stats.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vocabSeries, dailyAccuracy, streakDays, retentionRate, studyMinutes, bandProfile } from '../src/stats.js';

const H = 3600000;
const at = (d, h = 12) => Date.UTC(2026, 9, d, h);
const rv = (timestamp, grade = 'good', extra = {}) => ({ wordId: 1, timestamp, grade, ms: 0, ...extra });

test('vocabSeries sorts by time and projects fields', () => {
  const s = vocabSeries([
    { timestamp: 20, estimate: 2, ciLow: 1, ciHigh: 3, bands: [] },
    { timestamp: 10, estimate: 1, ciLow: 0, ciHigh: 2, bands: [] },
  ]);
  assert.deepEqual(s, [
    { t: 10, estimate: 1, ciLow: 0, ciHigh: 2 },
    { t: 20, estimate: 2, ciLow: 1, ciHigh: 3 },
  ]);
  assert.deepEqual(vocabSeries([]), []);
});

test('dailyAccuracy groups by local day and excludes "again" from recall', () => {
  const out = dailyAccuracy([rv(at(9)), rv(at(9), 'again'), rv(at(10)), rv(at(10)), rv(at(10), 'easy')]);
  assert.deepEqual(out, [
    { day: '2026-10-09', reviews: 2, accuracy: 0.5 },
    { day: '2026-10-10', reviews: 3, accuracy: 1 },
  ]);
});

test('streakDays counts consecutive days ending today or yesterday', () => {
  assert.equal(streakDays([], at(10)), 0);
  assert.equal(streakDays([rv(at(9)), rv(at(10))], at(10)), 2);
  assert.equal(streakDays([rv(at(8)), rv(at(9))], at(10)), 2); // none today yet, yesterday counts
  assert.equal(streakDays([rv(at(8))], at(10)), 0); // two days missed
  assert.equal(streakDays([rv(at(8)), rv(at(10))], at(10)), 1); // gap breaks it
});

test('streakDays respects the timezone offset', () => {
  const reviews = [rv(Date.UTC(2026, 9, 9, 23)), rv(Date.UTC(2026, 9, 10, 1))];
  const now = Date.UTC(2026, 9, 10, 12);
  assert.equal(streakDays(reviews, now, 0), 2);
  assert.equal(streakDays(reviews, now, 2 * H), 1); // both fall on local Oct 10
});

test('retentionRate uses only mature reviews; null when none', () => {
  assert.equal(retentionRate([rv(1, 'good', { prevInterval: 5 })]), null);
  const reviews = [
    rv(1, 'good', { prevInterval: 30 }),
    rv(2, 'again', { prevInterval: 21 }),
    rv(3, 'easy', { prevInterval: 40 }),
    rv(4, 'again', { prevInterval: 3 }),
    rv(5, 'good'),
  ];
  assert.equal(retentionRate(reviews), 2 / 3);
});

test('studyMinutes sums milliseconds; tolerates missing ms', () => {
  assert.equal(studyMinutes([rv(1, 'good', { ms: 30000 }), rv(2, 'good', { ms: 90000 }), { timestamp: 3, grade: 'good' }]), 2);
});

test('bandProfile maps the latest test, empty for none', () => {
  assert.deepEqual(bandProfile(undefined), []);
  assert.deepEqual(bandProfile({ bands: [{ band: 'b1', pCorrected: 0.9, size: 10, sampled: 5, known: 4 }] }), [{ band: 'b1', known: 0.9 }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/stats.js`**

```js
const DAY = 86400000;
export const MATURE_DAYS = 21;

const dayKey = (t, off) => Math.floor((t + off) / DAY);

export function vocabSeries(tests) {
  return [...tests]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((t) => ({ t: t.timestamp, estimate: t.estimate, ciLow: t.ciLow, ciHigh: t.ciHigh }));
}

export function dailyAccuracy(reviews, tzOffsetMs = 0) {
  const byDay = new Map();
  for (const r of reviews) {
    const k = dayKey(r.timestamp, tzOffsetMs);
    const e = byDay.get(k) ?? { reviews: 0, recalled: 0 };
    e.reviews++;
    if (r.grade !== 'again') e.recalled++;
    byDay.set(k, e);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, e]) => ({
      day: new Date(k * DAY).toISOString().slice(0, 10),
      reviews: e.reviews,
      accuracy: e.recalled / e.reviews,
    }));
}

export function streakDays(reviews, now, tzOffsetMs = 0) {
  const days = new Set(reviews.map((r) => dayKey(r.timestamp, tzOffsetMs)));
  let d = dayKey(now, tzOffsetMs);
  if (!days.has(d)) d -= 1;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

export function retentionRate(reviews) {
  const mature = reviews.filter((r) => (r.prevInterval ?? 0) >= MATURE_DAYS);
  if (mature.length === 0) return null;
  return mature.filter((r) => r.grade !== 'again').length / mature.length;
}

export function studyMinutes(reviews) {
  return reviews.reduce((sum, r) => sum + (r.ms ?? 0), 0) / 60000;
}

export function bandProfile(test) {
  return test ? test.bands.map((b) => ({ band: b.band, known: b.pCorrected })) : [];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Show diff to user; commit after OK**

```bash
git add src/stats.js tests/stats.test.js
git commit -m "feat: add dashboard statistics (series, accuracy, streak, retention)"
```

---

### Task 7: Word search (`search.js`)

**Files:**
- Create: `src/search.js`
- Test: `tests/search.test.js`

**Interfaces:**
- Produces: `searchWords(words, query, limit=50): Word[]` — empty/blank query returns the first `limit` words by rank; otherwise lemma-prefix matches, then lemma-contains, then English-gloss-contains; each group ordered by rank; case-insensitive using the `nb` locale.

- [ ] **Step 1: Write the failing test** `tests/search.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWords } from '../src/search.js';

const w = (rank, lemma, gloss_en = '') => ({ id: rank, rank, lemma, gloss_en });
const words = [w(3, 'ørret', 'trout'), w(1, 'hus', 'house'), w(2, 'ære', 'honour'), w(4, 'åpen', 'open'), w(5, 'forhus', 'porch'), w(6, 'bolig', 'home; house')];
const lemmas = (r) => r.map((x) => x.lemma);

test('blank query returns words by rank, respecting the limit', () => {
  assert.deepEqual(lemmas(searchWords(words, '  ', 3)), ['hus', 'ære', 'ørret']);
});

test('matches Norwegian letters case-insensitively (Review Focus 5)', () => {
  assert.deepEqual(lemmas(searchWords(words, 'Ø')), ['ørret']);
  assert.deepEqual(lemmas(searchWords(words, 'ÆRE')), ['ære']);
  assert.deepEqual(lemmas(searchWords(words, 'å')), ['åpen']);
});

test('orders prefix matches before contains before gloss matches', () => {
  assert.deepEqual(lemmas(searchWords(words, 'hus')), ['hus', 'forhus', 'bolig']);
});

test('no match returns an empty array', () => {
  assert.deepEqual(searchWords(words, 'zzz'), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/search.js`**

```js
const norm = (s) => s.toLocaleLowerCase('nb').trim();

export function searchWords(words, query, limit = 50) {
  const byRank = [...words].sort((a, b) => a.rank - b.rank);
  const q = norm(query);
  if (q === '') return byRank.slice(0, limit);
  const starts = [], contains = [], gloss = [];
  for (const w of byRank) {
    const lemma = norm(w.lemma);
    if (lemma.startsWith(q)) starts.push(w);
    else if (lemma.includes(q)) contains.push(w);
    else if (norm(w.gloss_en ?? '').includes(q)) gloss.push(w);
  }
  return [...starts, ...contains, ...gloss].slice(0, limit);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Show diff to user; commit after OK**

```bash
git add src/search.js tests/search.test.js
git commit -m "feat: add Norwegian-aware word search"
```

---

### Task 8: Storage layer, app shell and routing

**Files:**
- Create: `src/db.js`, `src/dom.js`, `src/app.js`, `index.html`, `styles.css`

**Interfaces:**
- Consumes: `validateWords` from `src/wordsSchema.js`.
- Produces:
  - `db.js`: `openDb(): Promise<IDBDatabase>`, `getAll(db, store)`, `put(db, store, obj)`, `add(db, store, obj)`, `loadState(db): Promise<{cards,reviews,tests}>`, `replaceState(db, {cards,reviews,tests}): Promise<void>` (one transaction: clear + add, so a failure leaves old data intact). Stores: `cards` (keyPath `wordId`), `reviews` and `tests` (auto-increment).
  - `dom.js`: `h(tag, attrs, ...children): HTMLElement` — `onclick`-style keys become listeners, `class` sets className, children are text nodes (never `innerHTML`).
  - `app.js`: hash router. Each view module exports `render(root: HTMLElement, ctx: {words, db}): void|Promise<void>`. Routes: `/dashboard`, `/test`, `/review`, `/explore`, `/data`. Later tasks add their import + a `routes` entry.

No automated test (browser-only); verification is manual.

- [ ] **Step 1: Create `src/db.js`**

```js
const DB_NAME = 'nor-tutor';
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('cards', { keyPath: 'wordId' });
      db.createObjectStore('reviews', { autoIncrement: true });
      db.createObjectStore('tests', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function transact(db, stores, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    fn(t);
  });
}

export const getAll = (db, store) => request(db.transaction(store).objectStore(store).getAll());
export const put = (db, store, obj) => transact(db, [store], (t) => t.objectStore(store).put(obj));
export const add = (db, store, obj) => transact(db, [store], (t) => t.objectStore(store).add(obj));

export async function loadState(db) {
  const [cards, reviews, tests] = await Promise.all(['cards', 'reviews', 'tests'].map((s) => getAll(db, s)));
  return { cards, reviews, tests };
}

export function replaceState(db, { cards, reviews, tests }) {
  return transact(db, ['cards', 'reviews', 'tests'], (t) => {
    for (const [name, rows] of [['cards', cards], ['reviews', reviews], ['tests', tests]]) {
      const store = t.objectStore(name);
      store.clear();
      rows.forEach((r) => store.add(r));
    }
  });
}
```

- [ ] **Step 2: Create `src/dom.js`**

```js
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (value !== false && value !== null && value !== undefined) el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
```

- [ ] **Step 3: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Norsk Tutor</title>
  <link rel="stylesheet" href="styles.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>
<body>
  <nav id="nav">
    <a href="#/dashboard">Dashboard</a>
    <a href="#/test">Vocabulary test</a>
    <a href="#/review">Review</a>
    <a href="#/explore">Words</a>
    <a href="#/data">Data</a>
  </nav>
  <main id="app"><p>Loading…</p></main>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `styles.css`**

```css
:root {
  --bg: #fafaf7; --fg: #1d2330; --muted: #5f6877; --card: #ffffff; --line: #dcdfe5;
  --accent: #1f5fa8; --accent-fg: #ffffff; --bad: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #14181f; --fg: #e8eaee; --muted: #9aa3b2; --card: #1d232d; --line: #2d3542; --accent: #6aa8ee; --accent-fg: #0b1220; --bad: #f2928b; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
nav { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--card); }
nav a { color: var(--muted); text-decoration: none; padding: 4px 0; }
nav a.active { color: var(--fg); font-weight: 600; border-bottom: 2px solid var(--accent); }
main { max-width: 860px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.5rem; margin: 8px 0 16px; }
button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }
input[type=search], input[type=text] { font: inherit; padding: 8px; width: 100%; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--fg); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin: 12px 0; }
.big { font-size: 2.2rem; font-weight: 600; text-align: center; margin: 24px 0; }
.row { display: flex; flex-wrap: wrap; gap: 8px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.tile .num { font-size: 1.6rem; font-weight: 600; }
.tile .label, .muted { color: var(--muted); font-size: .9rem; }
.chart { position: relative; height: 260px; }
.error { color: var(--bad); }
ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li button { width: 100%; text-align: left; margin: 2px 0; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); }
```

- [ ] **Step 5: Create `src/app.js`**

```js
import { openDb } from './db.js';
import { h } from './dom.js';
import { validateWords } from './wordsSchema.js';

// Later tasks add: import * as test from './views/test.js'; and a routes entry.
const routes = {};

function home(root) {
  root.replaceChildren(
    h('h1', {}, 'Norsk Tutor'),
    h('p', {}, 'Use the menu above to take the vocabulary test, review words, or explore the word list.'),
  );
}

function showError(e) {
  document.getElementById('app').replaceChildren(h('p', { class: 'error' }, `Something went wrong: ${e.message}`));
}

async function main() {
  try {
    const [words, db] = await Promise.all([
      fetch('data/words.json').then((r) => {
        if (!r.ok) throw new Error(`data/words.json: HTTP ${r.status}`);
        return r.json();
      }),
      openDb(),
    ]);
    const errors = validateWords(words);
    if (errors.length) throw new Error(`Invalid word list: ${errors.slice(0, 3).join('; ')}`);
    const ctx = { words, db };
    const root = document.getElementById('app');
    const go = () => {
      const path = location.hash.slice(1) || '/dashboard';
      for (const a of document.querySelectorAll('#nav a')) {
        a.classList.toggle('active', a.getAttribute('href') === `#${path}`);
      }
      const view = routes[path];
      Promise.resolve(view ? view.render(root, ctx) : home(root)).catch(showError);
    };
    window.addEventListener('hashchange', go);
    go();
  } catch (e) {
    showError(e);
  }
}

main();
```

- [ ] **Step 6: Manual verification**

Run: `npm start`, open http://127.0.0.1:5173
Expected: nav bar and "Norsk Tutor" welcome page; browser console has no errors; DevTools → Application → IndexedDB shows `nor-tutor` with stores `cards`, `reviews`, `tests`. Stop the server (Ctrl+C) afterwards. Also run `npm test` (still PASS).

- [ ] **Step 7: Show diff to user; commit after OK**

```bash
git add index.html styles.css src/db.js src/dom.js src/app.js
git commit -m "feat: add IndexedDB layer, app shell and hash router"
```

---

### Task 9: Vocabulary test view

**Files:**
- Create: `src/views/test.js`
- Modify: `src/app.js` (import + route)

**Interfaces:**
- Consumes: `sampleTest`, `scoreTest`, `bandSizes` (estimator); `add` (db); `h` (dom).
- Produces: `render(root, ctx)`. Saves `{timestamp, estimate, ciLow, ciHigh, falseAlarmRate, pseudoTotal, listSize, bands}` to the `tests` store only on a successful score.

- [ ] **Step 1: Create `src/views/test.js`**

```js
import { h } from '../dom.js';
import { sampleTest, scoreTest, bandSizes } from '../estimator.js';
import { add } from '../db.js';

export function render(root, ctx) {
  const { words, db } = ctx;

  const intro = () =>
    root.replaceChildren(
      h('h1', {}, 'Vocabulary size test'),
      h('div', { class: 'card' },
        h('p', {}, 'You will see Norwegian words and some invented nonsense words. Answer "I know it" only if you could explain the word to someone. The nonsense words let the test correct for guessing.'),
        h('p', { class: 'muted' }, 'Words in this list: ' + words.length + '. Estimates are in units of this list, so they are comparable between tests.'),
        h('button', { class: 'primary', onclick: start }, 'Start test'),
      ),
    );

  function start() {
    const items = sampleTest(words, Math.random);
    const responses = [];
    let i = 0;
    const show = () => {
      if (i >= items.length) return finish(responses);
      const item = items[i];
      const answer = (known) => {
        responses.push({ kind: item.kind, band: item.band, known });
        i++;
        show();
      };
      root.replaceChildren(
        h('h1', {}, 'Vocabulary size test'),
        h('p', { class: 'muted' }, `Word ${i + 1} of ${items.length}`),
        h('div', { class: 'card' },
          h('div', { class: 'big' }, item.text),
          h('div', { class: 'row' },
            h('button', { class: 'primary', onclick: () => answer(true) }, 'I know it'),
            h('button', { onclick: () => answer(false) }, "I don't know it"),
          ),
        ),
      );
    };
    show();
  }

  async function finish(responses) {
    let result;
    try {
      result = scoreTest(responses, bandSizes(words));
    } catch (e) {
      const msg = e instanceof RangeError
        ? 'You marked every nonsense word as known, so the guessing correction cannot be computed. Nothing was saved. Please retake the test.'
        : e.message;
      root.replaceChildren(
        h('h1', {}, 'Result not available'),
        h('p', { class: 'error' }, msg),
        h('button', { onclick: intro }, 'Back'),
      );
      return;
    }
    await add(db, 'tests', { timestamp: Date.now(), ...result });
    root.replaceChildren(
      h('h1', {}, 'Your result'),
      h('div', { class: 'card' },
        h('div', { class: 'big' }, `≈ ${result.estimate.toLocaleString('en')} words`),
        h('p', { class: 'muted' }, `95% interval: ${result.ciLow.toLocaleString('en')} – ${result.ciHigh.toLocaleString('en')} of ${result.listSize.toLocaleString('en')} words in the list. You marked ${Math.round(result.falseAlarmRate * 100)}% of ${result.pseudoTotal} nonsense words as known.`),
        h('p', { class: 'muted' }, 'This counts word families in our list, not every compound or inflected form, so treat it as a comparable index rather than an absolute total.'),
      ),
      h('table', {},
        h('thead', {}, h('tr', {}, ['Band', 'Words in list', 'Sampled', 'Marked known', 'Corrected'].map((t) => h('th', {}, t)))),
        h('tbody', {}, result.bands.map((b) => h('tr', {},
          h('td', {}, b.band), h('td', {}, b.size), h('td', {}, b.sampled), h('td', {}, b.known), h('td', {}, `${Math.round(b.pCorrected * 100)}%`)))),
      ),
      h('p', {}, h('a', { href: '#/dashboard' }, 'See your progress →')),
    );
  }

  intro();
}
```

- [ ] **Step 2: Wire into `src/app.js`**

Add below the existing imports: `import * as test from './views/test.js';`
Replace `const routes = {};` with:
```js
const routes = { '/test': test };
```

- [ ] **Step 3: Manual verification**

Run: `npm start`, open `#/test`.
- Complete a test answering "I know it" to real words and "don't know" to nonsense → result page shows an estimate close to 14 (the sample list size) and a table; DevTools → IndexedDB → `tests` has one record.
- Retake answering "I know it" to **everything** → "Result not available" message, and `tests` still has only one record (Review Focus 1).

- [ ] **Step 4: Show diff to user; commit after OK**

```bash
git add src/views/test.js src/app.js
git commit -m "feat: add vocabulary-size test view"
```

---

### Task 10: Spaced-repetition review view

**Files:**
- Create: `src/views/review.js`
- Modify: `src/app.js` (import + route)

**Interfaces:**
- Consumes: `getAll`, `put`, `add` (db); `dueCards`, `review`, `GRADES` (srs); `h` (dom).
- Produces: `render(root, ctx)`. Writes updated card via `put(db,'cards',…)` and a review record `{wordId, timestamp, grade, ms, prevInterval}` via `add(db,'reviews',…)`.

- [ ] **Step 1: Create `src/views/review.js`**

```js
import { h } from '../dom.js';
import { getAll, put, add } from '../db.js';
import { dueCards, review, GRADES } from '../srs.js';

export async function render(root, { words, db }) {
  const byId = new Map(words.map((w) => [w.id, w]));
  const cards = await getAll(db, 'cards');

  if (cards.length === 0) {
    root.replaceChildren(
      h('h1', {}, 'Review'),
      h('p', {}, 'Your deck is empty. Open a word in ', h('a', { href: '#/explore' }, 'Words'), ' and choose "Add to review deck".'),
    );
    return;
  }

  const queue = dueCards(cards, Date.now()).filter((c) => byId.has(c.wordId));
  if (queue.length === 0) {
    root.replaceChildren(h('h1', {}, 'Review'), h('p', {}, `Nothing is due right now. ${cards.length} card(s) in your deck.`));
    return;
  }

  let i = 0;
  const total = queue.length;

  function show() {
    if (i >= total) {
      root.replaceChildren(h('h1', {}, 'Review'), h('p', {}, `Done: ${total} card(s) reviewed.`));
      return;
    }
    const card = queue[i];
    const word = byId.get(card.wordId);
    const startedAt = Date.now();
    const revealed = h('div', { hidden: true },
      h('p', {}, h('strong', {}, word.gloss_en)),
      h('p', {}, word.def_no),
      h('p', { class: 'muted' }, `${word.examples[0].no} — ${word.examples[0].en}`),
      h('div', { class: 'row' }, Object.keys(GRADES).map((g) =>
        h('button', { onclick: () => grade(g) }, g[0].toUpperCase() + g.slice(1)))),
    );
    const showBtn = h('button', { class: 'primary', onclick: () => { revealed.hidden = false; showBtn.hidden = true; } }, 'Show answer');

    async function grade(g) {
      const now = Date.now();
      await add(db, 'reviews', { wordId: card.wordId, timestamp: now, grade: g, ms: now - startedAt, prevInterval: card.interval });
      await put(db, 'cards', review(card, g, now));
      i++;
      show();
    }

    root.replaceChildren(
      h('h1', {}, 'Review'),
      h('p', { class: 'muted' }, `Card ${i + 1} of ${total}`),
      h('div', { class: 'card' }, h('div', { class: 'big' }, word.lemma), showBtn, revealed),
    );
  }

  show();
}
```

- [ ] **Step 2: Wire into `src/app.js`**

Add `import * as review from './views/review.js';` and extend routes:
```js
const routes = { '/test': test, '/review': review };
```

- [ ] **Step 3: Manual verification**

Run: `npm start`, open `#/review`.
- Empty deck → "Your deck is empty" message (Review Focus 3). (Cards can be added once Task 11 is done; re-verify the full flow there.)
- In DevTools console, insert a due card: open Application → IndexedDB → `cards` and add `{wordId: 1, ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0}` — or defer this check to Task 11.

- [ ] **Step 4: Show diff to user; commit after OK**

```bash
git add src/views/review.js src/app.js
git commit -m "feat: add spaced-repetition review view"
```

---

### Task 11: Word explorer view

**Files:**
- Create: `src/views/explore.js`
- Modify: `src/app.js` (import + route)

**Interfaces:**
- Consumes: `searchWords` (search); `getAll`, `put` (db); `newCard` (srs); `h` (dom).
- Produces: `render(root, ctx)` — search box, result list, detail panel (lemma, pos, forms, `gloss_en`, `def_no`, notes, collocations, examples) and an "Add to review deck" button that creates a card (disabled if already in the deck).

- [ ] **Step 1: Create `src/views/explore.js`**

```js
import { h } from '../dom.js';
import { searchWords } from '../search.js';
import { getAll, put } from '../db.js';
import { newCard } from '../srs.js';

export async function render(root, { words, db }) {
  const inDeck = new Set((await getAll(db, 'cards')).map((c) => c.wordId));
  const input = h('input', { type: 'search', placeholder: 'Search Norwegian or English…', 'aria-label': 'Search words' });
  const list = h('ul', { class: 'plain' });
  const detail = h('div', {});

  function showList() {
    const results = searchWords(words, input.value);
    list.replaceChildren(
      ...(results.length === 0
        ? [h('li', { class: 'muted' }, 'No matching words.')]
        : results.map((w) => h('li', {}, h('button', { onclick: () => showDetail(w) }, `${w.lemma} — ${w.gloss_en}`)))),
    );
  }

  function showDetail(w) {
    const addBtn = h('button', {
      class: 'primary',
      disabled: inDeck.has(w.id),
      onclick: async () => {
        await put(db, 'cards', newCard(w.id, Date.now()));
        inDeck.add(w.id);
        addBtn.disabled = true;
        addBtn.textContent = 'In your deck';
      },
    }, inDeck.has(w.id) ? 'In your deck' : 'Add to review deck');
    detail.replaceChildren(
      h('div', { class: 'card' },
        h('h2', {}, w.lemma, ' ', h('span', { class: 'muted' }, w.pos)),
        h('p', {}, h('strong', {}, w.gloss_en)),
        h('p', {}, w.def_no),
        w.forms.length ? h('p', { class: 'muted' }, 'Forms: ' + w.forms.join(', ')) : null,
        w.notes ? h('p', {}, w.notes) : null,
        w.collocations.length ? h('p', {}, h('strong', {}, 'Common phrases: '), w.collocations.join(' · ')) : null,
        h('h3', {}, 'Examples'),
        h('ul', {}, w.examples.map((e) => h('li', {}, e.no, h('br'), h('span', { class: 'muted' }, e.en)))),
        addBtn,
      ),
    );
  }

  input.addEventListener('input', showList);
  root.replaceChildren(h('h1', {}, 'Words'), input, detail, list);
  showList();
}
```

- [ ] **Step 2: Wire into `src/app.js`**

Add `import * as explore from './views/explore.js';` and routes:
```js
const routes = { '/test': test, '/review': review, '/explore': explore };
```

- [ ] **Step 3: Manual verification**

Run: `npm start`, open `#/explore`.
- All 14 words are listed; typing `Ø`/`å`/`bærekraft` filters correctly; typing `house` finds `hus`.
- Open `hus` → meaning, Norwegian definition, forms, phrases, example; click "Add to review deck" → button changes to "In your deck"; reload and reopen → still disabled.
- Add 2–3 words, go to `#/review`: reveal answer, grade; the card disappears from the queue; `reviews` store gets a record and `cards` entry's `due` moves forward. Return to `#/review` → "Nothing is due right now" (Review Focus 3).

- [ ] **Step 4: Show diff to user; commit after OK**

```bash
git add src/views/explore.js src/app.js
git commit -m "feat: add word explorer with add-to-deck"
```

---

### Task 12: Progress dashboard with charts

**Files:**
- Create: `src/charts.js`, `src/views/dashboard.js`
- Modify: `src/app.js` (import + route)

**Interfaces:**
- Consumes: `loadState` (db); `vocabSeries`, `dailyAccuracy`, `streakDays`, `retentionRate`, `studyMinutes`, `bandProfile` (stats); `h` (dom); global `Chart` (Chart.js).
- Produces: `charts.js`: `lineChart(canvas, labels, datasets)`, `barChart(canvas, labels, datasets, {horizontal=false, max}={})` — both return the `Chart` instance. `dashboard.js`: `render(root, ctx)` with tiles (latest estimate + interval, tests taken, streak, study minutes, retention) and three charts (vocabulary over time with interval lines; daily recall accuracy; latest-test knowledge by band). Shows empty-state text when there is no data; shows a notice if `Chart` failed to load (offline).

- [ ] **Step 1: Create `src/charts.js`**

```js
const base = (type, labels, datasets, options) => (canvas) =>
  new Chart(canvas, { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, ...options } });

export function lineChart(canvas, labels, datasets) {
  return base('line', labels, datasets, { scales: { y: { beginAtZero: true } }, interaction: { mode: 'index', intersect: false } })(canvas);
}

export function barChart(canvas, labels, datasets, { horizontal = false, max } = {}) {
  const valueAxis = { beginAtZero: true, ...(max !== undefined ? { max } : {}) };
  return base('bar', labels, datasets, {
    indexAxis: horizontal ? 'y' : 'x',
    scales: horizontal ? { x: valueAxis } : { y: valueAxis },
  })(canvas);
}
```

- [ ] **Step 2: Create `src/views/dashboard.js`**

```js
import { h } from '../dom.js';
import { loadState } from '../db.js';
import { vocabSeries, dailyAccuracy, streakDays, retentionRate, studyMinutes, bandProfile } from '../stats.js';
import { lineChart, barChart } from '../charts.js';

const fmt = (n) => Math.round(n).toLocaleString('en');
const tile = (label, value, sub) =>
  h('div', { class: 'card tile' }, h('div', { class: 'num' }, value), h('div', { class: 'label' }, label), sub ? h('div', { class: 'muted' }, sub) : null);
const chartCard = (title, canvas) => h('div', { class: 'card' }, h('h3', {}, title), h('div', { class: 'chart' }, canvas));

export async function render(root, { db }) {
  const { reviews, tests } = await loadState(db);
  const offset = -new Date().getTimezoneOffset() * 60000;
  const series = vocabSeries(tests);
  const latest = [...tests].sort((a, b) => b.timestamp - a.timestamp)[0];
  const retention = retentionRate(reviews);

  const tiles = h('div', { class: 'tiles' },
    tile('Estimated vocabulary', latest ? `≈ ${fmt(latest.estimate)}` : '—', latest ? `95%: ${fmt(latest.ciLow)}–${fmt(latest.ciHigh)}` : 'Take the vocabulary test'),
    tile('Tests taken', String(tests.length)),
    tile('Day streak', String(streakDays(reviews, Date.now(), offset))),
    tile('Minutes studied', fmt(studyMinutes(reviews))),
    tile('Retention (mature cards)', retention === null ? '—' : `${Math.round(retention * 100)}%`, retention === null ? 'Needs reviews of cards with 21+ day intervals' : null),
  );
  root.replaceChildren(h('h1', {}, 'Progress'), tiles);

  if (typeof Chart === 'undefined') {
    root.append(h('p', { class: 'error' }, 'Charts could not load (Chart.js is fetched from the internet). Tiles above still work.'));
    return;
  }

  const labelOf = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const canvases = [h('canvas'), h('canvas'), h('canvas')];
  const sections = [
    ['Vocabulary size over time', series.length === 0],
    ['Daily recall accuracy', reviews.length === 0],
    ['Knowledge by frequency band (latest test)', !latest],
  ].map(([title, empty], i) =>
    empty ? h('div', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted' }, 'No data yet.')) : chartCard(title, canvases[i]));
  root.append(...sections);

  if (series.length) {
    lineChart(canvases[0], series.map((s) => labelOf(s.t)), [
      { label: 'Estimate', data: series.map((s) => s.estimate), borderColor: '#1f5fa8', backgroundColor: '#1f5fa8', pointRadius: 4 },
      { label: 'Upper 95%', data: series.map((s) => s.ciHigh), borderColor: '#8aa4c4', borderDash: [5, 4], pointRadius: 0 },
      { label: 'Lower 95%', data: series.map((s) => s.ciLow), borderColor: '#8aa4c4', borderDash: [5, 4], pointRadius: 0 },
    ]);
  }
  if (reviews.length) {
    const days = dailyAccuracy(reviews, offset);
    barChart(canvases[1], days.map((d) => d.day), [
      { label: 'Recall accuracy (%)', data: days.map((d) => Math.round(d.accuracy * 100)), backgroundColor: '#1f5fa8' },
    ], { max: 100 });
  }
  if (latest) {
    const prof = bandProfile(latest);
    barChart(canvases[2], prof.map((p) => p.band), [
      { label: 'Words known (%)', data: prof.map((p) => Math.round(p.known * 100)), backgroundColor: '#1f5fa8' },
    ], { horizontal: true, max: 100 });
  }
}
```

- [ ] **Step 3: Wire into `src/app.js`**

Add `import * as dashboard from './views/dashboard.js';` and routes:
```js
const routes = { '/dashboard': dashboard, '/test': test, '/review': review, '/explore': explore };
```

- [ ] **Step 4: Manual verification**

Run: `npm start`, open `#/dashboard`.
- With a clean browser profile (or after clearing site data): tiles show "—"/0 and each chart card says "No data yet." (Review Focus 4).
- After one vocabulary test: estimate tile filled, vocabulary chart shows a single point plus the two dashed lines, band chart appears.
- After a review session: accuracy bar chart and minutes/streak tiles update.
- Block the Chart.js request (DevTools → Network → block `cdn.jsdelivr.net`) and reload: tiles render and the "Charts could not load" notice appears; no unhandled errors.

- [ ] **Step 5: Show diff to user; commit after OK**

```bash
git add src/charts.js src/views/dashboard.js src/app.js
git commit -m "feat: add progress dashboard with Chart.js charts"
```

---

### Task 13: Data export/import view and end-to-end check

**Files:**
- Create: `src/views/data.js`
- Modify: `src/app.js` (import + route), `README.md` (usage notes)

**Interfaces:**
- Consumes: `loadState`, `replaceState` (db); `serialize`, `parseBackup` (backup); `h` (dom).
- Produces: `render(root, ctx)` — "Export backup" downloads `nor-tutor-backup-YYYY-MM-DD.json`; "Import backup" reads a chosen file, validates with `parseBackup`, asks for confirmation (it replaces current data), then calls `replaceState`. On any error, shows the message and leaves existing data untouched.

- [ ] **Step 1: Create `src/views/data.js`**

```js
import { h } from '../dom.js';
import { loadState, replaceState } from '../db.js';
import { serialize, parseBackup } from '../backup.js';

export function render(root, { db }) {
  const status = h('p', { role: 'status' });
  const say = (msg, isError = false) => {
    status.textContent = msg;
    status.className = isError ? 'error' : 'muted';
  };

  async function exportBackup() {
    try {
      const now = Date.now();
      const text = serialize(await loadState(db), now);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = h('a', { href: url, download: `nor-tutor-backup-${new Date(now).toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      say('Backup downloaded.');
    } catch (e) {
      say(`Export failed: ${e.message}`, true);
    }
  }

  async function importBackup(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = parseBackup(await file.text());
      const summary = `${data.cards.length} cards, ${data.reviews.length} reviews, ${data.tests.length} tests`;
      if (!confirm(`Replace ALL current data with this backup (${summary})?`)) {
        say('Import cancelled. Nothing was changed.');
        return;
      }
      await replaceState(db, data);
      say(`Imported ${summary}.`);
    } catch (e) {
      say(`Import failed, nothing was changed: ${e.message}`, true);
    }
  }

  root.replaceChildren(
    h('h1', {}, 'Your data'),
    h('div', { class: 'card' },
      h('p', {}, 'Everything is stored in this browser only. Export a backup regularly.'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: exportBackup }, 'Export backup'),
        h('label', {}, h('span', { class: 'muted' }, 'Import backup: '), h('input', { type: 'file', accept: 'application/json,.json', onchange: importBackup })),
      ),
      status,
    ),
  );
}
```

- [ ] **Step 2: Wire into `src/app.js`**

Add `import * as data from './views/data.js';` and final routes:
```js
const routes = { '/dashboard': dashboard, '/test': test, '/review': review, '/explore': explore, '/data': data };
```

- [ ] **Step 3: Update `README.md`** — append:

```markdown
## Pages

- **Dashboard** – estimated vocabulary, streak, retention, charts
- **Vocabulary test** – frequency-band sample + nonsense words, guess-corrected estimate
- **Review** – spaced repetition for words you added from **Words**
- **Words** – search, meanings (English + Norwegian), forms, phrases, examples
- **Data** – JSON export / import

`data/words.json` is currently a 14-word sample; replace it with the full frequency list (same schema, see `src/wordsSchema.js`) once a licensed source is chosen.
```

- [ ] **Step 4: Manual end-to-end verification**

Run: `npm start` and `npm test`.
1. Take a test, add words, review a few, open the dashboard → all populated.
2. Data → Export → file downloads; open it and confirm it has `version`, `cards`, `reviews`, `tests`.
3. Import a text file renamed `.json` containing `hello` → error "Backup is not valid JSON"; dashboard numbers unchanged (Review Focus 2).
4. Import a JSON with `{"version": 99, ...}` → "Unsupported backup version: 99"; data unchanged.
5. Reset by clearing site data, import the exported file → confirm prompt shows counts, then dashboard matches step 1.
6. `npm test` → all PASS.

- [ ] **Step 5: Show diff to user; commit after OK**

```bash
git add src/views/data.js src/app.js README.md
git commit -m "feat: add data export/import view and docs"
```

---

## Self-Review

**Spec coverage**
- Vocabulary-size estimator (bands, pseudo-words, guess correction, CI, stored per test, caveat shown): Tasks 3, 9.
- Optional "pick the meaning" second step: deliberately **not** in this plan (spec marks it optional) — candidate follow-up.
- Word explorer with meaning/POS/forms/usage/collocations/examples, EN + NO: Tasks 5, 11.
- Spaced-repetition review: Tasks 2, 10.
- Dashboard (vocabulary over time, review accuracy, retention, streak/time, words by band): Tasks 6, 12.
- IndexedDB storage + JSON export/import: Tasks 4, 8, 13.
- Real frequency word list: **not in this plan** (licence unresolved); Task 5 ships a 14-word sample and README says so.

**Placeholder scan:** no TBD/TODO; every code step contains the code.

**Type consistency:** `Card` fields (`wordId, ease, interval, reps, lapses, due`), review records (`wordId, timestamp, grade, ms, prevInterval`), and test records (`timestamp, estimate, ciLow, ciHigh, falseAlarmRate, pseudoTotal, listSize, bands[{band,size,sampled,known,pCorrected}]`) are identical across `srs.js`, `estimator.js`, `backup.js`, `stats.js` and the views. `bandProfile` reads `pCorrected`, which `scoreTest` produces.

**Review Focus:** all five items map to a test or manual check (Tasks 3/9, 4/8/13, 10/11, 12, 7).

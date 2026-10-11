# Design Foundation and Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the portal a shared, accessible design system and a Dashboard with Today and Progress tabs that tells a first-time user what to do next.

**Architecture:** `styles.css` is rewritten around CSS variables and a small set of components that later screens reuse. Two pure functions in `src/stats.js` decide the next action and the getting-started ticks; `src/views/dashboard.js` renders them. Existing class names used by other views (`card`, `big`, `row`, `muted`, `error`, `plain`, `chart`, `notice`) keep working.

**Tech Stack:** Vanilla ES modules, plain CSS, Chart.js 4.4.1 from CDN (optional), `node:test`. No build step, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-design-foundation-dashboard-design.md`

## Global Constraints

- Zero dependencies, no build step; Chart.js stays optional (charts degrade to a notice offline).
- Meaning colours (definition blue, translation green, known teal, review amber, context purple) are always paired with a text label, never colour alone.
- AA text contrast in light and dark; visible `:focus-visible`; `prefers-reduced-motion` respected; layout works at 375px; interactive targets at least 44px high.
- Nav: sticky top bar, brand "Norsk Tutor", links Dashboard, Words, Test, Review, and Data as a quiet right-aligned link. Under 640px links scroll horizontally. Active link has `aria-current="page"`. Hash routes unchanged.
- Pure modules (`stats`, `srs`) must not touch `document`, `window`, `indexedDB` or `fetch`. Tests use fixed `Date.UTC(...)` timestamps, never `Date.now()`.
- **User control:** every task ends by showing `git diff --stat`; **do not commit until the user says OK.** Conventional Commits, ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run commands from `C:\Users\NOACA3\src\misc\nor-tutor`. Tests: `npm test`.

## Review Focus

1. **Completely empty database (first visit)** → hero says take the test, checklist shows 0 of 3, every chart shows a message with a button, no console errors. (Task 1 test; Task 3 manual.)
2. **A card due exactly at `now`** → counted as due. (Task 1 test.)
3. **Tests exist but no cards** → hero says "Explore new words", not "Review 0 cards". (Task 1 test.)
4. **Chart.js blocked or offline** → notice shown, tiles and Today tab still work. (Task 3 manual.)
5. **Charts inside the hidden Progress tab** → drawn on first show so they are not 0px wide. (Task 3 manual at 375px and desktop.)

---

### Task 1: `nextAction` and `gettingStarted` (pure)

**Files:**
- Modify: `src/stats.js` (append, plus one import line at top)
- Test: `tests/stats.test.js` (append, plus import change)

**Interfaces:**
- Consumes: `dueCards(cards, now)` from `src/srs.js`.
- Produces: `nextAction({ cards, reviews, tests }, now): { kind: 'test' | 'review' | 'explore', dueCount: number }`; `gettingStarted({ cards, reviews, tests }): { test: boolean, deck: boolean, review: boolean }`.

- [ ] **Step 1: Write failing tests.** In `tests/stats.test.js` change the import to

```js
import { vocabSeries, dailyAccuracy, streakDays, retentionRate, studyMinutes, bandProfile, nextAction, gettingStarted } from '../src/stats.js';
```

and append:

```js
const NOW = Date.UTC(2026, 9, 10, 12);
const card = (wordId, due) => ({ wordId, ease: 2.5, interval: 1, reps: 1, lapses: 0, due });
const aTest = { timestamp: 1, estimate: 1000, ciLow: 900, ciHigh: 1100, bands: [] };

test('nextAction: empty data points to the test (Review Focus 1)', () => {
  assert.deepEqual(nextAction({ cards: [], reviews: [], tests: [] }, NOW), { kind: 'test', dueCount: 0 });
  assert.deepEqual(gettingStarted({ cards: [], reviews: [], tests: [] }), { test: false, deck: false, review: false });
});

test('nextAction: due cards beat exploring, and a card due exactly now counts (Review Focus 2)', () => {
  const state = { cards: [card(1, NOW), card(2, NOW + 1)], reviews: [], tests: [aTest] };
  assert.deepEqual(nextAction(state, NOW), { kind: 'review', dueCount: 1 });
});

test('nextAction: tested but nothing due or no cards means explore (Review Focus 3)', () => {
  assert.deepEqual(nextAction({ cards: [], reviews: [], tests: [aTest] }, NOW), { kind: 'explore', dueCount: 0 });
  assert.deepEqual(nextAction({ cards: [card(1, NOW + 1)], reviews: [], tests: [aTest] }, NOW), { kind: 'explore', dueCount: 0 });
});

test('nextAction: untested user is sent to the test even with due cards', () => {
  assert.equal(nextAction({ cards: [card(1, NOW - 1)], reviews: [], tests: [] }, NOW).kind, 'test');
});

test('gettingStarted ticks each step from the data', () => {
  assert.deepEqual(gettingStarted({ cards: [card(1, NOW)], reviews: [rv(NOW)], tests: [aTest] }), { test: true, deck: true, review: true });
  assert.deepEqual(gettingStarted({ cards: [card(1, NOW)], reviews: [], tests: [] }), { test: false, deck: true, review: false });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/stats.test.js`
Expected: FAIL, `nextAction` is not exported.

- [ ] **Step 3: Implement.** At the top of `src/stats.js` add `import { dueCards } from './srs.js';` and append:

```js
export function nextAction({ cards, tests }, now) {
  if (tests.length === 0) return { kind: 'test', dueCount: 0 };
  const dueCount = dueCards(cards, now).length;
  return dueCount > 0 ? { kind: 'review', dueCount } : { kind: 'explore', dueCount: 0 };
}

export const gettingStarted = ({ cards, reviews, tests }) => ({
  test: tests.length > 0,
  deck: cards.length > 0,
  review: reviews.length > 0,
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Show `git diff --stat`; after the user's OK commit**

```bash
git add src/stats.js tests/stats.test.js
git commit -m "feat: next-action and getting-started logic for the dashboard" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Design system and navigation

**Files:**
- Modify: `styles.css` (whole file), `index.html` (nav block), `src/app.js` (the `a.classList.toggle('active', ...)` line inside `go`)

**Interfaces:**
- Produces CSS classes used by Task 3 and later parts: `.btn` (works on `a` and `button`), `.btn.primary`, `.btn.quiet`, `.badge`, `.badge.known|review|context|definition|translation`, `.chip`, `.tabs` / `.tab[aria-selected]`, `.progress`, `.empty`, `.tile`, `.hero`, `.steps`, `.sr` (screen-reader only), `.def` / `.trans` text colours. Existing classes `card big row muted error plain chart tiles notice` are preserved.

- [ ] **Step 1: Replace `styles.css`**

```css
:root {
  --bg: #f6f7f9; --fg: #1b2230; --muted: #566074; --card: #ffffff; --line: #d8dde6;
  --accent: #1f5fa8; --accent-fg: #ffffff; --bad: #b3261e;
  --def: #1a56a0; --trans: #176a38; --known: #0d6868; --review: #8a5200; --context: #6b3fa0;
  --radius: 12px; --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 40px;
  --focus: #1f5fa8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12161d; --fg: #e8eaee; --muted: #a2abba; --card: #1c222c; --line: #2f3745;
    --accent: #6aa8ee; --accent-fg: #0b1220; --bad: #f2928b;
    --def: #8fbcf5; --trans: #7ed3a0; --known: #6fd0d0; --review: #f0b455; --context: #c3a2ee;
    --focus: #8fbcf5;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { max-width: 900px; margin: 0 auto; padding: var(--s4); }
h1 { font-size: 1.6rem; line-height: 1.25; margin: var(--s3) 0 var(--s4); }
h2 { font-size: 1.25rem; margin: 0 0 var(--s2); }
h3 { font-size: 1.05rem; margin: 0 0 var(--s2); }
a { color: var(--accent); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* navigation */
nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: var(--s1); padding: 0 var(--s4); background: var(--card); border-bottom: 1px solid var(--line); overflow-x: auto; white-space: nowrap; scrollbar-width: thin; }
nav .brand { font-weight: 700; margin-right: var(--s4); color: var(--fg); text-decoration: none; }
nav a { color: var(--muted); text-decoration: none; padding: 0 var(--s3); min-height: 48px; display: inline-flex; align-items: center; border-bottom: 3px solid transparent; }
nav a:hover { color: var(--fg); }
nav a[aria-current=page] { color: var(--fg); font-weight: 600; border-bottom-color: var(--accent); }
nav a.quiet { margin-left: auto; font-size: .9rem; }

/* buttons */
.btn, button { font: inherit; min-height: 44px; padding: 0 var(--s4); border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: var(--s2); text-decoration: none; }
.btn:hover, button:hover { border-color: var(--muted); }
.btn.primary, button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); font-weight: 600; }
.btn.quiet, button.quiet { border-color: transparent; background: transparent; color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }
input[type=search], input[type=text] { font: inherit; min-height: 44px; padding: 0 var(--s3); width: 100%; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--fg); }

/* surfaces */
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--s4); margin: var(--s3) 0; }
.hero { padding: var(--s5); border-width: 2px; border-color: var(--accent); }
.hero p { margin: 0 0 var(--s4); color: var(--muted); max-width: 60ch; }
.big { font-size: 2.2rem; font-weight: 600; text-align: center; margin: var(--s5) 0; }
.row { display: flex; flex-wrap: wrap; gap: var(--s2); }
.muted, .tile .label { color: var(--muted); font-size: .9rem; }
.error { color: var(--bad); }
.notice { margin: 0; padding: var(--s2) var(--s4); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--accent) 14%, var(--card)); }
.empty { text-align: center; padding: var(--s5) var(--s4); color: var(--muted); }
.empty .btn { margin-top: var(--s3); }

/* tiles, charts */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--s3); }
.tiles .tile { margin: 0; }
.tile .num { font-size: 1.7rem; font-weight: 700; line-height: 1.2; }
.chart { position: relative; height: 260px; }

/* tabs */
.tabs { display: flex; gap: var(--s1); border-bottom: 1px solid var(--line); margin-bottom: var(--s3); }
.tab { border: 0; border-bottom: 3px solid transparent; border-radius: 0; background: transparent; color: var(--muted); padding: 0 var(--s4); }
.tab[aria-selected=true] { color: var(--fg); font-weight: 600; border-bottom-color: var(--accent); }

/* steps */
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s2); }
.steps li { display: flex; align-items: center; gap: var(--s3); min-height: 44px; }
.step-mark { flex: none; width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--line); display: inline-grid; place-items: center; font-size: .85rem; font-weight: 600; }
.steps li.done .step-mark { background: var(--known); border-color: var(--known); color: var(--card); }
.steps li.done a { color: var(--muted); }

/* badges, chips, meaning colours */
.badge, .chip { display: inline-flex; align-items: center; gap: var(--s1); padding: 2px var(--s3); border-radius: 999px; font-size: .85rem; border: 1px solid var(--line); background: var(--card); color: var(--fg); min-height: 0; }
.badge.definition { color: var(--def); border-color: currentColor; }
.badge.translation { color: var(--trans); border-color: currentColor; }
.badge.known { color: var(--known); border-color: currentColor; }
.badge.review { color: var(--review); border-color: currentColor; }
.badge.context { color: var(--context); border-color: currentColor; }
.def { color: var(--def); }
.trans { color: var(--trans); }
.progress { height: 10px; border-radius: 999px; background: var(--line); overflow: hidden; }
.progress > span { display: block; height: 100%; background: var(--accent); }

ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li button { width: 100%; justify-content: flex-start; margin: 2px 0; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: var(--s1) var(--s2); border-bottom: 1px solid var(--line); }
details { margin: var(--s3) 0; }
summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; }

@media (prefers-reduced-motion: no-preference) {
  .btn, button, nav a { transition: border-color .15s, background-color .15s, color .15s; }
}
@media (max-width: 640px) {
  main { padding: var(--s3); }
  .hero { padding: var(--s4); }
}
```

- [ ] **Step 2: Replace the `<nav>` block in `index.html`**

```html
  <nav id="nav" aria-label="Main">
    <a class="brand" href="#/dashboard">Norsk Tutor</a>
    <a href="#/dashboard">Dashboard</a>
    <a href="#/explore">Words</a>
    <a href="#/test">Test</a>
    <a href="#/review">Review</a>
    <a class="quiet" href="#/data">Data</a>
  </nav>
```

- [ ] **Step 3: Mark the active link.** In `src/app.js`, inside `go`, replace the line `a.classList.toggle('active', a.getAttribute('href') === `#${path}`);` with:

```js
        if (!a.classList.contains('brand')) {
          if (a.getAttribute('href') === `#${path}`) a.setAttribute('aria-current', 'page');
          else a.removeAttribute('aria-current');
        }
```

- [ ] **Step 4: Verify.** Run `npm test` (all PASS). Run `npm start`, open http://127.0.0.1:5173, click through every nav link: all five views still load, the active link is underlined, the bar stays at the top while scrolling, and at a 375px window width the links scroll sideways. Toggle the OS dark mode: text stays readable. Tab through the page with the keyboard: a focus ring is visible on every link and button.

- [ ] **Step 5: Show `git diff --stat`; after the user's OK commit**

```bash
git add styles.css index.html src/app.js
git commit -m "feat: shared design system and sticky navigation" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard with Today and Progress tabs

**Files:**
- Modify: `src/views/dashboard.js` (whole file)

**Interfaces:**
- Consumes: `loadState(db)` (`{ cards, reviews, tests, known }`); `nextAction`, `gettingStarted`, `vocabSeries`, `dailyAccuracy`, `streakDays`, `retentionRate`, `bandProfile` from `src/stats.js`; `lineChart`, `barChart`, `accent`, `softAccent` from `src/charts.js`; CSS classes from Task 2.
- Produces: `render(root, { db })` (same export as before).

- [ ] **Step 1: Replace `src/views/dashboard.js`**

```js
import { h } from '../dom.js';
import { loadState } from '../db.js';
import { vocabSeries, dailyAccuracy, streakDays, retentionRate, bandProfile, nextAction, gettingStarted } from '../stats.js';
import { lineChart, barChart, accent, softAccent } from '../charts.js';

const fmt = (n) => Math.round(n).toLocaleString('en');
const link = (href, label, cls = 'btn primary') => h('a', { class: cls, href }, label);
const tile = (label, value, caption) =>
  h('div', { class: 'card tile' }, h('div', { class: 'num' }, value), h('div', {}, label), h('div', { class: 'label' }, caption));
const emptyBlock = (message, href, label) => h('div', { class: 'empty' }, h('p', {}, message), link(href, label));
const chartCard = (title, explain, body) => h('div', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted' }, explain), body);

const heroFor = ({ kind, dueCount }) =>
  ({
    test: {
      title: 'Find out how many Norwegian words you know',
      text: 'A short test (about 3 minutes) estimates your vocabulary and gives you a starting point.',
      label: 'Take the vocabulary test',
      href: '#/test',
    },
    review: {
      title: `${dueCount} ${dueCount === 1 ? 'card is' : 'cards are'} ready to review`,
      text: 'A few minutes of review now keeps these words from fading.',
      label: `Review ${dueCount} ${dueCount === 1 ? 'card' : 'cards'}`,
      href: '#/review',
    },
    explore: {
      title: 'Nothing to review right now',
      text: 'Browse the word list and add words you want to learn to your deck.',
      label: 'Explore new words',
      href: '#/explore',
    },
  })[kind];

export async function render(root, { db }) {
  const state = await loadState(db);
  const { cards, reviews, tests } = state;
  const now = Date.now();
  const offset = -new Date().getTimezoneOffset() * 60000;
  const latest = [...tests].sort((a, b) => b.timestamp - a.timestamp)[0];
  const action = nextAction(state, now);
  const steps = gettingStarted(state);

  // Today tab
  const hero = heroFor(action);
  const stepList = [
    ['test', 'Take the vocabulary test', '#/test'],
    ['deck', 'Add words to your deck', '#/explore'],
    ['review', 'Do your first review', '#/review'],
  ];
  const doneCount = stepList.filter(([k]) => steps[k]).length;
  const today = h('div', { id: 'panel-today', role: 'tabpanel', 'aria-labelledby': 'tab-today' },
    h('section', { class: 'card hero' }, h('h2', {}, hero.title), h('p', {}, hero.text), link(hero.href, hero.label)),
    doneCount < 3
      ? h('section', { class: 'card' },
          h('h3', {}, `Getting started (${doneCount} of 3 done)`),
          h('ol', { class: 'steps' }, stepList.map(([k, label, href], i) =>
            h('li', { class: steps[k] ? 'done' : '' },
              h('span', { class: 'step-mark', 'aria-hidden': 'true' }, steps[k] ? '✓' : i + 1),
              link(href, label, ''),
              steps[k] ? h('span', { class: 'sr' }, ' (done)') : null))))
      : null,
    h('div', { class: 'tiles' },
      tile('Words in your deck', String(cards.length), 'Words you chose to learn'),
      tile('Due today', String(action.dueCount), 'Cards waiting for review'),
      tile('Day streak', String(streakDays(reviews, now, offset)), 'Days in a row you reviewed'),
      tile('Estimated vocabulary', latest ? `≈ ${fmt(latest.estimate)}` : '—', latest ? 'Words you probably know' : 'Take the test to see this'),
    ),
  );

  // Progress tab
  const retention = retentionRate(reviews);
  const canvases = [h('canvas'), h('canvas'), h('canvas')];
  const series = vocabSeries(tests);
  const charts = typeof Chart === 'undefined'
    ? [h('p', { class: 'error' }, 'Charts could not load (Chart.js is fetched from the internet). The Today tab still works.')]
    : [
        chartCard('How many words you know', 'Your estimated vocabulary after each test. The dashed lines show the likely range.',
          series.length ? h('div', { class: 'chart' }, canvases[0]) : emptyBlock('No test yet.', '#/test', 'Take the vocabulary test')),
        chartCard('Answers you remembered each day', 'The share of review answers that were not "Again". Higher means the words are sticking.',
          reviews.length ? h('div', { class: 'chart' }, canvases[1]) : emptyBlock('No reviews yet.', '#/review', 'Start a review')),
        chartCard('Which words you know, common to rare', 'Your latest test, split by how common the words are. Common words come first.',
          latest ? h('div', { class: 'chart' }, canvases[2]) : emptyBlock('No test yet.', '#/test', 'Take the vocabulary test')),
      ];
  const progress = h('div', { id: 'panel-progress', role: 'tabpanel', 'aria-labelledby': 'tab-progress', hidden: true },
    retention === null ? null : h('p', { class: 'muted' }, `Remembered after 3+ weeks: ${Math.round(retention * 100)}%`),
    charts,
    h('p', { class: 'muted' }, 'Estimates are based on your own answers, so they can run high if you over-claim.'),
    h('details', {},
      h('summary', {}, 'What do these numbers mean?'),
      h('p', {}, 'Likely range: the test only samples some words, so the estimate is a range, not an exact count.'),
      h('p', {}, 'Remembered after 3+ weeks: of the cards you had not seen for 21 days or more, the share you still got right.'),
      h('p', {}, 'Common to rare: words are grouped by how often they appear in Norwegian. Early groups hold the most common words.')),
  );

  // Charts are drawn on first show: Chart.js sizes itself to 0px inside a hidden panel.
  let drawn = false;
  function draw() {
    if (typeof Chart === 'undefined' || !root.isConnected) return;
    const main = accent();
    const faint = [{ borderColor: softAccent(), borderDash: [5, 4], pointRadius: series.length === 1 ? 3 : 0 }];
    if (series.length && canvases[0].isConnected) {
      lineChart(canvases[0], series.map((s) => new Date(s.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })), [
        { label: 'Estimate', data: series.map((s) => s.estimate), borderColor: main, backgroundColor: main, pointRadius: 4 },
        { label: 'Upper range', data: series.map((s) => s.ciHigh), ...faint[0] },
        { label: 'Lower range', data: series.map((s) => s.ciLow), ...faint[0] },
      ]);
    }
    if (reviews.length && canvases[1].isConnected) {
      const days = dailyAccuracy(reviews, offset);
      barChart(canvases[1], days.map((d) => d.day), [
        { label: 'Remembered (%)', data: days.map((d) => Math.round(d.accuracy * 100)), backgroundColor: main },
      ], { max: 100 });
    }
    if (latest && canvases[2].isConnected) {
      const prof = bandProfile(latest);
      barChart(canvases[2], prof.map((p) => p.band), [
        { label: 'Words known (%)', data: prof.map((p) => Math.round(p.known * 100)), backgroundColor: main },
      ], { horizontal: true, max: 100 });
    }
  }

  const tabs = [['today', 'Today', today], ['progress', 'Progress', progress]];
  const buttons = tabs.map(([key, label]) =>
    h('button', {
      class: 'tab', role: 'tab', id: `tab-${key}`, 'aria-controls': `panel-${key}`,
      onclick: () => select(key),
      onkeydown: (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const other = tabs.findIndex(([k]) => k !== key);
        select(tabs[other][0]);
        buttons[other].focus();
      },
    }, label));
  function select(key) {
    tabs.forEach(([k, , panel], i) => {
      buttons[i].setAttribute('aria-selected', String(k === key));
      buttons[i].tabIndex = k === key ? 0 : -1;
      panel.hidden = k !== key;
    });
    if (key === 'progress' && !drawn) {
      drawn = true;
      draw();
    }
  }

  root.replaceChildren(
    h('h1', {}, 'Dashboard'),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Dashboard sections' }, buttons),
    today,
    progress,
  );
  select('today');
}
```

- [ ] **Step 2: Verify on a fresh database (Review Focus 1).** Stop any running server, move `data/nor-tutor.db*` aside (do not delete; rename to `nor-tutor.db.bak`), run `npm start`, open http://127.0.0.1:5173. Expected: hero "Find out how many Norwegian words you know", checklist "0 of 3 done", four tiles ("—" for vocabulary), no console errors. Progress tab: three empty blocks, each with a button; the "What do these numbers mean?" section opens.
- [ ] **Step 3: Verify with data (Review Focus 2, 3, 5).** Take the test, add a word on Words, open the Dashboard: hero changes to "Review 1 card" (or "Explore" if nothing is due), checklist ticks update. Open Progress: the vocabulary chart is full width at desktop size and at 375px. Resize the window while on Progress: no overflow.
- [ ] **Step 4: Verify offline (Review Focus 4).** Block `cdn.jsdelivr.net` (browser devtools, Network, block request URL) and reload: Progress shows the notice, Today still works.
- [ ] **Step 5: Keyboard and theme check.** Left/Right arrows on a focused tab switch tabs; Tab moves through hero button, checklist links and tiles in a sensible order; dark mode is readable. Restore `nor-tutor.db.bak` if you want your earlier data back (ask the user whether to keep the test data).
- [ ] **Step 6: Show `git diff --stat`; after the user's OK commit**

```bash
git add src/views/dashboard.js
git commit -m "feat: dashboard with Today and Progress tabs" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

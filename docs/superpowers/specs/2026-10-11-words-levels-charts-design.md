# Word levels, complexity and live progress charts on the Words page

Date: 2026-10-11 · Status: DRAFT (awaiting review)

## Goal
On the Words page the learner sees, live, how many words they know versus still have to learn, how hard each word is, and how their vocabulary is spread across language levels (CEFR A1 to C2).

## Decisions made with the user
- Where the level comes from: **derive from frequency `rank` by default, allow an optional per-word `cefr` override** in `data/words.json`.
- "Evaluation levels" means CEFR (A1, A2, B1, B2, C1, C2).
- Charts and the indicator update immediately after any tap that saves (the existing `onChange` hook in `wordCard`).
- Stack unchanged: plain ES modules, no build step, no dependencies; Chart.js stays optional (a text fallback is always shown). No new storage: everything is derived from the data already in SQLite (`known`, `cards`, `unknown`) and the word list.

## Data (`data/words.json`, `src/wordsSchema.js`)
- Optional field `cefr`: one of `A1 A2 B1 B2 C1 C2`. When present it wins over the derived level.
- `validateWords` rejects any other value (`word #i (lemma): cefr must be one of A1, A2, B1, B2, C1, C2`) and still accepts words without it. No existing word changes; ids and ranks are untouched.

## Levels and complexity (`src/levels.js`, new, pure)
- `LEVELS = ['A1','A2','B1','B2','C1','C2']`.
- Derived level from `rank`, thresholds in one table: A1 ≤ 500, A2 ≤ 1500, B1 ≤ 4000, B2 ≤ 10000, C1 ≤ 20000, C2 above. These are a starting approximation, easy to tune.
- `levelOf(word) → { level, derived }`: the `cefr` override (`derived: false`) or the rank-derived level (`derived: true`).
- `complexityOf(word) → 1..5`: the level's step with C1 and C2 both 5 (A1 1, A2 2, B1 3, B2 4, C1/C2 5).
- `summarize(words, status) → { total, known, inReview, toLearn, notRated, byLevel, estimatedLevel, avgComplexity, hardestKnown }`
  - `known` = words in `status.known`; `inReview` = in `status.deck` and not known; `notRated` = neither; `toLearn` = `total - known` (so it includes in-review words).
  - `byLevel` = per CEFR level `{ known, inReview, notRated, total }`, all six levels always present.
  - `estimatedLevel` = the highest level L such that every level up to and including L has at least 70% of its words known, among levels that contain words; `null` when the first level that has words is under 70%, or there are no words at all. (Levels with zero words are skipped, so they never block or count.)
  - `avgComplexity` = mean complexity of known words, `null` when none; `hardestKnown` = the known word with the highest complexity, ties broken by highest rank number (rarest), `null` when none.
- Words with a missing or non-numeric rank cannot occur (`validateWords` guarantees it); an unknown `cefr` value is treated as absent.

## Words page UI
### New file `src/views/wordstats.js` (browser module)
- `renderStats(words, status) → { el, update }`: builds the panel once; `update()` recomputes `summarize` and redraws the numbers and charts in place (charts updated via `chart.data` and `chart.update()`, not re-created, so there is no flicker).
- **Indicator strip** (always visible, text first): "92 known · 222 still to learn (14 in review)" and a segmented progress bar (known / in review / not rated) with `role="progressbar"`, `aria-valuenow` = percent known, and a text percentage. Each segment is labelled in text; colour is never the only signal.
- **Chart 1 "Known vs still to learn"**: doughnut with three slices (known, in review, not rated yet).
- **Chart 2 "Your vocabulary by level"**: stacked horizontal bars, one per level A1 to C2 (known / in review / not rated), beside three metric tiles: **Estimated level** (with "≈" and a one-line caption "70% of A1 to X words known"), **Average complexity** of known words (1 to 5, "—" when none), **Hardest known word** (lemma and level, "—" when none).
- Both charts have a text/table equivalent in a `details` ("Show numbers") so the data is readable without the canvas; Chart.js missing → the notice "Charts need Chart.js from the internet, which could not be loaded." and the strip and tiles still work.
- The panel is a collapsible `details` ("Progress"), open by default (preference remembered with `pref`/`setPref`); charts stack under 720px.

### `src/views/explore.js`
- Renders the panel above the filter chips and calls `stats.update()` after initial draw and from `settle()` after every saved tap (inside the existing `onChange` path; also when the card does not leave the list, since known/review counts changed). Removing or refilling cards does not recreate the panel.
- `settle()` currently returns early when the card still matches the filter; the stats update must run before that early return.

### `src/views/wordui.js`
- Each card header shows a level badge ("B1", or "≈B1" when derived) and complexity dots (`●●●○○`, with `aria-label="Complexity 3 of 5"`; text label, not colour only).

### `src/charts.js`
- Add `doughnutChart(canvas, labels, data, colors)` and a `stacked` option on `barChart` (`scales.x.stacked`, `scales.y.stacked`). Existing callers are unchanged. Chart colours come from the CSS tokens (`--known`, `--review`, `--line`) via the existing `css()` reader so dark mode stays legible.

### `styles.css`
- Styles for the strip, segmented bar, tiles, level badge and dots. Uses the existing meaning colours (known teal, review amber), AA contrast, 44px targets, visible focus, `prefers-reduced-motion` honoured.

## Tests (unit, fixed data, no `Date.now()`)
- `tests/levels.test.js`: derived thresholds at the boundaries (500 → A1, 501 → A2, 1500, 1501, 20000, 20001); `cefr` override wins and reports `derived: false`; invalid `cefr` ignored; `complexityOf` for each level; `summarize` on an empty list (no NaN, `estimatedLevel` null), on all-known, on mixed data (`byLevel` sums to totals, `toLearn` = total − known, in-review excludes known words); `estimatedLevel` stops at the first level under 70% and skips empty levels; `hardestKnown` tie-break.
- `tests/wordsSchema.test.js` (extend): valid and invalid `cefr`, missing `cefr` still valid.
- Views are checked manually in the browser (Playwright script), per project convention.

## Verification
- `npm test` green.
- Browser at http://127.0.0.1:5173 on a fresh database: strip reads "0 known · 314 still to learn", doughnut and level bars render, estimated level "—". Tap "I know this word": the strip, both charts and tiles change at once with no reload; under the "Not rated yet" filter the card also leaves the list. Un-know reverses it. A word with `"cefr": "C2"` added to `words.json` shows "C2" (no ≈) and moves to the C2 bar. Check 375px, dark mode, reduced motion, keyboard, and with Chart.js blocked (strip and tiles still work).

## Out of scope
Filtering the list by level, per-word level editing in the UI, tagging all 314 words with real CEFR data (only the override mechanism is built), level-based gamification or badges, and changing the vocabulary test bands.

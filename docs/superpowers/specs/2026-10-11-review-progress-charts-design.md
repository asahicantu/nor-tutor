# Review page: learned-by-category/complexity, progress over time, forgotten words, recommendations

Date: 2026-10-11 · Status: IMPLEMENTED (design approved in chat; built directly on request) · Builds on `2026-10-11-words-levels-charts-design.md` (`src/levels.js`)

## Goal
On the Review page the learner sees what they have actually learned (by part of speech and by CEFR level), how their level has grown over time, how much they forget, and gets concrete next steps.

## Definitions
- **Learned**: the word is marked known, or its card's interval has reached 21 days (`MATURE_DAYS` in `src/stats.js`).
- **Forgotten (lapse)**: an "Again" answer on a card that had interval ≥ 1 before the review.
- **Category**: part of speech (first word of `pos`: noun, verb, adjective…). **Complexity**: the CEFR level / 1–5 score from `src/levels.js`.
- **Progress level**: the estimated CEFR level (`summarize().estimatedLevel`, a level counts when 70% of its words are learned) on each past day.
- No new storage: everything is derived from `reviews`, `cards`, `known` in SQLite.

## Logic (`src/progress.js`, pure, tested in `tests/progress.test.js`)
- `replay(reviews)`: replays each word's stored grades through `srs.review()` (deterministic) → exact interval after every review plus a `lapse` flag.
- `learnedNow({ cards, known })`, `progressSeries(state, words, now, offset)` (one row per local day, last 365 days: `learned`, `level`, `lapses`), `forgotten(state, now, 30, offset)` (lapses, distinct words, top 5, 8 weekly buckets), `breakdown(words, status, keyOf, order)` (learned / learning / not started), `categoryOf(word)`.
- `recommend(ctx)` → up to 5 `{ id, text, href }` in priority order: `start` (nothing yet), `due`, `idle` (no review for 3+ days and nothing due), `forgotten` (words lapsed 2+ times in 30 days), `weak-category` (≥ 10 reviews in 60 days and retention ≥ 10 points under overall), `next-level` (first level under 70%: "Learn N more B1 words…").

## UI (`src/views/reviewstats.js`, used by `src/views/review.js`)
- "Recommendations" card, then four charts: learned by category (stacked bars), learned by complexity/level (stacked bars), progress over time (learned words per day + estimated level shown as text), forgotten per week (bars) with a tile "N lapses in 30 days, M words" and a "Most forgotten" list linking to Words.
- Each chart has a "Show numbers" table; Chart.js missing → notice, tiles/recommendations still work. Dark mode, reduced motion and 375px respected; no colour-only meaning.

## Verification
`npm test`; browser check with seeded review history: charts render, recommendations change as the history changes, empty history shows the empty-state message.

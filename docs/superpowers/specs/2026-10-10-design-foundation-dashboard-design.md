# Design foundation, gamification and Dashboard

Date: 2026-10-11 · Status: DRAFT (awaiting review) · Supersedes the 2026-10-10 draft of the same name

Part 1 of 5 of the portal redesign. Later parts: (2) Words, (3) Vocabulary test, (4) Review, (5) Phrases + Grammar. Each gets its own spec and plan and reuses the tokens and `src/gamify.js` from this part.

## Goal
A first-time user opens the app and immediately knows what to do next. The look is vivid, consistent, readable and accessible. Learning feels rewarding (XP, levels, streaks, badges, daily quest) without pulling attention from the task.

## Decisions made with the user
- Engagement style: **full gamification** (XP, levels, badges, celebrations, daily quest).
- Redesign order stays 1 → 5; this spec is part 1.
- Gamification state lives in the **existing SQLite database** (`data/nor-tutor.db`). Almost everything is derived from the data already there; only earned badges are stored.
- Dashboard has two tabs: **Today** (next steps, quest) and **Progress** (charts).
- Vocabulary test (part 3) uses real words only, self-report only. Recorded here because it fixes the estimator caveat shown on the Dashboard.
- Stack unchanged: plain ES modules, no build step, no dependencies; Chart.js stays optional.

## Storage (SQLite)
### Derived, not stored
XP, level, streak, daily-quest progress and "badge earned" checks are computed by the pure `src/gamify.js` from `loadState()` output (cards, reviews, tests, known, unknown, phrases). Nothing can drift out of sync with the real history.

### New table `awards`
- Row: `{ awardId: string, timestamp: number }`, keyed by `awardId`. Records when a badge was first earned, so its celebration shows once and the badge stays earned if rules change.
- `tools/store.mjs`: `CREATE TABLE IF NOT EXISTS awards (word_id TEXT PRIMARY KEY, data TEXT NOT NULL)` (same shape as the other keyed tables, so existing databases upgrade in place). Column name reused from the existing keyed tables; the key is the JSON-stringified `awardId`.
- `src/backup.js`: add `awards` to `STORES`, `KEY_FIELD` (`awardId`), `ROW_CHECKS` (`isObj`, string `awardId`, finite `timestamp`), `LABELS`, `DUPLICATE`, and `ADDED_IN` (`awards: 4`). `BACKUP_VERSION` 3 → 4. v1–v3 backups still import with `awards: []`. Strict validation stays (trust boundary).
- `tools/api.mjs` and `src/db.js` need no change: they already serve any store in `STORES`. The browser writes with `add(db, 'awards', row)`; a `409` (`ConstraintError`) means already earned and is ignored.
- Daily goal is a constant (20 reviews). A configurable goal would need a `settings` table; out of scope.

## Gamification rules (`src/gamify.js`, pure, unit-tested)
- **XP per event:** review remembered +10, review forgotten +2, vocabulary test completed +50, word marked known +5, card added +3, phrase answered +5.
- **Level:** level n starts at `50 * n * (n - 1)` XP, so the first levels come quickly (L2 at 100 XP, L3 at 300, L4 at 600). `levelInfo(xp)` → `{ level, into, needed, pct }`.
- **Streak:** reuses `streakDays` from `src/stats.js` over reviews and tests (phrase rows keep only totals, so phrases cannot count per day); today not yet studied does not break it until the day ends.
- **Daily quest:** `goal = min(20, max(1, doneToday + dueNow))`, so a learner with fewer than 20 cards available can still complete it. → `{ done, goal, pct, complete }`.
- **Phrase XP** is `got * 5` from the aggregate phrase rows.
- **Badges** (id, rule, text label always shown): `first-test` (1 test), `first-review`, `deck-10` (10 cards), `known-50`, `streak-3`, `streak-7`, `reviews-100`, `level-5`. `badges(state, now, offset)` → each `{ id, title, text, value, target, earned }`; `newBadges(state, awards, now, offset)` → the badges earned but not yet in `awards`. The UI treats a badge as earned if the rule holds now or it is in `awards` (streak badges stay earned after a streak ends).
- **Rewards only for real learning events.** Browsing, opening views and unmarking give nothing.

## Design system (`styles.css`)
- Tokens as CSS variables: type scale, spacing scale, radius, shadow, light and dark palettes with a vivid brand accent and gradient for hero surfaces; AA contrast for text and controls.
- Meaning colours, each always paired with a text label (never colour alone): definition (blue), translation (green), known (teal), review (amber), context (purple), reward/XP (gold).
- Components: buttons (primary, secondary, quiet; min target 44px), badges, chips, tabs (`role=tablist`), progress bar, **progress ring** (SVG, `role=progressbar` with value text), XP bar, empty-state block, stat tile with caption, badge tile (locked state shows progress text), toast, `details` disclosure.
- Visible `:focus-visible` ring. `prefers-reduced-motion` disables all transitions and celebrations (static result instead). Layout works at 375px.
- Celebration: CSS-only confetti/pop on the session-complete card and level-up; toast for a new badge. Rendered with `aria-live="polite"` text so it is not visual-only.

## Navigation (`index.html`, `app.js`)
- Sticky top bar: brand "Norsk Tutor" left; Home, Words, Vocab test, Phrases, Review, Grammar; Data as a quiet link on the right. A compact level chip and streak flame sit at the right of the bar.
- Under 640px the links scroll horizontally, no wrapping. Active link has `aria-current="page"`. Hash routes unchanged.

## Dashboard (`src/views/dashboard.js`)
### Today tab (default)
- **Hero card** (gradient): today's quest with progress ring and one next action, first match wins:
  1. No test taken → "Take your first vocabulary test" (about 3 min) → `#/test`
  2. Cards due now → "Review N cards" → `#/review`
  3. Otherwise → "Explore new words" → `#/explore`
- **Level bar**: "Level N" with XP into next level.
- **Getting started** (until all done): 1 Take the test, 2 Add words to your deck, 3 Do a review. Ticks derive from data.
- **Tiles** with one-line captions: Words in your deck, Due today, Day streak, Estimated vocabulary ("—" plus "Take the test" until a test exists), Marked known.
- **Next badge** card (closest unearned, with progress) and an expandable list of all badges.
- On load, `newBadges` is computed; each new id is `add`ed to `awards` and shown as a toast (a failed write is ignored and retried next load).
### Progress tab
- Three charts with plain titles and a one-line "what this shows": "How many words you know", "Answers you remembered each day", "Which words you know, common to rare". Empty chart → short message and a button to the screen that fills it. Chart.js missing → notice, tiles unaffected.
- Expandable "What do these numbers mean?"; estimate caveat "Based on your own answers, so it can run high if you over-claim."

## Logic and tests
- `src/stats.js`: `nextAction({ cards, reviews, tests }, now)` → `{ kind: 'test' | 'review' | 'explore', dueCount }`; `gettingStarted(state)` → `{ test, deck, review }`. Reuse `dueCards` from `src/srs.js`.
- `src/gamify.js`: `xpTotal`, `levelInfo`, `streak`, `dailyQuest`, `badges`, `newBadges` as above.
- Tests (fixed `Date.UTC` timestamps, no `Date.now()`): `tests/gamify.test.js`, `tests/stats.test.js` additions, `tests/backup.test.js` (v4 round-trip, v1–v3 import gives `awards: []`, invalid/duplicate award rejected), `tests/store.test.js` (`awards` add, conflict, replaceState rollback), `tests/api.test.js` (POST/409 `awards`).
- Views not unit-tested (project convention).

## Verification
- `npm test` green.
- Manual in browser at http://127.0.0.1:5173 on a fresh database: hero says take the test, checklist 0/3, charts show empty states with buttons. After a test and a review, XP, level, streak, quest ring and the first badge update and persist after reload (check `awards` in SQLite). Export then import round-trips `awards`. Check 375px and desktop, light and dark, reduced motion, keyboard-only tabbing.

## Out of scope
Words, Test, Review, Phrases, Grammar redesigns (they inherit tokens only; their reward moments land in parts 2–5); configurable daily goal; sound effects; leaderboards or sync.

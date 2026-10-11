# Design foundation and Dashboard

Date: 2026-10-10 · Status: DRAFT (awaiting review)

Part 1 of 5 of the portal redesign. Later parts: (2) Words, (3) Vocabulary test, (4) Review, (5) Phrase test + Grammar. Each gets its own spec and plan.

## Goal
A first-time user opens the app and immediately knows what to do next. The look is consistent, readable and accessible, and later screens reuse it.

## Decisions made with the user
- Dashboard has two tabs: **Today** (next steps) and **Progress** (charts).
- Redesign order is 1 → 5 (this spec first).
- Vocabulary test (part 3) uses real words only, self-report only. Recorded here because it fixes the estimator caveat shown on the Dashboard ("estimate may be optimistic").
- Stack unchanged: plain ES modules, no build step, no dependencies; Chart.js stays optional.

## Design system (`styles.css`)
- Tokens as CSS variables: type scale, spacing scale, radius, light and dark palettes, AA contrast for text and controls.
- Meaning colours, each always paired with a text label (never colour alone): definition (blue), translation (green), known (teal), review (amber), context (purple). Defined now, used by Words in part 2.
- Components: buttons (primary, secondary, quiet; min target 44px), badges, chips, tabs (`role=tablist`), progress bar, empty-state block, stat tile with caption, `details` disclosure.
- Visible `:focus-visible` ring; `prefers-reduced-motion` disables transitions; layout works at 375px.

## Navigation (`index.html`, `app.js`)
- Sticky top bar: brand "Norsk Tutor" left; Dashboard, Words, Test, Review; Data as a quiet link on the right.
- Under 640px the links scroll horizontally, no wrapping. Active link has `aria-current="page"`.
- Routes keep their hash paths. Grammar and Phrases are added to the nav when built.

## Dashboard (`src/views/dashboard.js`)
### Today tab (default)
- **Hero card**: one next action, first match wins:
  1. No test taken → "Take your first vocabulary test" (about 3 min) → `#/test`
  2. Cards due now → "Review N cards" → `#/review`
  3. Otherwise → "Explore new words" → `#/explore`
- **Getting started** (shown until all done): 1 Take the test, 2 Add words to your deck, 3 Do a review. Ticks derive from data (tests, cards, reviews).
- **Four tiles**, each with a one-line caption: Words in your deck, Due today, Day streak, Estimated vocabulary (shows "—" plus "Take the test" caption when none).
### Progress tab
- Three charts with plain titles and a one-line "what this shows": "How many words you know" (vocabulary over time), "Answers you remembered each day", "Which words you know, common to rare" (by frequency band).
- Empty chart → short message and a button to the screen that fills it. Chart.js missing → notice, tiles unaffected.
- Expandable "What do these numbers mean?" explains estimate range, retention, mature cards, bands.
- Estimate caveat line: "Based on your own answers, so it can run high if you over-claim."

## Logic and tests
- `src/stats.js`: add `nextAction({ cards, reviews, tests }, now)` → `{ kind: 'test' | 'review' | 'explore', dueCount }` and `gettingStarted(state)` → `{ test, deck, review }` booleans. Pure, unit-tested in `tests/stats.test.js` with fixed `Date.UTC` timestamps.
- Reuse `dueCards` from `src/srs.js` for the due count.
- Views not unit-tested (project convention).

## Verification
- `npm test` green.
- Manual in browser on a fresh database: hero says take the test, checklist shows 0/3, charts show empty states with buttons. After taking a test and adding a card, the hero and ticks update. Check 375px and desktop, light and dark, keyboard-only tabbing.

## Out of scope
Redesign of Words, Test, Review, Data (they inherit tokens only); Grammar and Phrases; any new data storage.

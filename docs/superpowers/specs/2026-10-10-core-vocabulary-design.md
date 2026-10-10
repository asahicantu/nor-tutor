# Norwegian Bokmål Tutor — Sub-project 1: Core + Vocabulary

Date: 2026-10-10 · Status: APPROVED

## Goal
A local, single-user web app that helps one learner progress from CEFR B2 toward C1/C2 in
Norwegian Bokmål. Sub-project 1 delivers the shared foundation and the vocabulary skill.
Later sub-projects (2 Grammar, 3 Reading, 4 Writing) plug into the same data store and dashboard.

## Decisions already made with the user
- Format: web app that runs locally in the browser (no accounts, no server).
- Full skills suite long-term, decomposed into 4 sub-projects; this spec covers #1 only.
- User wants control over every change: small, reviewable git commits; nothing is committed without review.

## Scope (v1)
1. **Vocabulary-size estimator** — statistical estimate of words known, with confidence interval.
2. **Word explorer** — for any word: meaning (English), part of speech, forms, usage notes,
   collocations, example phrases, register.
3. **Spaced-repetition review** — flashcards scheduled by an SM-2-style algorithm.
4. **Progress dashboard** — charts of vocabulary size over time, review accuracy, retention,
   streak/time studied, words by frequency band.
5. **Data ownership** — all data in the browser (IndexedDB), with JSON export/import for backup.

Out of scope for v1: grammar drills, reading texts, writing feedback, audio, multi-user, sync.

## Vocabulary-size estimator
- Word list is split into frequency bands (ranks 1–1k, 1–2k, 2–4k, 4–8k, 8–16k, 16–32k, 32k+).
- A test samples N words per band (default 20) plus ~20% pseudo-words (plausible nonsense).
- User answers "I know it / I don't". Per band, known proportion p_b is corrected for guessing
  using the false-alarm rate on pseudo-words: p_corrected = (p_b − f) / (1 − f), clamped to [0, 1].
- Estimate = Σ band_size × p_corrected. 95% CI from per-band binomial variance, summed in quadrature.
- Each test result is stored with timestamp so growth can be charted. Optionally a second step
  asks the user to pick the meaning for "known" words, to detect over-claiming.
- Caveat shown in UI: counts are of *lemmas/word families* in our list, not of every
  compound or inflected form, so the number is a comparable index, not an absolute truth.

## Word list and content
- Source: an open, frequency-ranked Bokmål list (candidates: Norwegian Colossal Clean Corpus
  frequencies, Leipzig corpora, NB N-gram). **Licence must be verified before bundling.** Not yet chosen.
- Meanings/examples: generated offline in batches, then reviewed; stored as static JSON shipped
  with the app. No runtime API calls in v1.
- CEFR-style guide figures (approximate, to be sourced): B2 ≈ 4–5k, C1 ≈ 8–10k, C2 ≥ 15k word families.
- Dictionary size reference (approximate, to be sourced): Bokmålsordboka ≈ 65–70k headwords;
  large academic dictionaries several hundred thousand entries; compounding makes the true total open-ended.

## Architecture
Plain static site, no build step initially, ES modules:

```
index.html
src/
  db.js          IndexedDB wrapper + export/import
  srs.js         SM-2 scheduling (pure functions)
  estimator.js   sampling, guess correction, CI (pure functions)
  views/         dashboard, test, review, explorer
  charts.js      chart rendering (Chart.js or hand-rolled SVG)
data/
  words.json     ranked lemmas with meaning, POS, examples
tests/           unit tests for srs.js and estimator.js
```
Units communicate through plain data objects; `srs.js` and `estimator.js` have no DOM or storage
dependencies so they are unit-testable.

## Data model (IndexedDB)
- `words` (static, from JSON): id, lemma, rank, pos, gloss_en, def_no, forms, notes, collocations, examples[]
- `cards`: wordId, ease, interval, due, reps, lapses
- `reviews`: wordId, timestamp, grade, ms
- `tests`: timestamp, bands[{band, sampled, known}], falseAlarmRate, estimate, ciLow, ciHigh

## Testing
- Unit tests for estimator (known inputs → expected estimate/CI, guess-correction edge cases)
  and SRS (interval progression, lapses).
- Manual browser check of each view; export → import round-trip.

## Resolved decisions
1. Charts: Chart.js (pinned version, loaded from a CDN initially; vendor locally later if offline use matters).
2. Glosses: both English and a Norwegian-language definition per word (`gloss_en`, `def_no`).
3. Spec approved by user on 2026-10-10.

## Still open
- Word-list source, once licences are checked.

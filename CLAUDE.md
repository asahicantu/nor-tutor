# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Constraints
- Zero dependencies, no build step: plain ES modules loaded directly by the browser. Don't add npm packages, bundlers or TypeScript. Chart.js comes from a CDN `<script>` in `index.html` (global `Chart`); keep it optional (charts degrade to a notice offline).
- All user data lives in the browser's IndexedDB (`src/db.js`); no server-side state, no runtime API calls. `tools/serve.mjs` is a static dev server only.
- Design spec and plan: `docs/superpowers/specs/`, `docs/superpowers/plans/`.

## Testing
- `npm test` runs `node --test` (Node 20+, `node:test` + `node:assert/strict`). Single file: `node --test tests/srs.test.js`.
- Unit-test only pure modules (srs, estimator, stats, search, backup, pseudowords, rng, wordsSchema). Browser modules (`app.js`, `db.js`, `dom.js`, `charts.js`, `views/`) are checked manually in the browser via `npm start`, not unit-tested.
- Use fixed timestamps (e.g. `Date.UTC(...)`) and the seeded `mulberry32` from `src/rng.js`; never `Date.now()`/`Math.random()` in tests.

## Gotchas
- Always open http://127.0.0.1:5173. IndexedDB is per origin, so `localhost` or another port shows an empty app.
- `data/words.json` must pass `validateWords` (`src/wordsSchema.js`). Word ids are join keys for cards/reviews: never renumber or reuse existing ids.
- Backup import (`src/backup.js`) is a trust boundary; keep its strict validation when changing the backup format, and bump `BACKUP_VERSION`.

## Git
- Conventional commits (`feat:`, `fix:`, `chore:`), small and reviewable.
- Never commit without the user reviewing the change first.

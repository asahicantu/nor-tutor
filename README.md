# nor-tutor

Local tutor for Norwegian Bokmål (B2 and beyond).

- `npm start` serves the app at http://127.0.0.1:5173
- `npm test` runs the unit tests (Node 20+)

Your data lives in `data/nor-tutor.db` (SQLite, written by `npm start`, Node 22+). Use the Data page to export a JSON backup.

## Pages

- **Home** – next step, counts, most-missed words, progress charts (a welcome guide the first time)
- **Words** – cards with translation (green) and Norwegian definition (blue); toggle them for all words; per word: *I know this word*, *Review it*, *Explain context*
- **Vocab test** – real words only, you choose 10-60 words; a missed word shows its translation and definition, is saved as unknown and its miss count goes up
- **Phrases** – read or practise whole sentences (`data/phrases.json`), tap a word for its meaning, listen via the browser's voice
- **Review** – spaced repetition with a chosen number of cards and an improvement chart
- **Grammar** – sections with tables and examples (`data/grammar.json`)
- **Data** – JSON export / import

`data/words.json` holds 314 words. Their `rank` values are approximate tiers written by hand, not corpus frequencies: replace the file with a licensed frequency list (same schema) for a meaningful vocabulary estimate. Test results are expressed as "of the words in the list".

## Good to know

- Data is stored per browser origin. Always use the same address (http://127.0.0.1:5173); http://localhost:5173 or another port shows an empty app. Your data is not lost, it sits in that origin's storage.
- Charts load Chart.js from the internet (jsDelivr). Offline, the tiles still work and the charts are replaced by a notice.
- When replacing `data/words.json` with the full list, keep the existing ids for the 14 sample lemmas (cards and reviews join on word id). Vocabulary-test results taken so far were computed against the 14-word sample list, so their estimates are not comparable with tests on the full list.

## Progress and rewards
XP, levels, streaks and the daily quest are calculated from your review, test, deck and known-word history, so they never go out of sync. Only earned badges are stored (table `awards` in `data/nor-tutor.db`, included in Data export/import, backup version 4). Rewards come from real study only.

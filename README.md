# nor-tutor

Local tutor for Norwegian Bokmål (B2 and beyond).

- `npm start` serves the app at http://127.0.0.1:5173
- `npm test` runs the unit tests (Node 20+)

Your data lives in your browser (IndexedDB). Use the Data page to export a JSON backup.

## Pages

- **Dashboard** – estimated vocabulary, streak, retention, charts
- **Vocabulary test** – frequency-band sample + nonsense words, guess-corrected estimate
- **Review** – spaced repetition for words you added from **Words**
- **Words** – search, meanings (English + Norwegian), forms, phrases, examples
- **Data** – JSON export / import

`data/words.json` is currently a 14-word sample; replace it with the full frequency list (same schema, see `src/wordsSchema.js`) once a licensed source is chosen.

## Good to know

- Data is stored per browser origin. Always use the same address (http://127.0.0.1:5173); http://localhost:5173 or another port shows an empty app. Your data is not lost, it sits in that origin's storage.
- Charts load Chart.js from the internet (jsDelivr). Offline, the tiles still work and the charts are replaced by a notice.
- When replacing `data/words.json` with the full list, keep the existing ids for the 14 sample lemmas (cards and reviews join on word id). Vocabulary-test results taken so far were computed against the 14-word sample list, so their estimates are not comparable with tests on the full list.

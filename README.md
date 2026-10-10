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

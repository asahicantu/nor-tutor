---
name: add-words
description: Add, edit or replace Bokmål word entries in data/words.json (batch content generation, frequency-list import). Use whenever data/words.json changes.
---

Entries in `data/words.json` must match `src/wordsSchema.js`:
`{ id, lemma, rank, pos, gloss_en, def_no, forms[], notes?, collocations[], examples: [{no, en}, ...] }`
(`examples` non-empty; `lemma`, `pos`, `gloss_en`, `def_no` non-empty strings; `rank` positive integer).

Rules:
1. Never change or reuse an existing `id`. Cards and reviews in users' IndexedDB join on it. New entries get ids above the current max.
2. `rank` is the corpus frequency rank and must be unique. It drives the estimator's frequency bands, so take it from the source list and don't invent it.
3. Write Norwegian text in Bokmål (not Nynorsk), with natural B2+ example sentences. `def_no` is a Norwegian definition, not a translation of `gloss_en`. `pos` for nouns includes gender, e.g. `noun (et)`.
4. Before bundling a new frequency source, confirm its licence with the user (spec: licence must be verified).
5. Keep the existing file style: one object per entry, compact.

Then validate:
```
node -e "import('./src/wordsSchema.js').then(async m=>{const w=JSON.parse(await (await import('node:fs/promises')).readFile('data/words.json','utf8'));const e=m.validateWords(w);console.log(e.length?e.join('\n'):'OK '+w.length+' words');process.exit(e.length?1:0)})"
```
and run `npm test`. Show the user a sample of the new entries for review before committing.

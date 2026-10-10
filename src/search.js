const norm = (s) => s.toLocaleLowerCase('nb').trim();

export function searchWords(words, query, limit = 50) {
  const byRank = [...words].sort((a, b) => a.rank - b.rank);
  const q = norm(query);
  if (q === '') return byRank.slice(0, limit);
  const starts = [], contains = [], gloss = [];
  for (const w of byRank) {
    const lemma = norm(w.lemma);
    if (lemma.startsWith(q)) starts.push(w);
    else if (lemma.includes(q)) contains.push(w);
    else if (norm(w.gloss_en ?? '').includes(q)) gloss.push(w);
  }
  return [...starts, ...contains, ...gloss].slice(0, limit);
}

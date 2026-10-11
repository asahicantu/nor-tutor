// What one vocabulary-test session says about your knowledge: known vs unknown, new vs repeated unknown words, and how
// often each unknown word has now appeared. Pure; tested in tests/session.test.js.

const LABELS = ['1st time', '2nd time', '3rd time', '4 times or more'];

// `answers`: [{ wordId, known }] from this session. `before`: Map<wordId, { count }>, the unknown-word counts as they were
// BEFORE the session (the test records each miss as it happens, so the live counts already include this session).
export function sessionStats(answers, before) {
  const seen = new Map();
  for (const a of answers) if (!seen.has(a.wordId)) seen.set(a.wordId, a.known);
  let known = 0, unknown = 0, newWords = 0, seenBefore = 0;
  const buckets = LABELS.map((label) => ({ label, n: 0 }));
  let mostMissed = null;
  for (const [wordId, isKnown] of seen) {
    if (isKnown) { known++; continue; }
    unknown++;
    const prev = before.get(wordId)?.count ?? 0;
    if (prev === 0) newWords++;
    else seenBefore++;
    const times = prev + 1; // this session's miss is one more appearance
    buckets[Math.min(times, 4) - 1].n++;
    if (!mostMissed || times > mostMissed.times) mostMissed = { wordId, times };
  }
  return { total: seen.size, known, unknown, newWords, seenBefore, buckets, mostMissed };
}

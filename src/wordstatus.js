// Pure helpers for "what do I know about this word" (tested in tests/wordstatus.test.js).
export const bumpUnknown = (row, wordId, now) =>
  row ? { ...row, count: row.count + 1, lastAt: now } : { wordId, count: 1, firstAt: now, lastAt: now };

export function buildStatus({ known = [], unknown = [], cards = [] }) {
  return {
    known: new Set(known.map((r) => r.wordId)),
    deck: new Set(cards.map((c) => c.wordId)),
    missed: new Map(unknown.map((r) => [r.wordId, r])), // wordId -> row with count
  };
}

// Words still being learned: missed at least once and not (yet) marked known, most missed first.
export function mostMissed(status, limit = 5) {
  return [...status.missed.values()]
    .filter((r) => !status.known.has(r.wordId))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, limit);
}

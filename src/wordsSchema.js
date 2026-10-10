const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

export function validateWords(words) {
  if (!Array.isArray(words)) return ['word list must be an array'];
  if (words.length === 0) return ['word list is empty'];
  const errors = [];
  const ids = new Set();
  const ranks = new Set();
  words.forEach((w, i) => {
    const tag = `word #${i} (${w?.lemma ?? '?'})`;
    if (w?.id === undefined || w?.id === null) errors.push(`${tag}: missing id`);
    else if (ids.has(w.id)) errors.push(`${tag}: duplicate id ${w.id}`);
    else ids.add(w.id);
    if (!Number.isInteger(w?.rank) || w.rank < 1) errors.push(`${tag}: rank must be a positive integer`);
    else if (ranks.has(w.rank)) errors.push(`${tag}: duplicate rank ${w.rank}`);
    else ranks.add(w.rank);
    for (const key of ['lemma', 'pos', 'gloss_en', 'def_no']) {
      if (!nonEmpty(w?.[key])) errors.push(`${tag}: ${key} must be a non-empty string`);
    }
    if (!Array.isArray(w?.forms)) errors.push(`${tag}: forms must be an array`);
    if (!Array.isArray(w?.collocations)) errors.push(`${tag}: collocations must be an array`);
    const ex = w?.examples;
    if (!Array.isArray(ex) || ex.length === 0 || !ex.every((e) => nonEmpty(e?.no) && nonEmpty(e?.en))) {
      errors.push(`${tag}: examples must be a non-empty array of {no, en}`);
    }
  });
  return errors;
}

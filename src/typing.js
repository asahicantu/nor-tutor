// Checking what the learner types in Norwegian: a whole sentence or a single word. Forgiving where it should be (case,
// punctuation, ASCII spellings of æ ø å, one small typo in a longer word) and strict about everything else. Pure; tested in
// tests/typing.test.js.

const MIN_TYPO_LEN = 4; // a one-letter slip is only forgiven in words of at least this many letters (det/dat are different words)

// Words and the text between them, in order: [{ text, word }].
export const tokenize = (text) => text.split(/([\p{L}'-]+)/u).filter(Boolean).map((t) => ({ text: t, word: /\p{L}/u.test(t) }));

// Lower-case words with punctuation, quotes and extra spaces removed; æ ø å and hyphens inside words are kept.
export const normalizeWords = (text) =>
  text.normalize('NFC').toLocaleLowerCase('nb').replace(/[^\p{L}\p{N}'-]+/gu, ' ').split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);

// ASCII spellings of the three extra letters (ae, o/oe, a/aa) are folded onto the same form, so "baat" matches "båt".
export const fold = (w) => w.replaceAll('æ', 'ae').replaceAll('ø', 'o').replaceAll('oe', 'o').replaceAll('å', 'a').replaceAll('aa', 'a');

export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// How a typed word differs from the target word it was paired with. `forms(target)` lists the other forms of the same word
// and `isWord(typed)` says whether the typed text is itself a real word: neither another form (snakke for snakker) nor a
// different real word (for for før, a typo that happens to spell another word) is a slip.
function pairStatus(target, typed, { forms, isWord } = {}) {
  if (target === typed) return 'ok';
  if (forms?.(target).includes(typed)) return 'form';
  if (fold(target) === fold(typed)) return isWord?.(typed) ? 'wrong' : 'diacritic';
  if (target.length >= MIN_TYPO_LEN && editDistance(target, typed) <= 1) return isWord?.(typed) ? 'wrong' : 'typo';
  return 'wrong';
}

// Word-by-word comparison of a typed sentence with the target. `items` follow the sentence in order, each
// { status: ok | diacritic | typo | form | wrong | missing | extra, target?, typed? }. `result` is correct, almost (only ASCII
// spellings and at most one typo) or wrong; `got` is true unless wrong. `opts` is { forms, isWord }, see pairStatus.
export function compareSentence(typed, target, opts = {}) {
  const t = normalizeWords(target);
  const u = normalizeWords(typed);
  // Longest common subsequence of identical words anchors the alignment.
  const dp = Array.from({ length: t.length + 1 }, () => new Array(u.length + 1).fill(0));
  for (let i = t.length - 1; i >= 0; i--) for (let j = u.length - 1; j >= 0; j--) dp[i][j] = t[i] === u[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const matches = [];
  for (let i = 0, j = 0; i < t.length && j < u.length;) {
    if (t[i] === u[j]) { matches.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const items = [];
  let ti = 0, ui = 0;
  for (const [mi, mj] of [...matches, [t.length, u.length]]) {
    const gapT = t.slice(ti, mi);
    const gapU = u.slice(ui, mj);
    const paired = Math.min(gapT.length, gapU.length);
    for (let k = 0; k < paired; k++) items.push({ status: pairStatus(gapT[k], gapU[k], opts), target: gapT[k], typed: gapU[k] });
    for (const w of gapT.slice(paired)) items.push({ status: 'missing', target: w });
    for (const w of gapU.slice(paired)) items.push({ status: 'extra', typed: w });
    if (mi < t.length) items.push({ status: 'ok', target: t[mi], typed: u[mj] });
    ti = mi + 1;
    ui = mj + 1;
  }
  const bad = items.some((i) => ['missing', 'extra', 'wrong', 'form'].includes(i.status));
  const typos = items.filter((i) => i.status === 'typo').length;
  const clean = items.every((i) => i.status === 'ok');
  const result = clean ? 'correct' : bad || typos > 1 ? 'wrong' : 'almost';
  return { result, got: result !== 'wrong', items };
}

// One typed word against the word that belongs in the blank. `forms` are the other forms of the same word: typing one of
// them is wrong for this sentence, and the note says so.
export function checkWord(typed, answer, forms = []) {
  const words = normalizeWords(typed);
  const ans = normalizeWords(answer)[0];
  if (words.length !== 1) return { result: 'wrong' };
  const w = words[0];
  if (w === ans) return { result: 'correct' };
  if (fold(w) === fold(ans)) return { result: 'almost', note: 'Watch the Norwegian letters æ, ø and å.' };
  if (forms.map((f) => f.toLocaleLowerCase('nb')).includes(w)) return { result: 'wrong', note: `That is a form of the same word, but this sentence needs «${answer}».` };
  if (ans.length >= MIN_TYPO_LEN && editDistance(w, ans) <= 1) return { result: 'almost', note: 'A small spelling slip.' };
  return { result: 'wrong' };
}

const CONTENT = /^(noun|verb|adjective|adverb)/;

// Which word of a sentence to blank out: a word of the word list with at least 3 letters, content words (nouns, verbs,
// adjectives, adverbs) first. A word that appears twice in the sentence is never blanked (the other one would give the answer
// away). `lookup(token)` returns the word-list entry or undefined. null when nothing qualifies.
export function pickBlank(text, lookup, rng = Math.random) {
  const tokens = tokenize(text);
  const seen = new Map();
  for (const t of tokens) if (t.word) seen.set(t.text.toLocaleLowerCase('nb'), (seen.get(t.text.toLocaleLowerCase('nb')) ?? 0) + 1);
  const cands = tokens
    .map((tok, tokenIndex) => ({ tok, tokenIndex, entry: tok.word && tok.text.length >= 3 && seen.get(tok.text.toLocaleLowerCase('nb')) === 1 ? lookup(tok.text) : undefined }))
    .filter((c) => c.entry);
  const content = cands.filter((c) => CONTENT.test(c.entry.pos));
  const pool = content.length ? content : cands;
  if (!pool.length) return null;
  const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  return { tokenIndex: pick.tokenIndex, answer: pick.tok.text, entry: pick.entry };
}

// "God morgen!" -> "G__ m_____!": the first letter of every word, the rest hidden.
export const hintLetters = (text) => text.replace(/\p{L}+/gu, (w) => w[0] + '_'.repeat(w.length - 1));

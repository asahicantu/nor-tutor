// Practice drills (dictation, listening, spelling, gender, verb forms, collocations) and the numbers drawn from their
// answers: accuracy per skill, per word type and the slips made most often. Pure; tested in tests/practice.test.js.
import { shuffle } from './rng.js';
import { tokenize } from './typing.js';
import { categoryOf } from './progress.js';

// Every drill that saves its answers. The Phrases page saves write / fill / understand too.
export const MODES = ['dictation', 'listen', 'spell', 'gender', 'verb', 'collocation', 'write', 'fill', 'understand'];
// Kinds of slip in a typed answer: æ ø å spelt in ASCII, a one-letter typo, another form of the right word, the wrong
// gender, or a wrong, missing or extra word.
export const MISTAKES = ['letters', 'typo', 'form', 'gender', 'word'];
export const MISTAKE_LABELS = {
  letters: 'Norwegian letters (æ, ø, å)', typo: 'Small typos', form: 'Wrong form of the right word', gender: 'Noun gender (en / ei / et)', word: 'Wrong, missing or extra words',
};
// Which skill each drill trains. Review cards count as reading (you recognise the word on the card).
export const SKILLS = [
  ['reading', '👀 Reading', ['understand']],
  ['listening', '🎧 Listening', ['dictation', 'listen']],
  ['writing', '✍️ Writing', ['spell', 'write', 'fill']],
  ['grammar', '🧩 Grammar', ['gender', 'verb']],
  ['usage', '🔗 Word combinations', ['collocation']],
];

// The genders a noun takes ('en/ei' nouns accept both), or null for words without one (verbs, plural-only nouns).
export function genderOf(word) {
  const m = /^noun \(([^)]+)\)/.exec(word.pos);
  const g = m ? m[1].split('/').filter((x) => ['en', 'ei', 'et'].includes(x)) : [];
  return g.length ? g : null;
}

// Verbs store their forms as [infinitive, present, past, perfect participle].
export const VERB_FORMS = [
  [1, 'present tense', 'Jeg ___ nå.'],
  [2, 'past tense', 'Jeg ___ i går.'],
  [3, 'perfect participle', 'Jeg har ___.'],
];
export function verbTask(word, rng) {
  if (categoryOf(word) !== 'verb' || word.forms.length < 4) return null;
  const [i, label, frame] = VERB_FORMS[Math.min(VERB_FORMS.length - 1, Math.floor(rng() * VERB_FORMS.length))];
  return { label, frame, answer: word.forms[i] };
}

// `target` plus n - 1 other words to choose from, in random order. Other words of the same type come first (a noun among
// nouns), and none shares the target's lemma or meaning, so there is exactly one right answer.
export function choices(words, target, n, rng) {
  const differs = (w) => w.id !== target.id && w.lemma !== target.lemma && w.gloss_en !== target.gloss_en;
  const same = shuffle(words.filter((w) => differs(w) && categoryOf(w) === categoryOf(target)), rng);
  const rest = shuffle(words.filter((w) => differs(w) && categoryOf(w) !== categoryOf(target)), rng);
  return shuffle([target, ...[...same, ...rest].slice(0, n - 1)], rng);
}

// A collocation of `word` with the word itself blanked out: { text, tokens, blank } where tokens come from tokenize() and
// `blank` is the index of the token to hide. null when no collocation contains the word or one of its forms.
export function collocationItem(word, rng) {
  const spellings = new Set([word.lemma, ...word.forms].map((f) => f.toLocaleLowerCase('nb')));
  const usable = word.collocations
    .map((text) => ({ text, tokens: tokenize(text) }))
    .map((c) => ({ ...c, blank: c.tokens.findIndex((t) => t.word && spellings.has(t.text.toLocaleLowerCase('nb'))) }))
    .filter((c) => c.blank >= 0 && c.tokens.filter((t) => t.word).length > 1); // a lone word leaves nothing to go on
  if (!usable.length) return null;
  return usable[Math.min(usable.length - 1, Math.floor(rng() * usable.length))];
}

// The kinds of slip in a compareSentence() result, without repeats.
const ITEM_MISTAKE = { diacritic: 'letters', typo: 'typo', form: 'form', wrong: 'word', missing: 'word', extra: 'word' };
export const mistakesOf = (items) => [...new Set(items.map((i) => ITEM_MISTAKE[i.status]).filter(Boolean))];

const pct = (ok, total) => (total ? ok / total : null);

// Accuracy per skill: [{ key, label, ok, total, accuracy }] in SKILLS order. accuracy is null with no answers yet.
export function skillBreakdown(practice, reviews) {
  return SKILLS.map(([key, label, modes]) => {
    const rows = practice.filter((p) => modes.includes(p.mode));
    let ok = rows.filter((p) => p.ok).length;
    let total = rows.length;
    if (key === 'reading') {
      ok += reviews.filter((r) => r.grade !== 'again').length;
      total += reviews.length;
    }
    return { key, label, ok, total, accuracy: pct(ok, total) };
  });
}

// How often each kind of slip was made, most frequent first, leaving out kinds never made: [{ kind, label, n }].
export function mistakeCounts(practice) {
  const n = Object.fromEntries(MISTAKES.map((m) => [m, 0]));
  for (const p of practice) for (const m of p.mistakes ?? []) if (m in n) n[m]++;
  return MISTAKES.map((kind) => ({ kind, label: MISTAKE_LABELS[kind], n: n[kind] })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
}

// Accuracy per word type (noun, verb, ...) over review answers and practice answers about a single word, most answered
// first: [{ key, ok, total, accuracy }]. Rows for words no longer in the list are ignored.
export function accuracyByType(words, reviews, practice) {
  const byId = new Map(words.map((w) => [w.id, w]));
  const out = new Map();
  const add = (wordId, ok) => {
    const w = byId.get(wordId);
    if (!w) return;
    const key = categoryOf(w);
    const e = out.get(key) ?? { key, ok: 0, total: 0 };
    e.total++;
    if (ok) e.ok++;
    out.set(key, e);
  };
  for (const r of reviews) add(r.wordId, r.grade !== 'again');
  for (const p of practice) if (p.wordId !== undefined) add(p.wordId, p.ok);
  return [...out.values()].map((e) => ({ ...e, accuracy: e.ok / e.total })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

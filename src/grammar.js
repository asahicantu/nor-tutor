// Pure helpers for the Grammar page: topic categories, study statuses, progress encoding, emoji handling and data
// validation. Tested in tests/grammar.test.js.

// The six topic groups. Each section in data/grammar.json names one; the view colours the card by it.
export const CATEGORIES = {
  sounds: { label: 'Sounds & spelling', emoji: '🔤' },
  words: { label: 'Words & forms', emoji: '🏷️' },
  verbs: { label: 'Verbs', emoji: '🏃' },
  sentences: { label: 'Sentences', emoji: '🧩' },
  places: { label: 'Places, numbers & time', emoji: '🧭' },
  usage: { label: 'Usage & pitfalls', emoji: '💬' },
};

// "new" is the absence of a saved row; only "learning" and "studied" are stored.
export const STATUSES = [
  { id: 'new', label: 'Not started', emoji: '⬜' },
  { id: 'learning', label: 'Learning', emoji: '📖' },
  { id: 'studied', label: 'Studied', emoji: '✅' },
];

// Study progress lives in the existing `settings` store: key "grammar.<sectionId>", value "<status>:<timestamp>".
const PREFIX = 'grammar.';
export const progressKey = (id) => PREFIX + id;
export const encodeProgress = (status, at) => `${status}:${at}`;

export function parseProgress(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!r.key.startsWith(PREFIX)) continue;
    const [status, at] = r.value.split(':');
    if ((status !== 'learning' && status !== 'studied') || !/^\d+$/.test(at ?? '')) continue;
    out.set(r.key.slice(PREFIX.length), { status, at: Number(at) });
  }
  return out;
}

// Counts only sections that still exist, so a removed section cannot inflate the numbers.
export function progressTotals(sections, progress) {
  let learning = 0, studied = 0;
  for (const s of sections) {
    const p = progress.get(s.id);
    if (p?.status === 'studied') studied++;
    else if (p?.status === 'learning') learning++;
  }
  return { total: sections.length, learning, studied, pct: sections.length ? Math.round((studied / sections.length) * 100) : 0 };
}

// Splits text into plain and emoji runs so the view can mark emoji decorative (aria-hidden). A bare digit is not an emoji;
// keycaps (1️⃣), flags (🇳🇴), skin tones (👍🏽) and ZWJ sequences (👨‍👩‍👧) are.
const EMOJI = /([0-9#*]️?⃣|\p{RI}{2}|\p{Extended_Pictographic}️?\p{EMod}?(?:‍\p{Extended_Pictographic}️?\p{EMod}?)*)/gu;
export function splitEmoji(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(EMOJI)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), emoji: false });
    out.push({ text: m[0], emoji: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), emoji: false });
  return out;
}

const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
const isEmoji = (s) => typeof s === 'string' && s.length > 0 && splitEmoji(s).length === 1 && splitEmoji(s)[0].emoji;
const MAX_ID = 30; // settings keys are capped at 40 characters including the "grammar." prefix

export function validateGrammar(sections) {
  if (!Array.isArray(sections)) return ['grammar data must be an array'];
  if (sections.length === 0) return ['grammar data is empty'];
  const errors = [];
  const ids = new Set();
  sections.forEach((s, i) => {
    const tag = `section #${i} (${s?.id ?? '?'})`;
    if (typeof s?.id !== 'string' || !/^[a-z0-9-]+$/.test(s.id) || s.id.length > MAX_ID) errors.push(`${tag}: id must be kebab-case, at most ${MAX_ID} characters`);
    else if (ids.has(s.id)) errors.push(`${tag}: duplicate id ${s.id}`);
    else ids.add(s.id);
    if (!Object.hasOwn(CATEGORIES, s?.category)) errors.push(`${tag}: category must be one of ${Object.keys(CATEGORIES).join(', ')}`);
    if (!isEmoji(s?.emoji)) errors.push(`${tag}: emoji must be a single emoji`);
    for (const key of ['title', 'summary']) if (!nonEmpty(s?.[key])) errors.push(`${tag}: ${key} must be a non-empty string`);
    if (!Array.isArray(s?.blocks) || s.blocks.length === 0) { errors.push(`${tag}: blocks must be a non-empty array`); return; }
    s.blocks.forEach((b, j) => {
      const bt = `${tag} block ${j}`;
      if (b?.type === 'p' || b?.type === 'tip') { if (!nonEmpty(b.text)) errors.push(`${bt}: text must be non-empty`); }
      else if (b?.type === 'list') { if (!Array.isArray(b.items) || !b.items.every(nonEmpty)) errors.push(`${bt}: list items must be non-empty strings`); }
      else if (b?.type === 'examples') { if (!Array.isArray(b.items) || !b.items.every((e) => nonEmpty(e?.no) && nonEmpty(e?.en))) errors.push(`${bt}: examples need {no, en}`); }
      else if (b?.type === 'table') {
        if (!Array.isArray(b.head) || !b.head.every(nonEmpty)) errors.push(`${bt}: table head must be non-empty strings`);
        else if (!Array.isArray(b.rows) || !b.rows.every((r) => Array.isArray(r) && r.length === b.head.length && r.every((c) => typeof c === 'string'))) errors.push(`${bt}: every row must have ${b.head.length} cells`);
      } else errors.push(`${bt}: unknown block type ${b?.type}`);
    });
  });
  return errors;
}

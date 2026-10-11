// Browser-only helpers for the gamification UI. Rules live in gamify.js; this file only draws and writes awards.
import { h } from './dom.js';
import { loadState, add } from './db.js';
import { xpTotal, levelInfo, streak, dailyQuest, newBadges } from './gamify.js';

export const tzOffset = () => -new Date().getTimezoneOffset() * 60000;

const svg = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

export function ring(pct, label) {
  pct = Math.round(pct);
  const r = 42;
  const c = 2 * Math.PI * r;
  const el = svg('svg', { viewBox: '0 0 100 100', class: 'ring', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': label });
  el.append(
    svg('circle', { cx: 50, cy: 50, r, class: 'ring-bg' }),
    svg('circle', { cx: 50, cy: 50, r, class: 'ring-fg', 'stroke-dasharray': `${(c * pct) / 100} ${c}`, transform: 'rotate(-90 50 50)' }),
  );
  return el;
}

export const xpBar = ({ level, into, needed, pct }) => (pct = Math.round(pct),
  h('div', { class: 'xpbar' },
    h('div', { class: 'row between' }, h('strong', {}, `Level ${level}`), h('span', { class: 'muted' }, `${into} / ${needed} XP to next level`)),
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'XP to next level', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: `width:${pct}%` }))));

export const badgeTile = (b) =>
  h('div', { class: `badgetile${b.earned ? ' earned' : ''}` },
    h('strong', {}, b.title),
    h('span', { class: 'muted' }, b.text),
    h('span', { class: 'badge' }, b.earned ? 'Earned' : `${b.value} / ${b.target}`));

export function toast(text) {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const el = h('div', { class: 'toast' }, text);
  box.append(el);
  setTimeout(() => el.remove(), 6000);
}

export const confetti = () =>
  h('div', { class: 'confetti', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, i) => h('span', { style: `--i:${i}` })));

// Stores each newly earned badge once. A 409 (ConstraintError) means another tab already did; any other
// failure stops quietly and is retried on the next load, because badges are derived and nothing is lost.
export async function claimBadges(db, state, now, offset) {
  const got = [];
  for (const b of newBadges(state, state.awards, now, offset)) {
    try {
      await add(db, 'awards', { awardId: b.id, timestamp: now });
      state.awards.push({ awardId: b.id, timestamp: now });
      got.push(b);
    } catch (e) {
      if (e?.name !== 'ConstraintError') break;
    }
  }
  return got;
}

// After a review session: level-up line, quest status, XP bar, and toasts for new badges.
export async function reward(db, gain, into) {
  const state = await loadState(db);
  const now = Date.now();
  const offset = tzOffset();
  const total = xpTotal(state);
  const after = levelInfo(total);
  const q = dailyQuest(state, now, offset);
  into.replaceChildren(...[
    after.level > levelInfo(total - gain).level && h('p', {}, h('strong', {}, `Level up! You are now level ${after.level}.`)),
    h('p', {}, q.complete ? 'Daily quest complete!' : `Daily quest: ${q.done} of ${q.goal} reviews done today.`),
    xpBar(after),
  ].filter(Boolean));
  for (const b of await claimBadges(db, state, now, offset)) toast(`Badge earned: ${b.title}`);
  renderChip(db).catch(() => {});
}

export async function renderChip(db) {
  const el = document.getElementById('nav-chip');
  if (!el) return;
  const state = await loadState(db);
  const days = streak(state, Date.now(), tzOffset());
  const level = levelInfo(xpTotal(state)).level;
  el.setAttribute('aria-label', `Open your profile: level ${level}, ${days}-day streak`);
  el.replaceChildren(
    h('span', { 'aria-hidden': 'true' }, `Level ${level}`),
    h('span', { class: 'flame', 'aria-hidden': 'true' }, `\u{1F525} ${days}`));
  el.hidden = false;
}

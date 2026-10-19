// Profile popover opened from the nav chip. Browser-only; numbers come from profile.js.
import { h } from './dom.js';
import { loadState, put, logout, changePassword } from './db.js';
import { profileSummary, MAX_NAME } from './profile.js';
import { xpBar, tzOffset } from './gamui.js';

const n = (v) => (Number.isFinite(v) ? v : 0);
const num = (v) => n(v).toLocaleString('en');
const one = (v) => n(v).toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dayText = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const dateText = (ts) => (Number.isFinite(ts) ? new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function sparkline(values) {
  const NS = 'http://www.w3.org/2000/svg';
  const max = Math.max(1, ...values);
  const w = 14 * 12, hgt = 40;
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  s.setAttribute('class', 'pp-spark');
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', `Words learned per day, last 14 days, oldest first: ${values.join(', ')}`);
  values.forEach((v, i) => {
    const bh = Math.max(2, (v / max) * (hgt - 2));
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', i * 12 + 1); r.setAttribute('y', hgt - bh);
    r.setAttribute('width', 10); r.setAttribute('height', bh); r.setAttribute('rx', 2);
    r.setAttribute('fill', 'currentColor');
    if (v === 0) r.setAttribute('opacity', '.35');
    s.append(r);
  });
  return s;
}

export function initProfilePanel({ db, words }) {
  const chip = document.getElementById('nav-chip');
  if (!chip || document.getElementById('profile-panel')) return;
  const panel = h('div', { id: 'profile-panel', class: 'pp', role: 'dialog', 'aria-label': 'Your profile', hidden: '' });
  document.getElementById('nav').after(panel); // keyboard order: chip, panel, page
  panel.addEventListener('focusout', (e) => {
    const t = e.relatedTarget;
    if (t && !panel.contains(t) && t !== chip) close(false); // Tabbed out
  });
  let seq = 0;

  const close = (refocus) => {
    if (panel.hidden) return;
    panel.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    if (refocus) chip.focus();
  };

  function render(p) {
    const initial = [...p.name][0]?.toUpperCase() ?? '?';
    const heading = h('h2', { class: 'pp-name', tabindex: '-1' }, p.name);
    const input = h('input', { id: 'pp-name-input', type: 'text', maxlength: String(MAX_NAME), value: p.hasName ? p.name : '', placeholder: 'Learner', autocomplete: 'off' });
    const status = h('p', { class: 'pp-status muted', role: 'status' });
    const avatar = h('span', { class: 'pp-avatar', 'aria-hidden': 'true' }, initial);
    const saveBtn = h('button', { type: 'button', class: 'primary', onclick: () => save() }, 'Save');
    let saving = false;
    const save = async () => {
      if (saving) return;
      const value = input.value.trim().slice(0, MAX_NAME);
      status.classList.remove('pp-err');
      if (!value) { status.classList.add('pp-err'); status.textContent = 'Enter a name'; return; }
      saving = true;
      const was = document.activeElement;
      saveBtn.disabled = input.disabled = true;
      try {
        await put(db, 'settings', { key: 'profileName', value });
        heading.textContent = value;
        avatar.textContent = [...value][0].toUpperCase();
        input.value = value;
        status.textContent = 'Saved';
      } catch (e) {
        status.classList.add('pp-err');
        status.textContent = `Could not save (${e?.message || 'unknown error'})`;
      } finally {
        saving = false;
        saveBtn.disabled = input.disabled = false;
        if (was === input || was === saveBtn) was.focus();
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

    const { pace, eta, vocab } = p;
    const level = p.estimatedLevel;
    const stat = (label, value) => h('div', { class: 'pp-stat' }, h('span', { class: 'muted' }, label), h('strong', {}, value));

    const cur = h('input', { id: 'pp-pw-cur', type: 'password', autocomplete: 'current-password', maxlength: '200' });
    const nxt = h('input', { id: 'pp-pw-new', type: 'password', autocomplete: 'new-password', maxlength: '200' });
    const pwStatus = h('p', { class: 'pp-status muted', role: 'status' });
    const pwBtn = h('button', { type: 'button', onclick: async () => {
      pwStatus.classList.remove('pp-err');
      pwBtn.disabled = true;
      try {
        await changePassword(cur.value, nxt.value);
        cur.value = nxt.value = '';
        pwStatus.textContent = 'Password changed';
      } catch (e) {
        pwStatus.classList.add('pp-err');
        pwStatus.textContent = e?.message || 'Could not change password';
      } finally {
        pwBtn.disabled = false;
      }
    } }, 'Change password');

    panel.replaceChildren(
      h('div', { class: 'pp-head' }, avatar, heading),
      h('div', { class: 'pp-namerow' },
        h('label', { for: 'pp-name-input' }, 'Your name'),
        h('div', { class: 'row' }, input, saveBtn),
        status),
      h('section', { 'aria-label': 'Level and streak' },
        xpBar(p.level),
        h('p', { class: 'muted' }, `${num(p.streak)}-day streak · today's quest ${num(p.quest.done)}/${num(p.quest.goal)} reviews`)),
      h('section', { 'aria-labelledby': 'pp-h-pace' },
        h('h3', { id: 'pp-h-pace' }, 'Words learned per day'),
        h('p', { class: 'pp-big' }, num(pace.today), h('span', { class: 'muted' }, ' today')),
        h('p', { class: 'muted' }, `7-day average ${one(pace.avg7)} · 30-day average ${one(pace.avg30)} · best day ${pace.best ? `${num(pace.best.gained)} (${dayText(pace.best.day)})` : '—'}`),
        h('p', {}, `Total learned: ${num(p.learnedTotal)}`),
        sparkline(pace.last14.map(n))),
      h('section', { 'aria-labelledby': 'pp-h-est' },
        h('h3', { id: 'pp-h-est' }, 'Estimated Norwegian level'),
        h('p', { class: 'pp-big' }, level ? `≈${level}` : '—'),
        h('p', {}, p.blurb),
        eta
          ? [
              h('div', { class: 'progress', role: 'progressbar', 'aria-label': `Progress towards ${eta.level}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(100, n(eta.pct))) }, h('span', { style: `width:${Math.min(100, n(eta.pct))}%` })),
              h('p', {}, `${num(eta.needed)} more ${eta.level} words to reach ${eta.level} (${num(eta.pct)}%)`),
              eta.days != null && h('p', { class: 'muted' }, `About ${num(eta.days)} days at your current pace (${one(pace.avg30)} words/day)`),
            ]
          : level && h('p', {}, 'You have reached every level in the word list.'),
        h('p', { class: 'pp-note muted' }, 'Estimated from your vocabulary only. It is not a speaking test.')),
      h('section', { 'aria-labelledby': 'pp-h-vocab' },
        h('h3', { id: 'pp-h-vocab' }, 'Estimated vocabulary'),
        vocab
          ? h('p', {}, `≈${num(vocab.estimate)} words (range ${num(vocab.ciLow)}–${num(vocab.ciHigh)}), from your test on ${dateText(vocab.timestamp)}`)
          : h('p', {}, 'Take the vocabulary test for a size estimate. ', h('a', { href: '#/test', class: 'pp-link' }, 'Open the test'))),
      h('div', { class: 'pp-grid' },
        stat('Reviews done', num(p.reviews)),
        stat('Retention last 7 days', p.retention7 == null || !Number.isFinite(p.retention7) ? '—' : `${Math.round(p.retention7 * 100)}%`),
        stat('Minutes studied', num(p.minutes)),
        stat('Tests taken', num(p.tests))),
      h('p', {}, h('a', { href: '#/dashboard', class: 'pp-link' }, 'Open dashboard')),
      h('details', {}, h('summary', {}, 'Change password'),
        h('label', { for: 'pp-pw-cur' }, 'Current password'), cur,
        h('label', { for: 'pp-pw-new' }, 'New password (at least 6 characters)'), nxt,
        pwBtn, pwStatus),
      h('p', {}, h('button', { type: 'button', onclick: () => logout().then(() => location.reload()).catch((e) => (status.textContent = `Could not log out (${e.message})`)) }, 'Log out')));
    return heading;
  }

  async function open() {
    const mine = ++seq;
    panel.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    panel.replaceChildren(h('p', { class: 'muted pp-loading' }, 'Loading…'));
    try {
      const state = await loadState(db);
      if (mine !== seq || panel.hidden) return;
      const active = document.activeElement;
      const inside = panel.contains(active) && active !== panel; // the user already focused something here: don't steal it
      const id = inside ? active.id : '';
      const heading = render(profileSummary({ words, state, now: Date.now(), offset: tzOffset() }));
      if (!inside) heading.focus();
      else if (id) document.getElementById(id)?.focus();
    } catch (e) {
      if (mine === seq) panel.replaceChildren(h('p', { class: 'pp-err', role: 'alert' }, `Could not load your profile (${e?.message || 'unknown error'})`));
    }
  }

  chip.addEventListener('click', () => (panel.hidden ? open() : close(true)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(true); });
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (e.target.closest('a') && panel.contains(e.target)) return close(false);
    if (!panel.contains(e.target) && !chip.contains(e.target)) close(false);
  });
  window.addEventListener('hashchange', () => close(false));
}

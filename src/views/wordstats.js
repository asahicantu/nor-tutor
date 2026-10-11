import { h, no, pref, setPref } from '../dom.js';
import { LEVELS, LEVEL_PASS, levelOf, summarize } from '../levels.js';
import { doughnutChart, barChart, token } from '../charts.js';

const n = (x) => x.toLocaleString('en');
const pct = (part, total) => (total ? (part / total) * 100 : 0);
const LABELS = ['Known', 'In review', 'Not rated yet'];

// Collapsible "Progress" panel for the Words page. update() recomputes everything from `status` in place.
export function renderStats(words, status) {
  const colors = () => [token('--known', '#0d6868'), token('--review', '#8a5200'), token('--muted', '#55536b')];
  const noChart = typeof Chart === 'undefined';
  let donut = null;
  let bars = null;

  const strip = h('p', { class: 'wstrip' });
  const pctText = h('span', { class: 'wpct' });
  const seg = (cls) => h('span', { class: `wseg ${cls}` });
  const segs = [seg('known'), seg('review'), seg('new')];
  const track = h('div', { class: 'wtrack', role: 'progressbar', 'aria-label': 'Words known', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, segs);
  const legend = h('ul', { class: 'plain wlegend' });

  const donutCanvas = h('canvas', { role: 'img', 'aria-label': 'Known versus still to learn' });
  const barCanvas = h('canvas', { role: 'img', 'aria-label': 'Vocabulary by level' });
  const notice = (t) => (noChart ? h('p', { class: 'muted', role: 'status' }, 'Charts need Chart.js from the internet, which could not be loaded.') : t);

  const tile = (label) => {
    const value = h('strong', { class: 'wtile-v' });
    const cap = h('span', { class: 'muted wtile-c' });
    return { value, cap, el: h('div', { class: 'wtile' }, h('span', { class: 'wtile-l' }, label), value, cap) };
  };
  const tLevel = tile('Estimated level');
  const tAvg = tile('Average complexity of known words');
  const tHard = tile('Hardest known word');

  const table1 = h('tbody');
  const table2 = h('tbody');
  const tables = h('details', { class: 'wnums' },
    h('summary', {}, 'Show numbers'),
    h('table', {}, h('caption', {}, 'Known vs still to learn'), h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col' }, 'Words'))), table1),
    h('table', {}, h('caption', {}, 'Your vocabulary by level'),
      h('thead', {}, h('tr', {}, ['Level', ...LABELS, 'Total'].map((t) => h('th', { scope: 'col' }, t)))), table2));

  const el = h('details', { class: 'wstats', open: pref('wordsStatsOpen', true) ? '' : false },
    h('summary', {}, h('strong', {}, 'Progress')),
    h('div', { class: 'wstats-body' },
      strip,
      h('div', { class: 'wbar' }, track, pctText),
      legend,
      noChart ? notice() : null,
      h('div', { class: 'wcharts' },
        h('section', {}, h('h3', {}, 'Known vs still to learn'), noChart ? null : h('div', { class: 'chart wdonut' }, donutCanvas)),
        h('section', {}, h('h3', {}, 'Your vocabulary by level'), noChart ? null : h('div', { class: 'chart' }, barCanvas), h('div', { class: 'wtiles' }, tLevel.el, tAvg.el, tHard.el))),
      tables));
  el.addEventListener('toggle', () => { setPref('wordsStatsOpen', el.open); if (el.open) { update(); donut?.resize(); bars?.resize(); } }); // resize: charts built while closed may have been measured at 0

  function update() {
    const s = summarize(words, status);
    const parts = [s.known, s.inReview, s.notRated];
    const known = Math.round(pct(s.known, s.total));
    strip.textContent = `${n(s.known)} known · ${n(s.toLearn)} still to learn (${n(s.inReview)} in review)`;
    pctText.textContent = `${known}% known`;
    track.setAttribute('aria-valuenow', String(known));
    track.setAttribute('aria-valuetext', `${known}% known`);
    segs.forEach((sg, i) => { sg.style.width = `${pct(parts[i], s.total)}%`; });
    legend.replaceChildren(...LABELS.map((l, i) => h('li', {}, h('span', { class: `wkey ${['known', 'review', 'new'][i]}`, 'aria-hidden': 'true' }), `${l}: ${n(parts[i])}`)));

    tLevel.value.textContent = s.estimatedLevel ? `≈${s.estimatedLevel}` : '—';
    tLevel.cap.textContent = s.estimatedLevel
      ? `${Math.round(LEVEL_PASS * 100)}% of A1 to ${s.estimatedLevel} words known`
      : `Know ${Math.round(LEVEL_PASS * 100)}% of the A1 words to reach a level.`;
    tAvg.value.textContent = s.avgComplexity === null ? '—' : s.avgComplexity.toFixed(1);
    tAvg.cap.textContent = s.avgComplexity === null ? 'Mark words as known.' : 'out of 5';
    if (s.hardestKnown) {
      const { level, derived } = levelOf(s.hardestKnown);
      tHard.value.replaceChildren(no(s.hardestKnown.lemma));
      tHard.cap.textContent = `${derived ? '≈' : ''}${level}`;
    } else {
      tHard.value.textContent = '—';
      tHard.cap.textContent = 'Mark words as known.';
    }

    table1.replaceChildren(...LABELS.map((l, i) => h('tr', {}, h('th', { scope: 'row' }, l), h('td', {}, n(parts[i])))));
    table2.replaceChildren(...LEVELS.map((l) => {
      const r = s.byLevel[l];
      return h('tr', {}, h('th', { scope: 'row' }, l), h('td', {}, n(r.known)), h('td', {}, n(r.inReview)), h('td', {}, n(r.notRated)), h('td', {}, n(r.total)));
    }));

    if (noChart) return;
    const levelData = [['known'], ['inReview'], ['notRated']].map(([k]) => LEVELS.map((l) => s.byLevel[l][k]));
    if (donut) {
      donut.data.datasets[0].data = parts;
      donut.update();
    } else if (donutCanvas.isConnected) {
      donut = doughnutChart(donutCanvas, LABELS, parts, colors());
    }
    if (bars) {
      levelData.forEach((d, i) => { bars.data.datasets[i].data = d; });
      bars.update();
    } else if (barCanvas.isConnected) {
      const c = colors();
      bars = barChart(barCanvas, LEVELS, LABELS.map((label, i) => ({ label, data: levelData[i], backgroundColor: c[i], borderColor: token('--card', '#fff'), borderWidth: 1 })), { horizontal: true, stacked: true });
    }
  }

  return { el, update };
}

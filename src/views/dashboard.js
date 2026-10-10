import { h } from '../dom.js';
import { loadState } from '../db.js';
import { vocabSeries, dailyAccuracy, streakDays, retentionRate, studyMinutes, bandProfile } from '../stats.js';
import { lineChart, barChart, accent, softAccent } from '../charts.js';

const fmt = (n) => Math.round(n).toLocaleString('en');
const tile = (label, value, sub) =>
  h('div', { class: 'card tile' }, h('div', { class: 'num' }, value), h('div', { class: 'label' }, label), sub ? h('div', { class: 'muted' }, sub) : null);
const chartCard = (title, canvas) => h('div', { class: 'card' }, h('h3', {}, title), h('div', { class: 'chart' }, canvas));

export async function render(root, { db }) {
  const { reviews, tests } = await loadState(db);
  const offset = -new Date().getTimezoneOffset() * 60000;
  const series = vocabSeries(tests);
  const latest = [...tests].sort((a, b) => b.timestamp - a.timestamp)[0];
  const retention = retentionRate(reviews);

  const tiles = h('div', { class: 'tiles' },
    tile('Estimated vocabulary', latest ? `≈ ${fmt(latest.estimate)}` : '—', latest ? `95%: ${fmt(latest.ciLow)}–${fmt(latest.ciHigh)}` : 'Take the vocabulary test'),
    tile('Tests taken', String(tests.length)),
    tile('Day streak', String(streakDays(reviews, Date.now(), offset))),
    tile('Minutes studied', fmt(studyMinutes(reviews))),
    tile('Retention (mature cards)', retention === null ? '—' : `${Math.round(retention * 100)}%`, retention === null ? 'Needs reviews of cards with 21+ day intervals' : null),
  );
  root.replaceChildren(h('h1', {}, 'Progress'), tiles);

  if (typeof Chart === 'undefined') {
    root.append(h('p', { class: 'error' }, 'Charts could not load (Chart.js is fetched from the internet). Tiles above still work.'));
    return;
  }

  const labelOf = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const canvases = [h('canvas'), h('canvas'), h('canvas')];
  const sections = [
    ['Vocabulary size over time', series.length === 0],
    ['Daily recall accuracy', reviews.length === 0],
    ['Knowledge by frequency band (latest test)', !latest],
  ].map(([title, empty], i) =>
    empty ? h('div', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted' }, 'No data yet.')) : chartCard(title, canvases[i]));
  root.append(...sections);
  if (!root.isConnected) return; // navigated away while loading

  const main = accent();
  if (series.length && canvases[0].isConnected) {
    lineChart(canvases[0], series.map((s) => labelOf(s.t)), [
      { label: 'Estimate', data: series.map((s) => s.estimate), borderColor: main, backgroundColor: main, pointRadius: 4 },
      { label: 'Upper 95%', data: series.map((s) => s.ciHigh), borderColor: softAccent(), borderDash: [5, 4], pointRadius: series.length === 1 ? 3 : 0 },
      { label: 'Lower 95%', data: series.map((s) => s.ciLow), borderColor: softAccent(), borderDash: [5, 4], pointRadius: series.length === 1 ? 3 : 0 },
    ]);
  }
  if (reviews.length && canvases[1].isConnected) {
    const days = dailyAccuracy(reviews, offset);
    barChart(canvases[1], days.map((d) => d.day), [
      { label: 'Recall accuracy (%)', data: days.map((d) => Math.round(d.accuracy * 100)), backgroundColor: main },
    ], { max: 100 });
  }
  if (latest && canvases[2].isConnected) {
    const prof = bandProfile(latest);
    barChart(canvases[2], prof.map((p) => p.band), [
      { label: 'Words known (%)', data: prof.map((p) => Math.round(p.known * 100)), backgroundColor: main },
    ], { horizontal: true, max: 100 });
  }
}

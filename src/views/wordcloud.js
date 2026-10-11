// Word cloud of how strongly you know your words: SIZE = how often a word was studied or reappeared, COLOUR = strength.
// Built from cloudItems() in src/strength.js. Meaning is never colour-only: a legend, a hover line and a table carry it.
// With the optional wordcloud2.js library (CDN script in index.html) the cloud is an animated canvas: words appear one by one,
// hovering shows the details, clicking says the word, the shape can be changed and it redraws on resize. Without the library
// (offline) the same words are shown as a plain CSS cloud.
import { h, no, pref, setPref } from '../dom.js';
import { STRENGTHS, fontSize } from '../strength.js';
import { speak, speechSupported } from '../speech.js';
import { token } from '../charts.js';

const labelOf = (strength) => STRENGTHS.find((s) => s.id === strength)?.label ?? 'Not yet';
const detail = (i) => `${i.text} (${i.gloss}): studied ${i.studied}×, missed ${i.missed}×, ${labelOf(i.strength).toLowerCase()}`;
const SHAPES = [['circle', 'Round'], ['diamond', 'Diamond'], ['star', 'Star']];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Biggest words in the middle, smaller ones towards the edges, so the cloud reads as a cloud and not as a sorted list.
function centred(items) {
  const out = [];
  items.forEach((it, i) => (i % 2 ? out.push(it) : out.unshift(it)));
  return out;
}

const strengthColor = () => ({
  strong: token('--known', '#0d6868'), solid: token('--def', '#1a56a0'), learning: token('--review', '#8a5200'),
  weak: token('--bad', '#b3261e'), none: token('--muted', '#55536b'),
});

// The animated canvas. It is (re)drawn whenever the stage has a width: when first shown (also when it sits in a closed card
// that is opened later), on resize, and on Replay.
function canvasCloud(items) {
  const max = Math.max(...items.map((i) => i.count));
  const byText = new Map(items.map((i) => [i.text, i]));
  const info = h('p', { class: 'wc-info muted', role: 'status' }, 'Hover a word for details. Click it to hear it.');
  const canvas = h('canvas', { class: 'wc-canvas', role: 'img', 'aria-label': `Word cloud of ${items.length} words. The table below lists them.` });
  const stage = h('div', { class: 'wc-stage' }, canvas);
  let shape = pref('cloudShape', 'circle');
  if (!SHAPES.some(([v]) => v === shape)) shape = 'circle';
  let drawnWidth = 0;

  function draw() {
    const w = Math.round(stage.clientWidth);
    if (w < 80) return; // hidden (closed card) or not laid out yet; the ResizeObserver calls again
    drawnWidth = w;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(Math.max(260, Math.min(w * 0.6, 440)) * dpr);
    const colors = strengthColor();
    const scale = Math.max(0.7, Math.min(w / 700, 1.2)) * 14 * dpr;
    WordCloud.stop();
    WordCloud(canvas, {
      list: items.map((i) => [i.text, i.count]),
      weightFactor: (count) => fontSize(count, max) * scale,
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontWeight: '700',
      color: (word) => colors[byText.get(word)?.strength ?? 'none'],
      backgroundColor: 'rgba(0,0,0,0)',
      shape,
      rotateRatio: 0.2,
      rotationSteps: 2,
      minRotation: -Math.PI / 2,
      maxRotation: -Math.PI / 2,
      gridSize: Math.round(10 * dpr), // the gap between words
      ellipticity: 0.7,
      shrinkToFit: true,
      drawOutOfBound: false,
      wait: reduced() ? 0 : 35, // ms between words: the animation
      hover: (item) => {
        const it = item && byText.get(item[0]);
        canvas.style.cursor = it ? 'pointer' : 'default';
        info.textContent = it ? detail(it) : 'Hover a word for details. Click it to hear it.';
      },
      click: (item) => {
        const it = item && byText.get(item[0]);
        if (it && speechSupported()) speak(it.text);
      },
    });
  }

  let timer = 0;
  const ro = new ResizeObserver(() => { // debounced: a drag-resize must not restart the animation on every pixel
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!stage.isConnected) return ro.disconnect();
      if (Math.abs(stage.clientWidth - drawnWidth) > 8) draw();
    }, 150);
  });
  ro.observe(stage);

  const shapeSel = h('select', {
    'aria-label': 'Cloud shape',
    onchange: (e) => { shape = e.target.value; setPref('cloudShape', shape); draw(); },
  }, SHAPES.map(([v, t]) => h('option', { value: v, selected: v === shape }, t)));
  const controls = h('div', { class: 'row wc-controls' },
    h('label', { class: 'row' }, h('span', { 'aria-hidden': 'true' }, '🔷'), h('span', { class: 'muted' }, 'Shape'), shapeSel),
    h('button', { type: 'button', onclick: draw }, h('span', { 'aria-hidden': 'true' }, '🔄'), ' Replay'));
  return [controls, stage, info];
}

// The plain CSS cloud for when the library could not be loaded.
function cssCloud(items) {
  const max = Math.max(...items.map((i) => i.count));
  return [h('ul', { class: 'plain wordcloud', 'aria-label': 'Word cloud' },
    centred(items).map((i) => h('li', {
      class: `wc-word wc-${i.strength ?? 'none'}`,
      style: `font-size:${fontSize(i.count, max)}rem`,
      title: detail(i),
    }, no(i.text))))];
}

export function wordCloud(items, { empty = 'Nothing to show yet.' } = {}) {
  if (items.length === 0) return h('p', { class: 'empty' }, empty);
  return h('div', { class: 'wc' },
    h('ul', { class: 'plain wc-legend', 'aria-label': 'Legend' },
      STRENGTHS.map((s) => h('li', {}, h('span', { class: `wc-key wc-${s.id}`, 'aria-hidden': 'true' }), s.label)),
      h('li', { class: 'muted' }, 'Bigger word = studied or met more often')),
    ...(typeof WordCloud === 'function' ? canvasCloud(items) : cssCloud(items)),
    h('details', {},
      h('summary', {}, 'Show as a table'),
      h('div', { class: 'tablewrap tscroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Word', 'Meaning', 'Times studied', 'Times missed', 'Strength'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, items.map((i) => h('tr', {}, h('th', { scope: 'row' }, no(i.text)), h('td', {}, i.gloss), h('td', {}, String(i.studied)), h('td', {}, String(i.missed)), h('td', {}, labelOf(i.strength)))))))));
}

// Chart.js draws on canvas, so it cannot use CSS variables directly: read the
// theme colours at creation time so axes/legend/grid stay legible in dark mode.
const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export const accent = () => css('--accent', '#1f5fa8');
export const softAccent = () => css('--muted', '#8aa4c4');

const base = (type, labels, datasets, options) => (canvas) => {
  Chart.defaults.color = css('--muted', '#666');
  Chart.defaults.borderColor = css('--line', 'rgba(0,0,0,0.1)');
  return new Chart(canvas, { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, ...options } });
};

export function lineChart(canvas, labels, datasets) {
  return base('line', labels, datasets, { scales: { y: { beginAtZero: true } }, interaction: { mode: 'index', intersect: false } })(canvas);
}

export function barChart(canvas, labels, datasets, { horizontal = false, max } = {}) {
  const valueAxis = { beginAtZero: true, ...(max !== undefined ? { max } : {}) };
  return base('bar', labels, datasets, {
    indexAxis: horizontal ? 'y' : 'x',
    scales: horizontal ? { x: valueAxis } : { y: valueAxis },
  })(canvas);
}

// Bars (how many reviews) with a line on top (share remembered, 0-100%).
export function mixedChart(canvas, labels, barSet, lineSet) {
  return base('bar', labels, [{ ...barSet, yAxisID: 'y' }, { ...lineSet, type: 'line', yAxisID: 'y1' }], {
    scales: { y: { beginAtZero: true, title: { display: true, text: barSet.label }, ticks: { precision: 0 } }, y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: lineSet.label } } },
    interaction: { mode: 'index', intersect: false },
  })(canvas);
}

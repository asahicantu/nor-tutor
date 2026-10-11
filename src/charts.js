// Chart.js draws on canvas, so it cannot use CSS variables directly: read the
// theme colours at creation time so axes/legend/grid stay legible in dark mode.
const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
export const token = (name, fallback) => css(name, fallback);

export const accent = () => css('--accent', '#1f5fa8');
export const softAccent = () => css('--muted', '#8aa4c4');

const base = (type, labels, datasets, options) => (canvas) => {
  // Views re-render by replacing their DOM; free the charts whose canvas is gone (every chart is created here).
  Object.values(Chart.instances).filter((c) => !c.canvas.isConnected).forEach((c) => c.destroy());
  Chart.defaults.color = css('--muted', '#666');
  Chart.defaults.borderColor = css('--line', 'rgba(0,0,0,0.1)');
  return new Chart(canvas, { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, ...(matchMedia('(prefers-reduced-motion: reduce)').matches ? { animation: false } : {}), ...options } });
};

export function lineChart(canvas, labels, datasets) {
  return base('line', labels, datasets, { scales: { y: { beginAtZero: true } }, interaction: { mode: 'index', intersect: false } })(canvas);
}

export function barChart(canvas, labels, datasets, { horizontal = false, max, stacked = false } = {}) {
  const valueAxis = { beginAtZero: true, ...(max !== undefined ? { max } : {}) };
  const scales = horizontal ? { x: valueAxis } : { y: valueAxis };
  if (stacked) {
    scales.x = { ...scales.x, stacked: true };
    scales.y = { ...scales.y, stacked: true };
  }
  return base('bar', labels, datasets, { indexAxis: horizontal ? 'y' : 'x', scales })(canvas);
}

export function doughnutChart(canvas, labels, data, colors) {
  return base('doughnut', labels, [{ data, backgroundColor: colors, borderColor: css('--card', '#fff') }], { cutout: '62%' })(canvas);
}

// Bars (how many reviews) with a line on top (share remembered, 0-100%).
export function mixedChart(canvas, labels, barSet, lineSet) {
  return base('bar', labels, [{ ...barSet, yAxisID: 'y' }, { ...lineSet, type: 'line', yAxisID: 'y1' }], {
    scales: { y: { beginAtZero: true, title: { display: true, text: barSet.label }, ticks: { precision: 0 } }, y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: lineSet.label } } },
    interaction: { mode: 'index', intersect: false },
  })(canvas);
}

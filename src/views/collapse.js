// Collapsible, colour-coded cards in the style of the Grammar and Sources pages (it reuses their .gcard CSS).
// `color` picks the accent: sounds | words | verbs | sentences | places | usage (the .gcat-* classes). Pass `onFirstOpen` to
// build something that needs a visible element, such as a chart: Chart.js cannot size a canvas inside a closed <details>.
import { h } from '../dom.js';

export function collapsible({ emoji, title, hint = '', color = 'words', open = false, onFirstOpen = null, id = null }, ...children) {
  const el = h('details', { class: `gcard gcat-${color}`, open, id },
    h('summary', {},
      h('h2', {}, h('span', { class: 'gemoji', 'aria-hidden': 'true' }, emoji), h('span', { class: 'gtitle' }, title)),
      hint ? h('span', { class: 'gline muted' }, hint) : null),
    h('div', { class: 'gbody' }, ...children));
  let fired = false;
  const fire = () => {
    if (fired || !el.open) return;
    fired = true;
    onFirstOpen?.(el);
  };
  el.addEventListener('toggle', fire);
  if (open) queueMicrotask(fire); // an initially open card is built as soon as the caller has attached it
  return el;
}

export const setAllOpen = (root, open) => root.querySelectorAll('details.gcard').forEach((d) => { d.open = open; });

// "Expand all" / "Collapse all" buttons for every collapsible card inside `getRoot()`.
export const expandControls = (getRoot) =>
  h('div', { class: 'row' },
    h('button', { type: 'button', onclick: () => setAllOpen(getRoot(), true) }, h('span', { 'aria-hidden': 'true' }, '⤵️'), ' Expand all'),
    h('button', { type: 'button', onclick: () => setAllOpen(getRoot(), false) }, h('span', { 'aria-hidden': 'true' }, '⤴️'), ' Collapse all'));

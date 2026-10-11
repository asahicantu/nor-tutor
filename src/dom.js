export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (value !== false && value !== null && value !== undefined) el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Norwegian text, so screen readers pick the right voice.
export const no = (text, tag = 'span', cls = '') => h(tag, { lang: 'nb', class: cls }, text);

// Remembered UI choices (counts, toggles). Falls back silently when storage is blocked.
export const pref = (key, fallback) => {
  try {
    const v = localStorage.getItem(`nt.${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
export const setPref = (key, value) => {
  try {
    localStorage.setItem(`nt.${key}`, JSON.stringify(value));
  } catch {
    /* private mode: the choice just isn't remembered */
  }
};

// Keyboard shortcuts for a view. The listener removes itself once the view is gone.
export function onKeys(root, map) {
  const handler = (e) => {
    if (!root.isConnected) return document.removeEventListener('keydown', handler);
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; // holding a key must not answer the next card too
    if (e.target.closest?.('#nav, #profile-panel')) return;
    const fn = map[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };
  document.addEventListener('keydown', handler);
}

// **bold** is the only markup allowed in grammar text.
export const rich = (text) => text.split('**').map((part, i) => (i % 2 ? h('strong', {}, part) : part));

// Segmented choice (e.g. how many cards). Calls onPick(value) and returns the element.
export function segmented(label, options, value, onPick) {
  const btns = options.map(([v, text]) =>
    h('button', {
      type: 'button', 'aria-pressed': String(v === value),
      onclick: () => {
        btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v)));
        onPick(v);
      },
    }, text));
  return h('div', { class: 'seg', role: 'group', 'aria-label': label }, btns);
}

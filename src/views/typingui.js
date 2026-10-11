// A text field for writing Norwegian, with æ ø å keys that insert at the cursor (for keyboards without those letters).
import { h } from '../dom.js';

const LETTERS = ['æ', 'ø', 'å'];

function insertAtCaret(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.setRangeText(text, start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
}

// The row of æ ø å buttons for any text field or textarea.
export function letterKeys(field) {
  return h('div', { class: 'row lkeys', role: 'group', 'aria-label': 'Norwegian letters' },
    h('span', { class: 'muted' }, 'Insert:'),
    LETTERS.map((ch) => h('button', {
      type: 'button', class: 'lkey', 'aria-label': `Insert ${ch}`,
      onmousedown: (e) => e.preventDefault(), // keep the cursor in the field
      onclick: () => insertAtCaret(field, ch),
    }, ch)));
}

// Returns the pieces so the caller can lay them out: { input, keys, button, value(), lock(on), focus() }.
// Enter submits (Shift+Enter starts a new line in a multi-line field).
export function typingPanel({ multiline = false, label, placeholder = 'Skriv på norsk…', checkLabel = 'Check', onSubmit, widthCh = null }) {
  const attrs = { lang: 'nb', 'aria-label': label, placeholder, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', enterkeyhint: 'done', class: multiline ? 'tinput tarea' : 'tinput' };
  const input = multiline ? h('textarea', { ...attrs, rows: '3' }) : h('input', { ...attrs, type: 'text', style: widthCh ? `width:${widthCh}ch` : false });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.repeat) { e.preventDefault(); return; } // holding Enter must neither submit twice nor add lines
    if (e.key === 'Enter' && !e.repeat && !(multiline && e.shiftKey) && !e.isComposing && e.keyCode !== 229) { // 229: IME composition in Safari
      e.preventDefault();
      onSubmit();
    }
  });
  const keys = letterKeys(input);
  const button = h('button', { type: 'button', class: 'primary', onclick: () => onSubmit() }, h('span', { class: 'icon', 'aria-hidden': 'true' }, '✅'), ' ', checkLabel);
  return {
    input, keys, button,
    value: () => input.value,
    lock(on) { input.disabled = on; button.disabled = on; keys.querySelectorAll('button').forEach((b) => (b.disabled = on)); },
    focus: () => input.focus(),
  };
}

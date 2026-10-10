import { h } from '../dom.js';
import { searchWords } from '../search.js';
import { getAll, put } from '../db.js';
import { newCard } from '../srs.js';

export async function render(root, { words, db }) {
  const inDeck = new Set((await getAll(db, 'cards')).map((c) => c.wordId));
  const input = h('input', { type: 'search', placeholder: 'Search Norwegian or English…', 'aria-label': 'Search words' });
  const list = h('ul', { class: 'plain' });
  const detail = h('div', {});

  function showList() {
    const results = searchWords(words, input.value);
    list.replaceChildren(
      ...(results.length === 0
        ? [h('li', { class: 'muted' }, 'No matching words.')]
        : results.map((w) => h('li', {}, h('button', { onclick: () => showDetail(w) }, `${w.lemma} — ${w.gloss_en}`)))),
    );
  }

  function showDetail(w) {
    const errorBox = h('div');
    const addBtn = h('button', {
      class: 'primary',
      disabled: inDeck.has(w.id),
      onclick: async () => {
        // inDeck is updated synchronously before the await: blocks double activation
        // and never overwrites an existing card (put would reset its schedule).
        if (inDeck.has(w.id)) return;
        inDeck.add(w.id);
        addBtn.disabled = true;
        addBtn.textContent = 'In your deck';
        errorBox.replaceChildren();
        try {
          await put(db, 'cards', newCard(w.id, Date.now()));
        } catch (e) {
          inDeck.delete(w.id);
          addBtn.disabled = false;
          addBtn.textContent = 'Add to review deck';
          errorBox.replaceChildren(h('p', { class: 'error' }, `Could not add this word (${e.message}). Please try again.`));
        }
      },
    }, inDeck.has(w.id) ? 'In your deck' : 'Add to review deck');
    detail.replaceChildren(
      h('div', { class: 'card' },
        h('h2', {}, w.lemma, ' ', h('span', { class: 'muted' }, w.pos)),
        h('p', {}, h('strong', {}, w.gloss_en)),
        h('p', {}, w.def_no),
        w.forms.length ? h('p', { class: 'muted' }, 'Forms: ' + w.forms.join(', ')) : null,
        w.notes ? h('p', {}, w.notes) : null,
        w.collocations.length ? h('p', {}, h('strong', {}, 'Common phrases: '), w.collocations.join(' · ')) : null,
        h('h3', {}, 'Examples'),
        h('ul', {}, w.examples.map((e) => h('li', {}, e.no, h('br'), h('span', { class: 'muted' }, e.en)))),
        addBtn,
        errorBox,
      ),
    );
  }

  input.addEventListener('input', showList);
  root.replaceChildren(h('h1', {}, 'Words'), input, detail, list);
  showList();
}

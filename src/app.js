import { openDb } from './db.js';
import { h } from './dom.js';
import { validateWords } from './wordsSchema.js';

// Later tasks add: import * as test from './views/test.js'; and a routes entry.
const routes = {};

function home(root) {
  root.replaceChildren(
    h('h1', {}, 'Norsk Tutor'),
    h('p', {}, 'Use the menu above to take the vocabulary test, review words, or explore the word list.'),
  );
}

function showError(e, target = document.getElementById('app')) {
  target.replaceChildren(h('p', { class: 'error' }, `Something went wrong: ${e.message}`));
}

async function main() {
  try {
    const [words, db] = await Promise.all([
      fetch('data/words.json').then((r) => {
        if (!r.ok) throw new Error(`data/words.json: HTTP ${r.status}`);
        return r.json();
      }),
      openDb(),
    ]);
    const errors = validateWords(words);
    if (errors.length) throw new Error(`Invalid word list: ${errors.slice(0, 3).join('; ')}`);
    const ctx = { words, db };
    const root = document.getElementById('app');
    const go = async () => {
      const path = location.hash.slice(1) || '/dashboard';
      for (const a of document.querySelectorAll('#nav a')) {
        a.classList.toggle('active', a.getAttribute('href') === `#${path}`);
      }
      const stage = h('div');
      root.replaceChildren(stage);
      try {
        await (routes[path] ? routes[path].render(stage, ctx) : home(stage));
      } catch (e) {
        if (stage.isConnected) showError(e, stage);
      }
    };
    window.addEventListener('hashchange', go);
    go();
  } catch (e) {
    showError(e);
  }
}

main();

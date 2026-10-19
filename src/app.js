import { openDb } from './db.js';
import { ensureLogin } from './login.js';
import { h } from './dom.js';
import { validateWords } from './wordsSchema.js';
import { renderChip } from './gamui.js';
import { initProfilePanel } from './profilepanel.js';

import * as test from './views/test.js';
import * as review from './views/review.js';
import * as explore from './views/explore.js';
import * as dashboard from './views/dashboard.js';
import * as data from './views/data.js';
import * as phrasesView from './views/phrases.js';
import * as grammar from './views/grammar.js';
import * as sources from './views/sources.js';
const routes = { '/dashboard': dashboard, '/test': test, '/review': review, '/explore': explore, '/phrases': phrasesView, '/grammar': grammar, '/sources': sources, '/data': data };

const loadJson = (path) => fetch(path).then((r) => {
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
});

function home(root) {
  root.replaceChildren(
    h('h1', {}, 'Norsk Tutor'),
    h('p', {}, h('a', { href: '#/dashboard' }, 'Go to the dashboard')),
  );
}

function showError(e, target = document.getElementById('app')) {
  target.replaceChildren(h('p', { class: 'error' }, `Something went wrong: ${e.message}`));
}

async function main() {
  try {
    const user = await ensureLogin();
    const [words, phrases, db] = await Promise.all([loadJson('data/words.json'), loadJson('data/phrases.json'), openDb(user.username)]);
    const errors = validateWords(words);
    if (errors.length) throw new Error(`Invalid word list: ${errors.slice(0, 3).join('; ')}`);
    if (db.notice) document.body.insertBefore(h('p', { class: 'notice', role: 'status' }, db.notice), document.getElementById('app'));
    const ctx = { words, phrases, db };
    const root = document.getElementById('app');
    const go = async () => {
      const path = location.hash.slice(1) || '/dashboard';
      for (const a of document.querySelectorAll('#nav a')) {
        if (a.classList.contains('brand')) continue;
        if (a.getAttribute('href') === `#${path}`) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
      const stage = h('div');
      root.replaceChildren(stage);
      window.scrollTo(0, 0);
      renderChip(db).catch(() => {}); // cosmetic: a failure must not block the view
      try {
        await (routes[path] ? routes[path].render(stage, ctx) : home(stage));
      } catch (e) {
        if (stage.isConnected) showError(e, stage);
      }
    };
    initProfilePanel({ db, words });
    window.addEventListener('hashchange', go);
    go();
  } catch (e) {
    showError(e);
  }
}

main();

import { h } from '../dom.js';
import { loadState, replaceState } from '../db.js';
import { serialize, parseBackup } from '../backup.js';

const counts = (d) => `${d.cards.length} cards, ${d.reviews.length} reviews, ${d.tests.length} tests, ${d.known.length} known and ${d.unknown.length} missed words`;

export function render(root, { db }) {
  const status = h('p', { role: 'status' });
  const say = (msg, isError = false) => {
    status.textContent = msg;
    status.className = isError ? 'error' : 'muted';
  };

  async function exportBackup() {
    try {
      const now = Date.now();
      const text = serialize(await loadState(db), now);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = h('a', { href: url, download: `nor-tutor-backup-${new Date(now).toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say('Backup downloaded.');
    } catch (e) {
      say(`Export failed: ${e.message}`, true);
    }
  }

  async function importBackup(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = parseBackup(await file.text());
      const current = await loadState(db);
      if (!confirm(`Replace ALL current data (${counts(current)}) with this backup (${counts(data)})? This cannot be undone.`)) {
        say('Import cancelled. Nothing was changed.');
        return;
      }
      await replaceState(db, data);
      say(`Imported ${counts(data)}.`);
    } catch (e) {
      say(`Import failed, nothing was changed: ${e.message}`, true);
    }
  }

  root.replaceChildren(
    h('h1', {}, 'Your data'),
    h('div', { class: 'card' },
      h('p', {}, 'Everything is stored in the SQLite file data/nor-tutor.db. Export a backup now and then.'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: exportBackup }, 'Export backup'),
        h('label', {}, h('span', { class: 'muted' }, 'Import backup: '), h('input', { type: 'file', accept: 'application/json,.json', onchange: importBackup })),
      ),
      status,
    ),
  );
}

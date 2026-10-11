// Browser-side writes for word status. Each updates the shared `status` sets as well as the database.
import { add, put, del } from './db.js';
import { newCard } from './srs.js';
import { bumpUnknown } from './wordstatus.js';

export async function markKnown(db, status, id) {
  status.known.add(id);
  try {
    await put(db, 'known', { wordId: id, timestamp: Date.now() });
  } catch (e) {
    status.known.delete(id);
    throw e;
  }
}

export async function unmarkKnown(db, status, id) {
  await del(db, 'known', id);
  status.known.delete(id);
}

export async function addToDeck(db, status, id) {
  if (status.deck.has(id)) return;
  status.deck.add(id); // before the await: blocks double clicks
  try {
    await add(db, 'cards', newCard(id, Date.now()));
  } catch (e) {
    if (e?.name === 'ConstraintError') return; // already added elsewhere
    status.deck.delete(id);
    throw e;
  }
}

// "I don't know it": count the miss (never overwrites history, just increments).
export async function recordMiss(db, status, id) {
  const row = bumpUnknown(status.missed.get(id), id, Date.now());
  await put(db, 'unknown', row);
  status.missed.set(id, row);
}

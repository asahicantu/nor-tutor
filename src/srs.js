const DAY = 86400000;

export const GRADES = { again: 1, hard: 3, good: 4, easy: 5 };

export function newCard(wordId, now) {
  return { wordId, ease: 2.5, interval: 0, reps: 0, lapses: 0, due: now };
}

export function review(card, grade, now) {
  const q = GRADES[grade];
  if (q === undefined) throw new RangeError(`unknown grade: ${grade}`);
  let { ease, interval, reps, lapses } = card;
  if (q < 3) {
    reps = 0;
    lapses += 1;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * ease);
    reps += 1;
  }
  return { ...card, ease, interval, reps, lapses, due: now + interval * DAY };
}

export function dueCards(cards, now) {
  return cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}

import { h } from '../dom.js';
import { sampleTest, scoreTest, bandSizes } from '../estimator.js';
import { add } from '../db.js';

export function render(root, ctx) {
  const { words, db } = ctx;

  const intro = () =>
    root.replaceChildren(
      h('h1', {}, 'Vocabulary size test'),
      h('div', { class: 'card' },
        h('p', {}, 'You will see Norwegian words and some invented nonsense words. Answer "I know it" only if you could explain the word to someone. The nonsense words let the test correct for guessing.'),
        h('p', { class: 'muted' }, 'Words in this list: ' + words.length + '. Estimates are in units of this list, so they are comparable between tests.'),
        h('button', { class: 'primary', onclick: start }, 'Start test'),
      ),
    );

  function start() {
    const items = sampleTest(words, Math.random);
    const responses = [];
    let i = 0;
    const show = () => {
      if (i >= items.length) return finish(responses);
      const item = items[i];
      const idx = i;
      const shownAt = performance.now();
      const answer = (known) => {
        if (i !== idx || performance.now() - shownAt < 250) return;
        responses.push({ kind: item.kind, band: item.band, known });
        i++;
        show();
      };
      root.replaceChildren(
        h('h1', {}, 'Vocabulary size test'),
        h('p', { class: 'muted' }, `Word ${i + 1} of ${items.length}`),
        h('div', { class: 'card' },
          h('div', { class: 'big' }, item.text),
          h('div', { class: 'row' },
            h('button', { class: 'primary', onclick: () => answer(true) }, 'I know it'),
            h('button', { onclick: () => answer(false) }, "I don't know it"),
          ),
        ),
      );
    };
    show();
  }

  async function finish(responses) {
    let result;
    try {
      result = scoreTest(responses, bandSizes(words));
    } catch (e) {
      const msg = e instanceof RangeError
        ? 'You marked every nonsense word as known, so the guessing correction cannot be computed. Nothing was saved. Please retake the test.'
        : e.message;
      root.replaceChildren(
        h('h1', {}, 'Result not available'),
        h('p', { class: 'error' }, msg),
        h('button', { onclick: intro }, 'Back'),
      );
      return;
    }
    let saveError = null;
    try {
      await add(db, 'tests', { timestamp: Date.now(), ...result });
    } catch (e) {
      saveError = e;
    }
    root.replaceChildren(
      h('h1', {}, 'Your result'),
      ...(saveError ? [h('p', { class: 'error' }, `This result could not be saved (${saveError.message}) and will not appear in your progress.`)] : []),
      h('div', { class: 'card' },
        h('div', { class: 'big' }, `≈ ${result.estimate.toLocaleString('en')} words`),
        h('p', { class: 'muted' }, `95% interval: ${result.ciLow.toLocaleString('en')} – ${result.ciHigh.toLocaleString('en')} of ${result.listSize.toLocaleString('en')} words in the list. You marked ${Math.round(result.falseAlarmRate * 100)}% of ${result.pseudoTotal} nonsense words as known.`),
        h('p', { class: 'muted' }, 'This counts word families in our list, not every compound or inflected form, so treat it as a comparable index rather than an absolute total.'),
      ),
      h('table', {},
        h('thead', {}, h('tr', {}, ['Band', 'Words in list', 'Sampled', 'Marked known', 'Corrected'].map((t) => h('th', {}, t)))),
        h('tbody', {}, result.bands.map((b) => h('tr', {},
          h('td', {}, b.band), h('td', {}, b.size), h('td', {}, b.sampled), h('td', {}, b.known), h('td', {}, `${Math.round(b.pCorrected * 100)}%`)))),
      ),
      h('p', {}, h('a', { href: '#/dashboard' }, 'See your progress →')),
    );
  }

  intro();
}

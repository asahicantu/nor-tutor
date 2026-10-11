// Buttons and notes for text to speech (src/speech.js). Only one button plays at a time; pressing it again stops it.
import { h, pref, setPref } from '../dom.js';
import { speak, speakAll, stop, speechSupported, speechInfo } from '../speech.js';

export const isSlow = () => pref('ttsSlow', false);

let active = null; // { btn, idle } of the button that is playing right now

const silence = () => {
  stop();
  active?.idle();
  active = null;
};
// Leaving the page (or a card being redrawn) must not leave audio running with nothing on screen to stop it.
if (typeof window !== 'undefined') window.addEventListener('hashchange', silence);

// Wires a button to a player function that returns a promise (resolved when the audio ends or is replaced).
// `pressed`: expose the playing state as aria-pressed (off for buttons whose label already changes to "Stop").
function bind(btn, setPlaying, play, { pressed = true } = {}) {
  if (!speechSupported()) {
    btn.disabled = true;
    btn.title = 'Speech is not available in this browser';
    return btn;
  }
  const idle = () => { setPlaying(false); if (pressed) btn.setAttribute('aria-pressed', 'false'); };
  btn.addEventListener('click', async () => {
    if (active && !active.btn.isConnected) silence(); // the button that was playing has been removed from the page
    if (active?.btn === btn) { silence(); return; }
    active?.idle();
    active = { btn, idle };
    setPlaying(true);
    if (pressed) btn.setAttribute('aria-pressed', 'true');
    await play();
    if (active?.btn === btn) { idle(); active = null; }
  });
  return btn;
}

// 🔊 icon button that says `text`. `label` names it for screen readers (default: the text itself).
export function speakButton(text, { label = text, cls = '' } = {}) {
  const icon = h('span', { class: 'icon', 'aria-hidden': 'true' }, '🔊');
  const btn = h('button', { type: 'button', class: `speak ${cls}`.trim(), 'aria-label': `Listen: ${label}`, 'aria-pressed': 'false', title: 'Listen' }, icon);
  return bind(btn, (on) => { icon.textContent = on ? '⏹️' : '🔊'; }, () => speak(text, { slow: isSlow() }));
}

// Button with a visible label that reads several lines in a row, e.g. every example in the Context panel.
export function speakAllButton(getLines, { label = 'Read all', cls = '' } = {}) {
  const icon = h('span', { class: 'icon', 'aria-hidden': 'true' }, '🔊');
  const text = h('span', {}, label);
  const btn = h('button', { type: 'button', class: `speakall ${cls}`.trim(), title: 'Listen to all of it, one after another' }, icon, ' ', text);
  return bind(btn, (on) => { icon.textContent = on ? '⏹️' : '🔊'; text.textContent = on ? 'Stop' : label; }, () => speakAll(getLines(), { slow: isSlow() }), { pressed: false });
}

// A switch for slower speech, remembered between visits.
export function slowSwitch() {
  const box = h('input', { type: 'checkbox' });
  box.checked = isSlow();
  box.addEventListener('change', () => setPref('ttsSlow', box.checked));
  return h('label', { class: 'switch', title: 'Speak more slowly' }, box, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true' }, '🐢 '), 'Slow speech');
}

// A short note that appears only when audio will not work well: no speech support, no Norwegian voice installed, or the only
// Norwegian voice is an online one (browsers may then send the spoken text to their speech service).
export function audioNotice() {
  const note = h('p', { class: 'muted audio-note', role: 'status', hidden: true });
  speechInfo().then(({ supported, hasNorwegian, online }) => {
    if (supported && hasNorwegian && !online) return;
    note.textContent = !supported
      ? '🔈 This browser cannot read text aloud, so the listen buttons are turned off.'
      : !hasNorwegian
        ? '🔈 No Norwegian voice is installed, so words may sound foreign. Add a Norwegian (Bokmål) voice in your system language settings for better pronunciation.'
        : '🔈 The Norwegian voice available here is an online voice: your browser may send the words you play to its speech service. Installing a Norwegian voice in your system settings keeps it on your computer.';
    note.hidden = false;
  }).catch(() => {});
  return note;
}

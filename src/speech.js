// Text to speech with the browser's built-in Web Speech API: no dependency and nothing leaves the browser except what the
// browser's own voice may do. The pure helpers (pickVoice, cleanForSpeech, rateFor) are tested in tests/speech.test.js.
import { splitEmoji } from './grammar.js';

export const LANG = 'nb-NO';

const norm = (lang) => lang.replace('_', '-').toLowerCase();

// The best installed voice for Bokmål: nb first, then generic Norwegian, then Nynorsk; null when there is none.
// Within a language, voices installed on this machine beat online ones (an online voice may send the text to a speech
// service), and natural-sounding voices beat plain ones.
export function pickVoice(voices) {
  let best = null;
  let bestScore = 0;
  for (const v of voices) {
    const l = norm(v.lang);
    const base = l === 'nb' || l.startsWith('nb-') ? 3 : l === 'no' || l.startsWith('no-') ? 2 : l === 'nn' || l.startsWith('nn-') ? 1 : 0;
    if (!base) continue;
    const score = base + (v.localService ? 0.6 : 0) + (/natural|neural/i.test(v.name) ? 0.2 : 0);
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

// What to actually say: no **bold** markup, no emoji, one space between words.
export const cleanForSpeech = (text) =>
  splitEmoji(text.replaceAll('**', '')).filter((p) => !p.emoji).map((p) => p.text).join('').replace(/\s+/g, ' ').trim();

export const rateFor = (slow) => (slow ? 0.7 : 0.95);

// --- browser side (these touch window.speechSynthesis, so they are not unit-tested)
export const speechSupported = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

// Voices load asynchronously in some browsers: wait for them, but not forever. Once they are known they are kept, so only
// the first button press can ever wait.
let loaded = null;
export function voicesReady(timeoutMs = 1500) {
  if (!speechSupported()) return Promise.resolve([]);
  if (loaded) return Promise.resolve(loaded);
  const now = speechSynthesis.getVoices();
  if (now.length) { loaded = now; return Promise.resolve(now); }
  return new Promise((resolve) => {
    const done = () => { speechSynthesis.removeEventListener('voiceschanged', done); clearTimeout(timer); const v = speechSynthesis.getVoices(); if (v.length) loaded = v; resolve(v); };
    const timer = setTimeout(done, timeoutMs);
    speechSynthesis.addEventListener('voiceschanged', done);
  });
}

// { supported, voice, hasNorwegian, online }: what the page should tell the learner about audio.
export async function speechInfo() {
  if (!speechSupported()) return { supported: false, voice: null, hasNorwegian: false, online: false };
  const voice = pickVoice(await voicesReady());
  return { supported: true, voice: voice?.name ?? null, hasNorwegian: voice !== null, online: voice !== null && !voice.localService };
}

let current = null; // keep a reference: some browsers drop an utterance that is garbage collected before it ends
let token = 0; // bumped by stop() and by every new speak(), so an older call can tell it was replaced

export function stop() {
  token++;
  if (speechSupported()) speechSynthesis.cancel();
  current = null;
}

// One utterance. Resolves true when it finished and is still the current request, false if stopped, replaced or failed.
async function say(text, slow, mine) {
  const clean = cleanForSpeech(text);
  if (!clean || !speechSupported()) return false;
  const voice = pickVoice(await voicesReady());
  if (mine !== token) return false; // something else took over while the voices loaded
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = voice?.lang ?? LANG;
    if (voice) u.voice = voice;
    u.rate = rateFor(slow);
    u.onend = () => { if (current === u) current = null; resolve(mine === token); };
    u.onerror = () => { if (current === u) current = null; resolve(false); };
    current = u;
    speechSynthesis.speak(u);
  });
}

// Say `text` in Norwegian, replacing anything already speaking.
export function speak(text, { slow = false } = {}) {
  stop();
  return say(text, slow, token);
}

// Say several lines one after another; ends as soon as stop() or another speak() takes over.
export async function speakAll(lines, { slow = false } = {}) {
  stop();
  const mine = token;
  for (const line of lines) {
    if (cleanForSpeech(line) === '') continue;
    if (!(await say(line, slow, mine))) return false;
  }
  return mine === token;
}
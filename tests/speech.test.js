import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVoice, cleanForSpeech, rateFor, LANG } from '../src/speech.js';

const v = (lang, name = lang, localService = true) => ({ lang, name, localService });

test('pickVoice prefers Bokmål, then generic Norwegian, then Nynorsk, and otherwise returns null', () => {
  assert.equal(LANG, 'nb-NO');
  assert.equal(pickVoice([v('en-US'), v('nn-NO', 'nynorsk'), v('no-NO', 'generic'), v('nb-NO', 'bokmal')]).name, 'bokmal');
  assert.equal(pickVoice([v('en-US'), v('nn-NO', 'nynorsk'), v('no-NO', 'generic')]).name, 'generic');
  assert.equal(pickVoice([v('en-US'), v('nn-NO', 'nynorsk')]).name, 'nynorsk');
  assert.equal(pickVoice([v('en-US'), v('da-DK'), v('sv-SE')]), null);
  assert.equal(pickVoice([]), null);
});

test('pickVoice accepts underscore locales (Android) and a bare "nb"', () => {
  assert.equal(pickVoice([v('en_US'), v('nb_NO', 'android')]).name, 'android');
  assert.equal(pickVoice([v('en-US'), v('nb', 'bare')]).name, 'bare');
});

test('pickVoice prefers voices installed on this machine over online ones (privacy), then natural-sounding ones', () => {
  const online = v('nb-NO', 'Microsoft Nora Online (Natural) - Norwegian (Bokmål)', false);
  assert.equal(pickVoice([v('nb-NO', 'Basic', true), online, v('nb-NO', 'Other', false)]).name, 'Basic'); // local beats a natural online voice
  assert.equal(pickVoice([v('nb-NO', 'Remote', false), v('nb-NO', 'Local', true)]).name, 'Local');
  assert.match(pickVoice([v('nb-NO', 'Plain', true), v('nb-NO', 'Neural voice', true)]).name, /Neural/); // among local voices, natural wins
  assert.match(pickVoice([v('nb-NO', 'Plain', false), online]).name, /Natural/); // among online voices too
  assert.equal(pickVoice([v('no-NO', 'Generic local', true), v('nb-NO', 'Bokmål online', false)]).name, 'Bokmål online'); // language still outranks locality
});

test('cleanForSpeech removes markup, emoji and extra spaces but keeps the Norwegian text', () => {
  assert.equal(cleanForSpeech('  **hund** 🐕   og katt  '), 'hund og katt');
  assert.equal(cleanForSpeech('Hun går til jobben hver dag.'), 'Hun går til jobben hver dag.');
  assert.equal(cleanForSpeech('1️⃣ en / 2️⃣ to'), 'en / to');
  assert.equal(cleanForSpeech('   '), '');
});

test('rateFor is slower when slow speech is on', () => {
  assert.ok(rateFor(true) < rateFor(false));
  assert.ok(rateFor(true) >= 0.5 && rateFor(false) <= 1.2);
});

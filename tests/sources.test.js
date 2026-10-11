import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROUPS, validateSources, matchesLevel, groupSources } from '../src/sources.js';

const good = (extra = {}) => ({
  id: 'a', name: 'A', url: 'https://example.no/', group: 'News', description: 'Something.',
  levels: ['B1', 'B2'], siteLanguage: 'Norwegian', access: 'Free', checked: '2026-10-11', ...extra,
});

test('validateSources accepts a good record', () => {
  assert.deepEqual(validateSources([good()]), []);
});

test('validateSources rejects each failure mode', () => {
  const bad = (extra) => validateSources([good(extra)]).length > 0;
  assert.ok(validateSources(null).length);
  assert.ok(validateSources([]).length);
  assert.ok(bad({ name: ' ' }));
  assert.ok(bad({ description: undefined }));
  assert.ok(bad({ checked: undefined }));
  assert.ok(bad({ checked: '2026-13-40' }));
  assert.ok(bad({ checked: 'yesterday' }));
  assert.ok(bad({ group: 'Other' }));
  assert.ok(bad({ url: 'http://example.no/' }));
  assert.ok(bad({ url: 'not a url' }));
  assert.ok(bad({ levels: ['B2', 'B1'] }));
  assert.ok(bad({ levels: ['B1'] }));
  assert.ok(bad({ levels: ['A1', 'D9'] }));
  assert.ok(bad({ siteLanguage: 'French' }));
  assert.ok(bad({ access: 'Cheap' }));
  assert.ok(validateSources([good(), good({ url: 'https://other.no/' })]).some((e) => e.includes('duplicate id')));
  assert.ok(validateSources([good(), good({ id: 'b' })]).some((e) => e.includes('duplicate url')));
});

test('matchesLevel is inclusive at the bounds and false for null', () => {
  const s = good();
  assert.equal(matchesLevel(s, 'B1'), true);
  assert.equal(matchesLevel(s, 'B2'), true);
  assert.equal(matchesLevel(s, 'A2'), false);
  assert.equal(matchesLevel(s, 'C1'), false);
  assert.equal(matchesLevel(s, null), false);
});

test('groupSources keeps GROUPS order and omits empty groups', () => {
  const out = groupSources([good({ group: 'Courses' }), good({ id: 'b', group: 'News' })]);
  assert.deepEqual(out.map((g) => g.group), ['News', 'Courses']);
  assert.equal(GROUPS.length, 5);
});

test('data/sources.json is valid and includes the required sites', () => {
  const list = JSON.parse(readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateSources(list), []);
  assert.ok(list.length >= 12);
  assert.ok(list.some((s) => s.url.replace(/\/$/, '') === 'https://laernorsknaa.com'));
  assert.ok(list.some((s) => new URL(s.url).hostname.endsWith('nrk.no')));
});

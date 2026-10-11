import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { GROUPS, GROUP_META, validateSources, matchesLevel, groupSources, filterSources } from '../src/sources.js';

const good = (extra = {}) => ({
  id: 'a', name: 'A', url: 'https://example.no/', group: 'News', description: 'Something.', emoji: '📰',
  levels: ['B1', 'B2'], siteLanguage: 'Norwegian', access: 'Free', checked: '2026-10-11', ...extra,
});

test('validateSources accepts a good record, with or without a logo', () => {
  assert.deepEqual(validateSources([good()]), []);
  assert.deepEqual(validateSources([good({ logo: 'assets/logos/a.png' })]), []);
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
  assert.ok(bad({ group: 'Dictionaries and grammar' })); // the old combined group no longer exists
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

test('validateSources requires one emoji and a logo path that matches the id', () => {
  const bad = (extra) => validateSources([good(extra)]).length > 0;
  assert.ok(bad({ emoji: undefined }));
  assert.ok(bad({ emoji: '' }));
  assert.ok(bad({ emoji: 'abc' }));
  assert.ok(bad({ emoji: '📰📰' }));
  assert.ok(bad({ logo: 'assets/logos/other.png' })); // named after a different id
  assert.ok(bad({ logo: 'assets/logos/a.exe' }));
  assert.ok(bad({ logo: '../a.png' }));
  assert.ok(bad({ logo: 'https://evil.example/a.png' })); // only bundled files, never remote images
  assert.ok(bad({ logo: 'assets/logos/a.png?x=1' }));
});

test('validateSources rejects ids that could escape assets/logos or break a logo pattern', () => {
  const bad = (extra) => validateSources([good(extra)]).length > 0;
  assert.ok(bad({ id: 'x|', logo: 'https://evil.example/a.png' })); // a "|" used to turn the check into an alternation
  assert.ok(bad({ id: '../../src/x', logo: 'assets/logos/../../src/x.png' }));
  assert.ok(bad({ id: 'Weird Id!' }));
  assert.ok(bad({ id: 'UPPER' }));
  assert.ok(bad({ id: 'a.b', logo: 'assets/logos/a.b.png' }));
  assert.deepEqual(validateSources([good({ id: 'ok-id-2', logo: 'assets/logos/ok-id-2.svg' })]), []);
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
});

test('every group has an emoji, a slug and a purpose line', () => {
  assert.equal(GROUPS.length, 8);
  for (const g of GROUPS) assert.ok(GROUP_META[g].emoji && GROUP_META[g].slug && GROUP_META[g].blurb, g);
  assert.equal(new Set(GROUPS.map((g) => GROUP_META[g].slug)).size, GROUPS.length);
});

test('filterSources combines search, group, level and free-only', () => {
  const list = [
    good({ id: 'a', name: 'Alfa', group: 'News', levels: ['B1', 'C2'], access: 'Free' }),
    good({ id: 'b', name: 'Beta', group: 'Courses', description: 'Grammar drills', levels: ['A1', 'A2'], access: 'Partly free' }),
    good({ id: 'c', name: 'Ørsted', group: 'Courses', levels: ['A2', 'B1'], access: 'Paywall' }),
  ];
  const ids = (o) => filterSources(list, o).map((s) => s.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c']);
  assert.deepEqual(ids({ group: 'Courses' }), ['b', 'c']);
  assert.deepEqual(ids({ query: ' GRAMMAR ' }), ['b']); // case-insensitive, trims, searches the description
  assert.deepEqual(ids({ query: 'ørs' }), ['c']);
  assert.deepEqual(ids({ query: 'courses' }), ['b', 'c']); // and the group name
  assert.deepEqual(ids({ freeOnly: true }), ['a']);
  assert.deepEqual(ids({ goodFor: true, level: 'A2' }), ['b', 'c']);
  assert.deepEqual(ids({ goodFor: true, level: null }), []); // no level known: nothing is "good for your level"
  assert.deepEqual(ids({ group: 'Courses', goodFor: true, level: 'B1', query: 'ørs' }), ['c']);
  assert.deepEqual(ids({ query: 'zzz' }), []);
});

test('data/sources.json is valid, covers every group, and every bundled logo file exists', () => {
  const list = JSON.parse(readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateSources(list), []);
  assert.ok(list.length >= 40, `only ${list.length} sources`);
  assert.ok(list.some((s) => s.url.replace(/\/$/, '') === 'https://laernorsknaa.com'));
  assert.ok(list.some((s) => new URL(s.url).hostname.endsWith('nrk.no')));
  for (const g of GROUPS) assert.ok(list.some((s) => s.group === g), `no source in ${g}`);
  for (const s of list.filter((x) => x.logo)) assert.ok(existsSync(new URL(`../${s.logo}`, import.meta.url)), `missing ${s.logo}`);
  assert.ok(list.filter((s) => s.logo).length >= list.length * 0.8, 'most sources should have a logo');
});

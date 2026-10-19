import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { openStore } from '../tools/store.mjs';
import { createApi } from '../tools/api.mjs';

let server, port, origin, cookie;

before(async () => {
  let api;
  server = createServer((req, res) => api(req, res, new URL(req.url, 'http://x').pathname));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  api = createApi(openStore(':memory:'), origin);
  const res = await rawCall('POST', '/api/signup', { username: 'tester', password: 'secret1' });
  cookie = res.headers['set-cookie'][0].split(';')[0];
});
after(() => server.close());

function rawCall(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: { origin, 'content-type': 'application/json', ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : undefined }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

const call = async (method, path, { body, headers = {} } = {}) => {
  const { status, body: out } = await rawCall(method, path, body, { cookie, ...headers });
  return { status, body: out };
};

const empty = { cards: [], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [], settings: [] };
const reset = () => call('PUT', '/api/state', { body: { version: 2, ...empty } });
const card = (wordId, reps = 0) => ({ wordId, ease: 2.5, interval: 0, reps, lapses: 0, due: 1 });
const keyPath = (store, id) => `/api/${store}/${encodeURIComponent(JSON.stringify(id))}`;

test('state starts empty', async () => {
  assert.equal((await reset()).status, 204);
  assert.deepEqual(await call('GET', '/api/state'), { status: 200, body: empty });
});

test('add, conflict, list and delete a known word with a slash in its id', async () => {
  await reset();
  const row = { wordId: 'a/b', timestamp: 1 };
  assert.equal((await call('POST', '/api/known', { body: row })).status, 204);
  assert.equal((await call('POST', '/api/known', { body: row })).status, 409);
  assert.deepEqual((await call('GET', '/api/known')).body, [row]);
  assert.equal((await call('DELETE', keyPath('known', 'a/b'))).status, 204);
  assert.deepEqual((await call('GET', '/api/known')).body, []);
});

test('put upserts a card; put on reviews and delete on tests are not allowed', async () => {
  await reset();
  await call('PUT', '/api/cards', { body: card(1) });
  await call('PUT', '/api/cards', { body: card(1, 4) });
  assert.deepEqual((await call('GET', '/api/cards')).body, [card(1, 4)]);
  assert.equal((await call('PUT', '/api/reviews', { body: { wordId: 1, timestamp: 1, grade: 'good' } })).status, 405);
  assert.equal((await call('DELETE', keyPath('tests', 1))).status, 405);
});

test('rejects invalid rows, bad JSON, unknown stores and bad keys', async () => {
  assert.equal((await call('POST', '/api/known', { body: { wordId: 1 } })).status, 400);
  assert.equal((await call('POST', '/api/known', { body: '{oops' })).status, 400);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('DELETE', '/api/known/%7Bnot-json')).status, 400);
});

test('rejects other hosts, other origins and non-JSON bodies', async () => {
  const row = { wordId: 5, timestamp: 1 };
  const wrongHost = await call('GET', '/api/state', { headers: { host: `localhost:${port}` } });
  assert.equal(wrongHost.status, 403);
  assert.match(wrongHost.body.error, /127\.0\.0\.1/);
  assert.equal((await call('POST', '/api/known', { body: row, headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/api/known', { body: row, headers: { 'content-type': 'text/plain' } })).status, 415);
});

test('PUT /api/state validates the whole backup and changes nothing on error', async () => {
  await reset();
  await call('POST', '/api/known', { body: { wordId: 9, timestamp: 1 } });
  const bad = await call('PUT', '/api/state', { body: { version: 2, ...empty, cards: [card(1), card(1)] } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Duplicate card/);
  assert.deepEqual((await call('GET', '/api/known')).body, [{ wordId: 9, timestamp: 1 }]);
  assert.equal((await call('PUT', '/api/state', { body: { version: 1, cards: [card(1)], reviews: [], tests: [] } })).status, 204);
  assert.deepEqual((await call('GET', '/api/state')).body, { ...empty, cards: [card(1)] });
});

test('oversized bodies are refused', async () => {
  const big = JSON.stringify({ wordId: 1, timestamp: 1, pad: 'x'.repeat(5 * 1024 * 1024) });
  assert.equal((await call('POST', '/api/known', { body: big })).status, 413);
});

test('awards: POST once, second POST is 409, bad row is 400', async () => {
  await reset();
  assert.equal((await call('POST', '/api/awards', { body: { awardId: 'first-test', timestamp: 1 } })).status, 204);
  assert.equal((await call('POST', '/api/awards', { body: { awardId: 'first-test', timestamp: 2 } })).status, 409);
  assert.equal((await call('POST', '/api/awards', { body: { awardId: 7, timestamp: 2 } })).status, 400);
  assert.deepEqual((await call('GET', '/api/awards')).body, [{ awardId: 'first-test', timestamp: 1 }]);
});

test('settings: PUT upserts by key, GET returns it, bad rows are 400', async () => {
  await reset();
  assert.equal((await call('PUT', '/api/settings', { body: { key: 'profileName', value: 'Asahi' } })).status, 204);
  assert.equal((await call('PUT', '/api/settings', { body: { key: 'profileName', value: 'Åse' } })).status, 204);
  assert.deepEqual((await call('GET', '/api/settings')).body, [{ key: 'profileName', value: 'Åse' }]);
  assert.equal((await call('PUT', '/api/settings', { body: { key: 'profileName', value: 7 } })).status, 400);
  assert.equal((await call('PUT', '/api/settings', { body: { key: '', value: 'x' } })).status, 400);
  assert.equal((await call('PUT', '/api/settings', { body: { key: 'k'.repeat(41), value: 'x' } })).status, 400);
});

test('data routes need a login and users are separated', async () => {
  assert.equal((await rawCall('GET', '/api/state')).status, 401);
  assert.equal((await rawCall('POST', '/api/login', { username: 'tester', password: 'nope' })).status, 401);
  assert.equal((await rawCall('POST', '/api/signup', { username: 'TESTER', password: 'secret1' })).status, 409);
  assert.equal((await rawCall('POST', '/api/signup', { username: 'ab', password: 'secret1' })).status, 400);
  await reset();
  await call('POST', '/api/known', { body: { wordId: 1, timestamp: 1 } });
  const other = await rawCall('POST', '/api/signup', { username: 'other', password: 'secret2' });
  const res = await rawCall('GET', '/api/state', undefined, { cookie: other.headers['set-cookie'][0].split(';')[0] });
  assert.deepEqual(res.body, empty);
  assert.equal((await call('GET', '/api/me')).body.username, 'tester');
  assert.equal((await call('POST', '/api/logout')).status, 204);
  assert.equal((await call('GET', '/api/me')).status, 401);
});

test('change password needs the current password and keeps the session', async () => {
  cookie = (await rawCall('POST', '/api/login', { username: 'tester', password: 'secret1' })).headers['set-cookie'][0].split(';')[0];
  assert.equal((await call('POST', '/api/password', { body: { current: 'wrong', next: 'newsecret' } })).status, 403);
  assert.equal((await call('POST', '/api/password', { body: { current: 'secret1', next: 'abc' } })).status, 400);
  assert.equal((await call('POST', '/api/password', { body: { current: 'secret1', next: 'newsecret' } })).status, 204);
  assert.equal((await call('GET', '/api/me')).status, 200);
  assert.equal((await rawCall('POST', '/api/login', { username: 'tester', password: 'secret1' })).status, 401);
  assert.equal((await rawCall('POST', '/api/login', { username: 'tester', password: 'newsecret' })).status, 200);
});

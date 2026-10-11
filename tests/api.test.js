import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { openStore } from '../tools/store.mjs';
import { createApi } from '../tools/api.mjs';

let server, port, origin;

before(async () => {
  let api;
  server = createServer((req, res) => api(req, res, new URL(req.url, 'http://x').pathname));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  api = createApi(openStore(':memory:'), origin);
});
after(() => server.close());

function call(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: { origin, 'content-type': 'application/json', ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : undefined }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

const empty = { cards: [], reviews: [], tests: [], known: [], unknown: [], phrases: [] };
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

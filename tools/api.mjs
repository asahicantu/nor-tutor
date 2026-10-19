import { parseBackup, validRow, STORES } from '../src/backup.js';
import { randomBytes } from 'node:crypto';
import { KEYED, ConflictError } from './store.mjs';

const MAX_BODY = 5 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk); // keep draining so the client gets the 413 instead of a reset
  }
  if (size > MAX_BODY) throw new HttpError(413, 'Request body is too large');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

function parseKey(segment) {
  let key;
  try {
    key = JSON.parse(decodeURIComponent(segment));
  } catch {
    throw new HttpError(400, 'Bad key');
  }
  if (typeof key !== 'number' && typeof key !== 'string') throw new HttpError(400, 'Bad key');
  return key;
}

// Host check stops DNS rebinding; Origin + JSON content type stop other websites from writing.
const USERNAME = /^[A-Za-z0-9_.-]{3,30}$/;
const cookieOf = (req) => /(?:^|;\s*)sid=([0-9a-f]+)/.exec(req.headers.cookie ?? '')?.[1];

export function createApi(root, origin) {
  const host = new URL(origin).host;
  const sessions = new Map(); // token -> user id; in memory, so a server restart logs everyone out
  return async function handleApi(req, res, rawPath) {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      if (req.headers.host !== host) throw new HttpError(403, `Open the app at ${origin}`);
      if (req.method !== 'GET' && req.headers.origin !== origin) throw new HttpError(403, 'Request from another site refused');
      const [name, keySegment, ...rest] = rawPath.slice('/api/'.length).split('/');
      if (rest.length) throw new HttpError(404, 'Not found');

      if (name === 'login' || name === 'signup') {
        if (keySegment !== undefined) throw new HttpError(404, 'Not found');
        if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
        const { username, password } = await readJson(req);
        if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Username and password are required');
        let user;
        if (name === 'signup') {
          if (!USERNAME.test(username)) throw new HttpError(400, 'Username must be 3-30 letters, digits, . _ or -');
          if (password.length < 6 || password.length > 200) throw new HttpError(400, 'Password must be 6-200 characters');
          user = { id: root.createUser(username, password), username };
        } else {
          user = root.verifyUser(username, password);
          if (!user) throw new HttpError(401, 'Wrong username or password');
        }
        const token = randomBytes(32).toString('hex');
        sessions.set(token, user.id);
        res.setHeader('set-cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/`);
        return send(200, { username: user.username });
      }

      const uid = sessions.get(cookieOf(req));
      if (name === 'logout') {
        if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
        sessions.delete(cookieOf(req));
        res.setHeader('set-cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return send(204);
      }
      if (uid === undefined) throw new HttpError(401, 'Not logged in');
      const store = root.as(uid);
      if (name === 'password' && keySegment === undefined) {
        if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
        const { current, next } = await readJson(req);
        if (typeof current !== 'string' || typeof next !== 'string') throw new HttpError(400, 'Current and new password are required');
        if (next.length < 6 || next.length > 200) throw new HttpError(400, 'Password must be 6-200 characters');
        if (!root.changePassword(uid, current, next)) throw new HttpError(403, 'Current password is wrong');
        for (const [t, id] of sessions) if (id === uid && t !== cookieOf(req)) sessions.delete(t); // log out other devices
        return send(204);
      }
      if (name === 'me' && keySegment === undefined) return send(200, { username: root.getUser(uid).username });

      if (name === 'state' && keySegment === undefined) {
        if (req.method === 'GET') return send(200, store.loadState());
        if (req.method !== 'PUT') throw new HttpError(405, 'Method not allowed');
        const body = await readJson(req);
        let state;
        try {
          state = parseBackup(JSON.stringify(body));
        } catch (e) {
          throw new HttpError(400, e.message);
        }
        store.replaceState(state);
        return send(204);
      }

      if (!STORES.includes(name)) throw new HttpError(404, 'Not found');
      if (keySegment !== undefined) {
        if (req.method !== 'DELETE' || !KEYED.has(name)) throw new HttpError(405, 'Method not allowed');
        store.del(name, parseKey(keySegment));
        return send(204);
      }
      if (req.method === 'GET') return send(200, store.getAll(name));
      if (req.method !== 'POST' && !(req.method === 'PUT' && KEYED.has(name))) throw new HttpError(405, 'Method not allowed');
      const row = await readJson(req);
      if (!validRow(name, row)) throw new HttpError(400, `Invalid ${name} row`);
      if (req.method === 'POST') store.add(name, row);
      else store.put(name, row);
      return send(204);
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      if (e instanceof ConflictError) return send(409, { error: e.message });
      console.error(e);
      return send(500, { error: 'Internal error' });
    }
  };
}

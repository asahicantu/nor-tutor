// Dev tool: downloads each source's site icon once into assets/logos/<id>.<ext>, so the Sources page shows logos offline
// and never contacts the sites just to draw itself. Run it again after adding sources:
//   node tools/fetch-logos.mjs            fetch missing logos and write the `logo` field into data/sources.json
//   node tools/fetch-logos.mjs --force    re-download every logo
//   node tools/fetch-logos.mjs --only nrk-nyheter,snl
// Icons are trademarks of their owners and are shown only to identify each site (see assets/logos/ATTRIBUTION.md).
// Everything downloaded is untrusted data: only https, no private hosts, a hard size cap, and a strict image check.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { validateSources } from '../src/sources.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const MAX_BYTES = 64 * 1024; // logos are drawn at 40px: anything bigger is wasted weight
const PAGE_BYTES = 300 * 1024;
const UA = 'norsk-tutor-logo-fetch/1.0 (personal learning app)';

// Loopback, private and link-local hosts are never fetched (a page could redirect us to the user's own network).
export function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// SVG is only accepted when nothing in it can run code or pull in anything from outside: no scripts, handlers,
// animation of attributes, entities or character references, stylesheets, imports, or references other than #fragments
// and embedded data:image/ URIs.
const SVG_BANNED = /<script|<foreignObject|<iframe|<embed|<object|<animate|<set[\s>]|\son[a-z]+\s*=|javascript:|&#|<!ENTITY|<\?xml-stylesheet|@import/i;
function svgIsSafe(text) {
  if (SVG_BANNED.test(text)) return false;
  const refs = [...text.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
  refs.push(...[...text.matchAll(/url\(\s*["']?([^)"']*)/gi)].map((m) => m[1]));
  return refs.every((r) => r.trim().startsWith('#') || /^data:image\/(png|jpeg|webp|gif);/i.test(r.trim()));
}

// Which image type are these bytes? Returns 'png' | 'jpg' | 'ico' | 'webp' | 'svg' | null.
export function sniffImage(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 12) return null;
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) {
    const count = b.readUInt16LE(4);
    return count >= 1 && 6 + 16 * count <= b.length ? 'ico' : null;
  }
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const head = b.subarray(0, 4096).toString('utf8').trimStart();
  if (/^(<\?xml\s[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>[]*>\s*)?<svg[\s>]/i.test(head)) return svgIsSafe(b.toString('utf8')) ? 'svg' : null;
  return null;
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((x) => x !== undefined);

// Icon URLs advertised by a page, best first: apple-touch-icon, then SVG, then the largest PNG, then any icon, then /favicon.ico.
export function pickIcons(html, baseUrl) {
  const found = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attr(tag, 'href');
    if (!href || !(rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed'))) continue;
    let url;
    try { url = new URL(href.replaceAll('&amp;', '&'), baseUrl); } catch { continue; }
    if (url.protocol !== 'https:' || isPrivateHost(url.hostname)) continue;
    const size = Math.max(0, ...(attr(tag, 'sizes') ?? '').split(/\s+/).map((s) => parseInt(s, 10) || 0));
    const svg = /\.svg(\?|$)/i.test(url.pathname) || /svg/i.test(attr(tag, 'type') ?? '');
    const score = rel.some((r) => r.startsWith('apple-touch-icon')) ? 1000 + size : svg ? 900 : 100 + size;
    found.push({ url: url.href, score });
  }
  const origin = new URL(baseUrl).origin;
  found.push({ url: `${origin}/favicon.ico`, score: 1 });
  const seen = new Set();
  return found.sort((a, b) => b.score - a.score).filter((f) => !seen.has(f.url) && seen.add(f.url)).map((f) => f.url);
}

// Fetch with a hard byte cap (read in chunks, so an endless response is cut off) and a check that redirects stayed on https
// and did not lead to a private address.
async function get(url, accept, limit) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const final = new URL(res.url);
  if (final.protocol !== 'https:' || isPrivateHost(final.hostname)) throw new Error('redirected to an unsafe address');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > limit) throw new Error('too large');
    chunks.push(chunk);
  }
  return { buf: Buffer.concat(chunks), url: res.url };
}

async function fetchLogo(source) {
  let html = '';
  let base = source.url;
  try {
    const page = await get(source.url, 'text/html', PAGE_BYTES);
    html = page.buf.toString('utf8');
    base = page.url;
  } catch { /* fall back to /favicon.ico */ }
  for (const url of pickIcons(html, base).slice(0, 5)) {
    try {
      const { buf } = await get(url, 'image/*', MAX_BYTES);
      const type = sniffImage(buf);
      if (type) return { type, buf, from: url };
    } catch { /* try the next candidate */ }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.includes('--only') ? new Set((args[args.indexOf('--only') + 1] ?? '').split(',').filter(Boolean)) : null;
  const file = join(root, 'data', 'sources.json');
  const list = JSON.parse(await readFile(file, 'utf8'));
  const problems = validateSources(list); // ids become file names, so refuse to run on bad data
  if (problems.length) {
    console.error(`data/sources.json is invalid:\n${problems.slice(0, 10).join('\n')}`);
    process.exit(1);
  }
  const dir = join(root, 'assets', 'logos');
  await mkdir(dir, { recursive: true });
  let ok = 0, skipped = 0;
  const failed = [];
  for (const s of list) {
    if (only && !only.has(s.id)) continue;
    if (s.logo && !force) { try { await access(join(root, s.logo)); skipped++; continue; } catch { /* file missing: fetch again */ } }
    const logo = await fetchLogo(s);
    if (!logo) { failed.push(s.id); console.log(`✗ ${s.id}: no usable icon`); continue; }
    s.logo = `assets/logos/${s.id}.${logo.type}`;
    await writeFile(join(root, s.logo), logo.buf);
    console.log(`✓ ${s.id}: ${logo.type} ${logo.buf.length} bytes from ${logo.from}`);
    ok++;
  }
  await writeFile(file, JSON.stringify(list, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  console.log(`\n${ok} downloaded, ${skipped} already present, ${failed.length} without a logo${failed.length ? `: ${failed.join(', ')}` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

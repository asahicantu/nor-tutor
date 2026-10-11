import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffImage, pickIcons, isPrivateHost } from '../tools/fetch-logos.mjs';

const pad = (head, n = 32) => Buffer.concat([Buffer.from(head), Buffer.alloc(n)]);

test('sniffImage recognises real image bytes and nothing else', () => {
  assert.equal(sniffImage(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(sniffImage(pad([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(sniffImage(pad([0, 0, 1, 0, 1, 0])), 'ico');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)])), 'webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')), 'svg');
  assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"><circle r="1"/></svg>')), 'svg');
  assert.equal(sniffImage(Buffer.from('<!doctype html><html><body>Not found</body></html>')), null); // an error page is not an icon
  assert.equal(sniffImage(Buffer.from('short')), null);
});

test('sniffImage refuses SVG that could run code', () => {
  for (const evil of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path/></a></svg>',
  ]) assert.equal(sniffImage(Buffer.from(evil)), null, evil);
});

test('pickIcons ranks apple-touch-icon, then SVG, then the largest PNG, and always ends with /favicon.ico', () => {
  const html = `
    <link rel="icon" href="/small.png" sizes="16x16">
    <link rel="icon" type="image/png" href="/big.png" sizes="96x96">
    <link rel="icon" href="/logo.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/touch.png" sizes="180x180">
    <link rel="stylesheet" href="/site.css">`;
  assert.deepEqual(pickIcons(html, 'https://example.no/page'), [
    'https://example.no/touch.png', 'https://example.no/logo.svg', 'https://example.no/big.png', 'https://example.no/small.png', 'https://example.no/favicon.ico',
  ]);
});

test('pickIcons resolves relative hrefs, skips http and bad urls, de-duplicates, and works with no icons at all', () => {
  const html = `<link rel="shortcut icon" href="../icons/a.png"><link rel="icon" href="http://insecure.no/x.png"><link rel='icon' href='https://[bad'><link rel="icon" href="/favicon.ico">`;
  assert.deepEqual(pickIcons(html, 'https://example.no/a/b/'), ['https://example.no/a/icons/a.png', 'https://example.no/favicon.ico']);
  assert.deepEqual(pickIcons('', 'https://example.no/'), ['https://example.no/favicon.ico']);
});

test('sniffImage refuses the SVG tricks that slipped past a naive filter', () => {
  for (const evil of [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="&#106;avascript:alert(1)"><path/></a></svg>', // character reference
    '<?xml-stylesheet type="text/xsl" href="https://evil.example/x.xsl"?><svg xmlns="http://www.w3.org/2000/svg"><path/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css);</style><path/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/pixel.png"/></svg>', // external reference
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.example/x.svg#a"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.example/p)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" to="data:text/html,x"/></a></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"><path/></svg>',
  ]) assert.equal(sniffImage(Buffer.from(evil)), null, evil);
});

test('sniffImage keeps harmless SVG: fragment references and embedded images', () => {
  const clip = '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><g clip-path="url(#c)"><path d="M0 0"/></g></svg>';
  assert.equal(sniffImage(Buffer.from(clip)), 'svg');
  const embedded = '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBORw0KGgo="/></svg>';
  assert.equal(sniffImage(Buffer.from(embedded)), 'svg');
});

test('sniffImage checks that an ICO really has a directory', () => {
  const ico = (count, len) => { const b = Buffer.alloc(len); b.writeUInt16LE(1, 2); b.writeUInt16LE(count, 4); return b; };
  assert.equal(sniffImage(ico(1, 40)), 'ico');
  assert.equal(sniffImage(ico(0, 40)), null); // no images
  assert.equal(sniffImage(ico(50, 40)), null); // directory larger than the file
});

test('isPrivateHost blocks loopback, private and link-local addresses only', () => {
  for (const h of ['localhost', 'app.localhost', 'printer.local', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', '[::1]', 'fd12:3456::1', 'fe80::1']) assert.equal(isPrivateHost(h), true, h);
  for (const h of ['www.nrk.no', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', 'example.com']) assert.equal(isPrivateHost(h), false, h);
});

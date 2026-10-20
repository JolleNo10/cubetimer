import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';

const sw = await readFile('dist/sw.js', 'utf8');
const source = sw.match(/\.precacheAndRoute\((\[.*?\]),\{/s)?.[1];
assert(source, 'Workbox precache manifest is missing');
const entries = runInNewContext(source);
const precache = new Map(entries.map(entry => [entry.url.replace(/^\//, ''), entry.revision]));
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(path, relative + '/'));
    else result.push(relative);
  }
  return result;
}
const required = (await files('dist')).filter(path => /\.(?:js|css|html|png|svg|ico|wasm|json|woff2?|webmanifest)$/.test(path)
  && path !== 'sw.js' && !/^workbox-.*\.js$/.test(path));
for (const path of required) assert(precache.has(path), `Required offline asset omitted: ${path}`);
assert(precache.has('index.html'));
const worker = 'assets/search-worker-entry.js';
assert(precache.has(worker), 'Fixed-name cubing worker missing');
assert.equal(precache.get(worker), createHash('md5').update(await readFile('dist/' + worker)).digest('hex'), 'Worker needs a content revision');
assert(sw.includes('createHandlerBoundToURL("/index.html")'), 'Missing offline navigation shell');
assert(!sw.includes('clientsClaim('), 'Background activation must not claim clients');
assert(!sw.includes('indexedDB'), 'The asset worker must not own user data');
const manifest = JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8'));
assert.equal(manifest.name, 'Cubetimer'); assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/');
for (const icon of manifest.icons) {
  const png = await readFile('dist' + icon.src), [width, height] = icon.sizes.split('x').map(Number);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
}
assert(manifest.icons.some(icon => icon.purpose === 'maskable'));
const nginx = await readFile('nginx.conf', 'utf8');
assert(nginx.indexOf('location = /assets/search-worker-entry.js') < nginx.indexOf('location /assets/'));
for (const path of ['/assets/search-worker-entry.js', '/sw.js', '/manifest.webmanifest', '/index.html']) {
  const block = nginx.slice(nginx.indexOf('location = ' + path)).split('}')[0];
  assert(block.includes('"no-cache"'), `${path} must revalidate`); assert(!block.includes('immutable'));
}
const sizes = await Promise.all(required.map(async path => ({ path, bytes: (await stat('dist/' + path)).size })));
console.log(`PWA build verified: ${required.length} required assets precached; largest ${Math.max(...sizes.map(row => row.bytes))} bytes; worker content-revisioned; icons and HTTP rules valid.`);

// Production smoke test: no dev modules and no HTTP-cache fallback.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve('dist');
const server = createServer(async (request, response) => {
  let path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path === '/') path = '/index.html';
  const file = resolve(root, '.' + path);
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const contents = await readFile(file);
    response.setHeader('Content-Type', ({ '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css',
      '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(file)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-cache'); response.end(contents);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext();
  const failures = [];
  context.on('page', page => page.on('pageerror', error => failures.push(error.message)));
  let page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.cubeDebug?.cubetimer.state.get().ready && window.cubeDebug.cubetimer.timer.state.get().scramble, {}, { timeout: 30000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.evaluate(async () => {
    const c = window.cubeDebug.cubetimer;
    await c.updateSettings({ sound: false });
    await c.createSession('Offline verification');
    c.startFromKeyboard();
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.cubeDebug.cubetimer.startFromKeyboard());
  await page.waitForFunction(() => window.cubeDebug.cubetimer.sessions.get().solves.length === 1, {}, { timeout: 10000 });
  await page.close();
  // Stop the server: even an accidentally network-backed worker cannot pass.
  await new Promise(done => server.close(done));
  await context.setOffline(true);
  page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const navigation = await page.goto(url);
  assert(navigation.fromServiceWorker(), 'Cold offline navigation did not use the cached shell');
  await page.waitForFunction(() => window.cubeDebug?.cubetimer.state.get().ready && window.cubeDebug.cubetimer.timer.state.get().scramble, {}, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.cubeDebug.cubetimer.sessions.get().solves.length), 1, 'History did not survive offline startup');
  await page.evaluate(async () => { const c = window.cubeDebug.cubetimer; await c.createSession('Offline 2x2', '222'); });
  await page.waitForFunction(() => window.cubeDebug.cubetimer.timer.state.get().scramble.length > 0, {}, { timeout: 10000 });
  await page.evaluate(() => window.cubeDebug.cubetimer.startFromKeyboard());
  await page.waitForTimeout(100);
  await page.evaluate(() => window.cubeDebug.cubetimer.startFromKeyboard());
  await page.waitForFunction(() => window.cubeDebug.cubetimer.sessions.get().solves.length === 1, {}, { timeout: 10000 });
  const backup = await page.evaluate(async () => {
    const c = window.cubeDebug.cubetimer;
    const json = await c.exportData(); await c.importData(json); return JSON.parse(await c.exportData());
  });
  assert.equal(backup.version, 7, 'Backup format changed');
  assert.equal(backup.solves.length, 2, 'Offline records or backup round-trip lost history');
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await page.waitForFunction(() => window.cubeDebug.cubetimer.state.get().area === 'training', {}, { timeout: 10000 });
  const fallback = await page.goto(url + 'offline-navigation');
  assert(fallback.fromServiceWorker(), 'Offline SPA navigation did not use the shell');
  await page.waitForFunction(() => window.cubeDebug?.cubetimer.state.get().ready, {}, { timeout: 10000 });
  assert.deepEqual(failures, []);
  console.log('Cold offline startup, 3x3/2x2 worker scrambles, retained history, offline writes, JSON round-trip, Training and SPA navigation passed (HTTP server stopped, HTTP cache disabled).');
} finally {
  await browser?.close(); if (server.listening) await new Promise(done => server.close(done));
}

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';
const root = resolve('dist');
const server = createServer(async (req, res) => {
  const file = resolve(root, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : req.url));
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try { const data = await readFile(file); res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream'); res.end(data); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.cubeDebug?.cubetimer.state.get().ready);
  await page.evaluate(() => window.cubeDebug.cubetimer.updateSettings({ holdToStart: true, inspection: false }));
  const failures = [];
  const phase = () => page.evaluate(() => window.cubeDebug.cubetimer.timer.state.get().phase);
  const arm = async () => {
    await page.keyboard.down('Space');
    await page.waitForFunction(() => document.querySelector('.timer-hint')?.textContent === 'Release to start');
  };
  const reset = async () => {
    await page.evaluate(() => { window.cubeDebug.cubetimer.cancel(); document.activeElement?.blur(); });
  };
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
    await page.evaluate(modifier => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, [modifier]: true })), modifier);
    await page.waitForTimeout(400);
    await page.evaluate(modifier => document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, [modifier]: true })), modifier);
    assert.equal(await phase(), 'scrambling', modifier + '+Space must not start timing');
  }
  for (const interruption of ['blur', 'escape', 'settings', 'training']) {
    await arm();
    if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (interruption === 'escape') await page.keyboard.press('Escape');
    if (interruption === 'settings') {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.evaluate(() => document.activeElement?.blur());
    }
    if (interruption === 'training') {
      await page.evaluate(() => window.cubeDebug.cubetimer.setArea('training'));
      await page.waitForFunction(() => !document.querySelector('.timer-card'));
      await page.evaluate(() => window.cubeDebug.cubetimer.setArea('timer'));
    }
    await page.keyboard.up('Space');
    if (await phase() !== 'scrambling') failures.push(interruption + ' followed by Space release started timing');
    await reset();
  }
  // React derives onPointerLeave from the browser's bubbling pointerout event.
  for (const event of ['pointercancel', 'pointerout']) {
    await page.locator('.timer-card').dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
    await page.waitForFunction(() => document.querySelector('.timer-hint')?.textContent === 'Release to start');
    await page.locator('.timer-card').dispatchEvent(event, { pointerId: 1 });
    await page.locator('.timer-card').dispatchEvent('pointerup', { pointerId: 1 });
    if (await phase() !== 'scrambling') failures.push(event + ' started timing');
    await reset();
  }
  // Cancelling before the threshold must also clear its pending timeout.
  await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(400);
  await page.keyboard.up('Space');
  assert.equal(await phase(), 'scrambling');
  // Fresh legitimate holds still start; cancelling input must never stop a solve.
  await arm();
  await page.keyboard.up('Space');
  assert.equal(await phase(), 'solving');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await phase(), 'solving');
  await reset();
  await page.evaluate(() => window.cubeDebug.cubetimer.updateSettings({ inspection: true }));
  await arm();
  await page.keyboard.up('Space');
  assert.equal(await phase(), 'inspection');
  await page.locator('.timer-card').dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
  await page.waitForTimeout(400);
  await page.locator('.timer-card').dispatchEvent('pointercancel', { pointerId: 1 });
  assert.equal(await phase(), 'inspection');
  await page.locator('.timer-card').dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
  await page.waitForTimeout(400);
  await page.locator('.timer-card').dispatchEvent('pointerup', { pointerId: 1 });
  assert.equal(await phase(), 'solving');
  assert.deepEqual(failures, []);
  assert.deepEqual(errors, []);
  console.log('Timer interrupted-input checks passed.');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }

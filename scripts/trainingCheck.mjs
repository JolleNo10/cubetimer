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
  // Single setup must work through touch alone, without enabling global keyboard input.
  await page.evaluate(async () => { const c = window.cubeDebug.cubetimer; c.setArea('training'); await c.selectF2lCase('F2L 4'); });
  const setup = await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().setup.split(/\s+/));
  for (const token of setup) await page.getByRole('button', { name: `Turn ${token}`, exact: true }).click();
  await page.waitForFunction(() => window.cubeDebug.cubetimer.training.state.get().phase === 'ready');
  await page.waitForFunction(async () => (await document.querySelector('twisty-player')?.experimentalGet.alg())?.toString().length > 0);
  const singleReference = await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().target.references[0].alg.split(/\s+/));
  for (const token of singleReference) await page.getByRole('button', { name: `Turn ${token}`, exact: true }).click();
  await page.waitForFunction(() => window.cubeDebug.cubetimer.training.state.get().phase === 'result');
  assert.equal(await page.evaluate(() => window.cubeDebug.cubetimer.physical.state.get().virtualCube), false);
  await page.waitForFunction(() => window.cubeDebug.cubetimer.trainingAttempts.get().length === 1);
  await page.evaluate(() => { const c = window.cubeDebug.cubetimer; c.setArea('training'); c.setTrainingActivity('drill'); c.setDrillCases(['F2L 4', 'F2L 5']); });
  await page.getByRole('button', { name: 'Start drill', exact: true }).click();
  await page.waitForFunction(() => window.cubeDebug.cubetimer.training.state.get().phase === 'ready');
  await page.getByRole('button', { name: 'Turn B', exact: true }).click();
  await page.getByRole('button', { name: 'Retry case', exact: true }).click();
  assert.equal(await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().phase), 'ready');
  await page.waitForFunction(() => document.querySelector('twisty-player')?.shadowRoot?.querySelector('canvas') || document.querySelector('twisty-player'));
  await page.waitForTimeout(1000);
  if (process.env.TRAINING_SCREENSHOTS) await page.screenshot({ path: 'training-desktop-check.png' });
  await page.getByRole('button', { name: 'Enable keyboard turns', exact: true }).click();
  // One held key is one turn, even when the OS emits repeated keydowns.
  await page.keyboard.down('j');
  await page.keyboard.down('j');
  await page.keyboard.down('j');
  await page.keyboard.up('j');
  assert.deepEqual(await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().liveMoves), ['U']);
  // Browser shortcuts must not leak into a Training attempt.
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
    await page.evaluate(modifier => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, [modifier]: true })), modifier);
  }
  assert.deepEqual(await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().liveMoves), ['U']);
  await page.keyboard.press('f');
  await page.getByRole('button', { name: 'Retry case', exact: true }).click();
  const reference = await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().target.references[0].alg.split(/\s+/));
  for (const token of reference) {
    if (!/^[URFDLB](2'?|')?$/.test(token)) throw new Error('Unexpected smoke-test reference ' + token);
    await page.getByRole('button', { name: `Turn ${token.replace("2'", "2")}`, exact: true }).click();
  }
  await page.locator('[aria-label="Case result"]').waitFor();
  assert.equal(await page.locator('.training-round-feedback').getByText('case time', { exact: true }).count(), 1);
  await page.waitForTimeout(2300);
  assert.equal(await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().phase), 'result');
  // Holding D must not be mistaken for four intentional shortcut turns.
  for (let i = 0; i < 4; i++) await page.keyboard.down('l');
  await page.keyboard.up('l');
  assert.equal(await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().phase), 'result');
  await page.keyboard.press('j');
  await page.keyboard.press('f');
  for (let i = 0; i < 4; i++) await page.keyboard.press('l');
  await page.waitForFunction(() => window.cubeDebug.cubetimer.training.state.get().drill.round === 2);
  const originalCase = await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().displayFacelets);
  await page.getByRole('button', { name: 'Turn B', exact: true }).click();
  await page.getByRole('button', { name: 'Skip case', exact: true }).click();
  assert.equal(await page.evaluate(() => window.cubeDebug.cubetimer.training.state.get().displayFacelets), originalCase);
  await page.getByRole('button', { name: 'Next case', exact: true }).click();
  await page.getByRole('button', { name: 'Finish drill', exact: true }).click();
  await page.getByRole('region', { name: 'Drill summary', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.cubeDebug.cubetimer.trainingAttempts.get().length), 2);
  for (const family of ['oll', 'pll']) {
    await page.evaluate(family => { const c=window.cubeDebug.cubetimer; c.setTrainingFamily(family); c.setTrainingActivity('drill'); c.setDrillTask('recognition'); c.setDrillCases(family === 'oll' ? ['26','27'] : ['T','H']); }, family);
    await page.getByRole('button', { name: 'Start drill', exact: true }).click();
    await page.getByRole('region', { name: 'Recognition choices', exact: true }).waitFor();
    const source = await page.locator('twisty-player').evaluate(async p => (await p.experimentalGet.alg()).toString());
    await page.evaluate(() => window.cubeDebug.cubetimer.injectMove('R'));
    assert.equal(await page.locator('twisty-player').evaluate(async p => (await p.experimentalGet.alg()).toString()), source);
    await page.getByRole('region', { name: 'Recognition choices', exact: true }).getByRole('button').first().click();
    await page.locator('[aria-label="Recognition result"]').waitFor();
    await page.getByRole('button', { name: 'Next case', exact: true }).click();
    await page.getByRole('button', { name: 'Finish drill', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { const c=window.cubeDebug.cubetimer; c.setTrainingFamily('f2l'); c.setTrainingActivity('drill'); c.setDrillTask('execution'); c.setDrillCases(['F2L 4']); c.startTrainingDrill(); });
  await page.waitForFunction(() => window.cubeDebug.cubetimer.training.state.get().phase === 'ready');
  await page.locator('.training-workspace-column').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  if (process.env.TRAINING_SCREENSHOTS) await page.screenshot({ path: 'training-mobile-check.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('Training browser checks passed: touch-only Single setup/solve, countdown, turns, retry, held statistics, D4 next, skip, summary, OLL/PLL recognition and mobile layout.');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }

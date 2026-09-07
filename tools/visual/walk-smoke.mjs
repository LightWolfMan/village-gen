import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const out = resolve('.cache/walk-smoke');
await mkdir(out, { recursive: true });
const server = spawn(process.execPath, ['server.mjs'], { cwd: new URL('../../', import.meta.url), env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore','pipe','pipe'], windowsHide: true });
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Servidor não iniciou')), 10000);
    server.once('error', reject);
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  let page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base + '/?visual=1');
  await page.waitForFunction(() => Boolean(window.villageTest));
  assert.ok(await page.locator('#walk-button').isDisabled());
  const results = [];
  for (const biome of ['temperate', 'arid', 'snowy', 'wetland']) {
    // Repeated default Escape gestures trigger browser anti-recapture protection.
    // Isolate biome scenarios, retaining real lock/unlock within each scenario.
    if (biome !== 'temperate') {
      await page.close();
      page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.setDefaultTimeout(60000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(base + '/?visual=1');
      await page.waitForFunction(() => Boolean(window.villageTest));
    }
    await page.evaluate(biome => window.villageTest.generate('passeio-17', { biome, rivers: true }), biome);
    const pose = await page.evaluate(() => window.villageTest.cameraPose());
    const walkButtonBox = await page.locator('#walk-button').boundingBox();
    await page.click('#walk-button');
    await page.waitForFunction(() => window.villageTest.walk().locked, null, {timeout:10000}).catch(async error => {
      throw new Error(error.message + JSON.stringify({biome, errors, state:await page.evaluate(() => window.villageTest.walk()), message:await page.locator('#notification').textContent()}));
    });
    assert.equal(await page.locator('.panel').isVisible(), false);
    const before = await page.evaluate(() => window.villageTest.walk());
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    await page.mouse.move(walkButtonBox.x + walkButtonBox.width / 2 + 30, walkButtonBox.y + walkButtonBox.height / 2);
    await page.screenshot({ path: join(out, biome + '.png') });
    const after = await page.evaluate(() => window.villageTest.walk());
    assert.ok(after.camera.every(Number.isFinite));
    assert.ok(Math.abs(after.camera[1] - after.position.y - 1.08) < 1e-8);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.villageTest.walk().jumpHeight > .2);
    await page.waitForFunction(() => window.villageTest.walk().jumpHeight === 0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.villageTest.walk().state === 'paused');
    assert.ok(await page.locator('#walk-pause').isVisible());
    const paused = await page.evaluate(() => window.villageTest.walk().position);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyW');
    assert.deepEqual(await page.evaluate(() => window.villageTest.walk().position), paused);
    await page.click('#walk-resume');
    await page.waitForFunction(() => window.villageTest.walk().locked);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => window.villageTest.walk().state === 'paused');
    await page.click('#walk-exit');
    await page.waitForFunction(() => window.villageTest.walk().state === 'aerial');
    // Wait for the layout resize to restore the original aspect.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const restored = await page.evaluate(() => window.villageTest.cameraPose());
    for (const key of ['position','quaternion','target','frustum']) {
      pose[key].forEach((value, i) => assert.ok(Math.abs(value - restored[key][i]) < 1e-6, 'Camera restoration: ' + key));
    }
    assert.equal(restored.zoom, pose.zoom);
    results.push({ biome, moved: Math.hypot(after.position.x-before.position.x, after.position.z-before.position.z) });
  }
  await page.click('#walk-button');
  await page.waitForFunction(() => window.villageTest.walk().locked);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  const benchmark = await page.evaluate(() => window.villageTest.sampleFrames(2200));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');
  const resources = await page.evaluate(() => window.villageTest.resources());
  const png = await page.evaluate(() => window.villageTest.exportPng());
  assert.ok(png.width <= 4096 && png.width > 1000 && png.height > 1000);
  const pngBuffer = Buffer.from(png.dataUrl.split(',')[1], 'base64');
  assert.equal(pngBuffer.readUInt32BE(16), png.width);
  assert.equal(pngBuffer.readUInt32BE(20), png.height);
  await writeFile(join(out, 'mapa-completo.png'), pngBuffer);
  assert.equal(await page.evaluate(() => window.villageTest.walk().state), 'active');
  await page.evaluate(() => window.villageTest.generate('troca-durante-passeio'));
  assert.equal(await page.evaluate(() => window.villageTest.walk().state), 'aerial');
  await page.click('#walk-button');
  await page.waitForFunction(() => window.villageTest.walk().locked);
  await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const extension = gl.getExtension('WEBGL_lose_context');
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 300);
  });
  await page.waitForFunction(() => window.villageTest.walk().state === 'aerial' && !window.villageTest.metrics().rendering.contextLost);
  assert.equal(await page.evaluate(() => Boolean(document.pointerLockElement)), false);
  await page.click('#walk-button');
  await page.waitForFunction(() => window.villageTest.walk().locked);
  await page.keyboard.press('Escape');
  await page.click('#walk-exit');
  assert.deepEqual(errors, []);
  await writeFile(join(out, 'results.json'), JSON.stringify({ passed: true, results, benchmark, resources, png: { width: png.width, height: png.height }, errors }, null, 2));
  console.log('Passeio: quatro biomas, pointer lock real, pausa, foco, restauração, troca, WebGL e PNG passaram.');
} finally {
  await browser?.close();
  server.kill();
}

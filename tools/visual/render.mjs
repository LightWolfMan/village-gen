/** Real WebGL smoke: npm run visual -- --seed Aurora --biome temperate --out shots */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url);
const options = { out: resolve('shots'), width: 1366, smoke: false, settings: {} };
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index++) {
  const flag = argv[index];
  if (['--zones', '--smoke', '--rivers', '--benchmark'].includes(flag)) {
    if (flag === '--rivers') options.settings.rivers = true;
    else options[flag.slice(2)] = true;
    continue;
  }
  const value = argv[++index];
  if (!value) throw new Error(`Valor ausente: ${flag}`);
  if (flag === '--out') options.out = resolve(value);
  else if (flag === '--seed') options.seed = value;
  else if (flag === '--width') options.width = Number(value);
  else if (flag === '--channel') options.channel = value;
  else if (flag === '--size') options.settings.mapSize = Number(value);
  else if (flag === '--water') options.settings.water = Number(value);
  else if (['--biome', '--settlement', '--layout'].includes(flag)) options.settings[flag.slice(2)] = value;
  else throw new Error(`Opção desconhecida: ${flag}`);
}
const presets = options.seed ? [{ name: 'mapa', seed: options.seed, settings: options.settings }] : [
  { name: 'temperate-organic', seed: 'Aurora do Norte', settings: { biome: 'temperate', rivers: true } },
  { name: 'temperate-grid', seed: 'Pedra do Vale', settings: { biome: 'temperate', layout: 'grid', rivers: true } },
  { name: 'arid', seed: 'Bruma Antigo', settings: { biome: 'arid', water: 0.25 } },
  { name: 'snowy', seed: 'Cedro da Serra', settings: { biome: 'snowy', water: 0.4 } },
  { name: 'wetland', seed: 'Riacho Verde', settings: { biome: 'wetland', water: 0.55, rivers: true } }
];
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
});
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor não iniciou')), 10000);
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Servidor terminou: ${code}`)));
    server.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  await mkdir(options.out, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(options.channel ? { channel: options.channel } : {}), args: [...(options.channel ? [] : ['--enable-unsafe-swiftshader']), `--log-file=${join(options.out, 'chromium.log')}`] });
  const page = await browser.newPage({ viewport: { width: options.width, height: 768 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/?visual=1`);
  await page.waitForFunction(() => Boolean(window.villageTest));
  await mkdir(options.out, { recursive: true });
  const results = [];
  const checks = { exportsPreserveCamera: true };
  let benchmark;
  for (const preset of presets) {
    const result = await page.evaluate(async ({ seed, settings }) => window.villageTest.generate(seed, settings), preset);
    await page.evaluate((show) => window.villageTest.setZones(show), Boolean(options.zones));
    await page.screenshot({ path: join(options.out, `${preset.name}-view.png`) });
    const cameraBefore = await page.evaluate(() => window.villageTest.cameraPose());
    const exported = await page.evaluate(() => window.villageTest.exportPng());
    const cameraAfter = await page.evaluate(() => window.villageTest.cameraPose());
    if (JSON.stringify(cameraBefore) !== JSON.stringify(cameraAfter)) throw new Error('Exportação alterou a câmera interativa');
    const png = Buffer.from(exported.dataUrl.split(',')[1], 'base64');
    if (png.readUInt32BE(16) !== exported.width || png.readUInt32BE(20) !== exported.height) throw new Error('PNG inconsistente');
    if (Math.max(exported.width, exported.height) > 4096 || Math.min(exported.width, exported.height) < 1) throw new Error('Dimensões inválidas');
    await writeFile(join(options.out, `${preset.name}-map.png`), png);
    const metrics = await page.evaluate(() => window.villageTest.metrics());
    results.push({ ...preset, ...result, ...metrics, export: { width: exported.width, height: exported.height } });
    console.log(`${preset.name}: ${Math.round(result.generationMs)} ms; PNG ${exported.width}×${exported.height}`);
  }
  if (options.smoke) {
    await page.evaluate(() => window.villageTest.setQuality('standard'));
    const idle = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const before = window.villageTest.metrics().rendering.frames;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const after = window.villageTest.metrics().rendering.frames;
      return { before, after };
    });
    if (idle.before !== idle.after) throw new Error('Renderer continua redesenhando parado');
    checks.idle = { ...idle, stable: true, delayMs: 1500, observationMs: 200 };
    const seedBeforeClick = await page.evaluate(() => window.villageTest.map().seed);
    await page.locator('#generate-button').click();
    await page.waitForFunction((oldSeed) => window.villageTest.map()?.seed !== oldSeed && document.querySelector('#loading').hidden, seedBeforeClick);
    const clickedSeed = await page.evaluate(() => window.villageTest.map().seed);
    if (clickedSeed === seedBeforeClick) throw new Error('Gerar novo vilarejo reutilizou a seed');
    const typedSeed = 'smoke-seed-digitada-4';
    await page.locator('#seed-input').fill(typedSeed);
    await page.locator('#seed-input').press('Enter');
    await page.waitForFunction((seed) => window.villageTest.map()?.seed === seed && document.querySelector('#loading').hidden, typedSeed);
    checks.seedControls = { previous: seedBeforeClick, randomized: clickedSeed, typed: typedSeed, valid: true };
    let clipboardPermission = true;
    try { await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base }); }
    catch { clipboardPermission = false; }
    await page.locator('#copy-seed').click();
    await page.waitForFunction(() => ['Copiada', 'Selecione e copie'].includes(document.querySelector('#copy-seed').textContent));
    const clipboardLabel = await page.locator('#copy-seed').textContent();
    if (clipboardLabel === 'Copiada' && clipboardPermission) {
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      if (copied !== typedSeed) throw new Error('Clipboard não corresponde à seed do mapa');
    } else if (clipboardLabel === 'Selecione e copie') {
      const selection = await page.locator('#seed-input').evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd));
      if (selection !== typedSeed) throw new Error('Fallback de clipboard não selecionou a seed');
    }
    checks.clipboard = { label: clipboardLabel, permissionGranted: clipboardPermission, valid: true };
    const box = await page.locator('#village-canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2 + 35, { steps: 12 });
    await page.mouse.up({ button: 'right' });
    await page.mouse.wheel(0, -160);
    await page.locator('#overview-button').click();
    await page.selectOption('#quality-input', 'economy');
    await page.check('#zones-input', { force: true });
    await page.evaluate(async () => {
      const first = window.villageTest.generate('cancelled-request', { biome: 'temperate' });
      const second = window.villageTest.generate('latest-request', { biome: 'snowy' });
      await Promise.all([first, second]);
      if (window.villageTest.map().seed !== 'latest-request') throw new Error('Resultado antigo substituiu nova requisição');
    });
    const lossSupported = await page.evaluate(async () => {
      const canvas = document.querySelector('canvas');
      const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
      if (!extension) return false;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Contexto WebGL não recuperou')), 10000);
        canvas.addEventListener('webglcontextlost', () => setTimeout(() => extension.restoreContext(), 150), { once: true });
        canvas.addEventListener('webglcontextrestored', () => { clearTimeout(timeout); resolve(); }, { once: true });
        extension.loseContext();
      });
      return true;
    });
    if (lossSupported) await page.waitForFunction(() => window.villageTest.metrics().rendering.contextLost === false);
    const downloading = page.waitForEvent('download');
    await page.locator('#export-button').click();
    const download = await downloading;
    if (!download.suggestedFilename().includes('latest-request')) throw new Error('Exportação usou seed incorreta');
    await download.saveAs(join(options.out, 'download-smoke.png'));
    await page.screenshot({ path: join(options.out, 'interaction-smoke.png') });
  }
  if (options.benchmark) {
    const preset = presets[0];
    await page.evaluate(({ seed, settings }) => window.villageTest.generate(seed, settings), preset);
    await page.evaluate(() => window.villageTest.setQuality('standard'));
    const box = await page.locator('#village-canvas').boundingBox();
    const orbit = async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down({ button: 'right' });
      const sample = page.evaluate(() => window.villageTest.sampleFrames(2200));
      const started = performance.now();
      while (performance.now() - started < 2200) {
        const elapsed = performance.now() - started;
        await page.mouse.move(box.x + box.width / 2 + Math.sin(elapsed / 700) * 100, box.y + box.height / 2 + Math.cos(elapsed / 900) * 30);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await page.mouse.up({ button: 'right' });
      return sample;
    };
    const standard = await orbit();
    await page.evaluate(() => window.villageTest.setQuality('economy'));
    const economy = await orbit();
    const resources = await page.evaluate(() => window.villageTest.resources());
    const replacements = [];
    // Repeating an identical scene must not allocate additional live buffers or instances.
    for (let iteration = 0; iteration < 3; iteration++) {
      await page.evaluate(({ seed, settings }) => window.villageTest.generate(seed, settings), preset);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      replacements.push(await page.evaluate(() => window.villageTest.resources()));
    }
    const resourceKeys = ['geometries', 'textures', 'instancedMeshes', 'instances'];
    for (const key of resourceKeys) {
      if (replacements.some((snapshot) => snapshot[key] !== replacements[0][key])) throw new Error(`Recursos cresceram ao repetir mapa: ${key}`);
    }
    benchmark = { resources, standard, economy, replacements, repeatedSceneStable: true };
    console.log(`Renderer: ${resources.glRenderer}; rAF p95 padrão ${standard.rafIntervalMs.p95.toFixed(1)} ms, econômico ${economy.rafIntervalMs.p95.toFixed(1)} ms.`);
  }
  await writeFile(join(options.out, 'metrics.json'), JSON.stringify({ results, errors, checks, benchmark }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`PNGs e métricas em ${options.out}`);
} finally {
  await browser?.close();
  server.kill();
}

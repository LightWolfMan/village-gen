import { BIOMES, DEFAULT_SETTINGS } from './core/index.js';
import { VillageRenderer, canvasToPngBlob } from './render/renderer.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#village-canvas');
const renderer = new VillageRenderer(canvas);
let village;
let worker;
let workerBusy = false;
let currentRequest = 0;
let cancelPending;
let generationMs = 0;
let formRevision = 0;

const form = $('#generator-form');
const seedInput = $('#seed-input');
const biomeInput = $('#biome-input');
const settlementInput = $('#settlement-input');
const layoutInput = $('#layout-input');
const sizeInput = $('#size-input');
const waterInput = $('#water-input');
const riverInput = $('#river-input');
const zonesInput = $('#zones-input');
const loading = $('#loading');
const generateButton = $('#generate-button');
const applyButton = $('#apply-button');
const pendingChanges = $('#pending-changes');
const walkButton = $('#walk-button');
let notificationTimer;
function notify(message) {
  const notification = $('#notification');
  clearTimeout(notificationTimer);
  notification.querySelector('span').textContent = message;
  notification.hidden = false;
  notificationTimer = setTimeout(() => { notification.hidden = true; }, 7000);
}
$('#notification button').addEventListener('click', () => { $('#notification').hidden = true; });
function updateWalkButton() {
  walkButton.disabled = !renderer.walk.available || workerBusy || !loading.hidden;
  walkButton.title = renderer.walk.available ? 'Passear com WASD e mouse' : 'Requer mapa carregado, WebGL e mouse com captura do ponteiro';
}
walkButton.addEventListener('click', () => {
  try { renderer.enterWalk(); } catch (error) { notify(error.message); }
});
$('#walk-resume').addEventListener('click', () => renderer.resumeWalk());
$('#walk-exit').addEventListener('click', () => renderer.exitWalk());
canvas.addEventListener('walkerror', event => notify(event.detail));
canvas.addEventListener('walkchange', ({ detail: { state } }) => {
  document.body.dataset.walk = state;
  $('#walk-hud').hidden = state !== 'active';
  $('#walk-pause').hidden = state !== 'paused';
  $('.panel').inert = state !== 'aerial';
  $('.header-actions').inert = state !== 'aerial';
  if (state === 'paused') $('#walk-resume').focus();
  if (state === 'aerial') walkButton.focus();
});
$('#walk-pause').addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    (document.activeElement === $('#walk-resume') ? $('#walk-exit') : $('#walk-resume')).focus();
  }
});
for (const type of ['webglcontextlost', 'webglcontextrestored']) canvas.addEventListener(type, updateWalkButton);
matchMedia('(any-pointer: fine)').addEventListener('change', updateWalkButton);

function markPending(event) {
  if (event?.target !== seedInput) $('#preset-input').value = 'custom';
  formRevision += 1;
  updateControls();
  pendingChanges.textContent = 'Ajustes pendentes · clique em Aplicar ajustes';
  pendingChanges.dataset.pending = 'true';
}

const names = ['Aurora', 'Cedro', 'Colina', 'Luar', 'Pedra', 'Riacho', 'Carvalho', 'Bruma', 'Raposa', 'Trigo'];
const suffixes = ['do Norte', 'Dourado', 'da Ponte', 'Sereno', 'Verde', 'Antigo', 'da Serra', 'do Vale'];

function randomSeed() {
  const data = new Uint32Array(2);
  crypto.getRandomValues(data);
  const token = ((data[0] ^ data[1]) >>> 0).toString(36).slice(0, 5);
  return `${names[data[0] % names.length]} ${suffixes[data[1] % suffixes.length]}-${token}`;
}

function settingsFromForm() {
  return {
    mapSize: Number(sizeInput.value),
    biome: biomeInput.value,
    settlement: settlementInput.value,
    layout: layoutInput.value,
    water: Number(waterInput.value),
    rivers: riverInput.checked
  };
}

function updateControls() {
  const water = Number(waterInput.value);
  const waterLabel = water < .25 ? 'Baixa' : water > .55 ? 'Alta' : 'Média';
  $('#water-value').textContent = `${waterLabel} · ${Math.round(water * 100)}/100`;
  waterInput.setAttribute('aria-valuetext', `${waterLabel}, ${Math.round(water * 100)} de 100 de intensidade`);
  $('#size-value').textContent = `${sizeInput.value} × ${sizeInput.value}`;
  if (settlementInput.value === 'town' && Number(sizeInput.value) < 128) {
    sizeInput.value = '128';
    $('#size-value').textContent = '128 × 128';
  }
  sizeInput.disabled = settlementInput.value === 'town';
  sizeInput.title = sizeInput.disabled ? 'Cidades precisam de um mapa de 128 × 128.' : '';
}

function updateStats(elapsed) {
  const stats = village.stats;
  $('#village-name').textContent = village.seed.split('-')[0] || 'Vila sem nome';
  $('#stat-houses').textContent = stats.houses;
  $('#stat-services').textContent = stats.services;
  $('#stat-bridges').textContent = stats.bridges ?? village.roads.filter((road) => road.bridge).length;
  $('#stat-props').textContent = stats.props ?? village.props.length;
  $('#stat-time').textContent = `${Math.round(elapsed)} ms`;
  $('#biome-chip').textContent = BIOMES[village.settings.biome]?.label ?? village.settings.biome;
  $('#layout-chip').textContent = village.settings.layout === 'grid' ? 'Quadras ortogonais' : 'Orgânico';
  $('#status').textContent = village.validation.valid ? 'Mapa validado' : `${village.validation.errors.length} alertas`;
  $('#status').dataset.valid = String(village.validation.valid);
}

async function generate(seed = seedInput.value, settings = settingsFromForm()) {
  renderer.exitWalk();
  const requestId = ++currentRequest;
  const submittedRevision = formRevision;
  cancelPending?.();
  if (workerBusy) { worker?.terminate(); worker = undefined; }
  worker ??= new Worker(new URL('./generation-worker.js', import.meta.url), { type: 'module' });
  workerBusy = true;
  const activeWorker = worker;
  loading.hidden = false;
  updateWalkButton();
  generateButton.setAttribute('aria-busy', 'true');
  applyButton.setAttribute('aria-busy', 'true');
  pendingChanges.textContent = 'Gerando… o mapa anterior continua disponível';
  const start = performance.now();
  try {
    const result = await new Promise((resolve, reject) => {
      cancelPending = () => resolve(null);
      activeWorker.onmessage = ({ data }) => {
        if (data.requestId !== requestId || requestId !== currentRequest) return;
        workerBusy = false;
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      activeWorker.onerror = (event) => {
        if (worker === activeWorker) { activeWorker.terminate(); worker = undefined; workerBusy = false; }
        reject(new Error(event.message || 'Falha no gerador'));
      };
      activeWorker.postMessage({ requestId, seed, settings });
    });
    if (!result || requestId !== currentRequest) return null;
    await renderer.setMap(result.map, { isCurrent: () => requestId === currentRequest });
    if (requestId !== currentRequest) return null;
    village = result.map;
    generationMs = result.elapsed;
    if (formRevision === submittedRevision) {
    seedInput.value = village.seed;
    biomeInput.value = village.settings.biome;
    settlementInput.value = village.settings.settlement;
    layoutInput.value = village.settings.layout;
    sizeInput.value = String(village.settings.mapSize);
    waterInput.value = String(village.settings.water);
    riverInput.checked = village.settings.rivers;
    updateControls();
    pendingChanges.textContent = 'Ajustes aplicados · Nova vila sorteia outra seed';
    pendingChanges.dataset.pending = 'false';
    }
    updateStats(performance.now() - start);
    return { seed: village.seed, schemaVersion: village.schemaVersion, stats: village.stats, generationMs, rendering: renderer.metrics };
  } catch (error) {
    if (requestId !== currentRequest) return null;
    console.error(error);
    $('#status').textContent = `Falha: ${error.message}`;
    $('#status').dataset.valid = 'false';
    pendingChanges.textContent = 'Não foi possível aplicar. Tente outra seed.';
    throw error;
  } finally {
    if (requestId === currentRequest) {
      cancelPending = null;
      loading.hidden = true;
      generateButton.removeAttribute('aria-busy');
      applyButton.removeAttribute('aria-busy');
      updateWalkButton();
    }
  }
}

const generateFromForm = () => generate().catch(() => {});

const presets = {
  village: { ...DEFAULT_SETTINGS },
  rural: { ...DEFAULT_SETTINGS, settlement: 'hamlet', mapSize: 96, layout: 'organic', water: .15, rivers: false },
  city: { ...DEFAULT_SETTINGS, settlement: 'town', mapSize: 128, layout: 'grid', water: .25, rivers: false },
  river: { ...DEFAULT_SETTINGS, settlement: 'village', mapSize: 96, layout: 'organic', water: .45, rivers: true }
};
function fillSettings(settings) {
  biomeInput.value = settings.biome;
  settlementInput.value = settings.settlement;
  layoutInput.value = settings.layout;
  sizeInput.value = String(settings.mapSize);
  waterInput.value = String(settings.water);
  riverInput.checked = settings.rivers;
  markPending();
}
$('#preset-input').addEventListener('change', (event) => {
  const preset = event.currentTarget.value;
  if (!presets[preset]) return;
  fillSettings(presets[preset]);
  event.currentTarget.value = preset;
});
$('#reset-settings').addEventListener('click', () => {
  fillSettings(DEFAULT_SETTINGS);
  $('#preset-input').value = 'village';
});

async function downloadPng() {
  if (!village) return;
  const button = $('#export-button');
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const exportedSeed = village.seed;
    const exportCanvas = await renderer.exportCanvas();
    const blob = await canvasToPngBlob(exportCanvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeSeed = exportedSeed.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60) || 'vila';
    link.href = url;
    link.download = `village-3d-${safeSeed}.png`;
    link.click();
    notify('PNG do mapa completo exportado.');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error(error);
    notify('O navegador não conseguiu criar o PNG. Tente novamente.');
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); generateFromForm(); });
applyButton.addEventListener('click', generateFromForm);
generateButton.addEventListener('click', () => { seedInput.value = randomSeed(); });
seedInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  generateFromForm();
});
$('#random-seed').addEventListener('click', () => { seedInput.value = randomSeed(); generateFromForm(); });
$('#export-button').addEventListener('click', downloadPng);
$('#center-button').addEventListener('click', () => renderer.center());
$('#overview-button').addEventListener('click', () => renderer.center({ whole: true }));
$('#quality-input').addEventListener('change', (event) => renderer.setQuality(event.currentTarget.value));
$('#zoom-in').addEventListener('click', () => renderer.setZoom(renderer.camera.zoom * 1.25));
$('#zoom-out').addEventListener('click', () => renderer.setZoom(renderer.camera.zoom / 1.25));
$('#copy-seed').addEventListener('click', async (event) => {
  if (!village) return;
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(village.seed);
    button.textContent = 'Copiada';
  } catch {
    seedInput.value = village.seed;
    seedInput.select();
    button.textContent = 'Selecione e copie';
  }
  setTimeout(() => { button.textContent = 'Copiar seed'; }, 1200);
});

for (const input of [seedInput, waterInput, sizeInput, settlementInput, biomeInput, layoutInput, riverInput]) input.addEventListener('input', markPending);
zonesInput.addEventListener('change', () => {
  renderer.setShowZones(zonesInput.checked);
  $('#zone-legend').hidden = !zonesInput.checked;
});
canvas.addEventListener('camerachange', (event) => { $('#zoom-label').textContent = `${Math.round(event.detail.zoom * 100)}%`; });

Object.assign(seedInput, { value: randomSeed() });
Object.assign(biomeInput, { value: DEFAULT_SETTINGS.biome });
Object.assign(settlementInput, { value: DEFAULT_SETTINGS.settlement });
Object.assign(layoutInput, { value: DEFAULT_SETTINGS.layout });
Object.assign(sizeInput, { value: String(DEFAULT_SETTINGS.mapSize) });
Object.assign(waterInput, { value: String(DEFAULT_SETTINGS.water) });
riverInput.checked = DEFAULT_SETTINGS.rivers;
updateControls();

window.addEventListener('pagehide', () => {
  currentRequest += 1;
  cancelPending?.();
  worker?.terminate();
  renderer.dispose();
});

if (new URLSearchParams(location.search).get('visual') === '1') {
  window.villageTest = {
    walk: () => ({ state: renderer.walk.state, available: renderer.walk.available, position: renderer.walk.position, jumpHeight: renderer.walk.jumpHeight, camera: renderer.walk.camera.position.toArray(), locked: renderer.walk.controls.isLocked }),
    pauseWalk: () => renderer.pauseWalk(),
    exitWalk: () => renderer.exitWalk(),
    generate,
    map: () => village,
    metrics: () => ({ generationMs, rendering: renderer.metrics }),
    cameraPose: () => ({
      position: renderer.camera.position.toArray(),
      quaternion: renderer.camera.quaternion.toArray(),
      target: renderer.controls.target.toArray(),
      zoom: renderer.camera.zoom,
      frustum: [renderer.camera.left, renderer.camera.right, renderer.camera.top, renderer.camera.bottom, renderer.camera.near, renderer.camera.far]
    }),
    resources: () => {
      let instancedMeshes = 0;
      let instances = 0;
      renderer.world?.traverse((object) => {
        if (object.isInstancedMesh) { instancedMeshes++; instances += object.count; }
      });
      const context = canvas.getContext('webgl2');
      const debug = context.getExtension('WEBGL_debug_renderer_info');
      const glRenderer = context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER);
      return {
        ...renderer.metrics, generationMs, instancedMeshes, instances,
        glRenderer,
        glVendor: context.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR),
        softwareRenderer: /swiftshader|llvmpipe|software|lavapipe/i.test(glRenderer),
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: innerWidth, height: innerHeight },
        drawingBuffer: { width: context.drawingBufferWidth, height: context.drawingBufferHeight }
      };
    },
    sampleFrames: (durationMs = 2200) => new Promise((resolve) => {
      const intervals = [];
      const cpuSamples = [];
      const started = performance.now();
      let previous;
      let lastRenderedFrame = renderer.metrics.frames;
      const stats = (values) => {
        const sorted = [...values].sort((a, b) => a - b);
        return { samples: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? 0, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0 };
      };
      const sample = (timestamp) => {
        if (previous !== undefined) intervals.push(timestamp - previous);
        previous = timestamp;
        if (renderer.metrics.frames !== lastRenderedFrame) {
          cpuSamples.push(renderer.metrics.frameMs);
          lastRenderedFrame = renderer.metrics.frames;
        }
        if (performance.now() - started < durationMs) requestAnimationFrame(sample);
        else resolve({ durationMs: performance.now() - started, rafIntervalMs: stats(intervals), rendererCpuMs: stats(cpuSamples), averageRafFps: intervals.length * 1000 / intervals.reduce((sum, value) => sum + value, 0), note: 'rAF mede entrega de quadros no navegador; rendererCpuMs mede submissão CPU, não duração GPU.' });
      };
      requestAnimationFrame(sample);
    }),
    center: (whole = false) => renderer.center({ whole }),
    setZones: (show) => renderer.setShowZones(show),
    setQuality: (quality) => renderer.setQuality(quality),
    exportPng: async () => {
      const output = await renderer.exportCanvas();
      const blob = await canvasToPngBlob(output);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { width: output.width, height: output.height, dataUrl };
    }
  };
} else {
  await generateFromForm();
}

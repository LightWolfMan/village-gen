import { BIOMES, DEFAULT_SETTINGS, generateVillage } from './core/index.js';
import { VillageRenderer, loadArtAssets } from './render/renderer.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#village-canvas');
const renderer = new VillageRenderer(canvas);
let village;

const form = $('#generator-form');
const seedInput = $('#seed-input');
const biomeInput = $('#biome-input');
const settlementInput = $('#settlement-input');
const layoutInput = $('#layout-input');
const sizeInput = $('#size-input');
const waterInput = $('#water-input');
const riverInput = $('#river-input');
const loading = $('#loading');

const names = ['Aurora', 'Cedro', 'Colina', 'Luar', 'Pedra', 'Riacho', 'Carvalho', 'Bruma', 'Raposa', 'Trigo'];
const suffixes = ['do Norte', 'Dourado', 'da Ponte', 'Sereno', 'Verde', 'Antigo', 'da Serra', 'do Vale'];

function randomSeed() {
  const data = new Uint32Array(2);
  crypto.getRandomValues(data);
  return `${names[data[0] % names.length]} ${suffixes[data[1] % suffixes.length]}-${(data[0] ^ data[1]).toString(36).slice(0, 5)}`;
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
  $('#water-value').textContent = water < .25 ? 'Seco' : water > .55 ? 'Alagado' : 'Equilibrado';
  $('#size-value').textContent = `${sizeInput.value} × ${sizeInput.value}`;
  if (settlementInput.value === 'town' && Number(sizeInput.value) < 128) {
    sizeInput.value = '128';
    $('#size-value').textContent = '128 × 128';
  }
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
  $('#layout-chip').textContent = village.settings.layout === 'grid' ? 'Quadras' : 'Orgânico';
  $('#status').textContent = village.validation.valid ? 'Mapa validado' : `${village.validation.errors.length} alertas`;
  $('#status').dataset.valid = String(village.validation.valid);
}

async function generate() {
  loading.hidden = false;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const start = performance.now();
  try {
    village = generateVillage(seedInput.value, settingsFromForm());
    renderer.setMap(village);
    updateStats(performance.now() - start);
  } catch (error) {
    console.error(error);
    alert(`Não foi possível gerar o mapa: ${error.message}`);
  } finally {
    loading.hidden = true;
  }
}

function downloadPng() {
  if (!village) return;
  const exportCanvas = renderer.exportCanvas();
  exportCanvas.toBlob((blob) => {
    if (!blob) return alert('O navegador não conseguiu criar o PNG.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeSeed = village.seed.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60) || 'vila';
    link.href = url;
    link.download = `vilarejo-isometrico-${safeSeed}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

form.addEventListener('submit', (event) => { event.preventDefault(); generate(); });
$('#random-seed').addEventListener('click', () => { seedInput.value = randomSeed(); generate(); });
$('#export-button').addEventListener('click', downloadPng);
$('#center-button').addEventListener('click', () => renderer.center());
$('#zoom-in').addEventListener('click', () => renderer.setZoom(renderer.camera.zoom * 1.25));
$('#zoom-out').addEventListener('click', () => renderer.setZoom(renderer.camera.zoom / 1.25));
$('#copy-seed').addEventListener('click', async (event) => {
  if (!village) return;
  try {
    await navigator.clipboard.writeText(village.seed);
    event.currentTarget.textContent = 'Copiada';
  } catch {
    seedInput.select();
    event.currentTarget.textContent = 'Selecione e copie';
  }
  setTimeout(() => { event.currentTarget.textContent = 'Copiar seed'; }, 1200);
});

for (const input of [waterInput, sizeInput, settlementInput]) input.addEventListener('input', updateControls);
for (const input of [biomeInput, settlementInput, layoutInput, riverInput]) input.addEventListener('change', generate);
canvas.addEventListener('camerachange', (event) => { $('#zoom-label').textContent = `${Math.round(event.detail.zoom * 100)}%`; });

Object.assign(seedInput, { value: randomSeed() });
Object.assign(biomeInput, { value: DEFAULT_SETTINGS.biome });
Object.assign(settlementInput, { value: DEFAULT_SETTINGS.settlement });
Object.assign(layoutInput, { value: DEFAULT_SETTINGS.layout });
Object.assign(sizeInput, { value: String(DEFAULT_SETTINGS.mapSize) });
Object.assign(waterInput, { value: String(DEFAULT_SETTINGS.water) });
riverInput.checked = DEFAULT_SETTINGS.rivers;
updateControls();

try {
  await loadArtAssets();
} catch (error) {
  console.warn('Props raster não carregaram; usando detalhes procedurais.', error);
}
await generate();

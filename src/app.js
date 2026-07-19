import { generateVillage, DEFAULT_SETTINGS } from './core/index.js';
import { loadArtAssets, VillageRenderer } from './render/renderer.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#map-canvas');
const renderer = new VillageRenderer(canvas);
let village = null;

const seedInput = $('#seed-input');
const sizeInput = $('#size-input');
const densityInput = $('#density-input');
const waterInput = $('#water-input');
const biomeInput = $('#biome-input');
const riversInput = $('#rivers-input');
const loadingCard = $('#loading-card');

const TERRAIN_STYLE = {
  water: { color: '#79b7ca', label: 'Água' },
  sand: { color: '#ecca90', label: 'Areia' },
  grass: { color: '#6f9955', label: 'Campo' },
  forest: { color: '#43663d', label: 'Floresta' },
  dirt: { color: '#8d745e', label: 'Terra' },
  snow: { color: '#e6eaee', label: 'Neve' },
  marsh: { color: '#556f42', label: 'Pântano' }
};
const TERRAIN_ORDER = ['water', 'marsh', 'sand', 'grass', 'forest', 'dirt', 'snow'];

function randomSeed() {
  const places = ['Carvalho', 'Luar', 'Pedra', 'Vale', 'Musgo', 'Raposa', 'Cedro', 'Aurora', 'Riacho', 'Colina'];
  const suffixes = ['Dourado', 'Antigo', 'Verde', 'Sereno', 'do Norte', 'da Ponte', 'do Sol', 'Nebuloso'];
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `${places[bytes[0] % places.length]} ${suffixes[bytes[1] % suffixes.length]}-${(bytes[0] ^ bytes[1]).toString(36).slice(0, 5)}`;
}

function displayName(seed) {
  const name = String(seed || 'Vila sem nome').split('-')[0].trim();
  return name.length > 2 ? name : `Vila ${name.toUpperCase()}`;
}

function settingsFromForm() {
  const size = Number(sizeInput.value);
  return {
    ...DEFAULT_SETTINGS,
    size,
    density: Number(densityInput.value),
    water: Number(waterInput.value),
    biome: biomeInput.value,
    rivers: riversInput.checked
  };
}

function updateRangeLabels() {
  $('#size-output').textContent = `${sizeInput.value} × ${sizeInput.value}`;
  const density = Number(densityInput.value);
  $('#density-output').textContent = density < .9 ? 'Baixa' : density > 1.1 ? 'Alta' : 'Média';
  const water = Number(waterInput.value);
  $('#water-output').textContent = water < .3 ? 'Pouca' : water > .7 ? 'Abundante' : 'Equilibrada';
}

function renderTerrainViz() {
  const counts = village.stats.terrainCounts ?? {};
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0) || 1;
  const present = TERRAIN_ORDER.filter((type) => counts[type] > 0);
  const bar = $('#terrain-bar');
  bar.innerHTML = '';
  for (const type of present) {
    const segment = document.createElement('span');
    segment.style.width = `${(counts[type] / total) * 100}%`;
    segment.style.background = TERRAIN_STYLE[type].color;
    segment.title = `${TERRAIN_STYLE[type].label}: ${Math.round((counts[type] / total) * 100)}%`;
    bar.appendChild(segment);
  }
  const legend = $('#map-legend');
  legend.innerHTML = '';
  for (const type of present) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<i style="background:${TERRAIN_STYLE[type].color}"></i>${TERRAIN_STYLE[type].label}`;
    legend.appendChild(item);
  }
}

function updateMetrics(elapsed) {
  $('#village-name').textContent = displayName(village.seed);
  $('#house-count').textContent = String(village.stats.houses);
  $('#service-count').textContent = String(village.stats.services);
  $('#tree-count').textContent = String(village.stats.trees ?? village.decorations.filter((item) => item.type === 'tree').length);
  $('#generation-time').textContent = `${Math.round(elapsed)} ms`;
  $('#biome-label').textContent = village.biomeLabel ?? 'Campo temperado';
  renderTerrainViz();
  $('#zoom-level').textContent = `${Math.round(renderer.camera.zoom * 100)}%`;
  $('#status-dot').title = village.validation.valid ? 'Vila validada' : 'Vila gerada com avisos';
  $('#status-dot').style.background = village.validation.valid ? '#8dc975' : '#e2b85a';
}

async function generate() {
  loadingCard.hidden = false;
  // Deixa o spinner pintar um quadro, mas sem travar se a aba estiver em segundo
  // plano (onde requestAnimationFrame fica suspenso).
  await new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 60);
  });
  const started = performance.now();
  try {
    village = generateVillage(seedInput.value, settingsFromForm());
    renderer.setMap(village);
    updateMetrics(performance.now() - started);
  } catch (error) {
    console.error(error);
    alert(`Não foi possível gerar a vila: ${error.message}`);
  } finally {
    loadingCard.hidden = true;
  }
}

function downloadCanvas(canvasToSave, filename) {
  canvasToSave.toBlob((blob) => {
    if (!blob) {
      alert('O navegador não conseguiu preparar o arquivo PNG.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

$('#generator-form').addEventListener('submit', (event) => { event.preventDefault(); generate(); });
$('#random-seed-button').addEventListener('click', () => { seedInput.value = randomSeed(); generate(); });
$('#center-button').addEventListener('click', () => { renderer.center(); $('#zoom-level').textContent = `${Math.round(renderer.camera.zoom * 100)}%`; });
$('#zoom-in-button').addEventListener('click', () => { renderer.setZoom(renderer.camera.zoom * 1.25); $('#zoom-level').textContent = `${Math.round(renderer.camera.zoom * 100)}%`; });
$('#zoom-out-button').addEventListener('click', () => { renderer.setZoom(renderer.camera.zoom / 1.25); $('#zoom-level').textContent = `${Math.round(renderer.camera.zoom * 100)}%`; });
$('#export-button').addEventListener('click', () => {
  if (!village) return;
  const safeSeed = String(village.seed).replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 64) || 'vila';
  const exported = renderer.exportCanvas();
  if (exported.width !== village.width * 16 || exported.height !== village.height * 16) {
    alert('A exportação foi interrompida porque as dimensões do mapa não conferem.');
    return;
  }
  downloadCanvas(exported, `vila-${safeSeed}.png`);
});
$('#copy-seed-button').addEventListener('click', async (event) => {
  if (!village) return;
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(village.seed);
    button.textContent = 'Copiada!';
  } catch {
    seedInput.focus();
    seedInput.select();
    button.textContent = 'Selecione e copie';
  }
  setTimeout(() => { button.textContent = 'Copiar seed'; }, 1200);
});

for (const input of [sizeInput, densityInput, waterInput]) input.addEventListener('input', updateRangeLabels);
biomeInput.addEventListener('change', generate);
riversInput.addEventListener('change', generate);
document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'c' && event.target.tagName !== 'INPUT') renderer.center();
});
canvas.addEventListener('camerachange', (event) => { $('#zoom-level').textContent = `${Math.round(event.detail.zoom * 100)}%`; });

seedInput.value = randomSeed();
updateRangeLabels();
try {
  await loadArtAssets();
} catch (error) {
  console.warn('Tileset externo indisponível; usando arte procedural de fallback.', error);
}
generate();

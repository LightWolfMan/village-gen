/**
 * Render headless do mapa, fora do navegador.
 *
 * O renderer da Village v3 depende de Canvas 2D, `Image`, `fetch`, `Path2D` e
 * `OffscreenCanvas`. Este utilitário fornece os cinco a partir do Node e do
 * @napi-rs/canvas, então o mesmo código que roda na página produz PNGs em
 * disco — com os sprites Blender de verdade, e não com o fallback procedural.
 *
 * Serve para comparar antes e depois de uma mudança visual. Foi assim que se
 * descobriu que nove tipos de terreno caíam num fallback silencioso para grama
 * e que a sombra dos edifícios existia mas era repintada pelo terreno.
 *
 * Não faz parte da aplicação: o gerador, o servidor e os testes continuam sem
 * nenhuma dependência. Instale a ferramenta com `npm install` e use
 * `npm run visual`.
 *
 * Exemplos:
 *   npm run visual
 *   npm run visual -- --out C:\temp\shots
 *   npm run visual -- --seed "Aurora do Norte" --biome arid --settlement town
 *   npm run visual -- --seed minha-seed --zones --crop 1380,600,1000,620
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

let canvasKit;
try {
  canvasKit = await import('@napi-rs/canvas');
} catch {
  console.error('Esta ferramenta precisa do @napi-rs/canvas, que não é dependência da aplicação.');
  console.error('Instale as ferramentas de desenvolvimento com: npm install');
  process.exit(1);
}
const { createCanvas, loadImage, Path2D } = canvasKit;

const assetPath = (path) => join(root, String(path).replace(/^\//, ''));

// O renderer busca os manifestos por caminho absoluto de site; aqui eles vêm do disco.
globalThis.fetch = async (path) => {
  try {
    return { ok: true, json: async () => JSON.parse(await readFile(assetPath(path), 'utf8')) };
  } catch {
    return { ok: false, json: async () => ({}) };
  }
};

// Só o que `loadImage` do renderer consome: src, load/error e as dimensões.
globalThis.Image = class {
  constructor() {
    this.listeners = { load: [], error: [] };
  }

  addEventListener(type, handler) {
    this.listeners[type]?.push(handler);
  }

  set src(path) {
    loadImage(assetPath(path)).then((image) => {
      this.image = image;
      this.naturalWidth = image.width;
      this.naturalHeight = image.height;
      this.width = image.width;
      this.height = image.height;
      for (const handler of this.listeners.load) handler();
    }).catch(() => {
      for (const handler of this.listeners.error) handler();
    });
  }
};

// Recorte da água e camada de reflexo.
globalThis.Path2D = Path2D;
globalThis.OffscreenCanvas = class {
  constructor(width, height) {
    return createCanvas(width, height);
  }
};

// O shim de Image entrega um invólucro; desembrulhar no prototype faz valer
// também nos canvases auxiliares que o renderer cria por dentro.
const contextPrototype = Object.getPrototypeOf(createCanvas(1, 1).getContext('2d'));
const nativeDrawImage = contextPrototype.drawImage;
contextPrototype.drawImage = function drawImage(source, ...rest) {
  return nativeDrawImage.call(this, source?.image ?? source, ...rest);
};

const { generateVillage } = await import(new URL('../../src/core/index.js', import.meta.url));
const renderer = await import(new URL('../../src/render/renderer.js', import.meta.url));
await renderer.loadArtAssets();

function parseArguments(argv) {
  const options = { out: join(root, 'shots'), maxWidth: 1600, zones: false, crop: null };
  const settings = {};
  let seed = null;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--seed') { seed = value; index += 1; }
    else if (flag === '--biome') { settings.biome = value; index += 1; }
    else if (flag === '--settlement') { settings.settlement = value; index += 1; }
    else if (flag === '--layout') { settings.layout = value; index += 1; }
    else if (flag === '--size') { settings.mapSize = Number(value); index += 1; }
    else if (flag === '--water') { settings.water = Number(value); index += 1; }
    else if (flag === '--rivers') settings.rivers = true;
    else if (flag === '--zones') options.zones = true;
    else if (flag === '--out') { options.out = resolve(value); index += 1; }
    else if (flag === '--width') { options.maxWidth = Number(value); index += 1; }
    else if (flag === '--crop') { options.crop = value.split(',').map(Number); index += 1; }
  }
  return { seed, settings, options };
}

// Uma vista por bioma, mais os dois traçados e uma aproximação do centro.
const PRESET = [
  { name: '1-vila-temperada', seed: 'Aurora do Norte', settings: { biome: 'temperate', settlement: 'village', layout: 'organic', water: 0.35, rivers: true } },
  { name: '2-cidade-quadras', seed: 'Pedra do Vale', settings: { biome: 'temperate', settlement: 'town', layout: 'grid', water: 0.3, rivers: true } },
  { name: '3-sertao-arido', seed: 'Bruma Antigo', settings: { biome: 'arid', settlement: 'village', layout: 'organic', water: 0.25 } },
  { name: '4-planalto-nevado', seed: 'Cedro da Serra', settings: { biome: 'snowy', settlement: 'village', layout: 'organic', water: 0.4 } },
  { name: '5-pantano', seed: 'Riacho Verde', settings: { biome: 'wetland', settlement: 'village', layout: 'organic', water: 0.55, rivers: true } },
  { name: '6-povoado', seed: 'Luar Sereno', settings: { biome: 'temperate', settlement: 'hamlet', layout: 'organic', size: 72, water: 0.35 } },
  { name: '7-zonas', seed: 'Aurora do Norte', settings: { biome: 'temperate', settlement: 'village', layout: 'organic', water: 0.35, rivers: true }, zones: true },
];

async function renderShot(name, seed, settings, options) {
  const startedAt = performance.now();
  const map = generateVillage(seed, settings);
  const generatedAt = performance.now();
  const bounds = renderer.computeRenderBounds(map, {});
  const canvas = createCanvas(bounds.width, bounds.height);
  renderer.renderVillageToCanvas(map, { canvas, showZones: options.zones === true });
  const renderedAt = performance.now();

  let output = canvas;
  if (options.crop) {
    const [x, y, width, height] = options.crop;
    output = createCanvas(width, height);
    output.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
  } else if (canvas.width > options.maxWidth) {
    const scale = options.maxWidth / canvas.width;
    output = createCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
    output.getContext('2d').drawImage(canvas, 0, 0, output.width, output.height);
  }

  const file = join(options.out, `${name}.png`);
  await writeFile(file, await output.encode('png'));
  console.log([
    name.padEnd(20),
    `${canvas.width}x${canvas.height}`.padEnd(12),
    `geração ${Math.round(generatedAt - startedAt)} ms`.padEnd(16),
    `render ${Math.round(renderedAt - generatedAt)} ms`.padEnd(15),
    `${map.stats.houses} casas, ${map.stats.services} serviços, ${map.props.length} props`,
  ].join(' '));
  return file;
}

const { seed, settings, options } = parseArguments(process.argv.slice(2));
await mkdir(options.out, { recursive: true });

if (seed) {
  await renderShot('mapa', seed, settings, options);
} else {
  for (const item of PRESET) {
    const { size, ...rest } = item.settings;
    await renderShot(item.name, item.seed, { ...rest, ...(size ? { mapSize: size } : {}) }, { ...options, zones: item.zones === true });
  }
}
console.log(`\nPNGs em ${options.out}`);

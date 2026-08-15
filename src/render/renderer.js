/**
 * Renderer isometrico da Village v3.
 *
 * Este modulo nao conhece o gerador: recebe apenas o VillageMap serializavel e
 * pre-renderiza o mundo inteiro em um Canvas 2D. A camera passa a mover uma
 * unica imagem estatica, mantendo pan e zoom baratos mesmo em mapas grandes.
 */

export const ISO_DEFAULTS = Object.freeze({
  tileWidth: 32,
  tileHeight: 16,
  heightStep: 6,
  padding: 64,
});

/**
 * Uma entrada por tipo de terreno que o gerador realmente emite naquele bioma.
 * Manter em sincronia com BIOMES em src/core/generator.js: os testes de contrato
 * falham tanto para um tipo sem cor quanto para uma cor que ninguem usa.
 */
const TERRAIN = Object.freeze({
  temperate: Object.freeze({
    grass: '#71944d', forest: '#47693d', sand: '#dcc083', rock: '#7e7a68', water: '#4a8b9c',
  }),
  arid: Object.freeze({
    'dry-grass': '#b0a35d', scrub: '#778246', sand: '#d9b568', rock: '#a87c56', water: '#3d8698',
  }),
  snowy: Object.freeze({
    snow: '#eef3f4', ice: '#c7dbe0', 'pine-forest': '#44675b', 'snow-rock': '#8f979c', water: '#4e8ba0',
  }),
  wetland: Object.freeze({
    'wet-grass': '#5f7d48', marsh: '#6e7749', 'swamp-forest': '#334f38', rock: '#6f7165', water: '#436f78',
  }),
});

/**
 * Variacao por tile. Estreita de proposito: precisa quebrar a chapa lisa sem
 * virar um mosaico manchado, sobretudo nas grandes areas de agua.
 */
const TERRAIN_TONES = Object.freeze([-6, -2, 2, 6]);
// A agua e uma superficie continua e denuncia qualquer mosaico; a pedra ao
// contrario ganha em parecer malhada.
const TONE_OVERRIDES = Object.freeze({
  water: Object.freeze([-3, 0, 2, 4]),
  rock: Object.freeze([-11, -4, 3, 10]),
  'snow-rock': Object.freeze([-9, -3, 3, 8]),
});

/** Tipo usado quando um terreno desconhecido aparece: o solo dominante do bioma. */
const TERRAIN_FALLBACK = Object.freeze({
  temperate: 'grass', arid: 'dry-grass', snowy: 'snow', wetland: 'wet-grass',
});

const reportedTerrainTypes = new Set();

/** Exportados para o teste de contrato que cruza BIOMES com as cores disponiveis. */
export { TERRAIN as TERRAIN_PALETTES, TERRAIN_FALLBACK };

const MATERIALS = Object.freeze({
  thatch: { wall: '#c9ad77', lit: '#ddc58d', shade: '#a98c5e', trim: '#67472b', roof: '#b18738', roofLit: '#d0aa4d', roofDark: '#765527' },
  tile: { wall: '#d1b987', lit: '#e5d09e', shade: '#aa9166', trim: '#65452e', roof: '#a74737', roofLit: '#cf6851', roofDark: '#702e2a' },
  wood: { wall: '#a87748', lit: '#be8d59', shade: '#805936', trim: '#4c3322', roof: '#614329', roofLit: '#85613b', roofDark: '#39291d' },
  stone: { wall: '#aaa79c', lit: '#c5c1b4', shade: '#858177', trim: '#55534d', roof: '#526169', roofLit: '#74858c', roofDark: '#354147' },
  adobe: { wall: '#c28b5c', lit: '#dba778', shade: '#986744', trim: '#70462f', roof: '#9f7045', roofLit: '#c08a57', roofDark: '#6f4b33' },
  slate: { wall: '#a8adb0', lit: '#c7cccd', shade: '#858b8f', trim: '#51585c', roof: '#53636d', roofLit: '#71828c', roofDark: '#35434c' },
  sandstone: { wall: '#c9a46f', lit: '#dec08b', shade: '#9e7a51', trim: '#72533a', roof: '#9e6843', roofLit: '#c08555', roofDark: '#6d462f' },
  mudbrick: { wall: '#a96f4d', lit: '#c58b65', shade: '#815139', trim: '#623d2d', roof: '#81583e', roofLit: '#a77754', roofDark: '#55382a' },
  wattle: { wall: '#b89665', lit: '#d0b27d', shade: '#8d714c', trim: '#5f432b', roof: '#8b6a31', roofLit: '#b19045', roofDark: '#5f4726' },
  moss: { wall: '#9eaa8f', lit: '#bac4a9', shade: '#77836b', trim: '#465340', roof: '#4e6b43', roofLit: '#6f8d58', roofDark: '#334a30' },
});

const MATERIAL_ALIASES = Object.freeze({
  timber: 'wood', 'pine-timber': 'wood', plaster: 'tile', 'lime-plaster': 'tile',
  fieldstone: 'stone', granite: 'slate', riverstone: 'stone', sandstone: 'sandstone',
  mudbrick: 'mudbrick', adobe: 'adobe', wattle: 'wattle',
});

const ROOF_ALIASES = Object.freeze({
  thatch: 'thatch', 'heavy-thatch': 'thatch', 'reed-thatch': 'thatch', 'reed-mat': 'thatch',
  'moss-thatch': 'moss', tile: 'tile', 'clay-tile': 'tile', wood: 'wood', 'wood-shingle': 'wood',
  'steep-wood': 'wood', slate: 'slate', 'steep-slate': 'slate', 'flat-earth': 'adobe',
});

const ZONE_COLORS = Object.freeze({
  residential: '#74a7d8',
  commercial: '#d9af56',
  craft: '#c77b55',
  civic: '#aa83cf',
  agricultural: '#82ad67',
});

const ARCHITECTURES = Object.freeze({
  cottage: Object.freeze({ key: 'cottage', wallScale: .90, roofScale: 1.12, extraScale: 1.35, detail: 'chimney' }),
  townhouse: Object.freeze({ key: 'townhouse', wallScale: 1.22, roofScale: .88, extraScale: .45, detail: 'dormer' }),
  workshop: Object.freeze({ key: 'workshop', wallScale: .96, roofScale: .82, extraScale: 0, detail: 'canopy' }),
  civic: Object.freeze({ key: 'civic', wallScale: 1.18, roofScale: 1.08, extraScale: 1.35, detail: 'cupola' }),
  farmstead: Object.freeze({ key: 'farmstead', wallScale: .86, roofScale: 1.18, extraScale: 0, detail: 'porch' }),
  manor: Object.freeze({ key: 'manor', wallScale: 1.30, roofScale: 1.02, extraScale: .55, detail: 'twin-dormer' }),
  tower: Object.freeze({ key: 'tower', wallScale: 1.45, roofScale: .62, extraScale: .45, detail: 'battlement' }),
  courtyard: Object.freeze({ key: 'courtyard', wallScale: 1.02, roofScale: .28, extraScale: .20, detail: 'parapet' }),
  chalet: Object.freeze({ key: 'chalet', wallScale: 1.12, roofScale: 1.55, extraScale: .35, detail: 'balcony' }),
  stilt: Object.freeze({ key: 'stilt', wallScale: 1.08, roofScale: 1.14, extraScale: 0, detail: 'stilts' }),
  longhouse: Object.freeze({ key: 'longhouse', wallScale: .92, roofScale: 1.26, extraScale: .20, detail: 'braces' }),
});

const ARCHITECTURE_ALIASES = Object.freeze({
  'timber-frame': 'cottage', 'stone-cottage': 'cottage', 'wattle-cottage': 'cottage',
  farmstead: 'farmstead', 'timber-longhouse': 'longhouse',
  'adobe-courtyard': 'courtyard', 'sandstone-house': 'cottage', 'mudbrick-house': 'cottage',
  'desert-farmstead': 'farmstead', 'mudbrick-compound': 'courtyard',
  'alpine-chalet': 'chalet', 'stone-lodge': 'manor', 'timber-cabin': 'cottage',
  'snow-longhouse': 'longhouse', 'mountain-farmstead': 'farmstead',
  'stilt-house': 'stilt', 'reed-cottage': 'cottage', 'raised-timber-house': 'stilt',
  'marsh-farmstead': 'farmstead', 'raised-longhouse': 'stilt',
  'coaching-inn': 'townhouse', 'gabled-tavern': 'townhouse', 'merchant-house': 'townhouse', 'arcaded-shop': 'townhouse',
  'forge-workshop': 'workshop', 'stone-smithy': 'workshop', 'guildhall': 'civic', 'manor-hall': 'manor',
  'parish-chapel': 'civic', 'stone-sanctuary': 'civic', 'covered-market': 'workshop', 'trading-hall': 'townhouse',
  'water-mill': 'farmstead', 'post-mill': 'farmstead', 'watchtower': 'tower', 'gate-tower': 'tower',
  'artisan-house': 'workshop', 'workshop-dwelling': 'workshop',
  'merchant-dwelling': 'townhouse', 'shop-house': 'townhouse',
});

const ART_MANIFEST = Object.freeze({
  tree: '/assets/props/temperate-tree.png',
  'temperate-tree': '/assets/props/temperate-tree.png',
  'snowy-pine': '/assets/props/snowy-pine.png',
  cactus: '/assets/props/desert-cactus.png',
  'desert-cactus': '/assets/props/desert-cactus.png',
  willow: '/assets/props/swamp-willow.png',
  'swamp-willow': '/assets/props/swamp-willow.png',
  rock: '/assets/props/rock.png',
  bush: '/assets/props/bush.png',
  reeds: '/assets/props/reeds.png',
  well: '/assets/props/well.png',
  cart: '/assets/props/cart.png',
  haystack: '/assets/props/haystack.png',
});

const ART = new Map();
const BUILDING_ART = new Map();
const ENVIRONMENT_ART = new Map();

const ENVIRONMENT_SPRITE_TYPES = new Set([
  'road-street', 'road-main', 'road-plaza',
  ...['ew', 'ns'].flatMap((axis) => ['single', 'start', 'middle', 'post', 'end']
    .map((role) => `bridge-${axis}-${role}`)),
]);

const BUILDING_SPRITE_FAMILIES = new Set([
  'cottage', 'townhouse', 'workshop', 'civic', 'farmstead',
  'inn', 'shop', 'merchant', 'artisan', 'smithy', 'market', 'mill',
]);
const BUILDING_SPRITE_ORIENTATIONS = new Set(['north', 'east', 'south', 'west']);

function buildingSpriteKey(biome, family, variant, orientation) {
  return `${biome}:${family}:${variant}:${orientation}`;
}

function normalizedBuildingSpriteFamily(building, biome) {
  if (biome !== 'temperate') return null;
  const type = String(building?.type ?? 'house').toLowerCase();
  if (['inn', 'shop', 'smithy', 'market', 'mill'].includes(type)) return type;
  if (type === 'house' && building?.zone === 'commercial') return 'merchant';
  if (type === 'house' && building?.zone === 'craft') return 'artisan';
  const profile = getArchitectureProfile(building?.architecture, building?.type);
  const family = profile.key === 'manor' ? 'civic' : profile.key === 'longhouse' ? 'farmstead' : profile.key;
  return BUILDING_SPRITE_FAMILIES.has(family) ? family : null;
}

function normalizedBuildingSpriteEntry(entry, basePath) {
  if (!entry || typeof entry !== 'object') return null;
  const biome = String(entry.biome ?? 'temperate').toLowerCase();
  const family = String(entry.family ?? '').toLowerCase();
  const orientation = String(entry.orientation ?? '').toLowerCase();
  const variant = Math.max(0, Math.trunc(finite(entry.variant, 0)));
  const width = positive(entry.width, 0);
  const height = positive(entry.height, 0);
  const anchorX = finite(entry.anchorX, NaN);
  const anchorY = finite(entry.anchorY, NaN);
  const doorX = finite(entry.doorX, NaN);
  const doorY = finite(entry.doorY, NaN);
  const footprint = {
    width: positive(Array.isArray(entry.footprint) ? entry.footprint[0] : entry.footprint?.width, 0),
    height: positive(Array.isArray(entry.footprint) ? entry.footprint[1] : entry.footprint?.height, 0),
  };
  const file = String(entry.src ?? entry.file ?? '').trim();
  if (biome !== 'temperate' || !BUILDING_SPRITE_FAMILIES.has(family) || !BUILDING_SPRITE_ORIENTATIONS.has(orientation)
    || !width || !height || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)
    || !Number.isFinite(doorX) || !Number.isFinite(doorY) || !footprint.width || !footprint.height || !file) return null;
  const root = String(basePath ?? '/assets/buildings').replace(/\/$/, '');
  const path = /^(?:https?:)?\/\//.test(file) || file.startsWith('/') ? file : `${root}/${file.replace(/^\.\//, '')}`;
  return Object.freeze({ biome, family, variant, orientation, width, height, anchorX, anchorY, doorX, doorY, footprint: Object.freeze(footprint), file, path });
}

/** Normaliza um manifesto gerado pelo pipeline Blender sem depender de DOM ou bitmaps. */
export function parseBuildingSpriteManifest(manifest, basePath = '/assets/buildings') {
  const source = Array.isArray(manifest) ? manifest : manifest?.sprites ?? manifest?.entries ?? manifest?.buildings;
  if (!Array.isArray(source)) return Object.freeze([]);
  return Object.freeze(source.map((entry) => normalizedBuildingSpriteEntry(entry, basePath)).filter(Boolean));
}

function normalizedEnvironmentSpriteEntry(entry, basePath, baseTileWidth) {
  if (!entry || typeof entry !== 'object') return null;
  const key = String(entry.key ?? '').trim();
  const type = String(entry.type ?? '').toLowerCase().trim();
  const file = String(entry.src ?? '').trim();
  const width = positive(entry.width, 0);
  const height = positive(entry.height, 0);
  const anchorX = finite(entry.anchorX, NaN);
  const anchorY = finite(entry.anchorY, NaN);
  if (!key || !ENVIRONMENT_SPRITE_TYPES.has(type) || !file || !width || !height
    || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return null;
  const root = String(basePath ?? '/assets/environment').replace(/\/$/, '');
  const path = /^(?:https?:)?\/\//.test(file) || file.startsWith('/') ? file : `${root}/${file.replace(/^\.\//, '')}`;
  return Object.freeze({ key, type, file, path, width, height, anchorX, anchorY, baseTileWidth });
}

/** Normaliza o manifesto de ruas e pontes sem depender de DOM ou bitmaps. */
export function parseEnvironmentSpriteManifest(manifest, basePath = '/assets/environment') {
  if (!manifest || Number(manifest.schemaVersion) !== 2 || !Array.isArray(manifest.entries)) return Object.freeze([]);
  const baseTileWidth = positive(manifest.baseTileWidth, 0);
  if (!baseTileWidth) return Object.freeze([]);
  return Object.freeze(manifest.entries
    .map((entry) => normalizedEnvironmentSpriteEntry(entry, basePath, baseTileWidth))
    .filter(Boolean));
}

/** Traduz o contrato serializavel de uma via para a familia visual Blender. */
export function resolveRoadSpriteType(road) {
  if (road?.bridge) {
    const axis = String(road.orientation ?? '').toLowerCase();
    const role = String(road.bridgeRole ?? 'middle').toLowerCase();
    if (!['ew', 'ns'].includes(axis) || !['single', 'start', 'middle', 'post', 'end'].includes(role)) return null;
    return `bridge-${axis}-${role}`;
  }
  if (road?.kind === 'plaza') return 'road-plaza';
  if (road?.kind === 'main') return 'road-main';
  return 'road-street';
}

/** Posiciona um sprite de via pela ancora de solo no centro isometrico do tile. */
export function computeEnvironmentSpritePlacement(road, sprite, options = {}) {
  if (!road || !sprite) throw new TypeError('Road e sprite sao obrigatorios.');
  const metrics = optionsWithDefaults(options);
  const width = positive(sprite.width, 0);
  const height = positive(sprite.height, 0);
  const baseTileWidth = positive(sprite.baseTileWidth, 0);
  const anchorX = finite(sprite.anchorX, NaN);
  const anchorY = finite(sprite.anchorY, NaN);
  if (!width || !height || !baseTileWidth || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
    throw new TypeError('Metadados de sprite de ambiente invalidos.');
  }
  const scale = metrics.tileWidth / baseTileWidth;
  const center = projectPoint(finite(road.x, 0), finite(road.y, 0), finite(options.level, 0), metrics);
  return Object.freeze({
    x: center.x - anchorX * scale,
    y: center.y - anchorY * scale,
    width: width * scale,
    height: height * scale,
    scale,
    center: Object.freeze(center),
  });
}

/** Resolve a arte raster sem alterar os aliases do renderer procedural. */
export function resolveBuildingSprite(building, biome = 'temperate', sprites = BUILDING_ART) {
  const normalizedBiome = String(biome ?? 'temperate').toLowerCase();
  const family = normalizedBuildingSpriteFamily(building, normalizedBiome);
  const orientation = String(building?.orientation ?? building?.facing ?? 'south').toLowerCase();
  if (!family || !BUILDING_SPRITE_ORIENTATIONS.has(orientation)) return null;
  const variant = Math.max(0, Math.trunc(finite(building?.variant, 0)));
  const key = buildingSpriteKey(normalizedBiome, family, variant, orientation);
  const fallbackKey = buildingSpriteKey(normalizedBiome, family, 0, orientation);
  if (sprites instanceof Map) return sprites.get(key) ?? sprites.get(fallbackKey) ?? null;
  const entries = Array.isArray(sprites) ? sprites : parseBuildingSpriteManifest(sprites);
  return entries.find((entry) => buildingSpriteKey(entry.biome, entry.family, entry.variant, entry.orientation) === key)
    ?? entries.find((entry) => buildingSpriteKey(entry.biome, entry.family, entry.variant, entry.orientation) === fallbackKey)
    ?? null;
}

/** Calcula escala uniforme, ancora no centro do lote e coordenada visual da porta. */
export function computeBuildingSpritePlacement(building, sprite, options = {}) {
  if (!building || !sprite) throw new TypeError('Building e sprite sao obrigatorios.');
  const metrics = optionsWithDefaults(options);
  const footprint = buildingFootprint(building);
  const canonical = {
    width: positive(sprite.footprint?.width, 0),
    height: positive(sprite.footprint?.height, 0),
  };
  const sourceWidth = positive(sprite.width, 0);
  const sourceHeight = positive(sprite.height, 0);
  const anchorX = finite(sprite.anchorX, NaN);
  const anchorY = finite(sprite.anchorY, NaN);
  const doorX = finite(sprite.doorX, NaN);
  const doorY = finite(sprite.doorY, NaN);
  if (!canonical.width || !canonical.height || !sourceWidth || !sourceHeight
    || !Number.isFinite(anchorX) || !Number.isFinite(anchorY) || !Number.isFinite(doorX) || !Number.isFinite(doorY)) {
    throw new TypeError('Metadados de sprite invalidos.');
  }
  const level = finite(options.level, finite(building.baseLevel, 0));
  const gridScale = metrics.tileWidth / ISO_DEFAULTS.tileWidth;
  const scale = Math.min(footprint.width / canonical.width, footprint.height / canonical.height) * gridScale;
  const anchor = projectPoint(
    finite(building.x, 0) + (footprint.width - 1) / 2,
    finite(building.y, 0) + (footprint.height - 1) / 2,
    level,
    metrics,
  );
  const x = anchor.x - anchorX * scale;
  const y = anchor.y - anchorY * scale;
  return Object.freeze({
    x, y, width: sourceWidth * scale, height: sourceHeight * scale, scale,
    anchor: Object.freeze(anchor),
    visualDoor: Object.freeze({ x: x + doorX * scale, y: y + doorY * scale }),
  });
}

function optionsWithDefaults(options = {}) {
  return {
    tileWidth: positive(options.tileWidth, ISO_DEFAULTS.tileWidth),
    tileHeight: positive(options.tileHeight, ISO_DEFAULTS.tileHeight),
    heightStep: positive(options.heightStep, ISO_DEFAULTS.heightStep),
    padding: Math.max(0, finite(options.padding, ISO_DEFAULTS.padding)),
  };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback) {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hash2(x, y, salt = 0) {
  let value = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul((y | 0) + salt, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

function tint(hex, amount) {
  const source = String(hex).replace('#', '');
  if (source.length !== 6) return hex;
  const channel = (offset) => clamp(parseInt(source.slice(offset, offset + 2), 16) + amount, 0, 255).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** Projeta uma coordenada do mapa sem aplicar a origem calculada do canvas. */
export function projectPoint(x, y, level = 0, options = {}) {
  const { tileWidth, tileHeight, heightStep } = optionsWithDefaults(options);
  return {
    x: (finite(x, 0) - finite(y, 0)) * (tileWidth / 2),
    y: (finite(x, 0) + finite(y, 0)) * (tileHeight / 2) - finite(level, 0) * heightStep,
  };
}

function levelAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  const value = map.heightLevel?.[y * map.width + x];
  if (Number.isFinite(value)) return Math.max(0, value);
  return map.terrain?.[y * map.width + x] === 'water' ? 0 : 1;
}

/** Degraus de espessura desenhados sob a borda do mundo, para o mapa nao flutuar. */
const WORLD_SKIRT = 3;

/** Como levelAt, mas fora do mapa devolve um nivel negativo: e o que da a saia. */
function edgeLevelAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return -WORLD_SKIRT;
  return levelAt(map, x, y);
}

function biomeOf(map) {
  return map.settings?.biome ?? map.biome ?? 'temperate';
}

function buildingFootprint(building) {
  return {
    width: Math.max(1, Math.round(finite(building.width ?? building.footprint?.width, 2))),
    height: Math.max(1, Math.round(finite(building.height ?? building.footprint?.height, 2))),
  };
}

function inferredArchitecture(type) {
  if (type === 'inn' || type === 'shop') return 'townhouse';
  if (type === 'smithy' || type === 'blacksmith' || type === 'market') return 'workshop';
  if (type === 'hall' || type === 'chapel' || type === 'town-hall' || type === 'townHall') return 'civic';
  if (type === 'mill') return 'farmstead';
  if (type === 'tower' || type === 'watchtower') return 'tower';
  return 'cottage';
}

/** Perfil visual puro usado tanto pelo renderer quanto pelos testes de bounds. */
export function getArchitectureProfile(architecture, type = 'house') {
  const normalized = String(architecture ?? '').replace(/^(temperate|arid|snowy|wetland)-/, '');
  let family = ARCHITECTURE_ALIASES[normalized] ?? normalized;
  if (!ARCHITECTURES[family]) {
    if (/longhouse/.test(normalized)) family = 'longhouse';
    else if (/stilt|raised/.test(normalized)) family = 'stilt';
    else if (/courtyard|compound/.test(normalized)) family = 'courtyard';
    else if (/chalet/.test(normalized)) family = 'chalet';
    else if (/tower/.test(normalized)) family = 'tower';
    else if (/manor|lodge/.test(normalized)) family = 'manor';
    else if (/farm|croft|mill/.test(normalized)) family = 'farmstead';
    else if (/workshop|smithy|forge|market/.test(normalized)) family = 'workshop';
    else if (/guildhall|chapel|sanctuary/.test(normalized)) family = 'civic';
    else if (/townhouse|rowhouse|inn|tavern|merchant|shop|trading/.test(normalized)) family = 'townhouse';
    else if (/cottage|cabin|house|timber-frame/.test(normalized)) family = 'cottage';
  }
  return ARCHITECTURES[family] ?? ARCHITECTURES[inferredArchitecture(type)];
}

function buildingPixels(building, options) {
  const stories = clamp(Math.round(finite(building.storeys ?? building.stories, building.type === 'tower' || building.type === 'watchtower' ? 3 : 1)), 1, 4);
  const architecture = getArchitectureProfile(building.architecture, building.type);
  const wall = options.tileHeight * (1.15 + stories * 0.72) * architecture.wallScale;
  const roof = options.tileHeight * (building.type === 'watchtower' ? 0.5 : 0.9) * architecture.roofScale;
  const special = building.type === 'chapel' || building.type === 'mill' ? options.tileHeight * 2.6 : 0;
  const extra = options.tileHeight * architecture.extraScale;
  return { wall, roof, special, extra, total: wall + roof + special + extra, architecture };
}

function propMetrics(prop, options) {
  const type = prop.type ?? 'grass-tuft';
  const scale = options.tileWidth / 32;
  const values = {
    tree: [64, 96], 'temperate-tree': [64, 96], 'snowy-pine': [64, 96], pine: [64, 96],
    willow: [80, 96], 'swamp-willow': [80, 96], cactus: [48, 64], 'desert-cactus': [48, 64],
    rock: [48, 40], well: [56, 64], cart: [72, 56], haystack: [48, 56],
    'dead-tree': [43, 65], bush: [48, 40], reeds: [40, 56], fence: [34, 21], garden: [36, 20],
  };
  const [width, height] = values[type] ?? [28, 28];
  return { width: width * scale, height: height * scale };
}

/**
 * Calcula bounds conservadores de tudo que pode ser desenhado. A funcao e pura:
 * carregar arte depois pode apenas reduzir a folga, nunca aumentar o canvas.
 */
export function computeRenderBounds(map, options = {}) {
  if (!map || !Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 1 || map.height < 1) {
    throw new TypeError('VillageMap invalido: width e height positivos sao obrigatorios.');
  }
  const resolved = optionsWithDefaults(options);
  const halfW = resolved.tileWidth / 2;
  const halfH = resolved.tileHeight / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const point = projectPoint(x, y, levelAt(map, x, y), resolved);
      include(point.x - halfW, point.y - halfH);
      include(point.x + halfW, point.y + halfH + levelAt(map, x, y) * resolved.heightStep);
    }
  }

  for (const building of map.buildings ?? []) {
    const footprint = buildingFootprint(building);
    const level = finite(building.baseLevel, levelAt(map, building.x, building.y));
    const corners = [
      projectPoint(building.x - 0.5, building.y - 0.5, level, resolved),
      projectPoint(building.x + footprint.width - 0.5, building.y - 0.5, level, resolved),
      projectPoint(building.x + footprint.width - 0.5, building.y + footprint.height - 0.5, level, resolved),
      projectPoint(building.x - 0.5, building.y + footprint.height - 0.5, level, resolved),
    ];
    const vertical = buildingPixels(building, resolved).total;
    for (const point of corners) {
      include(point.x - resolved.tileWidth, point.y - vertical - resolved.tileHeight);
      include(point.x + resolved.tileWidth * 1.75, point.y + resolved.tileHeight * 1.75);
    }
    const sprite = resolveBuildingSprite(building, biomeOf(map), options.buildingSprites ?? BUILDING_ART);
    if (sprite) {
      try {
        const placement = computeBuildingSpritePlacement(building, sprite, { ...resolved, level });
        include(placement.x, placement.y);
        include(placement.x + placement.width, placement.y + placement.height);
      } catch {
        // Manifestos incompletos nunca impedem o fallback procedural.
      }
    }
  }

  for (const prop of map.props ?? []) {
    const level = finite(prop.level, levelAt(map, prop.x, prop.y));
    const point = projectPoint(prop.x, prop.y, level, resolved);
    const metric = propMetrics(prop, resolved);
    include(point.x - metric.width / 2 - resolved.tileWidth, point.y - metric.height - resolved.tileHeight);
    include(point.x + metric.width / 2 + metric.height * 0.45, point.y + metric.height * 0.35 + resolved.tileHeight);
  }

  minX = Math.floor(minX - resolved.padding);
  minY = Math.floor(minY - resolved.padding);
  maxX = Math.ceil(maxX + resolved.padding);
  maxY = Math.ceil(maxY + resolved.padding);
  return Object.freeze({
    width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY),
    originX: -minX, originY: -minY, minX, minY, maxX, maxY,
    ...resolved,
  });
}

/**
 * Retangulo, em pixels do canvas do mundo, que contem o assentamento de fato:
 * edificios e vias. O enquadramento inicial usava o mapa inteiro, entao um mapa
 * com muita agua abria com mais da metade da tela em oceano vazio.
 */
export function computeBuiltBounds(map, options = {}) {
  const metrics = options.originX === undefined ? computeRenderBounds(map, options) : options;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  const include = (point, lift = 0) => {
    const x = point.x + metrics.originX;
    const y = point.y + metrics.originY;
    minX = Math.min(minX, x - metrics.tileWidth / 2);
    maxX = Math.max(maxX, x + metrics.tileWidth / 2);
    minY = Math.min(minY, y - lift - metrics.tileHeight);
    maxY = Math.max(maxY, y + metrics.tileHeight);
    found = true;
  };
  for (const building of map.buildings ?? []) {
    const footprint = buildingFootprint(building);
    const level = finite(building.baseLevel, levelAt(map, building.x, building.y));
    const lift = buildingPixels(building, metrics).total;
    include(projectPoint(building.x - .5, building.y - .5, level, metrics), lift);
    include(projectPoint(building.x + footprint.width - .5, building.y + footprint.height - .5, level, metrics));
  }
  for (const road of map.roads ?? []) {
    include(projectPoint(road.x, road.y, levelAt(map, road.x, road.y), metrics));
  }
  if (!found) return null;
  return Object.freeze({ minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) });
}

function makeCanvas(width, height, supplied) {
  const canvas = supplied ?? (typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : typeof document !== 'undefined' ? document.createElement('canvas') : null);
  if (!canvas) throw new Error('Canvas 2D indisponivel neste ambiente.');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Serializa HTMLCanvasElement ou OffscreenCanvas em PNG. */
export async function canvasToPngBlob(canvas) {
  if (!canvas) throw new TypeError('Canvas obrigatorio para exportacao.');
  if (typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (!blob) throw new Error('O navegador nao conseguiu criar o PNG.');
    return blob;
  }
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('O navegador nao conseguiu criar o PNG.');
    return blob;
  }
  throw new TypeError('Este canvas nao oferece serializacao PNG.');
}

function polygon(ctx, fill, points, stroke = null, lineWidth = 1) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(Math.round(points[index].x), Math.round(points[index].y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function line(ctx, stroke, width, points) {
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(Math.round(points[index].x), Math.round(points[index].y));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function localPoint(x, y, level, state) {
  const point = projectPoint(x, y, level, state.metrics);
  return { x: point.x + state.metrics.originX, y: point.y + state.metrics.originY };
}

function diamondAt(x, y, level, state, inset = 0, lift = 0) {
  const center = localPoint(x, y, level, state);
  const halfW = state.metrics.tileWidth / 2 - inset;
  const halfH = state.metrics.tileHeight / 2 - inset / 2;
  center.y -= lift;
  return {
    center,
    north: { x: center.x, y: center.y - halfH }, east: { x: center.x + halfW, y: center.y },
    south: { x: center.x, y: center.y + halfH }, west: { x: center.x - halfW, y: center.y },
  };
}

function terrainColors(map, type, x, y, level = 1) {
  const biome = biomeOf(map);
  const palette = TERRAIN[biome] ?? TERRAIN.temperate;
  let base = palette[type];
  if (!base) {
    // Um tipo sem cor costumava virar grama em silencio, e foi assim que o
    // sertao arido passou a renderizar como campo verde. Agora ele avisa.
    const key = `${biome}:${type}`;
    if (!reportedTerrainTypes.has(key)) {
      reportedTerrainTypes.add(key);
      console.warn(`Terreno sem cor definida: ${key}. Usando o solo do bioma.`);
    }
    base = palette[TERRAIN_FALLBACK[biome] ?? 'grass'] ?? Object.values(palette)[0];
  }
  const isWater = type === 'water';
  const tones = TONE_OVERRIDES[type] ?? TERRAIN_TONES;
  // Rampa de luminancia por nivel: sem ela os seis degraus de altura ficam
  // indistinguiveis e o mapa inteiro le como um plano. Limitada, porque sem
  // teto ela transformava o platao de pedra do nivel 5 numa laje quase branca.
  const relief = isWater ? 0 : clamp(Math.round((level - 3) * 8), -16, 16);
  const top = tint(base, tones[hash2(x, y, 17) % tones.length] + relief);
  return { top, east: tint(top, -44), south: tint(top, -64) };
}

function drawTerrainTile(ctx, map, x, y, state) {
  const level = levelAt(map, x, y);
  const type = map.terrain?.[y * map.width + x] ?? TERRAIN_FALLBACK[biomeOf(map)] ?? 'grass';
  const shape = diamondAt(x, y, level, state);
  const colors = terrainColors(map, type, x, y, level);
  const xLevel = edgeLevelAt(map, x + 1, y);
  const yLevel = edgeLevelAt(map, x, y + 1);

  if (xLevel < level) {
    const drop = (level - xLevel) * state.metrics.heightStep;
    polygon(ctx, colors.east, [shape.east, shape.south, { x: shape.south.x, y: shape.south.y + drop }, { x: shape.east.x, y: shape.east.y + drop }], tint(colors.east, -18));
    if (drop > state.metrics.heightStep * 1.5) {
      for (let offset = state.metrics.heightStep; offset < drop; offset += state.metrics.heightStep) {
        line(ctx, 'rgba(38,30,24,.22)', 1, [{ x: shape.east.x, y: shape.east.y + offset }, { x: shape.south.x, y: shape.south.y + offset }]);
      }
    }
  }
  if (yLevel < level) {
    const drop = (level - yLevel) * state.metrics.heightStep;
    polygon(ctx, colors.south, [shape.south, shape.west, { x: shape.west.x, y: shape.west.y + drop }, { x: shape.south.x, y: shape.south.y + drop }], tint(colors.south, -18));
    if (drop > state.metrics.heightStep * 1.5) {
      for (let offset = state.metrics.heightStep; offset < drop; offset += state.metrics.heightStep) {
        line(ctx, 'rgba(28,23,20,.24)', 1, [{ x: shape.south.x, y: shape.south.y + offset }, { x: shape.west.x, y: shape.west.y + offset }]);
      }
    }
  }

  // O contorno usa a propria cor de preenchimento: sela a costura entre losangos
  // arredondados sem desenhar a grade de tiles por cima do mundo inteiro.
  polygon(ctx, colors.top, [shape.north, shape.east, shape.south, shape.west], colors.top);
  // Definicao so na fronteira entre tipos diferentes de terreno. Vizinhos de agua
  // ficam de fora porque a espuma abaixo ja marca a margem.
  if (type !== 'water') {
    const eastType = x + 1 < map.width ? map.terrain?.[y * map.width + x + 1] : undefined;
    const southType = y + 1 < map.height ? map.terrain?.[(y + 1) * map.width + x] : undefined;
    const border = tint(colors.top, -24);
    if (eastType && eastType !== type && eastType !== 'water') line(ctx, border, 1, [shape.east, shape.south]);
    if (southType && southType !== type && southType !== 'water') line(ctx, border, 1, [shape.south, shape.west]);
  }
  if (type === 'water') {
    const glint = hash2(x, y, 91) % 5;
    if (glint < 2) line(ctx, 'rgba(215,244,244,.40)', 1, [
      { x: shape.west.x + state.metrics.tileWidth * .22, y: shape.center.y + glint },
      { x: shape.east.x - state.metrics.tileWidth * .24, y: shape.center.y + glint },
    ]);
    for (const [dx, dy, edge] of [[1, 0, [shape.east, shape.south]], [0, 1, [shape.south, shape.west]], [-1, 0, [shape.west, shape.north]], [0, -1, [shape.north, shape.east]]]) {
      const next = map.terrain?.[(y + dy) * map.width + x + dx];
      if (x + dx >= 0 && y + dy >= 0 && x + dx < map.width && y + dy < map.height && next && next !== 'water') {
        line(ctx, 'rgba(236,250,235,.60)', 1, edge);
      }
    }
  } else if (level > Math.max(xLevel, yLevel)) {
    line(ctx, 'rgba(255,244,208,.16)', 1, [shape.west, shape.north, shape.east]);
  }
  if (hash2(x, y, 44) % 13 === 0 && type !== 'water' && type !== 'snow') {
    const dot = shape.center;
    ctx.fillStyle = 'rgba(46,61,35,.22)';
    ctx.fillRect(Math.round(dot.x - 2), Math.round(dot.y), 2, 1);
  }
}

function zoneAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 'none';
  const index = y * map.width + x;
  if (map.terrain?.[index] === 'water') return 'none';
  return map.zoneMap?.[index] ?? 'none';
}

function drawZoneTile(ctx, map, x, y, state) {
  const zone = zoneAt(map, x, y);
  const color = ZONE_COLORS[zone];
  if (!color) return;
  const shape = diamondAt(x, y, levelAt(map, x, y), state, 1);
  ctx.save();
  ctx.globalAlpha = .16;
  polygon(ctx, color, [shape.north, shape.east, shape.south, shape.west]);
  ctx.globalAlpha = .42;
  if (zoneAt(map, x - 1, y) !== zone) line(ctx, color, 1, [shape.west, shape.north]);
  if (zoneAt(map, x, y - 1) !== zone) line(ctx, color, 1, [shape.north, shape.east]);
  if (zoneAt(map, x + 1, y) !== zone) line(ctx, color, 1, [shape.east, shape.south]);
  if (zoneAt(map, x, y + 1) !== zone) line(ctx, color, 1, [shape.south, shape.west]);
  ctx.restore();
}

function drawRoad(ctx, road, map, state) {
  const level = levelAt(map, road.x, road.y);
  const environmentSprite = ENVIRONMENT_ART.get(resolveRoadSpriteType(road));
  if (environmentSprite?.image) {
    try {
      const placement = computeEnvironmentSpritePlacement(road, environmentSprite, { ...state.metrics, level });
      ctx.drawImage(
        environmentSprite.image,
        Math.round(placement.x + state.metrics.originX),
        Math.round(placement.y + state.metrics.originY),
        Math.round(placement.width),
        Math.round(placement.height),
      );
      return;
    } catch {
      // Um asset isolado invalido nao remove a via procedural do mapa.
    }
  }
  const isBridge = Boolean(road.bridge);
  const shape = diamondAt(road.x, road.y, level, state, isBridge ? 1 : 3, isBridge ? 3 : 0);
  if (isBridge) {
    polygon(ctx, '#765034', [shape.north, shape.east, { x: shape.south.x, y: shape.south.y + 3 }, { x: shape.west.x, y: shape.west.y + 3 }], '#3d2b20');
    polygon(ctx, '#a77843', [shape.north, shape.east, shape.south, shape.west], '#4d3525');
    const orientation = road.orientation ?? 'ew';
    const count = 5;
    for (let index = 1; index < count; index += 1) {
      const t = index / count;
      if (orientation === 'ns') {
        const a = { x: shape.north.x * (1 - t) + shape.west.x * t, y: shape.north.y * (1 - t) + shape.west.y * t };
        const b = { x: shape.east.x * (1 - t) + shape.south.x * t, y: shape.east.y * (1 - t) + shape.south.y * t };
        line(ctx, 'rgba(69,42,25,.55)', 1, [a, b]);
      } else {
        const a = { x: shape.west.x * (1 - t) + shape.south.x * t, y: shape.west.y * (1 - t) + shape.south.y * t };
        const b = { x: shape.north.x * (1 - t) + shape.east.x * t, y: shape.north.y * (1 - t) + shape.east.y * t };
        line(ctx, 'rgba(69,42,25,.55)', 1, [a, b]);
      }
    }
    const rails = orientation === 'ns'
      ? [[shape.north, shape.west], [shape.east, shape.south]]
      : [[shape.north, shape.east], [shape.west, shape.south]];
    for (const rail of rails) {
      line(ctx, '#4b3323', 2, rail.map((point) => ({ x: point.x, y: point.y - 3 })));
    }
    const role = road.bridgeRole ?? 'middle';
    const heads = role === 'single' ? [0, 1] : role === 'start' ? [0] : role === 'end' ? [1] : [];
    const ends = orientation === 'ns'
      ? [[shape.north, shape.east], [shape.west, shape.south]]
      : [[shape.north, shape.west], [shape.east, shape.south]];
    for (const head of heads) {
      for (const point of ends[head]) {
        ctx.fillStyle = '#5a3a25';
        ctx.fillRect(Math.round(point.x - 1), Math.round(point.y - 6), 3, 6);
      }
    }
    if (role === 'post') {
      for (const rail of rails) {
        const point = mixPoint(rail[0], rail[1]);
        ctx.fillStyle = '#5a3a25';
        ctx.fillRect(Math.round(point.x - 1), Math.round(point.y - 6), 3, 6);
      }
    }
    return;
  }
  polygon(ctx, road.kind === 'plaza' ? '#b5a071' : '#947958', [shape.north, shape.east, shape.south, shape.west], 'rgba(65,49,36,.30)');
  if (hash2(road.x, road.y, 6) % 4 === 0) {
    ctx.fillStyle = 'rgba(230,210,170,.35)';
    ctx.fillRect(Math.round(shape.center.x - 2), Math.round(shape.center.y), 3, 1);
  }
}

function isPlazaTile(plaza, x, y) {
  return plaza && x >= plaza.x && y >= plaza.y && x < plaza.x + plaza.width && y < plaza.y + plaza.height;
}

function drawPlazaTile(ctx, x, y, level, state) {
  const shape = diamondAt(x, y, level, state, 1);
  polygon(ctx, hash2(x, y, 8) % 2 ? '#b9a475' : '#c3ae7d', [shape.north, shape.east, shape.south, shape.west], '#796b4e');
  line(ctx, 'rgba(245,228,182,.28)', 1, [shape.west, shape.north, shape.east]);
}

function buildingCorners(building, state) {
  const footprint = buildingFootprint(building);
  const level = finite(building.baseLevel, levelAt(state.map, building.x, building.y));
  const n = localPoint(building.x - .5, building.y - .5, level, state);
  const e = localPoint(building.x + footprint.width - .5, building.y - .5, level, state);
  const s = localPoint(building.x + footprint.width - .5, building.y + footprint.height - .5, level, state);
  const w = localPoint(building.x - .5, building.y + footprint.height - .5, level, state);
  return { n, e, s, w, footprint, level };
}

function shifted(point, dy) { return { x: point.x, y: point.y + dy }; }

function mixPoint(a, b, t = .5) { return { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t }; }

export function computeEavedRoofBase(base, amount = 2) {
  if (!base || !base.n || !base.e || !base.s || !base.w) throw new TypeError('Base de beiral invalida.');
  const eave = Math.max(0, finite(amount, 2));
  return {
    n: { x: base.n.x, y: base.n.y - eave * .5 },
    e: { x: base.e.x + eave, y: base.e.y },
    s: { x: base.s.x, y: base.s.y + eave * .5 },
    w: { x: base.w.x - eave, y: base.w.y },
  };
}

/** Retorna a face visivel e a posicao da porta ao longo dela. */
export function computeDoorPlacement(building) {
  const orientation = building?.orientation ?? building?.facing ?? 'south';
  const footprint = buildingFootprint(building ?? {});
  if (orientation === 'south') {
    const doorX = finite(building?.door?.x, finite(building?.x, 0) + (footprint.width - 1) / 2);
    const relative = (doorX - finite(building.x, 0) + .5) / footprint.width;
    return Object.freeze({ orientation, face: 'south', visible: true, t: clamp(1 - relative, .08, .92) });
  }
  if (orientation === 'east') {
    const doorY = finite(building?.door?.y, finite(building?.y, 0) + (footprint.height - 1) / 2);
    const relative = (doorY - finite(building.y, 0) + .5) / footprint.height;
    return Object.freeze({ orientation, face: 'east', visible: true, t: clamp(relative, .08, .92) });
  }
  return Object.freeze({ orientation, face: null, visible: false, t: null });
}

/**
 * Constroi um telhado de duas aguas sobre o paralelogramo isometrico da casa.
 * As faces precisam mudar quando o eixo longo muda: reutilizar os mesmos quatro
 * vertices nos dois casos cria poligonos cruzados e a conhecida "telha
 * triangular" sobreposta no meio do telhado.
 */
export function computeRoofGeometry(base, roofLift, longX = true) {
  if (!base || !base.n || !base.e || !base.s || !base.w) throw new TypeError('Base de telhado invalida.');
  const lift = finite(roofLift, 0);
  if (longX) {
    const ridgeA = shifted(mixPoint(base.n, base.w, .5), lift);
    const ridgeB = shifted(mixPoint(base.e, base.s, .5), lift);
    return {
      ridgeA, ridgeB,
      lightFace: [base.n, base.e, ridgeB, ridgeA],
      darkFace: [ridgeA, ridgeB, base.s, base.w],
      lightEave: [base.n, base.e],
      darkEave: [base.w, base.s],
      gables: [[base.n, ridgeA, base.w], [base.e, base.s, ridgeB]],
    };
  }
  const ridgeA = shifted(mixPoint(base.n, base.e, .5), lift);
  const ridgeB = shifted(mixPoint(base.w, base.s, .5), lift);
  return {
    ridgeA, ridgeB,
    lightFace: [base.n, ridgeA, ridgeB, base.w],
    darkFace: [ridgeA, base.e, base.s, ridgeB],
    lightEave: [base.n, base.w],
    darkEave: [base.e, base.s],
    gables: [[base.n, base.e, ridgeA], [base.w, ridgeB, base.s]],
  };
}

function drawRoofCourses(ctx, ridgeA, ridgeB, eaveA, eaveB, color, width = 1) {
  for (let row = 1; row <= 3; row += 1) {
    const t = row / 4;
    const start = mixPoint(ridgeA, eaveA, t);
    const end = mixPoint(ridgeB, eaveB, t);
    line(ctx, color, width, [start, end]);
    const jointCount = Math.max(2, Math.round(Math.hypot(end.x - start.x, end.y - start.y) / 12));
    for (let joint = 1; joint < jointCount; joint += 1) {
      const u = (joint + (row % 2) * .5) / jointCount;
      if (u >= 1) continue;
      const point = mixPoint(start, end, u);
      const towardEave = mixPoint(ridgeA, eaveA, Math.min(1, t + .12));
      const dx = (towardEave.x - start.x) * .14;
      const dy = (towardEave.y - start.y) * .14;
      line(ctx, color, width, [point, { x: point.x + dx, y: point.y + dy }]);
    }
  }
}

function drawArchitectureDetails(ctx, building, shape, state, mat, profile) {
  const scale = state.metrics.tileWidth / 32;
  const ridgeCenter = mixPoint(shape.ridgeA, shape.ridgeB, .5);
  const lightEaveCenter = mixPoint(shape.roof.lightEave[0], shape.roof.lightEave[1], .5);
  const darkEaveCenter = mixPoint(shape.roof.darkEave[0], shape.roof.darkEave[1], .5);
  if (profile.detail === 'chimney') {
    const anchor = mixPoint(shape.ridgeA, shape.ridgeB, building.variant % 2 ? .72 : .28);
    polygon(ctx, tint(mat.trim, 18), [
      { x: anchor.x - 4 * scale, y: anchor.y + 2 * scale }, { x: anchor.x + 3 * scale, y: anchor.y + 4 * scale },
      { x: anchor.x + 3 * scale, y: anchor.y - 12 * scale }, { x: anchor.x - 4 * scale, y: anchor.y - 14 * scale },
    ], mat.trim);
    line(ctx, 'rgba(240,232,210,.32)', 2 * scale, [
      { x: anchor.x, y: anchor.y - 15 * scale }, { x: anchor.x + 3 * scale, y: anchor.y - 20 * scale },
    ]);
  } else if (profile.detail === 'dormer' || profile.detail === 'twin-dormer') {
    const count = profile.detail === 'twin-dormer' ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const u = count === 1 ? .5 : .32 + index * .36;
      const ridge = mixPoint(shape.ridgeA, shape.ridgeB, u);
      const eave = mixPoint(shape.roof.lightEave[0], shape.roof.lightEave[1], u);
      const center = mixPoint(ridge, eave, .58);
      polygon(ctx, mat.wall, [
        { x: center.x - 5 * scale, y: center.y - 5 * scale }, { x: center.x + 4 * scale, y: center.y - 2 * scale },
        { x: center.x + 4 * scale, y: center.y + 6 * scale }, { x: center.x - 5 * scale, y: center.y + 3 * scale },
      ], mat.trim);
      polygon(ctx, mat.roof, [
        { x: center.x - 7 * scale, y: center.y - 5 * scale }, { x: center.x, y: center.y - 11 * scale },
        { x: center.x + 7 * scale, y: center.y - 3 * scale },
      ], mat.roofDark);
      ctx.fillStyle = '#54747b';
      ctx.fillRect(Math.round(center.x - 2 * scale), Math.round(center.y - 2 * scale), Math.max(1, Math.round(3 * scale)), Math.max(1, Math.round(4 * scale)));
    }
  } else if (profile.detail === 'canopy') {
    const wallA = mixPoint(shape.sTop, shape.wTop, .12);
    const wallB = mixPoint(shape.sTop, shape.wTop, .88);
    const downA = shifted(wallA, 10 * scale);
    const downB = shifted(wallB, 10 * scale);
    polygon(ctx, mat.roofDark, [wallA, wallB, downB, downA], mat.trim);
    line(ctx, mat.trim, 2 * scale, [downA, shifted(downA, 13 * scale)]);
    line(ctx, mat.trim, 2 * scale, [downB, shifted(downB, 13 * scale)]);
  } else if (profile.detail === 'cupola') {
    const baseY = ridgeCenter.y - 2 * scale;
    polygon(ctx, mat.lit, [
      { x: ridgeCenter.x - 6 * scale, y: baseY }, { x: ridgeCenter.x + 6 * scale, y: baseY + 3 * scale },
      { x: ridgeCenter.x + 6 * scale, y: baseY - 10 * scale }, { x: ridgeCenter.x - 6 * scale, y: baseY - 13 * scale },
    ], mat.trim);
    polygon(ctx, mat.roofLit, [
      { x: ridgeCenter.x - 9 * scale, y: baseY - 12 * scale }, { x: ridgeCenter.x, y: baseY - 20 * scale },
      { x: ridgeCenter.x + 9 * scale, y: baseY - 9 * scale }, { x: ridgeCenter.x, y: baseY - 5 * scale },
    ], mat.roofDark);
  } else if (profile.detail === 'porch') {
    const wallA = mixPoint(shape.sTop, shape.wTop, .08);
    const wallB = mixPoint(shape.sTop, shape.wTop, .92);
    const frontA = mixPoint(wallA, darkEaveCenter, .34);
    const frontB = mixPoint(wallB, darkEaveCenter, .34);
    polygon(ctx, mat.roof, [wallA, wallB, shifted(frontB, 9 * scale), shifted(frontA, 9 * scale)], mat.roofDark);
    line(ctx, mat.trim, 2 * scale, [shifted(frontA, 9 * scale), shifted(frontA, 22 * scale)]);
    line(ctx, mat.trim, 2 * scale, [shifted(frontB, 9 * scale), shifted(frontB, 22 * scale)]);
  } else if (profile.detail === 'battlement') {
    const top = ridgeCenter.y - 4 * scale;
    for (let index = -2; index <= 2; index += 1) {
      ctx.fillStyle = mat.trim;
      ctx.fillRect(Math.round(ridgeCenter.x + index * 6 * scale - 2 * scale), Math.round(top - Math.abs(index) * scale), Math.max(2, Math.round(4 * scale)), Math.max(2, Math.round(6 * scale)));
    }
  } else if (profile.detail === 'parapet') {
    line(ctx, mat.trim, 3 * scale, [shape.roof.lightEave[0], shape.roof.lightEave[1]]);
    line(ctx, tint(mat.wall, 18), 3 * scale, [shape.roof.darkEave[0], shape.roof.darkEave[1]]);
    for (const t of [.12, .38, .62, .88]) {
      const point = mixPoint(shape.roof.darkEave[0], shape.roof.darkEave[1], t);
      ctx.fillStyle = mat.trim;
      ctx.fillRect(Math.round(point.x - 2 * scale), Math.round(point.y - 5 * scale), Math.max(2, Math.round(4 * scale)), Math.max(2, Math.round(6 * scale)));
    }
  } else if (profile.detail === 'balcony') {
    const left = mixPoint(shape.sTop, shape.wTop, .16);
    const right = mixPoint(shape.sTop, shape.wTop, .84);
    const deckLeft = shifted(left, 18 * scale);
    const deckRight = shifted(right, 18 * scale);
    polygon(ctx, tint(mat.trim, 16), [deckLeft, deckRight, shifted(deckRight, 4 * scale), shifted(deckLeft, 4 * scale)], mat.trim);
    line(ctx, mat.trim, 2 * scale, [shifted(left, 10 * scale), shifted(right, 10 * scale)]);
    for (const t of [.05, .35, .65, .95]) {
      const top = mixPoint(shifted(left, 10 * scale), shifted(right, 10 * scale), t);
      const bottom = mixPoint(deckLeft, deckRight, t);
      line(ctx, mat.trim, 1, [top, bottom]);
    }
  } else if (profile.detail === 'stilts') {
    for (const point of [shape.e, shape.s, shape.w]) {
      line(ctx, '#4d3827', 3 * scale, [point, shifted(point, 14 * scale)]);
      line(ctx, 'rgba(38,48,37,.28)', 2 * scale, [shifted(point, 14 * scale), { x: point.x + 7 * scale, y: point.y + 18 * scale }]);
    }
  } else if (profile.detail === 'braces') {
    const a = mixPoint(shape.sTop, shape.wTop, .10);
    const b = mixPoint(shape.sTop, shape.wTop, .90);
    const c = mixPoint(shape.s, shape.w, .10);
    const d = mixPoint(shape.s, shape.w, .90);
    line(ctx, 'rgba(67,43,27,.70)', 2 * scale, [a, d]);
    line(ctx, 'rgba(67,43,27,.70)', 2 * scale, [b, c]);
  }

  if (state.showZones && building.zone && ZONE_COLORS[building.zone]) {
    ctx.save();
    ctx.globalAlpha = .72;
    ctx.fillStyle = ZONE_COLORS[building.zone];
    ctx.fillRect(Math.round(lightEaveCenter.x - 2 * scale), Math.round(lightEaveCenter.y + 2 * scale), Math.max(2, Math.round(4 * scale)), Math.max(2, Math.round(3 * scale)));
    ctx.restore();
  }
}

/**
 * Silhueta projetada da base, e nao uma tira na aresta: o desenho anterior
 * cobria so o lado sudoeste com 4% a 11% de alpha, entao o predio parecia um
 * adesivo colado no terreno. O contorno da base somado a copia deslocada
 * forma o hexagono convexo que a luz do canto superior esquerdo produziria.
 */
// A caixa do PNG inclui folga transparente acima do telhado; so uma fracao dela
// e volume construido de fato.
const SPRITE_SHADOW_FACTOR = .62;

/**
 * Altura visual em pixels. Para um predio raster ela vem do sprite: usar a
 * altura procedural (~43 px) enquanto o sprite Blender ocupa ~126 px produzia
 * uma sombra curta demais, que terminava embaixo do proprio predio.
 */
function shadowHeightOf(building, state) {
  const sprite = resolveBuildingSprite(building, biomeOf(state.map), state.buildingSprites);
  if (sprite) {
    try {
      const level = finite(building.baseLevel, levelAt(state.map, building.x, building.y));
      const placement = computeBuildingSpritePlacement(building, sprite, { ...state.metrics, level });
      const visual = (placement.anchor.y - placement.y) * SPRITE_SHADOW_FACTOR;
      if (visual > 0) return visual;
    } catch {
      // Metadados incompletos caem na estimativa procedural.
    }
  }
  return buildingPixels(building, state.metrics).total;
}

function drawBuildingShadow(ctx, building, state) {
  const c = buildingCorners(building, state);
  const vertical = shadowHeightOf(building, state);
  ctx.save();
  for (const [reach, alpha] of [[1.15, .12], [.82, .15], [.45, .18]]) {
    const dx = vertical * .42 * reach;
    const dy = vertical * .20 * reach;
    ctx.globalAlpha = alpha;
    polygon(ctx, '#101813', [
      c.n, c.e,
      { x: c.e.x + dx, y: c.e.y + dy },
      { x: c.s.x + dx, y: c.s.y + dy },
      { x: c.w.x + dx, y: c.w.y + dy },
      c.w,
    ]);
  }
  ctx.globalAlpha = .30;
  line(ctx, '#101511', 3, [c.w, c.s, c.e]);
  ctx.restore();
}

function drawWindows(ctx, building, wall, side, material, count, doorPlacement) {
  const topA = side === 'east' ? wall.eTop : wall.sTop;
  const topB = side === 'east' ? wall.sTop : wall.wTop;
  const bottomA = side === 'east' ? wall.e : wall.s;
  const bottomB = side === 'east' ? wall.s : wall.w;
  for (let index = 1; index <= count; index += 1) {
    const t = index / (count + 1);
    if (doorPlacement.face === side && Math.abs(t - doorPlacement.t) < .19) continue;
    const top = mixPoint(topA, topB, t);
    const bottom = mixPoint(bottomA, bottomB, t);
    const center = mixPoint(top, bottom, .56);
    const dx = side === 'east' ? -3 : 3;
    polygon(ctx, material.trim, [
      { x: center.x - 4, y: center.y - 5 }, { x: center.x + dx, y: center.y - 2 },
      { x: center.x + dx, y: center.y + 5 }, { x: center.x - 4, y: center.y + 2 },
    ]);
    polygon(ctx, side === 'east' ? '#71939a' : '#4e707a', [
      { x: center.x - 3, y: center.y - 4 }, { x: center.x + dx - Math.sign(dx), y: center.y - 2 },
      { x: center.x + dx - Math.sign(dx), y: center.y + 3 }, { x: center.x - 3, y: center.y + 1 },
    ]);
  }
}

function drawDoorThreshold(ctx, building, state) {
  if (!building.door) return;
  const x = Math.round(finite(building.door.x, -1));
  const y = Math.round(finite(building.door.y, -1));
  if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return;
  const shape = diamondAt(x, y, levelAt(state.map, x, y), state, state.metrics.tileWidth * .33, -1);
  polygon(ctx, '#b5a47d', [shape.north, shape.east, shape.south, shape.west], '#615845');
  line(ctx, 'rgba(244,231,193,.45)', 1, [shape.west, shape.north, shape.east]);
}

function drawFoundation(ctx, wall, state) {
  const rise = Math.max(4, state.metrics.tileHeight * .34);
  const eTop = shifted(wall.e, -rise);
  const sTop = shifted(wall.s, -rise);
  const wTop = shifted(wall.w, -rise);
  polygon(ctx, '#716e64', [eTop, sTop, wall.s, wall.e], '#45463f');
  polygon(ctx, '#89857a', [sTop, wTop, wall.w, wall.s], '#515048');
  line(ctx, 'rgba(225,218,198,.22)', 1, [wTop, sTop, eTop]);
  const joints = Math.max(2, wall.footprint.width + wall.footprint.height);
  for (let index = 1; index < joints; index += 1) {
    const t = index / joints;
    const point = mixPoint(wTop, sTop, t);
    line(ctx, 'rgba(49,48,44,.30)', 1, [point, shifted(point, rise * .72)]);
  }
}

function drawWallTexture(ctx, building, wall, materialKey, state) {
  const stoneLike = ['stone', 'slate', 'sandstone', 'mudbrick', 'adobe'].includes(materialKey);
  const timberLike = ['wood', 'wattle'].includes(materialKey);
  const rows = stoneLike ? 4 : 3;
  for (let row = 1; row < rows; row += 1) {
    const t = row / rows;
    const eastA = mixPoint(wall.eTop, wall.e, t);
    const eastB = mixPoint(wall.sTop, wall.s, t);
    const southA = mixPoint(wall.sTop, wall.s, t);
    const southB = mixPoint(wall.wTop, wall.w, t);
    const color = stoneLike ? 'rgba(50,46,40,.20)' : 'rgba(255,248,226,.09)';
    line(ctx, color, 1, [eastA, eastB]);
    line(ctx, color, 1, [southA, southB]);
  }
  if (timberLike) {
    const beams = Math.max(2, Math.floor((wall.footprint.width + wall.footprint.height) / 2));
    for (let index = 1; index <= beams; index += 1) {
      const t = index / (beams + 1);
      line(ctx, 'rgba(67,43,27,.52)', 1, [mixPoint(wall.sTop, wall.wTop, t), mixPoint(wall.s, wall.w, t)]);
      if (index <= wall.footprint.height) line(ctx, 'rgba(55,38,28,.42)', 1, [mixPoint(wall.eTop, wall.sTop, t), mixPoint(wall.e, wall.s, t)]);
    }
  } else if (hash2(building.x, building.y, building.variant ?? 0) % 2 === 0) {
    const center = mixPoint(mixPoint(wall.sTop, wall.wTop, .5), mixPoint(wall.s, wall.w, .5), .52);
    ctx.fillStyle = 'rgba(77,69,56,.18)';
    ctx.fillRect(Math.round(center.x - 1), Math.round(center.y - 1), 3, 2);
  }
}

function drawVisibleDoor(ctx, building, wall, material, placement, state) {
  if (!placement.visible) return;
  const side = placement.face;
  const topA = side === 'east' ? wall.eTop : wall.sTop;
  const topB = side === 'east' ? wall.sTop : wall.wTop;
  const groundA = side === 'east' ? wall.e : wall.s;
  const groundB = side === 'east' ? wall.s : wall.w;
  const wallTop = mixPoint(topA, topB, placement.t);
  const ground = mixPoint(groundA, groundB, placement.t);
  const doorTop = mixPoint(wallTop, ground, .43);
  const vx = topB.x - topA.x;
  const vy = topB.y - topA.y;
  const length = Math.max(1, Math.hypot(vx, vy));
  const width = Math.max(4, state.metrics.tileWidth * .17);
  const ux = vx / length * width;
  const uy = vy / length * width;
  const frame = [
    { x: doorTop.x - ux, y: doorTop.y - uy }, { x: doorTop.x + ux, y: doorTop.y + uy },
    { x: ground.x + ux, y: ground.y + uy }, { x: ground.x - ux, y: ground.y - uy },
  ];
  polygon(ctx, material.trim, frame);
  const inset = frame.map((point, index) => mixPoint(point, index < 2 ? ground : doorTop, .08));
  polygon(ctx, '#3b291e', inset, '#271c16');
  const knob = mixPoint(doorTop, ground, .58);
  ctx.fillStyle = '#d9b75f';
  ctx.fillRect(Math.round(knob.x + ux * .45), Math.round(knob.y + uy * .45), 1, 1);
}

function drawRasterBuilding(ctx, building, sprite, state) {
  if (!sprite?.image) return false;
  const level = finite(building.baseLevel, levelAt(state.map, building.x, building.y));
  let placement;
  try {
    placement = computeBuildingSpritePlacement(building, sprite, { ...state.metrics, level });
  } catch {
    return false;
  }
  drawDoorThreshold(ctx, building, state);
  const visualDoor = {
    x: placement.visualDoor.x + state.metrics.originX,
    y: placement.visualDoor.y + state.metrics.originY,
  };
  if (building.door) {
    const doorX = finite(building.door.x, NaN);
    const doorY = finite(building.door.y, NaN);
    if (Number.isFinite(doorX) && Number.isFinite(doorY)) {
      const logicalDoor = localPoint(doorX, doorY, levelAt(state.map, doorX, doorY), state);
      ctx.save();
      ctx.globalAlpha = .92;
      line(ctx, '#77674f', Math.max(3, state.metrics.tileHeight * .32), [logicalDoor, visualDoor]);
      line(ctx, 'rgba(218,199,157,.72)', 1, [logicalDoor, visualDoor]);
      ctx.restore();
    }
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    sprite.image,
    Math.round(placement.x + state.metrics.originX),
    Math.round(placement.y + state.metrics.originY),
    Math.max(1, Math.round(placement.width)),
    Math.max(1, Math.round(placement.height)),
  );
  ctx.restore();
  return true;
}

function drawBuilding(ctx, building, state) {
  const sprite = resolveBuildingSprite(building, biomeOf(state.map), state.buildingSprites);
  if (drawRasterBuilding(ctx, building, sprite, state)) return;
  const c = buildingCorners(building, state);
  const pixels = buildingPixels(building, state.metrics);
  const wallKey = MATERIAL_ALIASES[building.material] ?? building.material;
  const wallMaterial = MATERIALS[wallKey] ?? MATERIALS.wood;
  const roofKey = ROOF_ALIASES[building.roof] ?? building.roof;
  const roofMaterial = MATERIALS[roofKey] ?? wallMaterial;
  const mat = {
    ...wallMaterial,
    roof: roofMaterial.roof,
    roofLit: roofMaterial.roofLit,
    roofDark: roofMaterial.roofDark,
  };
  const profile = pixels.architecture;
  const doorPlacement = computeDoorPlacement(building);
  const wallLift = -pixels.wall;
  const wall = { ...c, nTop: shifted(c.n, wallLift), eTop: shifted(c.e, wallLift), sTop: shifted(c.s, wallLift), wTop: shifted(c.w, wallLift) };

  drawDoorThreshold(ctx, building, state);
  polygon(ctx, '#5a5448', [c.e, c.s, c.w, c.n], '#39352f');
  polygon(ctx, mat.shade, [wall.eTop, wall.sTop, wall.s, wall.e], mat.trim);
  polygon(ctx, mat.wall, [wall.sTop, wall.wTop, wall.w, wall.s], mat.trim);
  line(ctx, 'rgba(255,248,220,.20)', 1, [wall.wTop, wall.sTop]);
  drawWallTexture(ctx, building, wall, wallKey, state);
  drawFoundation(ctx, wall, state);
  drawWindows(ctx, building, wall, 'east', mat, Math.max(1, c.footprint.height - 1), doorPlacement);
  drawWindows(ctx, building, wall, 'south', mat, Math.max(1, c.footprint.width - 1), doorPlacement);

  const roofBase = { n: wall.nTop, e: wall.eTop, s: wall.sTop, w: wall.wTop };
  const eavedRoofBase = computeEavedRoofBase(roofBase, Math.max(2, state.metrics.tileWidth / 15));
  const roofLift = -pixels.roof;
  const longX = c.footprint.width >= c.footprint.height;
  const wallRoof = computeRoofGeometry(roofBase, roofLift, longX);
  const roof = computeRoofGeometry(eavedRoofBase, roofLift, longX);
  for (let index = 0; index < wallRoof.gables.length; index += 1) {
    polygon(ctx, index === 0 ? mat.wall : mat.shade, wallRoof.gables[index], mat.trim);
  }
  polygon(ctx, mat.roofLit, roof.lightFace, tint(mat.roofDark, -4));
  polygon(ctx, mat.roofDark, roof.darkFace, tint(mat.roofDark, -10));
  drawRoofCourses(ctx, roof.ridgeA, roof.ridgeB, roof.lightEave[0], roof.lightEave[1], 'rgba(74,45,28,.24)');
  drawRoofCourses(ctx, roof.ridgeA, roof.ridgeB, roof.darkEave[0], roof.darkEave[1], 'rgba(18,18,16,.30)');
  line(ctx, tint(mat.roofLit, 24), 2, [roof.ridgeA, roof.ridgeB]);
  line(ctx, 'rgba(16,17,15,.48)', 4, [eavedRoofBase.w, eavedRoofBase.s, eavedRoofBase.e]);
  line(ctx, 'rgba(238,221,178,.18)', 1, [eavedRoofBase.w, eavedRoofBase.s, eavedRoofBase.e]);
  drawVisibleDoor(ctx, building, wall, mat, doorPlacement, state);

  drawArchitectureDetails(ctx, building, { ...wall, roof, ridgeA: roof.ridgeA, ridgeB: roof.ridgeB }, state, mat, profile);

  drawBuildingFeature(ctx, building, { ...wall, ridgeA: roof.ridgeA, ridgeB: roof.ridgeB, pixels }, state);
}

function drawBuildingFeature(ctx, building, shape, state) {
  const type = building.type ?? 'house';
  const center = mixPoint(shape.ridgeA, shape.ridgeB, .5);
  if (type === 'chapel') {
    const top = { x: center.x, y: center.y - state.metrics.tileHeight * 2.2 };
    line(ctx, '#4c3826', 3, [center, top]);
    line(ctx, '#d8c88e', 2, [{ x: top.x - 6, y: top.y + 5 }, { x: top.x + 6, y: top.y + 5 }]);
  } else if (type === 'mill') {
    const hub = { x: shape.sTop.x + 5, y: shape.sTop.y - 6 };
    ctx.fillStyle = '#d0aa68';
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) {
      const end = { x: hub.x + Math.cos(angle) * 23, y: hub.y + Math.sin(angle) * 18 };
      line(ctx, '#6b4b2c', 3, [hub, end]);
    }
    ctx.beginPath(); ctx.arc(hub.x, hub.y, 4, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'blacksmith' || type === 'smithy') {
    const chimney = { x: shape.ridgeB.x - 8, y: shape.ridgeB.y + 4 };
    polygon(ctx, '#625b50', [
      { x: chimney.x - 4, y: chimney.y }, { x: chimney.x + 3, y: chimney.y + 2 },
      { x: chimney.x + 3, y: chimney.y - 18 }, { x: chimney.x - 4, y: chimney.y - 20 },
    ], '#383833');
  } else if (type === 'watchtower' || type === 'tower') {
    const y = center.y - state.metrics.tileHeight * 1.2;
    line(ctx, '#6c2929', 2, [{ x: center.x, y: center.y }, { x: center.x, y }]);
    polygon(ctx, '#b8443b', [{ x: center.x, y }, { x: center.x + 18, y: y + 5 }, { x: center.x, y: y + 10 }]);
  } else if (type === 'inn' || type === 'hall' || type === 'town-hall' || type === 'townHall') {
    const mark = { x: shape.sTop.x - 10, y: shape.sTop.y + 7 };
    polygon(ctx, '#92372f', [mark, { x: mark.x + 10, y: mark.y + 3 }, { x: mark.x + 10, y: mark.y + 15 }, { x: mark.x, y: mark.y + 12 }], '#542b25');
  } else if (type === 'market' || type === 'shop') {
    line(ctx, '#e8d7a8', 3, [shape.sTop, shape.wTop]);
    line(ctx, '#a43e35', 2, [mixPoint(shape.sTop, shape.wTop, .2), mixPoint(shape.sTop, shape.wTop, .4)]);
  }
}

function propAssetType(prop, biome) {
  if (prop.type === 'oak') return 'temperate-tree';
  if (prop.type === 'tree') {
    if (biome === 'snowy') return 'snowy-pine';
    if (biome === 'wetland') return 'swamp-willow';
    return 'temperate-tree';
  }
  if (prop.type === 'pine') return 'snowy-pine';
  if (prop.type === 'willow') return 'swamp-willow';
  if (prop.type === 'cactus') return 'desert-cactus';
  return prop.type;
}

function drawPropShadow(ctx, prop, state) {
  const level = finite(prop.level, levelAt(state.map, prop.x, prop.y));
  const center = localPoint(prop.x, prop.y, level, state);
  const metric = propMetrics(prop, state.metrics);
  ctx.save();
  ctx.globalAlpha = .26;
  ctx.fillStyle = '#142019';
  ctx.beginPath();
  ctx.ellipse(center.x + metric.height * .18, center.y + metric.height * .10, metric.width * .35, Math.max(3, metric.height * .08), .22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Espelhamento e escala derivados da posicao. Ha um unico PNG por especie, e
 * sem isso um mapa exibe quarenta arvores rigorosamente identicas, o que le
 * como ruido procedural em vez de vegetacao.
 */
function propVariation(prop) {
  const noise = hash2(prop.x, prop.y, 23);
  return {
    flipped: (noise & 1) === 1,
    scale: .88 + ((noise >>> 1) % 7) / 6 * .24,
  };
}

function drawProp(ctx, prop, state) {
  const level = finite(prop.level, levelAt(state.map, prop.x, prop.y));
  const center = localPoint(prop.x, prop.y, level, state);
  const type = propAssetType(prop, biomeOf(state.map));
  const asset = ART.get(type);
  const variation = propVariation(prop);
  if (asset) {
    const scale = state.metrics.tileWidth / 32 * variation.scale;
    const width = (asset.naturalWidth || asset.width) * scale;
    const height = (asset.naturalHeight || asset.height) * scale;
    ctx.save();
    ctx.translate(Math.round(center.x), Math.round(center.y + state.metrics.tileHeight / 2));
    if (variation.flipped) ctx.scale(-1, 1);
    ctx.drawImage(asset, Math.round(-width / 2), Math.round(-height), Math.round(width), Math.round(height));
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(center.x, center.y);
  if (variation.flipped) ctx.scale(-1, 1);
  ctx.scale(variation.scale, variation.scale);
  ctx.translate(-center.x, -center.y);
  drawProceduralProp(ctx, { ...prop, type }, center, state);
  ctx.restore();
}

function drawProceduralProp(ctx, prop, center, state) {
  const s = state.metrics.tileWidth / 32;
  const rect = (fill, x, y, w, h) => { ctx.fillStyle = fill; ctx.fillRect(Math.round(center.x + x * s), Math.round(center.y + y * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))); };
  switch (prop.type) {
    case 'tree': case 'temperate-tree': case 'snowy-pine': case 'pine': case 'willow': case 'swamp-willow': {
      const snowy = prop.type.includes('snow') || prop.type === 'pine';
      const willow = prop.type.includes('willow');
      rect('#68482e', -2, -31, 5, 35);
      const foliage = snowy ? ['#2f5650', '#406d60', '#dfe9e7'] : willow ? ['#355d3b', '#4d7a49', '#6d9659'] : ['#285b3c', '#3e7647', '#629554'];
      polygon(ctx, foliage[0], [{ x: center.x, y: center.y - 73*s }, { x: center.x + 25*s, y: center.y - 30*s }, { x: center.x - 25*s, y: center.y - 30*s }]);
      polygon(ctx, foliage[1], [{ x: center.x, y: center.y - 63*s }, { x: center.x + 31*s, y: center.y - 20*s }, { x: center.x - 31*s, y: center.y - 20*s }]);
      polygon(ctx, foliage[2], [{ x: center.x - 8*s, y: center.y - 62*s }, { x: center.x + 15*s, y: center.y - 34*s }, { x: center.x - 22*s, y: center.y - 34*s }]);
      break;
    }
    case 'cactus': case 'desert-cactus':
      rect('#397b4b', -4, -42, 8, 44); rect('#397b4b', -13, -27, 11, 7); rect('#397b4b', -13, -34, 6, 13); rect('#4d9660', 3, -23, 11, 7); rect('#4d9660', 9, -29, 6, 12); break;
    case 'rock':
      polygon(ctx, '#67736c', [{ x: center.x-16*s,y:center.y },{x:center.x-12*s,y:center.y-14*s},{x:center.x+2*s,y:center.y-21*s},{x:center.x+16*s,y:center.y-7*s},{x:center.x+11*s,y:center.y+2*s}], '#39443e');
      line(ctx, '#a2aca2', 2*s, [{x:center.x-10*s,y:center.y-12*s},{x:center.x+1*s,y:center.y-17*s},{x:center.x+8*s,y:center.y-10*s}]); break;
    case 'well':
      polygon(ctx, '#666d67', [{x:center.x-16*s,y:center.y-8*s},{x:center.x,y:center.y-16*s},{x:center.x+16*s,y:center.y-8*s},{x:center.x,y:center.y}], '#3d4642');
      line(ctx, '#8c6840', 3*s, [{x:center.x-12*s,y:center.y-10*s},{x:center.x-12*s,y:center.y-34*s},{x:center.x+12*s,y:center.y-22*s},{x:center.x+12*s,y:center.y-2*s}]); break;
    case 'cart':
      polygon(ctx, '#91673b', [{x:center.x-23*s,y:center.y-20*s},{x:center.x+5*s,y:center.y-8*s},{x:center.x+21*s,y:center.y-16*s},{x:center.x-7*s,y:center.y-28*s}], '#4d3523');
      ctx.fillStyle='#443023'; ctx.beginPath(); ctx.arc(center.x-13*s,center.y-6*s,7*s,0,Math.PI*2);ctx.fill(); ctx.beginPath();ctx.arc(center.x+13*s,center.y-6*s,7*s,0,Math.PI*2);ctx.fill(); break;
    case 'haystack':
      polygon(ctx, '#c99b42', [{x:center.x-18*s,y:center.y},{x:center.x-14*s,y:center.y-24*s},{x:center.x,y:center.y-35*s},{x:center.x+17*s,y:center.y-20*s},{x:center.x+18*s,y:center.y}], '#88632e');
      line(ctx,'#efd072',2*s,[{x:center.x-12*s,y:center.y-21*s},{x:center.x+13*s,y:center.y-11*s}]); break;
    case 'fence':
      line(ctx, '#765032', 3*s, [{x:center.x-16*s,y:center.y-8*s},{x:center.x+16*s,y:center.y+8*s}]);
      line(ctx, '#aa7948', 3*s, [{x:center.x-11*s,y:center.y-15*s},{x:center.x-11*s,y:center.y-1*s}]); line(ctx,'#aa7948',3*s,[{x:center.x+11*s,y:center.y-4*s},{x:center.x+11*s,y:center.y+12*s}]); break;
    case 'bush':
      polygon(ctx, '#37633e', [{x:center.x-15*s,y:center.y},{x:center.x-13*s,y:center.y-15*s},{x:center.x,y:center.y-23*s},{x:center.x+16*s,y:center.y-10*s},{x:center.x+14*s,y:center.y}], '#274b32');
      polygon(ctx, '#5a8c50', [{x:center.x-9*s,y:center.y-10*s},{x:center.x-3*s,y:center.y-19*s},{x:center.x+8*s,y:center.y-12*s},{x:center.x+4*s,y:center.y-5*s}]); break;
    default:
      rect('#657f4a', -1, -13, 2, 14); rect('#8ea95c', -7, -9, 6, 2); rect('#8ea95c', 1, -6, 7, 2);
  }
}

function depthForBuilding(building) {
  const footprint = buildingFootprint(building);
  return Math.floor(building.x + building.y + footprint.width + footprint.height - 2);
}

function depthForProp(prop) { return Math.floor(prop.x + prop.y); }

function ambientColor(biome) {
  return { temperate: 'rgba(255,224,155,.07)', arid: 'rgba(255,195,112,.10)', snowy: 'rgba(170,210,255,.08)', wetland: 'rgba(127,187,154,.08)' }[biome] ?? 'rgba(255,224,155,.07)';
}

const REFLECTION_REACH = 7;
const REFLECTION_ALPHA = .3;
const REFLECTION_SQUASH = .82;

/** Indexa vias e objetos por profundidade uma unica vez para os tres passes. */
function buildScene(map) {
  const roads = new Map((map.roads ?? []).map((road) => [`${road.x},${road.y}`, road]));
  const buildingsByDepth = new Map();
  const propsByDepth = new Map();
  for (const building of map.buildings ?? []) {
    const depth = depthForBuilding(building);
    if (!buildingsByDepth.has(depth)) buildingsByDepth.set(depth, []);
    buildingsByDepth.get(depth).push(building);
  }
  for (const prop of map.props ?? []) {
    const depth = depthForProp(prop);
    if (!propsByDepth.has(depth)) propsByDepth.set(depth, []);
    propsByDepth.get(depth).push(prop);
  }
  return { roads, buildingsByDepth, propsByDepth, maxDepth: map.width + map.height + 8 };
}

/**
 * Passe A: o chao inteiro. Separar o chao dos objetos e o que torna possivel
 * pousar sombra e reflexo sobre ele; no loop unico anterior a sombra caia em
 * tiles que ainda seriam pintados e desaparecia.
 */
function drawGroundPass(ctx, map, state, scene) {
  for (let depth = 0; depth <= scene.maxDepth; depth += 1) {
    const xStart = Math.max(0, depth - (map.height - 1));
    const xEnd = Math.min(map.width - 1, depth);
    for (let x = xStart; x <= xEnd; x += 1) {
      const y = depth - x;
      drawTerrainTile(ctx, map, x, y, state);
      if (state.showZones) drawZoneTile(ctx, map, x, y, state);
      const road = scene.roads.get(`${x},${y}`);
      if (road) drawRoad(ctx, road, map, state);
      else if (isPlazaTile(map.plaza, x, y)) drawPlazaTile(ctx, x, y, levelAt(map, x, y), state);
    }
  }
}

/** Passe C: edificios e props, em ordem de profundidade. */
function drawObjectPass(ctx, state, scene) {
  for (let depth = 0; depth <= scene.maxDepth; depth += 1) {
    const objects = [
      ...(scene.buildingsByDepth.get(depth) ?? []).map((value) => ({ kind: 'building', value })),
      ...(scene.propsByDepth.get(depth) ?? []).map((value) => ({ kind: 'prop', value })),
    ].sort((a, b) => (a.value.x - b.value.x) || (a.kind === 'building' ? -1 : 1));
    for (const object of objects) {
      if (object.kind === 'building') drawBuilding(ctx, object.value, state);
      else drawProp(ctx, object.value, state);
    }
  }
}

function makeOffscreenCanvas(width, height) {
  try {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  } catch {
    // Sem canvas auxiliar o reflexo apenas nao acontece; o resto do mapa segue.
  }
  return null;
}

/**
 * Junta, numa unica varredura, quem reflete e quais tiles de agua servem de
 * mascara. Percorrer so a vizinhanca dos objetos evita varrer o mapa inteiro:
 * num pantano sao milhares de tiles de agua, e quase nenhum recebe reflexo.
 */
function collectReflectors(map) {
  const reflectors = [];
  const waterTiles = new Set();
  const consider = (item, kind) => {
    const cx = Math.round(finite(item.x, 0));
    const cy = Math.round(finite(item.y, 0));
    let touchesWater = false;
    for (let dy = -REFLECTION_REACH; dy <= REFLECTION_REACH; dy += 1) {
      for (let dx = -REFLECTION_REACH; dx <= REFLECTION_REACH; dx += 1) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const index = ny * map.width + nx;
        if (map.terrain?.[index] !== 'water') continue;
        waterTiles.add(index);
        touchesWater = true;
      }
    }
    if (touchesWater) reflectors.push({ item, kind });
  };
  for (const building of map.buildings ?? []) consider(building, 'building');
  for (const prop of map.props ?? []) consider(prop, 'prop');
  return { reflectors, waterTiles };
}

/** Espelha o desenho em torno da linha de base do objeto, com leve achatamento. */
function mirrored(ctx, baseY, draw) {
  ctx.save();
  ctx.translate(0, baseY * (1 + REFLECTION_SQUASH));
  ctx.scale(1, -REFLECTION_SQUASH);
  draw();
  ctx.restore();
}

/**
 * Reflexo na agua. Os objetos proximos da margem sao redesenhados espelhados
 * numa camada propria, recortada pela superficie de agua, e so entao composta
 * de uma vez — compor a camada inteira evita que as faces de um mesmo predio
 * se somem em alpha e virem uma mancha.
 */
function drawReflections(ctx, map, state) {
  const { reflectors, waterTiles } = collectReflectors(map);
  if (!reflectors.length || !waterTiles.size) return false;
  const layer = makeOffscreenCanvas(state.metrics.width, state.metrics.height);
  const layerCtx = layer?.getContext('2d');
  if (!layerCtx) return false;
  layerCtx.imageSmoothingEnabled = false;
  for (const { item, kind } of reflectors) {
    if (kind === 'building') {
      mirrored(layerCtx, buildingCorners(item, state).s.y, () => drawBuilding(layerCtx, item, state));
    } else {
      const level = finite(item.level, levelAt(map, item.x, item.y));
      mirrored(layerCtx, localPoint(item.x, item.y, level, state).y, () => drawProp(layerCtx, item, state));
    }
  }
  // Recorte por composicao, e nao por clip: um clip com milhares de sub-caminhos
  // custava segundos por mapa. Todos os losangos entram num unico caminho e
  // sofrem um unico fill — aplicar destination-in losango a losango faria
  // intersecao sucessiva, sobrando apenas o ultimo.
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.beginPath();
  for (const index of waterTiles) {
    const shape = diamondAt(index % map.width, Math.floor(index / map.width), 0, state);
    layerCtx.moveTo(shape.north.x, shape.north.y);
    layerCtx.lineTo(shape.east.x, shape.east.y);
    layerCtx.lineTo(shape.south.x, shape.south.y);
    layerCtx.lineTo(shape.west.x, shape.west.y);
    layerCtx.closePath();
  }
  layerCtx.fillStyle = '#ffffff';
  layerCtx.fill();
  layerCtx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalAlpha = REFLECTION_ALPHA;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
  return true;
}

/** Passe B: decalques de chao — reflexo na agua e sombras projetadas. */
function drawDecalPass(ctx, map, state, scene, options) {
  if (options.reflections !== false) drawReflections(ctx, map, state);
  for (const list of scene.buildingsByDepth.values()) {
    for (const building of list) drawBuildingShadow(ctx, building, state);
  }
  for (const list of scene.propsByDepth.values()) {
    for (const prop of list) drawPropShadow(ctx, prop, state);
  }
}

/** Renderiza o mapa completo, independente do enquadramento atual da camera. */
export function renderVillageToCanvas(map, options = {}) {
  const buildingSprites = options.buildingSprites ?? BUILDING_ART;
  const metrics = computeRenderBounds(map, { ...options, buildingSprites });
  const canvas = makeCanvas(metrics.width, metrics.height, options.canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Contexto Canvas 2D indisponivel.');
  ctx.imageSmoothingEnabled = false;
  const biome = biomeOf(map);
  ctx.fillStyle = biome === 'snowy' ? '#d5e0df' : biome === 'arid' ? '#b9955f' : '#294737';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const state = { map, metrics, showZones: options.showZones === true, buildingSprites };
  const scene = buildScene(map);

  drawGroundPass(ctx, map, state, scene);
  drawDecalPass(ctx, map, state, scene, options);
  drawObjectPass(ctx, state, scene);

  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = ambientColor(biome);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  return canvas;
}

function loadImage(path) {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => resolve(null), { once: true });
    image.src = path;
  });
}

/** Carrega o manifesto e os sprites Blender; qualquer falha preserva o procedural. */
export async function loadBuildingArtAssets(manifestPath = '/assets/buildings/manifest.json') {
  if (typeof fetch === 'undefined') return Object.fromEntries(BUILDING_ART.entries());
  try {
    const response = await fetch(manifestPath);
    if (!response.ok) return Object.fromEntries(BUILDING_ART.entries());
    const manifest = await response.json();
    const slash = String(manifestPath).lastIndexOf('/');
    const basePath = slash >= 0 ? String(manifestPath).slice(0, slash) : '/assets/buildings';
    const entries = parseBuildingSpriteManifest(manifest, basePath);
    await Promise.all(entries.map(async (entry) => {
      const key = buildingSpriteKey(entry.biome, entry.family, entry.variant, entry.orientation);
      if (BUILDING_ART.has(key)) return;
      const image = await loadImage(entry.path);
      if (image) BUILDING_ART.set(key, Object.freeze({ ...entry, image }));
    }));
  } catch {
    // O renderer procedural e o fallback oficial para manifesto ausente/invalido.
  }
  return Object.fromEntries(BUILDING_ART.entries());
}

/** Carrega ruas e pontes opcionais; falhas individuais mantem o desenho procedural. */
export async function loadEnvironmentArtAssets(manifestPath = '/assets/environment/manifest.json') {
  if (typeof fetch === 'undefined') return Object.fromEntries(ENVIRONMENT_ART.entries());
  try {
    const response = await fetch(manifestPath);
    if (!response.ok) return Object.fromEntries(ENVIRONMENT_ART.entries());
    const manifest = await response.json();
    const slash = String(manifestPath).lastIndexOf('/');
    const basePath = slash >= 0 ? String(manifestPath).slice(0, slash) : '/assets/environment';
    const entries = parseEnvironmentSpriteManifest(manifest, basePath);
    await Promise.all(entries.map(async (entry) => {
      if (ENVIRONMENT_ART.has(entry.type)) return;
      const image = await loadImage(entry.path);
      if (image) ENVIRONMENT_ART.set(entry.type, Object.freeze({ ...entry, image }));
    }));
  } catch {
    // Ausencia do manifesto ou de Image/fetch mantem o renderer autocontido.
  }
  return Object.fromEntries(ENVIRONMENT_ART.entries());
}

/** Carrega props, predios e ambiente opcionais antes da primeira renderizacao do mapa. */
export async function loadArtAssets(
  basePath = '/assets/props',
  buildingManifestPath = '/assets/buildings/manifest.json',
  environmentManifestPath = '/assets/environment/manifest.json',
) {
  const entries = Object.entries(ART_MANIFEST);
  const props = Promise.all(entries.map(async ([key, originalPath]) => {
    if (ART.has(key)) return;
    const file = originalPath.slice(originalPath.lastIndexOf('/') + 1);
    const image = await loadImage(`${String(basePath).replace(/\/$/, '')}/${file}`);
    if (image) ART.set(key, image);
  }));
  await Promise.all([
    props,
    loadBuildingArtAssets(buildingManifestPath),
    loadEnvironmentArtAssets(environmentManifestPath),
  ]);
  return Object.fromEntries(ART.entries());
}

export class VillageRenderer {
  constructor(canvas) {
    if (!canvas) throw new TypeError('VillageRenderer requer um canvas visivel.');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.map = null;
    this.world = null;
    this.showZones = false;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.drag = null;
    this.frame = 0;
    this.dpr = 1;
    this.bindInput();
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    if (this.resizeObserver && canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  setMap(map) {
    this.map = map;
    this.world = renderVillageToCanvas(map, { showZones: this.showZones });
    this.builtBounds = computeBuiltBounds(map);
    this.center();
  }

  setShowZones(value) {
    const next = value === true;
    if (next === this.showZones) return;
    this.showZones = next;
    if (this.map) this.world = renderVillageToCanvas(this.map, { showZones: this.showZones });
    this.draw();
    if (typeof CustomEvent !== 'undefined') {
      this.canvas.dispatchEvent(new CustomEvent('zoneschange', { detail: { showZones: this.showZones } }));
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    this.canvas.width = Math.max(1, Math.round((rect.width || this.canvas.clientWidth || 1) * this.dpr));
    this.canvas.height = Math.max(1, Math.round((rect.height || this.canvas.clientHeight || 1) * this.dpr));
    this.draw();
  }

  viewport() { return { width: this.canvas.width / this.dpr, height: this.canvas.height / this.dpr }; }

  notifyCamera() {
    if (typeof CustomEvent !== 'undefined') this.canvas.dispatchEvent(new CustomEvent('camerachange', { detail: { ...this.camera } }));
  }

  clampCamera() {
    if (!this.world) return;
    const view = this.viewport();
    const worldWidth = this.world.width * this.camera.zoom;
    const worldHeight = this.world.height * this.camera.zoom;
    // Folga generosa: o enquadramento inicial mira o assentamento, que em mapas
    // costeiros fica longe do centro geometrico do mundo.
    const marginX = Math.min(view.width * .5, 420);
    const marginY = Math.min(view.height * .5, 340);
    this.camera.x = worldWidth <= view.width ? (view.width - worldWidth) / 2 : clamp(this.camera.x, view.width - worldWidth - marginX, marginX);
    this.camera.y = worldHeight <= view.height ? (view.height - worldHeight) / 2 : clamp(this.camera.y, view.height - worldHeight - marginY, marginY);
  }

  /** Enquadra o assentamento; passe { whole: true } para abranger o mapa inteiro. */
  center(options = {}) {
    if (!this.world) return;
    const view = this.viewport();
    const target = options.whole === true ? null : this.builtBounds;
    const width = target ? target.width : this.world.width;
    const height = target ? target.height : this.world.height;
    const centerX = target ? (target.minX + target.maxX) / 2 : this.world.width / 2;
    const centerY = target ? (target.minY + target.maxY) / 2 : this.world.height / 2;
    this.camera.zoom = clamp(Math.min((view.width - 32) / width, (view.height - 32) / height), .18, 3);
    this.camera.x = view.width / 2 - centerX * this.camera.zoom;
    this.camera.y = view.height / 2 - centerY * this.camera.zoom;
    this.clampCamera();
    this.notifyCamera();
    this.draw();
  }

  setZoom(nextZoom, focusX, focusY) {
    if (!this.world) return;
    const oldZoom = this.camera.zoom;
    const zoom = clamp(finite(nextZoom, oldZoom), .15, 5);
    const rect = this.canvas.getBoundingClientRect();
    const fx = finite(focusX, rect.width / 2);
    const fy = finite(focusY, rect.height / 2);
    const worldX = (fx - this.camera.x) / oldZoom;
    const worldY = (fy - this.camera.y) / oldZoom;
    this.camera.zoom = zoom;
    this.camera.x = fx - worldX * zoom;
    this.camera.y = fy - worldY * zoom;
    this.clampCamera();
    this.notifyCamera();
    this.draw();
  }

  bindInput() {
    this.onPointerDown = (event) => {
      this.canvas.setPointerCapture?.(event.pointerId);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cameraX: this.camera.x, cameraY: this.camera.y };
      this.canvas.classList?.add('dragging');
    };
    this.onPointerMove = (event) => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      this.camera.x = this.drag.cameraX + event.clientX - this.drag.x;
      this.camera.y = this.drag.cameraY + event.clientY - this.drag.y;
      this.clampCamera(); this.notifyCamera(); this.draw();
    };
    this.onPointerEnd = (event) => {
      if (this.drag?.id === event.pointerId) this.drag = null;
      this.canvas.classList?.remove('dragging');
    };
    this.onWheel = (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.setZoom(this.camera.zoom * (event.deltaY > 0 ? .86 : 1.16), event.clientX - rect.left, event.clientY - rect.top);
    };
    this.onKeyDown = (event) => {
      const amount = event.shiftKey ? 80 : 32;
      if (event.key === 'ArrowLeft') this.camera.x += amount;
      else if (event.key === 'ArrowRight') this.camera.x -= amount;
      else if (event.key === 'ArrowUp') this.camera.y += amount;
      else if (event.key === 'ArrowDown') this.camera.y -= amount;
      else if (event.key === '+' || event.key === '=') return this.setZoom(this.camera.zoom * 1.2);
      else if (event.key === '-') return this.setZoom(this.camera.zoom / 1.2);
      else if (event.key.toLowerCase() === 'z') return this.setShowZones(!this.showZones);
      else return;
      event.preventDefault(); this.clampCamera(); this.notifyCamera(); this.draw();
    };
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerEnd);
    this.canvas.addEventListener('pointercancel', this.onPointerEnd);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('keydown', this.onKeyDown);
  }

  draw() {
    if (this.frame || typeof requestAnimationFrame === 'undefined') return this.drawNow();
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.drawNow(); });
  }

  drawNow() {
    if (!this.ctx) return;
    const view = this.viewport();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = '#14271f';
    this.ctx.fillRect(0, 0, view.width, view.height);
    if (!this.world) return;
    this.ctx.save();
    this.ctx.translate(Math.round(this.camera.x), Math.round(this.camera.y));
    this.ctx.scale(this.camera.zoom, this.camera.zoom);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.world, 0, 0);
    this.ctx.restore();
  }

  exportCanvas(options = {}) {
    if (!this.map) throw new Error('Nenhum mapa foi definido para exportacao.');
    return renderVillageToCanvas(this.map, { showZones: this.showZones, ...options });
  }

  destroy() {
    this.resizeObserver?.disconnect();
    if (this.frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerEnd);
    this.canvas.removeEventListener('pointercancel', this.onPointerEnd);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
  }
}

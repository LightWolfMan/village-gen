import { coordinateHash, createRandom, hashString } from "./random.js";
import { findPath } from "./pathfinding.js";
import { addRoadPath, bridgeAxisAt, finalizeRoadTopology } from "./road-topology.js";
import { createUrbanPlan } from "./urbanism.js";
import { validateVillage } from "./validation.js";

export const DEFAULT_SETTINGS = Object.freeze({
  mapSize: 96,
  biome: "temperate",
  water: 0.35,
  rivers: false,
  layout: "organic",
  settlement: "village",
});

export const BIOMES = Object.freeze({
  temperate: Object.freeze({ label: "Campo temperado", shore: "sand", ground: "grass", grove: "forest", tree: "oak", moisture: 0.67 }),
  arid: Object.freeze({ label: "Sertão árido", shore: "sand", ground: "dry-grass", grove: "scrub", tree: "cactus", moisture: 0.78 }),
  snowy: Object.freeze({ label: "Planalto nevado", shore: "ice", ground: "snow", grove: "pine-forest", tree: "pine", moisture: 0.62 }),
  wetland: Object.freeze({ label: "Pântano", shore: "marsh", ground: "wet-grass", grove: "swamp-forest", tree: "willow", moisture: 0.55 }),
});

const SETTLEMENTS = Object.freeze({
  hamlet: { houses: [10, 18], services: ["inn", "shop"] },
  village: { houses: [25, 40], services: ["inn", "shop", "smithy", "hall"] },
  town: { houses: [55, 85], services: ["inn", "shop", "smithy", "hall", "chapel", "market", "mill", "tower"] },
});

/**
 * Raio aproximado, em tiles, da mancha construida de um assentamento. Serve
 * de referencia para o traçado: a malha em grade usava uma fracao fixa da
 * largura do mapa e chegava ao dobro da area realmente ocupada, o que produzia
 * quadras inteiras de rua deserta em volta da cidade.
 */
function builtRadius(settlementKey) {
  const settlement = SETTLEMENTS[settlementKey] ?? SETTLEMENTS.village;
  const buildings = (settlement.houses[0] + settlement.houses[1]) / 2 + settlement.services.length;
  // ~14 tiles por edificio somando recuo lateral e frente de rua; a mancha
  // cresce como um losango, cuja area e cerca de 2r².
  return Math.sqrt(buildings * 14 / 2);
}

const MAP_SIZES = [72, 96, 128];
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ZONE_LABELS = Object.freeze({
  residential: "Bairro residencial",
  commercial: "Bairro mercantil",
  craft: "Bairro dos oficios",
  civic: "Centro civico",
  agricultural: "Cintura agricola",
});
const TYPE_ZONES = Object.freeze({
  house: ["residential", "agricultural", "craft", "commercial"],
  inn: ["commercial"], shop: ["commercial"], market: ["commercial"],
  smithy: ["craft"], mill: ["craft", "agricultural"],
  hall: ["civic"], chapel: ["civic"], tower: ["civic"],
});
const BIOME_STYLES = Object.freeze({
  temperate: {
    residential: ["timber-frame", "stone-cottage", "wattle-cottage"], agricultural: ["farmstead", "timber-longhouse"],
    materials: ["timber", "plaster", "fieldstone"], roofs: ["thatch", "clay-tile", "wood-shingle"],
  },
  arid: {
    residential: ["adobe-courtyard", "sandstone-house", "mudbrick-house"], agricultural: ["desert-farmstead", "mudbrick-compound"],
    materials: ["adobe", "sandstone", "mudbrick"], roofs: ["flat-earth", "clay-tile", "reed-mat"],
  },
  snowy: {
    residential: ["alpine-chalet", "stone-lodge", "timber-cabin"], agricultural: ["snow-longhouse", "mountain-farmstead"],
    materials: ["pine-timber", "granite", "lime-plaster"], roofs: ["steep-slate", "steep-wood", "heavy-thatch"],
  },
  wetland: {
    residential: ["stilt-house", "reed-cottage", "raised-timber-house"], agricultural: ["marsh-farmstead", "raised-longhouse"],
    materials: ["timber", "wattle", "riverstone"], roofs: ["reed-thatch", "wood-shingle", "moss-thatch"],
  },
});
const SERVICE_ARCHITECTURES = Object.freeze({
  inn: ["coaching-inn", "gabled-tavern"], shop: ["merchant-house", "arcaded-shop"],
  smithy: ["forge-workshop", "stone-smithy"], hall: ["guildhall", "manor-hall"],
  chapel: ["parish-chapel", "stone-sanctuary"], market: ["covered-market", "trading-hall"],
  mill: ["water-mill", "post-mill"], tower: ["watchtower", "gate-tower"],
});
const keyOf = (x, y) => `${x},${y}`;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function normalizeSettings(input = {}) {
  let mapSize = MAP_SIZES.includes(Number(input.mapSize)) ? Number(input.mapSize) : DEFAULT_SETTINGS.mapSize;
  const biome = Object.hasOwn(BIOMES, input.biome) ? input.biome : DEFAULT_SETTINGS.biome;
  const waterNumber = Number(input.water);
  const water = Number.isFinite(waterNumber) ? clamp(waterNumber, 0, 1) : DEFAULT_SETTINGS.water;
  const layout = input.layout === "grid" ? "grid" : "organic";
  const settlement = Object.hasOwn(SETTLEMENTS, input.settlement) ? input.settlement : DEFAULT_SETTINGS.settlement;
  if (settlement === "town") mapSize = 128;
  return { mapSize, biome, water, rivers: input.rivers === true, layout, settlement };
}

function smooth(value) { return value * value * (3 - 2 * value); }

function valueNoise(seed, x, y, scale, salt) {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const sample = (sx, sy) => coordinateHash(seed, sx, sy, salt) / 4294967295;
  const a = sample(x0, y0) * (1 - tx) + sample(x0 + 1, y0) * tx;
  const b = sample(x0, y0 + 1) * (1 - tx) + sample(x0 + 1, y0 + 1) * tx;
  return a * (1 - ty) + b * ty;
}

function fractalNoise(seed, x, y, salt) {
  return valueNoise(seed, x, y, 36, salt) * 0.54
    + valueNoise(seed, x, y, 17, salt + 1) * 0.29
    + valueNoise(seed, x, y, 7, salt + 2) * 0.17;
}

// Afloramento rochoso e cume, nao plato. Com o limiar antigo (0.79) uma seed de
// relevo alto cobria 8% do mapa de pedra, o que so nao aparecia porque o tipo
// caia no fallback verde do renderer.
const ROCK_LINE = 0.83;

function createTerrain(seed, settings) {
  const width = settings.mapSize;
  const height = width;
  const terrain = new Array(width * height);
  const heightLevel = new Array(width * height);
  const biome = BIOMES[settings.biome];
  const waterLine = 0.28 + settings.water * 0.24;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const elevation = fractalNoise(seed, x, y, 11);
      const moisture = fractalNoise(seed, x, y, 31);
      const edgeDistance = Math.min(x, y, width - x - 1, height - y - 1);
      const edgeDrop = clamp(edgeDistance / 9, 0.72, 1);
      const adjusted = elevation * edgeDrop;
      if (adjusted < waterLine) {
        terrain[index] = "water";
        heightLevel[index] = 0;
      } else {
        heightLevel[index] = clamp(1 + Math.floor((adjusted - waterLine) / Math.max(0.001, 1 - waterLine) * 6), 1, 6);
        if (adjusted < waterLine + 0.035) terrain[index] = biome.shore;
        else if (moisture > biome.moisture && adjusted < 0.82) terrain[index] = biome.grove;
        else if (adjusted > ROCK_LINE) terrain[index] = settings.biome === "snowy" ? "snow-rock" : "rock";
        else terrain[index] = biome.ground;
      }
    }
  }
  pruneOrphanShore(terrain, width, height, biome);
  return { terrain, heightLevel, waterLine };
}

const SHORE_REACH = 2;

/**
 * A margem nasce de uma faixa de elevacao, entao um plato inteiro na altura
 * certa virava um risco reto de areia a dezenas de tiles da agua. Margem de
 * verdade precisa ter agua por perto; o resto volta a ser solo do bioma.
 */
function pruneOrphanShore(terrain, width, height, biome) {
  const orphans = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (terrain[y * width + x] !== biome.shore) continue;
      let nearWater = false;
      for (let dy = -SHORE_REACH; dy <= SHORE_REACH && !nearWater; dy += 1) {
        for (let dx = -SHORE_REACH; dx <= SHORE_REACH; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (terrain[ny * width + nx] === "water") { nearWater = true; break; }
        }
      }
      if (!nearWater) orphans.push(y * width + x);
    }
  }
  for (const index of orphans) terrain[index] = biome.ground;
}

function carveRiver(seed, map, random) {
  const horizontal = random.bool();
  const breadth = random.int(2, 3);
  const phase = random() * Math.PI * 2;
  const amplitude = Math.max(4, Math.floor(map.width * 0.08));
  for (let step = 0; step < (horizontal ? map.width : map.height); step += 1) {
    const base = Math.floor((horizontal ? map.height : map.width) * 0.31
      + Math.sin(step / 11 + phase) * amplitude
      + (valueNoise(seed, step, 0, 13, 77) - 0.5) * 5);
    for (let offset = -breadth; offset <= breadth; offset += 1) {
      const x = horizontal ? step : base + offset;
      const y = horizontal ? base + offset : step;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const index = y * map.width + x;
      map.terrain[index] = "water";
      map.heightLevel[index] = 0;
    }
  }
}

function flattenArea(map, x, y, width, height, level, terrainType) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const index = py * map.width + px;
      map.heightLevel[index] = level;
      if (map.terrain[index] === "water" || terrainType) map.terrain[index] = terrainType || BIOMES[map.settings.biome].ground;
    }
  }
}

const PLAZA_CANDIDATES = 24;
const PLAZA_MARGIN = 6;

/** Fracao de terra seca numa moldura em volta da praca candidata. */
function dryShareAround(map, x, y, size) {
  let dry = 0;
  let total = 0;
  for (let py = y - PLAZA_MARGIN; py < y + size + PLAZA_MARGIN; py += 1) {
    for (let px = x - PLAZA_MARGIN; px < x + size + PLAZA_MARGIN; px += 1) {
      if (px < 1 || py < 1 || px >= map.width - 1 || py >= map.height - 1) continue;
      total += 1;
      if (map.terrain[py * map.width + px] !== "water") dry += 1;
    }
  }
  return total ? dry / total : 0;
}

function choosePlaza(map, random, choice = 0) {
  const size = map.settings.settlement === "town" ? 7 : 5;
  // A cada retentativa a busca se abre: se a vizinhanca do centro nao comporta
  // o parcelamento, insistir nela com outro sorteio nao adianta.
  const jitter = Math.floor(map.width * 0.08 * (1 + choice * 0.7));
  const baseX = Math.floor(map.width / 2 - size / 2);
  const baseY = Math.floor(map.height / 2 - size / 2);
  // Antes bastava um sorteio: num pantano a praca ia parar numa ilhota de tres
  // por tres cercada de agua, ligada ao resto so por pontes. Agora varios
  // candidatos deterministicos disputam pela terra seca em volta, e `choice`
  // permite ao gerador tentar o proximo melhor quando o parcelamento nao fecha.
  const candidates = [];
  for (let attempt = 0; attempt < PLAZA_CANDIDATES; attempt += 1) {
    const candidateX = clamp(baseX + random.int(-jitter, jitter), PLAZA_MARGIN, map.width - size - PLAZA_MARGIN - 1);
    const candidateY = clamp(baseY + random.int(-jitter, jitter), PLAZA_MARGIN, map.height - size - PLAZA_MARGIN - 1);
    candidates.push({ x: candidateX, y: candidateY, score: dryShareAround(map, candidateX, candidateY, size) });
  }
  // Ordenacao estavel e sem desempate por coordenada: entre candidatos de mesma
  // pontuacao vale a ordem sorteada, senao as tentativas seguintes cairiam todas
  // no mesmo canto e repetiriam o mesmo parcelamento impossivel.
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates[Math.min(choice, candidates.length - 1)];
  const x = chosen.x;
  const y = chosen.y;
  const samples = [];
  for (let py = y - 2; py < y + size + 2; py += 1) {
    for (let px = x - 2; px < x + size + 2; px += 1) {
      const level = map.heightLevel[py * map.width + px];
      if (level > 0) samples.push(level);
    }
  }
  samples.sort((a, b) => a - b);
  const level = samples[Math.floor(samples.length / 2)] || 2;
  flattenArea(map, x - 2, y - 2, size + 4, size + 4, level, BIOMES[map.settings.biome].ground);
  return { x, y, width: size, height: size, level };
}

function roadCost(map, randomSeed) {
  return (x, y, previousX, previousY) => {
    const index = y * map.width + x;
    const previous = previousY * map.width + previousX;
    const waterCost = map.terrain[index] === "water" ? 4 : 0;
    const slope = Math.abs(map.heightLevel[index] - map.heightLevel[previous]) * 1.6;
    const variation = coordinateHash(randomSeed, x, y, 99) / 4294967295 * 0.6;
    return 1 + waterCost + slope + variation;
  };
}

function nearestDryRoadPoint(map, point) {
  if (map.terrain[point.y * map.width + point.x] !== "water") return point;
  for (let radius = 1; radius < Math.max(map.width, map.height); radius += 1) {
    for (let offset = -radius; offset <= radius; offset += 1) {
      const candidates = [
        { x: point.x + offset, y: point.y - radius }, { x: point.x + offset, y: point.y + radius },
        { x: point.x - radius, y: point.y + offset }, { x: point.x + radius, y: point.y + offset },
      ];
      for (const candidate of candidates) {
        if (candidate.x < 1 || candidate.y < 1 || candidate.x >= map.width - 1 || candidate.y >= map.height - 1) continue;
        if (map.terrain[candidate.y * map.width + candidate.x] !== "water") return candidate;
      }
    }
  }
  return point;
}

function routeRoad(map, roadMap, start, goal, cost, kind) {
  const safeStart = nearestDryRoadPoint(map, start);
  const safeGoal = nearestDryRoadPoint(map, goal);
  const reuseCost = (x, y, previousX, previousY) => cost(x, y, previousX, previousY) * (roadMap.has(keyOf(x, y)) ? 0.72 : 1);
  const path = findPath(map.width, map.height, safeStart, safeGoal, reuseCost, {
    isWater: (x, y) => map.terrain[y * map.width + x] === "water",
    bridgeAxisAt: (x, y) => bridgeAxisAt(roadMap, x, y),
    maxWaterRun: kind === "main" ? 14 : 8,
    turnPenalty: kind === "main" ? 1.1 : 1.6,
    heuristicWeight: kind === "main" ? 1.15 : 1.3,
  });
  addRoadPath(roadMap, path, kind, map);
}

function createOrganicRoads(map, random, roadMap) {
  const center = { x: map.plaza.x + Math.floor(map.plaza.width / 2), y: map.plaza.y + Math.floor(map.plaza.height / 2) };
  const margin = 1;
  const endpoints = [
    { x: margin, y: clamp(center.y + random.int(-15, 15), margin, map.height - 2) },
    { x: map.width - 2, y: clamp(center.y + random.int(-15, 15), margin, map.height - 2) },
    { x: clamp(center.x + random.int(-15, 15), margin, map.width - 2), y: margin },
    { x: clamp(center.x + random.int(-15, 15), margin, map.width - 2), y: map.height - 2 },
  ];
  const cost = roadCost(map, hashString(`${map.seed}:roads`));
  for (const endpoint of endpoints) {
    routeRoad(map, roadMap, center, endpoint, cost, "main");
  }
  const ringRadius = map.settings.settlement === "hamlet" ? 10 : map.settings.settlement === "town" ? 25 : 17;
  const anchors = [
    { x: clamp(center.x - ringRadius, 2, map.width - 3), y: center.y },
    { x: center.x, y: clamp(center.y - ringRadius, 2, map.height - 3) },
    { x: clamp(center.x + ringRadius, 2, map.width - 3), y: center.y },
    { x: center.x, y: clamp(center.y + ringRadius, 2, map.height - 3) },
  ];
  for (let index = 0; index < anchors.length; index += 1) {
    const start = anchors[index];
    const goal = anchors[(index + 1) % anchors.length];
    routeRoad(map, roadMap, start, goal, cost, "street");
    routeRoad(map, roadMap, center, start, cost, "street");
  }
  if (map.settings.settlement !== "hamlet") {
    // O anel externo e a principal fonte de frente de rua reta, que e a unica
    // superficie onde o parcelamento pode encostar um edificio. Aperta-lo
    // adensava o desenho, mas estrangulava seeds de pouca terra firme.
    const outer = Math.floor(ringRadius * (map.settings.settlement === "town" ? 1.55 : 1.45));
    const outerAnchors = [[-outer, -outer], [outer, -outer], [outer, outer], [-outer, outer]].map(([dx, dy]) => ({
      x: clamp(center.x + dx, 2, map.width - 3), y: clamp(center.y + dy, 2, map.height - 3),
    }));
    for (let index = 0; index < outerAnchors.length; index += 1) {
      const start = outerAnchors[index];
      const goal = outerAnchors[(index + 1) % 4];
      addLine(map, roadMap, start.x, start.y, goal.x, goal.y, "street");
      routeRoad(map, roadMap, anchors[index], outerAnchors[index], cost, "street");
    }
  }
}

function addLine(map, roadMap, x1, y1, x2, y2, kind) {
  const vertical = x1 === x2;
  const seed = hashString(`${map.seed}:line:${x1},${y1}:${x2},${y2}:${kind}`);
  const terrainCost = roadCost(map, seed);
  const constrainedCost = (x, y, previousX, previousY) => {
    const offset = vertical ? Math.abs(x - x1) : Math.abs(y - y1);
    return terrainCost(x, y, previousX, previousY) + offset * 1.25;
  };
  routeRoad(map, roadMap, { x: x1, y: y1 }, { x: x2, y: y2 }, constrainedCost, kind);
}

function createGridRoads(map, random, roadMap) {
  const centerX = map.plaza.x + Math.floor(map.plaza.width / 2);
  const centerY = map.plaza.y + Math.floor(map.plaza.height / 2);
  const spacing = random.int(7, 9);
  // Antes era uma fracao fixa da largura do mapa (0.34), o que numa cidade dava
  // quase o dobro da area ocupada e enchia o entorno de quadras desertas. O
  // fator nao desce mais que isto porque a grade e a fonte de frente de rua.
  const radius = Math.max(spacing * 2, Math.round(builtRadius(map.settings.settlement) * 1.3));
  map.gridSpec = { centerX, centerY, spacing, radius };
  addLine(map, roadMap, 1, centerY, map.width - 2, centerY, "main");
  addLine(map, roadMap, centerX, 1, centerX, map.height - 2, "main");
  for (let x = centerX - Math.floor(radius / spacing) * spacing; x <= centerX + radius; x += spacing) {
    if (x > 1 && x < map.width - 2) addLine(map, roadMap, x, centerY - radius, x, centerY + radius, "street");
  }
  for (let y = centerY - Math.floor(radius / spacing) * spacing; y <= centerY + radius; y += spacing) {
    if (y > 1 && y < map.height - 2) addLine(map, roadMap, centerX - radius, y, centerX + radius, y, "street");
  }
}

function smoothRoadHeights(map, roadMap) {
  // Two passes tame sharp terrain steps without raising bridge tiles out of water.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const key of roadMap.keys()) {
      const [x, y] = key.split(",").map(Number);
      const index = y * map.width + x;
      if (map.terrain[index] === "water") continue;
      const neighbors = DIRECTIONS.map(([dx, dy]) => map.heightLevel[(y + dy) * map.width + x + dx]).filter((level) => level > 0);
      if (!neighbors.length) continue;
      const average = Math.round(neighbors.reduce((sum, level) => sum + level, 0) / neighbors.length);
      map.heightLevel[index] = clamp(map.heightLevel[index], average - 1, average + 1);
    }
  }
}

function finalizeRoads(map, roadMap) { return finalizeRoadTopology(map, roadMap); }

function nearestRoadAnchor(map, target, used = new Set()) {
  let best = map.roads[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const road of map.roads) {
    if (used.has(keyOf(road.x, road.y))) continue;
    const distance = Math.abs(road.x - target.x) + Math.abs(road.y - target.y);
    if (distance < bestDistance) { best = road; bestDistance = distance; }
  }
  return { x: best?.x ?? target.x, y: best?.y ?? target.y };
}

function createZones(map) {
  const center = { x: map.plaza.x + Math.floor(map.plaza.width / 2), y: map.plaza.y + Math.floor(map.plaza.height / 2) };
  const radius = map.settings.settlement === "hamlet" ? 17 : map.settings.settlement === "town" ? 48 : 32;
  const targets = {
    civic: center,
    commercial: { x: center.x + Math.round(radius * 0.66), y: center.y - Math.round(radius * 0.08) },
    craft: { x: center.x - Math.round(radius * 0.68), y: center.y + Math.round(radius * 0.12) },
    agricultural: { x: center.x, y: center.y + Math.round(radius * 0.76) },
    residential: { x: center.x, y: center.y - Math.round(radius * 0.75) },
  };
  const types = ["civic", "commercial", "craft", "agricultural", "residential"];
  const usedAnchors = new Set();
  const anchors = {};
  for (const type of types) {
    anchors[type] = nearestRoadAnchor(map, targets[type], usedAnchors);
    usedAnchors.add(keyOf(anchors[type].x, anchors[type].y));
  }
  for (const anchor of Object.values(anchors)) {
    const index = anchor.y * map.width + anchor.x;
    if (map.terrain[index] === "water") {
      map.terrain[index] = BIOMES[map.settings.biome].ground;
      map.heightLevel[index] = map.plaza.level;
    }
  }
  const zoneMap = new Array(map.width * map.height).fill("none");
  const minimumX = clamp(center.x - radius, 1, map.width - 2);
  const maximumX = clamp(center.x + radius, 1, map.width - 2);
  const minimumY = clamp(center.y - radius, 1, map.height - 2);
  const maximumY = clamp(center.y + radius, 1, map.height - 2);
  const queue = [];
  const districtCore = map.settings.settlement === "hamlet" ? 6 : map.settings.settlement === "town" ? 9 : 8;
  for (const type of types.filter((item) => item !== "civic")) {
    const anchor = anchors[type];
    for (let y = anchor.y - districtCore; y <= anchor.y + districtCore; y += 1) {
      for (let x = anchor.x - districtCore; x <= anchor.x + districtCore; x += 1) {
        if (Math.abs(x - anchor.x) + Math.abs(y - anchor.y) > districtCore) continue;
        if (x < minimumX || x > maximumX || y < minimumY || y > maximumY) continue;
        const index = y * map.width + x;
        if (zoneMap[index] !== "none") continue;
        zoneMap[index] = type;
        queue.push({ x, y, type });
      }
    }
  }
  // Civic buildings need actual frontage outside the reserved plaza. Seeding a
  // compact connected civic core guarantees minimum parcel capacity before
  // the other districts expand around it.
  const civicRadius = map.settings.settlement === "hamlet" ? 8 : map.settings.settlement === "town" ? 18 : 14;
  for (let y = center.y - civicRadius; y <= center.y + civicRadius; y += 1) {
    for (let x = center.x - civicRadius; x <= center.x + civicRadius; x += 1) {
      if (Math.abs(x - center.x) + Math.abs(y - center.y) > civicRadius) continue;
      if (x < minimumX || x > maximumX || y < minimumY || y > maximumY) continue;
      const index = y * map.width + x;
      if (zoneMap[index] !== "none") continue;
      zoneMap[index] = "civic";
      queue.push({ x, y, type: "civic" });
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor];
    for (const [dx, dy] of DIRECTIONS) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (x < minimumX || x > maximumX || y < minimumY || y > maximumY) continue;
      const index = y * map.width + x;
      if (zoneMap[index] !== "none") continue;
      zoneMap[index] = cell.type;
      queue.push({ x, y, type: cell.type });
    }
  }
  // The plaza is always civic, irrespective of a Voronoi tie at its edge.
  for (let y = map.plaza.y; y < map.plaza.y + map.plaza.height; y += 1) {
    for (let x = map.plaza.x; x < map.plaza.x + map.plaza.width; x += 1) zoneMap[y * map.width + x] = "civic";
  }
  const zones = types.map((type) => {
    let minX = map.width; let minY = map.height; let maxX = -1; let maxY = -1; let cellCount = 0;
    for (let index = 0; index < zoneMap.length; index += 1) {
      if (zoneMap[index] !== type) continue;
      const x = index % map.width; const y = Math.floor(index / map.width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); cellCount += 1;
    }
    return { id: `zone-${type}`, type, label: ZONE_LABELS[type], anchor: anchors[type], cellCount, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, bridgeLinks: [] };
  });
  return { zoneMap, zones };
}

function finalizeZones(map) {
  const bridgeLinks = Object.fromEntries(map.zones.map((zone) => [zone.type, []]));
  for (const road of map.roads) {
    if (!road.bridge) continue;
    const index = road.y * map.width + road.x;
    const type = map.zoneMap[index];
    if (bridgeLinks[type]) bridgeLinks[type].push(index);
  }
  for (let index = 0; index < map.zoneMap.length; index += 1) if (map.terrain[index] === "water") map.zoneMap[index] = "none";
  // Remove isolated land fragments while treating same-zone bridge tiles as
  // connectors. Exporters therefore receive contiguous, buildable districts
  // and never classify open water as a lot.
  for (const zone of map.zones) {
    const anchorIndex = zone.anchor.y * map.width + zone.anchor.x;
    const traversable = new Set(bridgeLinks[zone.type]);
    for (const road of map.roads) traversable.add(road.y * map.width + road.x);
    for (let index = 0; index < map.zoneMap.length; index += 1) if (map.zoneMap[index] === zone.type) traversable.add(index);
    if (!traversable.has(anchorIndex)) continue;
    const reached = new Set([anchorIndex]);
    const queue = [anchorIndex];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]; const x = index % map.width; const y = Math.floor(index / map.width);
      for (const [dx, dy] of DIRECTIONS) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const next = ny * map.width + nx;
        if (traversable.has(next) && !reached.has(next)) { reached.add(next); queue.push(next); }
      }
    }
    for (const index of traversable) if (!reached.has(index) && map.zoneMap[index] === zone.type) map.zoneMap[index] = "none";
    bridgeLinks[zone.type] = bridgeLinks[zone.type].filter((index) => reached.has(index));
  }
  map.zones = map.zones.map((zone) => {
    let minX = map.width; let minY = map.height; let maxX = -1; let maxY = -1; let cellCount = 0;
    for (let index = 0; index < map.zoneMap.length; index += 1) {
      if (map.zoneMap[index] !== zone.type) continue;
      const x = index % map.width; const y = Math.floor(index / map.width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); cellCount += 1;
    }
    let anchor = zone.anchor;
    if (map.zoneMap[anchor.y * map.width + anchor.x] !== zone.type
      || map.roads.find((road) => road.x === anchor.x && road.y === anchor.y)?.bridge !== false) {
      const candidate = map.roads
        .filter((road) => !road.bridge && map.zoneMap[road.y * map.width + road.x] === zone.type)
        .sort((a, b) => (Math.abs(a.x - anchor.x) + Math.abs(a.y - anchor.y))
          - (Math.abs(b.x - anchor.x) + Math.abs(b.y - anchor.y)) || a.y - b.y || a.x - b.x)[0];
      if (candidate) anchor = { x: candidate.x, y: candidate.y };
    }
    return { ...zone, anchor, cellCount, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, bridgeLinks: bridgeLinks[zone.type] };
  });
}

function rectangleClear(map, reserved, x, y, width, height) {
  if (x < 2 || y < 2 || x + width >= map.width - 2 || y + height >= map.height - 2) return false;
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      // The access tile is always dry. A footprint may reclaim a few shoreline
      // tiles; flattenArea turns them into a compact, level foundation.
      if (reserved.has(keyOf(px, py))) return false;
    }
  }
  return true;
}

function reserveBuilding(reserved, building) {
  for (let y = building.y - 1; y <= building.y + building.height; y += 1) {
    for (let x = building.x - 1; x <= building.x + building.width; x += 1) reserved.add(keyOf(x, y));
  }
}

function candidateAtRoad(road, side, width, height) {
  if (side === 0) return { x: road.x - Math.floor(width / 2), y: road.y - height, door: { x: road.x, y: road.y }, orientation: "south" };
  if (side === 1) return { x: road.x - Math.floor(width / 2), y: road.y + 1, door: { x: road.x, y: road.y }, orientation: "north" };
  if (side === 2) return { x: road.x - width, y: road.y - Math.floor(height / 2), door: { x: road.x, y: road.y }, orientation: "east" };
  return { x: road.x + 1, y: road.y - Math.floor(height / 2), door: { x: road.x, y: road.y }, orientation: "west" };
}

function zoneForFootprint(map, candidate, width, height, allowedZones) {
  const centerX = candidate.x + Math.floor((width - 1) / 2);
  const centerY = candidate.y + Math.floor((height - 1) / 2);
  const zone = map.zoneMap[centerY * map.width + centerX];
  if (!allowedZones.includes(zone)) return null;
  let matching = 0;
  for (let y = candidate.y; y < candidate.y + height; y += 1) {
    for (let x = candidate.x; x < candidate.x + width; x += 1) if (map.zoneMap[y * map.width + x] === zone) matching += 1;
  }
  return matching >= Math.ceil(width * height * 0.6) ? zone : null;
}

function dimensionOptions(type, random) {
  if (type === "house") return [[random.int(2, 4), random.int(2, 3)], [3, 2], [2, 2]];
  const sizes = {
    inn: [[5, 4], [4, 3]], shop: [[4, 3], [3, 3]], smithy: [[4, 3], [3, 3]], hall: [[5, 4], [4, 4]],
    chapel: [[4, 5], [3, 4]], market: [[5, 4], [4, 3]], mill: [[4, 4], [3, 4]], tower: [[3, 3]],
  };
  return sizes[type] || [[3, 3]];
}

function buildingStyle(map, type, zone, random) {
  const biomeStyle = BIOME_STYLES[map.settings.biome];
  let archetypes;
  if (type === "house") {
    archetypes = zone === "craft"
      ? [...biomeStyle.residential, "artisan-house", "workshop-dwelling"]
      : zone === "commercial" ? [...biomeStyle.residential, "merchant-dwelling", "shop-house"] : [...biomeStyle[zone]];
    if (map.settings.settlement === "town" && zone === "residential") archetypes.push("urban-townhouse", "artisan-rowhouse");
    if (map.settings.settlement === "hamlet") archetypes.push(zone === "agricultural" ? "croft-farm" : "rural-cottage");
  } else archetypes = SERVICE_ARCHITECTURES[type];
  const materialPool = zone === "civic"
    ? [biomeStyle.materials[1], biomeStyle.materials[1], biomeStyle.materials[2]]
    : zone === "craft" ? [biomeStyle.materials[0], biomeStyle.materials[1]] : biomeStyle.materials;
  const maximumStoreys = map.settings.settlement === "town" ? 3 : map.settings.settlement === "village" ? 2 : 1;
  let storeys = type === "tower" ? 3 : type === "chapel" ? 2 : random.int(1, maximumStoreys);
  if (zone === "agricultural" && type === "house") storeys = 1;
  return {
    architecture: random.pick(archetypes),
    material: random.pick(materialPool),
    roof: random.pick(biomeStyle.roofs),
    storeys,
  };
}

function placeBuildings(map, random, roadMap) {
  const reserved = new Set();
  const usedDoors = new Set();
  // A building may touch its access road, but its footprint never replaces a
  // road tile (especially important where a bridge crosses reclaimed land).
  for (const key of roadMap.keys()) reserved.add(key);
  for (let y = map.plaza.y - 1; y <= map.plaza.y + map.plaza.height; y += 1) {
    for (let x = map.plaza.x - 1; x <= map.plaza.x + map.plaza.width; x += 1) reserved.add(keyOf(x, y));
  }
  const roads = map.roads.filter((road) => road.kind !== "plaza");
  const villageCenter = {
    x: map.plaza.x + (map.plaza.width - 1) / 2,
    y: map.plaza.y + (map.plaza.height - 1) / 2,
  };
  const settlement = SETTLEMENTS[map.settings.settlement];
  const houseTarget = random.int(...settlement.houses);
  const types = [...settlement.services, ...new Array(houseTarget).fill("house")];
  const buildings = [];
  for (const type of types) {
    let placed = false;
    const isHouse = type === "house";
    const dimensions = dimensionOptions(type, random);
    const allowedZones = TYPE_ZONES[type];
    // Enumerate every frontage exactly once. Random side sampling could miss a
    // valid final lot even after thousands of attempts on a crowded village.
    const spread = isHouse ? map.width * 0.18 : 3;
    const frontageCandidates = roads.flatMap((road) => [0, 1, 2, 3].map((side) => ({
      road,
      side,
      score: Math.hypot(road.x - villageCenter.x, road.y - villageCenter.y) + random() * spread,
    })));
    const frontages = [
      ...frontageCandidates.filter(({ side }) => side === 0 || side === 2).sort((a, b) => a.score - b.score),
      ...frontageCandidates.filter(({ side }) => side === 1 || side === 3).sort((a, b) => a.score - b.score),
    ];
    for (const [width, height] of dimensions) {
      for (const { road, side } of frontages) {
        if (placed) break;
        const candidate = candidateAtRoad(road, side, width, height);
        if (usedDoors.has(keyOf(candidate.door.x, candidate.door.y))) continue;
        if (!rectangleClear(map, reserved, candidate.x, candidate.y, width, height)) continue;
        const zone = zoneForFootprint(map, candidate, width, height, allowedZones);
        if (!zone) continue;
      const levels = [];
      for (let y = candidate.y; y < candidate.y + height; y += 1) for (let x = candidate.x; x < candidate.x + width; x += 1) {
        const level = map.heightLevel[y * map.width + x];
        if (level > 0) levels.push(level);
      }
      levels.sort((a, b) => a - b);
      const baseLevel = levels[Math.floor(levels.length / 2)] || map.plaza.level;
      flattenArea(map, candidate.x, candidate.y, width, height, baseLevel, BIOMES[map.settings.biome].ground);
      for (let y = candidate.y; y < candidate.y + height; y += 1) {
        for (let x = candidate.x; x < candidate.x + width; x += 1) map.zoneMap[y * map.width + x] = zone;
      }
      const doorIndex = candidate.door.y * map.width + candidate.door.x;
      if (map.terrain[doorIndex] === "water") {
        map.terrain[doorIndex] = BIOMES[map.settings.biome].ground;
        map.heightLevel[doorIndex] = baseLevel;
      }
      const style = buildingStyle(map, type, zone, random);
      const building = {
        id: `building-${buildings.length + 1}`,
        type, x: candidate.x, y: candidate.y, width, height,
        door: candidate.door, orientation: candidate.orientation,
        entranceVisible: candidate.orientation === "south" || candidate.orientation === "east",
        baseLevel, zone,
        ...style,
        variant: random.int(0, 5),
      };
      buildings.push(building);
      usedDoors.add(keyOf(building.door.x, building.door.y));
      reserveBuilding(reserved, building);
      placed = true;
      }
    }
    if (!placed) throw new Error(`Não foi possível posicionar ${type} ${buildings.length + 1}/${types.length} para a seed ${map.seed}`);
  }
  return { buildings, reserved };
}

function placeProps(map, random, reserved, roadMap, buildings) {
  const props = [];
  const propOccupied = new Map();
  const biome = BIOMES[map.settings.biome];
  const choices = [biome.tree, biome.tree, "rock", map.settings.biome === "wetland" ? "reeds" : "bush"];
  const desired = Math.floor(map.width * map.height / 95);
  const blocked = new Set(reserved);
  for (const key of roadMap.keys()) blocked.add(key);
  for (let y = map.plaza.y; y < map.plaza.y + map.plaza.height; y += 1) for (let x = map.plaza.x; x < map.plaza.x + map.plaza.width; x += 1) blocked.add(keyOf(x, y));

  const addSpecial = (type, anchor) => {
    let best;
    for (let y = 2; y < map.height - 2; y += 1) {
      for (let x = 2; x < map.width - 2; x += 1) {
        const key = keyOf(x, y);
        const index = y * map.width + x;
        if (blocked.has(key) || propOccupied.has(key) || map.terrain[index] === "water") continue;
        const score = Math.hypot(x - anchor.x, y - anchor.y) + random() * 0.35;
        if (!best || score < best.score) best = { x, y, index, score };
      }
    }
    if (!best) return;
    const prop = { id: `prop-${props.length + 1}`, type, x: best.x, y: best.y, level: map.heightLevel[best.index], variant: random.int(0, 5) };
    props.push(prop);
    propOccupied.set(keyOf(best.x, best.y), prop);
  };

  const plazaCenter = { x: map.plaza.x + map.plaza.width / 2, y: map.plaza.y + map.plaza.height / 2 };
  const inn = buildings.find((building) => building.type === "inn") ?? buildings[0];
  const house = buildings.find((building) => building.type === "house") ?? buildings.at(-1);
  addSpecial("well", plazaCenter);
  if (map.settings.settlement !== "hamlet") addSpecial("cart", inn?.door ?? plazaCenter);
  addSpecial("haystack", house?.door ?? plazaCenter);

  let attempts = 0;
  while (props.length < desired && attempts < desired * 30) {
    attempts += 1;
    const x = random.int(2, map.width - 3);
    const y = random.int(2, map.height - 3);
    const key = keyOf(x, y);
    const index = y * map.width + x;
    if (blocked.has(key) || map.terrain[index] === "water") continue;
    const type = random.pick(choices);
    const radius = type === "oak" || type === "pine" || type === "willow" ? 1 : 0;
    let collision = false;
    for (let py = y - radius; py <= y + radius && !collision; py += 1) {
      for (let px = x - radius; px <= x + radius; px += 1) if (propOccupied.has(keyOf(px, py))) { collision = true; break; }
    }
    if (collision) continue;
    const prop = { id: `prop-${props.length + 1}`, type, x, y, level: map.heightLevel[index], variant: random.int(0, 5) };
    props.push(prop);
    propOccupied.set(key, prop);
  }
  return props;
}

function terrainCounts(terrain) {
  const result = {};
  for (const type of terrain) result[type] = (result[type] || 0) + 1;
  return result;
}

const PLAZA_RETRIES = 4;

/**
 * A praca define o centro de todo o resto: vias, zonas e parcelamento saem
 * dela. Quando o parcelamento nao fecha, tentar o proximo melhor local de
 * praca custa uma geracao e resolve — e continua deterministico, porque a
 * ordem dos candidatos vem da propria seed. Antes, uma seed nessa situacao
 * simplesmente nao produzia mapa nenhum.
 */
export function generateVillage(seedInput = "", inputSettings = {}) {
  const seed = String(seedInput);
  const settings = normalizeSettings(inputSettings);
  let lastError;
  for (let plazaChoice = 0; plazaChoice < PLAZA_RETRIES; plazaChoice += 1) {
    try {
      return buildVillage(seed, settings, plazaChoice);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Parcelamento insuficiente")) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function buildVillage(seed, settings, plazaChoice) {
  const numericSeed = hashString(seed);
  const random = createRandom(`${seed}:v3`);
  const fields = createTerrain(numericSeed, settings);
  const map = {
    schemaVersion: 3,
    seed,
    settings,
    width: settings.mapSize,
    height: settings.mapSize,
    waterLine: fields.waterLine,
    terrain: fields.terrain,
    heightLevel: fields.heightLevel,
    roadTopology: settings.layout === "grid" ? "orthogonal-cardinal" : "organic-cardinal",
    gridSpec: null,
  };
  if (settings.rivers) carveRiver(numericSeed, map, random.fork("river"));
  map.plaza = choosePlaza(map, random.fork("plaza"), plazaChoice);
  const roadMap = new Map();
  for (let y = map.plaza.y; y < map.plaza.y + map.plaza.height; y += 1) {
    const row = [];
    for (let x = map.plaza.x; x < map.plaza.x + map.plaza.width; x += 1) row.push({ x, y });
    addRoadPath(roadMap, row, "plaza", map);
  }
  for (let x = map.plaza.x; x < map.plaza.x + map.plaza.width; x += 1) {
    const column = [];
    for (let y = map.plaza.y; y < map.plaza.y + map.plaza.height; y += 1) column.push({ x, y });
    addRoadPath(roadMap, column, "plaza", map);
  }
  if (settings.layout === "grid") createGridRoads(map, random.fork("grid"), roadMap);
  else createOrganicRoads(map, random.fork("organic"), roadMap);
  smoothRoadHeights(map, roadMap);
  let roadTopology = finalizeRoads(map, roadMap);
  map.roads = roadTopology.roads;
  map.bridgeSpans = roadTopology.bridgeSpans;
  const zoning = createZones(map);
  map.zoneMap = zoning.zoneMap;
  map.zones = zoning.zones;
  // Zone anchors may reclaim a single road tile from shallow water. Refresh
  // bridge metadata before extracting straight segments and their frontages.
  roadTopology = finalizeRoads(map, roadMap);
  map.roads = roadTopology.roads;
  map.bridgeSpans = roadTopology.bridgeSpans;
  const settlement = SETTLEMENTS[settings.settlement];
  const placement = createUrbanPlan(map, random.fork("urbanism"), {
    houseTarget: random.fork("population").int(...settlement.houses),
    services: settlement.services,
    style: (type, zone, styleRandom) => buildingStyle(map, type, zone, styleRandom),
    flatten: (x, y, width, height, level, zone) => {
      flattenArea(map, x, y, width, height, level, BIOMES[map.settings.biome].ground);
      for (let py = y; py < y + height; py += 1) {
        for (let px = x; px < x + width; px += 1) map.zoneMap[py * map.width + px] = zone;
      }
    },
  });
  map.roadSegments = placement.roadSegments;
  map.frontages = placement.frontages;
  map.lots = placement.lots;
  map.buildings = placement.buildings;
  finalizeZones(map);
  map.props = placeProps(map, random.fork("props"), placement.reserved, roadMap, placement.buildings);
  map.stats = {
    houses: map.buildings.filter((building) => building.type === "house").length,
    services: map.buildings.filter((building) => building.type !== "house").length,
    bridges: map.bridgeSpans.length,
    terrainCounts: terrainCounts(map.terrain),
    zoneCounts: Object.fromEntries(map.zones.map((zone) => [zone.type, zone.cellCount])),
  };
  map.validation = validateVillage(map);
  if (!map.validation.valid) throw new Error(`Mapa inválido para a seed ${seed}: ${map.validation.errors.join("; ")}`);
  return map;
}

export function terrainAt(map, x, y) {
  return x < 0 || y < 0 || x >= map.width || y >= map.height ? undefined : map.terrain[y * map.width + x];
}

export function heightAt(map, x, y) {
  return x < 0 || y < 0 || x >= map.width || y >= map.height ? undefined : map.heightLevel[y * map.width + x];
}

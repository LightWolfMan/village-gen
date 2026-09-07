import { coordinateHash, createRandom, hashString } from "./random.js";
import { findPath, MinHeap } from "./pathfinding.js";
import { addRoadPath, bridgeAxisAt, finalizeRoadTopology } from "./road-topology.js";
import { createUrbanPlan, HOUSE_QUOTAS } from "./urbanism.js";
import { validateVillage } from "./validation.js";
import { MODEL_CATALOG } from "../../assets/models/catalog.js";

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


const MAP_SIZES = [72, 96, 128];
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ZONE_LABELS = Object.freeze({
  residential: "Bairro residencial",
  commercial: "Bairro mercantil",
  craft: "Bairro dos oficios",
  civic: "Centro civico",
  agricultural: "Cintura agricola",
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
      // A broad settlement plateau supplies enough land for full geometry and
      // yards; the river is carved afterwards and remains an actual obstacle.
      const radial = Math.hypot(x - width / 2, y - height / 2) / (width * 0.5);
      const adjusted = Math.max(elevation * edgeDrop, waterLine + 0.13 - radial * 0.14);
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

function inCivicCampus(map, x, y) {
  const campus = map.civicCampus;
  return campus && x >= campus.x && x < campus.x + campus.width && y >= campus.y && y < campus.y + campus.height;
}

function reserveCivicCampus(map) {
  if (map.settings.settlement === "hamlet") return null;
  const size = map.settings.settlement === "town" ? 20 : 14;
  const candidates = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x = sx < 0 ? map.plaza.x - size - 3 : map.plaza.x + map.plaza.width + 3;
    const y = sy < 0 ? map.plaza.y - size - 3 : map.plaza.y + map.plaza.height + 3;
    if (x < 2 || y < 2 || x + size >= map.width - 2 || y + size >= map.height - 2) continue;
    let wet = 0, min = 7, max = 0;
    for (let py = y - 1; py <= y + size; py++) for (let px = x - 1; px <= x + size; px++) {
      const index = py * map.width + px;
      if (map.terrain[index] === "water") wet++;
      min = Math.min(min, map.heightLevel[index]); max = Math.max(max, map.heightLevel[index]);
    }
    candidates.push({ x, y, width: size, height: size, wet, slope: max - min });
  }
  candidates.sort((a, b) => a.wet - b.wet || a.slope - b.slope);
  const chosen = candidates[0];
  if (!chosen || chosen.wet) throw new Error(`Parcelamento insuficiente para campus cívico seco na seed ${map.seed}`);
  return { x: chosen.x, y: chosen.y, width: size, height: size };
}

function createCivicPerimeter(map, roadMap) {
  const c = map.civicCampus;
  if (!c) return;
  const left = c.x - 1, right = c.x + c.width, top = c.y - 1, bottom = c.y + c.height;
  for (const y of [top, bottom]) addRoadPath(roadMap, Array.from({ length: right - left + 1 }, (_, i) => ({ x: left + i, y })), "street", map);
  for (const x of [left, right]) addRoadPath(roadMap, Array.from({ length: bottom - top + 1 }, (_, i) => ({ x, y: top + i })), "street", map);
  const center = { x: map.plaza.x + Math.floor(map.plaza.width / 2), y: map.plaza.y + Math.floor(map.plaza.height / 2) };
  const corner = { x: Math.abs(center.x - left) < Math.abs(center.x - right) ? left : right,
    y: Math.abs(center.y - top) < Math.abs(center.y - bottom) ? top : bottom };
  routeRoad(map, roadMap, center, corner, roadCost(map, hashString(`${map.seed}:campus`)), "street");
}

function roadCost(map, randomSeed) {
  return (x, y, previousX, previousY) => {
    if (inCivicCampus(map, x, y)) return Infinity;
    const index = y * map.width + x;
    const previous = previousY * map.width + previousX;
    const waterCost = map.terrain[index] === "water" ? 4 : 0;
    const slope = Math.abs(map.heightLevel[index] - map.heightLevel[previous]) * 1.6;
    const variation = coordinateHash(randomSeed, x, y, 99) / 4294967295 * 0.6;
    return 1 + waterCost + slope + variation;
  };
}

function nearestDryRoadPoint(map, point) {
  if (map.terrain[point.y * map.width + point.x] !== "water" && !inCivicCampus(map, point.x, point.y)) return point;
  for (let radius = 1; radius < Math.max(map.width, map.height); radius += 1) {
    for (let offset = -radius; offset <= radius; offset += 1) {
      const candidates = [
        { x: point.x + offset, y: point.y - radius }, { x: point.x + offset, y: point.y + radius },
        { x: point.x - radius, y: point.y + offset }, { x: point.x + radius, y: point.y + offset },
      ];
      for (const candidate of candidates) {
        if (candidate.x < 1 || candidate.y < 1 || candidate.x >= map.width - 1 || candidate.y >= map.height - 1) continue;
        if (map.terrain[candidate.y * map.width + candidate.x] !== "water" && !inCivicCampus(map, candidate.x, candidate.y)) return candidate;
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
  // Full-sized 3D lots require feeder streets beyond the old sprite-era ring.
  const compactVillage = map.settings.settlement === 'village' && map.width === 72;
  const reach = compactVillage ? 33 : map.settings.settlement === "hamlet" ? 25 : map.settings.settlement === "town" ? 49 : 37;
  for (let offset = -reach + 1; offset < reach; offset += compactVillage ? 16 : 12) {
    if (compactVillage && offset === 0) continue;
    const jitter = random.int(-1, 1);
    const x = clamp(center.x + offset + jitter, 3, map.width - 4);
    const y = clamp(center.y + offset - jitter, 3, map.height - 4);
    addLine(map, roadMap, x, clamp(center.y - reach, 2, map.height - 3), x, clamp(center.y + reach, 2, map.height - 3), "street");
    addLine(map, roadMap, clamp(center.x - reach, 2, map.width - 3), y, clamp(center.x + reach, 2, map.width - 3), y, "street");
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
  const spacing = map.settings.settlement === 'village' && map.width === 72 ? 16 : random.int(12, 14);
  // Antes era uma fracao fixa da largura do mapa (0.34), o que numa cidade dava
  // quase o dobro da area ocupada e enchia o entorno de quadras desertas. O
  // fator nao desce mais que isto porque a grade e a fonte de frente de rua.
  const radius = map.settings.settlement === "hamlet" ? 27 : map.settings.settlement === "town" ? 50 : 38;
  map.gridSpec = { centerX, centerY, spacing, radius };
  addLine(map, roadMap, 1, centerY, map.width - 2, centerY, "main");
  addLine(map, roadMap, centerX, 1, centerX, map.height - 2, "main");
  for (let x = centerX - Math.floor(radius / spacing) * spacing; x <= centerX + radius; x += spacing) {
    if (x > 1 && x < map.width - 2) addLine(map, roadMap, x, clamp(centerY - radius, 2, map.height - 3), x, clamp(centerY + radius, 2, map.height - 3), "street");
  }
  for (let y = centerY - Math.floor(radius / spacing) * spacing; y <= centerY + radius; y += spacing) {
    if (y > 1 && y < map.height - 2) addLine(map, roadMap, clamp(centerX - radius, 2, map.width - 3), y, clamp(centerX + radius, 2, map.width - 3), y, "street");
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
    if (road.bridge || used.has(keyOf(road.x, road.y))) continue;
    let blocked = 0;
    for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) {
      const x = road.x + dx, y = road.y + dy;
      if (x < 1 || y < 1 || x >= map.width - 1 || y >= map.height - 1 || map.terrain[y * map.width + x] === "water") blocked++;
    }
    const distance = Math.abs(road.x - target.x) + Math.abs(road.y - target.y) + blocked * 1.5;
    if (distance < bestDistance) { best = road; bestDistance = distance; }
  }
  return { x: best?.x ?? target.x, y: best?.y ?? target.y };
}

function createZones(map) {
  const center = { x: map.plaza.x + Math.floor(map.plaza.width / 2), y: map.plaza.y + Math.floor(map.plaza.height / 2) };
  const radius = map.settings.settlement === "hamlet" ? 28 : map.settings.settlement === "town" ? 56 : 44;
  const anchorRadius = Math.min(radius, map.width * .3);
  const targets = {
    civic: center,
    commercial: { x: center.x + Math.round(anchorRadius * 0.66), y: center.y - Math.round(anchorRadius * 0.08) },
    craft: { x: center.x - Math.round(anchorRadius * 0.68), y: center.y + Math.round(anchorRadius * 0.12) },
    agricultural: { x: center.x, y: center.y + Math.round(anchorRadius * 0.76) },
    residential: { x: center.x, y: center.y - Math.round(anchorRadius * 0.75) },
  };
  if (map.settings.settlement === 'hamlet') targets.craft = { x: targets.commercial.x, y: targets.commercial.y + 10 };
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
  // Each source needs its own distance field: growth multipliers differ, so
  // losing at a junction does not imply losing farther along the same road.
  const costs = Object.fromEntries(types.map(type => [type, new Float64Array(zoneMap.length).fill(Infinity)]));
  const roadCells = new Set(map.roads.map(({ x, y }) => y * map.width + x));
  const frontier = new MinHeap();
  for (const type of types) {
    const anchor = anchors[type];
    const index = anchor.y * map.width + anchor.x;
    const initialCost = type === "civic" ? -3 : 0;
    costs[type][index] = initialCost;
    frontier.push({ index, type, score: initialCost });
  }
  const minimumX = clamp(center.x - radius, 1, map.width - 2);
  const maximumX = clamp(center.x + radius, 1, map.width - 2);
  const minimumY = clamp(center.y - radius, 1, map.height - 2);
  const maximumY = clamp(center.y + radius, 1, map.height - 2);
  // Multi-source terrain-weighted growth. Roads lower the walking cost, water
  // can only be crossed at an existing bridge, and steep slopes resist growth.
  const growth = { residential: 0.62, agricultural: 0.78, commercial: 0.95, craft: 0.85, civic: 1.25 };
  if (map.settings.settlement === "hamlet") { growth.agricultural = 0.65; growth.civic = 2.5; growth.craft = 1.4; }
  if (map.settings.settlement === "town") { growth.craft = 0.65; growth.commercial = 0.8; growth.residential = 0.7; }
  while (frontier.length) {
    const cell = frontier.pop();
    const field = costs[cell.type];
    if (cell.score !== field[cell.index]) continue;
    const cx = cell.index % map.width, cy = Math.floor(cell.index / map.width);
    for (const [dx, dy] of DIRECTIONS) {
      const x = cx + dx, y = cy + dy;
      if (x < minimumX || x > maximumX || y < minimumY || y > maximumY) continue;
      const index = y * map.width + x;
      if (map.terrain[index] === "water" && !roadCells.has(index)) continue;
      const step = (roadCells.has(index) ? 0.85 : 1.2) + Math.abs(map.heightLevel[index] - map.heightLevel[cell.index]) * 0.25;
      const score = cell.score + step * growth[cell.type];
      if (score >= field[index]) continue;
      field[index] = score;
      frontier.push({ index, type: cell.type, score });
    }
  }
  for (let index = 0; index < zoneMap.length; index++) {
    let best = Infinity;
    for (const type of types) {
      if (costs[type][index] < best) {
        best = costs[type][index];
        zoneMap[index] = type;
      }
    }
  }
  // Reserve the planned civic district as a whole before any lot is placed.
  if (map.civicCampus) {
    const c = map.civicCampus;
    for (let y = c.y - 1; y <= c.y + c.height; y++) for (let x = c.x - 1; x <= c.x + c.width; x++) zoneMap[y * map.width + x] = "civic";
  }
  // Existing roads delimit blocks. A small block receives one district before
  // parceling, rather than a weighted boundary slicing through every deep lot.
  const visitedBlocks = new Uint8Array(zoneMap.length);
  const districtBlocks = [];
  for (let y = minimumY; y <= maximumY; y++) for (let x = minimumX; x <= maximumX; x++) {
    const start = y * map.width + x;
    if (visitedBlocks[start] || roadCells.has(start) || map.terrain[start] === "water") continue;
    const cells = [start], counts = Object.fromEntries(types.map(type => [type, 0]));
    let campus = false;
    visitedBlocks[start] = 1;
    for (let cursor = 0; cursor < cells.length; cursor++) {
      const index = cells[cursor], cx = index % map.width, cy = Math.floor(index / map.width);
      if (Object.hasOwn(counts, zoneMap[index])) counts[zoneMap[index]]++;
      if (inCivicCampus(map, cx, cy)) campus = true;
      for (const [dx, dy] of DIRECTIONS) {
        const nx = cx + dx, ny = cy + dy, next = ny * map.width + nx;
        if (nx < minimumX || nx > maximumX || ny < minimumY || ny > maximumY
          || visitedBlocks[next] || roadCells.has(next) || map.terrain[next] === "water") continue;
        visitedBlocks[next] = 1; cells.push(next);
      }
    }
    if (cells.length > 350) continue;
    const winner = campus ? "civic" : types.reduce((best, type) => counts[type] > counts[best] ? type : best, types[0]);
    if (!campus && !counts[winner]) continue;
    for (const index of cells) zoneMap[index] = winner;
    if (winner !== "civic") {
      const distances = Object.fromEntries(types.map(type => [type, cells.reduce((sum, index) => sum + costs[type][index], 0) / cells.length]));
      districtBlocks.push({ cells, zone: winner, distances });
    }
  }
  // Correct only meaningful capacity deficits, moving whole pre-existing blocks
  // before buildings exist. House count alone understates farms and work yards.
  const functional = ["residential", "agricultural", "craft", "commercial"];
  const areas = Object.fromEntries(functional.map(type => [type, 0]));
  for (let index = 0; index < zoneMap.length; index++) {
    if (!roadCells.has(index) && map.terrain[index] !== "water" && Object.hasOwn(areas, zoneMap[index])) areas[zoneMap[index]]++;
  }
  const settlement = SETTLEMENTS[map.settings.settlement];
  const population = (settlement.houses[0] + settlement.houses[1]) / 2;
  const lotAreas = { residential: map.settings.settlement === "town" ? 42 : 30, agricultural: 60, craft: 56, commercial: 25 };
  const representative = Object.fromEntries(functional.map(type => {
    const family = { residential: map.settings.settlement === "town" ? "townhouse" : "cottage", agricultural: "farmstead", craft: "artisan", commercial: "merchant" }[type];
    const model = MODEL_CATALOG.filter(model => model.biome === map.settings.biome && model.family === family)
      .sort((a, b) => a.footprint.width * a.footprint.height - b.footprint.width * b.footprint.height)[0];
    const lateral = type === "commercial" ? 0 : 1, rear = { residential: 1, agricultural: 3, craft: 2, commercial: 0 }[type];
    return [type, [model.footprint.width + lateral * 2, model.footprint.height + rear]];
  }));
  for (const block of districtBlocks) {
    const cellSet = new Set(block.cells);
    const sortedCells = [...block.cells].sort((a, b) => a - b);
    block.capacity = {};
    for (const type of functional) {
      const [w, h] = representative[type];
      let best = 0;
      for (const [width, height] of [[w, h], [h, w]]) {
        const occupied = new Set(); let count = 0;
        for (const start of sortedCells) {
          if (occupied.has(start)) continue;
          const x = start % map.width, y = Math.floor(start / map.width);
          if (x + width > map.width || y + height > map.height) continue;
          let clear = true;
          for (let dy = 0; clear && dy < height; dy++) for (let dx = 0; dx < width; dx++) {
            const index = start + dy * map.width + dx;
            if (!cellSet.has(index) || occupied.has(index)) { clear = false; break; }
          }
          if (!clear) continue;
          for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) occupied.add(start + dy * map.width + dx);
          count++;
        }
        best = Math.max(best, count);
      }
      block.capacity[type] = best * w * h;
    }
    // Narrow river remnants contribute no fictitious agricultural capacity.
    areas[block.zone] += block.capacity[block.zone] - block.cells.length;
  }
  const required = Object.fromEntries(functional.map(type => [type, population * HOUSE_QUOTAS[map.settings.settlement][type] * lotAreas[type]]));
  for (const service of settlement.services) {
    if (["inn", "shop", "market"].includes(service)) required.commercial += service === "inn" ? 45 : service === "market" ? 40 : 25;
    if (["smithy", "mill"].includes(service)) required.craft += 56;
  }
  const available = Object.values(areas).reduce((sum, area) => sum + area, 0);
  const demand = Object.values(required).reduce((sum, area) => sum + area, 0);
  const areaTargets = Object.fromEntries(functional.map(type => [type, available * required[type] / demand]));
  for (let pass = 0; pass < districtBlocks.length; pass++) {
    const receiver = [...functional].sort((a, b) => areas[a] / areaTargets[a] - areas[b] / areaTargets[b])[0];
    if (areas[receiver] >= areaTargets[receiver] * .85) break;
    let chosen = null, bestScore = Infinity;
    for (const block of districtBlocks) {
      const donor = block.zone, size = block.capacity[donor], gain = block.capacity[receiver];
      if (!gain || donor === receiver || areas[donor] <= areaTargets[donor] * 1.05 || areas[donor] - size < areaTargets[donor] * .75) continue;
      const before = Math.abs(areas[receiver] - areaTargets[receiver]) + Math.abs(areas[donor] - areaTargets[donor]);
      const after = Math.abs(areas[receiver] + gain - areaTargets[receiver]) + Math.abs(areas[donor] - size - areaTargets[donor]);
      if (after >= before) continue;
      const score = (block.distances[receiver] - block.distances[donor]) / Math.max(1, before - after);
      if (score < bestScore) { bestScore = score; chosen = block; }
    }
    if (!chosen) break;
    areas[chosen.zone] -= chosen.capacity[chosen.zone]; areas[receiver] += chosen.capacity[receiver];
    chosen.zone = receiver;
    for (const index of chosen.cells) zoneMap[index] = receiver;
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


function reserveBuilding(reserved, building) {
  for (let y = building.y - 1; y <= building.y + building.height; y += 1) {
    for (let x = building.x - 1; x <= building.x + building.width; x += 1) reserved.add(keyOf(x, y));
  }
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


function placeProps(map, random, reserved, roadMap, buildings) {
  const props = [];
  const propOccupied = new Map();
  const biome = BIOMES[map.settings.biome];
  const choices = [biome.tree, biome.tree, "rock", map.settings.biome === "wetland" ? "reeds" : "bush"];
  const desired = Math.floor(map.width * map.height / 95);
  const blocked = new Set(reserved);
  for (const building of buildings) reserveBuilding(blocked, building);
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
  const random = createRandom(`${seed}:v4`);
  const fields = createTerrain(numericSeed, settings);
  const map = {
    schemaVersion: 4,
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
  map.civicCampus = reserveCivicCampus(map);
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
  createCivicPerimeter(map, roadMap);
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
  // Very small settlements cannot absorb an isolated workshop or dwelling:
  // one orphan already exceeds ten percent. Retry the settlement location.
  if (settings.settlement === 'hamlet') {
    const compatible = { residential: ['residential', 'commercial', 'civic'], commercial: ['residential', 'commercial', 'craft', 'civic'], craft: ['craft', 'commercial'], civic: ['civic', 'commercial', 'residential'] };
    const urban = map.buildings.filter((building) => building.zone !== 'agricultural');
    const clustered = urban.filter((building) => map.buildings.some((other) => other !== building && compatible[building.zone].includes(other.zone)
      && Math.hypot(Math.max(0, other.x - building.x - building.width, building.x - other.x - other.width),
        Math.max(0, other.y - building.y - building.height, building.y - other.y - other.height)) <= 8));
    if (clustered.length / urban.length < .9) throw new Error(`Parcelamento insuficiente para vizinhança funcional na seed ${seed}`);
  }
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

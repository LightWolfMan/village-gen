import { coordinateHash, createRandom, hashString } from "./random.js";
import { findTerrainPath } from "./pathfinding.js";
import { validateVillage } from "./validation.js";

export const DEFAULT_SETTINGS = Object.freeze({ size: 128, density: 1, water: 0.35, biome: "temperate", rivers: false });

// Presets de bioma. Cada um ajusta a linha d'água, quais terrenos aparecem e a
// mistura de decorações. Os tipos de terreno possíveis são:
// water, sand, grass, forest, dirt, snow, marsh.
export const BIOMES = Object.freeze({
  temperate: {
    label: "Campo temperado",
    waterBase: 0.19, waterSpan: 0.2,
    shore: "sand", ground: "grass",
    forestMoisture: 0.68, dryMoisture: -1, dry: "sand",
    rockLine: 0.86, groundFill: "grass",
    decoWeights: { tree: 5, bush: 3, rock: 1, flowers: 2, "grass-tuft": 3, haystack: 1, cart: 1 },
  },
  arid: {
    label: "Sertão árido",
    waterBase: 0.13, waterSpan: 0.14,
    shore: "sand", ground: "grass",
    forestMoisture: 0.86, dryMoisture: 0.42, dry: "sand",
    rockLine: 0.8, groundFill: "meadow",
    decoWeights: { rock: 4, cactus: 3, "dead-bush": 3, "grass-tuft": 2, tree: 1, haystack: 1 },
  },
  snowy: {
    label: "Planalto nevado",
    waterBase: 0.19, waterSpan: 0.2,
    shore: "snow", ground: "snow",
    forestMoisture: 0.6, dryMoisture: -1, dry: "snow",
    rockLine: 0.84, groundFill: "snow",
    decoWeights: { tree: 4, rock: 2, "dead-tree": 2, "grass-tuft": 1, snowman: 1 },
  },
  wetland: {
    label: "Pântano úmido",
    waterBase: 0.27, waterSpan: 0.24,
    shore: "marsh", ground: "grass",
    forestMoisture: 0.52, dryMoisture: -1, dry: "grass",
    rockLine: 0.9, groundFill: "grass",
    decoWeights: { tree: 4, reeds: 4, bush: 2, rock: 1, flowers: 1, "grass-tuft": 2 },
  },
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSettings(settings = {}) {
  const biome = Object.prototype.hasOwnProperty.call(BIOMES, settings.biome) ? settings.biome : DEFAULT_SETTINGS.biome;
  return {
    size: Math.round(clamp(finiteNumber(settings.size, DEFAULT_SETTINGS.size), 64, 192)),
    density: clamp(finiteNumber(settings.density, DEFAULT_SETTINGS.density), 0.65, 1.35),
    water: clamp(finiteNumber(settings.water, DEFAULT_SETTINGS.water), 0, 1),
    biome,
    rivers: settings.rivers === undefined ? DEFAULT_SETTINGS.rivers : Boolean(settings.rivers),
  };
}

function fade(value) {
  return value * value * (3 - 2 * value);
}

function valueNoise(seed, x, y, scale, salt) {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = fade(sx - x0);
  const ty = fade(sy - y0);
  const sample = (px, py) => coordinateHash(seed, px, py, salt) / 4294967295;
  const top = sample(x0, y0) * (1 - tx) + sample(x0 + 1, y0) * tx;
  const bottom = sample(x0, y0 + 1) * (1 - tx) + sample(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function classifyTerrain(e, m, waterLine, biome) {
  if (e < waterLine) return "water";
  const shoreLine = waterLine + 0.035;
  if (e < shoreLine) return biome.shore;
  if (e > biome.rockLine) return "dirt";
  if (m > biome.forestMoisture && e > shoreLine + 0.04) return "forest";
  if (m < biome.dryMoisture) return biome.dry;
  return biome.ground;
}

function makeTerrain(seed, width, height, waterAmount, biome) {
  const terrain = new Array(width * height);
  const elevation = new Array(width * height);
  const moisture = new Array(width * height);
  const waterLine = biome.waterBase + waterAmount * biome.waterSpan;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const broad = valueNoise(seed, x, y, 34, 1);
      const detail = valueNoise(seed, x, y, 11, 2);
      const wetBroad = valueNoise(seed, x, y, 29, 3);
      const wetDetail = valueNoise(seed, x, y, 9, 4);
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y) / 10;
      const e = Math.min(1, (broad * 0.72 + detail * 0.28) * Math.min(1, 0.62 + edge));
      const m = wetBroad * 0.7 + wetDetail * 0.3;
      elevation[index] = Math.round(e * 1000) / 1000;
      moisture[index] = Math.round(m * 1000) / 1000;
      terrain[index] = classifyTerrain(e, m, waterLine, biome);
    }
  }
  return { terrain, elevation, moisture, waterLine };
}

function addPlaza(terrain, width, plaza, roadSet) {
  for (let y = plaza.y - 2; y < plaza.y + plaza.height + 2; y += 1) {
    for (let x = plaza.x - 2; x < plaza.x + plaza.width + 2; x += 1) {
      terrain[y * width + x] = "grass";
      if (x >= plaza.x && x < plaza.x + plaza.width && y >= plaza.y && y < plaza.y + plaza.height) roadSet.add(`${x},${y}`);
    }
  }
}

function addPath(path, roadSet, terrain, width) {
  for (const point of path) {
    roadSet.add(`${point.x},${point.y}`);
    if (terrain[point.y * width + point.x] === "forest") terrain[point.y * width + point.x] = "grass";
  }
}

const LOT_DIRECTIONS = [
  { dx: 0, dy: -1, facing: "south" },
  { dx: 0, dy: 1, facing: "north" },
  { dx: -1, dy: 0, facing: "east" },
  { dx: 1, dy: 0, facing: "west" },
];

function buildingRectangle(door, direction, width, height) {
  if (direction.facing === "south") return { x: door.x - Math.floor(width / 2), y: door.y - height, width, height };
  if (direction.facing === "north") return { x: door.x - Math.floor(width / 2), y: door.y + 1, width, height };
  if (direction.facing === "east") return { x: door.x - width, y: door.y - Math.floor(height / 2), width, height };
  return { x: door.x + 1, y: door.y - Math.floor(height / 2), width, height };
}

function canPlace(rect, mapWidth, mapHeight, terrain, roadSet, occupied) {
  if (rect.x < 2 || rect.y < 2 || rect.x + rect.width >= mapWidth - 2 || rect.y + rect.height >= mapHeight - 2) return false;
  for (let y = rect.y - 1; y <= rect.y + rect.height; y += 1) {
    for (let x = rect.x - 1; x <= rect.x + rect.width; x += 1) {
      const key = `${x},${y}`;
      if (occupied.has(key)) return false;
      if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) {
        if (roadSet.has(key) || terrain[y * mapWidth + x] === "water") return false;
      }
    }
  }
  return true;
}

function occupy(rect, occupied) {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) occupied.add(`${x},${y}`);
  }
}

// Materiais de telhado/parede por tipo de edifício. As casas variam por instância.
const HOUSE_MATERIALS = ["thatch", "tile", "wood", "stone"];
const SERVICE_MATERIAL = {
  "town-hall": "stone", inn: "tile", shop: "wood", blacksmith: "stone",
  chapel: "stone", market: "wood", mill: "wood", watchtower: "stone",
};

// Serviços centrais (sempre tentados) e extras opcionais escolhidos por bioma/tamanho.
const CORE_SERVICES = [
  ["town-hall", 6, 5], ["inn", 6, 4], ["shop", 5, 4], ["blacksmith", 5, 4],
];
const EXTRA_SERVICES = {
  chapel: [4, 5], market: [5, 4], mill: [4, 4], watchtower: [3, 4],
};

function placeBuildings(rng, seedHash, width, height, terrain, roadSet, targetHouses, extraServices) {
  const roads = [...roadSet].map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });
  rng.shuffle(roads);
  const candidates = [];
  for (const door of roads) {
    const directions = rng.shuffle([...LOT_DIRECTIONS]);
    for (const direction of directions) candidates.push({ door, direction });
  }
  const buildings = [];
  const occupied = new Set();

  const placeType = (type, buildingWidth, buildingHeight) => {
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const rect = buildingRectangle(candidate.door, candidate.direction, buildingWidth, buildingHeight);
      if (!canPlace(rect, width, height, terrain, roadSet, occupied)) continue;
      occupy(rect, occupied);
      const variant = coordinateHash(seedHash, rect.x, rect.y, 7) % 4096;
      const material = type === "house" ? HOUSE_MATERIALS[variant % HOUSE_MATERIALS.length] : (SERVICE_MATERIAL[type] ?? "wood");
      buildings.push({
        id: `${type}-${buildings.length + 1}`,
        type,
        ...rect,
        door: { ...candidate.door },
        facing: candidate.direction.facing,
        variant,
        material,
      });
      candidates.splice(i, 1);
      return true;
    }
    return false;
  };

  for (const [type, buildingWidth, buildingHeight] of CORE_SERVICES) placeType(type, buildingWidth, buildingHeight);
  for (const type of extraServices) {
    const size = EXTRA_SERVICES[type];
    if (size) placeType(type, size[0], size[1]);
  }
  let houses = 0;
  while (houses < targetHouses) {
    const buildingWidth = rng.int(3, 4);
    const buildingHeight = rng.int(3, 4);
    if (!placeType("house", buildingWidth, buildingHeight)) break;
    houses += 1;
  }
  return buildings;
}

function weightedPick(rng, weights, allowed) {
  let total = 0;
  const pool = [];
  for (const type of allowed) {
    const weight = weights[type];
    if (weight > 0) { total += weight; pool.push([type, total]); }
  }
  if (!pool.length) return null;
  const roll = rng.next() * total;
  for (const [type, threshold] of pool) if (roll < threshold) return type;
  return pool[pool.length - 1][0];
}

// Quais decorações combinam com cada terreno (interseção com os pesos do bioma).
const TERRAIN_DECOS = {
  grass: ["tree", "bush", "rock", "flowers", "grass-tuft", "haystack", "cart", "dead-tree"],
  forest: ["tree", "bush", "rock", "flowers", "dead-tree"],
  sand: ["rock", "cactus", "dead-bush", "grass-tuft"],
  snow: ["tree", "rock", "dead-tree", "grass-tuft", "snowman"],
  dirt: ["rock", "dead-bush", "cart"],
  marsh: ["reeds", "bush", "grass-tuft", "tree"],
};

function makeDecorations(rng, width, height, terrain, roadSet, buildings, plaza, biome) {
  const blocked = new Set(roadSet);
  for (const building of buildings) {
    for (let y = building.y; y < building.y + building.height; y += 1) {
      for (let x = building.x; x < building.x + building.width; x += 1) blocked.add(`${x},${y}`);
    }
  }
  const decorations = [];
  const plazaRing = [];
  for (let x = plaza.x; x < plaza.x + plaza.width; x += 1) {
    plazaRing.push({ x, y: plaza.y - 1 }, { x, y: plaza.y + plaza.height });
  }
  for (let y = plaza.y; y < plaza.y + plaza.height; y += 1) {
    plazaRing.push({ x: plaza.x - 1, y }, { x: plaza.x + plaza.width, y });
  }
  rng.shuffle(plazaRing);
  const wellPosition = plazaRing.find(({ x, y }) => !blocked.has(`${x},${y}`) && terrain[y * width + x] !== "water");
  if (wellPosition) {
    decorations.push({ type: "well", ...wellPosition });
    blocked.add(`${wellPosition.x},${wellPosition.y}`);
  }

  const addRuralDetails = (type, count, attemptsPerItem) => {
    let added = 0;
    for (let attempt = 0; attempt < count * attemptsPerItem && added < count; attempt += 1) {
      const x = rng.int(3, width - 4);
      const y = rng.int(3, height - 4);
      const key = `${x},${y}`;
      if (blocked.has(key) || terrain[y * width + x] !== "grass") continue;
      decorations.push({ type, x, y });
      blocked.add(key);
      added += 1;
    }
  };
  addRuralDetails("garden_plot", rng.int(5, 9), 20);
  addRuralDetails("fence", rng.int(18, 28), 20);

  const nearWater = (x, y) => (
    terrain[y * width + (x - 1)] === "water" || terrain[y * width + (x + 1)] === "water" ||
    terrain[(y - 1) * width + x] === "water" || terrain[(y + 1) * width + x] === "water"
  );

  const desired = Math.round(width * height / 44);
  for (let attempt = 0; attempt < desired * 8 && decorations.length < desired; attempt += 1) {
    const x = rng.int(2, width - 3);
    const y = rng.int(2, height - 3);
    const key = `${x},${y}`;
    const ground = terrain[y * width + x];
    if (blocked.has(key) || ground === "water") continue;
    let allowed = TERRAIN_DECOS[ground] ?? TERRAIN_DECOS.grass;
    // Juncos crescem em terra que toca a água.
    if ((ground === "grass" || ground === "marsh") && nearWater(x, y)) allowed = [...allowed, "reeds"];
    let type = terrain[y * width + x] === "forest"
      ? (rng.next() < 0.82 ? "tree" : "bush")
      : weightedPick(rng, biome.decoWeights, allowed);
    if (!type) type = "grass-tuft";
    decorations.push({ type, x, y, variant: coordinateHash(0, x, y, 23) % 4096 });
    blocked.add(key);
  }
  return decorations;
}

export function generateVillage(seed = "", settings = {}) {
  const normalizedSeed = String(seed ?? "");
  const normalized = normalizeSettings(settings);
  const seedHash = hashString(normalizedSeed);
  const rng = createRandom(`${normalizedSeed}|${normalized.size}|${normalized.density}|${normalized.water}`);
  const biome = BIOMES[normalized.biome];
  const width = normalized.size;
  const height = normalized.size;
  const { terrain, elevation, moisture } = makeTerrain(seedHash, width, height, normalized.water, biome);
  const centerX = Math.floor(width / 2) + rng.int(-5, 5);
  const centerY = Math.floor(height / 2) + rng.int(-5, 5);
  if (normalized.rivers) carveRiver(rng, terrain, elevation, width, height, centerX, centerY);
  const plazaSize = rng.pick([5, 7, 7, 9]);
  const half = Math.floor(plazaSize / 2);
  const plaza = { x: centerX - half, y: centerY - half, width: plazaSize, height: plazaSize };
  const roadSet = new Set();
  addPlaza(terrain, width, plaza, roadSet);
  const hub = { x: centerX, y: centerY };
  const variation = (x, y) => coordinateHash(seedHash, x, y, 91) / 4294967295;
  const left = { x: 1, y: Math.max(5, Math.min(height - 6, centerY + rng.int(-14, 14))) };
  const right = { x: width - 2, y: Math.max(5, Math.min(height - 6, centerY + rng.int(-14, 14))) };
  addPath(findTerrainPath(width, height, terrain, left, hub, variation), roadSet, terrain, width);
  addPath(findTerrainPath(width, height, terrain, hub, right, variation), roadSet, terrain, width);

  const branchCount = Math.round(9 * normalized.density);
  for (let branch = 0; branch < branchCount; branch += 1) {
    const angle = (Math.PI * 2 * branch) / branchCount + rng.next() * 0.35;
    const distance = rng.int(Math.round(width * 0.2), Math.round(width * 0.39));
    const target = {
      x: Math.max(3, Math.min(width - 4, Math.round(centerX + Math.cos(angle) * distance))),
      y: Math.max(3, Math.min(height - 4, Math.round(centerY + Math.sin(angle) * distance))),
    };
    addPath(findTerrainPath(width, height, terrain, hub, target, variation), roadSet, terrain, width);
  }

  const servicePool = rng.shuffle(["chapel", "market", "mill", "watchtower"]);
  const extraCount = clamp(Math.round((width - 80) / 40) + rng.int(0, 1), 0, servicePool.length);
  const extraServices = servicePool.slice(0, extraCount);

  const targetHouses = Math.max(25, Math.min(40, Math.round(rng.int(28, 36) * normalized.density)));
  let buildings = placeBuildings(rng, seedHash, width, height, terrain, roadSet, targetHouses, extraServices);
  if (buildings.filter((building) => building.type === "house").length < targetHouses) {
    // Stable recovery: add four secondary spokes and retry the lot phase from scratch.
    for (let branch = 0; branch < 4; branch += 1) {
      const target = branch % 2 === 0
        ? { x: centerX + (branch === 0 ? -28 : 28), y: centerY + (branch === 0 ? -28 : 28) }
        : { x: centerX + (branch === 1 ? 28 : -28), y: centerY + (branch === 1 ? -28 : 28) };
      target.x = Math.max(3, Math.min(width - 4, target.x));
      target.y = Math.max(3, Math.min(height - 4, target.y));
      addPath(findTerrainPath(width, height, terrain, hub, target, variation), roadSet, terrain, width);
    }
    // A vila tem precedência sobre o bioma neste halo: esta regeneração local
    // preserva o restante do mapa e garante lotes secos ao redor das novas vias.
    for (const key of roadSet) {
      const [roadX, roadY] = key.split(",").map(Number);
      for (let dy = -6; dy <= 6; dy += 1) {
        for (let dx = -6; dx <= 6; dx += 1) {
          const x = roadX + dx;
          const y = roadY + dy;
          if (x > 1 && y > 1 && x < width - 2 && y < height - 2) terrain[y * width + x] = biome.ground;
        }
      }
    }
    buildings = placeBuildings(createRandom(`${normalizedSeed}|lots|retry`), seedHash, width, height, terrain, roadSet, targetHouses, extraServices);
  }
  const decorations = makeDecorations(rng, width, height, terrain, roadSet, buildings, plaza, biome);
  const roads = [...roadSet].map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const terrainCounts = {};
  for (const type of terrain) terrainCounts[type] = (terrainCounts[type] ?? 0) + 1;

  const map = {
    version: 1,
    seed: normalizedSeed,
    width,
    height,
    settings: normalized,
    biome: normalized.biome,
    biomeLabel: biome.label,
    terrain,
    elevation,
    moisture,
    plaza,
    roads,
    buildings,
    decorations,
    stats: {
      houses: buildings.filter((building) => building.type === "house").length,
      services: buildings.filter((building) => building.type !== "house").length,
      roadTiles: roads.length,
      trees: decorations.filter((item) => item.type === "tree").length,
      terrainCounts,
      generationMs: 0,
    },
  };
  map.validation = validateVillage(map);
  return map;
}

// Rio opcional: canal fino que desce da borda mais alta até tocar água ou a borda
// oposta, desviando do centro da praça. Edifícios já evitam água; estradas cruzam
// por cima (custo alto no A*), então a conectividade é preservada.
function carveRiver(rng, terrain, elevation, width, height, centerX, centerY) {
  const startEdge = rng.int(0, 3);
  let x = startEdge === 0 ? rng.int(6, width - 7) : startEdge === 1 ? width - 3 : startEdge === 2 ? rng.int(6, width - 7) : 2;
  let y = startEdge === 0 ? 2 : startEdge === 1 ? rng.int(6, height - 7) : startEdge === 2 ? height - 3 : rng.int(6, height - 7);
  let dx = startEdge === 1 ? -1 : startEdge === 3 ? 1 : 0;
  let dy = startEdge === 0 ? 1 : startEdge === 2 ? -1 : 0;
  const carve = (cx, cy, radius) => {
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue;
        if (Math.abs(nx - centerX) < 6 && Math.abs(ny - centerY) < 6) continue; // preserva a praça
        terrain[ny * width + nx] = "water";
      }
    }
  };
  const steps = width * 2;
  for (let i = 0; i < steps; i += 1) {
    carve(Math.round(x), Math.round(y), 0);
    if (i % 2 === 0) carve(Math.round(x), Math.round(y), 1);
    // meandro: pequeno desvio perpendicular guiado por ruído
    const wobble = (rng.next() - 0.5) * 1.3;
    x += dx + (dy !== 0 ? wobble : 0);
    y += dy + (dx !== 0 ? wobble : 0);
    x = clamp(x, 1, width - 2);
    y = clamp(y, 1, height - 2);
    if (x <= 1 || x >= width - 2 || y <= 1 || y >= height - 2) break;
  }
}

export function terrainAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.terrain[y * map.width + x];
}

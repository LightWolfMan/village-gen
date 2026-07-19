import { coordinateHash, createRandom, hashString } from "./random.js";
import { findPath } from "./pathfinding.js";
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

const MAP_SIZES = [72, 96, 128];
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
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
        else if (adjusted > 0.79) terrain[index] = settings.biome === "snowy" ? "snow-rock" : "rock";
        else terrain[index] = biome.ground;
      }
    }
  }
  return { terrain, heightLevel, waterLine };
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

function choosePlaza(map, random) {
  const size = map.settings.settlement === "town" ? 7 : 5;
  const jitter = Math.floor(map.width * 0.08);
  const x = Math.floor(map.width / 2 - size / 2) + random.int(-jitter, jitter);
  const y = Math.floor(map.height / 2 - size / 2) + random.int(-jitter, jitter);
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

function addRoad(roadMap, x, y, kind) {
  const key = keyOf(x, y);
  const priority = { street: 0, main: 1, plaza: 2 };
  if (!roadMap.has(key) || priority[kind] > priority[roadMap.get(key)]) roadMap.set(key, kind);
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
    for (const point of findPath(map.width, map.height, center, endpoint, cost)) addRoad(roadMap, point.x, point.y, "main");
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
    for (const point of findPath(map.width, map.height, start, goal, cost)) addRoad(roadMap, point.x, point.y, "street");
    for (const point of findPath(map.width, map.height, center, start, cost)) addRoad(roadMap, point.x, point.y, "street");
  }
  if (map.settings.settlement !== "hamlet") {
    const outer = Math.floor(ringRadius * (map.settings.settlement === "town" ? 1.55 : 1.45));
    const outerAnchors = [[-outer, -outer], [outer, -outer], [outer, outer], [-outer, outer]].map(([dx, dy]) => ({
      x: clamp(center.x + dx, 2, map.width - 3), y: clamp(center.y + dy, 2, map.height - 3),
    }));
    for (let index = 0; index < outerAnchors.length; index += 1) {
      const start = outerAnchors[index];
      const goal = outerAnchors[(index + 1) % 4];
      addLine(roadMap, start.x, start.y, goal.x, goal.y, "street");
      for (const point of findPath(map.width, map.height, anchors[index], outerAnchors[index], cost)) addRoad(roadMap, point.x, point.y, "street");
    }
  }
}

function addLine(roadMap, x1, y1, x2, y2, kind) {
  if (x1 === x2) for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) addRoad(roadMap, x1, y, kind);
  else for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) addRoad(roadMap, x, y1, kind);
}

function createGridRoads(map, random, roadMap) {
  const centerX = map.plaza.x + Math.floor(map.plaza.width / 2);
  const centerY = map.plaza.y + Math.floor(map.plaza.height / 2);
  const spacing = random.int(7, 9);
  const radius = Math.floor(map.width * (map.settings.settlement === "hamlet" ? 0.2 : 0.34));
  addLine(roadMap, 1, centerY, map.width - 2, centerY, "main");
  addLine(roadMap, centerX, 1, centerX, map.height - 2, "main");
  for (let x = centerX - Math.floor(radius / spacing) * spacing; x <= centerX + radius; x += spacing) {
    if (x > 1 && x < map.width - 2) addLine(roadMap, x, centerY - radius, x, centerY + radius, "street");
  }
  for (let y = centerY - Math.floor(radius / spacing) * spacing; y <= centerY + radius; y += spacing) {
    if (y > 1 && y < map.height - 2) addLine(roadMap, centerX - radius, y, centerX + radius, y, "street");
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

function finalizeRoads(map, roadMap) {
  return [...roadMap.entries()].map(([key, kind]) => {
    const [x, y] = key.split(",").map(Number);
    const bridge = map.terrain[y * map.width + x] === "water";
    let orientation = null;
    if (bridge) {
      const horizontal = roadMap.has(keyOf(x - 1, y)) || roadMap.has(keyOf(x + 1, y));
      const vertical = roadMap.has(keyOf(x, y - 1)) || roadMap.has(keyOf(x, y + 1));
      orientation = horizontal && vertical ? "cross" : horizontal ? "ew" : "ns";
    }
    return { x, y, kind, bridge, orientation };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
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

function placeBuildings(map, random, roadMap) {
  const reserved = new Set();
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
    const isHouse = type === "house";
    let placed = false;
    const preferred = isHouse ? [random.int(2, 3), random.int(2, 3)] : [random.int(3, 4), random.int(3, 4)];
    const dimensions = isHouse ? [preferred, [2, 2]] : [preferred, [3, 3]];
    // Enumerate every frontage exactly once. Random side sampling could miss a
    // valid final lot even after thousands of attempts on a crowded village.
    const spread = isHouse ? map.width * 0.18 : 3;
    const frontages = roads.flatMap((road) => [0, 1, 2, 3].map((side) => ({
      road,
      side,
      score: Math.hypot(road.x - villageCenter.x, road.y - villageCenter.y) + random() * spread,
    }))).sort((a, b) => a.score - b.score);
    for (const [width, height] of dimensions) {
      for (const { road, side } of frontages) {
        if (placed) break;
        const candidate = candidateAtRoad(road, side, width, height);
        if (!rectangleClear(map, reserved, candidate.x, candidate.y, width, height)) continue;
      const levels = [];
      for (let y = candidate.y; y < candidate.y + height; y += 1) for (let x = candidate.x; x < candidate.x + width; x += 1) {
        const level = map.heightLevel[y * map.width + x];
        if (level > 0) levels.push(level);
      }
      levels.sort((a, b) => a - b);
      const baseLevel = levels[Math.floor(levels.length / 2)] || map.plaza.level;
      flattenArea(map, candidate.x, candidate.y, width, height, baseLevel, BIOMES[map.settings.biome].ground);
      const doorIndex = candidate.door.y * map.width + candidate.door.x;
      if (map.terrain[doorIndex] === "water") {
        map.terrain[doorIndex] = BIOMES[map.settings.biome].ground;
        map.heightLevel[doorIndex] = baseLevel;
      }
      const building = {
        id: `building-${buildings.length + 1}`,
        type, x: candidate.x, y: candidate.y, width, height,
        door: candidate.door, orientation: candidate.orientation, baseLevel,
        storeys: type === "tower" ? 3 : type === "house" ? random.int(1, 2) : random.int(1, 2),
        material: random.pick(map.settings.biome === "arid" ? ["adobe", "stone"] : ["timber", "stone", "plaster"]),
        roof: random.pick(map.settings.biome === "snowy" ? ["slate", "wood"] : ["thatch", "tile", "wood"]),
        variant: random.int(0, 5),
      };
      buildings.push(building);
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

function countBridgeSpans(roads) {
  const remaining = new Set(roads.filter((road) => road.bridge).map((road) => keyOf(road.x, road.y)));
  let spans = 0;
  while (remaining.size) {
    spans += 1;
    const [start] = remaining;
    remaining.delete(start);
    const queue = [start];
    while (queue.length) {
      const [x, y] = queue.pop().split(",").map(Number);
      for (const [dx, dy] of DIRECTIONS) {
        const next = keyOf(x + dx, y + dy);
        if (!remaining.delete(next)) continue;
        queue.push(next);
      }
    }
  }
  return spans;
}

export function generateVillage(seedInput = "", inputSettings = {}) {
  const seed = String(seedInput);
  const settings = normalizeSettings(inputSettings);
  const numericSeed = hashString(seed);
  const random = createRandom(`${seed}:v2`);
  const fields = createTerrain(numericSeed, settings);
  const map = {
    schemaVersion: 1,
    seed,
    settings,
    width: settings.mapSize,
    height: settings.mapSize,
    waterLine: fields.waterLine,
    terrain: fields.terrain,
    heightLevel: fields.heightLevel,
  };
  if (settings.rivers) carveRiver(numericSeed, map, random.fork("river"));
  map.plaza = choosePlaza(map, random.fork("plaza"));
  const roadMap = new Map();
  for (let y = map.plaza.y; y < map.plaza.y + map.plaza.height; y += 1) {
    for (let x = map.plaza.x; x < map.plaza.x + map.plaza.width; x += 1) addRoad(roadMap, x, y, "plaza");
  }
  if (settings.layout === "grid") createGridRoads(map, random.fork("grid"), roadMap);
  else createOrganicRoads(map, random.fork("organic"), roadMap);
  smoothRoadHeights(map, roadMap);
  map.roads = finalizeRoads(map, roadMap);
  const placement = placeBuildings(map, random.fork("buildings"), roadMap);
  map.buildings = placement.buildings;
  // Coastal lots may reclaim their single access tile, so bridge metadata is
  // computed once more from the final terrain.
  map.roads = finalizeRoads(map, roadMap);
  map.props = placeProps(map, random.fork("props"), placement.reserved, roadMap, placement.buildings);
  map.stats = {
    houses: map.buildings.filter((building) => building.type === "house").length,
    services: map.buildings.filter((building) => building.type !== "house").length,
    bridges: countBridgeSpans(map.roads),
    terrainCounts: terrainCounts(map.terrain),
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

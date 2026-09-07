import { MODEL_CATALOG } from "../../assets/models/catalog.js";

const CARDINAL = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });
const OPPOSITE_STRAIGHT = Object.freeze({ ew: CARDINAL.E | CARDINAL.W, ns: CARDINAL.N | CARDINAL.S });
const HOUSE_QUOTAS = Object.freeze({
  hamlet: Object.freeze({ residential: 0.55, agricultural: 0.35, commercial: 0.05, craft: 0.05 }),
  village: Object.freeze({ residential: 0.58, agricultural: 0.17, commercial: 0.13, craft: 0.12 }),
  town: Object.freeze({ residential: 0.50, agricultural: 0.12, commercial: 0.20, craft: 0.18 }),
});
const SERVICE_ZONES = Object.freeze({
  inn: "commercial", shop: "commercial", market: "commercial",
  smithy: "craft", mill: "craft",
  hall: "civic", chapel: "civic", tower: "civic",
});
const keyOf = (x, y) => `${x},${y}`;

function roadMask(road, roadAt) {
  if (Number.isInteger(road.connections)) return road.connections;
  let result = 0;
  if (roadAt.has(keyOf(road.x, road.y - 1))) result |= CARDINAL.N;
  if (roadAt.has(keyOf(road.x + 1, road.y))) result |= CARDINAL.E;
  if (roadAt.has(keyOf(road.x, road.y + 1))) result |= CARDINAL.S;
  if (roadAt.has(keyOf(road.x - 1, road.y))) result |= CARDINAL.W;
  return result;
}

function extractRoadSegments(map) {
  const roadAt = new Map(map.roads.map((road, index) => [keyOf(road.x, road.y), { ...road, index }]));
  const distance = new Map();
  const queue = [...roadAt.values()].filter((road) => road.kind === "plaza");
  for (const road of queue) distance.set(keyOf(road.x, road.y), 0);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const road = queue[cursor];
    for (const [dx, dy, bit] of [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]) {
      if (!(road.connections & bit)) continue;
      const key = keyOf(road.x + dx, road.y + dy), next = roadAt.get(key);
      if (!next || distance.has(key)) continue;
      distance.set(key, distance.get(keyOf(road.x, road.y)) + 1);
      queue.push(next);
    }
  }
  const eligible = new Map();
  for (const road of roadAt.values()) {
    if (road.bridge || road.kind === "plaza") continue;
    const mask = roadMask(road, roadAt);
    if (mask === OPPOSITE_STRAIGHT.ew) eligible.set(keyOf(road.x, road.y), { ...road, axis: "ew" });
    else if (mask === OPPOSITE_STRAIGHT.ns) eligible.set(keyOf(road.x, road.y), { ...road, axis: "ns" });
  }

  const visited = new Set();
  const segments = [];
  const plazaCenter = {
    x: map.plaza.x + (map.plaza.width - 1) / 2,
    y: map.plaza.y + (map.plaza.height - 1) / 2,
  };
  for (const [key, first] of eligible) {
    if (visited.has(key)) continue;
    const step = first.axis === "ew" ? [1, 0] : [0, 1];
    let start = first;
    while (eligible.get(keyOf(start.x - step[0], start.y - step[1]))?.axis === first.axis) {
      start = eligible.get(keyOf(start.x - step[0], start.y - step[1]));
    }
    const cells = [];
    let cursor = start;
    while (cursor?.axis === first.axis) {
      visited.add(keyOf(cursor.x, cursor.y));
      cells.push(cursor);
      cursor = eligible.get(keyOf(cursor.x + step[0], cursor.y + step[1]));
    }
    if (!cells.length) continue;
    const id = `road-segment-${segments.length + 1}`;
    const segment = {
      id,
      axis: first.axis,
      kind: cells.some((road) => road.kind === "main") ? "main" : "street",
      roadIndexes: cells.map((road) => road.index),
      start: { x: cells[0].x, y: cells[0].y },
      end: { x: cells.at(-1).x, y: cells.at(-1).y },
      length: cells.length,
      distanceToPlaza: Math.min(...cells.map((road) => distance.get(keyOf(road.x, road.y)) ?? Math.abs(road.x - plazaCenter.x) + Math.abs(road.y - plazaCenter.y))),
    };
    segments.push(segment);
    for (const roadIndex of segment.roadIndexes) {
      const road = map.roads[roadIndex];
      if (!Array.isArray(road.segmentIds)) road.segmentIds = [];
      if (!road.segmentIds.includes(id)) road.segmentIds.push(id);
    }
  }
  return segments;
}

function frontageZoneAt(map, roadIndex, side) {
  const offsets = side === "north" ? [0, -2] : side === "south" ? [0, 2] : side === "west" ? [-2, 0] : [2, 0];
  const road = map.roads[roadIndex];
  const x = road.x + offsets[0];
  const y = road.y + offsets[1];
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return "none";
  return map.zoneMap[y * map.width + x] || "none";
}

function createFrontages(map, segments) {
  const frontages = [];
  for (const segment of segments) {
    const sides = segment.axis === "ew" ? ["north", "south"] : ["west", "east"];
    for (const side of sides) {
      let run = [];
      let runZone = "none";
      const flush = () => {
        if (!run.length || runZone === "none") { run = []; return; }
        frontages.push({
          id: `frontage-${frontages.length + 1}`,
          segmentId: segment.id,
          side,
          zone: runZone,
          roadIndexes: [...run],
          startOffset: segment.roadIndexes.indexOf(run[0]),
          length: run.length,
        });
        run = [];
      };
      for (const roadIndex of segment.roadIndexes) {
        const zone = frontageZoneAt(map, roadIndex, side);
        if (run.length && zone !== runZone) flush();
        runZone = zone;
        run.push(roadIndex);
      }
      flush();
    }
  }
  return frontages;
}

function allocateQuota(total, ratios) {
  const entries = Object.entries(ratios).map(([zone, ratio]) => {
    const exact = total * ratio;
    return { zone, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let missing = total - entries.reduce((sum, item) => sum + item.count, 0);
  entries.sort((a, b) => b.remainder - a.remainder || a.zone.localeCompare(b.zone));
  for (let index = 0; index < missing; index += 1) entries[index % entries.length].count += 1;
  return Object.fromEntries(entries.map(({ zone, count }) => [zone, count]));
}


function familyFor(type, zone, settlement) {
  if (type === "house") {
    if (zone === "agricultural") return "farmstead";
    if (zone === "commercial") return "merchant";
    if (zone === "craft") return "artisan";
    return settlement === "town" ? "townhouse" : "cottage";
  }
  if (["inn", "shop", "smithy", "market", "mill"].includes(type)) return type;
  if (type === "hall") return "civic";
  if (["chapel", "tower"].includes(type)) return type;
  return "workshop";
}

function candidateFromRoad(road, side, width, height) {
  if (side === "north") return { x: road.x - Math.floor(width / 2), y: road.y - height, door: { x: road.x, y: road.y }, orientation: "south" };
  if (side === "south") return { x: road.x - Math.floor(width / 2), y: road.y + 1, door: { x: road.x, y: road.y }, orientation: "north" };
  if (side === "west") return { x: road.x - width, y: road.y - Math.floor(height / 2), door: { x: road.x, y: road.y }, orientation: "east" };
  return { x: road.x + 1, y: road.y - Math.floor(height / 2), door: { x: road.x, y: road.y }, orientation: "west" };
}

function footprintClear(map, reserved, candidate, width, height, zone) {
  if (candidate.x < 1 || candidate.y < 1 || candidate.x + width >= map.width - 1 || candidate.y + height >= map.height - 1) return false;
  let matchingZone = 0;
  let minimumLevel = 7;
  let maximumLevel = 0;
  for (let y = candidate.y; y < candidate.y + height; y += 1) {
    for (let x = candidate.x; x < candidate.x + width; x += 1) {
      const index = y * map.width + x;
      if (reserved.has(keyOf(x, y)) || map.terrain[index] === "water" || map.heightLevel[index] <= 0) return false;
      if (map.zoneMap[index] === zone) matchingZone += 1;
      minimumLevel = Math.min(minimumLevel, map.heightLevel[index]);
      maximumLevel = Math.max(maximumLevel, map.heightLevel[index]);
    }
  }
  // The whole reserved lot must fit its pre-existing district and dry terrain.
  return matchingZone === width * height && maximumLevel - minimumLevel <= 2;
}


function lotGeometry(candidate, width, height, side, zone) {
  const lateral = zone === "commercial" ? 0 : zone === "civic" ? 2 : 1;
  const rear = { residential: 1, agricultural: 3, craft: 2, civic: 2, commercial: 0 }[zone];
  const leading = zone === 'civic' ? lateral : 0;
  let x = candidate.x, y = candidate.y, w = width, h = height;
  if (side === "north" || side === "south") {
    x -= leading; w += leading + lateral; h += rear;
    if (side === "north") y -= rear;
  } else {
    y -= leading; h += leading + lateral; w += rear;
    if (side === "west") x -= rear;
  }
  if (zone === "civic") {
    if (side === "north" || side === "south") { h += 2; if (side === "south") y -= 2; }
    else { w += 2; if (side === "east") x -= 2; }
  }
  const cells = [];
  return { cells, bounds: { x, y, width: w, height: h }, rearDepth: rear, lateralGap: lateral };
}

function modelEntrance(model, building) {
  const [mx, my, mz] = model.entrance;
  const angle = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 }[building.orientation];
  return { x: building.x + building.width / 2 + mx * Math.cos(angle) + mz * Math.sin(angle),
    y: building.y + building.height / 2 - mx * Math.sin(angle) + mz * Math.cos(angle),
    level: building.baseLevel + my / 0.25 };
}

function touchesResidentialSide(a, b) {
  if (a.zone !== 'residential') return false;
  if (a.orientation === 'north' || a.orientation === 'south') return a.y < b.y + b.height && b.y < a.y + a.height
    && (a.x + a.width === b.x || b.x + b.width === a.x);
  return a.x < b.x + b.width && b.x < a.x + a.width
    && (a.y + a.height === b.y || b.y + b.height === a.y);
}

function scoreCandidate(map, program, segment, road, candidate, buildings, orientationCounts) {
  const centerX = candidate.x + program.width / 2;
  const centerY = candidate.y + program.height / 2;
  const plazaX = map.plaza.x + map.plaza.width / 2;
  const plazaY = map.plaza.y + map.plaza.height / 2;
  const plazaDistance = Math.hypot(centerX - plazaX, centerY - plazaY);
  let score = plazaDistance * (program.zone === "agricultural" ? -0.18 : 0.12);
  if (program.zone === 'civic' && map.civicCampus) {
    const bounds = candidate.geometry.bounds, campus = map.civicCampus;
    const cornerDistance = Math.min(Math.abs(bounds.x - campus.x), Math.abs(bounds.x + bounds.width - campus.x - campus.width))
      + Math.min(Math.abs(bounds.y - campus.y), Math.abs(bounds.y + bounds.height - campus.y - campus.height));
    score += cornerDistance * 16;
  }
  if (program.zone === "commercial") score += segment.kind === "main" ? -18 : 8;
  if (program.zone === "residential") score += segment.kind === "street" ? -7 : 3;
  if (program.zone === "craft") score += segment.distanceToPlaza < 8 ? 12 : 0;
  if (program.zone === "agricultural") score += segment.distanceToPlaza < 14 ? 10 : 0;
  const compatibleZones = { residential: ['residential', 'commercial', 'civic'], commercial: ['residential', 'commercial', 'craft', 'civic'], craft: ['craft', 'commercial'], civic: ['civic', 'commercial', 'residential'], agricultural: ['agricultural'] };
  const compatible = buildings.filter((building) => compatibleZones[program.zone].includes(building.zone));
  if (compatible.length) {
    const nearest = Math.min(...compatible.map((building) => Math.hypot(
      Math.max(0, building.x - candidate.x - program.width, candidate.x - building.x - building.width),
      Math.max(0, building.y - candidate.y - program.height, candidate.y - building.y - building.height))));
    score += Math.abs(nearest - (program.zone === "agricultural" ? 4 : 1)) * 2;
    if (program.zone !== 'agricultural') score += Math.max(0, nearest - 8) * 12;
  }
  score += (orientationCounts[candidate.orientation] || 0) * 1.4;
  score += road.index * 1e-5;
  return score;
}


/**
 * Produces the serializable VillageMap v4 urban layer. Roads and zoneMap must
 * already exist. The caller owns terrain flattening and architecture styling.
 */
function createUrbanPlanAttempt(map, random, options = {}) {
  const segments = extractRoadSegments(map);
  const frontages = createFrontages(map, segments);
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const roadAt = new Map(map.roads.map((road) => [keyOf(road.x, road.y), road]));
  const reserved = new Set(map.roads.map((road) => keyOf(road.x, road.y)));
  for (let y = map.plaza.y - 1; y <= map.plaza.y + map.plaza.height; y += 1) {
    for (let x = map.plaza.x - 1; x <= map.plaza.x + map.plaza.width; x += 1) reserved.add(keyOf(x, y));
  }
  const usedDoors = new Set();
  const staticReserved = new Set(reserved);
  const staticCandidates = options.candidateCache || new Map();
  const occupiedCells = new Uint8Array(map.width * map.height);
  const buildings = [];
  const houseTarget = options.houseTarget;
  const quotas = allocateQuota(houseTarget, HOUSE_QUOTAS[map.settings.settlement]);
  const programs = (options.services || []).map((type) => ({ type, zone: SERVICE_ZONES[type] }));
  // Larger/deeper rural footprints are consumed before compact row houses;
  // this is the deterministic decreasing-footprint order used by the placer.
  for (const zone of ["agricultural", "commercial", "craft", "residential"]) {
    for (let count = 0; count < quotas[zone]; count += 1) programs.push({ type: "house", zone });
  }
  const orientationCounts = { north: 0, east: 0, south: 0, west: 0 };
  for (let index = 0; index < programs.length; index++) {
    const program = programs[index];
    const family = familyFor(program.type, program.zone, map.settings.settlement);
    const models = MODEL_CATALOG.filter((model) => model.biome === map.settings.biome && model.family === family);
    program.model = random.fork(`model:${index}`).pick(models);
    program.models = [program.model, ...models.filter((model) => model !== program.model).sort((a, b) => a.footprint.width * a.footprint.height - b.footprint.width * b.footprint.height)];
    if (options.compactModels && program.type === 'house') {
      program.models.sort((a, b) => a.footprint.width * a.footprint.height - b.footprint.width * b.footprint.height);
      program.model = program.models[0];
    }
    if (!program.model) throw new Error(`Modelo ausente: ${map.settings.biome}/${family}`);
  }
  programs.sort((a, b) => Number(a.type === "house") - Number(b.type === "house")
    || (a.type === "house" && b.type === "house" ? a.zone.localeCompare(b.zone) : 0)
    || b.model.footprint.width * b.model.footprint.height - a.model.footprint.width * a.model.footprint.height);

  // Frente de rua elegivel: reta, seca e fora da praca. Nada disso muda ao
  // longo da tentativa, entao vale resolver uma vez em vez de refazer a copia
  // do tile e a mascara de conexoes para cada programa e cada medida.
  const slots = [];
  for (const frontage of frontages) {
    const segment = segmentById.get(frontage.segmentId);
    if (!segment) continue;
    for (const roadIndex of frontage.roadIndexes) {
      const source = map.roads[roadIndex];
      if (!source || source.bridge || source.kind === "plaza") continue;
      if (roadMask(source, roadAt) !== OPPOSITE_STRAIGHT[segment.axis]) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const neighbor = roadAt.get(keyOf(source.x + dx, source.y + dy));
        return neighbor && (neighbor.bridge || neighbor.kind === "plaza" || ![5, 10].includes(neighbor.connections));
      })) continue;
      slots.push({ frontage, segment, road: { ...source, index: roadIndex } });
    }
  }

  const zoneCheckpoints = new Map();
  const zoneRetries = new Map();
  for (let programIndex = 0; programIndex < programs.length; programIndex += 1) {
    const program = programs[programIndex];
    if (program.type === "house" && !zoneCheckpoints.has(program.zone)) {
      zoneCheckpoints.set(program.zone, { index: programIndex, count: buildings.length,
        reserved: new Set(reserved), doors: new Set(usedDoors), orientationCounts: { ...orientationCounts },
        terrain: [...map.terrain], heights: [...map.heightLevel] });
    }
    let placed = false;
    for (const model of program.models) {
      const candidates = [];
      {
        for (const { frontage, segment, road } of slots) {
          if (frontage.zone !== program.zone) continue;
          const rotated = frontage.side === "west" || frontage.side === "east";
          const width = rotated ? model.footprint.height : model.footprint.width;
          const height = rotated ? model.footprint.width : model.footprint.height;
          const cacheKey = `${model.id}:${frontage.id}:${road.index}`;
          let candidate = staticCandidates.get(cacheKey);
          if (candidate === null) continue;
          if (!candidate) {
          candidate = candidateFromRoad(road, frontage.side, width, height);
          if (program.zone === "civic") {
            if (frontage.side === "north") candidate.y -= 2;
            if (frontage.side === "south") candidate.y += 2;
            if (frontage.side === "west") candidate.x -= 2;
            if (frontage.side === "east") candidate.x += 2;
          }
          candidate.geometry = lotGeometry(candidate, width, height, frontage.side, program.zone);
          const bounds = candidate.geometry.bounds;
          if (!footprintClear(map, staticReserved, bounds, bounds.width, bounds.height, program.zone)) { staticCandidates.set(cacheKey, null); continue; }
          candidate.cellIndexes = [];
          for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) candidate.cellIndexes.push(y * map.width + x);
          staticCandidates.set(cacheKey, candidate);
          }
          const geometry = candidate.geometry;
          if (usedDoors.has(`${keyOf(candidate.door.x, candidate.door.y)}:${candidate.orientation}`)) continue;
          if (candidate.cellIndexes.some((index) => occupiedCells[index])) continue;
          const footprint = { ...candidate, width, height, zone: program.zone };
          if (buildings.some((other) => touchesResidentialSide(footprint, other) || touchesResidentialSide(other, footprint))) continue;
          candidates.push({
            ...candidate, width, height, frontage, segment, road, geometry,
            score: scoreCandidate(map, { ...program, width, height }, segment, road, candidate, buildings, orientationCounts),
          });
        }
      }
      candidates.sort((a, b) => a.score - b.score || a.road.index - b.road.index || a.orientation.localeCompare(b.orientation));
      if (!candidates.length) continue;
      const selection = random.fork(`zone:${program.zone}:retry:${zoneRetries.get(program.zone) || 0}:program:${programIndex}`);
      const chosen = candidates[selection.int(0, Math.min(3, candidates.length - 1))];
      const { width, height } = chosen;
      chosen.geometry = { ...chosen.geometry, cells: [] };
      const bounds = chosen.geometry.bounds;
      for (let py = bounds.y; py < bounds.y + bounds.height; py++) for (let px = bounds.x; px < bounds.x + bounds.width; px++) chosen.geometry.cells.push({ x: px, y: py });
      const effectiveFrontage = chosen.frontage;
      const levels = [];
      for (let y = chosen.y; y < chosen.y + height; y += 1) for (let x = chosen.x; x < chosen.x + width; x += 1) levels.push(map.heightLevel[y * map.width + x]);
      levels.sort((a, b) => a - b);
      const baseLevel = levels[Math.floor(levels.length / 2)];
      options.flatten?.(chosen.x, chosen.y, width, height, baseLevel, program.zone);
      const style = options.style?.(program.type, program.zone, random.fork(`style:${programIndex}`)) || { architecture: familyFor(program.type, program.zone, map.settings.settlement), material: "timber", roof: "thatch", storeys: 1 };
      const spriteFamily = familyFor(program.type, program.zone, map.settings.settlement);
      const variant = model.variant;
      const building = {
        id: `building-${buildings.length + 1}`,
        type: program.type, x: chosen.x, y: chosen.y, width, height,
        door: chosen.door, orientation: chosen.orientation,
        entranceVisible: chosen.orientation === "south" || chosen.orientation === "east",
        baseLevel, zone: program.zone, ...style, spriteFamily, variant, assetId: model.id,
        lotId: null, frontageId: effectiveFrontage.id,
        accessRoadIndex: chosen.road.index,
      };
      building.entrance = modelEntrance(model, building);
      building.accessPath = [{ x: building.entrance.x, y: building.entrance.y }, { x: chosen.door.x + 0.5, y: chosen.door.y + 0.5 }];
      building.lotGeometry = chosen.geometry;
      buildings.push(building);
      orientationCounts[building.orientation] += 1;
      usedDoors.add(`${keyOf(building.door.x, building.door.y)}:${building.orientation}`);
      for (const cell of chosen.geometry.cells) reserved.add(keyOf(cell.x, cell.y));
      for (const index of chosen.cellIndexes) occupiedCells[index] = 1;
      placed = true;
      break;
    }
    if (!placed) {
      const checkpoint = zoneCheckpoints.get(program.zone);
      const retry = zoneRetries.get(program.zone) || 0;
      if (program.type === "house" && checkpoint && retry < 3) {
        zoneRetries.set(program.zone, retry + 1);
        buildings.length = checkpoint.count;
        reserved.clear(); for (const key of checkpoint.reserved) reserved.add(key);
        occupiedCells.fill(0);
        for (const key of reserved) { const [x, y] = key.split(",").map(Number); if (x >= 0 && y >= 0 && x < map.width && y < map.height) occupiedCells[y * map.width + x] = 1; }
        usedDoors.clear(); for (const key of checkpoint.doors) usedDoors.add(key);
        Object.assign(orientationCounts, checkpoint.orientationCounts);
        map.terrain.splice(0, map.terrain.length, ...checkpoint.terrain);
        map.heightLevel.splice(0, map.heightLevel.length, ...checkpoint.heights);
        programIndex = checkpoint.index - 1;
        continue;
      }
      const error = new Error(`Parcelamento insuficiente para ${program.type}/${program.zone} (${programIndex + 1}/${programs.length}) na seed ${map.seed}`);
      // Servicos sao colocados antes das casas e independem da meta de casas.
      // Se um deles nao coube, baixar a meta e repetir a escada inteira nao
      // muda nada — melhor devolver logo e deixar o gerador tentar outra praca.
      error.serviceFailure = program.type !== "house";
      error.details = { zoneCells: map.zoneMap.filter((zone) => zone === program.zone).length, slots: slots.filter(({ frontage }) => frontage.zone === program.zone).length, anchors: map.zones, model: program.model.footprint };
      throw error;
    }
  }

  const frontageById = new Map(frontages.map((frontage) => [frontage.id, frontage]));
  const lots = buildings.map((building, index) => {
    const frontage = frontageById.get(building.frontageId);
    const geometry = building.lotGeometry;
    delete building.lotGeometry;
    const lot = {
      id: `lot-${index + 1}`,
      frontageId: building.frontageId,
      zone: building.zone,
      cells: geometry.cells,
      bounds: geometry.bounds,
      rearDepth: geometry.rearDepth,
      lateralGap: geometry.lateralGap,
      side: frontage.side,
      roadIndex: building.accessRoadIndex,
      buildingId: building.id,
    };
    building.lotId = lot.id;
    return lot;
  });
  return { roadSegments: segments, frontages, lots, buildings, reserved, houseQuotas: quotas };
}

export function createUrbanPlan(map, random, options = {}) {
  const baselineTerrain = [...map.terrain];
  const baselineHeights = [...map.heightLevel];
  const baselineZones = [...map.zoneMap];
  const baselineSegmentIds = map.roads.map((road) => [...(road.segmentIds || [])]);
  let lastError;
  const minimumHouses = Math.min(options.houseTarget, { hamlet: 10, village: 25, town: 55 }[map.settings.settlement]);
  let run = 0;
  const candidateCache = new Map();
  // Each district already receives four local attempts; only the requested
  // population and the explicit public minimum need global packing attempts.
  const targets = [...new Set([options.houseTarget, minimumHouses])];
  for (const houseTarget of targets) {
    if (run > 0) {
      map.terrain.splice(0, map.terrain.length, ...baselineTerrain);
      map.heightLevel.splice(0, map.heightLevel.length, ...baselineHeights);
      map.zoneMap.splice(0, map.zoneMap.length, ...baselineZones);
      map.roads.forEach((road, index) => { road.segmentIds = [...baselineSegmentIds[index]]; });
    }
    run += 1;
    try {
      return createUrbanPlanAttempt(map, random.fork(`parcel-target:${houseTarget}:attempt:0`), { ...options, houseTarget, candidateCache, compactModels: houseTarget === minimumHouses && run > 1 });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Parcelamento insuficiente")) throw error;
      lastError = error;
      if (error.serviceFailure) throw error;
    }
  }
  throw lastError;
}

export { HOUSE_QUOTAS };

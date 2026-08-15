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
      distanceToPlaza: Math.min(...cells.map((road) => Math.abs(road.x - plazaCenter.x) + Math.abs(road.y - plazaCenter.y))),
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

function dimensionsFor(type, zone, random) {
  if (type !== "house") {
    // A ultima medida de cada lista e um recuo compacto, usado so quando nenhuma
    // das preferidas cabe. Como o placer para na primeira que encaixa, mapas que
    // ja fechavam continuam identicos; o recuo apenas evita que uma vila inteira
    // deixe de existir porque a hospedaria nao achou uma frente de 4x3.
    const serviceSizes = {
      inn: [[5, 4], [4, 3], [3, 3]], shop: [[4, 3], [3, 3], [3, 2]],
      smithy: [[4, 3], [3, 3], [3, 2]], hall: [[5, 4], [4, 4], [4, 3]],
      chapel: [[4, 5], [3, 4], [3, 3]], market: [[5, 4], [4, 3], [3, 3]],
      mill: [[4, 4], [3, 4], [3, 3]], tower: [[3, 3], [2, 2]],
    };
    return serviceSizes[type] || [[3, 3]];
  }
  if (zone === "agricultural") return random.bool() ? [[4, 3], [3, 3], [3, 2], [2, 2]] : [[3, 3], [4, 3], [3, 2], [2, 2]];
  if (zone === "commercial") return random.bool() ? [[4, 3], [3, 3], [3, 2], [2, 2]] : [[3, 3], [4, 3], [3, 2], [2, 2]];
  if (zone === "craft") return random.bool() ? [[4, 3], [3, 3], [3, 2], [2, 2]] : [[3, 3], [4, 3], [3, 2], [2, 2]];
  return random.bool()
    ? [[3, 2], [2, 3], [2, 2], [2, 1], [1, 2], [1, 1]]
    : [[2, 3], [3, 2], [2, 2], [1, 2], [2, 1], [1, 1]];
}

function familyFor(type, zone, settlement) {
  if (type === "house") {
    if (zone === "agricultural") return "farmstead";
    if (zone === "commercial") return "merchant";
    if (zone === "craft") return "artisan";
    return settlement === "town" ? "townhouse" : "cottage";
  }
  if (["inn", "shop", "smithy", "market", "mill"].includes(type)) return type;
  if (["hall", "chapel", "tower"].includes(type)) return "civic";
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
  // The weighted zone layer is a preference surface, not a cadastral wall.
  // The accepted footprint is assigned atomically to the program's district;
  // road connectivity keeps that local parcel regeneration connected even
  // when a narrow pre-zone ended on the opposite side of its frontage.
  return matchingZone >= 0 && maximumLevel - minimumLevel <= 2;
}

function reserveMargin(reserved, candidate, width, height, zone) {
  const margin = zone === "civic" ? 2 : 1;
  for (let y = candidate.y - margin; y < candidate.y + height + margin; y += 1) {
    for (let x = candidate.x - margin; x < candidate.x + width + margin; x += 1) reserved.add(keyOf(x, y));
  }
}

function scoreCandidate(map, program, segment, road, candidate, buildings, orientationCounts) {
  const centerX = candidate.x + program.width / 2;
  const centerY = candidate.y + program.height / 2;
  const plazaX = map.plaza.x + map.plaza.width / 2;
  const plazaY = map.plaza.y + map.plaza.height / 2;
  const plazaDistance = Math.hypot(centerX - plazaX, centerY - plazaY);
  let score = plazaDistance * (program.zone === "agricultural" ? -0.18 : 0.12);
  if (program.zone === "commercial") score += segment.kind === "main" ? -18 : 8;
  if (program.zone === "residential") score += segment.kind === "street" ? -7 : 3;
  if (program.zone === "craft") score += segment.distanceToPlaza < 8 ? 12 : 0;
  if (program.zone === "agricultural") score += segment.distanceToPlaza < 14 ? 10 : 0;
  const compatible = buildings.filter((building) => building.zone === program.zone);
  if (compatible.length) {
    const nearest = Math.min(...compatible.map((building) => Math.hypot(centerX - (building.x + building.width / 2), centerY - (building.y + building.height / 2))));
    score += Math.abs(nearest - (program.zone === "agricultural" ? 5 : 3)) * 1.6;
  }
  score += (orientationCounts[candidate.orientation] || 0) * 1.4;
  score += road.index * 1e-5;
  return score;
}

function growLot(map, building, frontage, occupiedLots, roadSet) {
  const cells = [];
  for (let y = building.y; y < building.y + building.height; y += 1) {
    for (let x = building.x; x < building.x + building.width; x += 1) {
      const key = keyOf(x, y);
      occupiedLots.add(key);
      cells.push({ x, y });
    }
  }
  const depth = building.zone === "agricultural" ? 3 : building.zone === "craft" ? 2 : building.zone === "residential" ? 1 : 0;
  const direction = frontage.side === "north" ? [0, -1] : frontage.side === "south" ? [0, 1] : frontage.side === "west" ? [-1, 0] : [1, 0];
  for (let step = 1; step <= depth; step += 1) {
    const edge = [];
    if (direction[0] === 0) {
      const y = direction[1] < 0 ? building.y - step : building.y + building.height - 1 + step;
      for (let x = building.x; x < building.x + building.width; x += 1) edge.push({ x, y });
    } else {
      const x = direction[0] < 0 ? building.x - step : building.x + building.width - 1 + step;
      for (let y = building.y; y < building.y + building.height; y += 1) edge.push({ x, y });
    }
    if (edge.some(({ x, y }) => x < 0 || y < 0 || x >= map.width || y >= map.height
      || map.terrain[y * map.width + x] === "water" || roadSet.has(keyOf(x, y))
      || occupiedLots.has(keyOf(x, y)) || map.zoneMap[y * map.width + x] !== building.zone)) break;
    for (const cell of edge) { occupiedLots.add(keyOf(cell.x, cell.y)); cells.push(cell); }
  }
  const xs = cells.map(({ x }) => x);
  const ys = cells.map(({ y }) => y);
  return {
    cells,
    bounds: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 },
  };
}

/**
 * Produces the serializable VillageMap v3 urban layer. Roads and zoneMap must
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
      slots.push({ frontage, segment, road: { ...source, index: roadIndex } });
    }
  }

  for (let programIndex = 0; programIndex < programs.length; programIndex += 1) {
    const program = programs[programIndex];
    let placed = false;
    for (const [width, height] of dimensionsFor(program.type, program.zone, random.fork(`dimensions:${programIndex}`))) {
      const candidates = [];
      {
        for (const { frontage, segment, road } of slots) {
          const candidate = candidateFromRoad(road, frontage.side, width, height);
          if (usedDoors.has(keyOf(candidate.door.x, candidate.door.y))) continue;
          if (!footprintClear(map, reserved, candidate, width, height, program.zone)) continue;
          candidates.push({
            ...candidate, width, height, frontage, segment, road,
            score: scoreCandidate(map, { ...program, width, height }, segment, road, candidate, buildings, orientationCounts),
          });
        }
      }
      candidates.sort((a, b) => a.score - b.score || a.road.index - b.road.index || a.orientation.localeCompare(b.orientation));
      if (!candidates.length) continue;
      const chosen = candidates[random.int(0, Math.min(3, candidates.length - 1))];
      let effectiveFrontage = chosen.frontage;
      if (effectiveFrontage.zone !== program.zone) {
        effectiveFrontage = {
          id: `frontage-${frontages.length + 1}`,
          segmentId: chosen.segment.id,
          side: chosen.frontage.side,
          zone: program.zone,
          roadIndexes: [chosen.road.index],
          startOffset: chosen.segment.roadIndexes.indexOf(chosen.road.index),
          length: 1,
        };
        frontages.push(effectiveFrontage);
      }
      const levels = [];
      for (let y = chosen.y; y < chosen.y + height; y += 1) for (let x = chosen.x; x < chosen.x + width; x += 1) levels.push(map.heightLevel[y * map.width + x]);
      levels.sort((a, b) => a - b);
      const baseLevel = levels[Math.floor(levels.length / 2)];
      options.flatten?.(chosen.x, chosen.y, width, height, baseLevel, program.zone);
      map.zoneMap[chosen.door.y * map.width + chosen.door.x] = program.zone;
      const style = options.style?.(program.type, program.zone, random.fork(`style:${programIndex}`)) || { architecture: familyFor(program.type, program.zone, map.settings.settlement), material: "timber", roof: "thatch", storeys: 1 };
      const spriteFamily = familyFor(program.type, program.zone, map.settings.settlement);
      const variant = random.fork(`variant:${programIndex}`).int(0, ["cottage", "townhouse", "merchant", "artisan"].includes(spriteFamily) ? 2 : 1);
      const building = {
        id: `building-${buildings.length + 1}`,
        type: program.type, x: chosen.x, y: chosen.y, width, height,
        door: chosen.door, orientation: chosen.orientation,
        entranceVisible: chosen.orientation === "south" || chosen.orientation === "east",
        baseLevel, zone: program.zone, ...style, spriteFamily, variant,
        lotId: null, frontageId: effectiveFrontage.id,
        accessRoadIndex: chosen.road.index,
      };
      buildings.push(building);
      orientationCounts[building.orientation] += 1;
      usedDoors.add(keyOf(building.door.x, building.door.y));
      reserveMargin(reserved, chosen, width, height, program.zone);
      placed = true;
      break;
    }
    if (!placed) {
      const error = new Error(`Parcelamento insuficiente para ${program.type}/${program.zone} (${programIndex + 1}/${programs.length}) na seed ${map.seed}`);
      // Servicos sao colocados antes das casas e independem da meta de casas.
      // Se um deles nao coube, baixar a meta e repetir a escada inteira nao
      // muda nada — melhor devolver logo e deixar o gerador tentar outra praca.
      error.serviceFailure = program.type !== "house";
      throw error;
    }
  }

  const occupiedLots = new Set();
  for (const building of buildings) {
    for (let y = building.y; y < building.y + building.height; y += 1) {
      for (let x = building.x; x < building.x + building.width; x += 1) occupiedLots.add(keyOf(x, y));
    }
  }
  const roadSet = new Set(map.roads.map((road) => keyOf(road.x, road.y)));
  const frontageById = new Map(frontages.map((frontage) => [frontage.id, frontage]));
  const lots = buildings.map((building, index) => {
    const frontage = frontageById.get(building.frontageId);
    const geometry = growLot(map, building, frontage, occupiedLots, roadSet);
    const lot = {
      id: `lot-${index + 1}`,
      frontageId: building.frontageId,
      zone: building.zone,
      cells: geometry.cells,
      bounds: geometry.bounds,
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
  // Passo de duas casas em vez de uma: a escada so e percorrida quando a
  // tentativa falha, e descer de um em um chegava a 64 parcelamentos completos
  // antes de desistir de uma seed dificil.
  for (let houseTarget = options.houseTarget; houseTarget >= minimumHouses; houseTarget -= 2) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (run > 0) {
      map.terrain.splice(0, map.terrain.length, ...baselineTerrain);
      map.heightLevel.splice(0, map.heightLevel.length, ...baselineHeights);
      map.zoneMap.splice(0, map.zoneMap.length, ...baselineZones);
      map.roads.forEach((road, index) => { road.segmentIds = [...baselineSegmentIds[index]]; });
      }
      run += 1;
      try {
        return createUrbanPlanAttempt(map, random.fork(`parcel-target:${houseTarget}:attempt:${attempt}`), { ...options, houseTarget });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("Parcelamento insuficiente")) throw error;
        lastError = error;
        if (error.serviceFailure) throw error;
      }
    }
  }
  throw lastError;
}

export { HOUSE_QUOTAS };

const keyOf = (x, y) => `${x},${y}`;
const HOUSE_RANGES = { hamlet: [10, 18], village: [25, 40], town: [55, 85] };
const ZONE_TYPES = ["residential", "commercial", "craft", "civic", "agricultural"];
const TYPE_ZONES = {
  house: ["residential", "agricultural", "craft", "commercial"],
  inn: ["commercial"], shop: ["commercial"], market: ["commercial"],
  smithy: ["craft"], mill: ["craft", "agricultural"],
  hall: ["civic"], chapel: ["civic"], tower: ["civic"],
};

function connectedRoads(map, roadSet, errors) {
  const start = map.roads.find((road) => road.kind === "plaza") || map.roads[0];
  if (!start) { errors.push("rede viária vazia"); return; }
  const reached = new Set([keyOf(start.x, start.y)]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const point = queue[cursor];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = keyOf(point.x + dx, point.y + dy);
      if (roadSet.has(key) && !reached.has(key)) {
        reached.add(key);
        queue.push({ x: point.x + dx, y: point.y + dy });
      }
    }
  }
  if (reached.size !== roadSet.size) errors.push(`rede viária desconectada: ${roadSet.size - reached.size} tiles`);
}

function validateBuildings(map, roadSet, roadByKey, errors) {
  const occupied = new Map();
  const expanded = new Map();
  const doorSet = new Set();
  for (const building of map.buildings) {
    if (building.x < 0 || building.y < 0 || building.x + building.width > map.width || building.y + building.height > map.height) {
      errors.push(`edifício ${building.id} fora do mapa`);
      continue;
    }
    const door = building.door;
    const doorValid = door && Number.isInteger(door.x) && Number.isInteger(door.y)
      && door.x >= 0 && door.y >= 0 && door.x < map.width && door.y < map.height;
    if (!doorValid) errors.push(`porta de ${building.id} fora do mapa`);
    else {
      const doorKey = keyOf(door.x, door.y);
      const road = roadByKey.get(doorKey);
      if (!road) errors.push(`porta de ${building.id} não acessa uma rua`);
      else if (road.bridge) errors.push(`porta de ${building.id} usa uma ponte`);
      if (map.terrain[door.y * map.width + door.x] === "water") errors.push(`porta de ${building.id} está na água`);
      const sideMatches = {
        north: door.y === building.y - 1 && door.x >= building.x && door.x < building.x + building.width,
        south: door.y === building.y + building.height && door.x >= building.x && door.x < building.x + building.width,
        west: door.x === building.x - 1 && door.y >= building.y && door.y < building.y + building.height,
        east: door.x === building.x + building.width && door.y >= building.y && door.y < building.y + building.height,
      };
      if (!sideMatches[building.orientation] || Object.values(sideMatches).filter(Boolean).length !== 1) errors.push(`porta de ${building.id} não corresponde à orientação`);
      const visible = building.orientation === "south" || building.orientation === "east";
      if (building.entranceVisible !== visible) errors.push(`visibilidade da entrada incorreta em ${building.id}`);
      if (doorSet.has(doorKey)) errors.push(`porta compartilhada em ${doorKey}`);
      doorSet.add(doorKey);
    }
    if (!TYPE_ZONES[building.type]?.includes(building.zone)) errors.push(`zona inadequada em ${building.id}: ${building.zone}`);
    if (typeof building.architecture !== "string" || !building.architecture.length) errors.push(`arquitetura ausente em ${building.id}`);
    const centerX = building.x + Math.floor((building.width - 1) / 2);
    const centerY = building.y + Math.floor((building.height - 1) / 2);
    if (!Array.isArray(map.zoneMap) || map.zoneMap[centerY * map.width + centerX] !== building.zone) errors.push(`zona do edifício ${building.id} diverge da camada`);
    let zoneCells = 0;
    for (let y = building.y; y < building.y + building.height; y += 1) {
      for (let x = building.x; x < building.x + building.width; x += 1) if (map.zoneMap?.[y * map.width + x] === building.zone) zoneCells += 1;
    }
    if (zoneCells < Math.ceil(building.width * building.height * 0.6)) errors.push(`footprint de ${building.id} fora da zona declarada`);
    for (let y = building.y; y < building.y + building.height; y += 1) {
      for (let x = building.x; x < building.x + building.width; x += 1) {
        const key = keyOf(x, y);
        if (occupied.has(key)) errors.push(`sobreposição entre ${building.id} e ${occupied.get(key)}`);
        occupied.set(key, building.id);
        if (map.terrain[y * map.width + x] === "water") errors.push(`${building.id} construído sobre água`);
        if (map.heightLevel[y * map.width + x] !== building.baseLevel) errors.push(`base desnivelada em ${building.id}`);
      }
    }
    for (let y = building.y - 1; y <= building.y + building.height; y += 1) {
      for (let x = building.x - 1; x <= building.x + building.width; x += 1) {
        const key = keyOf(x, y);
        if (expanded.has(key) && occupied.has(key) && expanded.get(key) !== building.id) errors.push(`margem insuficiente em ${building.id}`);
        expanded.set(key, building.id);
      }
    }
  }
  for (const building of map.buildings) {
    if (building.door && occupied.has(keyOf(building.door.x, building.door.y))) errors.push(`porta de ${building.id} está dentro de um footprint`);
  }
  return { expanded, doorSet };
}

function validateZones(map, errors) {
  if (!Array.isArray(map.zoneMap) || map.zoneMap.length !== map.width * map.height) {
    errors.push("camada de zoneamento incompleta");
    return;
  }
  const allowed = new Set(["none", ...ZONE_TYPES]);
  if (map.zoneMap.some((zone) => !allowed.has(zone))) errors.push("tipo de zona inválido na camada");
  if (!Array.isArray(map.zones)) { errors.push("metadados de zona ausentes"); return; }
  if (map.zones.length !== ZONE_TYPES.length) errors.push(`quantidade de zonas inválida: ${map.zones.length}`);
  const metadataTypes = new Set(map.zones.map((zone) => zone.type));
  const metadataIds = new Set(map.zones.map((zone) => zone.id));
  if (metadataTypes.size !== map.zones.length || metadataIds.size !== map.zones.length) errors.push("metadados de zona duplicados");
  const cellsByType = Object.fromEntries(ZONE_TYPES.map((type) => [type, []]));
  for (let index = 0; index < map.zoneMap.length; index += 1) {
    if (map.terrain[index] === "water" && map.zoneMap[index] !== "none") errors.push(`água zonificada no índice ${index}`);
    if (cellsByType[map.zoneMap[index]]) cellsByType[map.zoneMap[index]].push(index);
  }
  const terrestrialRoads = new Set(map.roads.filter((road) => !road.bridge).map((road) => keyOf(road.x, road.y)));
  for (const type of ZONE_TYPES) {
    if (!metadataTypes.has(type)) { errors.push(`metadados ausentes para zona ${type}`); continue; }
    const metadata = map.zones.find((zone) => zone.type === type);
    const cells = cellsByType[type];
    if (metadata.id !== `zone-${type}` || metadata.cellCount !== cells.length) errors.push(`metadados inconsistentes para zona ${type}`);
    if (typeof metadata.label !== "string" || !metadata.label.length) errors.push(`label ausente para zona ${type}`);
    if (!cells.length) { errors.push(`zona ${type} vazia`); continue; }
    const xs = cells.map((index) => index % map.width);
    const ys = cells.map((index) => Math.floor(index / map.width));
    const expectedBounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
    if (!metadata.bounds || Object.keys(expectedBounds).some((key) => metadata.bounds[key] !== expectedBounds[key])) errors.push(`bounds inconsistentes para zona ${type}`);
    if (!metadata.anchor || !Number.isInteger(metadata.anchor.x) || !Number.isInteger(metadata.anchor.y)
      || metadata.anchor.x < 0 || metadata.anchor.y < 0 || metadata.anchor.x >= map.width || metadata.anchor.y >= map.height) errors.push(`anchor inválido para zona ${type}`);
    else {
      if (map.zoneMap[metadata.anchor.y * map.width + metadata.anchor.x] !== type) errors.push(`anchor fora da zona ${type}`);
      if (!terrestrialRoads.has(keyOf(metadata.anchor.x, metadata.anchor.y))) errors.push(`anchor da zona ${type} sem rua terrestre`);
    }
    if (!Array.isArray(metadata.bridgeLinks) || new Set(metadata.bridgeLinks).size !== metadata.bridgeLinks.length) errors.push(`bridgeLinks inválidos para zona ${type}`);
    const links = Array.isArray(metadata.bridgeLinks) ? metadata.bridgeLinks : [];
    for (const index of links) {
      const road = map.roads.find(({ x, y }) => y * map.width + x === index);
      if (!road?.bridge || map.terrain[index] !== "water" || map.zoneMap[index] !== "none") errors.push(`bridgeLink inválido para zona ${type}`);
    }
    // District parcels are functionally contiguous through the connected road
    // network; water itself remains unzoned and bridge tiles are explicit links.
    const roadConnectors = map.roads.map(({ x, y }) => y * map.width + x);
    const remaining = new Set([...cells, ...links, ...roadConnectors]);
    const start = cells[0];
    remaining.delete(start);
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      const x = index % map.width; const y = Math.floor(index / map.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const next = ny * map.width + nx;
        if (remaining.delete(next)) queue.push(next);
      }
    }
    const disconnectedCells = [...remaining].filter((index) => map.zoneMap[index] === type).length;
    if (disconnectedCells) errors.push(`zona ${type} desconectada: ${disconnectedCells} tiles`);
  }
  for (let y = map.plaza.y; y < map.plaza.y + map.plaza.height; y += 1) {
    for (let x = map.plaza.x; x < map.plaza.x + map.plaza.width; x += 1) if (map.zoneMap[y * map.width + x] !== "civic") errors.push("praça fora da zona cívica");
  }
  if (map.stats?.zoneCounts) {
    for (const type of ZONE_TYPES) if (map.stats.zoneCounts[type] !== cellsByType[type].length) errors.push(`estatística divergente para zona ${type}`);
  }
}

function validateProps(map, roadSet, buildingMargin, doorSet, errors) {
  const trees = [];
  const treeTypes = new Set(["oak", "pine", "willow"]);
  const occupied = new Set();
  for (const prop of map.props) {
    const key = keyOf(prop.x, prop.y);
    if (prop.x < 0 || prop.y < 0 || prop.x >= map.width || prop.y >= map.height) errors.push(`prop ${prop.id} fora do mapa`);
    if (roadSet.has(key) || buildingMargin.has(key)) errors.push(`prop ${prop.id} ocupa rua ou margem de edifício`);
    if (doorSet.has(key)) errors.push(`prop ${prop.id} ocupa uma porta`);
    if (map.terrain[prop.y * map.width + prop.x] === "water") errors.push(`prop ${prop.id} sobre água`);
    if (map.heightLevel[prop.y * map.width + prop.x] !== prop.level) errors.push(`nível incorreto em ${prop.id}`);
    if (occupied.has(key)) errors.push(`props sobrepostos em ${key}`);
    occupied.add(key);
    if (treeTypes.has(prop.type)) trees.push(prop);
  }
  for (let index = 0; index < trees.length; index += 1) {
    for (let other = index + 1; other < trees.length; other += 1) {
      if (Math.max(Math.abs(trees[index].x - trees[other].x), Math.abs(trees[index].y - trees[other].y)) <= 1) {
        errors.push(`árvores próximas demais: ${trees[index].id} e ${trees[other].id}`);
      }
    }
  }
}

function validateRoadTopology(map, roadSet, errors) {
  if (map.settings.layout !== "grid") {
    if (map.gridSpec !== null) errors.push("traçado orgânico não deve expor gridSpec");
    return;
  }
  const spec = map.gridSpec;
  if (!spec || ![spec.centerX, spec.centerY, spec.spacing, spec.radius].every(Number.isInteger)
    || spec.spacing < 7 || spec.spacing > 9 || spec.radius < 1) {
    errors.push("gridSpec inválido");
    return;
  }
  const plazaKeys = new Set();
  for (let y = map.plaza.y; y < map.plaza.y + map.plaza.height; y += 1) for (let x = map.plaza.x; x < map.plaza.x + map.plaza.width; x += 1) plazaKeys.add(keyOf(x, y));
  for (let x = 1; x < map.width - 1; x += 1) if (!roadSet.has(keyOf(x, spec.centerY))) errors.push(`eixo horizontal incompleto em ${x}`);
  for (let y = 1; y < map.height - 1; y += 1) if (!roadSet.has(keyOf(spec.centerX, y))) errors.push(`eixo vertical incompleto em ${y}`);
  const startX = spec.centerX - Math.floor(spec.radius / spec.spacing) * spec.spacing;
  const startY = spec.centerY - Math.floor(spec.radius / spec.spacing) * spec.spacing;
  for (const road of map.roads) {
    if (plazaKeys.has(keyOf(road.x, road.y)) || road.kind === "main") continue;
    const vertical = road.x >= startX && (road.x - startX) % spec.spacing === 0
      && road.x <= spec.centerX + spec.radius && road.y >= spec.centerY - spec.radius && road.y <= spec.centerY + spec.radius;
    const horizontal = road.y >= startY && (road.y - startY) % spec.spacing === 0
      && road.y <= spec.centerY + spec.radius && road.x >= spec.centerX - spec.radius && road.x <= spec.centerX + spec.radius;
    if (!vertical && !horizontal) errors.push(`rua não ortogonal à grade em ${road.x},${road.y}`);
  }
}

export function validateVillage(map) {
  const errors = [];
  if (map.schemaVersion !== 2) errors.push("schemaVersion inválido");
  if (!Number.isInteger(map.width) || map.width !== map.height) errors.push("dimensões inválidas");
  if (!Array.isArray(map.terrain) || map.terrain.length !== map.width * map.height) errors.push("camada de terreno incompleta");
  if (!Array.isArray(map.heightLevel) || map.heightLevel.length !== map.width * map.height) errors.push("camada de altura incompleta");
  else if (map.heightLevel.some((level) => !Number.isInteger(level) || level < 0 || level > 6)) errors.push("nível de altura fora de 0..6");
  if (map.settings.layout === "grid" && map.roadTopology !== "orthogonal-cardinal") errors.push("grade sem topologia ortogonal cardinal");
  if (map.settings.layout === "organic" && map.roadTopology !== "organic-cardinal") errors.push("traçado orgânico sem topologia declarada");
  validateZones(map, errors);
  const roadSet = new Set(map.roads.map(({ x, y }) => keyOf(x, y)));
  const roadByKey = new Map(map.roads.map((road) => [keyOf(road.x, road.y), road]));
  if (roadSet.size !== map.roads.length) errors.push("tiles de estrada duplicados");
  for (const road of map.roads) {
    const water = map.terrain[road.y * map.width + road.x] === "water";
    if (road.bridge !== water) errors.push(`ponte inconsistente em ${road.x},${road.y}`);
    if (road.bridge && !["ns", "ew", "cross"].includes(road.orientation)) errors.push(`orientação de ponte inválida em ${road.x},${road.y}`);
    if (!road.bridge && road.orientation !== null) errors.push(`estrada terrestre com orientação de ponte em ${road.x},${road.y}`);
  }
  connectedRoads(map, roadSet, errors);
  validateRoadTopology(map, roadSet, errors);
  const buildingValidation = validateBuildings(map, roadSet, roadByKey, errors);
  validateProps(map, roadSet, buildingValidation.expanded, buildingValidation.doorSet, errors);
  const range = HOUSE_RANGES[map.settings.settlement];
  const houses = map.buildings.filter((building) => building.type === "house").length;
  if (!range || houses < range[0] || houses > range[1]) errors.push(`quantidade de casas fora da faixa: ${houses}`);
  return { valid: errors.length === 0, errors };
}

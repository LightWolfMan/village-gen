const keyOf = (x, y) => `${x},${y}`;
const HOUSE_RANGES = { hamlet: [10, 18], village: [25, 40], town: [55, 85] };

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

function validateBuildings(map, roadSet, errors) {
  const occupied = new Map();
  const expanded = new Map();
  for (const building of map.buildings) {
    if (building.x < 0 || building.y < 0 || building.x + building.width > map.width || building.y + building.height > map.height) {
      errors.push(`edifício ${building.id} fora do mapa`);
      continue;
    }
    if (!roadSet.has(keyOf(building.door.x, building.door.y))) errors.push(`porta de ${building.id} não acessa uma rua`);
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
  return expanded;
}

function validateProps(map, roadSet, buildingMargin, errors) {
  const trees = [];
  const treeTypes = new Set(["oak", "pine", "willow"]);
  const occupied = new Set();
  for (const prop of map.props) {
    const key = keyOf(prop.x, prop.y);
    if (prop.x < 0 || prop.y < 0 || prop.x >= map.width || prop.y >= map.height) errors.push(`prop ${prop.id} fora do mapa`);
    if (roadSet.has(key) || buildingMargin.has(key)) errors.push(`prop ${prop.id} ocupa rua ou margem de edifício`);
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

export function validateVillage(map) {
  const errors = [];
  if (map.schemaVersion !== 1) errors.push("schemaVersion inválido");
  if (!Number.isInteger(map.width) || map.width !== map.height) errors.push("dimensões inválidas");
  if (!Array.isArray(map.terrain) || map.terrain.length !== map.width * map.height) errors.push("camada de terreno incompleta");
  if (!Array.isArray(map.heightLevel) || map.heightLevel.length !== map.width * map.height) errors.push("camada de altura incompleta");
  else if (map.heightLevel.some((level) => !Number.isInteger(level) || level < 0 || level > 6)) errors.push("nível de altura fora de 0..6");
  const roadSet = new Set(map.roads.map(({ x, y }) => keyOf(x, y)));
  if (roadSet.size !== map.roads.length) errors.push("tiles de estrada duplicados");
  for (const road of map.roads) {
    const water = map.terrain[road.y * map.width + road.x] === "water";
    if (road.bridge !== water) errors.push(`ponte inconsistente em ${road.x},${road.y}`);
    if (road.bridge && !["ns", "ew", "cross"].includes(road.orientation)) errors.push(`orientação de ponte inválida em ${road.x},${road.y}`);
    if (!road.bridge && road.orientation !== null) errors.push(`estrada terrestre com orientação de ponte em ${road.x},${road.y}`);
  }
  connectedRoads(map, roadSet, errors);
  const buildingMargin = validateBuildings(map, roadSet, errors);
  validateProps(map, roadSet, buildingMargin, errors);
  const range = HOUSE_RANGES[map.settings.settlement];
  const houses = map.buildings.filter((building) => building.type === "house").length;
  if (!range || houses < range[0] || houses > range[1]) errors.push(`quantidade de casas fora da faixa: ${houses}`);
  return { valid: errors.length === 0, errors };
}

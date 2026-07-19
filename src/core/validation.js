function rectangleCells(building) {
  const cells = [];
  for (let y = building.y; y < building.y + building.height; y += 1) {
    for (let x = building.x; x < building.x + building.width; x += 1) cells.push({ x, y });
  }
  return cells;
}

export function validateVillage(map) {
  const errors = [];
  const occupied = new Set();
  const roadSet = new Set(map.roads.map(({ x, y }) => `${x},${y}`));
  const plazaKeys = new Set();
  for (let y = map.plaza.y; y < map.plaza.y + map.plaza.height; y += 1) {
    for (let x = map.plaza.x; x < map.plaza.x + map.plaza.width; x += 1) plazaKeys.add(`${x},${y}`);
  }

  for (const building of map.buildings) {
    if (building.x < 0 || building.y < 0 || building.x + building.width > map.width || building.y + building.height > map.height) {
      errors.push(`${building.id}: fora dos limites`);
      continue;
    }
    for (const cell of rectangleCells(building)) {
      const key = `${cell.x},${cell.y}`;
      const index = cell.y * map.width + cell.x;
      if (occupied.has(key)) errors.push(`${building.id}: sobreposição em ${key}`);
      if (map.terrain[index] === "water") errors.push(`${building.id}: construção na água em ${key}`);
      if (roadSet.has(key) || plazaKeys.has(key)) errors.push(`${building.id}: construção bloqueia via em ${key}`);
      occupied.add(key);
    }
    const doorKey = `${building.door.x},${building.door.y}`;
    if (!roadSet.has(doorKey) && !plazaKeys.has(doorKey)) errors.push(`${building.id}: porta sem via`);
  }

  const start = `${map.plaza.x + Math.floor(map.plaza.width / 2)},${map.plaza.y + Math.floor(map.plaza.height / 2)}`;
  const traversable = new Set([...roadSet, ...plazaKeys]);
  const reached = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const [x, y] = queue[head].split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + dx},${y + dy}`;
      if (traversable.has(key) && !reached.has(key)) {
        reached.add(key);
        queue.push(key);
      }
    }
  }
  for (const building of map.buildings) {
    if (!reached.has(`${building.door.x},${building.door.y}`)) errors.push(`${building.id}: porta desconectada da praça`);
  }
  return { valid: errors.length === 0, errors };
}


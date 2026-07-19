const ROAD_PRIORITY = Object.freeze({ street: 0, main: 1, plaza: 2 });

export const ROAD_BITS = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });

const STEPS = Object.freeze({
  "0,-1": [ROAD_BITS.N, ROAD_BITS.S, "ns"],
  "1,0": [ROAD_BITS.E, ROAD_BITS.W, "ew"],
  "0,1": [ROAD_BITS.S, ROAD_BITS.N, "ns"],
  "-1,0": [ROAD_BITS.W, ROAD_BITS.E, "ew"],
});

function keyOf(x, y) { return `${x},${y}`; }

function isWater(map, point) {
  return map.terrain[point.y * map.width + point.x] === "water";
}

export function ensureRoadCell(roadMap, x, y, kind) {
  const key = keyOf(x, y);
  let record = roadMap.get(key);
  if (!record) {
    record = { kind, connections: 0, bridgeAxis: null };
    roadMap.set(key, record);
  } else if (ROAD_PRIORITY[kind] > ROAD_PRIORITY[record.kind]) {
    record.kind = kind;
  }
  return record;
}

export function bridgeAxisAt(roadMap, x, y) {
  return roadMap.get(keyOf(x, y))?.bridgeAxis ?? null;
}

export function connectRoadCells(roadMap, first, second, kind, map) {
  const step = STEPS[`${second.x - first.x},${second.y - first.y}`];
  if (!step) throw new Error(`Conexão viária não cardinal: ${keyOf(first.x, first.y)} -> ${keyOf(second.x, second.y)}`);
  const [fromBit, toBit, axis] = step;
  const firstRoad = ensureRoadCell(roadMap, first.x, first.y, kind);
  const secondRoad = ensureRoadCell(roadMap, second.x, second.y, kind);
  if (map && (isWater(map, first) || isWater(map, second))) {
    if ((isWater(map, first) && firstRoad.bridgeAxis && firstRoad.bridgeAxis !== axis)
      || (isWater(map, second) && secondRoad.bridgeAxis && secondRoad.bridgeAxis !== axis)) return false;
    if (isWater(map, first)) firstRoad.bridgeAxis = axis;
    if (isWater(map, second)) secondRoad.bridgeAxis = axis;
  }
  firstRoad.connections |= fromBit;
  secondRoad.connections |= toBit;
  return true;
}

export function addRoadPath(roadMap, path, kind, map) {
  if (!path.length) return false;
  for (const point of path) ensureRoadCell(roadMap, point.x, point.y, kind);
  for (let index = 1; index < path.length; index += 1) {
    if (!connectRoadCells(roadMap, path[index - 1], path[index], kind, map)) return false;
  }
  return true;
}

function bridgeAxis(connections) {
  const horizontal = connections & (ROAD_BITS.E | ROAD_BITS.W);
  const vertical = connections & (ROAD_BITS.N | ROAD_BITS.S);
  if (horizontal && !vertical) return "ew";
  if (vertical && !horizontal) return "ns";
  return null;
}

function collectSpan(roadByKey, start, axis, seen) {
  const step = axis === "ew" ? [1, 0] : [0, 1];
  let first = start;
  while (true) {
    const previous = roadByKey.get(keyOf(first.x - step[0], first.y - step[1]));
    if (!previous?.bridge || previous.orientation !== axis) break;
    first = previous;
  }
  const roads = [];
  let cursor = first;
  while (cursor?.bridge && cursor.orientation === axis) {
    roads.push(cursor);
    seen.add(keyOf(cursor.x, cursor.y));
    cursor = roadByKey.get(keyOf(cursor.x + step[0], cursor.y + step[1]));
  }
  return { roads, step };
}

function connectedRoadComponent(map, roads) {
  if (!roads.length) return roads;
  const byKey = new Map(roads.map((road) => [keyOf(road.x, road.y), road]));
  const preferred = map.plaza && byKey.get(keyOf(
    map.plaza.x + Math.floor(map.plaza.width / 2),
    map.plaza.y + Math.floor(map.plaza.height / 2),
  ));
  const queue = [preferred || roads.find((road) => road.kind === "plaza") || roads[0]];
  const reached = new Set([keyOf(queue[0].x, queue[0].y)]);
  const directions = [
    [ROAD_BITS.N, 0, -1], [ROAD_BITS.E, 1, 0], [ROAD_BITS.S, 0, 1], [ROAD_BITS.W, -1, 0],
  ];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const road = queue[cursor];
    for (const [bit, dx, dy] of directions) {
      if (!(road.connections & bit)) continue;
      const nextKey = keyOf(road.x + dx, road.y + dy);
      const next = byKey.get(nextKey);
      if (!next || reached.has(nextKey)) continue;
      reached.add(nextKey);
      queue.push(next);
    }
  }
  return roads.filter((road) => reached.has(keyOf(road.x, road.y)));
}

export function finalizeRoadTopology(map, roadMap) {
  const allRoads = [...roadMap.entries()].map(([key, record]) => {
    const [x, y] = key.split(",").map(Number);
    const bridge = map.terrain[y * map.width + x] === "water";
    return {
      x,
      y,
      kind: record.kind,
      bridge,
      orientation: bridge ? bridgeAxis(record.connections) : null,
      connections: record.connections,
      segmentIds: [],
      bridgeSpanId: null,
      bridgeRole: null,
      bridgeIndex: null,
    };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const roads = connectedRoadComponent(map, allRoads);
  const roadByKey = new Map(roads.map((road) => [keyOf(road.x, road.y), road]));
  const roadIndex = new Map(roads.map((road, index) => [keyOf(road.x, road.y), index]));
  const seen = new Set();
  const bridgeSpans = [];
  for (const road of roads) {
    const key = keyOf(road.x, road.y);
    if (!road.bridge || !road.orientation || seen.has(key)) continue;
    const { roads: spanRoads, step } = collectSpan(roadByKey, road, road.orientation, seen);
    const id = `bridge-${bridgeSpans.length}`;
    const first = spanRoads[0];
    const last = spanRoads.at(-1);
    const entry = { x: first.x - step[0], y: first.y - step[1] };
    const exit = { x: last.x + step[0], y: last.y + step[1] };
    spanRoads.forEach((spanRoad, index) => {
      spanRoad.bridgeSpanId = id;
      spanRoad.bridgeIndex = index;
      spanRoad.bridgeRole = spanRoads.length === 1 ? "single"
        : index === 0 ? "start"
          : index === spanRoads.length - 1 ? "end"
            : index % 3 === 0 ? "post" : "middle";
    });
    bridgeSpans.push({
      id,
      axis: road.orientation,
      roadIndexes: spanRoads.map((spanRoad) => roadIndex.get(keyOf(spanRoad.x, spanRoad.y))),
      entry,
      exit,
      length: spanRoads.length,
    });
  }
  return { roads, bridgeSpans };
}

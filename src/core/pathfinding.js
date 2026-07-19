class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= item.score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }
  pop() {
    if (!this.items.length) return undefined;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        let child = right < this.items.length && this.items[right].score < this.items[left].score ? right : left;
        if (this.items[child].score >= last.score) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
  get length() { return this.items.length; }
}

export function findPath(width, height, start, goal, costAt, options = {}) {
  const startIndex = start.y * width + start.x;
  const goalIndex = goal.y * width + goal.x;
  // On a straight water span, waterRun is determined by cell + heading, so it
  // does not need to multiply the A* state space.
  const encodeState = (index, direction) => index * 5 + direction + 1;
  const decodeIndex = (stateKey) => Math.floor(stateKey / 5);
  const startKey = encodeState(startIndex, -1);
  const stateCount = width * height * 5;
  const cameFrom = new Int32Array(stateCount).fill(-1);
  const scores = new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY);
  scores[startKey] = 0;
  const heap = new MinHeap();
  const heuristicWeight = options.heuristicWeight ?? 1;
  heap.push({ index: startIndex, direction: -1, waterRun: 0, stateKey: startKey, cost: 0, score: (Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y)) * heuristicWeight });
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let goalKey = startIndex === goalIndex ? startKey : null;
  while (heap.length) {
    const current = heap.pop();
    if (current.cost !== scores[current.stateKey]) continue;
    if (current.index === goalIndex) { goalKey = current.stateKey; break; }
    const x = current.index % width;
    const y = Math.floor(current.index / width);
    const currentWater = options.isWater?.(x, y) ?? false;
    for (let direction = 0; direction < directions.length; direction += 1) {
      const [dx, dy] = directions[direction];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nextWater = options.isWater?.(nx, ny) ?? false;
      if (currentWater && current.direction >= 0 && direction !== current.direction) continue;
      const axis = direction % 2 === 0 ? "ew" : "ns";
      if (nextWater && options.bridgeAxisAt?.(nx, ny) && options.bridgeAxisAt(nx, ny) !== axis) continue;
      const waterRun = nextWater ? (currentWater ? current.waterRun + 1 : 1) : 0;
      if (nextWater && options.maxWaterRun && waterRun > options.maxWaterRun) continue;
      const next = ny * width + nx;
      const stateKey = encodeState(next, direction);
      const turnCost = current.direction >= 0 && current.direction !== direction ? (options.turnPenalty ?? 0) : 0;
      const candidate = scores[current.stateKey] + costAt(nx, ny, x, y) + turnCost;
      if (candidate >= scores[stateKey]) continue;
      scores[stateKey] = candidate;
      cameFrom[stateKey] = current.stateKey;
      heap.push({ index: next, direction, waterRun, stateKey, cost: candidate, score: candidate + (Math.abs(goal.x - nx) + Math.abs(goal.y - ny)) * heuristicWeight });
    }
  }
  if (goalKey === null) return [];
  const path = [];
  let cursorKey = goalKey;
  while (cursorKey >= 0) {
    const cursor = decodeIndex(cursorKey);
    path.push({ x: cursor % width, y: Math.floor(cursor / width) });
    if (cursorKey === startKey) break;
    cursorKey = cameFrom[cursorKey];
  }
  return path.reverse();
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(node) {
    this.items.push(node);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= node.score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = node;
  }

  pop() {
    const root = this.items[0];
    const tail = this.items.pop();
    if (this.items.length && tail) {
      let index = 0;
      while (true) {
        let child = index * 2 + 1;
        if (child >= this.items.length) break;
        if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score) child += 1;
        if (this.items[child].score >= tail.score) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = tail;
    }
    return root;
  }

  get length() {
    return this.items.length;
  }
}

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function findTerrainPath(width, height, terrain, start, goal, variation) {
  const total = width * height;
  const gScore = new Float64Array(total);
  gScore.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(total);
  previous.fill(-1);
  const closed = new Uint8Array(total);
  const startIndex = start.y * width + start.x;
  const goalIndex = goal.y * width + goal.x;
  const heap = new MinHeap();
  gScore[startIndex] = 0;
  heap.push({ index: startIndex, score: 0 });

  while (heap.length) {
    const current = heap.pop();
    if (closed[current.index]) continue;
    if (current.index === goalIndex) break;
    closed[current.index] = 1;
    const x = current.index % width;
    const y = Math.floor(current.index / width);
    for (const [dx, dy] of DIRECTIONS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue;
      const nextIndex = ny * width + nx;
      if (closed[nextIndex]) continue;
      const tile = terrain[nextIndex];
      const terrainCost = tile === "water" ? 11 : tile === "forest" ? 2.7 : 1;
      const organicCost = variation(nx, ny) * 0.85;
      const tentative = gScore[current.index] + terrainCost + organicCost;
      if (tentative >= gScore[nextIndex]) continue;
      previous[nextIndex] = current.index;
      gScore[nextIndex] = tentative;
      const heuristic = Math.abs(goal.x - nx) + Math.abs(goal.y - ny);
      heap.push({ index: nextIndex, score: tentative + heuristic });
    }
  }

  if (previous[goalIndex] === -1 && goalIndex !== startIndex) return [];
  const path = [];
  let index = goalIndex;
  while (index !== -1) {
    path.push({ x: index % width, y: Math.floor(index / width) });
    if (index === startIndex) break;
    index = previous[index];
  }
  return path.reverse();
}


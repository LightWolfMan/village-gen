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

export function findPath(width, height, start, goal, costAt) {
  const total = width * height;
  const cameFrom = new Int32Array(total).fill(-1);
  const scores = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const startIndex = start.y * width + start.x;
  const goalIndex = goal.y * width + goal.x;
  scores[startIndex] = 0;
  const heap = new MinHeap();
  heap.push({ index: startIndex, score: Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y) });
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  while (heap.length) {
    const current = heap.pop();
    if (current.index === goalIndex) break;
    const x = current.index % width;
    const y = Math.floor(current.index / width);
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      const candidate = scores[current.index] + costAt(nx, ny, x, y);
      if (candidate >= scores[next]) continue;
      scores[next] = candidate;
      cameFrom[next] = current.index;
      heap.push({ index: next, score: candidate + Math.abs(goal.x - nx) + Math.abs(goal.y - ny) });
    }
  }
  if (goalIndex !== startIndex && cameFrom[goalIndex] < 0) return [];
  const path = [];
  let cursor = goalIndex;
  while (cursor >= 0) {
    path.push({ x: cursor % width, y: Math.floor(cursor / width) });
    if (cursor === startIndex) break;
    cursor = cameFrom[cursor];
  }
  return path.reverse();
}

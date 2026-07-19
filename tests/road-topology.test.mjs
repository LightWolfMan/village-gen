import test from "node:test";
import assert from "node:assert/strict";
import { addRoadPath, finalizeRoadTopology } from "../src/core/road-topology.js";

function syntheticBridge(axis, length) {
  const width = 11;
  const height = 11;
  const terrain = Array(width * height).fill("grass");
  const roadMap = new Map();
  const path = [];
  for (let index = -1; index <= length; index += 1) {
    const point = axis === "ew" ? { x: 3 + index, y: 5 } : { x: 5, y: 3 + index };
    path.push(point);
    if (index >= 0 && index < length) terrain[point.y * width + point.x] = "water";
  }
  const map = { width, height, terrain };
  assert.equal(addRoadPath(roadMap, path, "street", map), true);
  return finalizeRoadTopology(map, roadMap);
}
for (const axis of ["ew", "ns"]) {
  for (const [length, roles] of [
    [1, ["single"]],
    [2, ["start", "end"]],
    [5, ["start", "middle", "middle", "post", "end"]],
  ]) {
    test(`ponte ${axis} de ${length} tiles é um span contínuo`, () => {
      const topology = syntheticBridge(axis, length);
      assert.equal(topology.bridgeSpans.length, 1);
      const [span] = topology.bridgeSpans;
      assert.equal(span.axis, axis);
      assert.equal(span.length, length);
      assert.deepEqual(span.roadIndexes.map((roadIndex) => topology.roads[roadIndex].bridgeRole), roles);
      assert.deepEqual(span.roadIndexes.map((roadIndex) => topology.roads[roadIndex].bridgeIndex), Array.from({ length }, (_, index) => index));
      assert.ok(span.roadIndexes.every((roadIndex) => topology.roads[roadIndex].connections === (axis === "ew" ? 10 : 5)));
      const entryRoad = topology.roads.find((road) => road.x === span.entry.x && road.y === span.entry.y);
      const exitRoad = topology.roads.find((road) => road.x === span.exit.x && road.y === span.exit.y);
      assert.equal(entryRoad?.bridge, false);
      assert.equal(exitRoad?.bridge, false);
    });
  }
}

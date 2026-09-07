import assert from "node:assert/strict";
import test from "node:test";
import { createRandom } from "../src/core/random.js";
import { createUrbanPlan } from "../src/core/urbanism.js";

function straightRoadMap() {
  const width = 24;
  const height = 24;
  const roads = [];
  for (let x = 2; x <= 21; x += 1) {
    roads.push({
      x, y: 12, kind: "street", bridge: false, orientation: null,
      connections: x === 2 ? 2 : x === 21 ? 8 : 10,
      segmentIds: [], bridgeSpanId: null, bridgeRole: null, bridgeIndex: null,
    });
  }
  return {
    schemaVersion: 4,
    seed: "urbanism-unit",
    width, height,
    settings: { settlement: "hamlet", layout: "organic", biome: "temperate" },
    plaza: { x: 9, y: 9, width: 3, height: 3, level: 2 },
    roads,
    terrain: new Array(width * height).fill("grass"),
    heightLevel: new Array(width * height).fill(2),
    zoneMap: new Array(width * height).fill("residential"),
  };
}

test("urbanismo v4 deriva segmentos, fachadas e lote seco com acesso reto", () => {
  const map = straightRoadMap();
  const plan = createUrbanPlan(map, createRandom("urbanism-unit"), {
    houseTarget: 1,
    services: [],
    flatten(x, y, width, height, level) {
      for (let py = y; py < y + height; py += 1) {
        for (let px = x; px < x + width; px += 1) map.heightLevel[py * map.width + px] = level;
      }
    },
  });
  assert.equal(plan.roadSegments.length, 1);
  assert.equal(plan.roadSegments[0].axis, "ew");
  assert.equal(plan.frontages.length, 2);
  assert.equal(plan.buildings.length, 1);
  assert.equal(plan.lots.length, 1);
  const building = plan.buildings[0];
  const lot = plan.lots[0];
  assert.ok(building.assetId.startsWith('temperate:cottage:'));
  assert.ok(building.entrance && building.accessPath.length >= 2);
  assert.equal(lot.rearDepth, 1);
  assert.equal(lot.lateralGap, 1);
  assert.equal(building.lotId, lot.id);
  assert.equal(building.frontageId, lot.frontageId);
  assert.equal(map.roads[lot.roadIndex].connections, 10);
  assert.equal(map.roads[lot.roadIndex].bridge, false);
  const lotCells = new Set(lot.cells.map(({ x, y }) => `${x},${y}`));
  for (let y = building.y; y < building.y + building.height; y += 1) {
    for (let x = building.x; x < building.x + building.width; x += 1) {
      assert.ok(lotCells.has(`${x},${y}`));
      assert.notEqual(map.terrain[y * map.width + x], "water");
    }
  }
});

test("lote seco não invade nem repinta o distrito vizinho", () => {
  const map = straightRoadMap();
  map.zoneMap.fill('agricultural');
  const zones = [...map.zoneMap];
  assert.throws(() => createUrbanPlan(map, createRandom('wrong-zone'), { houseTarget: 1, services: [] }), /Parcelamento insuficiente/);
  assert.deepEqual(map.zoneMap, zones);
});

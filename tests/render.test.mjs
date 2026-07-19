import test from 'node:test';
import assert from 'node:assert/strict';

import { computeRenderBounds, projectPoint } from '../src/render/renderer.js';

function sampleMap() {
  return {
    schemaVersion: 2,
    width: 5,
    height: 4,
    biome: 'temperate',
    terrain: [
      'water', 'grass', 'grass', 'grass', 'water',
      'grass', 'grass', 'dirt', 'grass', 'grass',
      'grass', 'grass', 'grass', 'forest', 'grass',
      'water', 'grass', 'grass', 'grass', 'water',
    ],
    heightLevel: [
      0, 1, 1, 1, 0,
      1, 2, 3, 2, 1,
      1, 2, 3, 2, 1,
      0, 1, 1, 1, 0,
    ],
    plaza: { x: 1, y: 1, width: 2, height: 2 },
    roads: [{ x: 0, y: 0, kind: 'road', bridge: true, orientation: 'ew' }],
    buildings: [{
      id: 'hall-0', type: 'hall', x: 2, y: 1, width: 2, height: 2,
      baseLevel: 3, storeys: 2, material: 'stone', roof: 'tile', orientation: 'south',
      door: { x: 2, y: 3 }, variant: 0,
    }],
    props: [
      { id: 'tree-0', type: 'tree', x: 0, y: 2, level: 1, variant: 0 },
      { id: 'cart-0', type: 'cart', x: 4, y: 2, level: 1, variant: 0 },
    ],
  };
}

test('projectPoint usa losango 32x16 e degrau vertical de 6 pixels', () => {
  assert.deepEqual(projectPoint(0, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(projectPoint(1, 0, 0), { x: 16, y: 8 });
  assert.deepEqual(projectPoint(0, 1, 0), { x: -16, y: 8 });
  assert.deepEqual(projectPoint(3, 2, 4), { x: 16, y: 16 });
});

test('projectPoint respeita escala customizada sem alterar os defaults', () => {
  assert.deepEqual(projectPoint(3, 1, 2, { tileWidth: 64, tileHeight: 32, heightStep: 10 }), { x: 64, y: 44 });
  assert.deepEqual(projectPoint(1, 0, 0), { x: 16, y: 8 });
});

test('computeRenderBounds e puro e deterministico', () => {
  const map = sampleMap();
  const before = JSON.stringify(map);
  const first = computeRenderBounds(map);
  const second = computeRenderBounds(map);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(map), before);
  assert.ok(Object.isFrozen(first));
});

test('bounds incluem terreno, predios altos, props e padding', () => {
  const map = sampleMap();
  const bounds = computeRenderBounds(map, { padding: 48 });
  assert.ok(bounds.width > (map.width + map.height) * 16);
  assert.ok(bounds.height > (map.width + map.height) * 8);
  assert.equal(bounds.originX, -bounds.minX);
  assert.equal(bounds.originY, -bounds.minY);
  assert.equal(bounds.maxX - bounds.minX, bounds.width);
  assert.equal(bounds.maxY - bounds.minY, bounds.height);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const level = map.heightLevel[y * map.width + x];
      const point = projectPoint(x, y, level);
      const screenX = point.x + bounds.originX;
      const screenY = point.y + bounds.originY;
      assert.ok(screenX >= 16 && screenX <= bounds.width - 16);
      assert.ok(screenY >= 8 && screenY <= bounds.height - 8);
    }
  }
});

test('bounds crescem com predio mais alto e rejeitam mapas invalidos', () => {
  const low = sampleMap();
  low.buildings[0].storeys = 1;
  const high = sampleMap();
  high.buildings[0].storeys = 4;
  assert.ok(computeRenderBounds(high).height > computeRenderBounds(low).height);
  assert.throws(() => computeRenderBounds({ width: 0, height: 1 }), /VillageMap invalido/);
  assert.throws(() => computeRenderBounds(null), /VillageMap invalido/);
});

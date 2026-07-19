import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDoorPlacement,
  computeEavedRoofBase,
  computeRenderBounds,
  computeRoofGeometry,
  getArchitectureProfile,
  projectPoint,
} from '../src/render/renderer.js';

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

test('geometria do telhado troca as faces sem criar triangulo sobreposto', () => {
  const base = {
    n: { x: 0, y: -8 }, e: { x: 16, y: 0 },
    s: { x: 0, y: 8 }, w: { x: -16, y: 0 },
  };
  const horizontal = computeRoofGeometry(base, -10, true);
  assert.deepEqual(horizontal.ridgeA, { x: -8, y: -14 });
  assert.deepEqual(horizontal.ridgeB, { x: 8, y: -6 });
  assert.deepEqual(horizontal.lightFace, [base.n, base.e, horizontal.ridgeB, horizontal.ridgeA]);
  assert.deepEqual(horizontal.darkFace, [horizontal.ridgeA, horizontal.ridgeB, base.s, base.w]);
  assert.equal(horizontal.lightFace.length, 4);
  assert.equal(horizontal.darkFace.length, 4);

  const vertical = computeRoofGeometry(base, -10, false);
  assert.deepEqual(vertical.ridgeA, { x: 8, y: -14 });
  assert.deepEqual(vertical.ridgeB, { x: -8, y: -6 });
  assert.deepEqual(vertical.lightFace, [base.n, vertical.ridgeA, vertical.ridgeB, base.w]);
  assert.deepEqual(vertical.darkFace, [vertical.ridgeA, base.e, base.s, vertical.ridgeB]);
  assert.equal(vertical.gables.length, 2);
});

test('beiral expande o telhado sem alterar a base original', () => {
  const base = {
    n: { x: 0, y: -8 }, e: { x: 16, y: 0 },
    s: { x: 0, y: 8 }, w: { x: -16, y: 0 },
  };
  const before = structuredClone(base);
  assert.deepEqual(computeEavedRoofBase(base, 4), {
    n: { x: 0, y: -10 }, e: { x: 20, y: 0 },
    s: { x: 0, y: 10 }, w: { x: -20, y: 0 },
  });
  assert.deepEqual(base, before);
  assert.throws(() => computeEavedRoofBase(null), /Base de beiral invalida/);
});

test('portas usam somente a face isometrica correspondente a orientation', () => {
  const south = computeDoorPlacement({ x: 10, y: 20, width: 3, height: 2, orientation: 'south', door: { x: 11, y: 22 } });
  const east = computeDoorPlacement({ x: 10, y: 20, width: 2, height: 3, orientation: 'east', door: { x: 12, y: 21 } });
  assert.deepEqual(south, { orientation: 'south', face: 'south', visible: true, t: .5 });
  assert.deepEqual(east, { orientation: 'east', face: 'east', visible: true, t: .5 });
  assert.deepEqual(
    computeDoorPlacement({ x: 10, y: 20, width: 2, height: 2, orientation: 'north', door: { x: 10, y: 19 } }),
    { orientation: 'north', face: null, visible: false, t: null },
  );
  assert.deepEqual(
    computeDoorPlacement({ x: 10, y: 20, width: 2, height: 2, orientation: 'west', door: { x: 9, y: 20 } }),
    { orientation: 'west', face: null, visible: false, t: null },
  );
  assert.ok(Object.isFrozen(south));
});

test('perfis arquitetonicos alteram a silhueta sem quebrar os bounds', () => {
  const cottage = getArchitectureProfile('cottage');
  const townhouse = getArchitectureProfile('townhouse');
  const workshop = getArchitectureProfile('workshop');
  const civic = getArchitectureProfile('civic');
  const farmstead = getArchitectureProfile('farmstead');
  assert.ok(Object.isFrozen(cottage));
  assert.ok(townhouse.wallScale > cottage.wallScale);
  assert.ok(farmstead.roofScale > workshop.roofScale);
  assert.notEqual(civic.detail, cottage.detail);
  assert.equal(getArchitectureProfile(undefined, 'smithy'), workshop);
  assert.equal(getArchitectureProfile('perfil-inexistente', 'hall'), civic);
  assert.equal(getArchitectureProfile('timber-frame').key, 'cottage');
  assert.equal(getArchitectureProfile('adobe-courtyard').key, 'courtyard');
  assert.equal(getArchitectureProfile('alpine-chalet').key, 'chalet');
  assert.equal(getArchitectureProfile('stilt-house').key, 'stilt');
  assert.equal(getArchitectureProfile('raised-longhouse').key, 'stilt');
  assert.equal(getArchitectureProfile('forge-workshop').key, 'workshop');
  assert.equal(getArchitectureProfile('guildhall').key, 'civic');
  assert.equal(getArchitectureProfile('gate-tower').key, 'tower');
  assert.equal(getArchitectureProfile('temperate-timber-frame').key, 'cottage');
  assert.equal(getArchitectureProfile('arid-adobe-courtyard').key, 'courtyard');
  assert.equal(getArchitectureProfile('snowy-alpine-chalet').key, 'chalet');
  assert.equal(getArchitectureProfile('wetland-raised-longhouse').key, 'stilt');
  assert.equal(getArchitectureProfile('temperate-urban-townhouse').key, 'townhouse');
  assert.equal(getArchitectureProfile('temperate-artisan-rowhouse').key, 'townhouse');
  assert.equal(getArchitectureProfile('temperate-croft-farm').key, 'farmstead');
  assert.equal(getArchitectureProfile('artisan-house').key, 'workshop');
  assert.equal(getArchitectureProfile('workshop-dwelling').key, 'workshop');
  assert.equal(getArchitectureProfile('merchant-dwelling').key, 'townhouse');
  assert.equal(getArchitectureProfile('shop-house').key, 'townhouse');
  for (const architecture of ['timber-frame', 'adobe-courtyard', 'alpine-chalet', 'stilt-house', 'forge-workshop', 'guildhall']) {
    const profile = getArchitectureProfile(architecture);
    assert.ok(profile.wallScale > 0);
    assert.ok(profile.roofScale > 0);
    assert.ok(profile.extraScale >= 0);
  }

  const low = sampleMap();
  low.buildings[0].architecture = 'farmstead';
  low.props = [];
  const tall = sampleMap();
  tall.buildings[0].architecture = 'townhouse';
  tall.props = [];
  assert.ok(computeRenderBounds(tall).height > computeRenderBounds(low).height);
});

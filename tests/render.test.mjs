import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDoorPlacement,
  computeBuildingSpritePlacement,
  computeEnvironmentSpritePlacement,
  canvasToPngBlob,
  computeEavedRoofBase,
  computeRenderBounds,
  computeRoofGeometry,
  getArchitectureProfile,
  loadEnvironmentArtAssets,
  parseBuildingSpriteManifest,
  parseEnvironmentSpriteManifest,
  projectPoint,
  resolveBuildingSprite,
  resolveRoadSpriteType,
} from '../src/render/renderer.js';

function sampleMap() {
  return {
    schemaVersion: 3,
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

function buildingSpriteFixture(family = 'civic', orientation = 'south', overrides = {}) {
  return {
    biome: 'temperate', family, orientation, src: `temperate/${family}-${orientation}.png`,
    variant: 0,
    width: 256, height: 256, anchorX: 128, anchorY: 192, doorX: 128, doorY: 190,
    footprint: [2, 2], ...overrides,
  };
}

test('manifesto Blender e normalizado sem depender de Image ou DOM', () => {
  const entries = parseBuildingSpriteManifest({
    schemaVersion: 1, baseTileWidth: 32, baseTileHeight: 16,
    entries: [buildingSpriteFixture(), { ...buildingSpriteFixture(), orientation: 'diagonal' }],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, '/assets/buildings/temperate/civic-south.png');
  assert.deepEqual(entries[0].footprint, { width: 2, height: 2 });
  assert.ok(Object.isFrozen(entries));
  assert.ok(Object.isFrozen(entries[0]));
  assert.deepEqual(parseBuildingSpriteManifest(null), []);
});

test('resolver usa perfil, orientacao e aliases raster somente no bioma temperado', () => {
  const entries = parseBuildingSpriteManifest({ entries: [
    buildingSpriteFixture('civic', 'north'),
    buildingSpriteFixture('farmstead', 'west'),
    buildingSpriteFixture('cottage', 'south'),
    buildingSpriteFixture('merchant', 'east'),
    buildingSpriteFixture('artisan', 'south'),
    buildingSpriteFixture('smithy', 'west'),
  ] });
  assert.equal(resolveBuildingSprite({ architecture: 'manor', orientation: 'north' }, 'temperate', entries)?.family, 'civic');
  assert.equal(resolveBuildingSprite({ architecture: 'longhouse', orientation: 'west' }, 'temperate', entries)?.family, 'farmstead');
  assert.equal(resolveBuildingSprite({ architecture: 'timber-frame', orientation: 'south' }, 'temperate', entries)?.family, 'cottage');
  assert.equal(resolveBuildingSprite({ type: 'house', zone: 'commercial', architecture: 'timber-frame', orientation: 'east' }, 'temperate', entries)?.family, 'merchant');
  assert.equal(resolveBuildingSprite({ type: 'house', zone: 'craft', architecture: 'timber-frame', orientation: 'south' }, 'temperate', entries)?.family, 'artisan');
  assert.equal(resolveBuildingSprite({ type: 'smithy', zone: 'craft', architecture: 'stone-smithy', orientation: 'west' }, 'temperate', entries)?.family, 'smithy');
  assert.equal(resolveBuildingSprite({ architecture: 'manor', orientation: 'south' }, 'temperate', entries), null);
  assert.equal(resolveBuildingSprite({ architecture: 'manor', orientation: 'north' }, 'snowy', entries), null);
  assert.equal(resolveBuildingSprite({ architecture: 'tower', orientation: 'north' }, 'temperate', entries), null);
});

test('resolver respeita variante declarada e recua somente para variante zero da familia', () => {
  const entries = parseBuildingSpriteManifest({ entries: [
    buildingSpriteFixture('cottage', 'south', { variant: 0, src: 'temperate/cottage-v0-south.png' }),
    buildingSpriteFixture('cottage', 'south', { variant: 2, src: 'temperate/cottage-v2-south.png' }),
  ] });
  assert.equal(resolveBuildingSprite({ architecture: 'cottage', orientation: 'south', variant: 2 }, 'temperate', entries)?.variant, 2);
  assert.equal(resolveBuildingSprite({ architecture: 'cottage', orientation: 'south', variant: 1 }, 'temperate', entries)?.variant, 0);
});

test('placement raster preserva proporcao, ancora e porta visual', () => {
  const [sprite] = parseBuildingSpriteManifest({ entries: [buildingSpriteFixture('cottage', 'south')] });
  const placement = computeBuildingSpritePlacement({ x: 10, y: 20, width: 4, height: 2, baseLevel: 1 }, sprite);
  assert.equal(placement.scale, 1);
  assert.equal(placement.width, 256);
  assert.equal(placement.height, 256);
  assert.deepEqual(placement.anchor, projectPoint(11.5, 20.5, 1));
  assert.equal(placement.visualDoor.x, placement.x + sprite.doorX * placement.scale);
  assert.equal(placement.visualDoor.y, placement.y + sprite.doorY * placement.scale);

  const reduced = computeBuildingSpritePlacement({ x: 0, y: 0, width: 1, height: 3 }, sprite);
  assert.equal(reduced.scale, .5);
  assert.equal(reduced.width / reduced.height, sprite.width / sprite.height);
  assert.throws(() => computeBuildingSpritePlacement({}, { footprint: [0, 0] }), /Metadados de sprite invalidos/);
});

test('manifesto Blender de ambiente filtra entradas invalidas e resolve caminhos', () => {
  const manifest = {
    schemaVersion: 2,
    baseTileWidth: 64,
    entries: [
      { key: 'street', type: 'road-street', src: 'temperate/road-street.png', width: 256, height: 128, anchorX: 128, anchorY: 64 },
      { key: 'bad-type', type: 'waterfall', src: 'bad.png', width: 1, height: 1, anchorX: 0, anchorY: 0 },
      { key: 'bad-anchor', type: 'road-main', src: 'bad.png', width: 1, height: 1, anchorX: 'none', anchorY: 0 },
    ],
  };
  const entries = parseEnvironmentSpriteManifest(manifest);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, '/assets/environment/temperate/road-street.png');
  assert.equal(entries[0].baseTileWidth, 64);
  assert.ok(Object.isFrozen(entries));
  assert.ok(Object.isFrozen(entries[0]));
  assert.deepEqual(parseEnvironmentSpriteManifest({ ...manifest, schemaVersion: 1 }), []);
  assert.deepEqual(parseEnvironmentSpriteManifest({ ...manifest, baseTileWidth: 0 }), []);
});

test('vias e pontes escolhem a familia visual correspondente', () => {
  assert.equal(resolveRoadSpriteType({ kind: 'street', bridge: false }), 'road-street');
  assert.equal(resolveRoadSpriteType({ kind: 'main' }), 'road-main');
  assert.equal(resolveRoadSpriteType({ kind: 'plaza' }), 'road-plaza');
  assert.equal(resolveRoadSpriteType({ bridge: true, orientation: 'ew', bridgeRole: 'single' }), 'bridge-ew-single');
  assert.equal(resolveRoadSpriteType({ bridge: true, orientation: 'ns', bridgeRole: 'start' }), 'bridge-ns-start');
  assert.equal(resolveRoadSpriteType({ bridge: true, orientation: 'ew', bridgeRole: 'post' }), 'bridge-ew-post');
  assert.equal(resolveRoadSpriteType({ bridge: true, orientation: 'cross', bridgeRole: 'middle' }), null);
  assert.equal(resolveRoadSpriteType({ bridge: true, orientation: null }), null);
});

test('placement de ambiente ancora no centro e escala por tileWidth base', () => {
  const [sprite] = parseEnvironmentSpriteManifest({
    schemaVersion: 2,
    baseTileWidth: 64,
    entries: [{ key: 'bridge-ew-single', type: 'bridge-ew-single', src: 'bridge-ew-single.png', width: 320, height: 192, anchorX: 160, anchorY: 128 }],
  });
  const placement = computeEnvironmentSpritePlacement({ x: 3, y: 1 }, sprite, { tileWidth: 32, tileHeight: 16, heightStep: 6, level: 2 });
  assert.equal(placement.scale, .5);
  assert.equal(placement.width, 160);
  assert.equal(placement.height, 96);
  assert.deepEqual(placement.center, projectPoint(3, 1, 2));
  assert.equal(placement.x + sprite.anchorX * placement.scale, placement.center.x);
  assert.equal(placement.y + sprite.anchorY * placement.scale, placement.center.y);
  assert.ok(Object.isFrozen(placement));
  assert.throws(() => computeEnvironmentSpritePlacement({}, { width: 0 }), /Metadados de sprite de ambiente invalidos/);
});

test('loader de ambiente tolera manifesto ausente sem remover o fallback', async () => {
  const loaded = await loadEnvironmentArtAssets('://manifesto-inexistente');
  assert.equal(typeof loaded, 'object');
});

test('bounds incluem sprite grande e continuam puros quando o bitmap falta', () => {
  const map = sampleMap();
  map.buildings[0].architecture = 'civic';
  const [sprite] = parseBuildingSpriteManifest({ entries: [buildingSpriteFixture('civic', 'south', {
    width: 1024, height: 1024, anchorX: 512, anchorY: 768, doorX: 512, doorY: 760,
  })] });
  const plain = computeRenderBounds(map);
  const withSprite = computeRenderBounds(map, { buildingSprites: new Map([['temperate:civic:0:south', sprite]]) });
  assert.ok(withSprite.width > plain.width);
  assert.ok(withSprite.height > plain.height);
  assert.equal(resolveBuildingSprite(map.buildings[0], 'temperate', new Map()), null);
});

test('exportacao PNG aceita OffscreenCanvas e HTMLCanvasElement', async () => {
  const offscreenBlob = { type: 'image/png', size: 10 };
  const offscreen = { convertToBlob: async (options) => {
    assert.deepEqual(options, { type: 'image/png' });
    return offscreenBlob;
  } };
  assert.equal(await canvasToPngBlob(offscreen), offscreenBlob);

  const htmlBlob = { type: 'image/png', size: 12 };
  const html = { toBlob: (callback, type) => {
    assert.equal(type, 'image/png');
    callback(htmlBlob);
  } };
  assert.equal(await canvasToPngBlob(html), htmlBlob);
  await assert.rejects(() => canvasToPngBlob({}), /serializacao PNG/);
  await assert.rejects(() => canvasToPngBlob({ convertToBlob: async () => null }), /nao conseguiu/);
});

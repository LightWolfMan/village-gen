import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODEL_CATALOG, PROP_CATALOG, BRIDGE_CATALOG, MODEL_BY_ID } from '../assets/models/catalog.js';

test('contrato de construção registra perfil e âncoras finais nos quatro biomas', () => {
  for (const model of MODEL_CATALOG) {
    assert.equal(model.construction.version, 1, model.id);
    assert.equal(model.construction.roofStyle, model.biome === 'arid' ? 'flat' : 'gable', model.id);
    assert.equal(model.construction.floorLift, model.biome === 'wetland' ? .7 : 0, model.id);
    assert.equal(model.anchors.floor, model.entrance[1], model.id);
    assert.deepEqual(model.anchors.ground, [0, 0, 0]);
    assert.ok(model.anchors.roofs.length > 0 || model.family === 'tower', model.id);
    for (const roof of model.anchors.roofs) {
      assert.equal(roof.style, model.construction.roofStyle, model.id);
      for (const point of [roof.wallTop, roof.apex]) for (let axis = 0; axis < 3; axis++) {
        assert.ok(Number.isFinite(point[axis]), model.id);
        assert.ok(point[axis] >= model.bounds.min[axis] - .05 && point[axis] <= model.bounds.max[axis] + .05, `${model.id}: anchored roof bounds`);
      }
      assert.ok(roof.apex[1] > roof.wallTop[1], model.id);
    }
  }
});

test('GLB catálogo contém arquitetura dos quatro biomas, props e módulos contínuos', () => {
  assert.equal(MODEL_CATALOG.length, 160);
  assert.equal(PROP_CATALOG.length, 15);
  assert.equal(BRIDGE_CATALOG.length, 5);
  assert.equal(Object.keys(MODEL_BY_ID).length, 180);
  for (const biome of ['temperate', 'arid', 'snowy', 'wetland']) {
    assert.equal(MODEL_CATALOG.filter(model => model.biome === biome).length, 40);
  }
});

test('GLB geometria real respeita bounds, pivô, footprint e porta declarados', () => {
  for (const entry of Object.values(MODEL_BY_ID)) {
    const bytes = readFileSync(new URL('..' + entry.src, import.meta.url));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67, entry.id);
    assert.equal(bytes.readUInt32LE(4), 2, entry.id);
    assert.equal(bytes.readUInt32LE(8), bytes.length, entry.id);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const node of gltf.nodes) {
      assert.ok(!node.matrix && !node.translation && !node.rotation && !node.scale, `${entry.id}: baked transform`);
    }
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
      const position = gltf.accessors[primitive.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], position.min[i]);
        max[i] = Math.max(max[i], position.max[i]);
      }
    }
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(min[i] - entry.bounds.min[i]) < 0.001, `${entry.id} min axis ${i}`);
      assert.ok(Math.abs(max[i] - entry.bounds.max[i]) < 0.001, `${entry.id} max axis ${i}`);
    }
    assert.ok(max[0] - min[0] <= entry.footprint.width + 0.001, entry.id);
    assert.ok(max[2] - min[2] <= entry.footprint.height + 0.001, entry.id);
    assert.ok(Math.abs(min[1]) < 0.001, entry.id);
    assert.ok(Math.abs(min[0] + max[0]) < 0.001 && Math.abs(min[2] + max[2]) < 0.001, entry.id);
    assert.deepEqual(entry.rotations, [0, 90, 180, 270]);
    if (entry.kind === 'building') {
      assert.ok(entry.entrance[2] > 0, `${entry.id}: facade +Z`);
      assert.ok(entry.entrance[0] >= min[0] && entry.entrance[0] <= max[0], entry.id);
      if (entry.family !== 'market') {
        const leaf = gltf.meshes.flatMap(mesh => mesh.primitives).find(primitive => gltf.materials[primitive.material]?.name === 'Door oak');
        assert.ok(leaf, `${entry.id}: door leaf geometry`);
        const bottom = gltf.accessors[leaf.attributes.POSITION].min[1];
        assert.ok(Math.abs(bottom - entry.entrance[1]) < .001, `${entry.id}: actual door threshold`);
      }
    }
  }
});

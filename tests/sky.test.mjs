import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WalkSky } from '../src/render/sky.js';

test('walk sky has finite original geometry and a complete horizon', () => {
  const sky = new WalkSky();
  for (const mesh of sky.group.children) {
    assert.ok(Array.from(mesh.geometry.attributes.position.array).every(Number.isFinite));
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.material.toneMapped, false);
  }
  for (const layer of sky.layers) {
    const p = layer.geometry.attributes.position;
    assert.equal(p.count, 192 * 6);
    assert.equal(p.getX(0), p.getX(p.count - 4));
    assert.equal(p.getZ(0), p.getZ(p.count - 4));
  }
  sky.dispose();
});

test('camera movement produces distinct parallax without mutating map', () => {
  const sky = new WalkSky(), camera = new THREE.PerspectiveCamera();
  const map = Object.freeze({ width: 96, height: 64, settings: Object.freeze({ biome: 'arid' }) });
  camera.position.set(40, 2, 30); sky.update(camera, map);
  const previous = sky.layers.map(layer => layer.position.x), cloudX = sky.clouds.position.x;
  camera.position.x += 10; sky.update(camera, map);
  assert.deepEqual(sky.dome.position.toArray(), camera.position.toArray());
  sky.layers.forEach((layer, i) => assert.ok(Math.abs(layer.position.x - previous[i] - (8 - i * 2)) < 1e-9));
  assert.ok(Math.abs(sky.clouds.position.x - cloudX - 9.7) < 1e-9);
  assert.ok(sky.layers.every(layer => layer.scale.x > Math.hypot(map.width, map.height)));
  assert.equal(sky.layers[0].material.uniforms.color.value.getHexString(), 'b9ab95');
  sky.update(camera, { ...map, settings: { biome: 'snowy' } });
  assert.equal(sky.layers[0].material.uniforms.color.value.getHexString(), 'b4c6d0');
  sky.dispose();
});

test('disposal releases every GPU resource exactly once', () => {
  const sky = new WalkSky(); let disposed = 0;
  for (const mesh of sky.group.children) {
    mesh.geometry.addEventListener('dispose', () => disposed++);
    mesh.material.addEventListener('dispose', () => disposed++);
  }
  const expected = sky.group.children.length * 2;
  sky.dispose(); sky.dispose();
  assert.equal(disposed, expected);
  assert.equal(sky.group.children.length, 0);
});

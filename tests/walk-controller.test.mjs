import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WalkController } from '../src/render/walk-controller.js';

function controller(keys = ['KeyW']) {
  const walk = Object.create(WalkController.prototype);
  Object.assign(walk, {
    state: 'active', camera: new THREE.PerspectiveCamera(), keys: new Set(keys),
    position: { x: 0, y: 0, z: 0 }, accumulator: 0, jumpHeight: 0, verticalSpeed: 0, jumpQueued: false,
    navigation: { move: (p, dx, dz) => ({ x: p.x + dx, y: 0, z: p.z + dz }), canOccupy: () => true }
  });
  return walk;
}
function simulate(walk, fps = 60) {
  walk.update(0);
  for (let frame = 1; frame <= fps; frame++) walk.update(frame * 1000 / fps);
  return Math.hypot(walk.position.x, walk.position.z);
}
test('walk diagonal is normalized and sprint uses its separate speed', () => {
  const forward = simulate(controller());
  const diagonal = simulate(controller(['KeyW','KeyD']));
  const sprint = simulate(controller(['KeyW','ShiftLeft']));
  assert.ok(Math.abs(forward - diagonal) < 1e-8);
  assert.ok(Math.abs(forward - 2.5) < .05);
  assert.ok(Math.abs(sprint / forward - 1.6) < 1e-8);
});
test('walk movement is independent of rendering fps and eye height remains fixed', () => {
  const a = controller(), b = controller();
  assert.ok(Math.abs(simulate(a, 30) - simulate(b, 120)) < .05);
  assert.equal(a.camera.position.y, 1.08);
});
test('jump rises, lands exactly and does not bounce without another keypress', () => {
  const walk = controller([]);
  walk.jumpQueued = true;
  let peak = 0;
  for (let i = 0; i <= 120; i++) { walk.update(i * 1000 / 60); peak = Math.max(peak, walk.jumpHeight); }
  assert.ok(peak > .8 && peak < .9);
  assert.equal(walk.jumpHeight, 0);
  assert.equal(walk.verticalSpeed, 0);
  assert.equal(walk.camera.position.y, 1.08);
});
test('jump ceiling collision stops ascent and pause freezes vertical motion', () => {
  const walk = controller([]);
  walk.navigation.canOccupy = (x,z,y) => y <= .3;
  walk.jumpQueued = true;
  let peak = 0;
  for (let i = 0; i < 20; i++) { walk.update(i * 1000 / 60); peak = Math.max(peak, walk.jumpHeight); }
  assert.ok(peak <= .3);
  walk.state = 'paused';
  const height = walk.jumpHeight;
  walk.update(10000);
  assert.equal(walk.jumpHeight, height);
});
test('long delays are clamped, opposing keys cancel, paused state does not simulate', () => {
  const walk = controller();
  walk.update(0); walk.update(100000);
  assert.ok(Math.hypot(walk.position.x, walk.position.z) <= .251);
  assert.equal(simulate(controller(['KeyW','KeyS','KeyA','KeyD'])), 0);
  walk.state = 'paused';
  const before = { ...walk.position };
  walk.update(200000);
  assert.deepEqual(walk.position, before);
});

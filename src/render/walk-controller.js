import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Navigation, EYE_HEIGHT } from './navigation.js';

export const JUMP_SPEED = 4.2;
export const GRAVITY = 10;

export class WalkController {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(65, 1, .05, 2000);
    this.controls = new PointerLockControls(this.camera, renderer.canvas);
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(5);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(175);
    this.state = 'aerial';
    this.keys = new Set();
    this.jumpHeight = 0;
    this.verticalSpeed = 0;
    this.jumpQueued = false;
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    this.controls.addEventListener('lock', () => {
      if (this.state === 'aerial') { this.controls.unlock(); return; }
      this.setState('active');
    });
    this.controls.addEventListener('unlock', () => {
      if (this.state !== 'aerial') this.setState('paused');
    });
    this.controls.addEventListener('change', () => renderer.draw());
    this.onLockError = () => {
      if (this.state !== 'aerial') this.exit();
      renderer.canvas.dispatchEvent(new CustomEvent('walkerror', { detail: 'O navegador não permitiu capturar o mouse. Clique em Passear para tentar novamente.' }));
    };
    document.addEventListener('pointerlockerror', this.onLockError, options);
    document.addEventListener('keydown', event => {
      if (event.code === 'Escape' && this.state === 'active') {
        event.preventDefault(); this.pause(); return;
      }
      if (event.code === 'Space' && this.state === 'active') {
        event.preventDefault();
        if (!event.repeat && this.jumpHeight === 0) this.jumpQueued = true;
        return;
      }
      if (this.state !== 'active' || !['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(event.code)) return;
      event.preventDefault(); this.keys.add(event.code);
    }, options);
    document.addEventListener('keyup', event => this.keys.delete(event.code), options);
    window.addEventListener('blur', () => this.pause(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }, options);
  }
  get available() {
    return Boolean(this.renderer.map && !this.renderer.metrics.contextLost && this.renderer.canvas.requestPointerLock && matchMedia('(any-pointer: fine)').matches);
  }
  setState(state) {
    this.state = state; this.keys.clear(); this.jumpQueued = false; this.lastTime = undefined; this.accumulator = 0;
    this.renderer.canvas.dispatchEvent(new CustomEvent('walkchange', { detail: { state } }));
    this.renderer.draw();
  }
  enter() {
    if (!this.available || this.state !== 'aerial') return false;
    this.navigation = new Navigation(this.renderer.map, this.renderer.surfaces);
    const spawn = this.navigation.findSpawn();
    if (!spawn) {
      this.navigation.dispose(); this.navigation = undefined;
      throw new Error('Não há um ponto seguro para começar o passeio nesta vila.');
    }
    this.savedCamera = this.renderer.camera.clone();
    this.savedTarget = this.renderer.controls.target.clone();
    this.renderer.controls.enabled = false;
    this.position = spawn;
    this.jumpHeight = 0; this.verticalSpeed = 0;
    this.camera.position.set(spawn.x, spawn.y + EYE_HEIGHT, spawn.z);
    const center = this.renderer.villageBounds.getCenter(new THREE.Vector3());
    this.camera.lookAt(center.x, this.camera.position.y, center.z);
    this.setState('paused');
    this.resume();
    return true;
  }
  resume() {
    if (this.state !== 'paused' || document.hidden) return;
    // The addon observes lock/unlock; use the native promise to handle denied requests too.
    try {
      this.renderer.canvas.requestPointerLock({ unadjustedMovement: false })?.catch(() => {
        if (this.state !== 'aerial') this.onLockError();
      });
    } catch { this.onLockError(); }
  }
  pause() {
    if (this.state === 'aerial') return;
    this.setState('paused');
    if (this.controls.isLocked) this.controls.unlock();
  }
  exit() {
    if (this.state === 'aerial') return;
    this.state = 'aerial';
    if (this.controls.isLocked) this.controls.unlock();
    this.renderer.camera.copy(this.savedCamera);
    this.renderer.controls.target.copy(this.savedTarget);
    this.renderer.controls.enabled = true;
    this.renderer.controls.update();
    this.navigation?.dispose(); this.navigation = undefined;
    this.setState('aerial');
  }
  update(time) {
    if (this.state !== 'active') return;
    const elapsed = this.lastTime === undefined ? 0 : Math.min(.1, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time; this.accumulator += elapsed;
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction); direction.y = 0; direction.normalize();
    const length = Math.hypot(forward, right) || 1;
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 2.5;
    const dx = (direction.x * forward - direction.z * right) / length * speed / 60;
    const dz = (direction.z * forward + direction.x * right) / length * speed / 60;
    while (this.accumulator >= 1 / 60) {
      const moved = this.navigation.move(this.position, dx, dz);
      if (!this.jumpHeight || this.navigation.canOccupy(moved.x, moved.z, moved.y + this.jumpHeight)) this.position = moved;
      if (this.jumpQueued && this.jumpHeight === 0) this.verticalSpeed = JUMP_SPEED;
      this.jumpQueued = false;
      if (this.jumpHeight > 0 || this.verticalSpeed > 0) {
        this.verticalSpeed -= GRAVITY / 60;
        const next = Math.max(0, this.jumpHeight + this.verticalSpeed / 60);
        if (this.navigation.canOccupy(this.position.x, this.position.z, this.position.y + next)) this.jumpHeight = next;
        else this.verticalSpeed = Math.min(0, this.verticalSpeed);
        if (this.jumpHeight === 0) this.verticalSpeed = 0;
      }
      this.accumulator -= 1 / 60;
    }
    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT + this.jumpHeight, this.position.z);
  }
  dispose() {
    this.exit(); this.abort.abort(); this.controls.dispose();
  }
}

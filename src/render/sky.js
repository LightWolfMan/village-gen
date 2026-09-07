import * as THREE from 'three';

const PALETTES = {
  temperate: ['#639dc6', '#dfebde', '#849fa0', '#718d80', '#637959'],
  arid: ['#7aa8c1', '#efdfb9', '#b9ab95', '#b19c79', '#94835b'],
  snowy: ['#7eaccb', '#eef4f3', '#b4c6d0', '#9bafbb', '#849ba7'],
  wetland: ['#819fae', '#d9e4d8', '#8da6a0', '#738f83', '#5c7966'],
};

// Background-only projection: independent of camera far clipping and scene fog.
const vertexShader = `varying vec3 direction;
void main() {
  direction = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
}`;
function material(color, gradient = false) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, zenith: { value: new THREE.Color(color) } },
    vertexShader,
    fragmentShader: `uniform vec3 color; uniform vec3 zenith; varying vec3 direction;
      void main() {
        float height = smoothstep(-0.06, 0.8, normalize(direction).y);
        gl_FragColor = vec4(${gradient ? 'mix(color, zenith, height)' : 'color'}, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, depthWrite: false, depthTest: false, toneMapped: false,
  });
}

function hillGeometry(layer) {
  const positions = [], segments = 192;
  const point = (i, bottom) => {
    const a = (i % segments) / segments * Math.PI * 2;
    const h = .055 + layer * .009 + .025 * Math.sin(a * 5 + layer) + .018 * Math.sin(a * 11 + layer * 2) + .008 * Math.cos(a * 23);
    return [Math.cos(a), bottom ? -2 : h, Math.sin(a)];
  };
  for (let i = 0; i < segments; i++) {
    const a = point(i, false), b = point(i + 1, false), c = point(i + 1, true), d = point(i, true);
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function cloudGeometry() {
  const positions = [];
  for (let cloud = 0; cloud < 14; cloud++) {
    const angle = cloud * 2.39996, elevation = .22 + (cloud % 4) * .085;
    for (let lobe = 0; lobe < 3; lobe++) {
      const offset = (lobe - 1) * .036;
      const point = (a, center = false) => {
        const x = offset + (center ? 0 : Math.cos(a) * .05);
        const y = elevation + (lobe === 1 ? .014 : 0) + (center ? 0 : Math.sin(a) * .022);
        return [Math.cos(angle) - Math.sin(angle) * x, y, Math.sin(angle) + Math.cos(angle) * x];
      };
      for (let s = 0; s < 16; s++) positions.push(...point(0, true), ...point(s / 16 * Math.PI * 2), ...point((s + 1) / 16 * Math.PI * 2));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class WalkSky {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'walk-sky';
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material('#dfebde', true));
    this.dome.renderOrder = -100;
    this.clouds = new THREE.Mesh(cloudGeometry(), material('#f4f4e9'));
    this.clouds.renderOrder = -99;
    this.layers = Array.from({ length: 3 }, (_, i) => {
      const mesh = new THREE.Mesh(hillGeometry(2 - i), material(PALETTES.temperate[i + 2]));
      mesh.renderOrder = -98 + i;
      return mesh;
    });
    this.group.add(this.dome, this.clouds, ...this.layers);
    this.group.traverse(object => { object.frustumCulled = false; });
    this.disposed = false;
  }

  update(camera, map) {
    if (this.disposed) return;
    const width = Math.max(1, Number(map?.width) || 96), height = Math.max(1, Number(map?.height) || 96);
    const radius = Math.max(300, Math.hypot(width, height) * 3);
    const palette = PALETTES[map?.settings?.biome] ?? PALETTES.temperate;
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(radius * 3);
    this.dome.material.uniforms.color.value.set(palette[1]);
    this.dome.material.uniforms.zenith.value.set(palette[0]);
    const place = (mesh, follow, scale) => {
      mesh.position.set(width / 2 + (camera.position.x - width / 2) * follow, camera.position.y * .8, height / 2 + (camera.position.z - height / 2) * follow);
      mesh.scale.setScalar(radius * scale);
    };
    place(this.clouds, .97, 1.8);
    this.layers.forEach((mesh, i) => {
      place(mesh, .8 - i * .2, 1.5 - i * .25);
      mesh.material.uniforms.color.value.set(palette[i + 2]);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.group.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    this.group.removeFromParent();
    this.group.clear();
    this.disposed = true;
  }
}

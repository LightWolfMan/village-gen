import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WalkController } from './walk-controller.js';
import { WalkSky } from './sky.js';
import { createSurfaces, levelAt, LEVEL_HEIGHT } from './surfaces.js';
import { MODEL_BY_ID, PROP_CATALOG, BRIDGE_CATALOG } from '../../assets/models/catalog.js';

export { LEVEL_HEIGHT };
export const CHUNK_SIZE = 16;
const COLORS = { grass: '#819356', forest: '#647b48', sand: '#c7b783', rock: '#85857d', 'dry-grass': '#b4a06a', scrub: '#a18d56', snow: '#dce5e8', 'pine-forest': '#c2d3d5', ice: '#b0ccd4', 'snow-rock': '#9aaab0', 'wet-grass': '#74855d', 'swamp-forest': '#536d53', marsh: '#839273', water: '#657d78' };
const ZONES = { residential: '#70b4e5', commercial: '#efcc62', craft: '#dd9374', agricultural: '#a9ce73', civic: '#c0a3e2' };
export const orientationAngle = (orientation) => ({ south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 })[orientation] ?? 0;
export function buildingTransform(building) {
  return new THREE.Matrix4().compose(new THREE.Vector3(building.x + building.width / 2, building.baseLevel * LEVEL_HEIGHT, building.y + building.height / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), orientationAngle(building.orientation)), new THREE.Vector3(1, 1, 1));
}
function geometryBuilder() {
  const positions = [], colors = [];
  return {
    quad(a, b, c, d, color) {
      const rgb = new THREE.Color(color);
      for (const p of [a, b, c, a, c, d]) { positions.push(...p); colors.push(rgb.r, rgb.g, rgb.b); }
    },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      return geometry;
    }
  };
}
export function terrainChunkGeometry(map, startX, startZ, roadCells = new Set()) {
  const g = geometryBuilder();
  for (let z = startZ; z < Math.min(map.height, startZ + CHUNK_SIZE); z++) for (let x = startX; x < Math.min(map.width, startX + CHUNK_SIZE); x++) {
    const i = z * map.width + x, type = map.terrain[i];
    const y = type === 'water' ? -.16 : levelAt(map, x, z);
    const color = new THREE.Color(COLORS[type] ?? COLORS.grass).multiplyScalar(.95 + ((x * 17 + z * 29) % 11) / 110);
    // The road is the top surface of these cells; a flat terrain cap would hide uphill ramps.
    if (!roadCells.has(i)) g.quad([x,y,z], [x,y,z+1], [x+1,y,z+1], [x+1,y,z], color);
    const edges = [[x-1,z, [x,y,z], [x,y,z+1]], [x+1,z, [x+1,y,z+1], [x+1,y,z]], [x,z-1,[x+1,y,z],[x,y,z]], [x,z+1,[x,y,z+1],[x+1,y,z+1]]];
    for (const [nx,nz,a,b] of edges) {
      if (roadCells.has(i) && nx >= 0 && nx < map.width && nz >= 0 && nz < map.height && roadCells.has(nz * map.width + nx)) continue;
      const low = levelAt(map,nx,nz);
      if (low < y) g.quad(a,b,[b[0],low,b[2]],[a[0],low,a[2]],color.clone().multiplyScalar(.76));
    }
  }
  return g.finish();
}
export function fitCamera(camera, target, bounds, aspect, padding = 1.1) {
  const direction = camera.position.clone().sub(target).normalize();
  if (direction.lengthSq() < .01) direction.set(1,1,1).normalize();
  const center = bounds.getCenter(new THREE.Vector3());
  camera.position.copy(center).addScaledVector(direction, Math.max(100, bounds.getSize(new THREE.Vector3()).length() * 2));
  camera.lookAt(center); camera.updateMatrixWorld(true);
  const projected = new THREE.Box3();
  for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
  const size = projected.getSize(new THREE.Vector3());
  const half = Math.max(size.y, size.x / aspect, 1) * padding / 2;
  camera.left=-half*aspect; camera.right=half*aspect; camera.top=half; camera.bottom=-half;
  camera.near=.01; camera.far=2000; camera.zoom=1; camera.updateProjectionMatrix(); target.copy(center);
}

function addMesh(world, geometry, material) {
  const mesh = new THREE.Mesh(geometry,material); mesh.receiveShadow=true; world.add(mesh); return mesh;
}
function addEnvironment(world,map,surfaces) {
  const ground = new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide});
  world.userData.materials.add(ground);
  const roads = surfaces.roadCells;
  for(let z=0;z<map.height;z+=CHUNK_SIZE) for(let x=0;x<map.width;x+=CHUNK_SIZE) addMesh(world,terrainChunkGeometry(map,x,z,roads),ground);
  const paths=geometryBuilder(), water=geometryBuilder(), zones=geometryBuilder();
  for(const path of surfaces.paths) paths.quad(...path.vertices,path.color);
  addMesh(world,paths.finish(),ground);
  for(let z=0;z<map.height;z++)for(let x=0;x<map.width;x++){
    const i=z*map.width+x;
    if(map.terrain[i]==='water')water.quad([x,.015,z],[x,.015,z+1],[x+1,.015,z+1],[x+1,.015,z],'#ffffff');
    else if(ZONES[map.zoneMap[i]]) { const h=levelAt(map,x,z)+.08;zones.quad([x,h,z],[x,h,z+1],[x+1,h,z+1],[x+1,h,z],ZONES[map.zoneMap[i]]); }
  }
  const wet = new THREE.MeshStandardMaterial({color:map.settings.biome==='wetland'?'#587b6d':'#588e9c',roughness:.32,metalness:.15,transparent:true,opacity:.86,side:THREE.DoubleSide});
  const zoneMaterial=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide});
  world.userData.materials.add(wet);world.userData.materials.add(zoneMaterial);
  world.userData.water=addMesh(world,water.finish(),wet);
  world.userData.zones=addMesh(world,zones.finish(),zoneMaterial);world.userData.zones.renderOrder=2;
}

function disposeWorld(world) {
  if(!world)return;
  world.traverse(mesh=>{if(mesh.isInstancedMesh)mesh.dispose();else if(mesh.geometry)mesh.geometry.dispose();});
  for(const material of world.userData.materials??[])material.dispose();
}

export class VillageRenderer {
  constructor(canvas) {
    this.canvas=canvas;this.quality='standard';this.showZones=false;this.serial=0;this.cache=new Map();this.loader=new GLTFLoader();
    this.metrics={buildMs:0,frameMs:0,frames:0,drawCalls:0,triangles:0,geometries:0,textures:0,contextLost:false};
    this.gl=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.gl.setPixelRatio(1);this.gl.outputColorSpace=THREE.SRGBColorSpace;this.gl.toneMapping=THREE.ACESFilmicToneMapping;this.gl.toneMappingExposure=1.15;
    this.gl.shadowMap.enabled=true;this.gl.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#c9c9ce');
    this.sky=new WalkSky();this.sky.group.visible=false;this.scene.add(this.sky.group);
    this.scene.add(new THREE.HemisphereLight('#edf3ff','#66694d',2));
    this.sun=new THREE.DirectionalLight('#fff0d8',3);this.sun.castShadow=true;this.sun.shadow.mapSize.set(1024,1024);this.sun.shadow.normalBias=.045;this.sun.shadow.bias=-.0003;
    this.scene.add(this.sun,this.sun.target);
    this.camera=new THREE.OrthographicCamera(-50,50,40,-40,.01,2000);this.camera.position.set(70,60,70);
    this.controls=new OrbitControls(this.camera,canvas);this.controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
    this.controls.minPolarAngle=Math.PI/18;this.controls.maxPolarAngle=7*Math.PI/18;this.controls.minZoom=.25;this.controls.maxZoom=8;this.controls.screenSpacePanning=false;
    this.controls.addEventListener('change',()=>{canvas.dispatchEvent(new CustomEvent('camerachange',{detail:{zoom:this.camera.zoom}}));this.draw();});
    this.walk=new WalkController(this);
    this.onLost=e=>{e.preventDefault();this.walk.exit();this.metrics.contextLost=true;cancelAnimationFrame(this.frame);this.frame=0;};
    this.onRestored=()=>{this.metrics.contextLost=false;this.draw();};
    canvas.addEventListener('webglcontextlost',this.onLost);canvas.addEventListener('webglcontextrestored',this.onRestored);
    this.onVisibility=()=>this.draw();document.addEventListener('visibilitychange',this.onVisibility);
    this.resize=new ResizeObserver(()=>this.resizeView());this.resize.observe(canvas);this.resizeView();
  }
  get activeCamera(){return this.walk?.state !== 'aerial' && this.walk ? this.walk.camera : this.camera;}
  enterWalk(){return this.walk.enter();}
  pauseWalk(){this.walk.pause();}
  resumeWalk(){this.walk.resume();}
  exitWalk(){this.walk.exit();}
  resizeView(){const w=this.canvas.clientWidth||1366,h=this.canvas.clientHeight||768;this.gl.setSize(w,h,false);this.camera.left=-this.camera.top*w/h;this.camera.right=this.camera.top*w/h;this.camera.updateProjectionMatrix();if(this.walk){this.walk.camera.aspect=w/h;this.walk.camera.updateProjectionMatrix();}this.draw();}
  async loadAsset(asset){
    if(!this.cache.has(asset.id))this.cache.set(asset.id,this.loader.loadAsync(asset.src).then(gltf=>{
      gltf.scene.updateMatrixWorld(true);const parts=[];
      gltf.scene.traverse(mesh=>{if(mesh.isMesh){const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);parts.push({geometry,material:mesh.material});mesh.geometry.dispose();}});
      if(!parts.length)throw new Error(`Modelo vazio: ${asset.id}`);return parts;
    }).catch(error=>{this.cache.delete(asset.id);throw error;}));
    return this.cache.get(asset.id);
  }
  async addModels(world,map,surfaces){
    const batches=new Map();
    const add=(asset,matrix)=>{if(!asset)throw new Error('Modelo ausente no catálogo');if(!batches.has(asset.id))batches.set(asset.id,{asset,matrices:[]});batches.get(asset.id).matrices.push(matrix);};
    for(const b of map.buildings)add(MODEL_BY_ID[b.assetId],buildingTransform(b));
    for(const p of map.props){const asset=PROP_CATALOG.find(a=>a.id===`prop:${p.type}`);if(!asset)continue;
      add(asset,new THREE.Matrix4().compose(new THREE.Vector3(p.x+.5,p.level*LEVEL_HEIGHT,p.y+.5),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),p.variant*Math.PI/3),new THREE.Vector3(1,1,1)));
    }
    const ramps=geometryBuilder();
    for(const {span,deck} of surfaces.bridges){
      for(const index of span.roadIndexes){const r=map.roads[index];const asset=BRIDGE_CATALOG.find(a=>a.id===`bridge:${r.bridgeRole}`);
        add(asset,new THREE.Matrix4().compose(new THREE.Vector3(r.x+.5,deck,r.y+.5),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),span.axis==='ns'?-Math.PI/2:0),new THREE.Vector3(1,1,1)));
      }
    }
    for(const ramp of surfaces.ramps) ramps.quad(...ramp.vertices,ramp.color);
    const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide});world.userData.materials.add(mat);addMesh(world,ramps.finish(),mat);
    const pending=[...batches.values()];let cursor=0;
    // Wait for all loaders before disposing a failed world: otherwise late loaders
    // could add meshes to a group that has already been released.
    const loaded=await Promise.allSettled(Array.from({length:Math.min(6,pending.length)},async()=>{while(cursor<pending.length){const {asset,matrices}=pending[cursor++];const parts=await this.loadAsset(asset);
      for(const part of parts){const mesh=new THREE.InstancedMesh(part.geometry,part.material,matrices.length);matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();world.add(mesh);}
    }}));
    const failure=loaded.find(result=>result.status==='rejected');
    if(failure)throw failure.reason;
  }
  async setMap(map,{isCurrent=()=>true}={}){
    if(map.schemaVersion!==4)throw new Error('O renderer exige VillageMap v4.');
    const request=++this.serial,start=performance.now(),world=new THREE.Group();world.userData.materials=new Set();
    const surfaces=createSurfaces(map);
    try{addEnvironment(world,map,surfaces);await this.addModels(world,map,surfaces);
      if(request!==this.serial||!isCurrent()||this.disposed){disposeWorld(world);return false;}
      this.exitWalk();this.surfaces=surfaces;
      const previous=this.world;this.world=world;this.map=map;this.scene.add(world);if(previous)this.scene.remove(previous);disposeWorld(previous);
      this.bounds=new THREE.Box3().setFromObject(world);this.villageBounds=new THREE.Box3();
      for(const b of map.buildings){const model=MODEL_BY_ID[b.assetId];this.villageBounds.union(new THREE.Box3(new THREE.Vector3(...model.bounds.min),new THREE.Vector3(...model.bounds.max)).applyMatrix4(buildingTransform(b)));}
      if(this.villageBounds.isEmpty())this.villageBounds.copy(this.bounds);
      const c=this.villageBounds.getCenter(new THREE.Vector3()),radius=Math.max(18,this.villageBounds.getSize(new THREE.Vector3()).length()/2);
      this.sun.position.copy(c).add(new THREE.Vector3(-40,75,30));this.sun.target.position.copy(c);
      Object.assign(this.sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:.5,far:220});this.sun.shadow.camera.updateProjectionMatrix();
      world.userData.zones.visible=this.showZones;this.center();this.metrics.buildMs=performance.now()-start;this.draw();return true;
    }catch(error){disposeWorld(world);throw error;}
  }
  center({whole=false}={}){if(!this.world)return;fitCamera(this.camera,this.controls.target,whole?this.bounds:this.villageBounds,this.canvas.clientWidth/Math.max(1,this.canvas.clientHeight),1.13);this.controls.update();this.draw();}
  setZoom(value){this.camera.zoom=THREE.MathUtils.clamp(value,.25,8);this.camera.updateProjectionMatrix();this.controls.update();this.draw();}
  setShowZones(value){this.showZones=Boolean(value);if(this.world)this.world.userData.zones.visible=this.showZones;this.draw();}
  setQuality(value){this.quality=value;this.gl.shadowMap.enabled=value!=='economy';this.scene.traverse(o=>{if(o.material)for(const m of [].concat(o.material))m.needsUpdate=true;});this.draw();}
  draw(animation=false){if(!animation)this.animateUntil=performance.now()+1200;if(this.frame||this.disposed||this.metrics.contextLost||document.hidden)return;this.frame=requestAnimationFrame(()=>{this.frame=0;const start=performance.now();
    if(this.world&&this.quality==='standard')this.world.userData.water.material.opacity=.85+Math.sin(start*.0007)*.015;
    this.walk.update(start);
    this.sky.group.visible=this.walk.state!=='aerial';
    if(this.sky.group.visible)this.sky.update(this.activeCamera,this.map);
    this.gl.render(this.scene,this.activeCamera);Object.assign(this.metrics,{frameMs:performance.now()-start,frames:this.metrics.frames+1,drawCalls:this.gl.info.render.calls,triangles:this.gl.info.render.triangles,geometries:this.gl.info.memory.geometries,textures:this.gl.info.memory.textures});
    if(this.walk.state==='active'||(this.world&&this.quality==='standard'&&start<this.animateUntil))this.draw(true);
  });}
  async exportCanvas(){
    if(!this.world)throw new Error('Gere uma vila primeiro.');
    if(this.metrics.contextLost)throw new Error('Aguarde a recuperação do contexto WebGL antes de exportar.');
    const context=this.gl.getContext(),width=Math.min(4096,this.gl.capabilities.maxTextureSize,context.getParameter(context.MAX_RENDERBUFFER_SIZE)),height=Math.round(width/1.45);
    const camera=this.camera.clone();fitCamera(camera,this.controls.target.clone(),this.bounds,width/height,1.09);
    const target=new THREE.WebGLRenderTarget(width,height);target.texture.colorSpace=THREE.SRGBColorSpace;
    const previous=this.gl.getRenderTarget(),viewport=this.gl.getViewport(new THREE.Vector4());
    const skyVisible=this.sky.group.visible;this.sky.group.visible=false;
    try{this.gl.setRenderTarget(target);this.gl.render(this.scene,camera);const bytes=new Uint8Array(width*height*4);this.gl.readRenderTargetPixels(target,0,0,width,height,bytes);
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(width,height);
      for(let row=0;row<height;row++)pixels.data.set(bytes.subarray((height-row-1)*width*4,(height-row)*width*4),row*width*4);
      ctx.putImageData(pixels,0,0);return canvas;
    }finally{this.sky.group.visible=skyVisible;this.gl.setRenderTarget(previous);this.gl.setViewport(viewport);target.dispose();this.draw();}
  }
  dispose(){this.walk.dispose();this.sky.dispose();this.disposed=true;this.serial++;cancelAnimationFrame(this.frame);this.resize.disconnect();this.controls.dispose();disposeWorld(this.world);
    for(const promise of this.cache.values())promise.then(parts=>{const materials=new Set();for(const p of parts){p.geometry.dispose();for(const m of [].concat(p.material))materials.add(m);}for(const m of materials)m.dispose();}).catch(()=>{});
    this.canvas.removeEventListener('webglcontextlost',this.onLost);this.canvas.removeEventListener('webglcontextrestored',this.onRestored);document.removeEventListener('visibilitychange',this.onVisibility);this.sun.shadow.dispose();this.gl.dispose();
  }
}
export async function canvasToPngBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Não foi possível exportar PNG.')),'image/png'));}

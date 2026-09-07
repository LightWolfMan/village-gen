import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MODEL_CATALOG } from '../assets/models/catalog.js';
import { buildingTransform, fitCamera, terrainChunkGeometry, CHUNK_SIZE, canvasToPngBlob } from '../src/render/renderer.js';

test('modelos mantêm escala real, quatro rotações e porta do catálogo',()=>{
  for(const model of MODEL_CATALOG)for(const orientation of ['south','east','north','west']){
    const rotated=['east','west'].includes(orientation);
    const b={x:8,y:13,width:rotated?model.footprint.height:model.footprint.width,height:rotated?model.footprint.width:model.footprint.height,baseLevel:3,orientation};
    const matrix=buildingTransform(b), bounds=new THREE.Box3(new THREE.Vector3(...model.bounds.min),new THREE.Vector3(...model.bounds.max)).applyMatrix4(matrix);
    assert.ok(bounds.min.x>=b.x-1e-5&&bounds.max.x<=b.x+b.width+1e-5);
    assert.ok(bounds.min.z>=b.y-1e-5&&bounds.max.z<=b.y+b.height+1e-5);
    assert.ok(Math.abs(matrix.determinant()-1)<1e-6,'Não encolher geometria para caber');
    assert.ok(Math.abs(bounds.min.y-.75)<1e-5);
  }
});
test('enquadramento ortográfico contém todos os oito cantos sem alterar direção',()=>{
  for(const aspect of [.6,1,1.45,2.4]){
    const camera=new THREE.OrthographicCamera(),target=new THREE.Vector3(20,0,20);camera.position.set(60,70,80);
    const direction=camera.position.clone().sub(target).normalize(),bounds=new THREE.Box3(new THREE.Vector3(0,-.6,0),new THREE.Vector3(128,9,96));
    fitCamera(camera,target,bounds,aspect);camera.updateMatrixWorld(true);
    assert.ok(camera.position.clone().sub(target).normalize().distanceTo(direction)<1e-6);
    for(const x of [0,128])for(const y of [-.6,9])for(const z of [0,96]){const p=new THREE.Vector3(x,y,z).project(camera);assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&Math.abs(p.z)<1);}
  }
});
test('terreno em chunks preserva limites e altura vertical de 0.25',()=>{
  const map={width:18,height:18,terrain:Array(324).fill('grass'),heightLevel:Array(324).fill(4)};
  const geometry=terrainChunkGeometry(map,16,16);geometry.computeBoundingBox();
  assert.equal(CHUNK_SIZE,16);assert.equal(geometry.boundingBox.min.x,16);assert.equal(geometry.boundingBox.max.x,18);assert.equal(geometry.boundingBox.max.y,1);
  assert.equal(geometry.getAttribute('color').count,geometry.getAttribute('position').count);geometry.dispose();
});
test('PNG relata erro de exportação e retorna blob válido',async()=>{
  await assert.rejects(canvasToPngBlob({toBlob:callback=>callback(null)}));
  const blob=new Blob(['png'],{type:'image/png'});assert.equal(await canvasToPngBlob({toBlob:callback=>callback(blob)}),blob);
});
test('ruas substituem o topo plano para rampas não atravessarem terreno',()=>{
  const map={width:1,height:1,terrain:['grass'],heightLevel:[4]};
  const ground=terrainChunkGeometry(map,0,0),road=terrainChunkGeometry(map,0,0,new Set([0]));
  assert.equal(ground.getAttribute('position').count-road.getAttribute('position').count,6);
  ground.dispose();road.dispose();
});

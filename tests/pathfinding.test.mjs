import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../src/core/pathfinding.js';

test('travessia acima do limite é recusada quando não existe margem alternativa',()=>{
  const path=findPath(12,5,{x:1,y:2},{x:10,y:2},()=>1,{isWater:x=>x>=2&&x<=9,maxWaterRun:7});
  assert.deepEqual(path,[]);
});
test('via contorna pela margem quando ponte seria comprida demais',()=>{
  const isWater=(x,y)=>x>=2&&x<=9&&y>=1&&y<=3;
  const path=findPath(12,5,{x:1,y:2},{x:10,y:2},()=>1,{isWater,maxWaterRun:3,turnPenalty:.3});
  assert.ok(path.length>10);assert.ok(path.every(p=>!isWater(p.x,p.y)));
});
test('ponte existente não pode ser reutilizada perpendicularmente',()=>{
  const path=findPath(7,7,{x:1,y:3},{x:5,y:3},()=>1,{isWater:x=>x===3,maxWaterRun:1,bridgeAxisAt:()=> 'ns'});
  assert.deepEqual(path,[]);
});
test('cada trecho sobre água conserva direção de entrada e saída',()=>{
  const isWater=(x,y)=>x>=3&&x<=5&&y>=1&&y<=6;
  const path=findPath(9,8,{x:1,y:2},{x:7,y:5},()=>1,{isWater,maxWaterRun:4,turnPenalty:.4});
  assert.ok(path.some(p=>isWater(p.x,p.y)));
  for(let i=1;i<path.length-1;i++)if(isWater(path[i].x,path[i].y)){
    assert.equal(path[i].x-path[i-1].x,path[i+1].x-path[i].x);
    assert.equal(path[i].y-path[i-1].y,path[i+1].y-path[i].y);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Navigation, PLAYER_RADIUS, MAX_SLOPE} from '../src/render/navigation.js';
import {createSurfaces, levelAt} from '../src/render/surfaces.js';
import {MODEL_BY_ID} from '../assets/models/catalog.js';

function fixture(width=12,height=12) {
  return {width,height,heightLevel:Array(width*height).fill(0),terrain:Array(width*height).fill('grass'),roads:[],buildings:[],props:[],bridgeSpans:[],plaza:{x:4,y:4,width:3,height:3}};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
function bridgeFixture(axis) {
  const map=fixture();
  for(let z=0;z<map.height;z++) for(let x=0;x<map.width;x++) if((axis==='ew'?x:z)>=4&&(axis==='ew'?x:z)<=6) map.terrain[z*map.width+x]='water';
  const coord = t => axis==='ew'?{x:t,y:5}:{x:5,y:t};
  map.roads=Array.from({length:9},(_,i)=>({...coord(i+1),bridge:i+1>=4&&i+1<=6,kind:'main'}));
  map.bridgeSpans=[{axis,entry:coord(3),exit:coord(7),roadIndexes:[3,4,5]}];
  return map;
}

test('dry terrain, water, world boundaries and footprint support',()=>{
  const map=fixture();map.terrain[5*12+5]='water';map.heightLevel[3*12+3]=2;
  const nav=new Navigation(map);
  near(nav.surfaceAt(3.5,3.5).height,.5);
  assert.equal(nav.surfaceAt(5.5,5.5),null);
  assert.equal(nav.canStand(4.9,5.5),false);
  assert.equal(nav.canStand(PLAYER_RADIUS/2,2),false);
  assert.equal(nav.surfaceAt(12,2),null);assert.equal(nav.surfaceAt(NaN,2),null);
  assert.equal(nav.canStand(3.5,3.5,0),false);
  near(levelAt(map,-1,0),-.6);
});

test('road heights interpolate the exact renderer triangles, including nonplanar corners',()=>{
  const map=fixture();
  map.roads=[{x:4,y:4},{x:5,y:4},{x:4,y:5},{x:5,y:5}];
  map.heightLevel[4*12+5]=2;map.heightLevel[5*12+5]=4;
  const surfaces=createSurfaces(map),nav=new Navigation(map,surfaces);
  const [a,b,c,d]=surfaces.paths[0].vertices;
  near(nav.surfaceAt((a[0]+b[0]+c[0])/3,(a[2]+b[2]+c[2])/3).height,(a[1]+b[1]+c[1])/3);
  near(nav.surfaceAt((a[0]+c[0]+d[0])/3,(a[2]+c[2]+d[2])/3).height,(a[1]+c[1]+d[1])/3);
  near(nav.surfaceAt(5,4.5).height,(d[1]+c[1])/2);
});

test('access paths preserve entrance height and slope; steep surfaces are rejected',()=>{
  const map=fixture();map.buildings=[{accessPath:[{x:3,y:3},{x:5,y:3}],entrance:{level:4}}];
  const surfaces=createSurfaces(map),nav=new Navigation(map,surfaces);
  near(surfaces.paths[0].vertices[0][1],1.035);
  near(nav.surfaceAt(4,3).height,.54);
  near(nav.surfaceAt(4,3).slope,Math.atan(.99/2));
  const steep={roadCells:new Set(),paths:[{vertices:[[2,0,2],[2,0,4],[4,4,4],[4,4,2]]}],ramps:[],bridges:[]};
  const steepNav=new Navigation(fixture(),steep);
  assert.ok(steepNav.surfaceAt(3,3).slope>MAX_SLOPE);assert.equal(steepNav.canStand(3,3),false);
});

for(const axis of ['ew','ns']) test(`bridge ${axis}: shared deck, ramps, rails, full traversal both ways`,()=>{
  const map=bridgeFixture(axis),surfaces=createSurfaces(map),nav=new Navigation(map,surfaces);
  const p=t=>axis==='ew'?{x:t,z:5.5}:{x:5.5,z:t};
  near(surfaces.bridges[0].deck,.08);near(surfaces.bridges[0].height,.2625);
  for(const t of [4,4.5,5.5,6.9]) {const c=p(t);near(nav.surfaceAt(c.x,c.z).height,.2625);assert.ok(nav.canStand(c.x,c.z));}
  const approach=p(3.5);near(nav.surfaceAt(approach.x,approach.z).height,(.045+.2625)/2);
  const side=axis==='ew'?{x:5.5,z:5.29}:{x:5.29,z:5.5};assert.equal(nav.canStand(side.x,side.z),false);
  const start=p(2.5),end=nav.move({...start,y:.045},axis==='ew'?6:0,axis==='ns'?6:0);
  near(axis==='ew'?end.x:end.z,8.5);near(end.y,.045);
  const back=nav.move(end,axis==='ew'?-6:0,axis==='ns'?-6:0);
  near(back.x,start.x);near(back.z,start.z);near(back.y,.045);
  const middle=p(5.5),lateral=nav.move({...middle,y:.2625},axis==='ns'?2:0,axis==='ew'?2:0);
  assert.ok((axis==='ew'?lateral.z:lateral.x)<=5.71);
});

test('unequal bridge bank levels preserve the deck maximum and match both ramp endpoints',()=>{
  const map=bridgeFixture('ew');map.heightLevel[5*12+7]=2;
  const surfaces=createSurfaces(map),nav=new Navigation(map,surfaces);
  near(surfaces.bridges[0].height,.7625);
  near(nav.surfaceAt(3.5,5.5).height,(.045+.7625)/2);
  near(nav.surfaceAt(7.5,5.5).height,(.545+.7625)/2);
});

test('rotated building bounds match measured assets rather than declared footprints',()=>{
  const map=fixture(20,20),model=MODEL_BY_ID['temperate:cottage:0'];
  map.buildings=[{assetId:model.id,x:5,y:5,width:3,height:4,baseLevel:0,orientation:'east'}];
  const nav=new Navigation(map),cx=6.5,cz=7;
  assert.equal(nav.canStand(cx,cz),false);
  assert.equal(nav.canStand(cx+model.bounds.max[2]+.1,cz),false);
  assert.equal(nav.canStand(cx+model.bounds.max[2]+.2,cz),true);
  assert.equal(nav.canStand(cx,cz+model.bounds.max[0]+.1),false);
  const destination=nav.move({x:2,y:0,z:cz},14,0);
  assert.ok(destination.x<cx-model.bounds.max[2]-PLAYER_RADIUS+.001);
});

test('props use rotated measured bounds; trees block trunks, not canopies; foliage is traversable',()=>{
  const map=fixture(24,24);
  map.props=[{type:'oak',x:4,y:4,level:0},{type:'bush',x:8,y:8,level:0},{type:'reeds',x:10,y:10,level:0},{type:'cart',x:15,y:15,level:0,variant:1}];
  const nav=new Navigation(map);
  assert.equal(nav.canStand(4.5,4.5),false);assert.equal(nav.canStand(5.1,4.5),true);
  assert.equal(nav.canStand(8.5,8.5),true);assert.equal(nav.canStand(10.5,10.5),true);
  assert.equal(nav.canStand(15.5,16.5),false);assert.equal(nav.canStand(17,15.5),true);
});

test('movement subdivides long frames, blocks cliffs and water and slides along obstacles',()=>{
  const map=fixture(24,24);
  for(let z=0;z<24;z++) map.terrain[z*24+10]='water';
  const nav=new Navigation(map),start={x:2,y:0,z:2};
  assert.deepEqual(nav.move(start,0,0),start);
  const next=nav.move(start,18,5);
  assert.ok(next.x<10-PLAYER_RADIUS+.001);near(next.z,7);assert.deepEqual(start,{x:2,y:0,z:2});
  const cliff=fixture();for(let z=0;z<12;z++) for(let x=5;x<12;x++) cliff.heightLevel[z*12+x]=3;
  assert.ok(new Navigation(cliff).move({x:2,y:0,z:3},8,0).x<5-PLAYER_RADIUS+.001);
});

test('spawn is deterministic, near plaza, avoids the central well, and fails safely on all-water maps',()=>{
  const map=fixture();map.props=[{type:'well',x:5,y:5,level:0,variant:0}];
  const nav=new Navigation(map),spawn=nav.findSpawn();
  assert.deepEqual(spawn,nav.findSpawn());assert.ok(nav.canStand(spawn.x,spawn.z));assert.ok(Math.hypot(spawn.x-5.5,spawn.z-5.5)<3);
  const wet=fixture();wet.terrain.fill('water');assert.equal(new Navigation(wet).findSpawn(),null);
  nav.dispose();assert.equal(nav.surfaceIndex.size,0);assert.equal(nav.obstacleIndex.size,0);
});

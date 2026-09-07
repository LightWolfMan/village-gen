import {MODEL_BY_ID} from '../../assets/models/catalog.js';
import {createSurfaces, levelAt, LEVEL_HEIGHT} from './surfaces.js';

export const PLAYER_RADIUS = .18;
export const EYE_HEIGHT = 1.08;
export const MAX_STEP = .26;
export const MAX_SLOPE = Math.PI / 4;
const EPSILON = 1e-7;
const TREE_RADII = {oak:.27, pine:.18, willow:.30};
const angleFor = orientation => ({south:0,east:Math.PI/2,north:Math.PI,west:-Math.PI/2})[orientation] ?? 0;

function boundsFor(bounds, x, y, z, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), xs = [], zs = [];
  for (const px of [bounds.min[0],bounds.max[0]]) for (const pz of [bounds.min[2],bounds.max[2]]) {
    xs.push(x+px*c+pz*s); zs.push(z-px*s+pz*c);
  }
  return {minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs),minY:y+bounds.min[1],maxY:y+bounds.max[1]};
}

function triangleAt(vertices, x, z) {
  const [a,b,c] = vertices, ux=b[0]-a[0], uz=b[2]-a[2], vx=c[0]-a[0], vz=c[2]-a[2];
  const determinant=ux*vz-vx*uz;
  if (Math.abs(determinant)<EPSILON) return null;
  const u=((x-a[0])*vz-(z-a[2])*vx)/determinant, v=(ux*(z-a[2])-uz*(x-a[0]))/determinant;
  if (u < -EPSILON || v < -EPSILON || u+v > 1+EPSILON) return null;
  const uy=b[1]-a[1], vy=c[1]-a[1];
  const gx=(uy*vz-vy*uz)/determinant, gz=(ux*vy-vx*uy)/determinant;
  return {height:a[1]+u*uy+v*vy,slope:Math.atan(Math.hypot(gx,gz))};
}

export class Navigation {
  constructor(map, surfaces = createSurfaces(map)) {
    this.map=map; this.surfaces=surfaces; this.surfaceIndex=new Map(); this.obstacleIndex=new Map();
    for (const surface of [...surfaces.paths,...surfaces.ramps,...surfaces.bridges]) {
      const xs=surface.vertices.map(v=>v[0]), zs=surface.vertices.map(v=>v[2]);
      this.index(this.surfaceIndex,surface,{minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)});
    }
    const add = obstacle => this.index(this.obstacleIndex,obstacle,obstacle,PLAYER_RADIUS);
    for (const building of map.buildings) {
      const model=MODEL_BY_ID[building.assetId];
      if (model) add(boundsFor(model.bounds,building.x+building.width/2,building.baseLevel*LEVEL_HEIGHT,building.y+building.height/2,angleFor(building.orientation)));
    }
    for (const prop of map.props) {
      const model=MODEL_BY_ID[`prop:${prop.type}`];
      if (!model || ['bush','reeds'].includes(prop.type)) continue;
      const x=prop.x+.5,z=prop.y+.5,y=prop.level*LEVEL_HEIGHT,r=TREE_RADII[prop.type];
      if (r) add({x,z,r,minX:x-r,maxX:x+r,minZ:z-r,maxZ:z+r,minY:y,maxY:y+model.height});
      else add(boundsFor(model.bounds,x,y,z,(prop.variant??0)*Math.PI/3));
    }
    for (const bridge of surfaces.bridges) {
      const [a,,c]=bridge.vertices, ew=bridge.span.axis==='ew';
      // Continuous rails are centered .42 from the deck center and .06 thick.
      for (const side of [-1,1]) {
        const lateral=(ew?(a[2]+c[2])/2:(a[0]+c[0])/2)+side*.42;
        add({minX:ew?a[0]:lateral-.035,maxX:ew?c[0]:lateral+.035,
          minZ:ew?lateral-.035:a[2],maxZ:ew?lateral+.035:c[2],minY:bridge.deck,maxY:bridge.deck+.7});
      }
    }
  }
  index(index, value, bounds, padding=0) {
    for (let z=Math.max(0,Math.floor(bounds.minZ-padding));z<=Math.min(this.map.height-1,Math.floor(bounds.maxZ+padding));z++)
      for (let x=Math.max(0,Math.floor(bounds.minX-padding));x<=Math.min(this.map.width-1,Math.floor(bounds.maxX+padding));x++) {
        const key=z*this.map.width+x;
        if (!index.has(key)) index.set(key,[]);
        index.get(key).push(value);
      }
  }
  surfaceAt(x,z) {
    const map=this.map;
    if (!Number.isFinite(x)||!Number.isFinite(z)||x<0||z<0||x>=map.width||z>=map.height) return null;
    const tx=Math.floor(x),tz=Math.floor(z),key=tz*map.width+tx;
    let best=map.terrain[key]!=='water'&&!this.surfaces.roadCells.has(key)?{height:levelAt(map,tx,tz),slope:0}:null;
    for (const surface of this.surfaceIndex.get(key)??[]) {
      const [a,b,c,d]=surface.vertices;
      for (const triangle of [[a,b,c],[a,c,d]]) {
        const hit=triangleAt(triangle,x,z);
        if (hit&&(!best||hit.height>best.height+EPSILON || Math.abs(hit.height-best.height)<=EPSILON&&hit.slope>best.slope)) best=hit;
      }
    }
    return best;
  }
  canStand(x,z,previousHeight) {
    const surface=this.surfaceAt(x,z);
    if (!surface||surface.slope>MAX_SLOPE+EPSILON || previousHeight!==undefined&&Math.abs(surface.height-previousHeight)>MAX_STEP+EPSILON) return false;
    // Support the player's footprint, not just its center, at banks and ledges.
    for (let i=0;i<8;i++) {
      const a=i*Math.PI/4, sample=this.surfaceAt(x+Math.cos(a)*PLAYER_RADIUS,z+Math.sin(a)*PLAYER_RADIUS);
      if (!sample||sample.slope>MAX_SLOPE+EPSILON||Math.abs(sample.height-surface.height)>MAX_STEP+EPSILON) return false;
    }
    return this.canOccupy(x,z,surface.height);
  }
  canOccupy(x,z,feetHeight) {
    for (const o of this.obstacleIndex.get(Math.floor(z)*this.map.width+Math.floor(x))??[]) {
      if (o.maxY<=feetHeight+EPSILON||o.minY>=feetHeight+EYE_HEIGHT+.12) continue;
      if (o.r!==undefined) {if (Math.hypot(x-o.x,z-o.z)<o.r+PLAYER_RADIUS-EPSILON) return false;}
      else {
        const nearX=Math.max(o.minX,Math.min(x,o.maxX)),nearZ=Math.max(o.minZ,Math.min(z,o.maxZ));
        if (Math.hypot(x-nearX,z-nearZ)<PLAYER_RADIUS-EPSILON) return false;
      }
    }
    return true;
  }
  findSpawn() {
    const plaza=this.map.plaza;
    const cx=plaza?plaza.x+plaza.width/2:this.map.width/2,cz=plaza?plaza.y+plaza.height/2:this.map.height/2;
    if (this.canStand(cx,cz)) return {x:cx,y:this.surfaceAt(cx,cz).height,z:cz};
    const candidates=[];
    for (let z=0;z<this.map.height;z++) for(let x=0;x<this.map.width;x++) candidates.push({x:x+.5,z:z+.5,d:(x+.5-cx)**2+(z+.5-cz)**2});
    candidates.sort((a,b)=>a.d-b.d||a.z-b.z||a.x-b.x);
    for (const p of candidates) if(this.canStand(p.x,p.z)) return {x:p.x,y:this.surfaceAt(p.x,p.z).height,z:p.z};
    return null;
  }
  move(position,dx,dz) {
    const next={x:position.x,y:position.y,z:position.z};
    if (!Number.isFinite(dx)||!Number.isFinite(dz)||(dx===0&&dz===0)) return next;
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/(PLAYER_RADIUS/2))),sx=dx/steps,sz=dz/steps;
    const attempt=(ax,az)=>{
      if (!this.canStand(next.x+ax,next.z+az,next.y)) return false;
      next.x+=ax;next.z+=az;next.y=this.surfaceAt(next.x,next.z).height;return true;
    };
    for(let i=0;i<steps;i++) if(!attempt(sx,sz)) {
      if (Math.abs(sx)>=Math.abs(sz)) {attempt(sx,0);attempt(0,sz);}
      else {attempt(0,sz);attempt(sx,0);}
    }
    return next;
  }
  dispose() {this.surfaceIndex.clear();this.obstacleIndex.clear();}
}

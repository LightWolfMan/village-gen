// Shared by rendering and walking: keep the same a-b-c / a-c-d triangulation.
export const LEVEL_HEIGHT = .25;
export const levelAt = (map, x, z) => x < 0 || z < 0 || x >= map.width || z >= map.height
  ? -.6 : map.heightLevel[z * map.width + x] * LEVEL_HEIGHT;

export function createSurfaces(map) {
  const roadCells = new Set(map.roads.filter(r => !r.bridge).map(r => r.y * map.width + r.x));
  const paths = [], ramps = [], bridges = [];
  const corner = (x, z) => {
    let total = 0, count = 0;
    for (const dz of [-1, 0]) for (const dx of [-1, 0]) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nx < map.width && nz >= 0 && nz < map.height && roadCells.has(nz * map.width + nx)) {
        total += levelAt(map, nx, nz); count++;
      }
    }
    return (count ? total / count : levelAt(map, x, z)) + .045;
  };
  for (const road of map.roads) if (!road.bridge) {
    const {x, y: z} = road;
    paths.push({vertices: [[x,corner(x,z),z], [x,corner(x,z+1),z+1], [x+1,corner(x+1,z+1),z+1], [x+1,corner(x+1,z),z]],
      color: road.kind === 'plaza' ? '#c2b9a3' : road.kind === 'main' ? '#a5a293' : '#ac9472'});
  }
  for (const building of map.buildings) {
    const path = building.accessPath ?? [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i-1], c = path[i], dx = c.x-a.x, dz = c.y-a.y, length = Math.hypot(dx,dz);
      if (!length) continue;
      const ox = -dz/length*.3, oz = dx/length*.3;
      const ay = i === 1 ? building.entrance.level*LEVEL_HEIGHT+.035 : levelAt(map,Math.floor(a.x),Math.floor(a.y))+.045;
      const cy = levelAt(map,Math.floor(c.x),Math.floor(c.y))+.045;
      paths.push({vertices: [[a.x-ox,ay,a.y-oz], [c.x-ox,cy,c.y-oz], [c.x+ox,cy,c.y+oz], [a.x+ox,ay,a.y+oz]], color: '#b9aa8d'});
    }
  }
  for (const span of map.bridgeSpans) {
    const deck = Math.max(levelAt(map,span.entry.x,span.entry.y),levelAt(map,span.exit.x,span.exit.y))+.08;
    const height = deck+.1825;
    const cells = span.roadIndexes.map(i => map.roads[i]);
    if (!cells.length) continue;
    const minX = Math.min(...cells.map(r=>r.x)), maxX = Math.max(...cells.map(r=>r.x))+1;
    const minZ = Math.min(...cells.map(r=>r.y)), maxZ = Math.max(...cells.map(r=>r.y))+1;
    const x0 = minX+(span.axis==='ns'?.08:0), x1 = maxX-(span.axis==='ns'?.08:0);
    const z0 = minZ+(span.axis==='ew'?.08:0), z1 = maxZ-(span.axis==='ew'?.08:0);
    bridges.push({span,deck,height,vertices: [[x0,height,z0],[x0,height,z1],[x1,height,z1],[x1,height,z0]]});
    for (const [bank,first] of [[span.entry,true],[span.exit,false]]) {
      const {x,y:z} = bank, low = levelAt(map,x,z)+.045;
      const vertices = span.axis === 'ew'
        ? [[x,first?low:height,z+.08],[x,first?low:height,z+.92],[x+1,first?height:low,z+.92],[x+1,first?height:low,z+.08]]
        : [[x+.08,first?low:height,z],[x+.08,first?height:low,z+1],[x+.92,first?height:low,z+1],[x+.92,first?low:height,z]];
      ramps.push({vertices,color:'#aa9878'});
    }
  }
  return {roadCells, paths, ramps, bridges};
}

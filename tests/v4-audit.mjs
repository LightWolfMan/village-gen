import { generateVillage } from '../src/core/generator.js';
import { HOUSE_QUOTAS } from '../src/core/urbanism.js';
const failures = [], times = [], orientation = { north: 0, east: 0, south: 0, west: 0 };
let total = 0, success = 0, compatible = 0, considered = 0, worstQuotaError = 0;
const isolatedMaps = [];
const compatibleZones = { residential: ['residential', 'commercial', 'civic'], commercial: ['residential', 'commercial', 'craft', 'civic'], craft: ['craft', 'commercial'], civic: ['civic', 'commercial', 'residential'] };
function check(seed, settings, benchmark = false) {
  total++;
  const start = performance.now();
  try {
    const map = generateVillage(seed, settings);
    const elapsed = performance.now() - start;
    if (benchmark) times.push(elapsed);
    success++;
    const houses = map.buildings.filter((building) => building.type === 'house');
    for (const [zone, target] of Object.entries(HOUSE_QUOTAS[map.settings.settlement])) {
      const error = Math.abs(houses.filter((building) => building.zone === zone).length / houses.length - target);
      worstQuotaError = Math.max(error, worstQuotaError);
      if (error > 0.05 + 1e-9) failures.push({ seed, settings, error: `quota ${zone}: ${error}` });
    }
    let mapCompatible = 0, mapConsidered = 0;
    for (const building of map.buildings) {
      orientation[building.orientation]++;
      if (building.zone === 'agricultural') continue;
      considered++;
      mapConsidered++;
      if (map.buildings.some((other) => other !== building && compatibleZones[building.zone].includes(other.zone)
        && Math.hypot(Math.max(0, other.x - building.x - building.width, building.x - other.x - other.width),
          Math.max(0, other.y - building.y - building.height, building.y - other.y - other.height)) <= 8)) { compatible++; mapCompatible++; }
    }
    if (mapCompatible / mapConsidered < .9) isolatedMaps.push({ seed, ratio: mapCompatible / mapConsidered });
  } catch (error) { failures.push({ seed, settings, error: error.message }); }
}
const mode = process.argv[2] || 'all';
if (mode !== 'matrix') {
  generateVillage('audit-warmup');
  for (let index = 0; index < 300; index++) check(`regressão-${index}`, {}, true);
}
if (mode !== 'standard') {
  const seen = new Set();
  for (const biome of ['temperate', 'arid', 'snowy', 'wetland']) for (const layout of ['organic', 'grid'])
    for (const settlement of ['hamlet', 'village', 'town']) for (let mapSize of [72, 96, 128])
      for (const water of [0, 1]) for (const rivers of [false, true]) {
        const settings = { biome, layout, settlement, mapSize: settlement === 'town' ? 128 : mapSize, water, rivers };
        const key = JSON.stringify(settings);
        if (seen.has(key)) continue;
        seen.add(key);
        check(`matrix:${key}`, settings);
      }
}
times.sort((a, b) => a - b);
const orientationTotal = Object.values(orientation).reduce((a, b) => a + b, 0);
for (const [direction, count] of Object.entries(orientation)) if (count / orientationTotal < .15 || count / orientationTotal > .35) failures.push({ error: `orientação ${direction}: ${count / orientationTotal}` });
if (compatible / considered < .9) failures.push({ error: `compatibilidade agregada: ${compatible / considered}` });
for (const isolated of isolatedMaps) failures.push({ seed: isolated.seed, error: `compatibilidade da vila: ${isolated.ratio}` });
console.log(JSON.stringify({ total, success, failures, performance: { count: times.length, mean: times.reduce((a, b) => a + b, 0) / times.length,
  p95: times[Math.floor(times.length * .95)], max: times.at(-1), under500: times.filter((time) => time < 500).length },
  orientation, compatibleRatio: compatible / considered, isolatedMaps, worstQuotaError }, null, 2));
if (failures.length) process.exitCode = 1;

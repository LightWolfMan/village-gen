// Development-only comparison with the preserved source. Never used by the native runtime.
import { generateVillage } from '../../src/core/generator.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dotnet = `${root}/workbench/dotnet/dotnet.exe`;
const cases = [
  ['native-regression-0', {biome:'temperate',layout:'organic',settlement:'hamlet',rivers:false,water:0,mapSize:72}],
  ['native-regression-1', {biome:'arid',layout:'grid',settlement:'village',rivers:true,water:.25,mapSize:96}],
  ['native-regression-2', {biome:'snowy',layout:'organic',settlement:'town',rivers:false,water:.5,mapSize:128}],
  ['native-regression-3', {biome:'wetland',layout:'grid',settlement:'hamlet',rivers:true,water:.75,mapSize:72}],
  ['', {}],
  ['Vila São João 🏡', {biome:'temperate',layout:'organic',settlement:'village',rivers:true,water:.8,mapSize:72}],
  ['compact-grid', {biome:'wetland',layout:'grid',settlement:'village',rivers:true,water:1,mapSize:72}],
  ['normalization', {biome:'unknown',layout:'unknown',settlement:'hamlet',rivers:'true',water:'0.5',mapSize:'72'}],
  ['native-regression-11', {biome:'wetland',layout:'grid',settlement:'town',rivers:true,water:.25,mapSize:128}],
  ['native-regression-20', {biome:'temperate',layout:'organic',settlement:'town',rivers:false,water:0,mapSize:128}],
];
function diff(a,b,path='$') {
  if(typeof a!==typeof b || a===null || b===null) return a===b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  if(typeof a!=='object') return a===b || (typeof a==='number' && Math.abs(a-b)<1e-10) ? null : `${path}: ${a} != ${b}`;
  if(Array.isArray(a)!==Array.isArray(b))return `${path}: array mismatch`;
  if(Array.isArray(a)&&a.length!==b.length)return `${path}: length ${a.length} != ${b.length}`;
  if(!Array.isArray(a)&&Object.keys(a).sort().join()!==Object.keys(b).sort().join())return `${path}: keys ${Object.keys(a)} != ${Object.keys(b)}`;
  for(const key of Object.keys(a)){const found=diff(a[key],b[key],`${path}.${key}`);if(found)return found;}
  return null;
}
for (const [seed,settings] of cases) {
  const expected=generateVillage(seed,settings);
  const actual=JSON.parse(execFileSync(dotnet,[`${root}/native/CoreTests/bin/Release/net8.0/CoreTests.dll`,'--export',seed,JSON.stringify(settings)],{encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,DOTNET_ROOT:`${root}/workbench/dotnet`}}));
  const mismatch=diff(expected,actual);
  if(mismatch){console.error(`FAIL ${seed}: ${mismatch}`);process.exitCode=1;}else console.log(`PARITY ${seed}`);
}

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { generateVillage, terrainAt, validateVillage } from "../src/core/index.js";

function digest(map) {
  return createHash("sha256").update(JSON.stringify(map)).digest("hex");
}

test("a mesma seed e configuração geram exatamente o mesmo mapa", () => {
  const first = generateVillage("vale-do-sol", { size: 128, density: 1, water: 0.35 });
  const second = generateVillage("vale-do-sol", { size: 128, density: 1, water: 0.35 });
  assert.equal(digest(first), digest(second));
});

test("seeds vazia, unicode e muito longa são aceitas e preservadas", () => {
  for (const seed of ["", "Vila da Maçã 🌳", "x".repeat(20_000)]) {
    const map = generateVillage(seed, { size: 64 });
    assert.equal(map.seed, seed);
    assert.equal(map.width, 64);
    assert.equal(map.terrain.length, 64 * 64);
    assert.doesNotThrow(() => JSON.stringify(map));
  }
});

test("configurações não numéricas retornam aos padrões seguros", () => {
  const map = generateVillage("config-invalida", { size: "abc", density: Number.NaN, water: undefined });
  assert.equal(map.width, 128);
  assert.equal(map.settings.density, 1);
  assert.equal(map.settings.water, 0.35);
  assert.equal(map.validation.valid, true);
});

test("o mapa padrão tem terreno completo e 25 a 40 casas", () => {
  const map = generateVillage("mapa-padrao");
  assert.equal(map.width, 128);
  assert.equal(map.height, 128);
  assert.ok(map.terrain.includes("water"));
  assert.ok(map.terrain.includes("grass"));
  assert.ok(map.terrain.includes("forest"));
  assert.ok(map.stats.houses >= 25 && map.stats.houses <= 40, `casas: ${map.stats.houses}`);
  assert.ok(map.stats.services >= 4 && map.stats.services <= 8, `serviços: ${map.stats.services}`);
  assert.equal(map.decorations.filter(({ type }) => type === "well").length, 1);
  assert.ok(map.decorations.some(({ type }) => type === "garden_plot"));
  assert.ok(map.decorations.some(({ type }) => type === "fence"));
  assert.equal(terrainAt(map, -1, 0), undefined);
  assert.equal(terrainAt(map, map.plaza.x, map.plaza.y), "grass");
});

test("validação detecta sobreposição e porta desconectada", () => {
  const map = generateVillage("mapa-adulterado", { size: 64 });
  map.buildings[1].x = map.buildings[0].x;
  map.buildings[1].y = map.buildings[0].y;
  map.buildings[1].door = { x: 0, y: 0 };
  const validation = validateVillage(map);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("sobreposição")));
  assert.ok(validation.errors.some((error) => error.includes("porta")));
});

test("300 seeds permanecem válidas, conectadas e dentro da faixa residencial", { timeout: 60_000 }, () => {
  for (let index = 0; index < 300; index += 1) {
    const map = generateVillage(`regressao-${index}`);
    assert.equal(map.validation.valid, true, `seed ${index}: ${map.validation.errors.join("; ")}`);
    assert.ok(map.stats.houses >= 25 && map.stats.houses <= 40, `seed ${index}: ${map.stats.houses} casas`);
    assert.ok(map.stats.services >= 4 && map.stats.services <= 8, `seed ${index}: ${map.stats.services} serviços`);
    assert.equal(map.decorations.filter(({ type }) => type === "well").length, 1, `seed ${index}: poço`);
    const well = map.decorations.find(({ type }) => type === "well");
    const distanceX = well.x < map.plaza.x
      ? map.plaza.x - well.x
      : well.x >= map.plaza.x + map.plaza.width ? well.x - (map.plaza.x + map.plaza.width - 1) : 0;
    const distanceY = well.y < map.plaza.y
      ? map.plaza.y - well.y
      : well.y >= map.plaza.y + map.plaza.height ? well.y - (map.plaza.y + map.plaza.height - 1) : 0;
    assert.equal(distanceX + distanceY, 1, `seed ${index}: poço não adjacente`);
    const occupied = new Set(map.roads.map(({ x, y }) => `${x},${y}`));
    for (const building of map.buildings) {
      for (let y = building.y; y < building.y + building.height; y += 1) {
        for (let x = building.x; x < building.x + building.width; x += 1) occupied.add(`${x},${y}`);
      }
    }
    for (const decoration of map.decorations) {
      assert.equal(occupied.has(`${decoration.x},${decoration.y}`), false, `seed ${index}: decoração ocupada`);
    }
  }
});

test("cada bioma é determinístico e válido e produz seu terreno característico", () => {
  const expected = { temperate: "sand", arid: "sand", snowy: "snow", wetland: "marsh" };
  for (const [biome, marker] of Object.entries(expected)) {
    const first = generateVillage("bioma", { biome });
    const second = generateVillage("bioma", { biome });
    assert.equal(digest(first), digest(second), `bioma ${biome} não é determinístico`);
    assert.equal(first.biome, biome);
    assert.equal(first.validation.valid, true, `bioma ${biome}: ${first.validation.errors.join("; ")}`);
    assert.ok(first.terrain.includes(marker), `bioma ${biome} sem terreno ${marker}`);
    assert.ok(first.stats.terrainCounts[marker] > 0);
  }
});

test("biome inválido volta ao padrão temperado", () => {
  const map = generateVillage("fallback", { biome: "vulcao" });
  assert.equal(map.biome, "temperate");
  assert.equal(map.validation.valid, true);
});

test("todo edifício tem variante e material estáveis por seed", () => {
  const map = generateVillage("materiais");
  const again = generateVillage("materiais");
  for (let i = 0; i < map.buildings.length; i += 1) {
    const building = map.buildings[i];
    assert.equal(typeof building.variant, "number");
    assert.ok(typeof building.material === "string" && building.material.length > 0);
    assert.equal(building.variant, again.buildings[i].variant);
    assert.equal(building.material, again.buildings[i].material);
  }
});

test("geração padrão fica abaixo do teto de 500 ms após aquecimento", () => {
  generateVillage("aquecimento");
  const elapsed = [];
  for (let index = 0; index < 5; index += 1) {
    const start = performance.now();
    generateVillage(`desempenho-${index}`);
    elapsed.push(performance.now() - start);
  }
  assert.ok(Math.max(...elapsed) < 500, `tempos: ${elapsed.map((value) => value.toFixed(1)).join(", ")} ms`);
});

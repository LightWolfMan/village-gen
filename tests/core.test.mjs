import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { BIOMES, DEFAULT_SETTINGS, generateVillage, heightAt, terrainAt, validateVillage } from "../src/core/index.js";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("contrato v2 é limpo, serializável e determinístico", () => {
  const first = generateVillage("vale-do-sol");
  const second = generateVillage("vale-do-sol");
  assert.equal(digest(first), digest(second));
  assert.equal(first.schemaVersion, 1);
  assert.deepEqual(first.settings, DEFAULT_SETTINGS);
  assert.equal(first.width, 96);
  assert.equal(first.height, 96);
  assert.equal(first.terrain.length, 96 * 96);
  assert.equal(first.heightLevel.length, 96 * 96);
  assert.doesNotThrow(() => JSON.stringify(first));
  assert.equal("elevation" in first, false);
  assert.equal("moisture" in first, false);
});

test("normalização aceita apenas opções públicas e town força 128", () => {
  const invalid = generateVillage("config", { mapSize: 88, biome: "lava", water: "x", layout: "radial", settlement: "metropolis", rivers: 1 });
  assert.deepEqual(invalid.settings, DEFAULT_SETTINGS);
  for (const mapSize of [72, 96, 128]) assert.equal(generateVillage(`size-${mapSize}`, { mapSize, settlement: "hamlet" }).width, mapSize);
  const town = generateVillage("cidade", { mapSize: 72, settlement: "town", layout: "grid", water: 2, rivers: true });
  assert.equal(town.width, 128);
  assert.equal(town.settings.water, 1);
  assert.equal(town.settings.rivers, true);
});

test("seeds vazia, unicode e longa são preservadas", () => {
  for (const seed of ["", "Vila da Maçã 🌳", "x".repeat(20_000)]) {
    const map = generateVillage(seed, { mapSize: 72, settlement: "hamlet" });
    assert.equal(map.seed, seed);
    assert.equal(map.validation.valid, true);
  }
});

test("quatro biomas produzem terrenos próprios e níveis 0..6", () => {
  const marker = { temperate: "grass", arid: "dry-grass", snowy: "snow", wetland: "wet-grass" };
  assert.deepEqual(Object.keys(BIOMES), Object.keys(marker));
  for (const biome of Object.keys(BIOMES)) {
    const map = generateVillage(`bioma-${biome}`, { biome, rivers: true });
    assert.ok(map.terrain.includes(marker[biome]), `${biome} sem ${marker[biome]}`);
    assert.ok(map.terrain.includes("water"));
    assert.ok(map.heightLevel.every((level) => Number.isInteger(level) && level >= 0 && level <= 6));
    for (let index = 0; index < map.terrain.length; index += 1) {
      assert.equal(map.terrain[index] === "water", map.heightLevel[index] === 0);
    }
  }
});

test("assentamentos respeitam casas, serviços e tamanho mínimo", () => {
  const expected = {
    hamlet: { houses: [10, 18], services: 2, size: 72 },
    village: { houses: [25, 40], services: 4, size: 96 },
    town: { houses: [55, 85], services: 8, size: 128 },
  };
  for (const [settlement, rule] of Object.entries(expected)) {
    const map = generateVillage(`assentamento-${settlement}`, { settlement, mapSize: rule.size });
    assert.ok(map.stats.houses >= rule.houses[0] && map.stats.houses <= rule.houses[1]);
    assert.equal(map.stats.services, rule.services);
    assert.equal(map.width, rule.size);
  }
});

test("organic e grid são determinísticos, diferentes e conectados", () => {
  const organic = generateVillage("traçado", { layout: "organic", rivers: true });
  const grid = generateVillage("traçado", { layout: "grid", rivers: true });
  assert.notEqual(digest(organic), digest(grid));
  assert.equal(digest(grid), digest(generateVillage("traçado", { layout: "grid", rivers: true })));
  assert.equal(organic.validation.valid, true);
  assert.equal(grid.validation.valid, true);
  const centerX = grid.plaza.x + Math.floor(grid.plaza.width / 2);
  const centerY = grid.plaza.y + Math.floor(grid.plaza.height / 2);
  assert.ok(grid.roads.some(({ x, y }) => x === 1 && y === centerY));
  assert.ok(grid.roads.some(({ x, y }) => x === centerX && y === 1));
});

test("rios e águas cruzados por ruas geram pontes orientadas", () => {
  let bridges = 0;
  for (let index = 0; index < 20; index += 1) {
    const map = generateVillage(`ponte-${index}`, { rivers: true, water: 0.55, layout: index % 2 ? "organic" : "grid" });
    for (const road of map.roads) {
      assert.equal(road.bridge, terrainAt(map, road.x, road.y) === "water");
      if (road.bridge) {
        bridges += 1;
        assert.ok(["ns", "ew", "cross"].includes(road.orientation));
      } else assert.equal(road.orientation, null);
    }
  }
  assert.ok(bridges > 0);
});

test("fundações, margens e props permanecem espacialmente válidos", () => {
  const map = generateVillage("espaçamento", { settlement: "town", layout: "grid", rivers: true });
  const buildingMargin = new Set();
  for (const building of map.buildings) {
    assert.ok(map.roads.some(({ x, y }) => x === building.door.x && y === building.door.y));
    for (let y = building.y; y < building.y + building.height; y += 1) {
      for (let x = building.x; x < building.x + building.width; x += 1) {
        assert.equal(heightAt(map, x, y), building.baseLevel);
        assert.notEqual(terrainAt(map, x, y), "water");
      }
    }
    for (let y = building.y - 1; y <= building.y + building.height; y += 1) {
      for (let x = building.x - 1; x <= building.x + building.width; x += 1) buildingMargin.add(`${x},${y}`);
    }
  }
  for (const prop of map.props) assert.equal(buildingMargin.has(`${prop.x},${prop.y}`), false);
  const propTypes = new Set(map.props.map((prop) => prop.type));
  for (const landmark of ["well", "cart", "haystack"]) assert.ok(propTypes.has(landmark), `prop especial ausente: ${landmark}`);
  assert.equal(validateVillage(map).valid, true);
});

test("validação acusa adulterações estruturais", () => {
  const map = structuredClone(generateVillage("adulterado"));
  map.buildings[1].x = map.buildings[0].x;
  map.buildings[1].y = map.buildings[0].y;
  map.buildings[1].door = { x: 0, y: 0 };
  map.heightLevel[0] = 9;
  const validation = validateVillage(map);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("sobreposição")));
  assert.ok(validation.errors.some((error) => error.includes("porta")));
  assert.ok(validation.errors.some((error) => error.includes("0..6")));
});

test("300 seeds padrão são válidas e rápidas", { timeout: 60_000 }, () => {
  const started = performance.now();
  let slowest = 0;
  for (let index = 0; index < 300; index += 1) {
    const itemStarted = performance.now();
    const map = generateVillage(`regressão-${index}`);
    slowest = Math.max(slowest, performance.now() - itemStarted);
    assert.equal(map.validation.valid, true, `seed ${index}: ${map.validation.errors.join("; ")}`);
    assert.ok(map.stats.houses >= 25 && map.stats.houses <= 40);
  }
  assert.ok(slowest < 500, `seed mais lenta: ${slowest.toFixed(1)} ms`);
  assert.ok(performance.now() - started < 60_000);
});

test("matriz de bioma, traçado e assentamento permanece válida", { timeout: 60_000 }, () => {
  for (const biome of Object.keys(BIOMES)) {
    for (const layout of ["organic", "grid"]) {
      for (const settlement of ["hamlet", "village", "town"]) {
        const map = generateVillage(`${biome}-${layout}-${settlement}`, { biome, layout, settlement, rivers: true });
        assert.equal(map.validation.valid, true, `${biome}/${layout}/${settlement}`);
      }
    }
  }
});

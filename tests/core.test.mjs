import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { BIOMES, DEFAULT_SETTINGS, generateVillage, heightAt, terrainAt, validateVillage } from "../src/core/index.js";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("contrato v4 é limpo, serializável e determinístico", () => {
  const first = generateVillage("vale-do-sol");
  const second = generateVillage("vale-do-sol");
  assert.equal(digest(first), digest(second));
  assert.equal(first.schemaVersion, 4);
  assert.deepEqual(first.settings, DEFAULT_SETTINGS);
  assert.equal(first.width, 96);
  assert.equal(first.height, 96);
  assert.equal(first.terrain.length, 96 * 96);
  assert.equal(first.heightLevel.length, 96 * 96);
  assert.equal(first.zoneMap.length, 96 * 96);
  assert.equal(first.zones.length, 5);
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
  assert.equal(grid.roadTopology, "orthogonal-cardinal");
  assert.equal(organic.roadTopology, "organic-cardinal");
  assert.deepEqual(Object.keys(grid.gridSpec), ["centerX", "centerY", "spacing", "radius"]);
  assert.equal(organic.gridSpec, null);
  const centerX = grid.plaza.x + Math.floor(grid.plaza.width / 2);
  const centerY = grid.plaza.y + Math.floor(grid.plaza.height / 2);
  assert.ok(grid.roads.some(({ x, y }) => x === 1 && y === centerY));
  assert.ok(grid.roads.some(({ x, y }) => x === centerX && y === 1));
});

test("zoneamento medieval é explícito, contíguo e orienta o placement", () => {
  const allowed = {
    house: ["residential", "agricultural", "craft", "commercial"], inn: ["commercial"], shop: ["commercial"], market: ["commercial"],
    smithy: ["craft"], mill: ["craft", "agricultural"], hall: ["civic"], chapel: ["civic"], tower: ["civic"],
  };
  const zoneTypes = ["residential", "commercial", "craft", "civic", "agricultural"];
  const map = generateVillage("distritos-medievais", { settlement: "town", layout: "grid" });
  assert.deepEqual(new Set(map.zoneMap), new Set(["none", ...zoneTypes]));
  assert.deepEqual(new Set(map.zones.map(({ type }) => type)), new Set(zoneTypes));
  assert.equal(map.zoneMap.some((zone, index) => map.terrain[index] === "water" && zone !== "none"), false);
  for (const zone of map.zones) {
    assert.equal(zone.cellCount, map.zoneMap.filter((type) => type === zone.type).length);
    const cells = new Set(map.roads.map(({ x, y }) => y * map.width + x));
    for (let index = 0; index < map.zoneMap.length; index += 1) if (map.zoneMap[index] === zone.type) cells.add(index);
    const queue = [zone.anchor.y * map.width + zone.anchor.x];
    cells.delete(queue[0]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]; const x = index % map.width; const y = Math.floor(index / map.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = (y + dy) * map.width + x + dx;
        if (x + dx >= 0 && x + dx < map.width && y + dy >= 0 && y + dy < map.height && cells.delete(next)) queue.push(next);
      }
    }
    assert.equal([...cells].filter((index) => map.zoneMap[index] === zone.type).length, 0, `${zone.type} desconectada`);
    assert.ok(Array.isArray(zone.bridgeLinks));
  }
  for (const building of map.buildings) {
    assert.ok(allowed[building.type].includes(building.zone), `${building.type} em ${building.zone}`);
    const centerX = building.x + Math.floor((building.width - 1) / 2);
    const centerY = building.y + Math.floor((building.height - 1) / 2);
    assert.equal(map.zoneMap[centerY * map.width + centerX], building.zone);
    assert.ok(building.architecture.length > 2);
  }
});

test("arquitetura varia por bioma, zona, serviço e escala", () => {
  const architectures = new Set();
  const materials = new Set();
  const roofs = new Set();
  const footprints = new Set();
  for (const biome of Object.keys(BIOMES)) {
    for (const settlement of ["hamlet", "village", "town"]) {
      const map = generateVillage(`arquitetura-${biome}-${settlement}`, { biome, settlement });
      for (const building of map.buildings) {
        architectures.add(building.architecture); materials.add(building.material); roofs.add(building.roof);
        footprints.add(`${building.width}x${building.height}`);
      }
    }
  }
  assert.ok(architectures.size >= 25, `arquiteturas: ${architectures.size}`);
  assert.ok(materials.size >= 8, `materiais: ${materials.size}`);
  assert.ok(roofs.size >= 8, `telhados: ${roofs.size}`);
  assert.ok(footprints.size >= 7, `footprints: ${footprints.size}`);
});

test("rios e águas cruzados por ruas geram pontes orientadas", () => {
  let bridges = 0;
  for (let index = 0; index < 20; index += 1) {
    const map = generateVillage(`ponte-${index}`, { rivers: true, water: 0.55, layout: index % 2 ? "organic" : "grid" });
    for (const road of map.roads) {
      assert.equal(road.bridge, terrainAt(map, road.x, road.y) === "water");
      if (road.bridge) {
        bridges += 1;
        assert.ok(["ns", "ew"].includes(road.orientation));
        assert.equal(road.connections, road.orientation === "ew" ? 10 : 5);
        assert.equal(typeof road.bridgeSpanId, "string");
        assert.ok(["single", "start", "middle", "post", "end"].includes(road.bridgeRole));
      } else assert.equal(road.orientation, null);
    }
    for (const span of map.bridgeSpans) {
      assert.equal(span.length, span.roadIndexes.length);
      assert.notEqual(terrainAt(map, span.entry.x, span.entry.y), "water");
      assert.notEqual(terrainAt(map, span.exit.x, span.exit.y), "water");
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

test("portas são entradas terrestres, exclusivas e coerentes com a fachada", () => {
  const map = generateVillage("entradas", { settlement: "town", rivers: true });
  const roadByKey = new Map(map.roads.map((road) => [`${road.x},${road.y}`, road]));
  const occupied = new Set();
  for (const building of map.buildings) {
    for (let y = building.y; y < building.y + building.height; y += 1) for (let x = building.x; x < building.x + building.width; x += 1) occupied.add(`${x},${y}`);
  }
  const doors = new Set();
  for (const building of map.buildings) {
    const { door } = building;
    assert.ok(door.x >= 0 && door.y >= 0 && door.x < map.width && door.y < map.height);
    assert.notEqual(terrainAt(map, door.x, door.y), "water");
    assert.equal(roadByKey.get(`${door.x},${door.y}`)?.bridge, false);
    const expected = {
      north: door.y === building.y - 1 - (building.zone === 'civic' ? 2 : 0) && door.x >= building.x && door.x < building.x + building.width,
      south: door.y === building.y + building.height + (building.zone === 'civic' ? 2 : 0) && door.x >= building.x && door.x < building.x + building.width,
      west: door.x === building.x - 1 - (building.zone === 'civic' ? 2 : 0) && door.y >= building.y && door.y < building.y + building.height,
      east: door.x === building.x + building.width + (building.zone === 'civic' ? 2 : 0) && door.y >= building.y && door.y < building.y + building.height,
    };
    assert.equal(expected[building.orientation], true);
    assert.equal(Object.values(expected).filter(Boolean).length, 1);
    assert.equal(building.entranceVisible, ["south", "east"].includes(building.orientation));
    assert.equal(occupied.has(`${door.x},${door.y}`), false);
    const entranceKey = `${building.entrance.x},${building.entrance.y}`;
    assert.equal(doors.has(entranceKey), false);
    doors.add(entranceKey);
  }
  for (const orientation of ["north", "east", "south", "west"]) {
    const ratio = map.buildings.filter((building) => building.orientation === orientation).length / map.buildings.length;
    assert.ok(ratio >= 0.15 && ratio <= 0.35, `${orientation} fora da faixa: ${ratio}`);
  }
  for (const prop of map.props) assert.equal(map.buildings.some((building) => building.door.x === prop.x && building.door.y === prop.y), false);
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

  const wrongBuildingZone = structuredClone(generateVillage("zona-adulterada"));
  wrongBuildingZone.buildings[0].zone = "craft";
  assert.ok(validateVillage(wrongBuildingZone).errors.some((error) => error.includes("zona")));

  const wrongZoneMap = structuredClone(generateVillage("camada-adulterada"));
  const building = wrongZoneMap.buildings[0];
  const center = (building.y + Math.floor((building.height - 1) / 2)) * wrongZoneMap.width + building.x + Math.floor((building.width - 1) / 2);
  wrongZoneMap.zoneMap[center] = "none";
  assert.ok(validateVillage(wrongZoneMap).errors.some((error) => error.includes("zona")));

  const duplicateMetadata = structuredClone(generateVillage("metadata-adulterada"));
  duplicateMetadata.zones[1] = structuredClone(duplicateMetadata.zones[0]);
  assert.ok(validateVillage(duplicateMetadata).errors.some((error) => error.includes("duplicados")));

  const wrongGrid = structuredClone(generateVillage("grid-adulterada", { layout: "grid" }));
  wrongGrid.gridSpec.spacing = 99;
  assert.ok(validateVillage(wrongGrid).errors.some((error) => error.includes("gridSpec")));

  const waterDoor = structuredClone(generateVillage("porta-agua"));
  const waterBuilding = waterDoor.buildings[0];
  waterDoor.terrain[waterBuilding.door.y * waterDoor.width + waterBuilding.door.x] = "water";
  assert.ok(validateVillage(waterDoor).errors.some((error) => error.includes("água")));

  const propOnDoor = structuredClone(generateVillage("prop-na-porta"));
  const propDoor = propOnDoor.buildings[0].door;
  propOnDoor.props.push({ id: "prop-invasor", type: "rock", x: propDoor.x, y: propDoor.y, level: propOnDoor.heightLevel[propDoor.y * propOnDoor.width + propDoor.x], variant: 0 });
  assert.ok(validateVillage(propOnDoor).errors.some((error) => error.includes("ocupa uma porta")));

  const footprintOnDoor = structuredClone(generateVillage("predio-na-porta"));
  const blockedDoor = footprintOnDoor.buildings[0].door;
  footprintOnDoor.buildings[1].x = blockedDoor.x;
  footprintOnDoor.buildings[1].y = blockedDoor.y;
  assert.ok(validateVillage(footprintOnDoor).errors.some((error) => error.includes("dentro de um footprint")));

  const wrongOrientation = structuredClone(generateVillage("orientacao-porta"));
  wrongOrientation.buildings[0].orientation = wrongOrientation.buildings[0].orientation === "north" ? "south" : "north";
  assert.ok(validateVillage(wrongOrientation).errors.some((error) => error.includes("orientação")));

  const wrongEntrance = structuredClone(map);
  wrongEntrance.buildings[0].entrance.x += 3;
  assert.ok(validateVillage(wrongEntrance).errors.some((error) => error.includes('entrada diverge')));
  const wrongLot = structuredClone(generateVillage('lote-geometria'));
  const lotBuilding = wrongLot.buildings.find((item) => item.zone === 'residential');
  const yard = wrongLot.lots.find((lot) => lot.id === lotBuilding.lotId);
  yard.cells = yard.cells.filter(({ x, y }) => x >= lotBuilding.x && y >= lotBuilding.y
    && x < lotBuilding.x + lotBuilding.width && y < lotBuilding.y + lotBuilding.height);
  assert.ok(validateVillage(wrongLot).errors.some((error) => error.includes('geometria de pátio')));
  const wrongAccess = structuredClone(generateVillage('acesso-geometria'));
  const accessBuilding = wrongAccess.buildings[0];
  const blockedPoint = accessBuilding.accessPath.at(-1);
  wrongAccess.props.push({ id: 'access-block', type: 'rock', x: Math.floor(blockedPoint.x), y: Math.floor(blockedPoint.y), level: 1 });
  assert.ok(validateVillage(wrongAccess).errors.some((error) => error.includes('acesso bloqueado')));
});

test("300 seeds padrão são válidas; benchmark registra a meta de 500 ms", { timeout: 180_000 }, (context) => {
  const started = performance.now();
  let slowest = 0;
  for (let index = 0; index < 300; index += 1) {
    const itemStarted = performance.now();
    const map = generateVillage(`regressão-${index}`);
    slowest = Math.max(slowest, performance.now() - itemStarted);
    assert.equal(map.validation.valid, true, `seed ${index}: ${map.validation.errors.join("; ")}`);
    assert.ok(map.stats.houses >= 25 && map.stats.houses <= 40);
  }
  context.diagnostic(`Mais lenta: ${slowest.toFixed(1)} ms; total: ${(performance.now() - started).toFixed(1)} ms; meta: <500 ms por seed.`);
});

test("matriz de bioma, traçado e assentamento permanece válida", { timeout: 180_000 }, () => {
  for (const biome of Object.keys(BIOMES)) {
    for (const layout of ["organic", "grid"]) {
      for (const settlement of ["hamlet", "village", "town"]) {
        const map = generateVillage(`${biome}-${layout}-${settlement}`, { biome, layout, settlement, rivers: true });
        assert.equal(map.validation.valid, true, `${biome}/${layout}/${settlement}`);
      }
    }
  }
});

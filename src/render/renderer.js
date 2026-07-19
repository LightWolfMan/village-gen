/**
 * Renderer isometrico da Village v2.
 *
 * Este modulo nao conhece o gerador: recebe apenas o VillageMap serializavel e
 * pre-renderiza o mundo inteiro em um Canvas 2D. A camera passa a mover uma
 * unica imagem estatica, mantendo pan e zoom baratos mesmo em mapas grandes.
 */

export const ISO_DEFAULTS = Object.freeze({
  tileWidth: 32,
  tileHeight: 16,
  heightStep: 6,
  padding: 64,
});

const TERRAIN = Object.freeze({
  temperate: {
    grass: ['#71944d', '#7b9d54'], forest: ['#4e7242', '#587b47'], dirt: ['#8d7454', '#987f5c'],
    sand: ['#d9bd7b', '#e2c887'], water: ['#4b9bb1', '#55a8bd'], marsh: ['#597447', '#647e4d'], snow: ['#e7ecea', '#f2f4ef'],
  },
  arid: {
    grass: ['#9ca74d', '#aab256'], forest: ['#707c3f', '#7c8746'], dirt: ['#9b7048', '#aa7c50'],
    sand: ['#d4ad63', '#e2bd71'], water: ['#398da5', '#49a0b5'], marsh: ['#647446', '#72814d'], snow: ['#ece9dd', '#f4f0e3'],
  },
  snowy: {
    grass: ['#cad7ce', '#d7e0d9'], forest: ['#607a69', '#6d8874'], dirt: ['#7f7469', '#8b8075'],
    sand: ['#d3ccb8', '#e0d9c6'], water: ['#5899ad', '#69aabd'], marsh: ['#778a77', '#849682'], snow: ['#e7eef1', '#f4f7f7'],
  },
  wetland: {
    grass: ['#667f48', '#718b50'], forest: ['#405f3d', '#4b6b44'], dirt: ['#725f48', '#806b50'],
    sand: ['#b7a572', '#c2b07b'], water: ['#467f87', '#528e94'], marsh: ['#4f6c48', '#5b7750'], snow: ['#dfe8e3', '#eaf0eb'],
  },
});

const MATERIALS = Object.freeze({
  thatch: { wall: '#c9ad77', lit: '#ddc58d', shade: '#a98c5e', trim: '#67472b', roof: '#b18738', roofLit: '#d0aa4d', roofDark: '#765527' },
  tile: { wall: '#d1b987', lit: '#e5d09e', shade: '#aa9166', trim: '#65452e', roof: '#a74737', roofLit: '#cf6851', roofDark: '#702e2a' },
  wood: { wall: '#a87748', lit: '#be8d59', shade: '#805936', trim: '#4c3322', roof: '#614329', roofLit: '#85613b', roofDark: '#39291d' },
  stone: { wall: '#aaa79c', lit: '#c5c1b4', shade: '#858177', trim: '#55534d', roof: '#526169', roofLit: '#74858c', roofDark: '#354147' },
  adobe: { wall: '#c28b5c', lit: '#dba778', shade: '#986744', trim: '#70462f', roof: '#9f7045', roofLit: '#c08a57', roofDark: '#6f4b33' },
  slate: { wall: '#a8adb0', lit: '#c7cccd', shade: '#858b8f', trim: '#51585c', roof: '#53636d', roofLit: '#71828c', roofDark: '#35434c' },
});

const ART_MANIFEST = Object.freeze({
  tree: '/assets/props/temperate-tree.png',
  'temperate-tree': '/assets/props/temperate-tree.png',
  'snowy-pine': '/assets/props/snowy-pine.png',
  cactus: '/assets/props/desert-cactus.png',
  'desert-cactus': '/assets/props/desert-cactus.png',
  willow: '/assets/props/swamp-willow.png',
  'swamp-willow': '/assets/props/swamp-willow.png',
  rock: '/assets/props/rock.png',
  well: '/assets/props/well.png',
  cart: '/assets/props/cart.png',
  haystack: '/assets/props/haystack.png',
});

const ART = new Map();

function optionsWithDefaults(options = {}) {
  return {
    tileWidth: positive(options.tileWidth, ISO_DEFAULTS.tileWidth),
    tileHeight: positive(options.tileHeight, ISO_DEFAULTS.tileHeight),
    heightStep: positive(options.heightStep, ISO_DEFAULTS.heightStep),
    padding: Math.max(0, finite(options.padding, ISO_DEFAULTS.padding)),
  };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback) {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hash2(x, y, salt = 0) {
  let value = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul((y | 0) + salt, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

function tint(hex, amount) {
  const source = String(hex).replace('#', '');
  if (source.length !== 6) return hex;
  const channel = (offset) => clamp(parseInt(source.slice(offset, offset + 2), 16) + amount, 0, 255).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** Projeta uma coordenada do mapa sem aplicar a origem calculada do canvas. */
export function projectPoint(x, y, level = 0, options = {}) {
  const { tileWidth, tileHeight, heightStep } = optionsWithDefaults(options);
  return {
    x: (finite(x, 0) - finite(y, 0)) * (tileWidth / 2),
    y: (finite(x, 0) + finite(y, 0)) * (tileHeight / 2) - finite(level, 0) * heightStep,
  };
}

function levelAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  const value = map.heightLevel?.[y * map.width + x];
  if (Number.isFinite(value)) return Math.max(0, value);
  return map.terrain?.[y * map.width + x] === 'water' ? 0 : 1;
}

function biomeOf(map) {
  return map.settings?.biome ?? map.biome ?? 'temperate';
}

function buildingFootprint(building) {
  return {
    width: Math.max(1, Math.round(finite(building.width ?? building.footprint?.width, 2))),
    height: Math.max(1, Math.round(finite(building.height ?? building.footprint?.height, 2))),
  };
}

function buildingPixels(building, options) {
  const stories = clamp(Math.round(finite(building.storeys ?? building.stories, building.type === 'tower' || building.type === 'watchtower' ? 3 : 1)), 1, 4);
  const wall = options.tileHeight * (1.15 + stories * 0.72);
  const roof = options.tileHeight * (building.type === 'watchtower' ? 0.5 : 0.9);
  const special = building.type === 'chapel' || building.type === 'mill' ? options.tileHeight * 2.6 : 0;
  return { wall, roof, special, total: wall + roof + special };
}

function propMetrics(prop, options) {
  const type = prop.type ?? 'grass-tuft';
  const scale = options.tileWidth / 32;
  const values = {
    tree: [54, 88], 'temperate-tree': [54, 88], 'snowy-pine': [54, 90], pine: [54, 90],
    willow: [72, 90], 'swamp-willow': [72, 90], cactus: [36, 58], 'desert-cactus': [36, 58],
    rock: [34, 25], well: [38, 43], cart: [50, 34], haystack: [38, 37],
    'dead-tree': [43, 65], bush: [32, 27], fence: [34, 21], garden: [36, 20],
  };
  const [width, height] = values[type] ?? [28, 28];
  return { width: width * scale, height: height * scale };
}

/**
 * Calcula bounds conservadores de tudo que pode ser desenhado. A funcao e pura:
 * carregar arte depois pode apenas reduzir a folga, nunca aumentar o canvas.
 */
export function computeRenderBounds(map, options = {}) {
  if (!map || !Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 1 || map.height < 1) {
    throw new TypeError('VillageMap invalido: width e height positivos sao obrigatorios.');
  }
  const resolved = optionsWithDefaults(options);
  const halfW = resolved.tileWidth / 2;
  const halfH = resolved.tileHeight / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const point = projectPoint(x, y, levelAt(map, x, y), resolved);
      include(point.x - halfW, point.y - halfH);
      include(point.x + halfW, point.y + halfH + levelAt(map, x, y) * resolved.heightStep);
    }
  }

  for (const building of map.buildings ?? []) {
    const footprint = buildingFootprint(building);
    const level = finite(building.baseLevel, levelAt(map, building.x, building.y));
    const corners = [
      projectPoint(building.x - 0.5, building.y - 0.5, level, resolved),
      projectPoint(building.x + footprint.width - 0.5, building.y - 0.5, level, resolved),
      projectPoint(building.x + footprint.width - 0.5, building.y + footprint.height - 0.5, level, resolved),
      projectPoint(building.x - 0.5, building.y + footprint.height - 0.5, level, resolved),
    ];
    const vertical = buildingPixels(building, resolved).total;
    for (const point of corners) {
      include(point.x - resolved.tileWidth, point.y - vertical - resolved.tileHeight);
      include(point.x + resolved.tileWidth * 1.75, point.y + resolved.tileHeight * 1.75);
    }
  }

  for (const prop of map.props ?? []) {
    const level = finite(prop.level, levelAt(map, prop.x, prop.y));
    const point = projectPoint(prop.x, prop.y, level, resolved);
    const metric = propMetrics(prop, resolved);
    include(point.x - metric.width / 2 - resolved.tileWidth, point.y - metric.height - resolved.tileHeight);
    include(point.x + metric.width / 2 + metric.height * 0.45, point.y + metric.height * 0.35 + resolved.tileHeight);
  }

  minX = Math.floor(minX - resolved.padding);
  minY = Math.floor(minY - resolved.padding);
  maxX = Math.ceil(maxX + resolved.padding);
  maxY = Math.ceil(maxY + resolved.padding);
  return Object.freeze({
    width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY),
    originX: -minX, originY: -minY, minX, minY, maxX, maxY,
    ...resolved,
  });
}

function makeCanvas(width, height, supplied) {
  const canvas = supplied ?? (typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : typeof document !== 'undefined' ? document.createElement('canvas') : null);
  if (!canvas) throw new Error('Canvas 2D indisponivel neste ambiente.');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function polygon(ctx, fill, points, stroke = null, lineWidth = 1) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(Math.round(points[index].x), Math.round(points[index].y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function line(ctx, stroke, width, points) {
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(Math.round(points[index].x), Math.round(points[index].y));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function localPoint(x, y, level, state) {
  const point = projectPoint(x, y, level, state.metrics);
  return { x: point.x + state.metrics.originX, y: point.y + state.metrics.originY };
}

function diamondAt(x, y, level, state, inset = 0, lift = 0) {
  const center = localPoint(x, y, level, state);
  const halfW = state.metrics.tileWidth / 2 - inset;
  const halfH = state.metrics.tileHeight / 2 - inset / 2;
  center.y -= lift;
  return {
    center,
    north: { x: center.x, y: center.y - halfH }, east: { x: center.x + halfW, y: center.y },
    south: { x: center.x, y: center.y + halfH }, west: { x: center.x - halfW, y: center.y },
  };
}

function terrainColors(map, type, x, y) {
  const palette = TERRAIN[biomeOf(map)] ?? TERRAIN.temperate;
  const colors = palette[type] ?? palette.grass;
  const top = colors[hash2(x, y, 17) % colors.length];
  return { top, east: tint(top, -34), south: tint(top, -49) };
}

function drawTerrainTile(ctx, map, x, y, state) {
  const level = levelAt(map, x, y);
  const type = map.terrain?.[y * map.width + x] ?? 'grass';
  const shape = diamondAt(x, y, level, state);
  const colors = terrainColors(map, type, x, y);
  const xLevel = levelAt(map, x + 1, y);
  const yLevel = levelAt(map, x, y + 1);

  if (xLevel < level) {
    const drop = (level - xLevel) * state.metrics.heightStep;
    polygon(ctx, colors.east, [shape.east, shape.south, { x: shape.south.x, y: shape.south.y + drop }, { x: shape.east.x, y: shape.east.y + drop }], tint(colors.east, -18));
    if (drop > state.metrics.heightStep * 1.5) {
      for (let offset = state.metrics.heightStep; offset < drop; offset += state.metrics.heightStep) {
        line(ctx, 'rgba(38,30,24,.22)', 1, [{ x: shape.east.x, y: shape.east.y + offset }, { x: shape.south.x, y: shape.south.y + offset }]);
      }
    }
  }
  if (yLevel < level) {
    const drop = (level - yLevel) * state.metrics.heightStep;
    polygon(ctx, colors.south, [shape.south, shape.west, { x: shape.west.x, y: shape.west.y + drop }, { x: shape.south.x, y: shape.south.y + drop }], tint(colors.south, -18));
    if (drop > state.metrics.heightStep * 1.5) {
      for (let offset = state.metrics.heightStep; offset < drop; offset += state.metrics.heightStep) {
        line(ctx, 'rgba(28,23,20,.24)', 1, [{ x: shape.south.x, y: shape.south.y + offset }, { x: shape.west.x, y: shape.west.y + offset }]);
      }
    }
  }

  polygon(ctx, colors.top, [shape.north, shape.east, shape.south, shape.west], tint(colors.top, -14));
  if (type === 'water') {
    const glint = hash2(x, y, 91) % 5;
    if (glint < 2) line(ctx, 'rgba(215,244,244,.40)', 1, [
      { x: shape.west.x + state.metrics.tileWidth * .22, y: shape.center.y + glint },
      { x: shape.east.x - state.metrics.tileWidth * .24, y: shape.center.y + glint },
    ]);
    for (const [dx, dy, edge] of [[1, 0, [shape.east, shape.south]], [0, 1, [shape.south, shape.west]], [-1, 0, [shape.west, shape.north]], [0, -1, [shape.north, shape.east]]]) {
      const next = map.terrain?.[(y + dy) * map.width + x + dx];
      if (x + dx >= 0 && y + dy >= 0 && x + dx < map.width && y + dy < map.height && next && next !== 'water') {
        line(ctx, 'rgba(236,250,235,.60)', 1, edge);
      }
    }
  } else if (level > Math.max(xLevel, yLevel)) {
    line(ctx, 'rgba(255,244,208,.16)', 1, [shape.west, shape.north, shape.east]);
  }
  if (hash2(x, y, 44) % 13 === 0 && type !== 'water' && type !== 'snow') {
    const dot = shape.center;
    ctx.fillStyle = 'rgba(46,61,35,.22)';
    ctx.fillRect(Math.round(dot.x - 2), Math.round(dot.y), 2, 1);
  }
}

function drawRoad(ctx, road, map, state) {
  const level = levelAt(map, road.x, road.y);
  const isBridge = Boolean(road.bridge);
  const shape = diamondAt(road.x, road.y, level, state, isBridge ? 1 : 3, isBridge ? 3 : 0);
  if (isBridge) {
    polygon(ctx, '#765034', [shape.north, shape.east, { x: shape.south.x, y: shape.south.y + 3 }, { x: shape.west.x, y: shape.west.y + 3 }], '#3d2b20');
    polygon(ctx, '#a77843', [shape.north, shape.east, shape.south, shape.west], '#4d3525');
    const orientation = road.orientation ?? 'cross';
    const count = 5;
    for (let index = 1; index < count; index += 1) {
      const t = index / count;
      if (orientation === 'ns') {
        const a = { x: shape.north.x * (1 - t) + shape.west.x * t, y: shape.north.y * (1 - t) + shape.west.y * t };
        const b = { x: shape.east.x * (1 - t) + shape.south.x * t, y: shape.east.y * (1 - t) + shape.south.y * t };
        line(ctx, 'rgba(69,42,25,.55)', 1, [a, b]);
      } else {
        const a = { x: shape.west.x * (1 - t) + shape.south.x * t, y: shape.west.y * (1 - t) + shape.south.y * t };
        const b = { x: shape.north.x * (1 - t) + shape.east.x * t, y: shape.north.y * (1 - t) + shape.east.y * t };
        line(ctx, 'rgba(69,42,25,.55)', 1, [a, b]);
      }
    }
    line(ctx, '#d3a25d', 2, [shape.west, shape.north, shape.east]);
    line(ctx, '#4b3323', 1, [{ x: shape.west.x, y: shape.west.y - 3 }, { x: shape.north.x, y: shape.north.y - 3 }, { x: shape.east.x, y: shape.east.y - 3 }]);
    return;
  }
  polygon(ctx, road.kind === 'plaza' ? '#b5a071' : '#947958', [shape.north, shape.east, shape.south, shape.west], 'rgba(65,49,36,.30)');
  if (hash2(road.x, road.y, 6) % 4 === 0) {
    ctx.fillStyle = 'rgba(230,210,170,.35)';
    ctx.fillRect(Math.round(shape.center.x - 2), Math.round(shape.center.y), 3, 1);
  }
}

function isPlazaTile(plaza, x, y) {
  return plaza && x >= plaza.x && y >= plaza.y && x < plaza.x + plaza.width && y < plaza.y + plaza.height;
}

function drawPlazaTile(ctx, x, y, level, state) {
  const shape = diamondAt(x, y, level, state, 1);
  polygon(ctx, hash2(x, y, 8) % 2 ? '#b9a475' : '#c3ae7d', [shape.north, shape.east, shape.south, shape.west], '#796b4e');
  line(ctx, 'rgba(245,228,182,.28)', 1, [shape.west, shape.north, shape.east]);
}

function buildingCorners(building, state) {
  const footprint = buildingFootprint(building);
  const level = finite(building.baseLevel, levelAt(state.map, building.x, building.y));
  const n = localPoint(building.x - .5, building.y - .5, level, state);
  const e = localPoint(building.x + footprint.width - .5, building.y - .5, level, state);
  const s = localPoint(building.x + footprint.width - .5, building.y + footprint.height - .5, level, state);
  const w = localPoint(building.x - .5, building.y + footprint.height - .5, level, state);
  return { n, e, s, w, footprint, level };
}

function shifted(point, dy) { return { x: point.x, y: point.y + dy }; }

function mixPoint(a, b, t = .5) { return { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t }; }

function drawBuildingShadow(ctx, building, state) {
  const c = buildingCorners(building, state);
  const vertical = buildingPixels(building, state.metrics).total;
  const dx = vertical * .42;
  const dy = vertical * .20;
  ctx.save();
  ctx.globalAlpha = .2;
  polygon(ctx, '#172019', [c.w, c.s, { x: c.s.x + dx, y: c.s.y + dy }, { x: c.w.x + dx, y: c.w.y + dy }]);
  ctx.restore();
}

function drawWindows(ctx, building, wall, side, material, count) {
  const topA = side === 'east' ? wall.eTop : wall.sTop;
  const topB = side === 'east' ? wall.sTop : wall.wTop;
  const bottomA = side === 'east' ? wall.e : wall.s;
  const bottomB = side === 'east' ? wall.s : wall.w;
  for (let index = 1; index <= count; index += 1) {
    const t = index / (count + 1);
    const top = mixPoint(topA, topB, t);
    const bottom = mixPoint(bottomA, bottomB, t);
    const center = mixPoint(top, bottom, .56);
    const dx = side === 'east' ? -3 : 3;
    polygon(ctx, material.trim, [
      { x: center.x - 4, y: center.y - 5 }, { x: center.x + dx, y: center.y - 2 },
      { x: center.x + dx, y: center.y + 5 }, { x: center.x - 4, y: center.y + 2 },
    ]);
    polygon(ctx, side === 'east' ? '#71939a' : '#4e707a', [
      { x: center.x - 3, y: center.y - 4 }, { x: center.x + dx - Math.sign(dx), y: center.y - 2 },
      { x: center.x + dx - Math.sign(dx), y: center.y + 3 }, { x: center.x - 3, y: center.y + 1 },
    ]);
  }
}

function drawBuilding(ctx, building, state) {
  const c = buildingCorners(building, state);
  const pixels = buildingPixels(building, state.metrics);
  const wallKey = { timber: 'wood', plaster: 'tile' }[building.material] ?? building.material;
  const wallMaterial = MATERIALS[wallKey] ?? MATERIALS.wood;
  const roofMaterial = MATERIALS[building.roof] ?? wallMaterial;
  const mat = {
    ...wallMaterial,
    roof: roofMaterial.roof,
    roofLit: roofMaterial.roofLit,
    roofDark: roofMaterial.roofDark,
  };
  const wallLift = -pixels.wall;
  const wall = { ...c, nTop: shifted(c.n, wallLift), eTop: shifted(c.e, wallLift), sTop: shifted(c.s, wallLift), wTop: shifted(c.w, wallLift) };

  polygon(ctx, '#5a5448', [c.e, c.s, c.w, c.n], '#39352f');
  polygon(ctx, mat.shade, [wall.eTop, wall.sTop, wall.s, wall.e], mat.trim);
  polygon(ctx, mat.wall, [wall.sTop, wall.wTop, wall.w, wall.s], mat.trim);
  line(ctx, 'rgba(255,248,220,.20)', 1, [wall.wTop, wall.sTop]);

  const beams = Math.max(1, Math.floor((c.footprint.width + c.footprint.height) / 3));
  for (let index = 1; index <= beams; index += 1) {
    const t = index / (beams + 1);
    const a = mixPoint(wall.sTop, wall.wTop, t);
    const b = mixPoint(wall.s, wall.w, t);
    line(ctx, 'rgba(70,47,29,.45)', 1, [a, b]);
  }
  drawWindows(ctx, building, wall, 'east', mat, Math.max(1, c.footprint.height - 1));
  drawWindows(ctx, building, wall, 'south', mat, Math.max(1, c.footprint.width - 1));

  const roofBase = { n: wall.nTop, e: wall.eTop, s: wall.sTop, w: wall.wTop };
  const roofLift = -pixels.roof;
  const longX = c.footprint.width >= c.footprint.height;
  let ridgeA, ridgeB;
  if (longX) {
    ridgeA = shifted(mixPoint(roofBase.n, roofBase.w, .5), roofLift);
    ridgeB = shifted(mixPoint(roofBase.e, roofBase.s, .5), roofLift);
  } else {
    ridgeA = shifted(mixPoint(roofBase.n, roofBase.e, .5), roofLift);
    ridgeB = shifted(mixPoint(roofBase.w, roofBase.s, .5), roofLift);
  }
  polygon(ctx, mat.roofDark, [ridgeA, ridgeB, roofBase.s, roofBase.w], tint(mat.roofDark, -10));
  polygon(ctx, mat.roof, [roofBase.n, roofBase.e, ridgeB, ridgeA], tint(mat.roofDark, -4));
  polygon(ctx, mat.roofLit, longX ? [ridgeB, roofBase.e, roofBase.s] : [ridgeA, roofBase.n, roofBase.w], tint(mat.roof, -12));
  line(ctx, tint(mat.roofLit, 24), 2, [ridgeA, ridgeB]);
  line(ctx, 'rgba(20,18,16,.35)', 2, [roofBase.w, roofBase.s, roofBase.e]);

  const facing = building.orientation ?? building.facing ?? 'south';
  const doorSide = facing === 'east' || facing === 'west' ? 'east' : 'south';
  const a = doorSide === 'east' ? wall.eTop : wall.sTop;
  const b = doorSide === 'east' ? wall.sTop : wall.wTop;
  const ga = doorSide === 'east' ? wall.e : wall.s;
  const gb = doorSide === 'east' ? wall.s : wall.w;
  const topMid = mixPoint(a, b, .5);
  const groundMid = mixPoint(ga, gb, .5);
  const doorTop = mixPoint(topMid, groundMid, .42);
  polygon(ctx, '#3b291e', [
    { x: doorTop.x - 4, y: doorTop.y - 2 }, { x: doorTop.x + 4, y: doorTop.y + 1 },
    { x: groundMid.x + 4, y: groundMid.y }, { x: groundMid.x - 4, y: groundMid.y - 3 },
  ], mat.trim);

  drawBuildingFeature(ctx, building, { ...wall, ridgeA, ridgeB, pixels }, state);
}

function drawBuildingFeature(ctx, building, shape, state) {
  const type = building.type ?? 'house';
  const center = mixPoint(shape.ridgeA, shape.ridgeB, .5);
  if (type === 'chapel') {
    const top = { x: center.x, y: center.y - state.metrics.tileHeight * 2.2 };
    line(ctx, '#4c3826', 3, [center, top]);
    line(ctx, '#d8c88e', 2, [{ x: top.x - 6, y: top.y + 5 }, { x: top.x + 6, y: top.y + 5 }]);
  } else if (type === 'mill') {
    const hub = { x: shape.sTop.x + 5, y: shape.sTop.y - 6 };
    ctx.fillStyle = '#d0aa68';
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) {
      const end = { x: hub.x + Math.cos(angle) * 23, y: hub.y + Math.sin(angle) * 18 };
      line(ctx, '#6b4b2c', 3, [hub, end]);
    }
    ctx.beginPath(); ctx.arc(hub.x, hub.y, 4, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'blacksmith' || type === 'smithy') {
    const chimney = { x: shape.ridgeB.x - 8, y: shape.ridgeB.y + 4 };
    polygon(ctx, '#625b50', [
      { x: chimney.x - 4, y: chimney.y }, { x: chimney.x + 3, y: chimney.y + 2 },
      { x: chimney.x + 3, y: chimney.y - 18 }, { x: chimney.x - 4, y: chimney.y - 20 },
    ], '#383833');
  } else if (type === 'watchtower' || type === 'tower') {
    const y = center.y - state.metrics.tileHeight * 1.2;
    line(ctx, '#6c2929', 2, [{ x: center.x, y: center.y }, { x: center.x, y }]);
    polygon(ctx, '#b8443b', [{ x: center.x, y }, { x: center.x + 18, y: y + 5 }, { x: center.x, y: y + 10 }]);
  } else if (type === 'inn' || type === 'hall' || type === 'town-hall' || type === 'townHall') {
    const mark = { x: shape.sTop.x - 10, y: shape.sTop.y + 7 };
    polygon(ctx, '#92372f', [mark, { x: mark.x + 10, y: mark.y + 3 }, { x: mark.x + 10, y: mark.y + 15 }, { x: mark.x, y: mark.y + 12 }], '#542b25');
  } else if (type === 'market' || type === 'shop') {
    line(ctx, '#e8d7a8', 3, [shape.sTop, shape.wTop]);
    line(ctx, '#a43e35', 2, [mixPoint(shape.sTop, shape.wTop, .2), mixPoint(shape.sTop, shape.wTop, .4)]);
  }
}

function propAssetType(prop, biome) {
  if (prop.type === 'oak') return 'temperate-tree';
  if (prop.type === 'tree') {
    if (biome === 'snowy') return 'snowy-pine';
    if (biome === 'wetland') return 'swamp-willow';
    return 'temperate-tree';
  }
  if (prop.type === 'pine') return 'snowy-pine';
  if (prop.type === 'willow') return 'swamp-willow';
  if (prop.type === 'cactus') return 'desert-cactus';
  return prop.type;
}

function drawPropShadow(ctx, prop, state) {
  const level = finite(prop.level, levelAt(state.map, prop.x, prop.y));
  const center = localPoint(prop.x, prop.y, level, state);
  const metric = propMetrics(prop, state.metrics);
  ctx.save();
  ctx.globalAlpha = .18;
  ctx.fillStyle = '#142019';
  ctx.beginPath();
  ctx.ellipse(center.x + metric.height * .18, center.y + metric.height * .10, metric.width * .35, Math.max(3, metric.height * .08), .22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawProp(ctx, prop, state) {
  const level = finite(prop.level, levelAt(state.map, prop.x, prop.y));
  const center = localPoint(prop.x, prop.y, level, state);
  const type = propAssetType(prop, biomeOf(state.map));
  const asset = ART.get(type);
  if (asset) {
    const scale = state.metrics.tileWidth / 32;
    const width = (asset.naturalWidth || asset.width) * scale;
    const height = (asset.naturalHeight || asset.height) * scale;
    ctx.drawImage(asset, Math.round(center.x - width / 2), Math.round(center.y - height + state.metrics.tileHeight / 2), Math.round(width), Math.round(height));
    return;
  }
  drawProceduralProp(ctx, { ...prop, type }, center, state);
}

function drawProceduralProp(ctx, prop, center, state) {
  const s = state.metrics.tileWidth / 32;
  const rect = (fill, x, y, w, h) => { ctx.fillStyle = fill; ctx.fillRect(Math.round(center.x + x * s), Math.round(center.y + y * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))); };
  switch (prop.type) {
    case 'tree': case 'temperate-tree': case 'snowy-pine': case 'pine': case 'willow': case 'swamp-willow': {
      const snowy = prop.type.includes('snow') || prop.type === 'pine';
      const willow = prop.type.includes('willow');
      rect('#68482e', -2, -31, 5, 35);
      const foliage = snowy ? ['#2f5650', '#406d60', '#dfe9e7'] : willow ? ['#355d3b', '#4d7a49', '#6d9659'] : ['#285b3c', '#3e7647', '#629554'];
      polygon(ctx, foliage[0], [{ x: center.x, y: center.y - 73*s }, { x: center.x + 25*s, y: center.y - 30*s }, { x: center.x - 25*s, y: center.y - 30*s }]);
      polygon(ctx, foliage[1], [{ x: center.x, y: center.y - 63*s }, { x: center.x + 31*s, y: center.y - 20*s }, { x: center.x - 31*s, y: center.y - 20*s }]);
      polygon(ctx, foliage[2], [{ x: center.x - 8*s, y: center.y - 62*s }, { x: center.x + 15*s, y: center.y - 34*s }, { x: center.x - 22*s, y: center.y - 34*s }]);
      break;
    }
    case 'cactus': case 'desert-cactus':
      rect('#397b4b', -4, -42, 8, 44); rect('#397b4b', -13, -27, 11, 7); rect('#397b4b', -13, -34, 6, 13); rect('#4d9660', 3, -23, 11, 7); rect('#4d9660', 9, -29, 6, 12); break;
    case 'rock':
      polygon(ctx, '#67736c', [{ x: center.x-16*s,y:center.y },{x:center.x-12*s,y:center.y-14*s},{x:center.x+2*s,y:center.y-21*s},{x:center.x+16*s,y:center.y-7*s},{x:center.x+11*s,y:center.y+2*s}], '#39443e');
      line(ctx, '#a2aca2', 2*s, [{x:center.x-10*s,y:center.y-12*s},{x:center.x+1*s,y:center.y-17*s},{x:center.x+8*s,y:center.y-10*s}]); break;
    case 'well':
      polygon(ctx, '#666d67', [{x:center.x-16*s,y:center.y-8*s},{x:center.x,y:center.y-16*s},{x:center.x+16*s,y:center.y-8*s},{x:center.x,y:center.y}], '#3d4642');
      line(ctx, '#8c6840', 3*s, [{x:center.x-12*s,y:center.y-10*s},{x:center.x-12*s,y:center.y-34*s},{x:center.x+12*s,y:center.y-22*s},{x:center.x+12*s,y:center.y-2*s}]); break;
    case 'cart':
      polygon(ctx, '#91673b', [{x:center.x-23*s,y:center.y-20*s},{x:center.x+5*s,y:center.y-8*s},{x:center.x+21*s,y:center.y-16*s},{x:center.x-7*s,y:center.y-28*s}], '#4d3523');
      ctx.fillStyle='#443023'; ctx.beginPath(); ctx.arc(center.x-13*s,center.y-6*s,7*s,0,Math.PI*2);ctx.fill(); ctx.beginPath();ctx.arc(center.x+13*s,center.y-6*s,7*s,0,Math.PI*2);ctx.fill(); break;
    case 'haystack':
      polygon(ctx, '#c99b42', [{x:center.x-18*s,y:center.y},{x:center.x-14*s,y:center.y-24*s},{x:center.x,y:center.y-35*s},{x:center.x+17*s,y:center.y-20*s},{x:center.x+18*s,y:center.y}], '#88632e');
      line(ctx,'#efd072',2*s,[{x:center.x-12*s,y:center.y-21*s},{x:center.x+13*s,y:center.y-11*s}]); break;
    case 'fence':
      line(ctx, '#765032', 3*s, [{x:center.x-16*s,y:center.y-8*s},{x:center.x+16*s,y:center.y+8*s}]);
      line(ctx, '#aa7948', 3*s, [{x:center.x-11*s,y:center.y-15*s},{x:center.x-11*s,y:center.y-1*s}]); line(ctx,'#aa7948',3*s,[{x:center.x+11*s,y:center.y-4*s},{x:center.x+11*s,y:center.y+12*s}]); break;
    case 'bush':
      polygon(ctx, '#37633e', [{x:center.x-15*s,y:center.y},{x:center.x-13*s,y:center.y-15*s},{x:center.x,y:center.y-23*s},{x:center.x+16*s,y:center.y-10*s},{x:center.x+14*s,y:center.y}], '#274b32');
      polygon(ctx, '#5a8c50', [{x:center.x-9*s,y:center.y-10*s},{x:center.x-3*s,y:center.y-19*s},{x:center.x+8*s,y:center.y-12*s},{x:center.x+4*s,y:center.y-5*s}]); break;
    default:
      rect('#657f4a', -1, -13, 2, 14); rect('#8ea95c', -7, -9, 6, 2); rect('#8ea95c', 1, -6, 7, 2);
  }
}

function depthForBuilding(building) {
  const footprint = buildingFootprint(building);
  return Math.floor(building.x + building.y + footprint.width + footprint.height - 2);
}

function depthForProp(prop) { return Math.floor(prop.x + prop.y); }

function ambientColor(biome) {
  return { temperate: 'rgba(255,224,155,.07)', arid: 'rgba(255,195,112,.10)', snowy: 'rgba(170,210,255,.08)', wetland: 'rgba(127,187,154,.08)' }[biome] ?? 'rgba(255,224,155,.07)';
}

/** Renderiza o mapa completo, independente do enquadramento atual da camera. */
export function renderVillageToCanvas(map, options = {}) {
  const metrics = computeRenderBounds(map, options);
  const canvas = makeCanvas(metrics.width, metrics.height, options.canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Contexto Canvas 2D indisponivel.');
  ctx.imageSmoothingEnabled = false;
  const biome = biomeOf(map);
  ctx.fillStyle = biome === 'snowy' ? '#d5e0df' : biome === 'arid' ? '#b9955f' : '#294737';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const state = { map, metrics };
  const roads = new Map((map.roads ?? []).map((road) => [`${road.x},${road.y}`, road]));
  const buildingsByDepth = new Map();
  const propsByDepth = new Map();
  for (const building of map.buildings ?? []) {
    const depth = depthForBuilding(building);
    if (!buildingsByDepth.has(depth)) buildingsByDepth.set(depth, []);
    buildingsByDepth.get(depth).push(building);
  }
  for (const prop of map.props ?? []) {
    const depth = depthForProp(prop);
    if (!propsByDepth.has(depth)) propsByDepth.set(depth, []);
    propsByDepth.get(depth).push(prop);
  }

  const maxDepth = map.width + map.height + 8;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const xStart = Math.max(0, depth - (map.height - 1));
    const xEnd = Math.min(map.width - 1, depth);
    for (let x = xStart; x <= xEnd; x += 1) {
      const y = depth - x;
      drawTerrainTile(ctx, map, x, y, state);
      const road = roads.get(`${x},${y}`);
      if (road) drawRoad(ctx, road, map, state);
      else if (isPlazaTile(map.plaza, x, y)) drawPlazaTile(ctx, x, y, levelAt(map, x, y), state);
    }
    for (const building of buildingsByDepth.get(depth) ?? []) drawBuildingShadow(ctx, building, state);
    for (const prop of propsByDepth.get(depth) ?? []) drawPropShadow(ctx, prop, state);
    const objects = [
      ...(buildingsByDepth.get(depth) ?? []).map((value) => ({ kind: 'building', value })),
      ...(propsByDepth.get(depth) ?? []).map((value) => ({ kind: 'prop', value })),
    ].sort((a, b) => (a.value.x - b.value.x) || (a.kind === 'building' ? -1 : 1));
    for (const object of objects) {
      if (object.kind === 'building') drawBuilding(ctx, object.value, state);
      else drawProp(ctx, object.value, state);
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = ambientColor(biome);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  return canvas;
}

function loadImage(path) {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => resolve(null), { once: true });
    image.src = path;
  });
}

/** Carrega props opcionais. Falhas sao deliberadamente substituidas por arte procedural. */
export async function loadArtAssets(basePath = '/assets/props') {
  const entries = Object.entries(ART_MANIFEST);
  await Promise.all(entries.map(async ([key, originalPath]) => {
    if (ART.has(key)) return;
    const file = originalPath.slice(originalPath.lastIndexOf('/') + 1);
    const image = await loadImage(`${String(basePath).replace(/\/$/, '')}/${file}`);
    if (image) ART.set(key, image);
  }));
  return Object.fromEntries(ART.entries());
}

export class VillageRenderer {
  constructor(canvas) {
    if (!canvas) throw new TypeError('VillageRenderer requer um canvas visivel.');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.map = null;
    this.world = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.drag = null;
    this.frame = 0;
    this.dpr = 1;
    this.bindInput();
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    if (this.resizeObserver && canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  setMap(map) {
    this.map = map;
    this.world = renderVillageToCanvas(map);
    this.center();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    this.canvas.width = Math.max(1, Math.round((rect.width || this.canvas.clientWidth || 1) * this.dpr));
    this.canvas.height = Math.max(1, Math.round((rect.height || this.canvas.clientHeight || 1) * this.dpr));
    this.draw();
  }

  viewport() { return { width: this.canvas.width / this.dpr, height: this.canvas.height / this.dpr }; }

  notifyCamera() {
    if (typeof CustomEvent !== 'undefined') this.canvas.dispatchEvent(new CustomEvent('camerachange', { detail: { ...this.camera } }));
  }

  clampCamera() {
    if (!this.world) return;
    const view = this.viewport();
    const worldWidth = this.world.width * this.camera.zoom;
    const worldHeight = this.world.height * this.camera.zoom;
    const marginX = Math.min(view.width * .35, 220);
    const marginY = Math.min(view.height * .35, 180);
    this.camera.x = worldWidth <= view.width ? (view.width - worldWidth) / 2 : clamp(this.camera.x, view.width - worldWidth - marginX, marginX);
    this.camera.y = worldHeight <= view.height ? (view.height - worldHeight) / 2 : clamp(this.camera.y, view.height - worldHeight - marginY, marginY);
  }

  center() {
    if (!this.world) return;
    const view = this.viewport();
    this.camera.zoom = clamp(Math.min((view.width - 32) / this.world.width, (view.height - 32) / this.world.height), .18, 3);
    this.camera.x = (view.width - this.world.width * this.camera.zoom) / 2;
    this.camera.y = (view.height - this.world.height * this.camera.zoom) / 2;
    this.clampCamera();
    this.notifyCamera();
    this.draw();
  }

  setZoom(nextZoom, focusX, focusY) {
    if (!this.world) return;
    const oldZoom = this.camera.zoom;
    const zoom = clamp(finite(nextZoom, oldZoom), .15, 5);
    const rect = this.canvas.getBoundingClientRect();
    const fx = finite(focusX, rect.width / 2);
    const fy = finite(focusY, rect.height / 2);
    const worldX = (fx - this.camera.x) / oldZoom;
    const worldY = (fy - this.camera.y) / oldZoom;
    this.camera.zoom = zoom;
    this.camera.x = fx - worldX * zoom;
    this.camera.y = fy - worldY * zoom;
    this.clampCamera();
    this.notifyCamera();
    this.draw();
  }

  bindInput() {
    this.onPointerDown = (event) => {
      this.canvas.setPointerCapture?.(event.pointerId);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cameraX: this.camera.x, cameraY: this.camera.y };
      this.canvas.classList?.add('dragging');
    };
    this.onPointerMove = (event) => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      this.camera.x = this.drag.cameraX + event.clientX - this.drag.x;
      this.camera.y = this.drag.cameraY + event.clientY - this.drag.y;
      this.clampCamera(); this.notifyCamera(); this.draw();
    };
    this.onPointerEnd = (event) => {
      if (this.drag?.id === event.pointerId) this.drag = null;
      this.canvas.classList?.remove('dragging');
    };
    this.onWheel = (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.setZoom(this.camera.zoom * (event.deltaY > 0 ? .86 : 1.16), event.clientX - rect.left, event.clientY - rect.top);
    };
    this.onKeyDown = (event) => {
      const amount = event.shiftKey ? 80 : 32;
      if (event.key === 'ArrowLeft') this.camera.x += amount;
      else if (event.key === 'ArrowRight') this.camera.x -= amount;
      else if (event.key === 'ArrowUp') this.camera.y += amount;
      else if (event.key === 'ArrowDown') this.camera.y -= amount;
      else if (event.key === '+' || event.key === '=') return this.setZoom(this.camera.zoom * 1.2);
      else if (event.key === '-') return this.setZoom(this.camera.zoom / 1.2);
      else return;
      event.preventDefault(); this.clampCamera(); this.notifyCamera(); this.draw();
    };
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerEnd);
    this.canvas.addEventListener('pointercancel', this.onPointerEnd);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('keydown', this.onKeyDown);
  }

  draw() {
    if (this.frame || typeof requestAnimationFrame === 'undefined') return this.drawNow();
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.drawNow(); });
  }

  drawNow() {
    if (!this.ctx) return;
    const view = this.viewport();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = '#14271f';
    this.ctx.fillRect(0, 0, view.width, view.height);
    if (!this.world) return;
    this.ctx.save();
    this.ctx.translate(Math.round(this.camera.x), Math.round(this.camera.y));
    this.ctx.scale(this.camera.zoom, this.camera.zoom);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.world, 0, 0);
    this.ctx.restore();
  }

  exportCanvas(options = {}) {
    if (!this.map) throw new Error('Nenhum mapa foi definido para exportacao.');
    return renderVillageToCanvas(this.map, options);
  }

  destroy() {
    this.resizeObserver?.disconnect();
    if (this.frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerEnd);
    this.canvas.removeEventListener('pointercancel', this.onPointerEnd);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
  }
}

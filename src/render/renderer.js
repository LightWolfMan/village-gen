import { TILE, TERRAIN_FILLS, SPRITES, fillKeyFor, pickIndex } from './atlas.js';

const ART = { village: null, floor: null };

// Paleta de fallback (usada quando as folhas de arte não carregam).
const PALETTE = {
  grass: ['#668f4e', '#6f9955', '#759f59', '#62894b'],
  meadow: ['#9db24a', '#a7bd52', '#93a942'],
  forest: ['#496d42', '#43663d', '#527648'],
  water: ['#6fb0c4', '#79b7ca', '#68a9be'],
  sand: ['#e6c489', '#ecca90', '#dfbc82'],
  dirt: ['#8d745e', '#82694f', '#977c63'],
  snow: ['#eef1f3', '#e6eaee', '#f6f7f9'],
  marsh: ['#5f7a4a', '#556f42', '#657f4f'],
  road: '#8d745e', roadEdge: '#5f4c38', plaza: '#b49b70',
  shadow: 'rgba(24, 32, 20, .27)'
};

// Materiais de edifício: [telhado escuro, telhado médio, telhado claro], parede, viga.
const MATERIALS = {
  thatch: { roof: ['#7c5a24', '#a9822f', '#d8b154'], wall: '#d3ba82', trim: '#8a6a3c' },
  tile: { roof: ['#7a2f28', '#b6503f', '#e0906a'], wall: '#d7c096', trim: '#7c5033' },
  wood: { roof: ['#4a3320', '#6d4e2c', '#94733f'], wall: '#b3854f', trim: '#5c4126' },
  stone: { roof: ['#3c474d', '#5c6970', '#8fa4ac'], wall: '#b2ab9c', trim: '#6c6456' }
};

// Luz padronizada vindo do noroeste: sombras projetadas para o sudeste (baixo-direita).
const LIGHT = { sx: 0.52, sy: 0.34 }; // deslocamento da sombra por unidade de altura
const DECO_HEIGHT = { tree: 42, 'dead-tree': 30, bush: 13, rock: 9, cactus: 18, haystack: 14, cart: 9, snowman: 16, well: 12, reeds: 9, 'dead-bush': 7 };
// Tom ambiente por bioma (soft-light) para dar clima ao conjunto.
const AMBIENT = {
  temperate: 'rgba(255, 226, 158, 0.10)',
  arid: 'rgba(255, 210, 130, 0.14)',
  snowy: 'rgba(178, 210, 255, 0.12)',
  wetland: 'rgba(150, 205, 150, 0.10)'
};

function hash2(x, y, salt = 0) {
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + salt, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Paralelogramo de sombra projetada a partir da base de um objeto (para o SE).
function shadowPoly(sctx, fx, baseY, fw, height) {
  const dx = height * LIGHT.sx;
  const dy = height * LIGHT.sy;
  sctx.beginPath();
  sctx.moveTo(fx, baseY);
  sctx.lineTo(fx + fw, baseY);
  sctx.lineTo(fx + fw + dx, baseY + dy);
  sctx.lineTo(fx + dx, baseY + dy);
  sctx.closePath();
  sctx.fill();
}

function colorAt(colors, x, y, salt = 0) {
  return colors[hash2(x, y, salt) % colors.length];
}

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function drawFloorSprite(ctx, key, x, y, px, py) {
  const variants = TERRAIN_FILLS[key];
  const [sx, sy] = variants[pickIndex(x, y, 5, variants.length)];
  ctx.drawImage(ART.floor, sx, sy, TILE, TILE, px, py, TILE, TILE);
}

function drawGroundTile(ctx, map, x, y) {
  const type = map.terrain[y * map.width + x];
  const px = x * TILE;
  const py = y * TILE;

  if (ART.floor) {
    drawFloorSprite(ctx, fillKeyFor(type, map.biome), x, y, px, py);
  } else {
    const colors = PALETTE[type] ?? PALETTE.grass;
    rect(ctx, colorAt(colors, x, y), px, py, TILE, TILE);
  }

  const h = hash2(x, y, 91);
  // Sobreposições que dão profundidade além do preenchimento base.
  if (type === 'forest') {
    rect(ctx, 'rgba(31,71,44,.34)', px, py, TILE, TILE);
    if (h % 6 === 0) rect(ctx, 'rgba(20,52,32,.4)', px + 4 + h % 6, py + 5, 3, 2);
  } else if (type === 'marsh') {
    rect(ctx, 'rgba(74,110,72,.5)', px, py, TILE, TILE);
    if (h % 5 === 0) rect(ctx, 'rgba(70,120,128,.55)', px + 3 + h % 7, py + 6 + (h >>> 3) % 5, 4, 3);
  } else if (type === 'water') {
    if (h % 7 < 2) rect(ctx, 'rgba(230,247,250,.35)', px + 2 + (h % 3) * 4, py + 7 + (h >>> 4) % 4, 5, 1);
    rect(ctx, 'rgba(35,86,104,.14)', px, py, TILE, TILE);
  } else if (map.biome === 'snowy' && (type === 'grass' || type === 'forest')) {
    rect(ctx, 'rgba(236,242,246,.4)', px, py, TILE, TILE);
  }

  // Hillshade: relevo a partir da elevação (encostas ao NO iluminadas, ao SE sombreadas).
  if (type !== 'water' && map.elevation) {
    const w = map.width, ht = map.height;
    const idx = y * w + x;
    const e = map.elevation;
    const xl = x > 0 ? e[idx - 1] : e[idx];
    const xr = x < w - 1 ? e[idx + 1] : e[idx];
    const yt = y > 0 ? e[idx - w] : e[idx];
    const yb = y < ht - 1 ? e[idx + w] : e[idx];
    const light = -((xr - xl) + (yb - yt)); // >0 encosta voltada à luz (NO)
    if (light > 0.015) rect(ctx, `rgba(255,250,236,${Math.min(0.24, light * 1.7)})`, px, py, TILE, TILE);
    else if (light < -0.015) rect(ctx, `rgba(24,30,26,${Math.min(0.26, -light * 1.9)})`, px, py, TILE, TILE);
  }
}

function drawRoadTile(ctx, x, y, roadSet) {
  const px = x * TILE;
  const py = y * TILE;
  const n = roadSet.has(`${x},${y - 1}`);
  const s = roadSet.has(`${x},${y + 1}`);
  const w = roadSet.has(`${x - 1},${y}`);
  const e = roadSet.has(`${x + 1},${y}`);
  if (ART.floor) {
    drawFloorSprite(ctx, 'dirt', x + 97, y + 31, px, py); // offset p/ variante distinta
  } else {
    rect(ctx, colorAt(PALETTE.dirt, x, y), px, py, TILE, TILE);
  }
  // Bordas escurecidas onde a via toca terreno (dá forma ao caminho).
  const edge = 'rgba(46,34,22,.28)';
  if (!n) rect(ctx, edge, px, py, TILE, 2);
  if (!s) rect(ctx, edge, px, py + TILE - 2, TILE, 2);
  if (!w) rect(ctx, edge, px, py, 2, TILE);
  if (!e) rect(ctx, edge, px + TILE - 2, py, 2, TILE);
  const h = hash2(x, y, 17);
  if (h % 6 === 0) rect(ctx, 'rgba(232,206,158,.3)', px + 4 + h % 7, py + 4 + (h >>> 4) % 7, 2, 1);
}

function drawPlaza(ctx, plaza) {
  for (let y = plaza.y; y < plaza.y + plaza.height; y += 1) {
    for (let x = plaza.x; x < plaza.x + plaza.width; x += 1) {
      const px = x * TILE;
      const py = y * TILE;
      rect(ctx, colorAt(['#c3ac82', '#b9a276', '#ccb78c'], x, y), px, py, TILE, TILE);
      rect(ctx, 'rgba(91,75,54,.22)', px, py, TILE, 1);
      rect(ctx, 'rgba(240,224,183,.2)', px, py + 1, TILE, 1);
      if (hash2(x, y, 5) % 4 === 0) rect(ctx, 'rgba(120,100,70,.25)', px + 4, py + 9, 3, 3);
    }
  }
}

// ---- Edifícios ---------------------------------------------------------------

function drawSpriteBuilding(ctx, sprite, x, y, w, h) {
  rect(ctx, 'rgba(15,20,14,.24)', x + 2, y + h - 1, w + 1, 3); // oclusão de contato
  const scale = Math.max(w / sprite.w, (h + 14) / sprite.h);
  const dw = Math.round(sprite.w * scale);
  const dh = Math.round(sprite.h * scale);
  const dx = x + Math.round((w - dw) / 2);
  const dy = y + h - dh + 4;
  ctx.drawImage(ART.village, sprite.x, sprite.y, sprite.w, sprite.h, dx, dy, dw, dh);
}

function drawRoof(ctx, x, y, w, roofHeight, mat, hipped) {
  const baseY = y + roofHeight;
  const midX = x + Math.floor(w / 2);
  rect(ctx, mat.roof[0], x - 2, y + 5, w + 4, roofHeight - 2);
  // Corpo do telhado.
  ctx.fillStyle = mat.roof[1];
  ctx.beginPath();
  const apexL = hipped ? x + Math.floor(w * 0.28) : midX;
  const apexR = hipped ? x + Math.ceil(w * 0.72) : midX;
  const apexY = hipped ? y - 1 : y - 2;
  ctx.moveTo(x - 3, baseY);
  ctx.lineTo(apexL, apexY);
  ctx.lineTo(apexR, apexY);
  ctx.lineTo(x + w + 3, baseY);
  ctx.fill();
  // Face voltada ao noroeste iluminada.
  ctx.fillStyle = 'rgba(255,251,236,.17)';
  ctx.beginPath();
  ctx.moveTo(x - 3, baseY);
  ctx.lineTo(apexL, apexY);
  ctx.lineTo(midX, apexY);
  ctx.lineTo(midX, baseY);
  ctx.closePath();
  ctx.fill();
  // Face voltada ao sudeste sombreada.
  ctx.fillStyle = 'rgba(18,22,28,.2)';
  ctx.beginPath();
  ctx.moveTo(midX, baseY);
  ctx.lineTo(midX, apexY);
  ctx.lineTo(apexR, apexY);
  ctx.lineTo(x + w + 3, baseY);
  ctx.closePath();
  ctx.fill();
  // Cumeeira e sombra do beiral.
  rect(ctx, mat.roof[2], midX - 1, y + 1, 2, roofHeight - 5);
  rect(ctx, 'rgba(0,0,0,.18)', x - 3, baseY - 2, w + 6, 2);
}

function drawDoorAndWindows(ctx, building, x, y, w, h, roofHeight, mat) {
  const windowY = y + roofHeight + 5;
  const windows = Math.max(1, Math.floor((w - 12) / 16));
  for (let i = 0; i < windows; i += 1) {
    const wx = x + 6 + i * Math.floor((w - 12) / windows);
    rect(ctx, mat.trim, wx - 1, windowY - 1, 7, 7);
    rect(ctx, '#31505a', wx, windowY, 5, 5);
    rect(ctx, '#e7c46e', wx + 1, windowY + 1, 3, 3);
    rect(ctx, 'rgba(255,255,255,.3)', wx + 1, windowY + 1, 1, 1);
  }
  let doorX = x + Math.floor(w / 2) - 3;
  let doorY = y + h - 13;
  let doorW = 7;
  let doorH = 13;
  if (building.facing === 'north') doorY = y + roofHeight;
  if (building.facing === 'east' || building.facing === 'west') {
    doorX = building.facing === 'east' ? x : x + w - 8;
    doorY = y + h - 10;
    doorW = 8;
    doorH = 8;
  }
  rect(ctx, mat.trim, doorX - 1, doorY - 1, doorW + 2, doorH + 1);
  rect(ctx, '#3e2e24', doorX, doorY, doorW, doorH);
  rect(ctx, '#d8b35f', doorX + doorW - 2, doorY + Math.floor(doorH / 2), 1, 1);
}

function drawBuildingFeatures(ctx, building, x, y, w, h, roofHeight) {
  const cx = x + Math.floor(w / 2);
  const v = building.variant ?? 0;
  switch (building.type) {
    case 'chapel': {
      rect(ctx, '#f4ecd6', cx - 1, y - 9, 2, 9);
      rect(ctx, '#f4ecd6', cx - 4, y - 6, 8, 2);
      break;
    }
    case 'mill': {
      const mx = x + w - 3;
      rect(ctx, '#6a4d2c', mx - 1, y + roofHeight - 4, 3, 3);
      rect(ctx, '#caa25a', mx - 10, y + roofHeight - 12, 11, 2);
      rect(ctx, '#caa25a', mx - 1, y + roofHeight - 12, 11, 2);
      rect(ctx, '#caa25a', mx, y + roofHeight - 22, 2, 11);
      rect(ctx, '#caa25a', mx, y + roofHeight - 1, 2, 11);
      break;
    }
    case 'watchtower': {
      rect(ctx, MATERIALS.stone.wall, x + 2, y - 9, w - 4, 12);
      for (let bx = x + 2; bx < x + w - 3; bx += 5) rect(ctx, MATERIALS.stone.roof[0], bx, y - 12, 3, 3);
      rect(ctx, '#b6503f', cx, y - 18, 1, 7);
      rect(ctx, '#d86a52', cx + 1, y - 18, 6, 4);
      break;
    }
    case 'blacksmith': {
      rect(ctx, '#5a5148', x + w - 10, y + 1, 5, roofHeight + 2);
      rect(ctx, 'rgba(240,150,60,.85)', x + w - 9, y, 3, 2);
      rect(ctx, 'rgba(120,120,130,.5)', x + w - 8, y - 5, 2, 4);
      break;
    }
    case 'inn':
    case 'town-hall': {
      const bannerX = building.facing === 'west' ? x - 3 : x + w - 4;
      rect(ctx, '#7a2f2a', bannerX, y + roofHeight + 1, 5, 12);
      rect(ctx, '#d8b35f', bannerX + 1, y + roofHeight + 3, 3, 1);
      rect(ctx, '#d8b35f', bannerX + 1, y + roofHeight + 7, 3, 1);
      break;
    }
    case 'shop':
    case 'market': {
      for (let sx = x + 2; sx < x + w - 2; sx += 6) {
        rect(ctx, (sx - x) % 12 < 6 ? '#c94f42' : '#efe6d0', sx, y + roofHeight, 6, 4);
      }
      break;
    }
    default:
      if (v % 5 === 0) { // chaminé ocasional em casas
        rect(ctx, MATERIALS.stone.roof[0], x + w - 9, y + 1, 4, roofHeight);
        rect(ctx, 'rgba(200,200,210,.4)', x + w - 8, y - 4, 2, 4);
      }
  }
}

function drawBuilding(ctx, building) {
  const x = building.x * TILE;
  const y = building.y * TILE;
  const w = building.width * TILE;
  const h = building.height * TILE;
  const v = building.variant ?? 0;

  // Town-hall e um terço das casas usam sprites reais do tileset.
  if (ART.village) {
    if (building.type === 'town-hall') return drawSpriteBuilding(ctx, SPRITES.longhouse, x, y, w, h);
    if (building.type === 'house' && v % 3 === 0) return drawSpriteBuilding(ctx, SPRITES.cottage, x, y, w, h);
    if (building.type === 'house' && v % 3 === 1) return drawSpriteBuilding(ctx, SPRITES.longhouse, x, y, w, h);
  }

  const mat = MATERIALS[building.material] ?? MATERIALS.wood;
  const roofHeight = Math.max(12, Math.round(h * (0.44 + (v % 3) * 0.05)));
  const hipped = v % 2 === 0 && building.type !== 'house';

  const wallTop = y + roofHeight;
  const wallH = h - roofHeight - 2;
  rect(ctx, 'rgba(15,20,14,.24)', x + 2, y + h - 1, w - 2, 3); // oclusão de contato
  rect(ctx, mat.trim, x + 2, wallTop - 2, w - 4, h - roofHeight + 2);
  rect(ctx, mat.wall, x + 3, wallTop, w - 6, wallH);
  // Volume da parede: topo iluminado, base e lateral SE sombreadas.
  rect(ctx, 'rgba(255,255,255,.09)', x + 3, wallTop, w - 6, 1);
  rect(ctx, 'rgba(255,255,255,.06)', x + 3, wallTop, 2, wallH);
  rect(ctx, 'rgba(0,0,0,.15)', x + w - 5, wallTop, 2, wallH);
  rect(ctx, 'rgba(0,0,0,.12)', x + 3, y + h - 6, w - 6, 4);
  // Vigas de madeira aparentes na parede.
  rect(ctx, 'rgba(0,0,0,.12)', x + 3, wallTop + Math.floor(wallH / 2), w - 6, 1);
  drawRoof(ctx, x, y, w, roofHeight, mat, hipped);
  drawDoorAndWindows(ctx, building, x, y, w, h, roofHeight, mat);
  drawBuildingFeatures(ctx, building, x, y, w, h, roofHeight);
}

// ---- Decorações --------------------------------------------------------------

function drawTree(ctx, x, y, variant = 0) {
  const px = x * TILE;
  const py = y * TILE;
  if (ART.village) {
    rect(ctx, 'rgba(25,43,25,.24)', px + 1, py + 10, 20, 6);
    const sprite = variant % 4 === 0 ? SPRITES.grove : SPRITES.tree;
    const ox = sprite === SPRITES.grove ? -24 : -8;
    const oy = sprite === SPRITES.grove ? -24 : -28;
    ctx.drawImage(ART.village, sprite.x, sprite.y, sprite.w, sprite.h, px + ox, py + oy, sprite.w, sprite.h);
    return;
  }
  rect(ctx, 'rgba(25,43,25,.3)', px + 3, py + 10, 16, 6);
  rect(ctx, '#59452c', px + 7, py + 7, 3, 9);
  rect(ctx, variant % 2 ? '#284e35' : '#31583a', px + 1, py + 1, 13, 11);
  rect(ctx, variant % 2 ? '#3e7544' : '#477b46', px - 1, py + 4, 16, 6);
  rect(ctx, '#5f9452', px + 3, py, 9, 7);
  rect(ctx, 'rgba(188,216,117,.28)', px + 4, py + 1, 4, 2);
}

function drawDecoration(ctx, item) {
  const px = item.x * TILE;
  const py = item.y * TILE;
  const v = item.variant ?? hash2(item.x, item.y);
  switch (item.type) {
    case 'tree': drawTree(ctx, item.x, item.y, v); break;
    case 'rock':
      rect(ctx, 'rgba(25,30,28,.25)', px + 3, py + 12, 10, 3);
      rect(ctx, '#53655b', px + 4, py + 8, 9, 6); rect(ctx, '#829184', px + 6, py + 6, 6, 3);
      rect(ctx, 'rgba(255,255,255,.18)', px + 7, py + 7, 2, 1); break;
    case 'flowers':
    case 'flower':
      rect(ctx, '#4a7a44', px + 4, py + 9, 1, 3); rect(ctx, '#4a7a44', px + 10, py + 11, 1, 3);
      rect(ctx, v % 2 ? '#e2d06a' : '#d88986', px + 3, py + 6, 2, 2);
      rect(ctx, v % 3 ? '#d88986' : '#cf7fc0', px + 10, py + 9, 2, 2);
      rect(ctx, '#e7e0a0', px + 7, py + 5, 2, 2); break;
    case 'well':
      rect(ctx, 'rgba(25,30,28,.25)', px + 2, py + 12, 12, 3);
      rect(ctx, '#555b51', px + 2, py + 7, 12, 7); rect(ctx, '#8d9989', px + 3, py + 6, 10, 3);
      rect(ctx, '#244650', px + 5, py + 8, 6, 3);
      rect(ctx, '#6a4d2c', px + 3, py + 2, 2, 6); rect(ctx, '#6a4d2c', px + 11, py + 2, 2, 6);
      rect(ctx, '#8a6a3c', px + 2, py + 1, 12, 3); break;
    case 'fence':
      rect(ctx, '#755638', px, py + 7, TILE, 3); rect(ctx, '#a27a4d', px + 2, py + 3, 2, 10); rect(ctx, '#a27a4d', px + 12, py + 3, 2, 10); break;
    case 'garden':
    case 'garden_plot':
      rect(ctx, '#76573b', px + 1, py + 3, 14, 11);
      for (let i = 3; i < 14; i += 4) rect(ctx, v % 2 ? '#6f9b51' : '#b6893f', px + i, py + 4, 1, 9); break;
    case 'bush':
      rect(ctx, 'rgba(25,43,25,.2)', px + 3, py + 12, 10, 3);
      rect(ctx, '#315b3a', px + 2, py + 7, 12, 7); rect(ctx, '#5b8b4a', px + 4, py + 5, 8, 7);
      rect(ctx, 'rgba(150,190,110,.4)', px + 5, py + 6, 3, 2); break;
    case 'grass-tuft':
      rect(ctx, '#416f43', px + 4, py + 8, 1, 5); rect(ctx, '#7ba356', px + 8, py + 6, 1, 7); rect(ctx, '#416f43', px + 11, py + 9, 1, 4); break;
    case 'cactus':
      rect(ctx, 'rgba(25,40,25,.2)', px + 5, py + 13, 6, 2);
      rect(ctx, '#3f7d4a', px + 6, py + 3, 4, 11); rect(ctx, '#3f7d4a', px + 3, py + 7, 3, 2); rect(ctx, '#3f7d4a', px + 3, py + 5, 2, 3);
      rect(ctx, '#3f7d4a', px + 10, py + 8, 3, 2); rect(ctx, '#3f7d4a', px + 11, py + 6, 2, 3);
      rect(ctx, 'rgba(255,255,255,.15)', px + 7, py + 4, 1, 8); break;
    case 'dead-bush':
      rect(ctx, '#8a6a44', px + 7, py + 8, 1, 6); rect(ctx, '#8a6a44', px + 4, py + 7, 3, 1); rect(ctx, '#8a6a44', px + 9, py + 6, 3, 1);
      rect(ctx, '#a2895c', px + 5, py + 9, 6, 1); break;
    case 'dead-tree':
      rect(ctx, 'rgba(25,30,28,.22)', px + 4, py + 13, 9, 2);
      rect(ctx, '#6a4f34', px + 7, py + 2, 3, 12); rect(ctx, '#6a4f34', px + 3, py + 5, 4, 1); rect(ctx, '#6a4f34', px + 10, py + 4, 4, 1);
      rect(ctx, '#573f28', px + 4, py + 3, 2, 2); break;
    case 'reeds':
      rect(ctx, '#5c7a3a', px + 4, py + 5, 1, 9); rect(ctx, '#7a9a4a', px + 7, py + 3, 1, 11); rect(ctx, '#5c7a3a', px + 10, py + 6, 1, 8);
      rect(ctx, '#b6a24a', px + 6, py + 2, 2, 3); rect(ctx, '#b6a24a', px + 9, py + 5, 2, 2); break;
    case 'haystack':
      rect(ctx, 'rgba(25,30,20,.22)', px + 2, py + 13, 12, 2);
      rect(ctx, '#c99a3d', px + 2, py + 6, 12, 8); rect(ctx, '#e0b95a', px + 4, py + 3, 8, 5);
      rect(ctx, 'rgba(120,90,40,.4)', px + 2, py + 9, 12, 1); rect(ctx, 'rgba(120,90,40,.4)', px + 2, py + 11, 12, 1); break;
    case 'cart':
      rect(ctx, 'rgba(25,30,20,.22)', px + 1, py + 13, 14, 2);
      rect(ctx, '#7a5a34', px + 2, py + 5, 12, 6); rect(ctx, '#9c7a44', px + 3, py + 6, 10, 2);
      rect(ctx, '#4a3320', px + 3, py + 11, 3, 3); rect(ctx, '#4a3320', px + 10, py + 11, 3, 3); break;
    case 'snowman':
      rect(ctx, 'rgba(120,140,160,.25)', px + 4, py + 13, 8, 2);
      rect(ctx, '#f3f6f9', px + 4, py + 8, 8, 6); rect(ctx, '#f8fbff', px + 5, py + 3, 6, 6);
      rect(ctx, '#33373b', px + 6, py + 5, 1, 1); rect(ctx, '#33373b', px + 9, py + 5, 1, 1); rect(ctx, '#e0872f', px + 7, py + 6, 2, 1); break;
    default:
      rect(ctx, '#bdc475', px + 7, py + 8, 2, 2);
  }
}

const GROUND_DECOS = new Set(['garden', 'garden_plot', 'fence', 'flowers', 'flower', 'rock', 'well', 'reeds', 'grass-tuft', 'cactus', 'dead-bush']);
const CANOPY_DECOS = new Set(['tree', 'dead-tree']);

export function renderVillageToCanvas(map, options = {}) {
  const tileSize = options.tileSize ?? TILE;
  const scale = tileSize / TILE;
  const canvas = options.canvas ?? document.createElement('canvas');
  canvas.width = map.width * tileSize;
  canvas.height = map.height * tileSize;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.scale(scale, scale);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) drawGroundTile(ctx, map, x, y);
  }

  const roadSet = new Set(map.roads.map(({ x, y }) => `${x},${y}`));
  for (const road of map.roads) drawRoadTile(ctx, road.x, road.y, roadSet);
  drawPlaza(ctx, map.plaza);

  // Passe de sombras longas (NO→SE). Desenhadas em canvas próprio e compostas uma
  // única vez, para que sobreposições formem união (sem escurecer por empilhamento).
  const shadow = document.createElement('canvas');
  shadow.width = canvas.width;
  shadow.height = canvas.height;
  const sctx = shadow.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  sctx.scale(scale, scale);
  sctx.fillStyle = '#0a0e07';
  for (const b of map.buildings) {
    const bh = b.height * TILE;
    shadowPoly(sctx, b.x * TILE, b.y * TILE + bh, b.width * TILE, bh * 1.5);
  }
  for (const d of map.decorations) {
    const height = DECO_HEIGHT[d.type];
    if (height) shadowPoly(sctx, d.x * TILE + 3, d.y * TILE + 15, 10, height);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.22;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(shadow, 0, 0);
  ctx.restore();

  const sorted = [
    ...map.decorations.filter((item) => GROUND_DECOS.has(item.type)),
    ...map.buildings,
    ...map.decorations.filter((item) => CANOPY_DECOS.has(item.type) || (!GROUND_DECOS.has(item.type)))
  ].sort((a, b) => (a.y + (a.height ?? 1)) - (b.y + (b.height ?? 1)));
  for (const item of sorted) {
    if ('door' in item) drawBuilding(ctx, item);
    else drawDecoration(ctx, item);
  }

  ctx.restore();

  // Acabamento estático: tom ambiente por bioma + vinheta suave (embutidos no PNG).
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = AMBIENT[map.biome] ?? AMBIENT.temperate;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  const vignette = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.34,
    canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.72
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(9,13,9,0.22)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  return canvas;
}

function loadImage(src) {
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', reject, { once: true });
  });
  image.src = src;
  return loaded;
}

export async function loadArtAssets() {
  if (ART.village && ART.floor) return ART;
  const [village, floor] = await Promise.all([
    loadImage('/assets/tiles/ninja-village.png'),
    loadImage('/assets/tiles/ninja-floor.png')
  ]);
  ART.village = village;
  ART.floor = floor;
  return ART;
}

export class VillageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.world = null;
    this.map = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.drag = null;
    this.frame = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.bindInput();
    this.resize();
  }

  setMap(map) {
    this.map = map;
    this.world = renderVillageToCanvas(map);
    this.center();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.dpr = dpr;
    this.draw();
  }

  notifyCamera() {
    this.canvas.dispatchEvent(new CustomEvent('camerachange', { detail: { ...this.camera } }));
  }

  clampCamera() {
    if (!this.world) return;
    const viewW = this.canvas.width / this.dpr;
    const viewH = this.canvas.height / this.dpr;
    const worldW = this.world.width * this.camera.zoom;
    const worldH = this.world.height * this.camera.zoom;
    const marginX = Math.min(viewW * .35, 220);
    const marginY = Math.min(viewH * .35, 180);
    this.camera.x = worldW <= viewW
      ? (viewW - worldW) / 2
      : Math.min(marginX, Math.max(viewW - worldW - marginX, this.camera.x));
    this.camera.y = worldH <= viewH
      ? (viewH - worldH) / 2
      : Math.min(marginY, Math.max(viewH - worldH - marginY, this.camera.y));
  }

  center() {
    if (!this.world) return;
    const viewW = this.canvas.width / this.dpr;
    const viewH = this.canvas.height / this.dpr;
    const fit = Math.min((viewW - 50) / this.world.width, (viewH - 50) / this.world.height);
    this.camera.zoom = Math.max(.35, Math.min(2.5, fit));
    this.camera.x = (viewW - this.world.width * this.camera.zoom) / 2;
    this.camera.y = (viewH - this.world.height * this.camera.zoom) / 2;
    this.clampCamera();
    this.notifyCamera();
    this.draw();
  }

  setZoom(nextZoom, focusX, focusY) {
    if (!this.world) return;
    const old = this.camera.zoom;
    const zoom = Math.max(.25, Math.min(4, nextZoom));
    const rect = this.canvas.getBoundingClientRect();
    const fx = focusX ?? rect.width / 2;
    const fy = focusY ?? rect.height / 2;
    const worldX = (fx - this.camera.x) / old;
    const worldY = (fy - this.camera.y) / old;
    this.camera.zoom = zoom;
    this.camera.x = fx - worldX * zoom;
    this.camera.y = fy - worldY * zoom;
    this.clampCamera();
    this.notifyCamera();
    this.draw();
  }

  bindInput() {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cx: this.camera.x, cy: this.camera.y };
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      this.camera.x = this.drag.cx + event.clientX - this.drag.x;
      this.camera.y = this.drag.cy + event.clientY - this.drag.y;
      this.clampCamera();
      this.draw();
    });
    const stop = (event) => {
      if (this.drag?.id === event.pointerId) this.drag = null;
      this.canvas.classList.remove('dragging');
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.setZoom(this.camera.zoom * (event.deltaY > 0 ? .86 : 1.16), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    this.canvas.addEventListener('keydown', (event) => {
      const amount = event.shiftKey ? 80 : 32;
      if (event.key === 'ArrowLeft') this.camera.x += amount;
      else if (event.key === 'ArrowRight') this.camera.x -= amount;
      else if (event.key === 'ArrowUp') this.camera.y += amount;
      else if (event.key === 'ArrowDown') this.camera.y -= amount;
      else if (event.key === '+' || event.key === '=') return this.setZoom(this.camera.zoom * 1.2);
      else if (event.key === '-') return this.setZoom(this.camera.zoom / 1.2);
      else return;
      event.preventDefault();
      this.clampCamera();
      this.draw();
    });
  }

  draw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.drawNow();
    });
  }

  drawNow() {
    if (!this.ctx || !this.dpr) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    rect(ctx, '#1a3027', 0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    if (!this.world) return;
    ctx.save();
    ctx.translate(Math.round(this.camera.x), Math.round(this.camera.y));
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.world, 0, 0);
    ctx.restore();
  }

  exportCanvas(tileSize = TILE) {
    return renderVillageToCanvas(this.map, { tileSize });
  }
}

// Atlas de sprites sobre o pacote Ninja Adventure (CC0) já incluído.
// Coordenadas em pixels, grade de 16px, medidas diretamente nas folhas
// assets/tiles/ninja-floor.png (terreno) e ninja-village.png (edifícios/decorações).
// Todos os tiles de terreno abaixo foram verificados como preenchimentos limpos
// que ladrilham sem emenda; sprites de edifício foram verificados individualmente.

export const TILE = 16;

// Variantes de preenchimento por terreno (escolhidas por hash para textura orgânica).
export const TERRAIN_FILLS = {
  grass: [[176, 192], [192, 192], [208, 192], [224, 192], [240, 192]],
  meadow: [[0, 192], [16, 192], [32, 192], [48, 192]],
  sand: [[80, 16], [96, 16], [80, 32], [96, 32]],
  dirt: [[256, 240], [272, 240], [256, 256], [272, 256]],
  snow: [[80, 240], [96, 240], [128, 256], [144, 256]],
  water: [[16, 352], [80, 352], [96, 352], [80, 368]],
};

// Sprites de edifícios/decorações verificados na folha ninja-village.png.
export const SPRITES = {
  cottage: { x: 256, y: 96, w: 64, h: 64 },   // casa de telhado musgo verde
  longhouse: { x: 192, y: 96, w: 64, h: 80 },  // casarão de madeira de 2 andares
  tree: { x: 64, y: 96, w: 32, h: 48 },        // árvore redonda
  grove: { x: 0, y: 144, w: 64, h: 48 },       // arbusto/copa larga
};

// Preenchimento de terreno efetivamente usado por um tipo, dado o bioma.
// forest reaproveita a grama (a copa densa por cima já a escurece);
// marsh reaproveita a terra (sobreposição verde/azul no renderer).
export function fillKeyFor(type, biome) {
  if (type === "grass" || type === "forest") return biome === "arid" ? "meadow" : "grass";
  if (type === "marsh") return "dirt";
  return type; // water, sand, dirt, snow
}

export function pickIndex(x, y, salt, length) {
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + salt, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % length;
}

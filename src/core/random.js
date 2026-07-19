// Small deterministic random toolkit. It deliberately has no global state.
export function hashString(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

export function coordinateHash(seed, x, y, salt = 0) {
  let value = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(salt, 0xc2b2ae3d)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function createRandom(seed) {
  let state = hashString(seed) || 0x6d2b79f5;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  random.int = (minimum, maximum) => Math.floor(random() * (maximum - minimum + 1)) + minimum;
  random.pick = (items) => items[Math.floor(random() * items.length)];
  random.bool = (chance = 0.5) => random() < chance;
  random.shuffle = (items) => {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [items[index], items[swap]] = [items[swap], items[index]];
    }
    return items;
  };
  random.fork = (label) => createRandom(`${seed}\u241f${label}`);
  return random;
}

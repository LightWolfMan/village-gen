export function hashString(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return hash >>> 0;
}

export function coordinateHash(seed, x, y, salt = 0) {
  let hash = seed ^ Math.imul(x + 0x9e3779b9, 0x85ebca6b);
  hash ^= Math.imul(y + 0x632be5ab, 0xc2b2ae35);
  hash ^= Math.imul(salt + 1, 0x27d4eb2d);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function createRandom(seed) {
  let state = hashString(seed) || 0x6d2b79f5;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    pick(values) {
      return values[this.int(0, values.length - 1)];
    },
    shuffle(values) {
      for (let i = values.length - 1; i > 0; i -= 1) {
        const j = this.int(0, i);
        [values[i], values[j]] = [values[j], values[i]];
      }
      return values;
    },
  };
}


import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const root = new URL('../assets/buildings/', import.meta.url);
const environmentRoot = new URL('../assets/environment/', import.meta.url);
const propsRoot = new URL('../assets/props/', import.meta.url);

function chunks(buffer, wanted) {
  const values = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === wanted) values.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return values;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodeRgba(buffer) {
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const ihdr = chunks(buffer, 'IHDR')[0];
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4);
  assert.equal(ihdr[8], 8, 'PNG deve usar 8 bits');
  assert.equal(ihdr[9], 6, 'PNG deve ser RGBA');
  const packed = inflateSync(Buffer.concat(chunks(buffer, 'IDAT')));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0, source = 0; y < height; y += 1) {
    const filter = packed[source++];
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[source++];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      const value = filter === 0 ? raw
        : filter === 1 ? raw + left
          : filter === 2 ? raw + up
            : filter === 3 ? raw + Math.floor((left + up) / 2)
              : filter === 4 ? raw + paeth(left, up, upperLeft) : NaN;
      assert.ok(Number.isFinite(value), `filtro PNG desconhecido: ${filter}`);
      pixels[y * stride + x] = value & 255;
    }
  }
  return { width, height, pixels };
}

test('manifesto Blender referencia 48 edificios RGBA transparentes', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.entries.length, 48);
  assert.deepEqual(new Set(manifest.entries.map(({ family }) => family)), new Set([
    'cottage', 'townhouse', 'workshop', 'civic', 'farmstead',
    'inn', 'shop', 'merchant', 'artisan', 'smithy', 'market', 'mill',
  ]));
  assert.deepEqual(new Set(manifest.entries.map(({ orientation }) => orientation)), new Set(['north', 'east', 'south', 'west']));
  assert.equal(new Set(manifest.entries.map(({ key }) => key)).size, 48);

  let totalBytes = 0;
  for (const entry of manifest.entries) {
    assert.match(entry.src, /^\/assets\/buildings\/temperate\/[a-z]+-(north|east|south|west)\.png$/);
    assert.ok(entry.anchorX >= 0 && entry.anchorX <= entry.width && entry.anchorY >= 0 && entry.anchorY <= entry.height);
    assert.ok(entry.doorX >= 0 && entry.doorX <= entry.width && entry.doorY >= 0 && entry.doorY <= entry.height);
    const file = await readFile(new URL(entry.src.split('/').at(-1), new URL('temperate/', root)));
    totalBytes += file.length;
    const image = decodeRgba(file);
    assert.deepEqual([image.width, image.height], [256, 256]);
    const alpha = (x, y) => image.pixels[(y * image.width + x) * 4 + 3];
    assert.deepEqual([alpha(0, 0), alpha(255, 0), alpha(0, 255), alpha(255, 255)], [0, 0, 0, 0]);
    assert.ok(image.pixels.some((value, index) => index % 4 === 3 && value > 0), `${entry.src} está vazio`);
  }
  assert.ok(totalBytes < 20 * 1024 * 1024, `sprites excederam 20 MiB: ${totalBytes}`);
});

test('manifesto Blender de ambiente referencia seis sprites RGBA transparentes', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', environmentRoot), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.baseTileWidth, 64);
  assert.equal(manifest.entries.length, 6);
  assert.deepEqual(new Set(manifest.entries.map(({ type }) => type)), new Set([
    'road-street', 'road-main', 'road-plaza', 'bridge-ew', 'bridge-ns', 'bridge-cross',
  ]));
  for (const entry of manifest.entries) {
    assert.equal(entry.key, entry.type);
    assert.match(entry.src, /^\/assets\/environment\/(road-(street|main|plaza)|bridge-(ew|ns|cross))\.png$/);
    const image = decodeRgba(await readFile(new URL(entry.src.split('/').at(-1), environmentRoot)));
    assert.deepEqual([image.width, image.height], [128, 128]);
    const alpha = (x, y) => image.pixels[(y * image.width + x) * 4 + 3];
    assert.deepEqual([alpha(0, 0), alpha(127, 0), alpha(0, 127), alpha(127, 127)], [0, 0, 0, 0]);
  }
});

test('props Blender possuem dimensoes contratadas, conteudo e cantos transparentes', async () => {
  const expected = new Map([
    ['temperate-tree.png', [64, 96]], ['snowy-pine.png', [64, 96]],
    ['desert-cactus.png', [48, 64]], ['swamp-willow.png', [80, 96]],
    ['rock.png', [48, 40]], ['bush.png', [48, 40]], ['reeds.png', [40, 56]],
    ['well.png', [56, 64]], ['cart.png', [72, 56]], ['haystack.png', [48, 56]],
  ]);
  for (const [filename, dimensions] of expected) {
    const image = decodeRgba(await readFile(new URL(filename, propsRoot)));
    assert.deepEqual([image.width, image.height], dimensions, filename);
    const alpha = (x, y) => image.pixels[(y * image.width + x) * 4 + 3];
    assert.deepEqual([alpha(0, 0), alpha(image.width - 1, 0), alpha(0, image.height - 1), alpha(image.width - 1, image.height - 1)], [0, 0, 0, 0], filename);
    assert.ok(image.pixels.some((value, index) => index % 4 === 3 && value > 0), `${filename} esta vazio`);
  }
});

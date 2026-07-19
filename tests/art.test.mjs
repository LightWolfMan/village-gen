import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const root = new URL('../assets/buildings/', import.meta.url);

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

test('manifesto Blender referencia vinte sprites RGBA pequenos e transparentes', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.entries.length, 20);
  assert.deepEqual(new Set(manifest.entries.map(({ family }) => family)), new Set(['cottage', 'townhouse', 'workshop', 'civic', 'farmstead']));
  assert.deepEqual(new Set(manifest.entries.map(({ orientation }) => orientation)), new Set(['north', 'east', 'south', 'west']));
  assert.equal(new Set(manifest.entries.map(({ key }) => key)).size, 20);

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
  assert.ok(totalBytes < 8 * 1024 * 1024, `sprites excederam 8 MiB: ${totalBytes}`);
});

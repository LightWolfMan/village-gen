import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Deterministic format export only: the original illustration is preserved.
const folder = new URL('../assets/app-icon/', import.meta.url);
const source = await readFile(new URL('village-icon.png', folder));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const frames = await page.evaluate(async ({ data, sizes }) => {
    const source = new Image();
    source.src = data;
    await source.decode();
    return sizes.map(size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    });
  }, { data: `data:image/png;base64,${source.toString('base64')}`, sizes });
  const images = frames.map(frame => Buffer.from(frame, 'base64'));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((png, i) => {
    if (png.readUInt32BE(16) !== sizes[i] || png.readUInt32BE(20) !== sizes[i]) {
      throw new Error('Unexpected icon dimensions');
    }
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await writeFile(new URL('village.ico', folder), Buffer.concat([header, ...images]));
  await writeFile(new URL('favicon.png', folder), images[4]);
  console.log(`Icon exported and validated: ${sizes.join(', ')} px; ${offset} bytes.`);
} finally {
  await browser.close();
}

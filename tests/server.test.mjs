import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor não iniciou')), 5000);
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('disponível')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

test('servidor entrega o app e rejeita requisições inseguras sem encerrar', async (t) => {
  const { child, base } = await startServer();
  t.after(() => child.kill());

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Vilarejo/);
  assert.match(home.headers.get('content-type'), /^text\/html/);

  const asset = await fetch(`${base}/assets/tiles/ninja-village.png`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'image/png');

  const malformed = await fetch(`${base}/%ZZ`);
  assert.equal(malformed.status, 400);

  const traversal = await fetch(`${base}/..%2F..%2FWindows%2Fwin.ini`);
  assert.equal(traversal.status, 403);

  const post = await fetch(`${base}/`, { method: 'POST' });
  assert.equal(post.status, 405);

  const alive = await fetch(`${base}/src/app.js`);
  assert.equal(alive.status, 200);
});

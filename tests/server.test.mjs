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

test('servidor entrega a aplicação 3D e bloqueia requisições inseguras', async (t) => {
  const { child, base } = await startServer();
  t.after(() => child.kill());

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Village 4/);
  assert.match(home.headers.get('content-type'), /^text\/html/);

  const module = await fetch(`${base}/src/core/index.js`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /^text\/javascript/);

  const malformed = await fetch(`${base}/%ZZ`);
  assert.equal(malformed.status, 400);

  const traversal = await fetch(`${base}/..%2F..%2FWindows%2Fwin.ini`);
  assert.equal(traversal.status, 403);

  const post = await fetch(`${base}/`, { method: 'POST' });
  assert.equal(post.status, 405);

  assert.equal((await fetch(`${base}/src/app.js`)).status, 200);
  const worker = await fetch(`${base}/src/generation-worker.js`);
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /^text\/javascript/);
  const esm = await fetch(`${base}/server.mjs`, { method: 'HEAD' });
  assert.equal(esm.status, 200);
  assert.match(esm.headers.get('content-type'), /^text\/javascript/);
  const three = await fetch(`${base}/vendor/three/three.module.js`);
  assert.equal(three.status, 200);
  assert.match(three.headers.get('content-type'), /^text\/javascript/);
  assert.equal((await fetch(`${base}/vendor/three/addons/loaders/GLTFLoader.js`)).status, 200);
});

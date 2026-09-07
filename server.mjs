import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const host = process.env.HOST ?? '127.0.0.1';
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.md', 'text/markdown; charset=utf-8']
]);

function resolveRequestPath(url = '/') {
  let pathname;
  try {
    pathname = decodeURIComponent(url.split('?')[0]);
  } catch {
    return undefined;
  }

  const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relation = relative(root, target);
  return relation && !relation.startsWith('..') && !isAbsolute(relation) ? target : null;
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Método não permitido');
    return;
  }

  const target = resolveRequestPath(request.url);
  if (target === undefined) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('URL inválida');
    return;
  }
  if (!target) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Acesso negado');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('Not a file');
    const body = request.method === 'HEAD' ? undefined : await readFile(target);
    response.writeHead(200, {
      'Content-Type': contentTypes.get(extname(target).toLowerCase()) ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Arquivo não encontrado');
  }
});

server.listen(port, host, () => {
  console.log(`Gerador de Vila disponível em http://${host}:${server.address().port}`);
  console.log('Pressione Ctrl+C para encerrar.');
});

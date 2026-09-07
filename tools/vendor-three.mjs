import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'node_modules/three');
const target = resolve(root, 'vendor/three');
const metadata = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'));
if (metadata.version !== '0.185.1') throw new Error(`Versão Three inesperada: ${metadata.version}`);
const files = new Map([
  ['LICENSE', 'LICENSE'],
  ['build/three.module.js', 'three.module.js'],
  ['build/three.core.js', 'three.core.js'],
  ['examples/jsm/controls/OrbitControls.js', 'addons/controls/OrbitControls.js'],
  ['examples/jsm/controls/PointerLockControls.js', 'addons/controls/PointerLockControls.js'],
  ['examples/jsm/loaders/GLTFLoader.js', 'addons/loaders/GLTFLoader.js'],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'addons/utils/BufferGeometryUtils.js'],
  ['examples/jsm/utils/SkeletonUtils.js', 'addons/utils/SkeletonUtils.js']
]);
for (const [input, output] of files) {
  const destination = resolve(target, output);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(source, input), destination);
}
console.log(`Three.js ${metadata.version}: ${files.size} arquivos locais com licença MIT.`);

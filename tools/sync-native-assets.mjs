import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { MODEL_CATALOG, PROP_CATALOG, BRIDGE_CATALOG } from '../assets/models/catalog.js';
const models = [...MODEL_CATALOG, ...PROP_CATALOG, ...BRIDGE_CATALOG];
const root = new URL('../', import.meta.url);
await mkdir(new URL('native/assets/models/', root), { recursive: true });
await mkdir(new URL('native/assets/app-icon/', root), { recursive: true });
for (const model of models) {
  const relative = model.src.replace(/^\//,'');
  await copyFile(new URL(relative, root), new URL('native/'+relative, root));
}
await writeFile(new URL('native/assets/models/catalog.json', root),JSON.stringify(models));
await copyFile(new URL('assets/app-icon/village-icon.png',root),new URL('native/assets/app-icon/village-icon.png',root));
await copyFile(new URL('assets/app-icon/village.ico',root),new URL('native/assets/app-icon/village.ico',root));
console.log('Native assets synced:', models.length);

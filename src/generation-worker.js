import { generateVillage } from './core/index.js';

self.onmessage = ({ data: { requestId, seed, settings } }) => {
  const started = performance.now();
  try {
    const map = generateVillage(seed, settings);
    self.postMessage({ requestId, map, elapsed: performance.now() - started });
  } catch (error) {
    self.postMessage({ requestId, error: error.message || String(error) });
  }
};

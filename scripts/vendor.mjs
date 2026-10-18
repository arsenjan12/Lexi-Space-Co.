// Копирует браузерные сборки библиотек из node_modules в site/vendor.
// Сайт не зависит от CDN: всё лежит рядом и работает с Netlify как есть.
// Запуск: npm run vendor

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const nm = 'node_modules/';
const out = 'site/vendor/';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copy = (from, to) => cpSync(nm + from, out + to, { recursive: true });

// 3D
copy('three/build/three.module.min.js', 'three.module.js');
copy('three/examples/jsm/controls/OrbitControls.js', 'OrbitControls.js');

// Орбиты спутников (SGP4) и эфемериды Солнечной системы
copy('satellite.js/dist/satellite.es.js', 'satellite.es.js');
copy('astronomy-engine/esm/astronomy.js', 'astronomy.js');

// SQLite в браузере
copy('sql.js/dist/sql-wasm.js', 'sql-wasm.js');
copy('sql.js/dist/sql-wasm.wasm', 'sql-wasm.wasm');

// Формулы
copy('katex/dist/katex.mjs', 'katex.mjs');
copy('katex/dist/katex.min.css', 'katex.min.css');
copy('katex/dist/fonts', 'fonts');

// Нейросеть в браузере (llama.cpp → WebAssembly)
copy('@wllama/wllama/esm/index.js', 'wllama/index.js');
copy('@wllama/wllama/esm/single-thread/wllama.wasm', 'wllama/single-thread/wllama.wasm');
copy('@wllama/wllama/esm/multi-thread/wllama.wasm', 'wllama/multi-thread/wllama.wasm');

// Постквантовая криптография: у noble импорты без расширений, поэтому собираем один файл
await build({
  stdin: {
    contents: `
      export { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
      export { ml_kem768 } from '@noble/post-quantum/ml-kem';
      export { hkdf } from '@noble/hashes/hkdf';
      export { sha256 } from '@noble/hashes/sha256';
      export { x25519 } from '@noble/curves/ed25519';
    `,
    resolveDir: '.',
  },
  bundle: true,
  format: 'esm',
  minify: true,
  outfile: out + 'pq.js',
  logLevel: 'warning',
});

console.log('vendor: готово →', out);

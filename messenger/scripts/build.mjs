// Сборка LEXI Messenger как отдельного сайта.
//
// Код мессенджера лежит в messenger/site. Общие библиотеки, шрифты, текстуры Земли,
// 3D-модели и база знаний LexiAI — те же, что у LEXI Space: при сборке копируем их
// из ../site в site/space, чтобы мессенджер не зависел от сайта LEXI Space во время работы.
// Исключение — сама нейросеть (1,1 ГБ): её файлы берутся с сервера LEXI Space, см. js/lexiai.js.
//
// Запуск из папки messenger: node scripts/build.mjs   (Netlify делает это сам, см. netlify.toml)

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'site');        // сайт LEXI Space в том же репозитории
const OUT = join(here, '..', 'site', 'space');     // сюда кладём общие файлы

const FILES = [
  'vendor/pq.js', 'vendor/katex.mjs', 'vendor/katex.min.css', 'vendor/fonts',
  'vendor/astronomy.js', 'vendor/three.module.js',
  'vendor/sql-wasm.js', 'vendor/sql-wasm.wasm', 'vendor/wllama',
  'css/fonts.css', 'fonts',
  'textures/earth-day.jpg', 'textures/earth-night.jpg', 'textures/earth-clouds.jpg', 'textures/earth-spec.jpg',
  'js/models.js',
  'data/lexi.sqlite', 'data/ai-model.json',
];

rmSync(OUT, { recursive: true, force: true });
let bytes = 0;
for (const f of FILES) {
  const from = join(SRC, f), to = join(OUT, f);
  if (!existsSync(from)) throw new Error(`нет файла LEXI Space: site/${f}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  bytes += size(to);
}
console.log(`messenger: скопировано ${FILES.length} путей из LEXI Space, ${(bytes / 1048576).toFixed(1)} МБ`);

function size(p) {
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  return readdirSync(p).reduce((n, e) => n + size(join(p, e)), 0);
}

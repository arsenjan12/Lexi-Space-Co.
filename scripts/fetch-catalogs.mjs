// Скачивает исходные каталоги неба в db/raw. Нужно один раз (или когда захочется обновить).
// Дальше scripts/import-data.mjs превращает их в SQL.
//
//   HYG v4.1 — звёзды: расстояния, спектры, светимость (CC BY-SA 4.0, astronexus)
//   d3-celestial — русские имена звёзд, созвездия с линиями, каталог Мессье (BSD-3, Olaf Frohn)
//
// Запуск: npm run catalogs

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const RAW = 'db/raw/';
const D3 = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/';
const files = {
  'hygdata_v41.csv': 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv',
  'starnames.json': D3 + 'starnames.json',
  'constellations.json': D3 + 'constellations.json',
  'constellations.lines.json': D3 + 'constellations.lines.json',
  'messier.json': D3 + 'messier.json',
  'dsonames.json': D3 + 'dsonames.json',
};

mkdirSync(RAW, { recursive: true });

for (const [name, url] of Object.entries(files)) {
  if (existsSync(RAW + name) && !process.argv.includes('--force')) {
    console.log('есть   ', name);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  writeFileSync(RAW + name, Buffer.from(await res.arrayBuffer()));
  console.log('скачан ', name);
}

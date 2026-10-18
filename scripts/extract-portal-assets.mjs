// Достаёт из портала (он собран в один файл) шрифты и текстуры Земли,
// чтобы LEXI Space выглядел так же и не тянул их из интернета.
//   шрифты  → site/fonts/*.woff2 + site/css/fonts.css
//   Земля   → site/textures/earth-{day,night,clouds,spec}.jpg
// Запуск: node scripts/extract-portal-assets.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const PORTAL = process.env.LEXI_PORTAL || '../Lexi web/';
const html = readFileSync(PORTAL + 'index.html', 'utf8');

mkdirSync('site/fonts', { recursive: true });
mkdirSync('site/textures', { recursive: true });
mkdirSync('site/css', { recursive: true });

// --- шрифты ---
const faces = [...html.matchAll(/@font-face\{font-family:'(Cormorant|Manrope|JetBrains Mono)';([^}]*)\}/g)];
const css = ['/* Шрифты портала LEXI (OFL). Сгенерировано scripts/extract-portal-assets.mjs */'];
for (const [, family, body] of faces) {
  const style = body.match(/font-style:(\w+)/)[1];
  const weight = body.match(/font-weight:(\d+)/)[1];
  const range = body.match(/unicode-range:([^;]+);/)[1];
  const subset = range.includes('U+0400') ? 'cyrillic' : 'latin';
  const data = body.match(/url\(data:font\/woff2;base64,([^)]+)\)/)[1];
  const file = `${family.replace(/\s/g, '')}-${weight}${style === 'italic' ? 'i' : ''}-${subset}.woff2`;
  writeFileSync('site/fonts/' + file, Buffer.from(data, 'base64'));
  css.push(`@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;unicode-range:${range};src:url(../fonts/${file}) format('woff2')}`);
}
writeFileSync('site/css/fonts.css', css.join('\n') + '\n');

// --- текстуры Земли ---
let n = 0;
for (const [, name, data] of html.matchAll(/(day|night|clouds|spec):\s*'data:image\/jpeg;base64,([^']+)'/g)) {
  writeFileSync(`site/textures/earth-${name}.jpg`, Buffer.from(data, 'base64'));
  n++;
}

console.log(`assets: ${faces.length} шрифтов, ${n} текстур Земли`);

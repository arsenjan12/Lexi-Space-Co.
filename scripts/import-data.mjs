// Превращает исходники в SQL-файлы для базы:
//   ../Lexi web/lexi-translations.js + index.html  →  db/seed/03_module_texts.sql  (тексты модулей портала)
//   db/raw/*                                         →  db/seed/10_sky.sql      (звёзды, созвездия, галактики)
//
// Тексты модулей берутся прямо с портала, поэтому если Арс поменяет модуль —
// достаточно перезапустить: npm run import && npm run db

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PORTAL = process.env.LEXI_PORTAL || '../Lexi web/';
const RAW = 'db/raw/';

// SQL-строка: NULL для пустого, кавычки удваиваем
const q = v => (v === null || v === undefined || v === '' || Number.isNaN(v)) ? 'NULL'
  : typeof v === 'number' ? String(+v.toFixed(6))
  : `'${String(v).replace(/'/g, "''")}'`;
const row = vals => `(${vals.map(q).join(', ')})`;

// ---------------------------------------------------------------------
//  Модули портала
// ---------------------------------------------------------------------
function importModules() {
  const src = readFileSync(PORTAL + 'lexi-translations.js', 'utf8');
  const T = new Function(src + '; return lexiTranslations;')();

  // Короткие подзаголовки модулей живут в словаре интерфейса портала (m1.lead …)
  const html = readFileSync(PORTAL + 'index.html', 'utf8');
  const leads = { ru: {}, en: {} };
  for (const n of [1, 2, 3]) {
    const found = [...html.matchAll(new RegExp(`"m${n}\\.lead":\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g'))].map(m => JSON.parse(`"${m[1]}"`));
    leads.ru['module' + n] = found[0];   // в словаре портала сначала идёт ru, потом en
    leads.en['module' + n] = found[1];
  }

  const rows = [];
  for (const lang of Object.keys(T)) {
    for (const [id, m] of Object.entries(T[lang])) {
      rows.push(row([id, lang, m.title, leads[lang][id], m.goals, m.threats, m.physics_math, m.tech_standards]));
    }
  }
  return `-- Сгенерировано scripts/import-data.mjs из lexi-translations.js портала. Руками не править.\n` +
    `INSERT INTO module_texts (module_id, lang, title, lead, goals, threats, physics_math, tech_standards) VALUES\n` +
    rows.join(',\n') + ';\n';
}

// ---------------------------------------------------------------------
//  Небо
// ---------------------------------------------------------------------

// Простой разбор CSV HYG (поля в кавычках без запятых внутри)
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',').map(s => s.replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const cells = line.split(',').map(s => s.replace(/"/g, ''));
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

const num = s => (s === undefined || s === '' ? null : Number(s));

// Расстояния до объектов Мессье, тыс. световых лет (SEDS / NED, округлено).
// Точность — порядок «±10–20 %», для карточек этого достаточно.
const MESSIER_KLY = {
  M1: 6.5, M2: 37.5, M3: 33.9, M4: 7.2, M5: 24.5, M6: 1.6, M7: 0.98, M8: 4.1, M9: 25.8, M10: 14.3,
  M11: 6.2, M12: 15.7, M13: 22.2, M14: 30.3, M15: 33.6, M16: 7, M17: 5, M18: 4.9, M19: 28.7, M20: 5.2,
  M21: 4.25, M22: 10.6, M23: 2.15, M24: 10, M25: 2, M26: 5, M27: 1.36, M28: 17.9, M29: 4, M30: 26.1,
  M31: 2500, M32: 2490, M33: 2730, M34: 1.4, M35: 2.8, M36: 4.1, M37: 4.4, M38: 4.2, M39: 0.8, M40: 0.51,
  M41: 2.3, M42: 1.34, M43: 1.6, M44: 0.577, M45: 0.444, M46: 5.4, M47: 1.6, M48: 1.5, M49: 56000, M50: 3,
  M51: 31000, M52: 5, M53: 58, M54: 87.4, M55: 17.3, M56: 32.9, M57: 2.3, M58: 62000, M59: 60000, M60: 55000,
  M61: 52500, M62: 22.5, M63: 29000, M64: 17000, M65: 35000, M66: 35000, M67: 2.7, M68: 33.3, M69: 29.7, M70: 29.4,
  M71: 12, M72: 53.4, M73: 2.5, M74: 32000, M75: 67.5, M76: 3.4, M77: 47000, M78: 1.6, M79: 41, M80: 32.6,
  M81: 11800, M82: 11500, M83: 15000, M84: 60000, M85: 60000, M86: 52000, M87: 53500, M88: 47000, M89: 50000, M90: 58700,
  M91: 63000, M92: 26.7, M93: 3.6, M94: 16000, M95: 38000, M96: 31000, M97: 2.6, M98: 60000, M99: 55700, M100: 55000,
  M101: 21000, M102: 50000, M103: 8.5, M104: 29300, M105: 32000, M106: 23700, M107: 20.9, M108: 46000, M109: 83500, M110: 2690,
};

// Русские названия, которых нет в dsonames
const MESSIER_RU = {
  M45: ['Плеяды', 'Pleiades'], M44: ['Ясли', 'Beehive Cluster'], M24: ['Звёздное облако Стрельца', 'Sagittarius Star Cloud'],
  M40: ['Винеке 4', 'Winnecke 4'], M73: ['Астеризм M73', 'M73 asterism'],
};

// Объекты вне каталога Мессье, без которых карта неба неполная
const EXTRA_DSO = [
  ['LMC', null, 'galaxy_irregular', 'Большое Магелланово Облако', 'Large Magellanic Cloud', 80.894, -69.756, 0.9, '650x550', 163000, 'SB(s)m', 'Dor'],
  ['SMC', 'NGC 292', 'galaxy_irregular', 'Малое Магелланово Облако', 'Small Magellanic Cloud', 13.187, -72.829, 2.7, '320x185', 200000, 'SB(s)m pec', 'Tuc'],
  ['NGC 5128', 'NGC 5128', 'galaxy_lenticular', 'Центавр A', 'Centaurus A', 201.365, -43.019, 6.8, '25.7x20', 12000000, 'S0 pec', 'Cen'],
  ['NGC 253', 'NGC 253', 'galaxy_spiral', 'Галактика Скульптор', 'Sculptor Galaxy', 11.888, -25.288, 7.1, '27.5x6.8', 11400000, 'SAB(s)c', 'Scl'],
  ['Sgr A*', null, 'other', 'Центр Млечного Пути (Стрелец A*)', 'Galactic Centre (Sagittarius A*)', 266.417, -29.008, null, null, 26700, 'Сверхмассивная чёрная дыра, 4,3 млн M☉', 'Sgr'],
];

function dsoKind(type, morph) {
  const m = (morph || '').trim();
  if (type === 's') return /^S[AB]?0|^SA?B?0/.test(m) ? 'galaxy_lenticular' : 'galaxy_spiral';
  return { e: 'galaxy_elliptical', i: 'galaxy_irregular', gc: 'globular', oc: 'open', pn: 'planetary',
    sfr: 'nebula', rn: 'nebula', snr: 'snr', pos: 'other' }[type] || 'other';
}

function importSky() {
  const read = f => JSON.parse(readFileSync(RAW + f, 'utf8'));
  const starNames = read('starnames.json');
  const conMeta = read('constellations.json');
  const conLines = read('constellations.lines.json');
  const messier = read('messier.json');
  const dsoNames = read('dsonames.json');

  // d3-celestial хранит долготу от −180 до 180; переводим в прямое восхождение 0…360
  const ra360 = lon => (lon + 360) % 360;
  const out = [];

  // Созвездия
  // Змея (Ser) разорвана Змееносцем и встречается дважды — склеиваем её линии и берём одну подпись
  const lines = {};
  for (const f of conLines.features) {
    const segs = f.geometry.coordinates.map(seg => seg.map(([lon, lat]) => [+ra360(lon).toFixed(3), +lat.toFixed(3)]));
    lines[f.id] = (lines[f.id] || []).concat(segs);
  }
  const seen = new Set();
  const conRows = conMeta.features.filter(f => !seen.has(f.id) && seen.add(f.id)).map(f => {
    const [lon, lat] = f.geometry.coordinates;
    return row([f.id, f.properties.ru || f.properties.name, f.properties.en || f.properties.name,
      ra360(lon), lat, lines[f.id] ? JSON.stringify(lines[f.id]) : null]);
  });
  out.push('INSERT INTO constellations (id, name_ru, name_en, ra_deg, dec_deg, lines_json) VALUES\n' + conRows.join(',\n') + ';');
  const conIds = new Set(conMeta.features.map(f => f.id));

  // Звёзды: всё, что видно невооружённым глазом (до 6,0m), без Солнца
  const hyg = parseCsv(readFileSync(RAW + 'hygdata_v41.csv', 'utf8'));
  const stars = hyg.filter(s => s.id !== '0' && num(s.mag) <= 6.0);
  const starRows = stars.map(s => {
    const names = starNames[s.hip] || {};
    const dist = num(s.dist);
    return row([
      +s.id, num(s.hip), num(s.hd),
      names.ru || null, s.proper || names.name || null,
      s.bayer || null, s.flam || null, conIds.has(s.con) ? s.con : null,
      num(s.ra) * 15, num(s.dec),
      dist && dist < 100000 ? dist : null,   // 100000 в HYG означает «неизвестно»
      num(s.mag), num(s.absmag), s.spect ? s.spect.replace(/\.+$/, '') : null, num(s.ci), num(s.lum),
    ]);
  });
  // Пачками, чтобы не делать один гигантский INSERT
  for (let i = 0; i < starRows.length; i += 500) {
    out.push('INSERT INTO stars (id, hip, hd, name_ru, name_en, bayer, flam, con, ra_deg, dec_deg, dist_pc, mag, absmag, spect, ci, lum) VALUES\n' +
      starRows.slice(i, i + 500).join(',\n') + ';');
  }

  // Галактики, туманности, скопления
  const dsoRows = messier.features.map(f => {
    const p = f.properties;
    const names = dsoNames[p.desig] || {};
    const [ruFix, enFix] = MESSIER_RU[f.id] || [];
    const [lon, lat] = f.geometry.coordinates;
    const kly = MESSIER_KLY[f.id];
    return row([f.id, p.desig || null, dsoKind(p.type, p.cl),
      names.ru || ruFix || null, p.alt || names.name || enFix || null,
      ra360(lon), lat, p.mag, p.dim || null, kly ? kly * 1000 : null, p.cl || null, null]);
  });
  for (const extra of EXTRA_DSO) dsoRows.push(row(extra));
  out.push('INSERT INTO deep_sky (id, ngc, kind, name_ru, name_en, ra_deg, dec_deg, mag, size, dist_ly, morph, con) VALUES\n' + dsoRows.join(',\n') + ';');

  console.log(`небо: ${conRows.length} созвездий, ${starRows.length} звёзд, ${dsoRows.length} объектов глубокого космоса`);
  return '-- Сгенерировано scripts/import-data.mjs из каталогов HYG v4.1 и d3-celestial. Руками не править.\n' + out.join('\n\n') + '\n';
}

if (!existsSync(PORTAL + 'lexi-translations.js')) {
  console.error(`Не нашёл портал в «${PORTAL}». Укажи путь: LEXI_PORTAL=путь/к/Lexi web/ npm run import`);
  process.exit(1);
}
writeFileSync('db/seed/03_module_texts.sql', importModules());
writeFileSync('db/seed/10_sky.sql', importSky());
console.log('import: готово → db/seed/03_module_texts.sql, db/seed/10_sky.sql');

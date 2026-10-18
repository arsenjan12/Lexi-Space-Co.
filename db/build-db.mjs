// Собирает site/data/lexi.sqlite из db/schema.sql и db/seed/*.sql,
// а потом раскладывает знания на фрагменты для LexiAI (таблица ai_knowledge + поиск ai_search).
// Запуск: npm run db

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import initSqlJs from 'sql.js';

const SQL = await initSqlJs();
const db = new SQL.Database();

db.run(readFileSync('db/schema.sql', 'utf8'));
for (const file of readdirSync('db/seed').filter(f => f.endsWith('.sql')).sort()) {
  try {
    db.run(readFileSync('db/seed/' + file, 'utf8'));
  } catch (e) {
    console.error(`Ошибка в db/seed/${file}: ${e.message}`);
    process.exit(1);
  }
}

// Проверка ссылок: SQLite проверяет внешние ключи, а связи в links — нет, проверим сами
const known = {
  module: 'modules', goal: 'goals', threat: 'threats', countermeasure: 'countermeasures',
  formula: 'formulas', sat_group: 'sat_groups', indicator: 'indicators',
};
const all = (sql, params = []) => {
  const st = db.prepare(sql); st.bind(params);
  const rows = []; while (st.step()) rows.push(st.getAsObject());
  st.free(); return rows;
};
const one = (sql, params) => all(sql, params)[0];
let broken = 0;
for (const l of all('SELECT * FROM links')) {
  for (const [type, id] of [[l.from_type, l.from_id], [l.to_type, l.to_id]]) {
    if (!known[type] || !one(`SELECT 1 AS ok FROM ${known[type]} WHERE id = ?`, [id])) {
      console.error(`links: нет такого ${type} «${id}»`); broken++;
    }
  }
}
if (broken) process.exit(1);

// ---------------------------------------------------------------------
//  Фрагменты знаний для LexiAI
// ---------------------------------------------------------------------

// Разметка портала (**жирный**, • пункт, $формула$) → простой текст для модели
const plain = s => (s || '')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/^•\s*/gm, '— ')
  .replace(/\$\$([^$]+)\$\$/g, ' $1 ')
  .replace(/\$([^$]+)\$/g, '$1')
  .replace(/\n{2,}/g, '\n')
  .trim();

// Раздел модуля → пункты. Пункт начинается с «• » или с абзаца «**Заголовок.**»;
// абзацы-формулы и пояснения после него прилипают к нему же.
function moduleItems(text) {
  const items = [];
  const leadOf = s => (s.match(/\*\*(.+?)\*\*/)?.[1] || s.replace(/\$[^$]*\$/g, '').split(/\s+/).slice(0, 6).join(' ')).replace(/[.:]$/, '');
  for (const block of String(text || '').split(/\n{2,}/)) {
    for (const line of block.split('\n')) {
      const isBullet = line.startsWith('• ');
      const isHeading = /^\*\*/.test(line);
      if (isBullet || isHeading || !items.length) items.push({ lead: leadOf(line), text: line.replace(/^•\s*/, '') });
      else items[items.length - 1].text += '\n' + line;
    }
  }
  return items.filter(i => i.text.trim());
}

const L = {
  ru: { goals: 'Цели', threats: 'Угрозы', math: 'Физика и математика', tech: 'Технологии и стандарты',
    signs: 'Признаки', mitigated: 'Защита', detected: 'Обнаружение', measured: 'Расчёт', covers: 'Закрывает угрозы',
    uses: 'Использует формулы', serves: 'Служит целям', params: 'Параметры', module: 'Модуль', severity: 'Опасность',
    dist: 'Расстояние', mag: 'Видимая звёздная величина', con: 'Созвездие', spect: 'Спектральный класс',
    lum: 'Светимость', ly: 'св. лет', pc: 'пк', mass: 'Масса', radius: 'Радиус', g: 'Ускорение свободного падения',
    period: 'Период обращения', day: 'Сутки', moons: 'Спутников', temp: 'Температура', atm: 'Атмосфера',
    days: 'сут', hours: 'ч', size: 'Угловой размер', morph: 'Морфология', how: 'Как считается', watches: 'Следит за угрозами' },
  en: { goals: 'Goals', threats: 'Threats', math: 'Physics and maths', tech: 'Technology and standards',
    signs: 'Signs', mitigated: 'Protection', detected: 'Detection', measured: 'Calculation', covers: 'Covers threats',
    uses: 'Uses formulas', serves: 'Serves goals', params: 'Parameters', module: 'Module', severity: 'Severity',
    dist: 'Distance', mag: 'Apparent magnitude', con: 'Constellation', spect: 'Spectral class',
    lum: 'Luminosity', ly: 'ly', pc: 'pc', mass: 'Mass', radius: 'Radius', g: 'Surface gravity',
    period: 'Orbital period', day: 'Day length', moons: 'Moons', temp: 'Temperature', atm: 'Atmosphere',
    days: 'd', hours: 'h', size: 'Angular size', morph: 'Morphology', how: 'How it is computed', watches: 'Watches threats' },
};
const KIND = {
  ru: { galaxy_spiral: 'спиральная галактика', galaxy_elliptical: 'эллиптическая галактика', galaxy_lenticular: 'линзовидная галактика',
    galaxy_irregular: 'неправильная галактика', globular: 'шаровое скопление', open: 'рассеянное скопление', planetary: 'планетарная туманность',
    nebula: 'туманность', snr: 'остаток сверхновой', other: 'объект', star: 'звезда', planet: 'планета', dwarf: 'карликовая планета', moon: 'спутник' },
  en: { galaxy_spiral: 'spiral galaxy', galaxy_elliptical: 'elliptical galaxy', galaxy_lenticular: 'lenticular galaxy',
    galaxy_irregular: 'irregular galaxy', globular: 'globular cluster', open: 'open cluster', planetary: 'planetary nebula',
    nebula: 'nebula', snr: 'supernova remnant', other: 'object', star: 'star', planet: 'planet', dwarf: 'dwarf planet', moon: 'moon' },
};
const UNIT_EN = { 'км': 'km', 'м': 'm', 'мкс': 'µs', 'мин': 'min', 'лет': 'yr', 'бит': 'bits', 'КБ': 'KB', 'Вт': 'W', 'дБ': 'dB', 'дБм': 'dBm',
  'дБи': 'dBi', 'ГГц': 'GHz', 'МГц': 'MHz', 'Гц': 'Hz', 'м/с': 'm/s', 'км/с': 'km/s', 'дБ·Гц': 'dB-Hz', 'чип/с': 'chip/s',
  'см²/бит': 'cm²/bit', 'см⁻²·с⁻¹': 'cm⁻²·s⁻¹', 'кг': 'kg', 'а.е.': 'AU', 'пк': 'pc', 'млн св. лет': 'Mly' };
const unitL = (u, lang) => (lang === 'en' ? UNIT_EN[u] ?? u : u);
const fmt = (x, lang, d = 0) => x == null ? '—' : Number(x).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: d });

const chunks = [];
const add = (lang, kind, ref, title, body) => chunks.push({ lang, kind, ref, title, body: body.trim() });

for (const lang of ['ru', 'en']) {
  const t = L[lang];
  const title = (table, key, id) => one(`SELECT title FROM ${table} WHERE ${key} = ? AND lang = ?`, [id, lang])?.title || id;
  const linked = (fromType, fromId, relation, toType) =>
    all('SELECT to_id FROM links WHERE from_type = ? AND from_id = ? AND relation = ? AND to_type = ?', [fromType, fromId, relation, toType]).map(r => r.to_id);
  const linkedFrom = (toType, toId, relation, fromType) =>
    all('SELECT from_id FROM links WHERE to_type = ? AND to_id = ? AND relation = ? AND from_type = ?', [toType, toId, relation, fromType]).map(r => r.from_id);

  // Модули — по пунктам: каждый пункт раздела («• **Спуфинг координат.** …», абзац с формулой) —
  // отдельный фрагмент. Тогда поиск приносит ровно тот пункт, о котором спросили,
  // а не длинный раздел, от которого в окно модели влезает только начало.
  for (const m of all('SELECT * FROM module_texts WHERE lang = ?', [lang])) {
    add(lang, 'module', m.module_id, m.title, `${m.title}. ${m.lead || ''}`);
    for (const [section, text] of [[t.goals, m.goals], [t.threats, m.threats], [t.math, m.physics_math], [t.tech, m.tech_standards]]) {
      for (const item of moduleItems(text)) {
        add(lang, 'module', m.module_id, `${m.title}: ${section} — ${item.lead}`, plain(item.text));
      }
    }
  }

  for (const th of all('SELECT t.*, x.title, x.body, x.signs FROM threats t JOIN threat_texts x ON x.threat_id = t.id WHERE x.lang = ?', [lang])) {
    const mit = linked('threat', th.id, 'mitigated_by', 'countermeasure').map(id => title('countermeasure_texts', 'countermeasure_id', id));
    const det = [...linked('threat', th.id, 'detected_by', 'countermeasure').map(id => title('countermeasure_texts', 'countermeasure_id', id)),
                 ...linked('threat', th.id, 'detected_by', 'formula').map(id => title('formula_texts', 'formula_id', id))];
    const calc = linked('threat', th.id, 'quantified_by', 'formula').map(id => title('formula_texts', 'formula_id', id));
    add(lang, 'threat', th.id, th.title, [
      `${th.title}. ${th.body}`,
      `${t.module}: ${title('module_texts', 'module_id', th.module_id)}. ${t.severity}: ${th.severity}/5.`,
      th.signs && `${t.signs}: ${th.signs}`,
      det.length && `${t.detected}: ${det.join('; ')}.`,
      mit.length && `${t.mitigated}: ${mit.join('; ')}.`,
      calc.length && `${t.measured}: ${calc.join('; ')}.`,
    ].filter(Boolean).join('\n'));
  }

  for (const c of all('SELECT c.*, x.title, x.body FROM countermeasures c JOIN countermeasure_texts x ON x.countermeasure_id = c.id WHERE x.lang = ?', [lang])) {
    const covers = [...linkedFrom('countermeasure', c.id, 'mitigated_by', 'threat'), ...linkedFrom('countermeasure', c.id, 'detected_by', 'threat')]
      .map(id => title('threat_texts', 'threat_id', id));
    const uses = linked('countermeasure', c.id, 'uses', 'formula').map(id => title('formula_texts', 'formula_id', id));
    const serves = linked('countermeasure', c.id, 'serves', 'goal').map(id => title('goal_texts', 'goal_id', id));
    add(lang, 'countermeasure', c.id, c.title, [
      `${c.title}. ${c.body}`,
      covers.length && `${t.covers}: ${[...new Set(covers)].join('; ')}.`,
      uses.length && `${t.uses}: ${uses.join('; ')}.`,
      serves.length && `${t.serves}: ${serves.join('; ')}.`,
    ].filter(Boolean).join('\n'));
  }

  for (const f of all('SELECT f.*, x.title, x.explanation FROM formulas f JOIN formula_texts x ON x.formula_id = f.id WHERE x.lang = ?', [lang])) {
    const params = all('SELECT * FROM formula_params WHERE formula_id = ? ORDER BY pos', [f.id])
      .map(p => `${p.symbol} — ${lang === 'ru' ? p.label_ru : p.label_en}${p.unit ? ` (${unitL(p.unit, lang)})` : ''}`);
    add(lang, 'formula', f.id, f.title, [
      `${f.title}: ${f.latex}`,
      f.explanation,
      params.length && `${t.params}: ${params.join('; ')}.`,
    ].filter(Boolean).join('\n'));
  }

  for (const i of all('SELECT i.*, x.title, x.how FROM indicators i JOIN indicator_texts x ON x.indicator_id = i.id WHERE x.lang = ?', [lang])) {
    const watches = linked('indicator', i.id, 'watches', 'threat').map(id => title('threat_texts', 'threat_id', id));
    add(lang, 'indicator', i.id, i.title, `${i.title}. ${t.how}: ${i.how}${watches.length ? `\n${t.watches}: ${watches.join('; ')}.` : ''}`);
  }

  for (const b of all('SELECT * FROM bodies')) {
    const name = lang === 'ru' ? b.name_ru : b.name_en;
    add(lang, 'body', b.id, name, [
      `${name} — ${KIND[lang][b.kind]}.`,
      `${t.mass}: ${b.mass_kg.toExponential(3)} kg. ${t.radius}: ${fmt(b.radius_km, lang, 1)} km. ${t.g}: ${b.gravity} m/s².`,
      b.period_days && `${t.period}: ${fmt(b.period_days, lang, 2)} ${t.days}.`,
      b.day_hours && `${t.day}: ${fmt(b.day_hours, lang, 2)} ${t.hours}.`,
      b.moons != null && `${t.moons}: ${b.moons}.`,
      `${t.temp}: ${b.temp_c} °C. ${t.atm}: ${lang === 'ru' ? b.atmosphere_ru : b.atmosphere_en}.`,
      lang === 'ru' ? b.fact_ru : b.fact_en,
    ].filter(Boolean).join(' '));
  }

  for (const d of all('SELECT d.*, c.name_ru AS con_ru, c.name_en AS con_en FROM deep_sky d LEFT JOIN constellations c ON c.id = d.con')) {
    const name = (lang === 'ru' ? d.name_ru : d.name_en) || d.id;
    const label = name === d.id ? d.id : `${d.id} (${name})`;
    add(lang, 'deep_sky', d.id, label, [
      `${label} — ${KIND[lang][d.kind]}.`,
      d.ngc && d.ngc !== d.id && `${d.ngc}.`,
      d.dist_ly && `${t.dist}: ≈ ${fmt(d.dist_ly, lang)} ${t.ly}.`,
      d.mag != null && `${t.mag}: ${d.mag}.`,
      d.size && `${t.size}: ${d.size}′.`,
      d.morph && `${t.morph}: ${d.morph}.`,
    ].filter(Boolean).join(' '));
  }

  // Только звёзды с собственными именами — остальные модель всё равно не спросят по имени
  for (const s of all(`SELECT s.*, c.name_ru AS con_ru, c.name_en AS con_en FROM stars s LEFT JOIN constellations c ON c.id = s.con
                       WHERE s.name_en IS NOT NULL OR s.name_ru IS NOT NULL`)) {
    const name = (lang === 'ru' ? s.name_ru : s.name_en) || s.name_en || s.name_ru;
    const con = lang === 'ru' ? s.con_ru : s.con_en;
    add(lang, 'star', String(s.id), name, [
      `${name} — ${KIND[lang].star}${con ? `, ${t.con.toLowerCase()} ${con}` : ''}.`,
      s.dist_pc && `${t.dist}: ${fmt(s.dist_pc * 3.26156, lang, 1)} ${t.ly} (${fmt(s.dist_pc, lang, 2)} ${t.pc}).`,
      `${t.mag}: ${s.mag}.`,
      s.spect && `${t.spect}: ${s.spect}.`,
      s.lum && `${t.lum}: ${fmt(s.lum, lang, 1)} L☉.`,
    ].filter(Boolean).join(' '));
  }

  for (const g of all('SELECT * FROM sat_groups')) {
    const name = lang === 'ru' ? g.name_ru : g.name_en;
    add(lang, 'sat_group', g.id, name, `${name}: ${lang === 'ru' ? g.purpose_ru : g.purpose_en}.`);
  }
  for (const s of all('SELECT * FROM satellites')) {
    const name = lang === 'ru' ? s.name_ru : s.name_en;
    add(lang, 'satellite', String(s.norad), name, `${name} (NORAD ${s.norad}, ${s.operator}, ${s.launched}). ${lang === 'ru' ? s.about_ru : s.about_en}`);
  }
}

const ins = db.prepare('INSERT INTO ai_knowledge (lang, kind, ref_id, title, body) VALUES (?, ?, ?, ?, ?)');
const insFts = db.prepare('INSERT INTO ai_search (rowid, title, body) VALUES (?, ?, ?)');
chunks.forEach((c, i) => {
  ins.run([c.lang, c.kind, c.ref, c.title, c.body]);
  insFts.run([i + 1, c.title, c.body]);
});
ins.free(); insFts.free();

db.run('VACUUM');
mkdirSync('site/data', { recursive: true });
const bytes = db.export();
writeFileSync('site/data/lexi.sqlite', Buffer.from(bytes));

// Короткая сводка
const count = t => one(`SELECT COUNT(*) AS n FROM ${t}`).n;
console.log(['modules', 'threats', 'countermeasures', 'formulas', 'links', 'stars', 'deep_sky', 'bodies', 'ai_knowledge']
  .map(t => `${t}: ${count(t)}`).join(', '));
console.log(`db: готово → site/data/lexi.sqlite (${(bytes.length / 1024).toFixed(0)} КБ)`);

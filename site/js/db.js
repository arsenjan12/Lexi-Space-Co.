// База знаний LEXI в браузере: SQLite (sql.js) поверх файла data/lexi.sqlite.
// Сервер не нужен — файл скачивается один раз и дальше все запросы идут локально.

import { lang } from './i18n.js';

let db = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('не загрузился ' + src));
    document.head.append(s);
  });
}

export async function openDb() {
  await loadScript('vendor/sql-wasm.js');
  const [SQL, file] = await Promise.all([
    window.initSqlJs({ locateFile: f => 'vendor/' + f }),
    fetch('data/lexi.sqlite').then(r => { if (!r.ok) throw new Error('data/lexi.sqlite: ' + r.status); return r.arrayBuffer(); }),
  ]);
  db = new SQL.Database(new Uint8Array(file));
}

export function all(sql, params = []) {
  const st = db.prepare(sql);
  st.bind(params);
  const rows = [];
  while (st.step()) rows.push(st.getAsObject());
  st.free();
  return rows;
}
export const one = (sql, params) => all(sql, params)[0] || null;

// Короткие помощники для частых запросов — с учётом текущего языка
export const pick = (row, field) => row ? (row[`${field}_${lang}`] ?? row[`${field}_ru`] ?? row[field]) : null;

export const modules = () => all(`SELECT m.*, x.title, x.lead, x.goals, x.threats AS threats_text, x.physics_math, x.tech_standards
  FROM modules m JOIN module_texts x ON x.module_id = m.id AND x.lang = ? ORDER BY m.num`, [lang]);

export const threats = moduleId => all(`SELECT t.*, x.title, x.body, x.signs FROM threats t
  JOIN threat_texts x ON x.threat_id = t.id AND x.lang = ? WHERE (? IS NULL OR t.module_id = ?) ORDER BY t.severity DESC, t.id`, [lang, moduleId ?? null, moduleId ?? null]);
export const threat = id => one(`SELECT t.*, x.title, x.body, x.signs FROM threats t JOIN threat_texts x ON x.threat_id = t.id AND x.lang = ? WHERE t.id = ?`, [lang, id]);

export const countermeasures = moduleId => all(`SELECT c.*, x.title, x.body FROM countermeasures c
  JOIN countermeasure_texts x ON x.countermeasure_id = c.id AND x.lang = ? WHERE (? IS NULL OR c.module_id = ?) ORDER BY c.rowid`, [lang, moduleId ?? null, moduleId ?? null]);
export const countermeasure = id => one(`SELECT c.*, x.title, x.body FROM countermeasures c JOIN countermeasure_texts x ON x.countermeasure_id = c.id AND x.lang = ? WHERE c.id = ?`, [lang, id]);

// Все формулы; у астрономических module_id = NULL
export const formulas = () => all(`SELECT f.*, x.title, x.explanation FROM formulas f
  JOIN formula_texts x ON x.formula_id = f.id AND x.lang = ? ORDER BY f.rowid`, [lang]);
export const formula = id => one(`SELECT f.*, x.title, x.explanation FROM formulas f JOIN formula_texts x ON x.formula_id = f.id AND x.lang = ? WHERE f.id = ?`, [lang, id]);
export const formulaParams = id => all('SELECT * FROM formula_params WHERE formula_id = ? ORDER BY pos', [id]);

export const indicators = () => all(`SELECT i.*, x.title, x.how FROM indicators i JOIN indicator_texts x ON x.indicator_id = i.id AND x.lang = ? ORDER BY i.rowid`, [lang]);
export const indicator = id => one(`SELECT i.*, x.title, x.how FROM indicators i JOIN indicator_texts x ON x.indicator_id = i.id AND x.lang = ? WHERE i.id = ?`, [lang, id]);

export const goal = id => one('SELECT g.*, x.title, x.body FROM goals g JOIN goal_texts x ON x.goal_id = g.id AND x.lang = ? WHERE g.id = ?', [lang, id]);

// Связи в обе стороны
export const linksFrom = (type, id) => all('SELECT * FROM links WHERE from_type = ? AND from_id = ?', [type, id]);
export const linksTo = (type, id) => all('SELECT * FROM links WHERE to_type = ? AND to_id = ?', [type, id]);

// Название любой сущности графа — для списков связей
export function titleOf(type, id) {
  switch (type) {
    case 'threat': return threat(id)?.title;
    case 'countermeasure': return countermeasure(id)?.title;
    case 'formula': return formula(id)?.title;
    case 'goal': return goal(id)?.title;
    case 'indicator': return indicator(id)?.title;
    case 'module': return one('SELECT title FROM module_texts WHERE module_id = ? AND lang = ?', [id, lang])?.title;
    case 'sat_group': return pick(one('SELECT * FROM sat_groups WHERE id = ?', [id]), 'name');
    default: return id;
  }
}

// Небо
export const bodies = () => all('SELECT * FROM bodies ORDER BY rowid');
export const body = id => one('SELECT * FROM bodies WHERE id = ?', [id]);
export const satGroups = () => all('SELECT * FROM sat_groups ORDER BY rowid');
export const knownSatellite = norad => one('SELECT * FROM satellites WHERE norad = ?', [norad]);
export const constellations = () => all('SELECT * FROM constellations');
export const constellation = id => one('SELECT * FROM constellations WHERE id = ?', [id]);
export const stars = (maxMag = 6.0) => all('SELECT * FROM stars WHERE mag <= ? ORDER BY mag', [maxMag]);
export const star = id => one('SELECT * FROM stars WHERE id = ?', [id]);
export const deepSky = () => all('SELECT * FROM deep_sky');
export const dso = id => one('SELECT * FROM deep_sky WHERE id = ?', [id]);

// Поиск знаний для LexiAI (полнотекстовый индекс FTS4)
// Служебные слова, по которым искать бессмысленно
const STOP = new Set(('один два три четыре пять как что где когда сейчас такое это для про под над при или ли чем чего кто какой какая какие сколько можно нужно ' +
  'расскажи покажи посчитай рассчитай объясни скажи лет год года раз мне нам вас есть был была будет ' +
  'the what where when how is are of for to in on and or now tell me about show calculate explain does do why which with').split(' '));

// Разговорные слова → термины базы (таблица ai_synonyms)
const synCache = {};
function expand(words) {
  const syn = synCache[lang] ??= all('SELECT word, terms FROM ai_synonyms WHERE lang = ?', [lang]);
  const extra = [];
  for (const w of words) for (const s of syn) if (w.startsWith(s.word)) extra.push(...(s.terms.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []));
  return extra;
}

export function searchKnowledge(query, limit = 6) {
  // слова короче трёх букв («за», «на») как префикс находят всё подряд — не ищем по ним
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(w => !STOP.has(w) && !/^\d+$/.test(w));
  if (!words.length) return [];
  // Обрезаем окончания, чтобы «спуфинга», «спуфингом» находили «спуфинг»
  const stem = w => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 2)) : w);
  const terms = [...new Set([...words, ...expand(words)])];
  // короткие слова ищем целиком: «три*» находило бы «Триплет»
  const match = terms.map(w => (w.length >= 4 ? `${stem(w)}*` : w)).join(' OR ');
  try {
    return all(`SELECT k.*, matchinfo(ai_search, 'pcnx') AS mi FROM ai_search s JOIN ai_knowledge k ON k.id = s.rowid
                WHERE ai_search MATCH ? AND k.lang = ?`, [match, lang])
      .map(r => ({ ...r, score: scoreMatch(r.mi, r.title, terms) }))
      .sort((a, b) => b.score - a.score)
      .filter((r, i, arr) => r.score >= arr[0].score * 0.45)   // слабые совпадения не тащим
      .slice(0, limit);
  } catch {
    return [];
  }
}

// Оценка релевантности: редкие слова весят больше частых (IDF), совпадение в заголовке — с бонусом
function scoreMatch(mi, title, words) {
  const m = new Uint32Array(mi.buffer ? mi.buffer.slice(mi.byteOffset, mi.byteOffset + mi.byteLength) : mi);
  const phrases = m[0], cols = m[1], total = m[2];
  let s = 0;
  for (let p = 0; p < phrases; p++) {
    for (let c = 0; c < cols; c++) {
      const i = 3 + 3 * (p * cols + c);
      const hits = m[i], docs = m[i + 2];
      if (hits) s += (c === 0 ? 3 : 1) * Math.min(hits, 3) * Math.log(1 + total / Math.max(docs, 1));
    }
  }
  const tl = title.toLowerCase();
  for (const w of words) if (tl.includes(w.slice(0, 5))) s += 6;
  return s;
}

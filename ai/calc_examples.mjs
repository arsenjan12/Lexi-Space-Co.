// Готовит примеры расчётов для обучающей выборки: случайные, но правдоподобные параметры
// для каждой формулы и результат тех же калькуляторов, что работают на сайте.
// Так модель видит ровно такие строки «Расчёт: …», как в браузере.
//
// Запуск (его делает build_dataset.py): node ai/calc_examples.mjs 12 > ai/out/calc.jsonl

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';

const perFormula = +(process.argv[2] || 10);
const site = p => pathToFileURL(resolve('site/js', p)).href;
const { setLang, num, unit } = await import(site('i18n.js'));
const { runFormula } = await import(site('formulas.js'));

// Браузерных API в Node нет — заглушки для того, что трогают модули сайта
globalThis.performance ??= { now: () => Date.now() };

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync('site/data/lexi.sqlite'));
const rows = (sql, p = []) => { const st = db.prepare(sql); st.bind(p); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };

// Случайное значение рядом со значением по умолчанию, в допустимых пределах
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function sample(p) {
  if (p.step === 1 || (p.min === 0 && p.max === 1)) {
    const lo = p.min ?? 0, hi = p.max ?? p.def * 3;
    if (p.max === 1 && p.min === 0) return rnd() < 0.7 ? 1 : 0;
    return Math.round(lo + rnd() * Math.min(hi - lo, Math.max(10, Math.abs(p.def) * 2)));
  }
  const k = Math.exp((rnd() - 0.5) * 1.6);          // ×0,45 … ×2,2 от значения по умолчанию
  let v = p.def * k;
  if (p.min != null) v = Math.max(p.min, v);
  if (p.max != null) v = Math.min(p.max, v);
  const mag = Math.abs(v);
  return mag >= 100 ? Math.round(v) : mag >= 1 ? +v.toFixed(2) : +v.toPrecision(3);
}

const formulas = rows("SELECT * FROM formulas WHERE calc IS NOT NULL AND calc != 'hybridKey'");
for (const lang of ['ru', 'en']) {
  setLang(lang);
  for (const f of formulas) {
    const title = rows('SELECT title FROM formula_texts WHERE formula_id = ? AND lang = ?', [f.id, lang])[0].title;
    const params = rows('SELECT * FROM formula_params WHERE formula_id = ? ORDER BY pos', [f.id]);
    for (let i = 0; i < perFormula; i++) {
      const values = Object.fromEntries(params.map(p => [p.name, i === 0 ? p.def : sample(p)]));
      const r = runFormula(f.calc, values);
      if (!r || r.lines.some(l => /NaN|Infinity/.test(l))) continue;
      const used = params.map(p => `${p.symbol.replace(/\\/g, '')}=${num(values[p.name], 6)}${p.unit ? ' ' + unit(p.unit, lang) : ''}`).join(', ');
      process.stdout.write(JSON.stringify({
        lang, formula_id: f.id, title, values,
        params: params.map(p => ({ name: p.name, label: lang === 'ru' ? p.label_ru : p.label_en, unit: unit(p.unit, lang), value: values[p.name] })),
        lines: r.lines, bad: !!r.bad,
        text: `${title} (${used}): ${r.lines.join('; ')}`,
      }) + '\n');
    }
  }
}

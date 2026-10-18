// Word-документ со всеми формулами и алгоритмами LEXI и LEXI Space.
//
// Формулы, параметры и связи берутся из базы (site/data/lexi.sqlite), примеры расчётов —
// теми же калькуляторами, что на сайте (site/js/formulas.js), алгоритмы описаны ниже по коду.
// Формулы вставляются настоящими формулами Word: LaTeX → MathML (KaTeX) → OMML (MML2OMML.XSL из Office).
//
// Запуск: node scripts/export-formulas-docx.mjs   →   docs/LEXI_формулы_и_алгоритмы.docx
// Нужен установленный Microsoft Word (для конвертера формул).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import initSqlJs from 'sql.js';
import katex from 'katex';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  HeadingLevel, AlignmentType, Footer, Header, PageNumber, TableOfContents, LevelFormat, PageBreak,
} from 'docx';

const OUT = resolve('docs/LEXI_формулы_и_алгоритмы.docx');
const site = p => pathToFileURL(resolve('site/js', p)).href;
const { setLang, unit } = await import(site('i18n.js'));
const { runFormula } = await import(site('formulas.js'));
setLang('ru');

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync('site/data/lexi.sqlite'));
const rows = (sql, p = []) => { const st = db.prepare(sql); st.bind(p); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const one = (sql, p) => rows(sql, p)[0];

// ---------------------------------------------------------------------
//  Оформление
// ---------------------------------------------------------------------
const GOLD = '8A6A26', INK = '1F1D1A', MUTE = '6B665D', LINE = 'D8CBA8', TINT = 'F7F2E6';
const PAGE_W = 11906, MARGIN = 1134, CONTENT = PAGE_W - 2 * MARGIN;   // A4, поля 2 см

// Формулы копим в список, в тексте оставляем метку ⟦EQ:n⟧ и потом подменяем её на OMML
const equations = [];
const eqMark = (tex, inline = false) => { equations.push({ id: equations.length, tex, inline }); return `⟦${inline ? 'IEQ' : 'EQ'}:${equations.length - 1}⟧`; };

const p = (text, opts = {}) => new Paragraph({ spacing: { after: 120, line: 300 }, ...opts, children: [].concat(text).map(t => typeof t === 'string' ? new TextRun(t) : t) });
const small = text => p(new TextRun({ text, size: 19, color: MUTE }), { spacing: { after: 160, line: 276 } });
const eq = tex => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 160 }, children: [new TextRun(eqMark(tex))] });
const h1 = text => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)], pageBreakBefore: true });
const h2 = text => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
const h3 = text => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] });
const bullet = (text, level = 0) => new Paragraph({ numbering: { reference: 'bullets', level }, spacing: { after: 80, line: 290 },
  children: [].concat(text).map(t => typeof t === 'string' ? new TextRun(t) : t) });
const step = (text, ref) => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 80, line: 290 },
  children: [].concat(text).map(t => typeof t === 'string' ? new TextRun(t) : t) });
const b = text => new TextRun({ text, bold: true });
const code = text => new TextRun({ text, font: 'Consolas', size: 19, color: '5A4A20' });
const ieq = tex => new TextRun(eqMark(tex, true));

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };
function table(head, body, widths) {   // head = null — таблица без строки заголовков
  const total = widths.reduce((a, c) => a + c, 0);
  const cell = (content, w, isHead) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders,
    shading: isHead ? { fill: TINT, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { after: 0, line: 264 }, children: [].concat(content).map(c =>
      typeof c === 'string' ? new TextRun({ text: c, bold: isHead, size: isHead ? 19 : 20, color: isHead ? GOLD : INK }) : c) })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [...(head ? [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, widths[i], true)) })] : []),
      ...body.map(r => new TableRow({ children: r.map((c, i) => cell(c, widths[i], false)) }))],
  });
}
const gap = () => new Paragraph({ spacing: { after: 80 }, children: [] });

// ---------------------------------------------------------------------
//  Содержание: формулы из базы
// ---------------------------------------------------------------------
const MODULES = rows("SELECT m.id, m.num, x.title, x.lead FROM modules m JOIN module_texts x ON x.module_id = m.id AND x.lang = 'ru' ORDER BY m.num");
const FORMULAS = rows("SELECT f.*, x.title, x.explanation FROM formulas f JOIN formula_texts x ON x.formula_id = f.id AND x.lang = 'ru' ORDER BY f.rowid");
const titleOf = (type, id) => {
  const t = { threat: ['threat_texts', 'threat_id'], countermeasure: ['countermeasure_texts', 'countermeasure_id'], formula: ['formula_texts', 'formula_id'], indicator: ['indicator_texts', 'indicator_id'] }[type];
  return t ? one(`SELECT title FROM ${t[0]} WHERE ${t[1]} = ? AND lang = 'ru'`, [id])?.title : id;
};
// 1e-14 → 1·10⁻¹⁴, 1023000 → 1 023 000, 0.95 → 0,95
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function human(x) {
  if (x == null) return '—';
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e7)) {
    const e = Math.floor(Math.log10(a)), m = +(x / 10 ** e).toFixed(3);
    return `${m === 1 ? '' : String(m).replace('.', ',') + '·'}10${String(e).replace(/./g, ch => SUP[ch])}`;
  }
  return x.toLocaleString('ru-RU', { maximumFractionDigits: 6 });
}
const ORIGIN = { portal: 'портал LEXI (lexi-translations.js)', gosha: 'сервер Гоши (server.py), исправлено', space: 'LEXI Space' };

function formulaSection(f, n) {
  const out = [h3(`${n}. ${f.title}`), eq(f.latex), p(f.explanation)];
  const params = rows('SELECT * FROM formula_params WHERE formula_id = ? ORDER BY pos', [f.id]);
  if (params.length) {
    out.push(table(['Обозначение', 'Что это', 'Единица', 'Пример'],
      params.map(pr => [[ieq(pr.symbol)], pr.label_ru, unit(pr.unit, 'ru') || '—', human(pr.def)]),
      [1700, 4538, 1500, 1900]));
    if (f.calc) {
      const r = runFormula(f.calc, Object.fromEntries(params.map(pr => [pr.name, pr.def])));
      if (r) out.push(p([b('Пример расчёта: '), new TextRun(r.lines.map(l => l.replace(/[.;]$/, '')).join('; ') + '.')], { spacing: { before: 120, after: 120, line: 300 } }));
    }
  }
  // Связи: от каких угроз, в каких защитах и показателях используется
  const users = rows('SELECT * FROM links WHERE to_type = ? AND to_id = ?', ['formula', f.id])
    .map(l => `${titleOf(l.from_type, l.from_id)}${l.from_type === 'threat' ? ' (угроза)' : l.from_type === 'countermeasure' ? ' (защита)' : ''}`);
  const inds = rows('SELECT id FROM indicators WHERE formula_id = ?', [f.id]).map(i => `${titleOf('indicator', i.id)} (живой показатель)`);
  const meta = [`Источник: ${ORIGIN[f.origin]}`, f.calc ? `в коде: formulas.js → ${f.calc}()` : 'поясняющая формула, без калькулятора'];
  out.push(small(meta.join(' · ')));
  if (users.length || inds.length) out.push(small(`Связи: ${[...new Set([...users, ...inds])].join('; ')}`));
  return out;
}

// ---------------------------------------------------------------------
//  Сборка документа
// ---------------------------------------------------------------------
const children = [];

// ---------------------------------------------------------------------
//  Алгоритмы LEXI Space
// ---------------------------------------------------------------------
const algo = [];
let aNum = 0;
const A = (title, file) => { aNum++; algo.push(h2(`${aNum}. ${title}`), small(`Код: ${file}`)); };
let stepRef = 0;
const steps = list => { const ref = `steps${++stepRef}`; numberingConfigs.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] }); return list.map(s => step(s, ref)); };
const numberingConfigs = [];

algo.push(h1('Алгоритмы LEXI Space'), p('Всё, что ниже, реально работает в коде сайта и серверных функций. Каждый раздел — что делается, по шагам, с формулами.'));

A('Положение спутника по элементам TLE (SGP4)', 'site/js/sats.js, netlify/functions/tle.mjs');
algo.push(...steps([
  'Сервер берёт элементы группы из CelesTrak (только группы из белого списка), подписывает их ML-DSA-65 и отдаёт браузеру; при недоступности сервера браузер берёт их у CelesTrak напрямую, без подписи.',
  'Каждая строка TLE проверяется по контрольной сумме (алгоритм 7).',
  'Модель SGP4 (библиотека satellite.js) по элементам и моменту времени даёт положение r и скорость v в инерциальной системе TEME, км и км/с.',
  'Звёздное время по Гринвичу θ переводит положение в земную систему, откуда получаются широта, долгота и высота.',
  'Для наблюдателя считаются азимут, угол места и дальность. В реальном времени точки обновляются порциями по 450 спутников за кадр, при ускорении времени — до 2500.',
]));
algo.push(eq('\\mathbf{r}_{\\text{ECEF}} = R_z(\\theta_{\\text{GMST}})\\,\\mathbf{r}_{\\text{TEME}}'));
algo.push(p('Период и большая полуось — из среднего движения n (витков в сутки):'), eq('T = \\frac{1440}{n}\\ \\text{мин}, \\qquad a = \\sqrt[3]{\\mu \\left(\\frac{86400}{2\\pi n}\\right)^{2}}'));

A('Доплеровский сдвиг для наблюдателя', 'site/js/sats.js → satNow()');
algo.push(p('Скорость сближения считается численно — разность дальностей через секунду, — и подставляется в формулу Доплера для частоты L1 (у спутников GNSS показывается в карточке):'),
  eq('\\dot{\\rho} \\approx \\rho(t + 1\\,\\text{с}) - \\rho(t), \\qquad f_d = -f_{L1}\\,\\frac{\\dot{\\rho}}{c}, \\quad f_{L1} = 1575{,}42\\ \\text{МГц}'));

A('Следующий пролёт над наблюдателем', 'site/js/sats.js → nextPass()');
algo.push(...steps([
  'От текущего момента идём шагом 30 секунд на 24 часа вперёд.',
  'На каждом шаге считаем угол места спутника для точки наблюдения.',
  'Пролёт — первый момент, когда угол места переходит через 10° снизу вверх. Если спутник уже выше 10° — «сейчас над вами».',
]));

A('Геометрия навигационных спутников (PDOP, HDOP)', 'site/js/sats.js → gnssGeometry()');
algo.push(p('Для каждого спутника GPS выше 5° над горизонтом строится единичный вектор на него в осях восток — север — зенит и строка матрицы геометрии:'),
  eq('e_i = \\cos El_i \\sin Az_i,\\quad n_i = \\cos El_i \\cos Az_i,\\quad u_i = \\sin El_i'),
  eq('\\mathbf{G} = \\begin{pmatrix} -e_1 & -n_1 & -u_1 & 1 \\\\ \\vdots & \\vdots & \\vdots & \\vdots \\\\ -e_N & -n_N & -u_N & 1 \\end{pmatrix}, \\qquad \\mathbf{Q} = \\left(\\mathbf{G}^{T}\\mathbf{G}\\right)^{-1}'),
  eq('\\mathrm{PDOP} = \\sqrt{Q_{11} + Q_{22} + Q_{33}}, \\qquad \\mathrm{HDOP} = \\sqrt{Q_{11} + Q_{22}}'),
  p('Матрица 4×4 обращается методом Гаусса — Жордана с выбором главного элемента. Пороги живого показателя: PDOP ≤ 4 — норма, 4…6 — внимание, больше 6 — тревога.'));

A('Доступность RAIM', 'site/js/sats.js → gnssGeometry(), site/js/security.js');
algo.push(table(['Видимых спутников', 'Что можно', 'Состояние'], [
  ['6 и больше', 'обнаружить сбойный спутник и исключить его', 'норма'],
  ['5', 'только обнаружить сбой', 'внимание'],
  ['меньше 5', 'контроль целостности недоступен', 'тревога'],
], [2600, 4638, 2400]), gap());

A('Фильтр Калмана по геолокации устройства', 'site/js/security.js → kalmanStep()');
algo.push(p('Координаты устройства переводятся в метры от первой точки, и каждая новая точка проходит тест хи-квадрат. Невозможный скачок — признак сбоя или подмены, такая точка в фильтр не принимается.'),
  eq('e = \\Delta\\lambda\\,R_{\\oplus}\\cos\\varphi_0, \\qquad n = \\Delta\\varphi\\,R_{\\oplus}'),
  p('Состояние — положение и скорость, модель — постоянная скорость:'),
  eq('\\mathbf{x} = \\begin{pmatrix} e \\\\ n \\\\ v_e \\\\ v_n \\end{pmatrix}, \\quad \\mathbf{F} = \\begin{pmatrix} 1 & 0 & \\Delta t & 0 \\\\ 0 & 1 & 0 & \\Delta t \\\\ 0 & 0 & 1 & 0 \\\\ 0 & 0 & 0 & 1 \\end{pmatrix}, \\quad \\mathbf{H} = \\begin{pmatrix} 1 & 0 & 0 & 0 \\\\ 0 & 1 & 0 & 0 \\end{pmatrix}'),
  eq('\\mathbf{Q} = q\\begin{pmatrix} \\tfrac{\\Delta t^{4}}{4} & 0 & \\tfrac{\\Delta t^{3}}{2} & 0 \\\\ 0 & \\tfrac{\\Delta t^{4}}{4} & 0 & \\tfrac{\\Delta t^{3}}{2} \\\\ \\tfrac{\\Delta t^{3}}{2} & 0 & \\Delta t^{2} & 0 \\\\ 0 & \\tfrac{\\Delta t^{3}}{2} & 0 & \\Delta t^{2} \\end{pmatrix}, \\quad q = 1\\ \\tfrac{\\text{м}^2}{\\text{с}^4}, \\qquad \\mathbf{R} = \\sigma^{2}\\mathbf{I}'),
  p('σ — точность, которую сообщает сам браузер. Шаг фильтра:'),
  eq('\\begin{aligned} \\hat{\\mathbf{x}}^{-} &= \\mathbf{F}\\hat{\\mathbf{x}}, & \\mathbf{P}^{-} &= \\mathbf{F}\\mathbf{P}\\mathbf{F}^{T} + \\mathbf{Q} \\\\ \\boldsymbol{\\nu} &= \\mathbf{z} - \\mathbf{H}\\hat{\\mathbf{x}}^{-}, & \\mathbf{S} &= \\mathbf{H}\\mathbf{P}^{-}\\mathbf{H}^{T} + \\mathbf{R} \\\\ \\varepsilon &= \\boldsymbol{\\nu}^{T}\\mathbf{S}^{-1}\\boldsymbol{\\nu} \\end{aligned}'),
  eq('\\varepsilon > \\chi^{2}_{2,\\,0{,}999} \\approx 13{,}82 \\;\\Rightarrow\\; \\text{точка аномальна, в фильтр не принимается}'),
  p('Иначе обычное обновление:'),
  eq('\\mathbf{K} = \\mathbf{P}^{-}\\mathbf{H}^{T}\\mathbf{S}^{-1}, \\qquad \\hat{\\mathbf{x}} = \\hat{\\mathbf{x}}^{-} + \\mathbf{K}\\boldsymbol{\\nu}, \\qquad \\mathbf{P} = (\\mathbf{I} - \\mathbf{K}\\mathbf{H})\\,\\mathbf{P}^{-}'));

A('Целостность орбитальных элементов', 'site/js/sats.js → tleChecksumOk(), site/js/security.js → checkTle()');
algo.push(p('Контрольная сумма строки TLE — сумма цифр первых 68 символов плюс единица за каждый минус, по модулю 10; она должна совпасть с 69-м символом:'),
  eq('c = \\Bigl(\\sum_{i=1}^{68} d_i + N_{-}\\Bigr) \\bmod 10'),
  p('Возраст элементов — время с их эпохи. Любая неверная контрольная сумма или медианный возраст больше 7 суток — тревога, больше 3 суток — внимание.'));

A('МКС и Южно-Атлантическая аномалия', 'site/js/sats.js → inSaa(), site/js/security.js → checkSaa()');
algo.push(p('Положение МКС по SGP4 проверяется на попадание в грубый контур области повышенного потока протонов (широта φ, долгота λ в градусах):'),
  eq('\\left(\\frac{\\varphi + 25}{25}\\right)^{2} + \\left(\\frac{\\lambda + 25}{65}\\right)^{2} < 1, \\qquad -50^{\\circ} < \\varphi < 0^{\\circ},\\ \\ -90^{\\circ} < \\lambda < 40^{\\circ}'));

A('Подпись данных ML-DSA-65', 'netlify/lib/signed.mjs, site/js/pq.js → verifySigned(), scripts/make-keys.mjs');
algo.push(...steps([
  'Секретный ключ не хранится: сервер каждый раз выводит пару ключей из 32-байтного зерна LEXI_PQ_SEED (переменная окружения Netlify).',
  'Ответ функции (орбиты, астероиды, индекс Kp) сериализуется в строку payload, и подписывается ровно эта строка.',
  'Браузеру уходит { alg: "ML-DSA-65", kid, payload, sig }. kid — первые 16 hex-символов SHA-256 открытого ключа.',
  'Браузер сверяет kid с опубликованным открытым ключом (site/data/pq-public.json) и проверяет подпись. Нет ключа на сервере — alg: "none", это честно показывается как «нет подписи».',
]));
algo.push(eq('\\mathrm{kid} = \\mathrm{SHA256}(pk)_{[0..16)}, \\qquad \\sigma = \\mathrm{Sign}_{sk}(\\text{payload}), \\qquad \\mathrm{Verify}_{pk}(\\text{payload}, \\sigma) = 1'),
  small('Размеры ML-DSA-65: открытый ключ 1952 байта, подпись 3309 байт.'));

A('Гибридный ключ X25519 + ML-KEM-768', 'site/js/pq.js → hybridHandshake()');
algo.push(...steps([
  'Станция создаёт пару X25519 (a, A = aG) и пару ML-KEM-768 (ключ инкапсуляции ek, ключ декапсуляции dk).',
  'Аппарат создаёт пару X25519 (b, B = bG), инкапсулирует общий секрет под ek и считает классический общий секрет.',
  'Станция декапсулирует шифртекст и считает свой классический секрет.',
  'Обе стороны выводят ключ HKDF-SHA256 из обоих секретов и транскрипта и сверяют результат. Живой показатель проверяет, что ключи совпали, и показывает время в миллисекундах.',
]));
algo.push(eq('(ct,\\ ss_{\\text{KEM}}) = \\mathrm{Encaps}(ek), \\qquad ss_{\\text{KEM}} = \\mathrm{Decaps}(ct,\\ dk), \\qquad ss_{X} = bA = aB'),
  eq('K = \\mathrm{HKDF}_{\\text{SHA-256}}\\bigl(ss_{\\text{KEM}} \\,\\|\\, ss_{X},\\ \\text{info} = \\text{«LEXI hybrid v1»}\\,|\\,A\\,|\\,B\\,|\\,ct_{[0..32)},\\ 32\\ \\text{байта}\\bigr)'));

A('Подавление помехи антенной решёткой (калькулятор MVDR)', 'site/js/formulas.js → mvdrSuppression()');
algo.push(p('Линейная решётка из N элементов с шагом λ/2, шум единичной мощности, одна помеха мощностью J с направления θ_J. Обратная ковариационная матрица — по формуле Шермана — Моррисона, без общего обращения матриц:'),
  eq('a_k(\\theta) = e^{\\,j\\pi k \\sin\\theta}, \\qquad \\mathbf{R} = \\mathbf{I} + J\\,\\mathbf{a}_J\\mathbf{a}_J^{H}, \\qquad \\mathbf{R}^{-1} = \\mathbf{I} - \\frac{J}{1 + JN}\\,\\mathbf{a}_J\\mathbf{a}_J^{H}'),
  eq('\\mathbf{w} = \\frac{\\mathbf{R}^{-1}\\mathbf{a}_s}{\\mathbf{a}_s^{H}\\mathbf{R}^{-1}\\mathbf{a}_s}, \\qquad \\text{подавление} = 10\\lg\\frac{|\\mathbf{w}^{H}\\mathbf{a}_s|^{2}}{|\\mathbf{w}^{H}\\mathbf{a}_J|^{2}}\\ \\text{дБ}'),
  small('Это идеальная модель: на практике ошибки калибровки ограничивают подавление 30–50 дБ, калькулятор так и пишет.'));

A('Квантиль распределения хи-квадрат', 'site/js/formulas.js → chi2Quantile()');
algo.push(p('Порог теста хи-квадрат считается приближением Уилсона — Хилферти (точность лучше 1 % при m ≥ 2), квантиль нормального распределения z — рациональным приближением Акклама:'),
  eq('\\chi^{2}_{m,\\,p} \\approx m\\left(1 - \\frac{2}{9m} + z_p\\sqrt{\\frac{2}{9m}}\\right)^{3}'));

A('Небо над наблюдателем', 'site/js/scene.js, site/js/astro.js');
algo.push(...steps([
  'Звёзды (5070 до 6-й величины, каталог HYG), созвездия и галактики хранятся в системе J2000.',
  'Каждый кадр строится поворот J2000 → горизонт наблюдателя (astronomy-engine, Rotation_EQJ_HOR): ось x смотрит на север, y — на запад, z — в зенит.',
  'Для трёхмерной сцены оси переставляются: X = −y (восток), Y = z (вверх), Z = −x.',
  'Планеты, Солнце и Луна — по эфемеридам astronomy-engine (точность около угловой минуты). Восход и заход звёзд — тем же поиском, звезда регистрируется как пользовательское тело.',
  'Если не нашлось ни восхода, ни захода, объект незаходящий при δ·sign(φ) > 0 и невосходящий иначе.',
]));
algo.push(eq('\\mathbf{r}_{\\text{гор}} = \\mathbf{M}_{\\text{J2000}\\to\\text{гор}}(t,\\ \\varphi,\\ \\lambda)\\;\\mathbf{r}_{\\text{J2000}}, \\qquad h = \\arcsin z, \\quad A = \\operatorname{atan2}(-y,\\ x)'));

A('Цвет и размер звёзд', 'site/js/models.js, site/js/scene.js');
algo.push(p('Температура — по показателю цвета B−V (формула Бальестероса, см. А.6), цвет — как у абсолютно чёрного тела (приближение Таннера Хелланда). Размер точки на экране — от звёздной величины:'),
  eq('s = \\min\\bigl(12,\\ \\max(2,\\ 8{,}6 - 1{,}25\\,m)\\bigr)\\ \\text{пикселей}'));

A('Масштаб Солнечной системы', 'site/js/scene.js');
algo.push(p('Расстояния сжаты, чтобы от Меркурия до Плутона всё помещалось на экране, а направления и порядок сохранялись; размеры планет увеличены:'),
  eq('r_{\\text{сцены}} = 9\\,a^{0{,}55}, \\qquad R_{\\text{сцены}} = 0{,}25 + 0{,}45\\left(\\frac{R}{R_{\\oplus}}\\right)^{0{,}45}'),
  small('a — расстояние от Солнца в астрономических единицах (настоящее, на текущий момент), R — радиус планеты.'));

A('Поиск ответа для LexiAI', 'site/js/db.js → searchKnowledge(), ai/retrieval.py (копия для обучения)');
algo.push(...steps([
  'Вопрос делится на слова от трёх букв, служебные слова отбрасываются («как», «где», «сейчас»…).',
  'Разговорные слова дополняются терминами из таблицы ai_synonyms: «навигатор» → GNSS, спуфинг, глушение; «хакер» → атака, телекоманда.',
  'У длинных слов обрезается окончание, по ним ищется префикс; слова короче четырёх букв ищутся целиком.',
  'Полнотекстовый индекс FTS4 по 1618 фрагментам (модули разрезаны на отдельные пункты). Оценка — ниже. Остаются фрагменты не хуже 45 % от лучшего, не больше четырёх.',
  'Каждый фрагмент обрезается до 700 символов по границе предложения — так весь запрос помещается в окно модели (2048 токенов).',
  'Если ничего не нашлось и нет ни живых данных, ни расчёта, нейросеть не вызывается: LexiAI честно отвечает «не нашёл».',
]));
algo.push(eq('\\text{score} = \\sum_{\\text{слова}}\\ \\sum_{\\text{поля}} k_{\\text{поле}} \\cdot \\min(\\text{совпадений},\\ 3) \\cdot \\ln\\!\\left(1 + \\frac{N}{df}\\right) + 6 \\cdot [\\text{слово в заголовке}]'),
  small('k = 3 для заголовка и 1 для текста, N — число фрагментов, df — в скольких фрагментах встречается слово (редкие слова весят больше).'));

A('Обучение LexiAI', 'ai/build_dataset.py, ai/train.py, ai/export_gguf.py');
algo.push(...steps([
  'Выборка (≈ 2400 примеров, русский и английский) собирается из базы: угрозы, защита, формулы с настоящими расчётами, модули, объекты неба с живыми данными, отказы. Контекст каждого примера — тот же поиск, что на сайте.',
  'Базовая модель Qwen2.5-1.5B-Instruct загружается в 4 битах (NF4), поверх обучаются LoRA-матрицы ранга 16 на всех линейных слоях (18,5 млн параметров из 1,56 млрд).',
  'Одна эпоха, скорость обучения 1·10⁻⁴ с косинусным спадом, батч 1 × накопление 16, длина до 1152 токенов. ≈ 55 минут на RTX 3060 Laptop (6 ГБ).',
  'LoRA склеивается с базой, модель переводится в GGUF и сжимается до Q5_K_M (1,1 ГБ), режется на куски по 95 МБ для браузера.',
  'Итог на 60 отложенных вопросах: 77 % ключевых фактов против 39 % у исходной модели.',
]));
algo.push(p('Потеря считается только по ответу ассистента — вопрос и контекст модель не заучивает:'),
  eq('\\mathcal{L} = -\\frac{1}{|\\mathcal{A}|}\\sum_{t \\in \\mathcal{A}} \\log p_{\\theta}(y_t \\mid y_{<t}), \\qquad W = W_0 + \\frac{\\alpha}{r}\\,BA, \\quad r = 16,\\ \\alpha = 32'));


// Титул
children.push(
  new Paragraph({ spacing: { before: 2400, after: 120 }, children: [new TextRun({ text: 'LEXI · LEXI Space', size: 26, color: GOLD, bold: true, characterSpacing: 40 })] }),
  new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'Формулы и алгоритмы', size: 64, bold: true, color: INK, font: 'Cambria' })] }),
  p(new TextRun({ text: 'Все формулы трёх модулей портала LEXI, формулы из сервера проекта Lexi, астрономические формулы ситуационного центра LEXI Space и алгоритмы, которые реально работают в его коде: орбиты, геометрия GNSS, фильтр Калмана, постквантовая подпись, поиск и обучение LexiAI.', size: 24, color: MUTE }), { spacing: { after: 480, line: 340 } }),
  table(null, [
    ['Формул', String(FORMULAS.length)],
    ['С калькулятором на сайте', String(FORMULAS.filter(f => f.calc).length)],
    ['Алгоритмов в коде LEXI Space', String(aNum)],
    ['Связей «угроза — защита — формула»', String(one('SELECT COUNT(*) AS n FROM links').n)],
    ['Дата', new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })],
  ], [5000, 4638]),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Содержание', font: 'Cambria', size: 36, bold: true })] }),
  new TableOfContents('Содержание', { hyperlink: true, headingStyleRange: '1-2' }),
);

// Как читать
children.push(
  h1('Как устроен документ'),
  p('Формулы разложены по модулям портала LEXI. У каждой — запись, пояснение, таблица параметров со значениями по умолчанию, пример расчёта (посчитан тем же кодом, что работает на сайте) и связи: от какой угрозы защищает, в какой защите используется.'),
  p('Дальше — формулы из сервера проекта Lexi (с исправлениями), астрономические формулы для карточек объектов и алгоритмы LEXI Space: как сайт считает положения спутников, геометрию GNSS, фильтр Калмана по геолокации, проверяет подписи и ищет ответы для LexiAI.'),
  p([b('Где это в коде. '), new TextRun('Формулы и параметры — в базе: '), code('db/seed/01_logic.sql'), new TextRun(' (таблицы formulas, formula_params, links). Калькуляторы — '), code('site/js/formulas.js'), new TextRun('. Алгоритмы — в файлах, указанных в каждом разделе.')]),
);

// Модули
const portalFormulas = FORMULAS.filter(f => f.module_id);
for (const m of MODULES) {
  children.push(h1(`Модуль ${m.num}. ${m.title}`), p(new TextRun({ text: m.lead, italics: true, color: MUTE })));
  let n = 0;
  for (const f of portalFormulas.filter(f => f.module_id === m.id)) children.push(...formulaSection(f, `${m.num}.${++n}`));
  if (m.id === 'module3') {
    children.push(h3(`${m.num}.${++n}. Параметры ML-KEM и ML-DSA (FIPS 203 и FIPS 204)`),
      p('Справочные размеры. В LEXI используются ML-KEM-768 (категория стойкости NIST 3) и ML-DSA-65 — их размеры совпадают с тем, что проверяет сайт.'),
      table(['Схема', 'Параметры', 'Открытый ключ', 'Шифртекст / подпись', 'Общий секрет'], [
        ['ML-KEM-512', 'k = 2, n = 256, q = 3329', '800 Б', '768 Б', '32 Б'],
        ['ML-KEM-768', 'k = 3, n = 256, q = 3329', '1184 Б', '1088 Б', '32 Б'],
        ['ML-KEM-1024', 'k = 4, n = 256, q = 3329', '1568 Б', '1568 Б', '32 Б'],
        ['ML-DSA-44', 'q = 8380417, n = 256', '1312 Б', '2420 Б', '—'],
        ['ML-DSA-65', 'q = 8380417, n = 256', '1952 Б', '3309 Б', '—'],
        ['ML-DSA-87', 'q = 8380417, n = 256', '2592 Б', '4627 Б', '—'],
      ], [1700, 2638, 1700, 2000, 1600]),
      gap());
  }
}

// Гоша и астрономия
children.push(h1('Формулы сервера Lexi и астрономия LEXI Space'),
  h2('Из сервера проекта Lexi (server.py)'),
  p('Формулы класса AstrophysicsCalculator перенесены в LEXI Space. Что исправлено при переносе:'),
  bullet([b('Орбитальная скорость: '), new TextRun('результат умножался на 1000 и назывался км/с — множитель убран.')]),
  bullet([b('Первая космическая: '), new TextRun('расстояние до спутника Земли бралось в астрономических единицах — теперь в километрах.')]),
  bullet([b('Доплер: '), new TextRun('совпадает с формулой модуля 2, используется она.')]),
  bullet([b('Фильтр Калмана GNSS: '), new TextRun('update() возвращала кортеж из одного элемента, а вызывающий код распаковывал его в две переменные — переписан, см. алгоритм 6 ниже.')]),
);
let n = 0;
for (const f of FORMULAS.filter(f => f.origin === 'gosha')) children.push(...formulaSection(f, `Г.${++n}`));
children.push(h2('Для карточек небесных объектов'));
n = 0;
for (const f of FORMULAS.filter(f => f.origin === 'space')) children.push(...formulaSection(f, `А.${++n}`));

children.push(...algo);

// Сводная таблица
children.push(h1('Сводная таблица формул'),
  table(['№', 'Формула', 'Раздел', 'Функция на сайте'],
    FORMULAS.map((f, i) => [String(i + 1), f.title,
      f.module_id ? `Модуль ${MODULES.find(m => m.id === f.module_id).num}` : f.origin === 'gosha' ? 'server.py' : 'Астрономия',
      f.calc ? `${f.calc}()` : '—']),
    [600, 4738, 1700, 2600]));

// ---------------------------------------------------------------------
//  Документ
// ---------------------------------------------------------------------
const doc = new Document({
  creator: 'LEXI Space',
  title: 'LEXI — формулы и алгоритмы',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22, color: INK } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: 'Cambria', size: 36, bold: true, color: INK }, paragraph: { spacing: { before: 0, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: 'Cambria', size: 28, bold: true, color: GOLD }, paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 1, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: 'Calibri', size: 24, bold: true, color: GOLD }, paragraph: { spacing: { before: 320, after: 80 }, outlineLevel: 2, keepNext: true } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
      ...numberingConfigs,
    ],
  },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'LEXI · формулы и алгоритмы', size: 17, color: MUTE })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: MUTE })] })] }) },
    children,
  }],
});

// ---------------------------------------------------------------------
//  Формулы: LaTeX → MathML → OMML
// ---------------------------------------------------------------------
const tmp = join(tmpdir(), 'lexi-eq');
mkdirSync(tmp, { recursive: true });
// KaTeX пишет скобки \left( … \right) и pmatrix как <mo fence> по краям <mrow>, а пробелы \quad — как <mspace>.
// Конвертер Word растягивает только <mfenced> и пропускает <mspace>, поэтому переводим одно в другое.
function prepareMathML(xml) {
  const docm = new DOMParser().parseFromString(xml, 'application/xml');
  const kids = el => Array.from(el.childNodes).filter(n => n.nodeType === 1);
  const isFence = el => el && el.tagName === 'mo' && el.getAttribute('fence') === 'true';
  const mrows = Array.from(docm.getElementsByTagName('mrow')).reverse();   // сначала самые вложенные
  for (const row of mrows) {
    const c = kids(row);
    if (c.length >= 2 && isFence(c[0]) && isFence(c[c.length - 1])) {
      const f = docm.createElement('mfenced');
      f.setAttribute('open', c[0].textContent);
      f.setAttribute('close', c[c.length - 1].textContent);
      f.setAttribute('separators', '');
      const inner = docm.createElement('mrow');
      c.slice(1, -1).forEach(n => inner.appendChild(n));
      f.appendChild(inner);
      row.parentNode.replaceChild(f, row);
    }
  }
  for (const sp of Array.from(docm.getElementsByTagName('mspace'))) {
    const em = parseFloat(sp.getAttribute('width') || '0');
    if (em <= 0) { sp.parentNode.removeChild(sp); continue; }
    const t = docm.createElement('mtext');
    t.appendChild(docm.createTextNode(em >= 1.5 ? '  ' : em >= 0.8 ? ' ' : em >= 0.25 ? ' ' : ' '));
    sp.parentNode.replaceChild(t, sp);
  }
  return new XMLSerializer().serializeToString(docm);
}

const mathml = equations.map(e => {
  let m = katex.renderToString(e.tex, { output: 'mathml', displayMode: !e.inline, throwOnError: true, strict: 'ignore' });
  m = m.slice(m.indexOf('<math'), m.lastIndexOf('</math>') + 7)
    .replace(/<annotation[\s\S]*?<\/annotation>/g, '').replace(/<\/?semantics>/g, '')
    .replace(/&nbsp;/g, '&#160;');
  return { id: e.id, xml: prepareMathML(m) };
});
writeFileSync(join(tmp, 'in.json'), JSON.stringify(mathml));
const ps = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/mml2omml.ps1'),
  '-In', join(tmp, 'in.json'), '-Out', join(tmp, 'out.json')], { encoding: 'utf8' });
if (ps.status !== 0) throw new Error('mml2omml: ' + ps.stderr);
const omml = Object.fromEntries([].concat(JSON.parse(readFileSync(join(tmp, 'out.json'), 'utf8').replace(/^﻿/, '')))
  .map(o => [o.id, o.xml.replace(/ xmlns:(m|mml)="[^"]*"/g, '')]));

const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
let xml = await zip.file('word/document.xml').async('string');
// Формула отдельной строкой: весь абзац-заглушка → абзац с <m:oMathPara>
xml = xml.replace(/<w:p>((?:(?!<w:p[ >]).)*?)⟦EQ:(\d+)⟧(.*?)<\/w:p>/gs, (_, before, id) => {
  const pPr = (before.match(/<w:pPr>.*?<\/w:pPr>/s) || [''])[0];
  return `<w:p>${pPr}<m:oMathPara>${omml[id]}</m:oMathPara></w:p>`;
});
// Формула внутри строки (таблицы параметров): только прогон-заглушка → <m:oMath>
xml = xml.replace(/<w:r>(?:(?!<w:r>).)*?⟦IEQ:(\d+)⟧.*?<\/w:r>/gs, (_, id) => omml[id]);
if (/⟦I?EQ:/.test(xml)) throw new Error('остались незаменённые формулы');
if (!/xmlns:m=/.test(xml.slice(0, 2000))) throw new Error('в document.xml нет пространства имён m');
zip.file('word/document.xml', xml);

mkdirSync('docs', { recursive: true });
writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Готово: ${OUT} — ${equations.length} формул, ${FORMULAS.length} из базы, ${aNum} алгоритмов`);

// LexiAI — ассистент LEXI Space.
//
// Работает в два слоя:
//   1. База знаний: поиск по фрагментам из lexi.sqlite, живые данные объектов и калькуляторы формул.
//      Это доступно сразу и без нейросети.
//   2. Нейросеть: модель, дообученная на наших модулях, угрозах, формулах и каталогах
//      (см. папку ai/), запускается прямо в браузере через llama.cpp → WebAssembly (wllama).
//      Ей в запрос подкладываются те же найденные фрагменты, живые данные и результат расчёта,
//      поэтому числа она не выдумывает, а объясняет.
//
// Формат запроса к модели совпадает с тем, на котором она обучалась (ai/prompt.py) — менять синхронно.

import * as db from './db.js';
import { t, lang, num, unit } from './i18n.js';
import { runFormula } from './formulas.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- Системная инструкция: та же, что в ai/prompt.py ---
export const SYSTEM = {
  ru: 'Ты — LexiAI, ассистент ситуационного центра LEXI Space. Отвечай по-русски, коротко и по делу, человеческим языком. Опирайся только на контекст: фрагменты базы LEXI, живые данные и результаты расчётов. Числа бери из контекста и не выдумывай. Если в контексте ответа нет — честно скажи об этом.',
  en: 'You are LexiAI, the assistant of the LEXI Space situation center. Answer in English, briefly and to the point, in plain human language. Rely only on the context: LEXI knowledge-base fragments, live data and calculation results. Take numbers from the context and never invent them. If the context has no answer, say so honestly.',
};

// Обрезка фрагмента по границе предложения — так же, как clip() в ai/prompt.py:
// 4 фрагмента + вопрос должны поместиться в окно модели (2048 токенов)
const CLIP = 700;
export function clip(text, limit = CLIP) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(...['. ', '.\n', '; ', '!\n', '?\n'].map(m => cut.lastIndexOf(m)));
  if (end > limit * 0.5) return cut.slice(0, end + 1).trimEnd() + ' …';
  return cut.slice(0, cut.lastIndexOf(' ')).trimEnd() + ' …';
}

export function buildUserMessage(question, chunks, live, calc, L = lang) {
  const ru = L === 'ru';
  const parts = [];
  if (chunks.length) parts.push((ru ? 'Контекст:\n' : 'Context:\n') + chunks.map((c, i) => `[${i + 1}] ${c.title}: ${clip(c.body)}`).join('\n'));
  if (live) parts.push((ru ? 'Данные сейчас: ' : 'Live data: ') + live);
  if (calc) parts.push((ru ? 'Расчёт: ' : 'Calculation: ') + calc);
  parts.push((ru ? 'Вопрос: ' : 'Question: ') + question);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------
//  Распознавание расчёта: какая формула и какие числа
// ---------------------------------------------------------------------
// Ключевые слова → формула. Числа из вопроса раскладываются по параметрам по порядку.
const CALC_HINTS = [
  [/моск|mosca/i, 'f_mosca'],
  [/фриис|friis|перехват|intercept/i, 'f_friis'],
  [/доплер|doppler/i, 'f_doppler'],
  [/c\/n0|с\/n0|несущая.?шум|carrier.?to.?noise|глушени|jamm/i, 'f_cn0_eff'],
  [/тепл\w* шум|thermal noise|\bkt\b/i, 'f_noise'],
  [/mvdr|stap|решётк|решетк|array|нул/i, 'f_mvdr'],
  [/хи.?квадрат|chi.?square|χ²|невязк|innovation/i, 'f_chi2'],
  [/vis.?viva|вис.?вива/i, 'f_visviva'],
  [/период|period/i, 'f_period'],
  [/релятив|relativ|часы gps|gps clock/i, 'f_relativity'],
  [/троир|tmr/i, 'f_tmr'],
  [/сбо\w+ памят|seu|одиночн\w+ сбо|single.?event/i, 'f_seu'],
  [/подделк|forg|mac/i, 'f_forge'],
  [/гровер|grover/i, 'f_grover'],
  [/шор|shor/i, 'f_shor'],
  [/гибридн\w+ ключ|hybrid key|x25519/i, 'f_hybrid'],
  [/втор\w+ космическ|escape velocity|убегани/i, 'f_escape'],
  [/кеплер|kepler/i, 'f_kepler3'],
  [/хаббл|hubble/i, 'f_hubble'],
  [/светимост|luminosit/i, 'f_luminosity'],
  [/абсолютн\w+ величин|absolute magnitude/i, 'f_abs_mag'],
  [/температур\w+ звезд|star temperature|b.?v/i, 'f_star_temp'],
  [/орбитальн\w+ скорост|orbital (speed|velocity)/i, 'f_orbital_velocity'],
  [/перв\w+ космическ|circular (speed|velocity)/i, 'f_circular_velocity'],
];
const WANTS_CALC = /посчит|рассчит|вычисл|сколько|calculate|compute|how (much|many)|\d/i;

export function detectCalc(q) {
  if (!WANTS_CALC.test(q)) return null;
  const hit = CALC_HINTS.find(([re]) => re.test(q));
  if (!hit) return null;
  const f = db.formula(hit[1]);
  if (!f?.calc) return null;
  const params = db.formulaParams(f.id);
  const numbers = (q.replace(/(\d),(\d)/g, '$1.$2').match(/-?\d+(\.\d+)?(e-?\d+)?/gi) || []).map(Number);
  const values = Object.fromEntries(params.map((p, i) => [p.name, numbers[i] ?? p.def]));
  const r = runFormula(f.calc, values);
  if (!r) return null;
  const used = params.map(p => `${p.symbol.replace(/\\/g, '')}=${num(values[p.name], 6)}${p.unit ? ' ' + unit(p.unit) : ''}`).join(', ');
  return { formula: f, values, result: r, text: `${f.title} (${used}): ${r.lines.join('; ')}` };
}

// ---------------------------------------------------------------------
//  Нейросеть в браузере
// ---------------------------------------------------------------------
let wllama = null, modelInfo = null;
let modelState = 'off';   // off | downloading | downloaded | loading | ready | missing | failed
let progress = 0;
const modelListeners = [];
const emit = () => modelListeners.forEach(fn => fn(modelState, progress));

async function loadModelInfo() {
  try {
    const r = await fetch('data/ai-model.json');
    if (r.ok) modelInfo = await r.json();
  } catch { /* нет файла — работаем без нейросети */ }
  return modelInfo;
}

// ---------------------------------------------------------------------
//  Загрузка модели с докачкой
//
//  Каждый кусок модели качается частями по 8 МБ (HTTP Range), и каждая часть
//  сразу ложится в Cache Storage браузера. Оборвалась связь, закрыли вкладку,
//  перезагрузили страницу — при следующем запуске докачиваются только недостающие части.
//  Потом wllama получает собранные из кэша файлы — они лежат на диске, а не в памяти.
// ---------------------------------------------------------------------
const MODEL_CACHE = 'lexiai-model';
const PIECE = 8 * 1024 * 1024;
const WANT_KEY = 'lexi-ai-want';          // человек включал нейросеть — докачиваем и запускаем сами
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};
const cacheName = () => `${MODEL_CACHE}:${modelInfo.release?.tag || modelInfo.trained}`;
const pieceKey = (url, i) => `${url}?piece=${i}`;

function modelParts() {
  // Имена и размеры кусков — из ai-model.json
  const base = new URL(modelInfo.url, location.href);
  const files = modelInfo.release?.files || [{ name: base.pathname.split('/').pop(), size: 0 }];
  return files.map(f => ({ url: new URL(f.name, base).href, size: f.size }));
}
const totalSize = () => modelParts().reduce((a, p) => a + p.size, 0);

// Одна часть куска: из кэша или из сети, с повторами при обрыве
async function getPiece(part, i, cache, tick) {
  const key = pieceKey(part.url, i);
  const from = i * PIECE, to = Math.min(part.size, from + PIECE) - 1, len = to - from + 1;
  const hit = await cache.match(key);
  if (hit) {
    const blob = await hit.blob();
    if (blob.size === len) { tick(len); return blob; }
    await cache.delete(key);
  }
  for (let attempt = 1; ; attempt++) {
    let got = 0;
    try {
      const res = await fetch(part.url, { headers: { Range: `bytes=${from}-${to}` }, cache: 'no-store' });
      if (res.status === 200) return await wholePart(part, i, res, cache, tick);   // сервер не умеет Range
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length; tick(value.length);
      }
      if (got !== len) throw new Error('обрыв связи');
      await cache.put(key, new Response(new Blob(chunks)));
      return await (await cache.match(key)).blob();     // копия с диска, а не из памяти
    } catch (e) {
      tick(-got);                                         // недокачанное не считаем в прогрессе
      if (attempt >= 6) throw new Error(`${part.url.split('/').pop()}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

// Запасной путь для сервера без Range: берём кусок целиком и раскладываем по частям в кэш
async function wholePart(part, i, res, cache, tick) {
  const blob = await new Response(res.body.pipeThrough(new TransformStream({ transform(c, ctl) { tick(c.byteLength); ctl.enqueue(c); } }))).blob();
  if (part.size && blob.size !== part.size) { tick(-blob.size); throw new Error('обрыв связи'); }
  for (let k = 0; k < Math.ceil(part.size / PIECE); k++) {
    await cache.put(pieceKey(part.url, k), new Response(blob.slice(k * PIECE, Math.min(part.size, (k + 1) * PIECE))));
  }
  // В прогрессе оставляем только часть i — следующие части посчитаются, когда их возьмут из кэша
  const piece = await (await cache.match(pieceKey(part.url, i))).blob();
  tick(piece.size - blob.size);
  return piece;
}

async function downloadModel() {
  const cache = await caches.open(cacheName());
  // Старые версии модели из кэша убираем, чтобы не занимали место
  caches.keys().then(keys => keys.filter(k => k.startsWith(MODEL_CACHE) && k !== cacheName()).forEach(k => caches.delete(k))).catch(() => {});
  // Просим браузер не вычищать кэш при нехватке места
  navigator.storage?.persist?.().catch(() => {});

  const parts = modelParts(), total = totalSize() || 1;
  let loaded = 0;
  const tick = n => { loaded += n; progress = Math.max(0, Math.min(loaded / total, 1)); emit(); };
  const files = new Array(parts.length);
  let next = 0;
  // Три куска параллельно, внутри куска части по порядку
  const worker = async () => {
    while (next < parts.length) {
      const k = next++, part = parts[k];
      const pieces = [];
      for (let i = 0; i < Math.ceil(part.size / PIECE); i++) pieces.push(await getPiece(part, i, cache, tick));
      files[k] = new Blob(pieces);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return files;
}

// Сколько уже скачано (для подписи «скачано 40 %» и решения, докачивать ли в фоне)
async function cachedShare() {
  try {
    const cache = await caches.open(cacheName());
    const keys = new Set((await cache.keys()).map(r => r.url));
    let have = 0;
    for (const part of modelParts()) {
      for (let i = 0; i < Math.ceil(part.size / PIECE); i++) {
        if (keys.has(pieceKey(part.url, i))) have += Math.min(PIECE, part.size - i * PIECE);
      }
    }
    return have / (totalSize() || 1);
  } catch { return 0; }
}

let job = null;
// Скачать (докачать) и, если нужно, запустить. Повторные вызовы ждут ту же работу.
function startModel({ run = true } = {}) {
  if (!modelInfo?.url) { modelState = 'missing'; emit(); return Promise.resolve(); }
  store.set(WANT_KEY, '1');
  job ??= (async () => {
    if (modelState !== 'downloaded') { modelState = 'downloading'; emit(); }
    const files = await downloadModel();
    if (modelState === 'downloading') { modelState = 'downloaded'; progress = 1; emit(); }
    return files;
  })().catch(e => { job = null; modelState = 'failed'; emit(); throw e; });
  return run ? job.then(runModel) : job.then(() => {});
}

async function runModel(files) {
  if (modelState === 'ready' || modelState === 'loading') return;
  modelState = 'loading'; emit();
  try {
    const { Wllama } = await import('../vendor/wllama/index.js');
    wllama = new Wllama({
      'single-thread/wllama.wasm': new URL('../vendor/wllama/single-thread/wllama.wasm', import.meta.url).href,
      'multi-thread/wllama.wasm': new URL('../vendor/wllama/multi-thread/wllama.wasm', import.meta.url).href,
    });
    // n_batch 512: рабочий буфер ≈ 80 МБ вместо 320 — иначе вкладке может не хватить памяти
    await wllama.loadModel(files, { n_ctx: 2048, n_batch: 512 });
    modelState = 'ready'; emit();
  } catch (e) {
    job = null;
    modelState = 'failed'; emit();
    throw e;
  }
}

// Хватит ли устройству памяти: модели нужно ≈ 2 ГБ оперативной памяти
export const lowMemory = () => (navigator.deviceMemory && navigator.deviceMemory < 4);

async function generate(messages, onText, signal) {
  return wllama.createChatCompletion(messages, {
    nPredict: 320,
    sampling: { temp: 0.1, top_k: 40, top_p: 0.9, penalty_repeat: 1.1 },   // низкая температура — меньше фантазии
    onNewToken: (_token, _piece, text) => onText(text),
    abortSignal: signal,
  });
}

// ---------------------------------------------------------------------
//  Ответ по базе знаний (без нейросети)
// ---------------------------------------------------------------------
function liteAnswer(question, chunks, live, calc) {
  const ru = lang === 'ru';
  const out = [];
  if (live) out.push(live);
  if (calc) out.push(`${t('ai.calcDone', { f: calc.formula.title })}\n${calc.result.lines.join('\n')}`);
  if (chunks.length && !(calc && !live && chunks[0].kind === 'formula')) {
    const top = chunks[0];
    // Первый фрагмент — основной ответ; из второго, если он о другом, — одна строка «см. также»
    out.push(top.body.length > 700 ? top.body.slice(0, 700).replace(/\s\S*$/, '') + '…' : top.body);
    // звёзды и галактики в «см. также» — только если и спрашивали про небо (иначе «переменная» тянет «переменную звезду»)
    const sky = k => k === 'star' || k === 'deep_sky';
    const also = chunks.slice(1, 3).filter(c => c.ref_id !== top.ref_id && (!sky(c.kind) || sky(top.kind))).map(c => c.title);
    if (also.length) out.push((ru ? 'См. также: ' : 'See also: ') + also.join('; ') + '.');
  }
  return out.join('\n\n') || t('ai.nothing');
}

// ---------------------------------------------------------------------
//  Окно чата
// ---------------------------------------------------------------------
export function initLexiAI({ findObject, liveSummary, openRef }) {
  const box = $('#ai'), log = $('#ai-log'), form = $('#ai-form'), input = $('#ai-input'), fab = $('#ai-open');
  const modelBox = $('#ai-model'), modeEl = $('#ai-mode'), hints = $('#ai-hints');
  const history = [];
  let busy = false, controller = null;

  const setMode = () => {
    modeEl.textContent = modelState === 'ready' ? t('ai.modeLLM', { m: modelInfo?.name || 'LexiAI' }) : t('ai.modeLite');
  };
  let lastError = '';
  const sizeText = () => modelInfo.sizeMB >= 1000 ? `${(modelInfo.sizeMB / 1024).toFixed(1)} ${lang === 'ru' ? 'ГБ' : 'GB'}` : `${modelInfo.sizeMB} ${lang === 'ru' ? 'МБ' : 'MB'}`;
  const bar = p => `<div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div>`;
  const renderModelBox = () => {
    if (!modelInfo?.url) { modelBox.innerHTML = esc(t('ai.noModel')); return; }
    if (modelState === 'ready') { modelBox.innerHTML = ''; return; }
    if (modelState === 'downloading') { modelBox.innerHTML = `${t('ai.downloading', { p: Math.floor(progress * 100) })}${bar(progress)}<span class="note">${esc(t('ai.resumeNote'))}</span>`; return; }
    if (modelState === 'loading') { modelBox.innerHTML = `${t('ai.starting')}${bar(1)}`; return; }
    const failed = modelState === 'failed', ready = modelState === 'downloaded';
    modelBox.innerHTML = `${failed ? `<span class="lowmem">${esc(t('ai.loadFail', { e: lastError }))}</span>`
        : ready ? esc(t('ai.cached')) : `${esc(t('ai.loadTitle'))} ${esc(t('ai.size', { s: sizeText() }))}`}
      ${lowMemory() ? `<span class="lowmem">${esc(t('ai.lowmem'))}</span>` : ''}
      ${progress > 0 && progress < 1 ? `<span class="note">${esc(t('ai.partial', { p: Math.floor(progress * 100) }))}</span>` : ''}
      <p style="margin:.6rem 0 0"><button type="button" class="btn-line sm" id="ai-load">${failed ? t('ai.retry') : ready ? t('ai.load') : progress > 0 ? t('ai.resume') : t('ai.load')}</button></p>`;
    $('#ai-load').onclick = e => { e.currentTarget.disabled = true; launch(true); };
  };
  // Запуск с обработкой ошибок; run — сразу загрузить в память после скачивания
  const launch = run => startModel({ run }).catch(e => {
    // Нехватка памяти выглядит в браузерах по-разному — подсказываем, что делать
    lastError = /allocation|memory|network error|Aborted/i.test(e.message) ? t('ai.memHint') : e.message;
    renderModelBox();
  });

  // Прогресс — в окне чата и кольцом на кнопке LexiAI
  modelListeners.push((state, p) => {
    fab.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
    fab.classList.toggle('busy', state === 'downloading' || state === 'loading');
    if (!box.hidden) { renderModelBox(); setMode(); }
    // докачалось в фоне, а чат открыт — сразу запускаем
    if (state === 'downloaded' && !box.hidden && store.get(WANT_KEY)) setTimeout(() => launch(true));
  });

  const renderHints = () => {
    hints.innerHTML = [1, 2, 3, 4].map(i => `<button type="button" class="chip">${esc(t('ai.hint' + i))}</button>`).join('');
  };
  hints.addEventListener('click', e => { const b = e.target.closest('button'); if (b) ask(b.textContent); });

  const add = (cls, html) => {
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = html;
    log.append(li);
    log.scrollTop = log.scrollHeight;
    return li;
  };

  function open() {
    box.hidden = false; fab.hidden = true; fab.setAttribute('aria-expanded', 'true');
    if (!log.children.length) add('bot', esc(t('ai.hello')));
    setMode(); renderModelBox(); renderHints();
    // нейросеть уже включали и она скачана — запускаем без лишнего нажатия
    if (modelState === 'downloaded' && store.get(WANT_KEY)) launch(true);
    setTimeout(() => input.focus(), 50);
  }
  function close() { box.hidden = true; fab.hidden = false; fab.setAttribute('aria-expanded', 'false'); controller?.abort(); }
  fab.addEventListener('click', open);
  $('#ai-close').addEventListener('click', close);

  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', e => { e.preventDefault(); const q = input.value.trim(); if (q) { input.value = ''; input.style.height = 'auto'; ask(q); } });

  async function ask(question) {
    if (busy) return;
    busy = true;
    hints.innerHTML = '';
    add('me', esc(question));

    // 1. Что нашлось в базе, какой объект упомянут, нужен ли расчёт
    const obj = findObject(question);
    const live = obj ? liveSummary(obj) : null;
    const calc = detectCalc(question);
    let chunks = db.searchKnowledge(question, 5);
    if (calc) {
      // расчёт найден — первым идёт фрагмент о самой формуле
      const f = db.all("SELECT * FROM ai_knowledge WHERE lang = ? AND kind = 'formula' AND ref_id = ?", [lang, calc.formula.id]);
      chunks = [...f, ...chunks.filter(c => c.ref_id !== calc.formula.id && c.kind !== 'deep_sky' && c.kind !== 'star')].slice(0, 5);
    }
    if (obj?.knowledgeTitle) {
      const exact = db.all('SELECT * FROM ai_knowledge WHERE lang = ? AND title = ? LIMIT 1', [lang, obj.knowledgeTitle]);
      chunks = [...exact, ...chunks.filter(c => c.id !== exact[0]?.id)].slice(0, 5);
    }

    const sources = chunks.slice(0, 3).map(c => `<button type="button" data-open="${c.kind}:${esc(c.ref_id)}">${esc(c.title)}</button>`).join(', ');
    const tail = (sources ? `<span class="src">${t('ai.sources')}: ${sources}</span>` : '')
      + (obj ? `<span class="src"><button type="button" data-open-ref>${esc(obj.label)} →</button></span>` : '');

    const li = add('bot typing', '');
    const finish = (text) => {
      li.classList.remove('typing');
      li.innerHTML = esc(text) + tail;
      const btn = li.querySelector('[data-open-ref]');
      if (btn && obj) btn.onclick = () => openRef(obj.ref);
      log.scrollTop = log.scrollHeight;
    };

    // 2. Ответ: нейросетью, если она загружена, иначе — из базы.
    //    В базе ничего не нашлось — нейросеть не спрашиваем: без контекста маленькая модель начнёт сочинять.
    if (!chunks.length && !live && !calc) {
      await new Promise(r => setTimeout(r, 250));
      finish(t('ai.nothing'));
    } else if (modelState === 'ready') {
      const messages = [
        { role: 'system', content: SYSTEM[lang] },
        ...history.slice(-4),
        { role: 'user', content: buildUserMessage(question, chunks.slice(0, 4), live, calc?.text) },
      ];
      controller = new AbortController();
      try {
        const text = await generate(messages, partial => { li.textContent = partial; log.scrollTop = log.scrollHeight; }, controller.signal);
        // Модель обучена пересказывать расчёт. Если главного числа в ответе нет — покажем расчёт сами.
        const key = calc?.result.lines[0].match(/-?\d+(?:[.,]\d+)?/)?.[0];
        const answer = (calc && key && !text.includes(key) ? `${calc.result.lines.join('\n')}\n\n` : '') + text.trim();
        finish(answer);
        history.push({ role: 'user', content: question }, { role: 'assistant', content: text.trim() });
      } catch (e) {
        finish(liteAnswer(question, chunks, live, calc));
      }
    } else {
      await new Promise(r => setTimeout(r, 250));     // чтобы ответ не «выпрыгивал» мгновенно
      finish(liteAnswer(question, chunks, live, calc));
    }
    busy = false;
  }

  // При открытии сайта: если нейросеть уже включали — докачиваем недостающее в фоне
  loadModelInfo().then(async () => {
    if (!modelInfo?.url) return;
    progress = await cachedShare();
    if (progress >= 1) { modelState = 'downloaded'; emit(); }
    else if (store.get(WANT_KEY) && !lowMemory()) setTimeout(() => launch(false), 3000);
    if (!box.hidden) renderModelBox();
  });

  return { open, ask: q => { open(); ask(q); }, refresh: () => { setMode(); if (!box.hidden) { renderModelBox(); renderHints(); } } };
}

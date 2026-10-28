// =====================================================================
//  LexiAI в мессенджере — тот же ассистент, что в LEXI Space.
//
//  1. База знаний: data/lexi.sqlite из LEXI Space (sql.js), полнотекстовый
//     поиск по ~1600 фрагментам. Работает сразу.
//  2. Нейросеть: LexiAI 1.5B (Qwen2.5, дообучена на базе LEXI) через wllama.
//     Скачивается по кнопке. Кэш и имена частей совпадают с LEXI Space,
//     поэтому если модель уже скачана на сайте LEXI Space, второй раз она не качается.
//
//  Формат запроса совпадает с site/js/lexiai.js и ai/prompt.py — менять синхронно.
// =====================================================================

import { getLang } from './i18n.js';

const SPACE = p => import.meta.resolve('lexi-space/' + p);

export const SYSTEM = {
  ru: 'Ты — LexiAI, ассистент ситуационного центра LEXI Space. Отвечай по-русски, коротко и по делу, человеческим языком. Опирайся только на контекст: фрагменты базы LEXI, живые данные и результаты расчётов. Числа бери из контекста и не выдумывай. Если в контексте ответа нет — честно скажи об этом.',
  en: 'You are LexiAI, the assistant of the LEXI Space situation center. Answer in English, briefly and to the point, in plain human language. Rely only on the context: LEXI knowledge-base fragments, live data and calculation results. Take numbers from the context and never invent them. If the context has no answer, say so honestly.',
};

const CLIP = 700;
function clip(text, limit = CLIP) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(...['. ', '.\n', '; ', '!\n', '?\n'].map(m => cut.lastIndexOf(m)));
  if (end > limit * 0.5) return cut.slice(0, end + 1).trimEnd() + ' …';
  return cut.slice(0, cut.lastIndexOf(' ')).trimEnd() + ' …';
}
function buildUserMessage(question, chunks, live, calc, ru) {
  const parts = [];
  if (chunks.length) parts.push((ru ? 'Контекст:\n' : 'Context:\n') + chunks.map((c, i) => `[${i + 1}] ${c.title}: ${clip(c.body)}`).join('\n'));
  if (live) parts.push((ru ? 'Данные сейчас: ' : 'Live data: ') + live);
  if (calc) parts.push((ru ? 'Расчёт: ' : 'Calculation: ') + calc);
  parts.push((ru ? 'Вопрос: ' : 'Question: ') + question);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------
//  База знаний
// ---------------------------------------------------------------------
let db = null, dbJob = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.initSqlJs) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('sql.js'));
    document.head.append(s);
  });
}
export function openKnowledge() {
  dbJob ??= (async () => {
    await loadScript(SPACE('vendor/sql-wasm.js'));
    const [SQL, buf] = await Promise.all([
      window.initSqlJs({ locateFile: f => SPACE('vendor/' + f) }),
      fetch(SPACE('data/lexi.sqlite')).then(r => { if (!r.ok) throw new Error('lexi.sqlite ' + r.status); return r.arrayBuffer(); }),
    ]);
    db = new SQL.Database(new Uint8Array(buf));
    return true;
  })().catch(e => { dbJob = null; throw e; });
  return dbJob;
}
function all(sql, params = []) {
  const st = db.prepare(sql); st.bind(params);
  const rows = []; while (st.step()) rows.push(st.getAsObject());
  st.free(); return rows;
}

const STOP = new Set(('один два три четыре пять как что где когда сейчас такое это для про под над при или ли чем чего кто какой какая какие сколько можно нужно ' +
  'расскажи покажи посчитай рассчитай объясни скажи лет год года раз мне нам вас есть был была будет ' +
  'the what where when how is are of for to in on and or now tell me about show calculate explain does do why which with').split(' '));
const synCache = {};
function expand(words, lang) {
  const syn = synCache[lang] ??= all('SELECT word, terms FROM ai_synonyms WHERE lang = ?', [lang]);
  const extra = [];
  for (const w of words) for (const s of syn) if (w.startsWith(s.word)) extra.push(...(s.terms.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []));
  return extra;
}
function scoreMatch(mi, title, words) {
  const m = new Uint32Array(mi.buffer ? mi.buffer.slice(mi.byteOffset, mi.byteOffset + mi.byteLength) : mi);
  const phrases = m[0], cols = m[1], total = m[2];
  let s = 0;
  for (let p = 0; p < phrases; p++) for (let c = 0; c < cols; c++) {
    const i = 3 + 3 * (p * cols + c), hits = m[i], docs = m[i + 2];
    if (hits) s += (c === 0 ? 3 : 1) * Math.min(hits, 3) * Math.log(1 + total / Math.max(docs, 1));
  }
  const tl = title.toLowerCase();
  for (const w of words) if (tl.includes(w.slice(0, 5))) s += 6;
  return s;
}
export function searchKnowledge(query, limit = 5) {
  if (!db) return [];
  const lang = getLang();
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(w => !STOP.has(w) && !/^\d+$/.test(w));
  if (!words.length) return [];
  const stem = w => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 2)) : w);
  const terms = [...new Set([...words, ...expand(words, lang)])];
  const match = terms.map(w => (w.length >= 4 ? `${stem(w)}*` : w)).join(' OR ');
  try {
    return all(`SELECT k.*, matchinfo(ai_search, 'pcnx') AS mi FROM ai_search s JOIN ai_knowledge k ON k.id = s.rowid
                WHERE ai_search MATCH ? AND k.lang = ?`, [match, lang])
      .map(r => ({ ...r, score: scoreMatch(r.mi, r.title, terms) }))
      .sort((a, b) => b.score - a.score)
      .filter((r, i, arr) => r.score >= arr[0].score * 0.45)
      .slice(0, limit);
  } catch { return []; }
}

// ---------------------------------------------------------------------
//  Нейросеть (логика докачки — как в LEXI Space)
// ---------------------------------------------------------------------
let wllama = null, info = null;
export const model = { state: 'off', progress: 0, name: 'LexiAI', sizeMB: 0 };
const subs = new Set();
const emit = () => subs.forEach(f => f(model));
export const onModel = f => { subs.add(f); return () => subs.delete(f); };

// Файлы нейросети лежат на сайте LEXI Space (Netlify скачивает их из релиза GitHub при сборке).
// Мессенджер — отдельный сайт, поэтому берёт их оттуда, а не держит вторую копию в 1,1 ГБ.
const MODEL_HOST = 'https://lexi-space.netlify.app/';
const MODEL_CACHE = 'lexiai-model', PIECE = 8 * 1024 * 1024, WANT_KEY = 'lexi-ai-want';
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const cacheName = () => `${MODEL_CACHE}:${info.release?.tag || info.trained}`;
const pieceKey = (url, i) => `${url}?piece=${i}`;
function parts() {
  const base = new URL(info.url, MODEL_HOST);
  const files = info.release?.files || [{ name: base.pathname.split('/').pop(), size: 0 }];
  return files.map(f => ({ url: new URL(f.name, base).href, size: f.size }));
}
const total = () => parts().reduce((a, p) => a + p.size, 0);

export async function initModel() {
  // описание модели — с LEXI Space, чтобы версия всегда совпадала с файлами там; если сайт недоступен — своя копия
  for (const url of [MODEL_HOST + 'data/ai-model.json', SPACE('data/ai-model.json')]) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (r.ok) { info = await r.json(); break; }
    } catch {}
  }
  if (!info?.url) { model.state = 'missing'; emit(); return model; }
  model.name = info.name; model.sizeMB = info.sizeMB;
  // файлы модели лежат на сайте LEXI Space; если он недоступен — скажем честно
  try {
    const h = await fetch(parts()[0].url, { method: 'HEAD' });
    if (!h.ok) throw 0;
  } catch { model.state = 'missing'; emit(); return model; }
  model.progress = await cachedShare();
  if (model.progress >= 1) model.state = 'downloaded';
  emit();
  if (ls.get(WANT_KEY) && !lowMemory()) setTimeout(() => startModel().catch(() => {}), 3000);
  return model;
}
export const lowMemory = () => (navigator.deviceMemory && navigator.deviceMemory < 4);

async function cachedShare() {
  try {
    const cache = await caches.open(cacheName());
    const keys = new Set((await cache.keys()).map(r => r.url));
    let have = 0;
    for (const p of parts()) for (let i = 0; i < Math.ceil(p.size / PIECE); i++) if (keys.has(pieceKey(p.url, i))) have += Math.min(PIECE, p.size - i * PIECE);
    return have / (total() || 1);
  } catch { return 0; }
}

async function getPiece(part, i, cache, tick) {
  const key = pieceKey(part.url, i);
  const from = i * PIECE, to = Math.min(part.size, from + PIECE) - 1, len = to - from + 1;
  const hit = await cache.match(key);
  if (hit) { const b = await hit.blob(); if (b.size === len) { tick(len); return b; } await cache.delete(key); }
  for (let attempt = 1; ; attempt++) {
    let got = 0;
    try {
      const res = await fetch(part.url, { headers: { Range: `bytes=${from}-${to}` }, cache: 'no-store' });
      if (res.status === 200) return await wholePart(part, i, res, cache, tick);   // сервер не умеет Range
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(), chunks = [];
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; tick(value.length); }
      if (got !== len) throw new Error('обрыв связи');
      await cache.put(key, new Response(new Blob(chunks)));
      return await (await cache.match(key)).blob();
    } catch (e) {
      tick(-got);
      if (attempt >= 6) throw e;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

// Запасной путь для сервера без Range: кусок целиком раскладываем по частям в тот же кэш
async function wholePart(part, i, res, cache, tick) {
  const blob = await new Response(res.body.pipeThrough(new TransformStream({ transform(c, ctl) { tick(c.byteLength); ctl.enqueue(c); } }))).blob();
  if (part.size && blob.size !== part.size) { tick(-blob.size); throw new Error('обрыв связи'); }
  for (let k = 0; k < Math.ceil(part.size / PIECE); k++) {
    await cache.put(pieceKey(part.url, k), new Response(blob.slice(k * PIECE, Math.min(part.size, (k + 1) * PIECE))));
  }
  const piece = await (await cache.match(pieceKey(part.url, i))).blob();
  tick(piece.size - blob.size);
  return piece;
}

let job = null;
export function startModel() {
  if (!info?.url || model.state === 'missing') return Promise.reject(new Error('model missing'));
  ls.set(WANT_KEY, '1');
  job ??= (async () => {
    const cache = await caches.open(cacheName());
    // кэш общий с LEXI Space (тот же сайт, то же имя и ключи): старые версии модели убираем
    caches.keys().then(keys => keys.filter(k => k.startsWith(MODEL_CACHE) && k !== cacheName()).forEach(k => caches.delete(k))).catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
    if (model.state !== 'downloaded') { model.state = 'downloading'; emit(); }
    const ps = parts(), T = total() || 1;
    let loaded = 0;
    const tick = n => { loaded += n; model.progress = Math.max(0, Math.min(loaded / T, 1)); emit(); };
    const files = new Array(ps.length);
    let next = 0;
    const worker = async () => {
      while (next < ps.length) {
        const k = next++, p = ps[k], pieces = [];
        for (let i = 0; i < Math.ceil(p.size / PIECE); i++) pieces.push(await getPiece(p, i, cache, tick));
        files[k] = new Blob(pieces);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    model.state = 'loading'; model.progress = 1; emit();
    const { Wllama } = await import(SPACE('vendor/wllama/index.js'));
    wllama = new Wllama({
      'single-thread/wllama.wasm': SPACE('vendor/wllama/single-thread/wllama.wasm'),
      'multi-thread/wllama.wasm': SPACE('vendor/wllama/multi-thread/wllama.wasm'),
    });
    await wllama.loadModel(files, { n_ctx: 2048, n_batch: 512 });
    model.state = 'ready'; emit();
  })().catch(e => { job = null; model.state = 'failed'; emit(); throw e; });
  return job;
}

// ---------------------------------------------------------------------
//  Ответ
// ---------------------------------------------------------------------
// local — короткая справка/расчёт, сделанные в мессенджере (доплер, орбита, объект)
export async function answer(question, { local = null, history = [], onText, signal } = {}) {
  const ru = getLang() !== 'en';
  try { await openKnowledge(); } catch {}
  const chunks = searchKnowledge(question, 5);
  const sources = chunks.slice(0, 3).map(c => c.title);
  if (!chunks.length && !local) {
    return { text: ru ? 'В базе LEXI про это ничего нет. Попробуйте спросить иначе.' : 'Nothing about this in the LEXI knowledge base. Try rephrasing.', sources, mode: 'base' };
  }
  if (model.state === 'ready') {
    const messages = [
      { role: 'system', content: SYSTEM[ru ? 'ru' : 'en'] },
      ...history.slice(-4),
      { role: 'user', content: buildUserMessage(question, chunks.slice(0, 4), local?.live, local?.calc, ru) },
    ];
    try {
      const text = await wllama.createChatCompletion(messages, {
        nPredict: 320,
        sampling: { temp: 0.1, top_k: 40, top_p: 0.9, penalty_repeat: 1.1 },
        onNewToken: (_t, _p, t) => onText?.(t),
        abortSignal: signal,
      });
      return { text: text.trim(), sources, mode: 'model' };
    } catch {}
  }
  // Без нейросети: расчёт + главный фрагмент базы
  const out = [];
  if (local?.text) out.push(local.text);
  if (chunks.length) {
    const top = chunks[0];
    out.push(top.body.length > 600 ? top.body.slice(0, 600).replace(/\s\S*$/, '') + '…' : top.body);
  }
  return { text: out.join('\n\n'), sources, mode: 'base' };
}

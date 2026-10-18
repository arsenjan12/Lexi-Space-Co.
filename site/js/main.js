// LEXI Space — точка входа: открываем базу, строим сцену, грузим орбиты,
// запускаем живые показатели и LexiAI, связываем всё с интерфейсом.

import { Vector3 } from 'three';
import { CONFIG } from './config.js';
import { t, lang, applyLang, onLang, num, locale } from './i18n.js';
import * as db from './db.js';
import { clock, observer, locate, setPlace, onPosition, bodyNow, fixedNow, raText, decText, azText } from './astro.js';
import { loadGroup, satNow } from './sats.js';
import { createScene } from './scene.js';
import * as ui from './ui.js';
import * as sec from './security.js';
import { initLexiAI } from './lexiai.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const bootStep = key => { $('#boot-step').textContent = t(key); };

applyLang(lang, false);

// --- Ссылка обратно на портал ---
function portalHref() {
  let base = CONFIG.portalUrl;
  if (!base && document.referrer && new URL(document.referrer).origin !== location.origin) base = document.referrer.split('?')[0];
  if (!base) return null;
  const u = new URL(base, location.href);
  u.searchParams.set('lang', lang);
  return u.href;
}
// Уход на портал с анимацией прыжка (средняя кнопка и Ctrl+клик — как обычно, в новой вкладке)
function leaveToPortal(e) {
  const a = e.currentTarget;
  if (!a.href || a.href.endsWith('#') || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  e.preventDefault();
  ui.closePanel();
  $('#warp-txt').textContent = t('warp.portal');
  document.body.classList.add('leaving');
  $('#warp').classList.add('on');
  scene.warpOut();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { location.href = a.href; }, reduce ? 200 : 1400);
}
// Вернулись кнопкой «назад» — страница могла восстановиться из кэша вместе с анимацией
addEventListener('pageshow', e => {
  if (!e.persisted) return;
  $('#warp').classList.remove('on');
  document.body.classList.remove('leaving');
  scene.warpReset();
});

function updatePortalLinks() {
  const href = portalHref();
  $$('[data-portal]').forEach(a => {
    if (href) a.href = href; else if (a.classList.contains('back')) a.hidden = true; else a.removeAttribute('href');
    if (!a.dataset.warp) { a.dataset.warp = '1'; a.addEventListener('click', leaveToPortal); }
  });
}

// =====================================================================
//  Запуск
// =====================================================================
bootStep('boot.db');
await db.openDb();

bootStep('boot.scene');
const data = {
  stars: db.stars(6.0),
  constellations: db.constellations(),
  dso: db.deepSky(),
  bodies: db.bodies(),
};
const scene = createScene($('#scene'), data);
window.lexi = { scene, db };          // для отладки из консоли браузера

// Состояние, к которому обращаются функции ниже (объявляем заранее)
let searchIndex = [];
let selectedRef = null;
let neos = null;
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');

// Группы спутников
const groups = db.satGroups();
const groupState = {};        // id → { sats, signed, source, on, loading }
async function ensureGroup(id) {
  const st = groupState[id] || (groupState[id] = { on: false });
  if (st.sats || st.loading) return st;
  st.loading = true;
  try {
    const g = groups.find(x => x.id === id);
    const res = await loadGroup(id);
    st.sats = res.sats.slice(0, g.max_count);
    st.signed = res.signed; st.source = res.source;
    scene.setSatellites(id, st.sats, g.color);
    scene.setSatLayerVisible(id, st.on);
    sec.reportSignature(id, res.signed, res.source);
    rebuildSearch();
    runTleCheck();
    if (id === 'gps-ops') runGnssCheck();
    if (id === 'stations') runSaaCheck();
  } catch (e) {
    console.warn(id, e);
    ui.toast(t('toast.noTle', { g: id }));
  }
  st.loading = false;
  return st;
}
const allSats = () => Object.values(groupState).flatMap(s => s.sats || []);

bootStep('boot.sats');
for (const g of groups) groupState[g.id] = { on: !!g.on_by_default };
await Promise.race([
  Promise.all(CONFIG.preload.map(ensureGroup)),
  new Promise(r => setTimeout(r, 6000)),        // медленный интернет не должен держать заставку вечно
]);

// =====================================================================
//  Цикл: время, сцена, часы
// =====================================================================
let lastClock = 0;
function loop() {
  clock.tick();
  const date = clock.date();
  scene.frame(date, clock.speed);
  if (performance.now() - lastClock > 250) { lastClock = performance.now(); renderClock(date); }
  requestAnimationFrame(loop);
}
function renderClock(date) {
  // Крупно — местное время человека, мелко — дата и UTC (по UTC живут орбиты и эфемериды)
  $('#clock').textContent = date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  $('#clock-date').textContent = `${date.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })} · UTC ${date.toISOString().slice(11, 16)}`;
  $('#time-mode').textContent = clock.live ? t('time.live') : `${t('time.sim')} ×${num(clock.speed)}`;
}
requestAnimationFrame(loop);
setInterval(ui.panelTick, 1000);

// =====================================================================
//  Точка наблюдения
// =====================================================================
function renderWhere() {
  const place = observer.fromDevice ? t('where.you') : observer.place || CONFIG.defaultPlace[lang];
  $('#where').innerHTML = `${place}<br>${observer.lat.toFixed(3)}°, ${observer.lon.toFixed(3)}°${observer.accuracy ? ` · ±${num(observer.accuracy, 0)} ${t('unit.m')}` : ''}`;
}
renderWhere();

// Города для ручного выбора точки, если геолокация недоступна
const CITIES = [
  ['Москва', 'Moscow', 55.7558, 37.6173], ['Санкт-Петербург', 'Saint Petersburg', 59.9343, 30.3351], ['Минск', 'Minsk', 53.9006, 27.559],
  ['Казань', 'Kazan', 55.7887, 49.1221], ['Екатеринбург', 'Yekaterinburg', 56.8389, 60.6057], ['Новосибирск', 'Novosibirsk', 55.0084, 82.9357],
  ['Алматы', 'Almaty', 43.2389, 76.8897], ['Ташкент', 'Tashkent', 41.2995, 69.2401], ['Тбилиси', 'Tbilisi', 41.7151, 44.8271],
  ['Берлин', 'Berlin', 52.52, 13.405], ['Лондон', 'London', 51.5074, -0.1278], ['Нью-Йорк', 'New York', 40.7128, -74.006],
];

function placeChosen() {
  renderWhere();
  runGnssCheck();
  ui.closePanel();
  ui.toast(t('toast.locate'));
}

// Панель выбора точки: почему не вышло, как включить геолокацию, города и координаты вручную
function showPlacePicker(code) {
  const reason = code === 1 ? t('geo.denied') : code === 3 ? t('geo.timeout') : t('geo.unavailable');
  ui.openPanel(`
    <p class="p-kind">${t('geo.kind')}</p>
    <h2 class="p-title" id="panel-title">${t('geo.title')}</h2>
    ${code ? `<p class="p-text">${reason}</p>` : ''}
    ${code === 1 ? `<p class="p-note">${t('geo.howto')}</p>` : ''}
    <p><button type="button" class="btn-line sm" data-geo-retry>${t('geo.retry')}</button></p>
    <h3 class="p-h">${t('geo.cities')}</h3>
    <div class="city-list">${CITIES.map((c, i) => `<button type="button" class="chip" data-city="${i}">${lang === 'ru' ? c[0] : c[1]}</button>`).join('')}</div>
    <h3 class="p-h">${t('geo.manual')}</h3>
    <form class="calc" id="geo-form">
      <label>${t('f.lat')}<span class="sym">°</span><input type="number" name="lat" step="any" min="-90" max="90" value="${observer.lat.toFixed(4)}" inputmode="decimal"></label>
      <label>${t('f.lon')}<span class="sym">°</span><input type="number" name="lon" step="any" min="-180" max="180" value="${observer.lon.toFixed(4)}" inputmode="decimal"></label>
      <p style="margin:.8rem 0 0"><button type="submit" class="btn-gold sm">${t('geo.apply')}</button></p>
    </form>`, { modal: true });
  const body = $('#panel-body');
  body.querySelectorAll('[data-city]').forEach(b => b.addEventListener('click', () => {
    const c = CITIES[+b.dataset.city];
    setPlace(c[2], c[3], lang === 'ru' ? c[0] : c[1]);
    placeChosen();
  }));
  $('#geo-form', body).addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), lat = +f.get('lat'), lon = +f.get('lon');
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    setPlace(lat, lon, `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`);
    placeChosen();
  });
  $('[data-geo-retry]', body).addEventListener('click', () => { ui.closePanel(); requestLocation(); });
}

let locating = false;
async function requestLocation() {
  if (locating) return;
  locating = true;
  $('#locate').textContent = t('geo.locating');
  try {
    await locate();
    renderWhere();
    ui.toast(t('toast.locate'));
    runGnssCheck();
  } catch (e) {
    sec.geoDenied();
    showPlacePicker(e?.code || 2);
  }
  $('#locate').textContent = t('hud.locate');
  locating = false;
}
$('#locate').addEventListener('click', requestLocation);
onPosition(renderWhere);

// =====================================================================
//  Живые показатели защиты
// =====================================================================
const indList = $('#indicators');
function renderIndicators() {
  indList.innerHTML = db.indicators().map(i => {
    const s = sec.indicators[i.id];
    const val = s.value || t(s.state === 'ask' ? 'ind.ask' : s.state === 'na' ? 'ind.na' : s.state === 'wait' ? 'ind.wait' : 'ind.' + s.state);
    return `<li><button type="button" data-open="indicator:${i.id}"><span class="st ${s.state}"></span><span>${i.title}</span><span class="v">${val}</span></button></li>`;
  }).join('');
}
renderIndicators();
sec.onIndicators(() => renderIndicators());

function runTleCheck() { sec.checkTle(allSats()); }
function runSaaCheck() { sec.checkSaa(groupState.stations?.sats?.find(s => s.norad === 25544)); }
function runGnssCheck() { sec.checkGnss(groupState['gps-ops']?.sats); }
sec.runHybridSelfTest();
runTleCheck(); runSaaCheck(); runGnssCheck(); sec.checkKp();
setInterval(runSaaCheck, CONFIG.every.saa);
setInterval(runGnssCheck, CONFIG.every.gnss);
setInterval(runTleCheck, CONFIG.every.tle);
setInterval(sec.checkKp, CONFIG.every.kp);

// =====================================================================
//  Виды и слои
// =====================================================================
const modulesEl = $('#modules');
let modTab = 'module1';
function setView(v) {
  $$('.tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  const isModules = v === 'modules';
  modulesEl.hidden = !isModules;
  $('#dock').hidden = isModules;
  $('#hud').hidden = isModules;
  scene.pause(isModules);
  if (isModules) ui.renderModules($('#mod-body'), modTab);
  else { scene.setView(v); renderLayers(); }
  history.replaceState(null, '', `#${v}`);
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('#mod-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-mod]');
  if (b) { modTab = b.dataset.mod; ui.renderModules($('#mod-body'), modTab); }
});
ui.setModuleOpener(id => { closeAll(); modTab = id; setView('modules'); });

const layerState = { lines: true, dso: true, grid: true, orbits: true, labels: true };
function renderLayers() {
  const el = $('#layers');
  const chip = (key, label, on, color) => `<button type="button" class="chip" data-layer="${key}" aria-pressed="${on}">${color ? `<span class="sw" style="color:${color}"></span>` : ''}${label}</button>`;
  let html = '';
  if (scene.view === 'orbit') html = groups.map(g => chip('g:' + g.id, db.pick(g, 'name'), !!groupState[g.id]?.on, g.color)).join('');
  if (scene.view === 'solar') html = chip('orbits', t('layers.orbits'), layerState.orbits);
  if (scene.view === 'sky') html = chip('lines', t('layers.lines'), layerState.lines) + chip('dso', t('layers.dso'), layerState.dso) + chip('grid', t('layers.grid'), layerState.grid);
  html += chip('labels', t('layers.labels'), layerState.labels) + chip('neo', t('layers.neo'), false);
  el.innerHTML = html;
}
$('#layers').addEventListener('click', async e => {
  const b = e.target.closest('[data-layer]');
  if (!b) return;
  const key = b.dataset.layer;
  if (key === 'neo') return showNeoList();
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on));
  if (key.startsWith('g:')) {
    const id = key.slice(2);
    groupState[id].on = on;
    if (on) await ensureGroup(id);
    scene.setSatLayerVisible(id, on);
  } else if (key === 'labels') { layerState.labels = on; scene.toggleLabels(on); }
  else { layerState[key] = on; scene.setSkyLayer(key, on); }
});

// Время
$$('.timebar button').forEach(b => b.addEventListener('click', () => {
  clock.setSpeed(+b.dataset.speed);
  $$('.timebar button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
}));
$('.timebar [data-speed="0"]').setAttribute('aria-pressed', 'true');

// =====================================================================
//  Подписи на сцене
// =====================================================================
const brightNamed = data.stars.filter(s => s.mag < 1.6 && (s.name_ru || s.name_en));
scene.setLabels(view => {
  const out = [];
  const name = b => db.pick(b, 'name');
  if (view === 'orbit') {
    for (const s of groupState.stations?.sats || []) {
      const k = db.knownSatellite(s.norad);
      if (k && s.pos) out.push({ text: db.pick(k, 'name'), world: vec(s.pos), occl: true });
    }
    for (const s of groupState.science?.sats || []) {
      const k = db.knownSatellite(s.norad);
      if (k && s.pos) out.push({ text: db.pick(k, 'name'), world: vec(s.pos), occl: true });
    }
    out.push({ text: name(data.bodies.find(b => b.id === 'Moon')), world: scene.worldPosOf({ type: 'body', id: 'Moon' }) });
  }
  if (view === 'solar') {
    for (const b of data.bodies.filter(b => !['Moon'].includes(b.id))) out.push({ text: name(b), world: scene.worldPosOf({ type: 'body', id: b.id }), cls: b.id === 'Sun' ? 'big' : '' });
  }
  if (view === 'sky') {
    for (const b of data.bodies.filter(b => b.id !== 'Earth')) out.push({ text: name(b), world: scene.worldPosOf({ type: 'body', id: b.id }), cls: 'body' });
    for (const s of brightNamed) out.push({ text: (lang === 'ru' ? s.name_ru : s.name_en) || s.name_en, world: scene.worldPosOf({ type: 'star', row: s }), cls: 'star' });
    const dirs = lang === 'ru' ? ['С', 'В', 'Ю', 'З'] : ['N', 'E', 'S', 'W'];
    [[0, 0, -480], [480, 0, 0], [0, 0, 480], [-480, 0, 0]].forEach((p, i) => out.push({ text: dirs[i], world: vec(p), cls: 'cardinal' }));
  }
  if (selectedRef) {
    const w = scene.worldPosOf(selectedRef);
    if (w) out.push({ text: '◎ ' + refLabel(selectedRef), world: w, cls: 'sel', occl: view === 'orbit' });
  }
  return out;
});
const vec = a => new Vector3(a[0], a[1], a[2]);

function refLabel(ref) {
  if (ref.type === 'sat') { const k = db.knownSatellite(ref.sat.norad); return k ? db.pick(k, 'name') : ref.sat.name; }
  if (ref.type === 'body') return db.pick(db.body(ref.id), 'name');
  if (ref.type === 'star') return (lang === 'ru' ? ref.row.name_ru : ref.row.name_en) || ref.row.name_en || `HIP ${ref.row.hip}`;
  if (ref.type === 'dso') return ref.row.id;
  return '';
}

// =====================================================================
//  Наведение и выбор на сцене
// =====================================================================
const tip = $('#tip'), canvas = $('#scene');
let hoverAt = 0, downAt = null;
canvas.addEventListener('pointermove', e => {
  if (performance.now() - hoverAt < 60 || e.buttons) { if (e.buttons) tip.hidden = true; return; }
  hoverAt = performance.now();
  const ref = scene.pickAt(e.offsetX, e.offsetY);
  if (!ref) { tip.hidden = true; canvas.style.cursor = ''; return; }
  canvas.style.cursor = 'pointer';
  tip.innerHTML = `${refLabel(ref)}<small>${refKind(ref)}</small>`;
  tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px';
  tip.hidden = false;
});
canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
canvas.addEventListener('pointerdown', e => { downAt = [e.offsetX, e.offsetY]; });
canvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.offsetX - downAt[0], e.offsetY - downAt[1]) > 5) return;   // это было вращение, не щелчок
  const ref = scene.pickAt(e.offsetX, e.offsetY);
  if (ref) openRef(ref, false);
});

function refKind(ref) {
  if (ref.type === 'sat') return db.pick(groups.find(g => g.id === ref.sat.group), 'name');
  if (ref.type === 'body') { const b = db.body(ref.id); return t(ref.id === 'Sun' ? 'kind.sun' : 'kind.' + b.kind); }
  if (ref.type === 'star') return `${t('kind.star')} · ${num(ref.row.mag, 1)}m`;
  if (ref.type === 'dso') return t('kind.' + ref.row.kind);
  return '';
}

function openRef(ref, fly = true) {
  // Объект неба, а мы в другом виде — переключимся туда, где его видно
  if (ref.type === 'star' || ref.type === 'dso') { if (scene.view !== 'sky') setView('sky'); }
  else if (ref.type === 'sat' && scene.view === 'solar') setView('orbit');
  else if (ref.type === 'body' && !['Moon', 'Earth'].includes(ref.id) && scene.view === 'orbit') setView('solar');
  if (!modulesEl.hidden) setView(ref.type === 'star' || ref.type === 'dso' ? 'sky' : 'orbit');
  selectedRef = ref;
  scene.select(ref);
  if (fly) scene.focus(ref);
  ui.showObject(ref, { groupSource: id => groupState[id] });
}
ui.setOnClose(() => { selectedRef = null; scene.select(null); });
function closeAll() { ui.closePanel(); }

// Переходы по ссылкам data-open="тип:id" из карточек, модулей и ответов LexiAI
document.addEventListener('click', e => {
  const el = e.target.closest('[data-open]');
  if (el) {
    const [type, ...rest] = el.dataset.open.split(':');
    const id = rest.join(':');
    if (['threat', 'countermeasure', 'formula', 'indicator', 'goal', 'module'].includes(type)) ui.showKnowledge(type, id);
    else if (type === 'body') openRef({ type: 'body', id });
    else if (type === 'star') { const s = db.star(+id); if (s) openRef({ type: 'star', row: s }); }
    else if (type === 'deep_sky') { const d = db.dso(id); if (d) openRef({ type: 'dso', row: d }); }
    else if (type === 'satellite') { const s = allSats().find(x => x.norad === +id); if (s) openRef({ type: 'sat', sat: s }); }
    else if (type === 'sat_group') { setView('orbit'); }
    return;
  }
  const askBtn = e.target.closest('[data-ask]');
  if (askBtn) { ai.ask(lang === 'ru' ? `Расскажи про ${askBtn.dataset.ask}` : `Tell me about ${askBtn.dataset.ask}`); return; }
  if (e.target.closest('[data-locate]')) requestLocation();
});

// =====================================================================
//  Астероиды дня (NASA NeoWs)
// =====================================================================
async function loadNeos() {
  if (neos) return neos;
  const day = new Date().toISOString().slice(0, 10);
  let feed = null;
  try {
    const r = await fetch('/api/neo');
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) feed = JSON.parse((await r.json()).payload).objects;
  } catch { /* без сервера */ }
  if (!feed) {
    const r = await fetch(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${day}&end_date=${day}&api_key=DEMO_KEY`);
    const j = await r.json();
    feed = Object.values(j.near_earth_objects || {}).flat().map(n => {
      const ca = n.close_approach_data?.[0] || {};
      return { id: n.id, name: n.name.replace(/[()]/g, ''), approachMs: ca.epoch_date_close_approach, missKm: +ca.miss_distance?.kilometers,
        velKms: +ca.relative_velocity?.kilometers_per_second, dMin: n.estimated_diameter?.meters?.estimated_diameter_min,
        dMax: n.estimated_diameter?.meters?.estimated_diameter_max, hazardous: n.is_potentially_hazardous_asteroid };
    });
  }
  neos = feed.sort((a, b) => a.missKm - b.missKm);
  return neos;
}
async function showNeoList() {
  ui.openPanel(`<p class="p-kind">NASA NeoWs</p><h2 class="p-title" id="panel-title">${t('layers.neo')}</h2><p class="p-sub">…</p>`, { modal: true });
  try {
    const list = await loadNeos();
    ui.openPanel(`<p class="p-kind">NASA NeoWs · ${new Date().toLocaleDateString(locale())}</p>
      <h2 class="p-title" id="panel-title">${t('layers.neo')}</h2>
      <p class="p-sub">${list.length} · ${lang === 'ru' ? 'отсортированы по расстоянию пролёта' : 'sorted by miss distance'}</p>
      <ul class="links">${list.map((n, i) => `<li><button type="button" data-neo="${i}">${n.hazardous ? '⚠ ' : ''}${n.name}<small>${num(n.missKm / 384400, 1)} ${t('unit.ld')} · ${num(n.dMax, 0)} ${t('unit.m')}</small></button></li>`).join('')}</ul>`, { modal: true });
    $$('[data-neo]').forEach(b => b.addEventListener('click', () => ui.showObject({ type: 'neo', neo: list[+b.dataset.neo] })));
  } catch {
    ui.openPanel(`<h2 class="p-title">${t('layers.neo')}</h2><p class="p-text">${t('ind.na')}</p>`, { modal: true });
  }
}

// =====================================================================
//  Поиск
// =====================================================================
function rebuildSearch() {
  const idx = [];
  const push = (label, tag, ref, rank, extra = []) => {
    const key = norm([label, ...extra].join(' '));
    idx.push({ label, tag, ref, rank, key, names: [label, ...extra].filter(Boolean).map(norm) });
  };
  for (const b of data.bodies) push(db.pick(b, 'name'), t(b.id === 'Sun' ? 'kind.sun' : 'kind.' + b.kind), { type: 'body', id: b.id }, 0, [b.name_ru, b.name_en]);
  for (const s of data.stars) if (s.name_ru || s.name_en) push((lang === 'ru' ? s.name_ru : s.name_en) || s.name_en || s.name_ru, t('kind.star'), { type: 'star', row: s }, 1 + s.mag / 10, [s.name_ru, s.name_en]);
  for (const d of data.dso) push(`${d.id}${(lang === 'ru' ? d.name_ru : d.name_en) ? ' · ' + ((lang === 'ru' ? d.name_ru : d.name_en)) : ''}`, t('kind.' + d.kind), { type: 'dso', row: d }, 1.5, [d.id, d.ngc, d.name_ru, d.name_en]);
  for (const s of allSats()) { const k = db.knownSatellite(s.norad); push(k ? db.pick(k, 'name') : s.name, t('kind.satellite'), { type: 'sat', sat: s }, k ? 0.5 : 3, [s.name, k?.name_ru, k?.name_en, String(s.norad)]); }
  for (const th of db.threats()) push(th.title, t('kind.threat'), { type: 'threat', id: th.id }, 2);
  for (const c of db.countermeasures()) push(c.title, t('kind.countermeasure'), { type: 'countermeasure', id: c.id }, 2.5);
  for (const f of db.formulas()) push(f.title, t('kind.formula'), { type: 'formula', id: f.id }, 2.5);
  searchIndex = idx;
}
rebuildSearch();
ui.initSearch(() => searchIndex, item => {
  const r = item.ref;
  if (['threat', 'countermeasure', 'formula'].includes(r.type)) ui.showKnowledge(r.type, r.id);
  else openRef(r);
});

// =====================================================================
//  LexiAI
// =====================================================================
function findObject(text) {
  const q = ' ' + norm(text).replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ') + ' ';
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let best = null;
  for (const it of searchIndex) {
    if (!['body', 'star', 'dso', 'sat'].includes(it.ref.type)) continue;
    for (const raw of it.names) {
      const n = raw.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
      if (n.length < 3) continue;
      // Целое слово; у длинных названий допускаем окончание: «Марсе», «Сириуса». «Навигатор» ≠ «Нави».
      const re = n.length >= 5 ? new RegExp(` ${esc(n.slice(0, -1))}\\p{L}{0,3} `, 'u') : new RegExp(` ${esc(n)} `, 'u');
      if (re.test(q) && (!best || n.length > best.len)) best = { it, len: n.length };
    }
  }
  if (!best) return null;
  const ref = best.it.ref;
  return { ref, label: refLabel(ref), knowledgeTitle: knowledgeTitleOf(ref) };
}
function knowledgeTitleOf(ref) {
  if (ref.type === 'body') return db.pick(db.body(ref.id), 'name');
  if (ref.type === 'star') return (lang === 'ru' ? ref.row.name_ru : ref.row.name_en) || ref.row.name_en || ref.row.name_ru;
  if (ref.type === 'dso') { const n = lang === 'ru' ? ref.row.name_ru : ref.row.name_en; return n ? `${ref.row.id} (${n})` : ref.row.id; }
  if (ref.type === 'sat') { const k = db.knownSatellite(ref.sat.norad); return k ? db.pick(k, 'name') : null; }
  return null;
}
function liveSummary(obj) {
  const ru = lang === 'ru', d = clock.date(), r = obj.ref;
  const vis = alt => alt > 0 ? (ru ? `над горизонтом, высота ${alt.toFixed(0)}°` : `above the horizon at ${alt.toFixed(0)}°`) : (ru ? 'под горизонтом' : 'below the horizon');
  if (r.type === 'sat') {
    const s = satNow(r.sat, d);
    if (!s) return null;
    return ru ? `${obj.label}: широта ${s.lat.toFixed(2)}°, долгота ${s.lon.toFixed(2)}°, высота ${num(s.altKm, 0)} км, скорость ${num(s.speed, 2)} км/с; от вас ${num(s.rangeKm, 0)} км, ${vis(s.el)}.`
              : `${obj.label}: latitude ${s.lat.toFixed(2)}°, longitude ${s.lon.toFixed(2)}°, altitude ${num(s.altKm, 0)} km, speed ${num(s.speed, 2)} km/s; ${num(s.rangeKm, 0)} km from you, ${vis(s.el)}.`;
  }
  if (r.type === 'body' && r.id !== 'Earth') {
    const n = bodyNow(r.id, d), km = n.distAu * 1.495978707e8;
    return ru ? `${obj.label}: расстояние ${num(n.distAu, 3)} а.е. (${num(km / 1e6, 1)} млн км), свет идёт ${num(km / 299792.458 / 60, 1)} мин; ${vis(n.alt)}, азимут ${azText(n.az)}; созвездие ${db.pick(db.constellation(n.con), 'name') || n.con}.`
              : `${obj.label}: distance ${num(n.distAu, 3)} AU (${num(km / 1e6, 1)} M km), light takes ${num(km / 299792.458 / 60, 1)} min; ${vis(n.alt)}, azimuth ${azText(n.az)}; constellation ${db.pick(db.constellation(n.con), 'name') || n.con}.`;
  }
  if (r.type === 'star' || r.type === 'dso') {
    const row = r.row, n = fixedNow(row.ra_deg, row.dec_deg, row.dist_ly || (row.dist_pc ? row.dist_pc * 3.26 : null));
    return ru ? `${obj.label} сейчас ${vis(n.alt)}, азимут ${azText(n.az)} (${raText(row.ra_deg / 15)} ${decText(row.dec_deg)}).`
              : `${obj.label} is now ${vis(n.alt)}, azimuth ${azText(n.az)} (${raText(row.ra_deg / 15)} ${decText(row.dec_deg)}).`;
  }
  return null;
}
const ai = initLexiAI({ findObject, liveSummary, openRef });

// =====================================================================
//  Мобильная шапка, язык, старт
// =====================================================================
// Поиск на телефоне — по иконке, раскрывается поверх шапки
$('#search-btn').addEventListener('click', () => {
  $('.top').classList.add('searching');
  $('#search').focus();
});
$('#search').addEventListener('blur', () => setTimeout(() => $('.top').classList.remove('searching'), 200));

$('#hud-toggle').addEventListener('click', () => {
  const open = !$('#hud').classList.contains('open');
  $('#hud').classList.toggle('open', open);
  $('#hud-toggle').setAttribute('aria-expanded', String(open));
});
$$('.lang button').forEach(b => b.addEventListener('click', () => applyLang(b.dataset.lang, true)));
onLang(() => {
  renderIndicators(); renderLayers(); renderWhere(); rebuildSearch(); updatePortalLinks(); ai.refresh();
  if (!modulesEl.hidden) ui.renderModules($('#mod-body'), modTab);
  if (selectedRef && ui.panelRef()) ui.showObject(selectedRef, { groupSource: id => groupState[id] });
});

updatePortalLinks();
const startView = (location.hash.slice(1) || 'orbit');
setView(['orbit', 'solar', 'sky', 'modules'].includes(startView) ? startView : 'orbit');
bootStep('boot.ready');
setTimeout(() => $('#boot').classList.add('done'), 300);
// Если человек уже разрешал геолокацию раньше — включим её без вопроса
navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') requestLocation(); }).catch(() => {});

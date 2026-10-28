// =====================================================================
//  LEXI Messenger — интерфейс по эскизу.
//  Загрузка → (первый раз: регистрация, профиль, приветствие) → чаты.
// =====================================================================

import { LexiIRCClient } from './lexi-client.js';
import { Identity, randomId, unb64 } from './lexi-e2e.js';
import { DemoRelay } from './demo-relay.js';
import { startDemo, CHATS } from './demo-bots.js';
import { renderText, esc, katexReady, catalogLinks } from './render.js';
import { parseFits, isFits, fitsToCanvas } from './fits.js';
import { paintPlanet, PLANETS as PLANETS_2D, starfield, earth as earth2d, paintDeepSpace, loadConstellations, paintConstellations, constellationFor } from './space-bg.js';
import { TOOLS } from './tools.js';
import * as AS from './astro.js';
import * as AI from './lexiai.js';
import { aiLikelihood } from './ai-detect.js';
import { playBoot, MARK_PATHS } from './boot.js';
import { t, setLang, getLang, applyI18n } from './i18n.js';

// ---------------------------------------------------------------------
//  Утилиты
// ---------------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const wait = ms => new Promise(r => setTimeout(r, ms));
const L = (ru, en) => getLang() === 'en' ? en : ru;
const store = {
  get(k, d) { try { const v = localStorage.getItem('lexi.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lexi.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('lexi.' + k); } catch {} },
};
const PALETTE = ['#ecd391', '#45f3ff', '#9fb4ff', '#f0a94b', '#e88aa6', '#7ee0a8', '#c7a6ff', '#ff8f6b'];
const colorOf = k => PALETTE[[...String(k)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const fmtTime = ts => new Date(ts).toLocaleTimeString(getLang() === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return L('Сегодня', 'Today');
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return L('Вчера', 'Yesterday');
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long' });
}
function toast(msg, ms = 2600) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), ms);
}
const ico = (id, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const safeImg = s => typeof s === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '';
const MARK_SVG = `<svg viewBox="0 0 53 50" class="mk" aria-hidden="true"><use href="#mark" width="53" height="50"/></svg>`;

function avatarHTML(p, cls = '') {
  const img = safeImg(p?.photo);
  if (p?.lexi) return `<span class="avatar ${cls}" style="background:var(--bg);color:var(--accent)">${MARK_SVG}</span>`;
  return `<span class="avatar ${cls}" style="background:${p?.color || colorOf(p?.uid || p?.name)}">${img ? `<img src="${img}" alt="">` : esc(initials(p?.name))}</span>`;
}

// ---------------------------------------------------------------------
//  Состояние
// ---------------------------------------------------------------------
const prefs = Object.assign({ theme: 'gold', fs: 1, lang: 'ru', planet: null }, store.get('prefs', {}));
const S = {
  profile: store.get('profile', null),
  interests: store.get('interests', []),
  mode: store.get('mode', 'server'),
  url: store.get('url', ''),
  identity: null, client: null, relay: null, demoReady: null,
  chats: new Map(), people: new Map(),
  open: null, view: null, tab: 'all', space: null, float: null, thread: null,
  notes: [], notesSeen: 0, keysOk: new Set(), att: [], aiFlag: false, drafts: {},
  fresh: new Set(), ai: [], aiBusy: false, search: '',
};
const savePrefs = () => store.set('prefs', prefs);
const myUid = () => S.client?.uid;

function applyPrefs() {
  document.documentElement.dataset.lexiTheme = prefs.theme;
  document.documentElement.style.setProperty('--fs', prefs.fs);
  setLang(prefs.lang);
  applyI18n();
  $$('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === prefs.lang)));
}

// 3D только там, где он не будет тормозить
function can3D() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if ((navigator.deviceMemory ?? 8) < 4 || (navigator.hardwareConcurrency ?? 4) < 4) return false;
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
}

// ---------------------------------------------------------------------
//  Жидкое стекло: блик за курсором
// ---------------------------------------------------------------------
let litEl = null;
document.addEventListener('pointermove', e => {
  const g = e.target.closest?.('.glass');
  if (g !== litEl) { litEl?.classList.remove('lit'); litEl = g; g?.classList.add('lit'); }
  if (g) { const r = g.getBoundingClientRect(); g.style.setProperty('--gx', `${e.clientX - r.left}px`); g.style.setProperty('--gy', `${e.clientY - r.top}px`); }
}, { passive: true });
if (CSS.supports('backdrop-filter', 'url(#lg)') && /Chrome\//.test(navigator.userAgent)) document.documentElement.classList.add('refract');

// ---------------------------------------------------------------------
//  Фон: планета
// ---------------------------------------------------------------------
let bg3d = null;
const PLANET_LIST = [
  ['mars', 'Марс', 'Mars'], ['jupiter', 'Юпитер', 'Jupiter'], ['saturn', 'Сатурн', 'Saturn'], ['neptune', 'Нептун', 'Neptune'], ['uranus', 'Уран', 'Uranus'],
  ['venus', 'Венера', 'Venus'], ['trappist1e', 'TRAPPIST-1 e', 'TRAPPIST-1 e'], ['kepler452b', 'Kepler-452 b', 'Kepler-452 b'], ['hd189733b', 'HD 189733 b', 'HD 189733 b'],
  ['51pegb', '51 Пегаса b', '51 Pegasi b'], ['proximab', 'Проксима b', 'Proxima b'], ['55cnce', '55 Рака e', '55 Cancri e'],
];
const MAP_2D = { kepler452b: 'k452b', venus: 'jupiter' };

async function initBackground() {
  if (!prefs.planet || !PLANET_LIST.some(p => p[0] === prefs.planet)) prefs.planet = PLANET_LIST[Math.floor(Math.random() * PLANET_LIST.length)][0];
  if (can3D()) {
    try {
      const m = await import('./scene3d.js');
      bg3d = m.createBackground($('#bg3d'));
      bg3d.setPlanet(prefs.planet);
      return;
    } catch (e) { console.warn('3D недоступен', e); }
  }
  $('#bg3d').hidden = true;
  $('#bg2d').hidden = false;
  draw2DPlanet();
}
function draw2DPlanet() {
  const cv = $('#bg2d');
  const pl = PLANETS_2D.find(p => p.id === (MAP_2D[prefs.planet] || prefs.planet)) || PLANETS_2D[0];
  const w = cv.width = innerWidth, h = cv.height = innerHeight;
  const x = cv.getContext('2d');
  const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
  for (let i = 0; i < w * h / 1800; i++) { x.fillStyle = `rgba(255,250,236,${0.2 + rnd() * 0.6})`; x.fillRect(rnd() * w, rnd() * h, 1, 1); }
  const size = Math.round(Math.max(w, h) * 0.62);
  const img = paintPlanet(pl, Math.min(size, 900), 3);
  x.drawImage(img, w - size * 0.62, h - size * 0.55, size, size);
}
function setPlanet(id) {
  prefs.planet = id; savePrefs();
  if (bg3d) bg3d.setPlanet(id); else draw2DPlanet();
  renderPlanetName();
}
function nextPlanet() {
  const others = PLANET_LIST.filter(p => p[0] !== prefs.planet);
  setPlanet(others[Math.floor(Math.random() * others.length)][0]);
}
function renderPlanetName() {
  const p = PLANET_LIST.find(x => x[0] === prefs.planet);
  const b = $('#planet-name');
  b.textContent = p ? L(p[1], p[2]) + ' ↻' : '';
  b.hidden = !p || !!S.view;
}

// ---------------------------------------------------------------------
//  Регистрация (первый вход)
// ---------------------------------------------------------------------
const INTERESTS = [['Астрофизика', 'Astrophysics'], ['Орбитальная механика', 'Orbital mechanics'], ['Радиоастрономия', 'Radio astronomy'], ['Наблюдения', 'Observing'],
  ['Астрофото', 'Astrophotography'], ['Экзопланеты', 'Exoplanets'], ['Космическая погода', 'Space weather'], ['Спутниковая связь', 'Satellite comms'],
  ['Обработка данных', 'Data processing'], ['Гражданская наука', 'Citizen science'], ['Кибербезопасность', 'Cybersecurity'], ['Космология', 'Cosmology']];
let orbit = null, stopOrbit2d = null;

async function startOnboarding() {
  const ob = $('#onboard');
  ob.hidden = false;
  if (can3D()) {
    try {
      const m = await import('./scene3d.js');
      orbit = m.createOrbitScene($('#orbit3d'));
      orbit.onAnchor((x, y) => {
        const tab = $('#tablet'), line = $('#tether');
        if (!tab || tab.offsetParent === null || innerWidth <= 820) { line.setAttribute('x1', 0); line.setAttribute('x2', 0); line.setAttribute('y1', 0); line.setAttribute('y2', 0); return; }
        const r = tab.getBoundingClientRect();
        line.setAttribute('x1', x); line.setAttribute('y1', y); line.setAttribute('x2', r.left + 40); line.setAttribute('y2', r.top + 2);
      });
    } catch (e) { console.warn(e); orbit = null; }
  }
  if (!orbit) {
    $('#orbit3d').hidden = true;
    const c = $('#orbit2d'); c.hidden = false;
    stopOrbit2d = starfield(c);
    const e = document.createElement('canvas');
    e.className = 'earth2d';
    Object.assign(e.style, { position: 'absolute', left: '-12vmin', bottom: '-18vmin', width: '70vmin', height: '70vmin', zIndex: 1, borderRadius: '50%', boxShadow: '0 0 90px -10px rgba(120,170,255,.35)', filter: 'var(--img-filter)' });
    ob.append(e);
    earth2d(e);
  }
  renderInterests();
  obStep(S.profile ? 'welcome' : 'hello');
}

function obStep(name) {
  $$('.ob-step').forEach(s => { s.hidden = s.dataset.step !== name; });
  orbit?.setShot(name);
  if (name === 'hello') typeHello();
  if (name === 'profile') { fillProfile(); renderIdCard(); }
  if (name === 'welcome') $('#conn-status').textContent = '';
}
async function typeHello() {
  const el = $('#hello-type'), txt = t('ob.hello');
  el.innerHTML = '<span></span><i class="caret"></i>';
  for (let i = 1; i <= txt.length; i++) { el.firstChild.textContent = txt.slice(0, i); await wait(80 + Math.random() * 50); }
}
function renderInterests() {
  $('#interests').innerHTML = INTERESTS.map(([ru, en], i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${S.interests.includes(i)}">${L(ru, en)}</button>`).join('');
}
function fillProfile() {
  const p = S.profile || {};
  for (const k of ['name', 'handle', 'role', 'org']) $('#pf-' + k).value = p[k] || '';
  S.pendingPhoto = p.photo || '';
  renderPhotoBtn();
}
function renderPhotoBtn() {
  $('#pf-photo-view').innerHTML = S.pendingPhoto ? `<img src="${safeImg(S.pendingPhoto)}" alt="">` : t('ob.photo');
}
function readProfile() {
  const p = { ...(S.profile || {}) };
  for (const k of ['name', 'handle', 'role', 'org']) p[k] = $('#pf-' + k).value.trim();
  p.handle = p.handle.replace(/[^\p{L}\d_.-]/gu, '').slice(0, 24);
  p.photo = S.pendingPhoto || '';
  p.color ||= PALETTE[Math.floor(Math.random() * PALETTE.length)];
  return p;
}
function renderIdCard() {
  const p = readProfile();
  $('#id-card').innerHTML = `${avatarHTML(p)}<b>${esc(p.name || '—')}</b><span>${p.handle ? '@' + esc(p.handle) : ''}</span><span>${esc(p.role || '')}${p.org ? ' · ' + esc(p.org) : ''}</span>`;
}
async function downscaleImage(file, max, q = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/jpeg', q), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}
async function squareAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 160;
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

function initOnboardingEvents() {
  $('#interests').onclick = e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const i = +b.dataset.i;
    S.interests = S.interests.includes(i) ? S.interests.filter(x => x !== i) : [...S.interests, i];
    renderInterests();
  };
  $('#to-profile').onclick = () => { store.set('interests', S.interests); obStep('profile'); };
  $('#pform').addEventListener('input', renderIdCard);
  $('#pf-photo').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { S.pendingPhoto = await squareAvatar(f); renderPhotoBtn(); renderIdCard(); } catch {}
  };
  $('#pf-back').onclick = () => obStep('hello');
  $('#pform').onsubmit = e => {
    e.preventDefault();
    const p = readProfile();
    if (!p.name) return $('#pf-name').focus();
    S.profile = p; store.set('profile', p);
    obStep('welcome');
  };
  $('#enter').onclick = () => enter('server');
  $('#enter-demo').onclick = () => enter('demo');
  $$('.lang button').forEach(b => b.onclick = () => {
    prefs.lang = b.dataset.lang; savePrefs(); applyPrefs(); renderInterests();
    if (!$('#app').hidden) renderAll();
  });
}

async function enter(mode) {
  const btn = $('#enter'); btn.disabled = true;
  $('#conn-status').textContent = t('ob.connecting');
  await connect(mode);
  $('#onboard').classList.add('leaving');
  showApp();
  setTimeout(() => { $('#onboard').hidden = true; orbit?.dispose(); orbit = null; stopOrbit2d?.(); }, 900);
  btn.disabled = false;
}

// ---------------------------------------------------------------------
//  Подключение
// ---------------------------------------------------------------------
function startDemoBackground() {
  if (S.demoReady) return S.demoReady;
  S.relay = new DemoRelay();
  S.demoReady = startDemo(S.relay).catch(e => console.error(e));
  return S.demoReady;
}

// «Войти» пробует сервер; если его нет или он молчит — открываем демо
async function connect(mode) {
  if (mode === 'server' && S.url) {
    try {
      await Promise.race([openClient('server'), wait(4500).then(() => { throw new Error('timeout'); })]);
      S.mode = 'server'; store.set('mode', 'server');
      return;
    } catch {
      S.client?.disconnect();
      toast(t('ob.fallback'), 4000);
    }
  }
  await openClient('demo');
  S.mode = mode === 'demo' ? 'demo' : 'server';
  store.set('mode', S.mode);
}

async function openClient(mode) {
  S.client?.disconnect();
  S.chats.clear();
  let factory;
  if (mode === 'demo') { await startDemoBackground(); factory = S.relay.socketFactory; }
  let uid = store.get('uid', null); if (!uid) { uid = randomId(8); store.set('uid', uid); }
  const c = new LexiIRCClient({ socketFactory: factory, uid, profile: { name: S.profile.name, color: S.profile.color } });
  c.identity = S.identity || (S.identity = new Identity());
  S.client = c;
  S.connMode = mode;
  wireClient(c);
  for (const ch of CHATS) chat(ch.id, { kind: ch.kind, title: ch.title, desc: ch.desc });
  for (const x of store.get('custom', [])) chat(x.id, { kind: x.kind, title: x.title, desc: x.desc });
  await c.connect(mode === 'demo' ? 'demo://relay' : S.url, S.profile.name, { channel: 'lexi-news' });
  for (const id of S.chats.keys()) c.joinChannel(id);
  setTimeout(sendProfile, 2200);
}

function sendProfile() {
  const p = S.profile; if (!S.client || !p) return;
  for (const id of S.chats.keys()) S.client.sendPayload(id, { t: 'profile', role: p.role, org: p.org, handle: p.handle, color: p.color, photo: p.photo || '', orcid: p.orcid || '', bio: p.bio || '' });
}

function wireClient(c) {
  c.on('state', () => schedule('head'));
  c.on('joined', ({ channel }) => { chat(channel).joined = true; schedule('list'); });
  c.on('members', ({ channel, members }) => {
    const ch = chat(channel);
    for (const m of members) {
      ch.members.add(m.uid);
      const p = person(m.uid, m.name, m.color);
      p.fp = m.fp; p.lastSeen = Date.now(); p.chats.add(channel);
    }
    schedule('rail', 'float');
  });
  c.on('user_list', m => {
    for (const u of m.users || []) if (u.uid) { const p = person(u.uid, u.name); p.verified = !!u.verified; p.online = true; }
    schedule('rail', 'stream', 'float');
  });
  c.on('key', k => { chat(k.channel).key = c.keyInfo(k.channel); schedule('head', 'list'); });
  c.on('chat', onChat);
  c.on('delivered', d => { const m = S.chats.get(d.channel)?.msgs.get(d.id); if (m) { m.status = 'delivered'; schedule('stream'); } });
  c.on('plain', p => {
    addMessage(chat(p.channel), { id: 'p-' + randomId(4), t: 'text', text: p.content, ts: Date.parse(p.timestamp) || Date.now() }, { uid: 'srv-' + p.userId, name: '—' }, {});
    schedule('stream', 'list');
  });
  c.on('error', e => e?.message && console.warn('[lexi]', e.message));
  c.on('disconnected', () => { toast(t('conn.offline')); schedule('head'); });
}

// ---------------------------------------------------------------------
//  Модель
// ---------------------------------------------------------------------
function chat(id, init = {}) {
  let ch = S.chats.get(id);
  if (!ch) {
    ch = { id, kind: id.startsWith('dm-') ? 'direct' : 'group', title: id, desc: '', avatar: '', admins: [], premod: false, noai: false,
      msgs: new Map(), orphans: [], unread: 0, muted: false, pinned: false, members: new Set(), key: null, joined: false, peer: null, lastTs: 0 };
    S.chats.set(id, ch);
  }
  for (const [k, v] of Object.entries(init)) if (v !== undefined) ch[k] = v;
  return ch;
}
function person(uid, name, color) {
  let p = S.people.get(uid);
  if (!p) { p = { uid, name: name || '…', color: color || colorOf(uid), chats: new Set(), lastSeen: 0 }; S.people.set(uid, p); }
  if (name && !/^Anonymous/.test(name)) p.name = name;
  if (color) p.color = color;
  if (p.name === 'LEXI') p.lexi = true;
  return p;
}
const meProfile = () => ({ uid: myUid(), name: S.profile?.name, color: S.profile?.color, photo: S.profile?.photo });
const who = uid => uid === myUid() ? meProfile() : (S.people.get(uid) || { uid, name: '…' });
const isAdmin = (ch, uid) => ch.admins.includes(uid);
const iAmAdmin = ch => isAdmin(ch, myUid()) || (ch.kind !== 'channel' && !ch.admins.length && S.client?.keyInfo(ch.id)?.founder);
const reactors = m => new Set([...m.reactions.values()].flatMap(s => [...s]));

function addMessage(ch, p, from, ev) {
  if (ch.msgs.has(p.id)) return ch.msgs.get(p.id);
  if (ch.kind === 'channel' && ch.admins.length && !isAdmin(ch, from.uid)) return null;   // в канале пишут только админы
  const m = {
    id: p.id, ch: ch.id, text: String(p.text ?? ''), att: Array.isArray(p.att) ? p.att.slice(0, 6) : [],
    thread: p.thread || null, reply: p.reply || null, fwd: p.fwd || null, ai: !!p.ai, via: p.via || null, asker: p.asker || null,
    ts: +p.ts || Date.now(), from: from.uid, mine: !!ev.mine, status: ev.mine ? 'sending' : null,
    reactions: new Map(), approved: null, needsMod: false,
  };
  if (ch.premod && !isAdmin(ch, from.uid)) m.needsMod = true;
  ch.msgs.set(m.id, m);
  if (m.ts > ch.lastTs && !m.thread) ch.lastTs = m.ts;
  const left = [];
  for (const o of ch.orphans) (o.p.ref === m.id ? applyRef(ch, o.p, o.from) : left.push(o));
  ch.orphans = left;
  if (!ev.mine && !ev.history) {
    S.fresh.add(m.id);
    const visible = S.open === ch.id && S.view === 'chat' && document.visibilityState === 'visible';
    if (!visible && !m.thread) {
      ch.unread++;
      const mine = S.profile;
      const hit = ch.kind === 'direct' || (mine?.handle && m.text.toLowerCase().includes('@' + mine.handle.toLowerCase())) || (mine?.name && m.text.includes('@' + mine.name.split(' ')[0]));
      if (hit && !ch.muted) note(`${who(from.uid).name}: ${m.text.slice(0, 80)}`, ch.id);
    }
  }
  return m;
}
function applyRef(ch, p, from) {
  const m = ch.msgs.get(p.ref);
  if (!m) { ch.orphans.push({ p, from }); if (ch.orphans.length > 400) ch.orphans.shift(); return; }
  if (p.t === 'react') {
    const e = String(p.emoji || '').slice(0, 8); if (!e) return;
    const set = m.reactions.get(e) || new Set();
    set.has(from.uid) ? set.delete(from.uid) : set.add(from.uid);
    set.size ? m.reactions.set(e, set) : m.reactions.delete(e);
  }
  if (p.t === 'approve' && isAdmin(ch, from.uid)) m.approved = !!p.ok;
}
function onChat(ev) {
  const ch = chat(ev.channel), p = ev.payload, f = ev.from;
  const pr = ev.mine ? null : person(f.uid, f.name, f.color);
  if (pr) { if (f.fp) pr.fp = f.fp; pr.lastSeen = Date.now(); pr.chats.add(ev.channel); }
  switch (p.t) {
    case 'text': addMessage(ch, p, { uid: f.uid }, ev); break;
    case 'profile':
      if (pr) Object.assign(pr, { role: String(p.role || '').slice(0, 60), org: String(p.org || '').slice(0, 80), handle: p.handle, photo: safeImg(p.photo), color: p.color || pr.color });
      break;
    case 'meta': {
      // метаданные чата меняет основатель или админ
      if (ch.admins.length && !isAdmin(ch, f.uid)) break;
      const kinds = ['channel', 'group', 'direct'];
      Object.assign(ch, {
        kind: kinds.includes(p.kind) ? p.kind : ch.kind, title: String(p.title || ch.title).slice(0, 64), desc: String(p.desc ?? ch.desc).slice(0, 300),
        admins: Array.isArray(p.admins) && p.admins.length ? p.admins.slice(0, 20) : (ch.admins.length ? ch.admins : [f.uid]),
        premod: !!p.premod, noai: !!p.noai, avatar: safeImg(p.avatar) || ch.avatar,
      });
      for (const m of ch.msgs.values()) m.needsMod = ch.premod && !isAdmin(ch, m.from);
      break;
    }
    case 'topic': ch.desc = String(p.topic || '').slice(0, 300); break;
    case 'dm':
      if (p.to === myUid() && typeof p.channel === 'string' && p.channel.startsWith('dm-')) {
        const d = chat(p.channel, { kind: 'direct', title: pr?.name || '…', peer: f.uid });
        if (!d.joined) S.client.joinChannel(p.channel);
      }
      break;
    default: if (p.ref) applyRef(ch, p, { uid: f.uid });
  }
  if (ch.kind === 'direct' && !ch.peer && !ev.mine) { ch.peer = f.uid; ch.title = pr?.name || ch.title; }
  schedule('stream', 'list', 'rail', 'float', 'head');
}
function note(text, chatId) {
  S.notes.unshift({ text, chatId, ts: Date.now() });
  if (S.notes.length > 50) S.notes.pop();
  schedule('bell');
}

async function send(chatId, payload) {
  if (!S.client) return;
  payload.id = randomId(8); payload.ts = Date.now(); payload.name = S.profile.name;
  onChat({ channel: chatId, payload, mine: true, from: { uid: myUid(), name: S.profile.name } });
  try {
    const r = await S.client.sendPayload(chatId, payload);
    const m = S.chats.get(chatId)?.msgs.get(payload.id);
    if (m) m.status = r?.queued ? 'queued' : 'sent';
    schedule('stream');
  } catch (e) { toast(e.message); }
  return payload.id;
}

// ---------------------------------------------------------------------
//  Отрисовка
// ---------------------------------------------------------------------
const dirty = new Set(); let raf = 0;
function schedule(...p) { p.forEach(x => dirty.add(x)); if (!raf) raf = requestAnimationFrame(flush); }
function flush() {
  raf = 0;
  if ($('#app').hidden) { dirty.clear(); return; }
  const d = new Set(dirty); dirty.clear();
  if (d.has('list')) { renderList(); renderUnread(); }
  if (d.has('rail')) renderRail();
  if (d.has('stream')) { if (S.view === 'chat') renderStream(); if (S.view === 'fame') renderFame(); if (S.thread) renderThread(); }
  if (d.has('head') && S.view === 'chat') renderHead();
  if (d.has('float') && S.float === 'info') renderInfo();
  if (d.has('bell')) $('#bell-n').hidden = S.notes.length <= S.notesSeen;
}
function renderAll() { applyI18n(); renderTabs(); renderRail(); renderList(); renderUnread(); renderCard(); renderMe(); renderPlanetName(); renderToolbar(); }

function showApp() {
  $('#app').hidden = false;
  renderAll();
  katexReady.then(() => { for (const ch of S.chats.values()) for (const m of ch.msgs.values()) m.html = null; schedule('stream'); });
  AI.initModel().then(() => { if (S.view === 'ai') renderCard(); });
  AI.onModel(() => { if (S.view === 'ai') renderAIState(); });
}
function renderMe() { $('#me-btn').innerHTML = avatarHTML(meProfile()).replace(/^<span class="avatar[^"]*"/, m => m.replace('avatar', 'avatar me')).replace(/^<span/, '<span'); }
function renderTabs() {
  $$('#tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === S.tab || (b.dataset.tab === 'ai' && S.view === 'ai'))));
}
function renderUnread() {
  const n = [...S.chats.values()].filter(c => c.unread && !c.muted).length;
  const el = $('#unread-n'); el.hidden = !n; el.textContent = n;
}

// ---------- рейка: чаты, люди и пространства вперемешку ----------
const SPACES = [
  { id: 'sp-lexi', name: 'LEXI', chats: ['lexi-news', 'sky-today'], mark: true },
  { id: 'sp-science', name: L('Наука', 'Science'), chats: ['observers', 'data-lab', 'radio', 'galaxy-zoo'] },
  { id: 'sp-orbit', name: L('Орбита', 'Orbit'), chats: ['orbit'] },
];
function chatIcon(ch) {
  if (ch.avatar) return `<span class="avatar"><img src="${ch.avatar}" alt=""></span>`;
  if (ch.kind === 'direct') return avatarHTML(who(ch.peer));
  return ico(ch.kind === 'channel' ? 'i-hash' : 'i-bubble');
}
function renderRail() {
  const items = [];
  for (const ch of S.chats.values()) items.push({ k: 'c', ts: ch.lastTs + (ch.pinned ? 1e13 : 0), ch });
  for (const p of S.people.values()) if (p.uid !== myUid() && p.chats.size && !p.lexi) items.push({ k: 'p', ts: p.lastSeen, p });
  for (const s of SPACES) items.push({ k: 's', ts: Math.max(0, ...s.chats.map(id => S.chats.get(id)?.lastTs || 0)) - 1, s });
  items.sort((a, b) => b.ts - a.ts);
  $('#rail').innerHTML = items.slice(0, 16).map(it => {
    if (it.k === 'c') return `<button type="button" class="rail-i glass" data-open="${it.ch.id}" title="${esc(it.ch.title)}" aria-current="${S.open === it.ch.id}">${it.ch.kind === 'direct' || it.ch.avatar ? chatIcon(it.ch) : it.ch.id === 'lexi-news' ? MARK_SVG : `<span class="ini">${esc(initials(it.ch.title))}</span>`}${it.ch.unread && !it.ch.muted ? `<b class="u">${it.ch.unread}</b>` : ''}</button>`;
    if (it.k === 'p') return `<button type="button" class="rail-i" data-person="${it.p.uid}" title="${esc(it.p.name)}">${avatarHTML(it.p)}${it.p.online || Date.now() - it.p.lastSeen < 180000 ? '<i class="on"></i>' : ''}</button>`;
    return `<button type="button" class="rail-i glass space" data-space="${it.s.id}" title="${esc(it.s.name)}" aria-current="${S.space === it.s.id}">${it.s.mark ? MARK_SVG : `<span style="position:relative;z-index:3">${esc(it.s.name.slice(0, 2))}</span>`}</button>`;
  }).join('');
}

// ---------- список ----------
function lastMsg(ch) { let l = null; for (const m of ch.msgs.values()) if (!m.thread && (!l || m.ts > l.ts)) l = m; return l; }
function preview(m) {
  if (!m) return '';
  const name = m.mine ? L('Вы', 'You') : (who(m.from).name || '').split(' ')[0];
  const txt = m.text ? m.text.replace(/```[\s\S]*?```/g, '[code]').replace(/\$+([^$]*)\$+/g, '$1').replace(/[*_`#>]/g, '') : (m.att[0] ? '📎 ' + m.att[0].name : '');
  return `${name}: ${txt}`.slice(0, 90);
}
function renderList() {
  const box = $('#list-items');
  if (S.tab === 'threads') return renderThreadList(box);
  const space = SPACES.find(s => s.id === S.space);
  let list = [...S.chats.values()];
  if (space) list = list.filter(c => space.chats.includes(c.id));
  if (S.tab === 'channels') list = list.filter(c => c.kind === 'channel');
  if (S.tab === 'chats') list = list.filter(c => c.kind !== 'channel');
  if (S.tab === 'unread') list = list.filter(c => c.unread);
  list.sort((a, b) => (b.pinned - a.pinned) || (b.lastTs - a.lastTs));
  const edit = S.tab === 'edit';
  const fame = !space && ['all', 'channels'].includes(S.tab) ? `<div class="li glass" role="button" tabindex="0" data-fame aria-current="${S.view === 'fame'}"><span class="li-ic fame">${ico('i-star')}</span><span class="li-body"><span class="li-name">${t('fame')}</span></span></div>` : '';
  const empty = { unread: 'empty.unread', chats: 'empty.chats' }[S.tab];
  box.innerHTML = fame + (list.length ? list.map(c => `
    <div class="li glass ${c.muted ? 'muted' : ''}" role="button" tabindex="0" data-open="${c.id}" aria-current="${S.open === c.id && S.view === 'chat'}">
      <span class="li-ic">${chatIcon(c)}</span>
      <span class="li-body"><span class="li-name">${esc(c.title)}</span><span class="li-sub">${esc(preview(lastMsg(c)) || c.desc)}</span></span>
      ${edit ? `<span class="li-tools"><button type="button" data-pin="${c.id}" class="${c.pinned ? 'on' : ''}" aria-label="pin">${ico('i-pin')}</button><button type="button" data-mute="${c.id}" class="${c.muted ? 'on' : ''}" aria-label="mute">${ico('i-mute')}</button>${CHATS.some(x => x.id === c.id) ? '' : `<button type="button" data-leave="${c.id}" aria-label="leave">${ico('i-x')}</button>`}</span>` : (c.unread ? `<b class="li-n">${c.unread}</b>` : '')}
    </div>`).join('') : `<p class="empty">${t(empty || 'empty.chats')}</p>`);
}
function renderThreadList(box) {
  const roots = [];
  for (const c of S.chats.values()) {
    const n = new Map();
    for (const m of c.msgs.values()) if (m.thread) n.set(m.thread, (n.get(m.thread) || 0) + 1);
    for (const [id, k] of n) { const r = c.msgs.get(id); if (r) roots.push({ c, r, k }); }
  }
  box.innerHTML = roots.length ? roots.map(({ c, r, k }) => `<div class="li glass" role="button" tabindex="0" data-thread="${c.id}|${r.id}"><span class="li-ic">${ico('i-thread')}</span><span class="li-body"><span class="li-name">${esc(c.title)} · ${k}</span><span class="li-sub">${esc(preview(r))}</span></span></div>`).join('') : `<p class="empty">${t('empty.threads')}</p>`;
}

// ---------- карточка ----------
function openChat(id, { thread } = {}) {
  if (!S.chats.has(id)) return;
  const ta = $('#msg'); if (ta && S.open) S.drafts[S.open] = ta.value;
  S.open = id; S.view = 'chat'; S.float = null; S.thread = thread || null;
  const ch = chat(id); ch.unread = 0;
  if (S.tab === 'ai') S.tab = 'all';
  renderCard(); renderList(); renderRail(); renderUnread(); renderTabs();
}
function closeCard() {
  S.open = null; S.view = null; S.float = null; S.thread = null;
  renderCard(); renderList(); renderRail(); renderTabs();
}
function renderCard() {
  const card = $('#card');
  const open = !!S.view;
  card.hidden = !open;
  document.body.classList.toggle('chat-open', open);
  $('#home-hint').hidden = open;
  renderPlanetName(); renderTabs();
  if (!open) { card.innerHTML = ''; return; }
  if (S.view === 'chat') return renderChatCard();
  if (S.view === 'ai') return renderAICard();
  if (S.view === 'search') return renderSearchCard();
  if (S.view === 'fame') return renderFameCard();
}
const backBtn = () => `<button type="button" class="icon-btn" data-close aria-label="${L('Назад', 'Back')}">${ico(innerWidth <= 820 ? 'i-back' : 'i-x')}</button>`;

function renderChatCard() {
  const card = $('#card');
  card.innerHTML = `<canvas class="card-bg" id="const" aria-hidden="true"></canvas><header class="card-head" id="chat-head"></header><div class="stream" id="stream"></div><footer class="composer" id="composer"></footer><div id="float"></div><div id="thread"></div>`;
  renderHead(); renderStream(true); renderComposer();
  if (S.thread) renderThread();
  const id = S.open;
  loadConstellations().then(() => { const c = $('#const'); if (c && S.open === id) paintConstellations(c, constellationFor(id), { labelTop: 92, color: getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '196,157,71' }); });
}
function renderHead() {
  const el = $('#chat-head'); if (!el) return;
  const ch = chat(S.open);
  const n = ch.members.size + 1;
  const sub = ch.kind === 'direct' ? (who(ch.peer).role || '') : `${n} ${t('members')}${ch.desc ? ' · ' + ch.desc : ''}`;
  el.innerHTML = `${innerWidth <= 820 ? backBtn() : ''}
    <span class="avatar" style="background:${ch.kind === 'direct' ? who(ch.peer).color : 'rgba(var(--accent-rgb),.15)'};color:var(--accent-hi)">${ch.kind === 'direct' ? (safeImg(who(ch.peer).photo) ? `<img src="${who(ch.peer).photo}" alt="">` : esc(initials(ch.title))) : (ch.avatar ? `<img src="${ch.avatar}" alt="">` : (ch.id === 'lexi-news' ? MARK_SVG : ico(ch.kind === 'channel' ? 'i-hash' : 'i-bubble')))}</span>
    <div class="ch-title"><b>${esc(ch.title)}</b><span>${esc(sub)}</span></div>
    <button type="button" class="icon-btn lock-btn ${ch.key ? '' : 'wait'}" data-lock aria-label="${t('lock.title')}">${ico('i-lock')}</button>
    <button type="button" class="icon-btn ${S.float === 'info' ? 'on' : ''}" data-info aria-label="${t('info.title')}">${ico('i-info')}</button>
    ${innerWidth > 820 ? backBtn() : ''}`;
}

function msgHTML(m, ch, prev, inThread) {
  const p = who(m.from);
  const lexi = m.via === 'lexiai';
  const cont = prev && prev.from === m.from && m.ts - prev.ts < 5 * 60e3 && !lexi && prev.via !== 'lexiai';
  if (m.html == null) m.html = renderText(m.text, { channels: new Set(), me: S.profile?.handle || '' });
  if (ch.noai && m.ai && !m.mine) return '';
  const hidden = m.needsMod && m.approved !== true;
  const admin = iAmAdmin(ch);
  const rs = [...m.reactions].map(([e, s]) => `<button type="button" class="react glass" data-act="react" data-emoji="${esc(e)}"><span>${esc(e)}</span><b>${s.size}</b></button>`).join('');
  const mineRs = [...m.reactions].filter(([, s]) => s.has(myUid())).map(([e]) => e);
  const replies = inThread ? 0 : [...ch.msgs.values()].filter(x => x.thread === m.id).length;
  const quote = m.reply ? ch.msgs.get(m.reply) : null;
  const score = admin && !m.mine && !m.ai && !lexi ? aiLikelihood(m.text) : null;
  const showName = !m.mine && !cont && ch.kind !== 'direct';
  const nameLine = lexi
    ? `<div class="who"><b>LexiAI</b> · ${t('ai.via')} ${esc(who(m.from).name)}</div>`
    : showName ? `<div class="who"><b>${esc(p.name)}</b>${p.verified ? `<svg class="ico vf" aria-label="${t('verified')}"><title>${t('verified')}</title><use href="#i-verified"/></svg>` : ''}${p.role ? ' · ' + esc(p.role) : ''}</div>` : '';
  const fresh = S.fresh.has(m.id);
  if (fresh) setTimeout(() => S.fresh.delete(m.id), 800);
  return `<div class="row ${m.mine ? 'mine' : ''} ${cont ? 'cont' : ''} ${hidden && !m.mine && !admin ? 'hidden-mod' : ''} ${fresh ? 'new' : ''}" data-id="${m.id}">
    ${lexi ? `<span class="avatar" style="background:var(--bg);color:var(--accent)">${MARK_SVG}</span>` : m.mine ? '' : avatarHTML(p)}
    <div class="bwrap">${nameLine}
      <div class="bubble glass">
        ${m.fwd ? `<span class="fwd">↪ ${t('forwarded')}: ${esc(m.fwd)}</span>` : ''}
        ${quote ? `<span class="quote">${esc(preview(quote))}</span>` : ''}
        ${m.att.length ? `<div class="atts">${m.att.map((a, i) => attHTML(a, i)).join('')}</div>` : ''}
        ${m.text ? `<span class="btext">${m.html}</span>` : ''}
        <span class="bmeta">${m.ai || lexi ? `<span class="tag ai">${t('ai.label')}</span>` : ''}${score != null && score >= 0.55 ? `<span class="tag warn" title="${L('Оценка неточная', 'Rough estimate')}">${t('mod.ai')} · ${Math.round(score * 100)}%</span>` : ''}${fmtTime(m.ts)}${m.mine ? (m.status === 'delivered' ? ' ✓✓' : ' ✓') : ''}</span>
      </div>
      ${hidden ? `<div class="premod">${m.mine ? t('mod.mine') : t('mod.pending')}${admin && !m.mine ? ` <button type="button" class="btn-line sm" data-act="approve">${t('mod.approve')}</button><button type="button" class="btn-line sm danger" data-act="reject">${t('mod.reject')}</button>` : ''}</div>` : ''}
      ${m.approved === false ? `<div class="premod">${t('mod.rejected')}</div>` : ''}
      ${rs ? `<div class="reacts" data-mine="${esc(mineRs.join(''))}">${rs}</div>` : ''}
      ${replies ? `<button type="button" class="thread-link" data-act="thread">${replies} ${t('replies')} →</button>` : ''}
    </div>
    <div class="acts glass" role="toolbar">
      <button type="button" data-act="emoji" title="${t('act.react')}" aria-label="${t('act.react')}">${ico('i-smile')}</button>
      ${inThread ? '' : `<button type="button" data-act="thread" title="${t('act.reply')}" aria-label="${t('act.reply')}">${ico('i-thread')}</button>`}
      <button type="button" data-act="forward" title="${t('act.forward')}" aria-label="${t('act.forward')}">${ico('i-fwd')}</button>
    </div>
  </div>`;
}
const fitsCache = new WeakMap();
function fitsUrl(a) {
  let u = fitsCache.get(a);
  if (u === undefined) {
    try { a._img = parseFits(unb64(a.data)); u = fitsToCanvas(a._img, { cmap: 'gold', stretch: 'asinh' }).toDataURL(); } catch { u = ''; }
    fitsCache.set(a, u);
  }
  return u;
}
function attHTML(a, i) {
  if (a.kind === 'fits') {
    const u = fitsUrl(a), h = a._img?.header || {};
    return `<button type="button" class="att" data-act="fits" data-i="${i}">${u ? `<img src="${u}" alt="FITS ${esc(h.OBJECT || '')}">` : ''}<span class="att-cap">FITS · ${esc(h.OBJECT || a.name)}${a._img ? ` · ${a._img.width}×${a._img.height}` : ''}</span></button>`;
  }
  if (a.kind === 'image') { const s = safeImg(a.data); return s ? `<button type="button" class="att" data-act="img" data-i="${i}"><img src="${s}" alt=""></button>` : ''; }
  return '';
}
function streamHTML(ch, thread) {
  const items = [...ch.msgs.values()].filter(m => thread ? (m.id === thread || m.thread === thread) : !m.thread).sort((a, b) => a.ts - b.ts);
  let html = '', day = '', prev = null;
  for (const m of items) {
    const d = dayLabel(m.ts);
    if (d !== day && !thread) { html += `<div class="day">${d}</div>`; day = d; prev = null; }
    html += msgHTML(m, ch, prev, !!thread); prev = m;
  }
  return html || `<p class="empty">${ch.key ? t('empty.chat') : t('lock.wait')}</p>`;
}
function renderStream(force) {
  const el = $('#stream'); if (!el) return;
  const ch = chat(S.open);
  const bottom = force || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  el.innerHTML = streamHTML(ch);
  if (bottom) el.scrollTop = el.scrollHeight;
}

// ---------- композер ----------
function composerHTML(id) {
  return `<button type="button" class="round glass ${S.aiFlag && id === 'msg' ? 'ai-on' : ''}" data-plus="${id}" aria-label="+">${ico('i-plus')}</button>
    <div class="compose-box glass"><div class="preview" id="${id}-pv" hidden></div><div class="att-chips" id="${id}-att" hidden></div>
    <textarea id="${id}" rows="1" placeholder="${t('msg.ph')}" aria-label="${t('msg.ph')}"></textarea></div>
    <button type="button" class="round send" data-send="${id}" aria-label="${L('Отправить', 'Send')}">${ico('i-send')}</button>`;
}
function renderComposer() {
  const el = $('#composer'); if (!el) return;
  const ch = chat(S.open);
  if (ch.kind === 'channel' && ch.admins.length && !isAdmin(ch, myUid())) {
    el.innerHTML = `<div class="only-admins glass"><span>${t('channel.only')}</span></div>`; return;
  }
  el.innerHTML = composerHTML('msg');
  const ta = $('#msg'); ta.value = S.drafts[S.open] || '';
  wireTextarea(ta, () => submit('msg'), $('#msg-pv'));
  renderAttChips();
}
function wireTextarea(ta, onSend, pv) {
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 176) + 'px'; };
  ta.addEventListener('input', () => {
    grow();
    if (pv) { const v = ta.value, on = /\$[^$]+\$|\\\[/.test(v); pv.hidden = !on; if (on) pv.innerHTML = renderText(v); }
  });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onSend(); } });
  grow();
}
function renderAttChips() {
  const box = $('#msg-att'); if (!box) return;
  box.hidden = !S.att.length;
  box.innerHTML = S.att.map((a, i) => `<span class="tag">📎 ${esc(a.name)} <button type="button" data-rm="${i}" aria-label="×">×</button></span>`).join('');
  box.onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { S.att.splice(+b.dataset.rm, 1); renderAttChips(); } };
}
async function attachFiles(files) {
  for (const f of files.slice(0, 4)) {
    if (f.size > 4.5 * 1024 * 1024) { toast(L(`${f.name}: больше 4,5 МБ`, `${f.name}: over 4.5 MB`)); continue; }
    const buf = new Uint8Array(await f.arrayBuffer());
    if (/\.(fits?|fts)$/i.test(f.name) || isFits(buf)) {
      try { parseFits(buf); } catch (e) { toast(`${f.name}: ${e.message}`); continue; }
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      S.att.push({ kind: 'fits', name: f.name, size: f.size, data: btoa(s) });
    } else if (f.type.startsWith('image/')) {
      const r = await downscaleImage(f, 1600);
      S.att.push({ kind: 'image', name: f.name, size: r.data.length, data: r.data, w: r.w, h: r.h });
    }
  }
  renderAttChips();
}

async function submit(id) {
  const ta = $('#' + id); if (!ta) return;
  const text = ta.value.trim();
  if (id === 'ai') { if (text) { ta.value = ''; ta.dispatchEvent(new Event('input')); askAI(text); } return; }
  const inThread = id === 'th';
  if (!text && !(S.att.length && !inThread)) return;
  ta.value = ''; ta.dispatchEvent(new Event('input'));
  const chId = S.open;
  const p = { t: 'text', text };
  if (inThread) p.thread = S.thread;
  else { p.att = S.att.splice(0); renderAttChips(); }
  if (S.aiFlag && !inThread) p.ai = true;
  const mid = await send(chId, p);
  if (!inThread) { const s = $('#stream'); if (s) s.scrollTop = s.scrollHeight; }
  // @lexi — ответ LexiAI прямо в чат, с меткой ИИ
  if (/(^|\s)@lexi(ai)?\b/i.test(text)) {
    const q = text.replace(/(^|\s)@lexi(ai)?\b/ig, ' ').trim();
    if (q) {
      const r = await AI.answer(q, { local: await localSkill(q) });
      send(chId, { t: 'text', text: r.text, ai: true, via: 'lexiai', reply: mid, thread: inThread ? S.thread : undefined });
    }
  }
}

// ---------- окошко «о чате» и замок ----------
function renderInfo() {
  const slot = $('#float'); if (!slot) return;
  if (S.float !== 'info') { slot.innerHTML = ''; return; }
  if (slot.contains(document.activeElement) && slot.firstChild) return;
  const ch = chat(S.open);
  const admin = iAmAdmin(ch);
  const members = [myUid(), ...ch.members].map(who);
  const media = [];
  for (const m of ch.msgs.values()) m.att.forEach((a, i) => media.push({ m, a, i }));
  const avatar = ch.avatar ? `<img src="${ch.avatar}" alt="">` : ch.kind === 'direct' ? esc(initials(ch.title)) : ico(ch.kind === 'channel' ? 'i-hash' : 'i-bubble');
  slot.innerHTML = `<aside class="float glass">
    <button type="button" class="icon-btn f-x" data-float-x aria-label="×">${ico('i-x')}</button>
    <div class="info-head">${admin ? `<label class="avatar" style="background:rgba(var(--accent-rgb),.15);color:var(--accent-hi)"><input type="file" accept="image/*" id="chat-avatar" hidden>${avatar}</label>` : `<span class="avatar" style="background:rgba(var(--accent-rgb),.15);color:var(--accent-hi)">${avatar}</span>`}
      <div style="min-width:0;flex:1">${admin && ch.kind !== 'direct' ? `<input class="inp" id="chat-title" value="${esc(ch.title)}" maxlength="64">` : `<h3>${esc(ch.title)}</h3>`}</div></div>
    ${ch.kind !== 'direct' ? (admin ? `<div class="field"><span>${t('info.desc')}</span><textarea class="inp" id="chat-desc" rows="2" maxlength="300">${esc(ch.desc)}</textarea><button type="button" class="btn-line sm" id="chat-save" style="justify-self:start">${t('info.save')}</button></div>` : (ch.desc ? `<p style="margin:0;font-size:.88rem;color:var(--ink2)">${esc(ch.desc)}</p>` : '')) : ''}
    ${ch.kind !== 'direct' ? `<div style="display:grid;gap:.5rem"><h4>${t('info.members')} · ${members.length}</h4><div class="members">${members.map(p => `<div class="member">${avatarHTML(p)}<span class="nm"><b>${esc(p.name)}${p.verified ? `<svg class="ico vf"><title>${t('verified')}</title><use href="#i-verified"/></svg>` : ''}</b><span>${esc(p.role || '')}${isAdmin(ch, p.uid) ? ' · ' + t('info.admin') : ''}</span></span></div>`).join('')}</div></div>` : ''}
    <div style="display:grid;gap:.5rem"><h4>${t('info.media')}</h4>${media.length ? `<div class="media">${media.slice(-12).reverse().map(({ m, a, i }) => a.kind === 'fits' ? `<button type="button" data-media="${m.id}|${i}"><img src="${fitsUrl(a)}" alt=""></button>` : a.kind === 'image' ? `<button type="button" data-media="${m.id}|${i}"><img src="${safeImg(a.data)}" alt=""></button>` : '').join('')}</div>` : `<p style="margin:0;font-size:.82rem;color:var(--mute)">${t('info.nomedia')}</p>`}</div>
    ${admin && ch.kind === 'group' ? `<label style="display:flex;gap:.5rem;align-items:center;font-size:.85rem"><input type="checkbox" id="chat-premod" ${ch.premod ? 'checked' : ''}> ${t('new.premod')}</label><label style="display:flex;gap:.5rem;align-items:center;font-size:.85rem"><input type="checkbox" id="chat-noai" ${ch.noai ? 'checked' : ''}> ${t('new.noai')}</label>` : ''}
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button type="button" class="btn-line sm" id="chat-mute">${ch.muted ? t('info.unmute') : t('info.mute')}</button>${CHATS.some(x => x.id === ch.id) ? '' : `<button type="button" class="btn-line sm danger" id="chat-leave">${t('info.leave')}</button>`}</div>
  </aside>`;
  const sendMeta = extra => send(ch.id, { t: 'meta', kind: ch.kind, title: ch.title, desc: ch.desc, admins: ch.admins.length ? ch.admins : [myUid()], premod: ch.premod, noai: ch.noai, avatar: ch.avatar, ...extra });
  $('#chat-save') && ($('#chat-save').onclick = () => { ch.title = $('#chat-title')?.value.trim() || ch.title; ch.desc = $('#chat-desc').value.trim(); sendMeta(); toast(t('saved')); renderHead(); renderList(); });
  $('#chat-avatar') && ($('#chat-avatar').onchange = async e => { const f = e.target.files[0]; if (!f) return; ch.avatar = await squareAvatar(f); sendMeta(); slot.innerHTML = ''; renderInfo(); renderHead(); renderList(); });
  $('#chat-premod') && ($('#chat-premod').onchange = e => { ch.premod = e.target.checked; sendMeta(); });
  $('#chat-noai') && ($('#chat-noai').onchange = e => { ch.noai = e.target.checked; sendMeta(); renderStream(); });
  $('#chat-mute').onclick = () => { ch.muted = !ch.muted; slot.innerHTML = ''; renderInfo(); renderList(); };
  $('#chat-leave') && ($('#chat-leave').onclick = () => { S.client.leaveChannel(ch.id); S.chats.delete(ch.id); saveCustom(); closeCard(); });
}
function lockPop(anchor) {
  const ch = chat(S.open);
  pop(anchor, `<h4>${t('lock.title')}</h4><p>${ch.key ? t('lock.text') : t('lock.wait')}</p>${ch.key ? `<button type="button" class="pi" data-x="verify">${ico('i-check')} ${t('lock.verify')}</button>` : ''}`, e => {
    if (e.target.closest('[data-x="verify"]')) { closePop(); verifyModal(ch); }
  });
}
function verifyModal(ch) {
  const ps = [...ch.members].map(who).filter(p => p.fp);
  modal(t('verify.title'), `<p style="margin:0;color:var(--ink2)">${t('verify.text')}</p>
    <div><div class="field"><span>${esc(S.profile.name)}</span></div><p class="fp">${S.identity.fingerprint}</p></div>
    ${ps.map(p => `<div style="display:grid;gap:.3rem"><div class="member">${avatarHTML(p)}<span class="nm"><b>${esc(p.name)}</b></span>${S.keysOk.has(p.fp) ? `<span class="tag">${ico('i-check')} ${t('verify.done')}</span>` : `<button type="button" class="btn-line sm" data-ok="${p.uid}">${t('verify.ok')}</button>`}</div><p class="fp" style="font-size:.8rem">${p.fp}</p></div>`).join('')}`,
  { onMount: el => el.addEventListener('click', e => { const b = e.target.closest('[data-ok]'); if (b) { S.keysOk.add(who(b.dataset.ok).fp); closeModal(); verifyModal(ch); } }) });
}

// ---------- ветка ----------
function renderThread() {
  const slot = $('#thread'); if (!slot) return;
  if (!S.thread) { slot.innerHTML = ''; return; }
  const ch = chat(S.open);
  if (!$('#th-stream')) {
    slot.innerHTML = `<aside class="thread-pane glass"><header class="card-head"><b>${t('thread')}</b><button type="button" class="icon-btn" data-thread-x aria-label="×">${ico('i-x')}</button></header><div class="stream" id="th-stream"></div><footer class="composer">${composerHTML('th')}</footer></aside>`;
    wireTextarea($('#th'), () => submit('th'));
  }
  const s = $('#th-stream');
  s.innerHTML = streamHTML(ch, S.thread);
  s.scrollTop = s.scrollHeight;
}

// ---------- LexiAI ----------
function renderAICard() {
  const card = $('#card');
  card.innerHTML = `<canvas class="card-bg" id="deep" aria-hidden="true"></canvas>
    <header class="card-head">${innerWidth <= 820 ? backBtn() : ''}<span class="avatar" style="background:var(--bg);color:var(--accent)">${MARK_SVG}</span><div class="ch-title"><b>LexiAI</b><span id="ai-state-line"></span></div><span id="ai-state"></span>${innerWidth > 820 ? backBtn() : ''}</header>
    <div class="pad" id="ai-log"></div>
    <footer class="composer">${composerHTML('ai').replace(/<button type="button" class="round glass[^>]*>.*?<\/button>/, '')}</footer>`;
  requestAnimationFrame(() => paintDeepSpace($('#deep'), 29));
  wireTextarea($('#ai'), () => submit('ai'));
  renderAIState(); renderAILog();
  AI.openKnowledge().catch(() => {});
}
function renderAIState() {
  const el = $('#ai-state'), line = $('#ai-state-line'); if (!el) return;
  const m = AI.model;
  line.textContent = m.state === 'ready' ? t('ai.ready') : t('ai.base');
  if (m.state === 'off' || m.state === 'downloaded' || m.state === 'failed') el.innerHTML = `<button type="button" class="btn-line sm" id="ai-enable">${m.state === 'failed' ? t('ai.failed') + ' · ↻' : `${t('ai.enable')} · ${(m.sizeMB / 1024).toFixed(1)} ${L('ГБ', 'GB')}`}</button>`;
  else if (m.state === 'downloading' || m.state === 'loading') el.innerHTML = `<span class="ai-state">${t('ai.loading')} <span class="bar"><i style="width:${Math.round(m.progress * 100)}%"></i></span> ${Math.round(m.progress * 100)}%</span>`;
  else if (m.state === 'missing') el.innerHTML = `<a class="btn-line sm" href="https://lexi-space.netlify.app/" target="_blank" rel="noopener noreferrer">${t('ai.missing')} ↗</a>`;
  else el.innerHTML = '';
  const b = $('#ai-enable'); if (b) b.onclick = () => AI.startModel().catch(() => {});
}
function renderAILog() {
  const box = $('#ai-log'); if (!box) return;
  const hints = ['ai.hint1', 'ai.hint2', 'ai.hint3', 'ai.hint4'].map(k => `<button type="button" class="chip" data-hint="${esc(t(k))}">${esc(t(k))}</button>`).join('');
  box.innerHTML = S.ai.map((m, i) => `<div class="row ${m.me ? 'mine' : ''}">${m.me ? '' : `<span class="avatar" style="background:var(--bg);color:var(--accent)">${MARK_SVG}</span>`}<div class="bwrap"><div class="bubble glass"><span class="btext">${m.html}</span>${m.sources?.length ? `<span class="src">${t('ai.sources')}: ${m.sources.map(esc).join('; ')}</span>` : ''}</div>${!m.me && m.done && S.open ? `<button type="button" class="thread-link" data-ai-send="${i}">${t('ai.send')}: ${esc(chat(S.open).title)} →</button>` : ''}</div></div>`).join('') + (S.ai.length ? '' : `<div class="hint-chips">${hints}</div>`);
  box.scrollTop = box.scrollHeight;
}
async function askAI(q) {
  if (S.aiBusy) return;
  S.aiBusy = true;
  S.ai.push({ me: true, html: esc(q) });
  const a = { me: false, html: '…', done: false };
  S.ai.push(a); renderAILog();
  const history = S.ai.filter(x => x.raw).slice(-4).map(x => ({ role: x.me ? 'user' : 'assistant', content: x.raw }));
  const r = await AI.answer(q, { local: await localSkill(q), history, onText: txt => { a.html = esc(txt); const b = $('#ai-log .row:last-child .btext'); if (b) b.textContent = txt; } });
  // печать ответа
  const plain = r.text;
  for (let i = 0; i <= plain.length; i += 4) { a.html = esc(plain.slice(0, i)); const b = $('#ai-log .row:last-child .btext'); if (b) b.innerHTML = a.html; await wait(8); }
  a.html = renderText(r.text); a.raw = r.text; a.sources = r.sources; a.done = true;
  S.aiBusy = false;
  renderAILog();
}
// Расчёты прямо в мессенджере: доплер, орбита, объекты, Луна, планеты
async function localSkill(q) {
  const s = q.toLowerCase().replace(/,/g, '.');
  if (/доплер|doppler/.test(s)) {
    const fm = s.match(/(\d+(?:\.\d+)?)\s*(ггц|мгц|кгц|гц|ghz|mhz|khz|hz)/), vm = s.match(/(-?\d+(?:\.\d+)?)\s*(км\/с|km\/s|м\/с|m\/s)/);
    if (fm && vm) {
      const mult = { 'ггц': 1e9, ghz: 1e9, 'мгц': 1e6, mhz: 1e6, 'кгц': 1e3, khz: 1e3, 'гц': 1, hz: 1 }[fm[2]];
      const f0 = +fm[1] * mult, v = +vm[1] * (/км|km/.test(vm[2]) ? 1e3 : 1), df = f0 * v / 299792458;
      const f = x => Math.abs(x) >= 1e3 ? (x / 1e3).toFixed(2) + ' кГц' : x.toFixed(1) + ' Гц';
      const text = `$\\Delta f = f_0 \\frac{v}{c} \\approx ${f(df).replace(' ', '\\,\\text{')}}$`;
      return { text: text.replace(/(кГц|Гц)\}?\$$/, '$1}$'), calc: `доплеровский сдвиг Δf = f0·v/c = ${f(df)} при f0 = ${fm[1]} ${fm[2]}, v = ${vm[1]} ${vm[2]}` };
    }
  }
  const hm = s.match(/(\d+(?:\.\d+)?)\s*(км|km)\b/);
  if (/орбит|orbit|период|period|скорост/.test(s) && hm) {
    const h = +hm[1], mu = 398600.4418, r = 6378.137 + h, v = Math.sqrt(mu / r), T = 2 * Math.PI * Math.sqrt(r ** 3 / mu) / 60;
    return { text: `$v = \\sqrt{GM/r} \\approx ${v.toFixed(3)}$ км/с, $T \\approx ${T.toFixed(1)}$ мин`, calc: `круговая орбита h = ${h} км: v = ${v.toFixed(3)} км/с, период ${T.toFixed(1)} мин` };
  }
  const obs = AS.observer(profileLoc());
  const mm = s.match(/\bm\s?(\d{1,3})\b/);
  if (mm) {
    const o = (await AS.loadMessier()).find(x => x.id === 'M' + mm[1]);
    if (o) {
      const h = AS.altAz({ ra: o.ra, dec: o.dec }, new Date(), obs);
      const line = `${o.id}${o.name !== o.id ? ' (' + o.name + ')' : ''}: RA ${AS.fmtHMS(o.ra)}, Dec ${AS.fmtDMS(o.dec)}, ${o.mag}ᵐ; сейчас высота ${h.alt.toFixed(0)}°, азимут ${h.az.toFixed(0)}°`;
      return { text: line, live: line };
    }
  }
  const pl = Object.entries(AS.PLANET_RU).find(([en, ru]) => en !== 'Sun' && (s.includes(ru.toLowerCase().slice(0, 5)) || s.includes(en.toLowerCase())));
  if (pl) {
    const h = AS.altAz({ body: AS.A.Body[pl[0]] }, new Date(), obs);
    const line = `${L(pl[1], pl[0])}: высота ${h.alt.toFixed(0)}°, азимут ${h.az.toFixed(0)}° (${profileLoc().lat.toFixed(1)}°, ${profileLoc().lon.toFixed(1)}°)`;
    return { text: line, live: line };
  }
  if (/луна|moon|фаз/.test(s)) {
    const n = AS.nightReport(new Date(), obs);
    const line = `${AS.phaseName(n.phaseAngle, getLang())}, ${Math.round(n.illum * 100)} %`;
    return { text: line, live: line };
  }
  return null;
}
function profileLoc() {
  const lat = parseFloat(String(S.profile?.lat ?? '').replace(',', '.')), lon = parseFloat(String(S.profile?.lon ?? '').replace(',', '.'));
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : { lat: 53.9, lon: 27.56 };
}

// ---------- поиск ----------
function renderSearchCard() {
  const card = $('#card');
  const mob = innerWidth <= 820;
  card.innerHTML = `<canvas class="card-bg" id="deep" aria-hidden="true"></canvas><header class="card-head">${mob ? backBtn() + `<input class="search-in" id="search2" type="search" value="${esc(S.search)}" placeholder="${t('search')}" aria-label="${t('search')}">` : `<div class="ch-title"><b>${t('search')}</b><span>${esc(S.search)}</span></div>` + backBtn()}</header><div class="pad" id="search-res"></div>`;
  requestAnimationFrame(() => paintDeepSpace($('#deep'), 11));
  const s2 = $('#search2');
  if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); s2.oninput = () => { S.search = $('#search').value = s2.value; renderSearchResults(); }; }
  renderSearchResults();
}
async function renderSearchResults() {
  const out = $('#search-res'); if (!out) return;
  const q = S.search.trim().toLowerCase();
  if (q.length < 2) { out.innerHTML = ''; return; }
  const hl = s => esc(s).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
  const msgs = [];
  for (const ch of S.chats.values()) for (const m of ch.msgs.values()) if (m.text.toLowerCase().includes(q)) msgs.push({ ch, m });
  msgs.sort((a, b) => b.m.ts - a.m.ts);
  const chats = [...S.chats.values()].filter(c => (c.title + ' ' + c.desc).toLowerCase().includes(q));
  const ppl = [...S.people.values()].filter(p => (p.name + ' ' + (p.role || '')).toLowerCase().includes(q));
  const cat = (await AS.loadMessier()).filter(o => (o.id + ' ' + o.name).toLowerCase().includes(q)).slice(0, 5);
  out.innerHTML = `
    ${chats.length ? `<p class="sec-h">${L('Чаты', 'Chats')}</p>${chats.map(c => `<button type="button" class="res glass" data-open="${c.id}"><span class="li-ic">${chatIcon(c)}</span><span class="rb"><b>${hl(c.title)}</b><p>${esc(c.desc)}</p></span></button>`).join('')}` : ''}
    ${ppl.length ? `<p class="sec-h">${L('Люди', 'People')}</p>${ppl.map(p => `<button type="button" class="res glass" data-person="${p.uid}">${avatarHTML(p)}<span class="rb"><b>${hl(p.name)}</b><p>${esc(p.role || '')}</p></span></button>`).join('')}` : ''}
    ${msgs.length ? `<p class="sec-h">${L('Сообщения', 'Messages')}</p>${msgs.slice(0, 30).map(({ ch, m }) => `<button type="button" class="res glass" data-goto="${ch.id}|${m.id}|${m.thread || ''}">${avatarHTML(who(m.from))}<span class="rb"><b>${esc(who(m.from).name)}</b> · <span style="color:var(--mute);font-size:.75rem">${esc(ch.title)}</span><p>${hl(m.text.slice(0, 200))}</p></span></button>`).join('')}` : ''}
    ${cat.length ? `<p class="sec-h">${L('Каталог Мессье', 'Messier catalogue')}</p>${cat.map(o => `<button type="button" class="res glass obj-res" data-obj="${o.id}"><span class="rb"><b>${o.id}${o.name !== o.id ? ' · ' + esc(o.name) : ''}</b><p>${AS.fmtHMS(o.ra)} ${AS.fmtDMS(o.dec)} · ${o.mag}ᵐ</p></span></button>`).join('')}` : ''}
    <p class="sec-h">${L('Каталоги', 'Catalogues')}</p><div class="chips">${catalogLinks(S.search.trim()).map(l => `<a class="chip" href="${l.href}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}</div>`;
}

// ---------- зал славы ----------
function renderFameCard() {
  $('#card').innerHTML = `<header class="card-head">${innerWidth <= 820 ? backBtn() : ''}<span class="avatar">${ico('i-star')}</span><div class="ch-title"><b>${t('fame')}</b><span>${t('fame.empty')}</span></div>${innerWidth > 820 ? backBtn() : ''}</header><div class="pad" id="fame"></div>`;
  renderFame();
}
function renderFame() {
  const box = $('#fame'); if (!box) return;
  const items = [];
  for (const ch of S.chats.values()) for (const m of ch.msgs.values()) { const n = reactors(m).size; if (n >= 3) items.push({ ch, m, n }); }
  items.sort((a, b) => b.n - a.n || b.m.ts - a.m.ts);
  box.innerHTML = items.length ? items.map(({ ch, m, n }) => {
    const p = who(m.from), a = m.att.find(x => x.kind === 'fits');
    return `<button type="button" class="fame-item glass" data-goto="${ch.id}|${m.id}|${m.thread || ''}"><div class="who" style="margin:0">${avatarHTML(p)} <b>${esc(p.name)}</b>${p.verified ? `<svg class="ico vf"><use href="#i-verified"/></svg>` : ''} · ${esc(ch.title)}</div>${a ? `<img src="${fitsUrl(a)}" alt="" style="width:160px;border-radius:12px;filter:var(--img-filter)">` : ''}<span class="snip">${esc(m.text.replace(/\$+/g, '').slice(0, 220))}</span><span class="rs">${[...m.reactions].map(([e, s]) => `${esc(e)} ${s.size}`).join('  ')}</span></button>`;
  }).join('') : `<p class="empty">${t('fame.empty')}</p>`;
}

// ---------------------------------------------------------------------
//  Действия с сообщениями
// ---------------------------------------------------------------------
function onCardClick(e) {
  if (e.target.closest('[data-close]')) return closeCard();
  if (e.target.closest('[data-info]')) { S.float = S.float === 'info' ? null : 'info'; renderInfo(); renderHead(); return; }
  if (e.target.closest('[data-float-x]')) { S.float = null; renderInfo(); renderHead(); return; }
  if (e.target.closest('[data-lock]')) return lockPop(e.target.closest('[data-lock]'));
  if (e.target.closest('[data-thread-x]')) { S.thread = null; renderThread(); return; }
  const plus = e.target.closest('[data-plus]'); if (plus) return plusMenu(plus);
  const snd = e.target.closest('[data-send]'); if (snd) return submit(snd.dataset.send);
  const hint = e.target.closest('[data-hint]'); if (hint) return askAI(hint.dataset.hint);
  const as = e.target.closest('[data-ai-send]');
  if (as) { const m = S.ai[+as.dataset.aiSend]; if (m?.raw && S.open) { send(S.open, { t: 'text', text: m.raw, ai: true, via: 'lexiai' }); toast('✓'); } return; }
  const goto = e.target.closest('[data-goto]');
  if (goto) {
    const [c, id, th] = goto.dataset.goto.split('|');
    openChat(c, th ? { thread: th } : {});
    setTimeout(() => { const el = $(`#stream [data-id="${id}"]`); el?.scrollIntoView({ block: 'center' }); }, 80);
    return;
  }
  const od = e.target.closest('[data-open]'); if (od) return openChat(od.dataset.open);
  const pr = e.target.closest('[data-person]'); if (pr) return personPop(pr.dataset.person, pr);
  const obj = e.target.closest('.obj-chip, .obj-res'); if (obj) return objectPop(obj.dataset.obj, obj);
  const media = e.target.closest('[data-media]');
  if (media) { const [mid, i] = media.dataset.media.split('|'); const a = chat(S.open).msgs.get(mid)?.att[+i]; return a?.kind === 'fits' ? fitsModal(a) : imageModal(a); }
  const b = e.target.closest('[data-act]'); if (!b) {
    // на телефоне действия открываются по нажатию на пузырь
    const row = e.target.closest('.row'); if (row && innerWidth <= 820) { $$('.row.show-acts').forEach(r => r !== row && r.classList.remove('show-acts')); row.classList.toggle('show-acts'); }
    return;
  }
  const row = b.closest('[data-id]'); if (!row) return;
  const ch = chat(S.open), m = ch.msgs.get(row.dataset.id); if (!m) return;
  switch (b.dataset.act) {
    case 'react': return send(ch.id, { t: 'react', ref: m.id, emoji: b.dataset.emoji });
    case 'emoji': return emojiPop(b, em => send(ch.id, { t: 'react', ref: m.id, emoji: em }));
    case 'thread': S.thread = m.id; return renderThread();
    case 'forward': return forwardModal(m);
    case 'approve': return send(ch.id, { t: 'approve', ref: m.id, ok: true });
    case 'reject': return send(ch.id, { t: 'approve', ref: m.id, ok: false });
    case 'fits': return fitsModal(m.att[+b.dataset.i]);
    case 'img': return imageModal(m.att[+b.dataset.i]);
  }
}
function plusMenu(anchor) {
  const id = anchor.dataset.plus;
  pop(anchor, `<label class="pi">${ico('i-clip')} ${t('plus.file')}<input type="file" id="file-in" accept=".fits,.fit,.fts,image/*" multiple hidden></label>
    <button type="button" class="pi" data-x="draw">${ico('i-pen')} ${t('plus.draw')}</button>
    <button type="button" class="pi" data-x="formula">${ico('i-sigma')} ${t('plus.formula')}</button>
    ${innerWidth <= 820 ? `<button type="button" class="pi" data-x="tools">${ico('i-compass')} ${t('tools')}</button>` : ''}
    ${id === 'msg' ? `<button type="button" class="pi" data-x="ai">${ico('i-robot')} ${S.aiFlag ? t('plus.ai.on') : t('plus.ai')}</button>` : ''}`, e => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    closePop();
    if (x === 'draw') openDraw();
    if (x === 'formula') openTool('formula');
    if (x === 'tools') { $('#toolbar').hidden = false; $('#tools-btn').setAttribute('aria-expanded', 'true'); }
    if (x === 'ai') { S.aiFlag = !S.aiFlag; anchor.classList.toggle('ai-on', S.aiFlag); }
  });
  $('#file-in').onchange = e => { attachFiles([...e.target.files]); closePop(); };
}
function insertText(text) {
  const ta = $('#msg');
  if (!ta) { toast(L('Откройте чат', 'Open a chat')); return; }
  ta.value = (ta.value && !ta.value.endsWith('\n') ? ta.value + '\n' : ta.value) + text;
  ta.dispatchEvent(new Event('input')); ta.focus();
}

// ---------------------------------------------------------------------
//  Всплывающие окна и модальные
// ---------------------------------------------------------------------
function closePop() { $('#pop-slot').innerHTML = ''; }
function pop(anchor, html, onClick) {
  closePop();
  const slot = $('#pop-slot');
  slot.innerHTML = `<div class="pop glass" role="dialog">${html}</div>`;
  const p = slot.firstChild, r = anchor.getBoundingClientRect();
  let x = Math.min(innerWidth - p.offsetWidth - 12, Math.max(12, r.left));
  let y = r.bottom + 8; if (y + p.offsetHeight > innerHeight - 12) y = Math.max(12, r.top - p.offsetHeight - 8);
  p.style.left = x + 'px'; p.style.top = y + 'px';
  if (onClick) p.addEventListener('click', onClick);
  setTimeout(() => document.addEventListener('pointerdown', function h(ev) { if (!p.contains(ev.target)) { closePop(); document.removeEventListener('pointerdown', h); } }), 0);
  return p;
}
function emojiPop(anchor, cb) {
  pop(anchor, `<div class="emoji-row">${['👍', '⭐', '🔭', '🚀', '❤️', '🔥', '😂', '🤔'].map(e => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>`, ev => {
    const b = ev.target.closest('[data-e]'); if (b) { cb(b.dataset.e); closePop(); }
  });
}
function personPop(uid, anchor) {
  if (uid === myUid()) return settingsModal();
  const p = who(uid);
  pop(anchor, `<div class="member" style="padding:.4rem .5rem">${avatarHTML(p)}<span class="nm"><b>${esc(p.name)}${p.verified ? `<svg class="ico vf"><use href="#i-verified"/></svg>` : ''}</b><span>${esc(p.role || '')}${p.org ? ' · ' + esc(p.org) : ''}</span></span></div>
    ${p.verified ? `<p>${t('verified')}</p>` : ''}<button type="button" class="pi" data-x="dm">${ico('i-person')} ${L('Написать', 'Message')}</button>`, e => {
    if (e.target.closest('[data-x="dm"]')) { closePop(); openDM(uid); }
  });
}
async function objectPop(name, anchor) {
  const o = (await AS.loadMessier()).find(x => x.id.toUpperCase() === name.replace(/\s+/g, '').toUpperCase());
  let info = '';
  if (o) { const h = AS.altAz({ ra: o.ra, dec: o.dec }, new Date(), AS.observer(profileLoc())); info = `<p><b>${o.id}${o.name !== o.id ? ' · ' + esc(o.name) : ''}</b><br>${AS.fmtHMS(o.ra)} ${AS.fmtDMS(o.dec)} · ${o.mag}ᵐ · ${L('высота', 'alt')} ${h.alt.toFixed(0)}°</p>`; }
  pop(anchor, `<h4>${esc(name)}</h4>${info}${catalogLinks(name).map(l => `<a class="pi" href="${l.href}" target="_blank" rel="noopener noreferrer">${ico('i-search')} ${esc(l.label)} ↗</a>`).join('')}${o ? `<button type="button" class="pi" data-plan>${ico('i-scope')} ${L('Планировать наблюдение', 'Plan observation')}</button>` : ''}`, ev => {
    if (ev.target.closest('[data-plan]')) { closePop(); openTool('planner', o.id); }
  });
}
function modal(title, body, { wide = false, onMount } = {}) {
  const slot = $('#modal-slot');
  slot.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-card glass ${wide ? 'wide' : ''}"><div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close-modal aria-label="×">${ico('i-x')}</button></div><div class="modal-body">${body}</div></div></div>`;
  const m = slot.firstChild;
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close-modal]')) closeModal(); });
  onMount?.(m);
  return m;
}
function closeModal() { $('#modal-slot').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); closeModal(); } });

function forwardModal(m) {
  const list = [...S.chats.values()].filter(c => !(c.kind === 'channel' && c.admins.length && !isAdmin(c, myUid())));
  modal(t('forward.to'), `<div style="display:grid;gap:.45rem">${list.map(c => `<button type="button" class="li glass" data-to="${c.id}"><span class="li-ic">${chatIcon(c)}</span><span class="li-body"><span class="li-name">${esc(c.title)}</span></span></button>`).join('')}</div>`, {
    onMount: el => el.addEventListener('click', e => {
      const b = e.target.closest('[data-to]'); if (!b) return;
      closeModal();
      send(b.dataset.to, { t: 'text', text: m.text, att: m.att, fwd: who(m.from).name });
      toast('✓');
    }),
  });
}
function fitsModal(a) {
  if (!a?._img) fitsUrl(a);
  if (!a?._img) return;
  const img = a._img;
  modal(`FITS · ${img.header.OBJECT || a.name}`, `<div class="fits-view"><div><canvas id="fv" width="${img.width}" height="${img.height}"></canvas><p class="pix" id="fv-pix"></p></div>
    <div style="display:grid;gap:.7rem;align-content:start">
      <label class="field"><span>${L('Растяжка', 'Stretch')}</span><select class="inp" id="fv-s"><option>asinh</option><option>log</option><option>sqrt</option><option>linear</option></select></label>
      <label class="field"><span>${L('Палитра', 'Colormap')}</span><select class="inp" id="fv-m"><option>gold</option><option>gray</option><option>heat</option><option>cyan</option></select></label>
      <label class="field"><span>${L('Контраст', 'Contrast')}</span><input type="range" id="fv-hi" min="0.9" max="1" step="0.001" value="0.997"></label>
      <pre class="fits-cards">${esc(img.cards.join('\n'))}</pre></div></div>`, {
    wide: true, onMount: el => {
      const c = $('#fv', el);
      const draw = () => c.getContext('2d').drawImage(fitsToCanvas(img, { stretch: $('#fv-s').value, cmap: $('#fv-m').value, hi: +$('#fv-hi').value }), 0, 0);
      ['#fv-s', '#fv-m', '#fv-hi'].forEach(s => $(s, el).oninput = draw);
      c.onpointermove = e => {
        const r = c.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * img.width), y = img.height - 1 - Math.floor((e.clientY - r.top) / r.height * img.height);
        const v = img.data[y * img.width + x];
        $('#fv-pix').textContent = `x ${x + 1} · y ${y + 1} · ${Number.isFinite(v) ? v.toFixed(1) : '—'} ${img.header.BUNIT || ''}`;
      };
      draw();
    },
  });
}
function imageModal(a) {
  const s = safeImg(a?.data); if (!s) return;
  modal(a.name || '', `<img src="${s}" alt="" style="width:100%;border-radius:14px;filter:var(--img-filter)">`, { wide: true });
}
function openDraw() {
  const colors = ['#ecd391', '#45f3ff', '#f3f0e8', '#ff6b5a', '#7ee0a8'];
  modal(t('draw.title'), `<div class="draw-tools">${colors.map((c, i) => `<button type="button" class="sw" style="background:${c}" data-c="${c}" aria-pressed="${i === 0}" aria-label="${c}"></button>`).join('')}
      <button type="button" class="btn-line sm" data-tool="eraser">${t('draw.eraser')}</button><button type="button" class="btn-line sm" data-tool="undo">↶</button><button type="button" class="btn-line sm danger" data-tool="clear">${t('draw.clear')}</button></div>
    <canvas id="draw-canvas" width="1280" height="800"></canvas>
    <div class="row-end"><button type="button" class="btn-gold" id="draw-send">${t('draw.send')}</button></div>`, {
    wide: true, onMount: el => {
      const c = $('#draw-canvas', el), x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#07080c'; x.fillRect(0, 0, c.width, c.height);
      const base = x.getImageData(0, 0, c.width, c.height);
      let color = colors[0], eraser = false, drawing = false, last = null;
      const undo = [];
      const pt = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * c.width, (e.clientY - r.top) / r.height * c.height]; };
      c.onpointerdown = e => { drawing = true; c.setPointerCapture(e.pointerId); undo.push(x.getImageData(0, 0, c.width, c.height)); if (undo.length > 20) undo.shift(); last = pt(e); };
      c.onpointermove = e => {
        if (!drawing) return;
        const p = pt(e);
        x.strokeStyle = eraser ? '#07080c' : color; x.lineWidth = eraser ? 28 : 4 * (e.pressure ? 0.6 + e.pressure : 1); x.lineCap = 'round';
        x.beginPath(); x.moveTo(...last); x.lineTo(...p); x.stroke(); last = p;
      };
      c.onpointerup = c.onpointercancel = () => { drawing = false; };
      $('.draw-tools', el).onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.c) { color = b.dataset.c; eraser = false; $$('.sw', el).forEach(s => s.setAttribute('aria-pressed', String(s === b))); }
        if (b.dataset.tool === 'eraser') eraser = !eraser;
        if (b.dataset.tool === 'undo' && undo.length) x.putImageData(undo.pop(), 0, 0);
        if (b.dataset.tool === 'clear') x.putImageData(base, 0, 0);
      };
      $('#draw-send', el).onclick = () => {
        let data = c.toDataURL('image/png'); if (data.length > 1.4e6) data = c.toDataURL('image/jpeg', 0.85);
        closeModal();
        if (S.open) send(S.open, { t: 'text', text: '', att: [{ kind: 'image', name: 'sketch.png', size: data.length, data, w: c.width, h: c.height }] });
      };
    },
  });
}

// ---------- настройки ----------
function settingsModal(tabName = 'profile') {
  const p = S.profile || {};
  const tabs = ['profile', 'look', 'conn'];
  const body = {
    profile: `<div class="form2">
        <label class="photo" style="grid-column:1/-1"><input type="file" id="st-photo" accept="image/*" hidden><span id="st-photo-v">${p.photo ? `<img src="${safeImg(p.photo)}" alt="">` : t('ob.photo')}</span></label>
        ${[['name', 'pf.name'], ['handle', 'pf.handle'], ['role', 'pf.role'], ['org', 'pf.org'], ['orcid', 'pf.orcid'], ['lat', 'pf.lat'], ['lon', 'pf.lon']].map(([k, l]) => `<label class="field"><span>${t(l)}</span><input class="inp" id="st-${k}" value="${esc(p[k] || '')}"></label>`).join('')}
        <label class="field wide"><span>${t('pf.bio')}</span><textarea class="inp" id="st-bio" rows="2" maxlength="200">${esc(p.bio || '')}</textarea></label>
        <div class="row-end wide"><button type="button" class="btn-gold" id="st-save">${t('set.save')}</button></div></div>`,
    look: `<div class="field"><span>${t('set.theme')}</span><div class="theme-row">${[['gold', 'linear-gradient(135deg,#7d5f22,#ecd391)'], ['cyan', 'linear-gradient(135deg,#0e6d75,#45f3ff)'], ['light', 'linear-gradient(135deg,#f6f6f9,#c9ced8)'], ['red', 'linear-gradient(135deg,#3a0000,#ff3b2f)']].map(([id, g]) => `<button type="button" data-theme-x="${id}" aria-pressed="${prefs.theme === id}"><i style="background:${g}"></i>${t('theme.' + id)}</button>`).join('')}</div></div>
      <div class="field"><span>${t('set.size')}</span><div class="seg">${[0.9, 1, 1.1, 1.2].map(v => `<button type="button" data-fs="${v}" aria-pressed="${prefs.fs === v}">${Math.round(v * 100)}%</button>`).join('')}</div></div>
      <div class="field"><span>${t('set.planet')}</span><select class="inp" id="st-planet">${PLANET_LIST.map(([id, ru, en]) => `<option value="${id}" ${prefs.planet === id ? 'selected' : ''}>${L(ru, en)}</option>`).join('')}</select></div>
      <div class="field"><span>RU / EN</span><div class="seg"><button type="button" data-lang-x="ru" aria-pressed="${prefs.lang === 'ru'}">Русский</button><button type="button" data-lang-x="en" aria-pressed="${prefs.lang === 'en'}">English</button></div></div>`,
    conn: `<label class="field"><span>${t('set.server')}</span><input class="inp mono" id="st-url" value="${esc(S.url)}" placeholder="wss://…/ws" spellcheck="false"></label>
      <div class="row-end" style="justify-content:flex-start"><button type="button" class="btn-gold" id="st-connect">${t('set.reconnect')}</button><button type="button" class="btn-line" id="st-demo">${t('set.demo')}</button></div>
      <p style="margin:0;font-size:.82rem;color:var(--mute)">${S.connMode === 'demo' ? t('conn.demo') : esc(S.url)}</p>
      <button type="button" class="btn-line danger" id="st-reset" style="justify-self:start">${t('set.reset')}</button>`,
  };
  modal(t('set.title'), `<div class="seg">${tabs.map(x => `<button type="button" data-st="${x}" aria-pressed="${x === tabName}">${t('set.' + x)}</button>`).join('')}</div>${body[tabName]}`, {
    onMount: el => {
      el.addEventListener('click', e => {
        const st = e.target.closest('[data-st]'); if (st) return settingsModal(st.dataset.st);
        const th = e.target.closest('[data-theme-x]'); if (th) { prefs.theme = th.dataset.themeX; savePrefs(); applyPrefs(); if (S.view === 'chat') renderCard(); return settingsModal('look'); }
        const fs = e.target.closest('[data-fs]'); if (fs) { prefs.fs = +fs.dataset.fs; savePrefs(); applyPrefs(); return settingsModal('look'); }
        const lg = e.target.closest('[data-lang-x]'); if (lg) { prefs.lang = lg.dataset.langX; savePrefs(); applyPrefs(); renderAll(); return settingsModal('look'); }
      });
      $('#st-planet') && ($('#st-planet').onchange = e => setPlanet(e.target.value));
      $('#st-photo') && ($('#st-photo').onchange = async e => { const f = e.target.files[0]; if (!f) return; S.pendingPhoto = await squareAvatar(f); $('#st-photo-v').innerHTML = `<img src="${S.pendingPhoto}" alt="">`; });
      $('#st-save') && ($('#st-save').onclick = () => {
        const np = { ...p };
        for (const k of ['name', 'handle', 'role', 'org', 'orcid', 'lat', 'lon', 'bio']) np[k] = $('#st-' + k).value.trim();
        if (S.pendingPhoto) np.photo = S.pendingPhoto;
        if (!np.name) return;
        S.profile = np; store.set('profile', np); S.pendingPhoto = '';
        if (S.client) { S.client.userName = np.name; for (const id of S.chats.keys()) S.client._announce(id, { hello: false }); }
        sendProfile(); renderMe(); toast(t('saved')); closeModal();
      });
      $('#st-connect') && ($('#st-connect').onclick = async () => { S.url = $('#st-url').value.trim(); store.set('url', S.url); closeModal(); closeCard(); await connect('server'); renderAll(); });
      $('#st-demo') && ($('#st-demo').onclick = async () => { closeModal(); closeCard(); await connect('demo'); renderAll(); });
      $('#st-reset') && ($('#st-reset').onclick = () => { S.client?.disconnect(); ['profile', 'interests', 'custom', 'mode'].forEach(store.del); location.reload(); });
    },
  });
}
function newChatModal() {
  modal(t('new.title'), `<div class="seg" id="nk"><button type="button" data-k="group" aria-pressed="true">${t('new.group')}</button><button type="button" data-k="channel" aria-pressed="false">${t('new.channel')}</button></div>
    <label class="field"><span>${t('new.name')}</span><input class="inp" id="nc-title" maxlength="64"></label>
    <label class="field"><span>${t('new.desc')}</span><input class="inp" id="nc-desc" maxlength="300"></label>
    <label style="display:flex;gap:.5rem;align-items:center;font-size:.86rem"><input type="checkbox" id="nc-premod"> ${t('new.premod')}</label>
    <div class="row-end"><button type="button" class="btn-gold" id="nc-ok">${t('new.create')}</button></div>`, {
    onMount: el => {
      let kind = 'group';
      $('#nk', el).onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; $$('#nk button', el).forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
      $('#nc-ok', el).onclick = () => {
        const title = $('#nc-title').value.trim(); if (!title) return;
        const id = (title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/[а-яё]/gi, c => 'abvgdeezziiklmnoprstufhccss_y_eua'['абвгдеёжзийклмнопрстуфхцчшщъыьэюя'.indexOf(c.toLowerCase())] || '') || 'chat').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 28) + '-' + randomId(2);
        const desc = $('#nc-desc').value.trim(), premod = $('#nc-premod').checked;
        chat(id, { kind, title, desc, admins: [myUid()], premod });
        S.client.joinChannel(id, { found: true });
        send(id, { t: 'meta', kind, title, desc, admins: [myUid()], premod });
        saveCustom(); closeModal(); openChat(id);
      };
    },
  });
}
function saveCustom() {
  store.set('custom', [...S.chats.values()].filter(c => c.kind !== 'direct' && !CHATS.some(x => x.id === c.id)).map(c => ({ id: c.id, kind: c.kind, title: c.title, desc: c.desc })));
}
function openDM(uid) {
  const p = who(uid); if (!S.client || !p) return;
  const id = S.client.dmChannelName(uid);
  const ch = chat(id, { kind: 'direct', title: p.name, peer: uid });
  if (!ch.joined) {
    S.client.joinChannel(id, { found: true });
    const shared = [...(p.chats || [])].find(c => S.chats.get(c)?.key);
    if (shared) send(shared, { t: 'dm', to: uid, channel: id });
  }
  openChat(id);
}

// ---------------------------------------------------------------------
//  TOOLS: колонка и окна поверх чата
// ---------------------------------------------------------------------
function renderToolbar() {
  $('#toolbar').innerHTML = TOOLS.map(tl => `<button type="button" class="tool-b" data-tool="${tl.id}">${ico(tl.icon)}<span>${esc(tl.title())}</span></button>`).join('');
}
const toolCtx = { profile: () => S.profile || {}, insert: insertText, openChannel: id => openChat(id), alerts: () => [], onAlerts: () => () => {} };
let zTop = 30;
async function openTool(id, arg) {
  const tool = TOOLS.find(x => x.id === id); if (!tool) return;
  let win = $(`.win[data-win="${id}"]`);
  if (!win) {
    const n = $$('.win').length;
    win = document.createElement('section');
    win.className = 'win glass lg'; win.dataset.win = id;
    win.innerHTML = `<header class="win-head"><b>${esc(tool.title())}</b><button type="button" class="icon-btn" data-win-x aria-label="×">${ico('i-x')}</button></header><div class="win-body tool-panel"></div>`;
    win.style.left = Math.max(12, innerWidth - 420 - n * 28 - (innerWidth > 1200 ? 280 : 0)) + 'px';
    win.style.top = (90 + n * 28) + 'px';
    $('#windows').append(win);
    dragWin(win);
    win.querySelector('[data-win-x]').onclick = () => { win._cleanup?.(); win.remove(); };
    win.addEventListener('pointerdown', () => { win.style.zIndex = ++zTop; });
  }
  win.style.zIndex = ++zTop;
  const r = await tool.render(win.querySelector('.win-body'), toolCtx, arg);
  if (typeof r === 'function') win._cleanup = r;
  $('#toolbar').hidden = true; $('#tools-btn').setAttribute('aria-expanded', 'false');
}
function dragWin(win) {
  const head = win.querySelector('.win-head');
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || innerWidth <= 820) return;
    head.setPointerCapture(e.pointerId);
    const r = win.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => {
      win.style.left = Math.min(innerWidth - 80, Math.max(-r.width + 80, ev.clientX - dx)) + 'px';
      win.style.top = Math.min(innerHeight - 50, Math.max(0, ev.clientY - dy)) + 'px';
    };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
  });
}

// ---------------------------------------------------------------------
//  События
// ---------------------------------------------------------------------
function initAppEvents() {
  $('#tabs').onclick = e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === 'ai') { S.view = 'ai'; S.thread = null; S.float = null; renderCard(); renderTabs(); return; }
    S.tab = b.dataset.tab; S.space = null;
    if (S.view === 'ai' && innerWidth <= 820) closeCard();
    renderTabs(); renderList(); renderRail();
  };
  $('#brand').onclick = e => { e.preventDefault(); S.tab = 'all'; S.space = null; closeCard(); renderList(); };
  $('#search').addEventListener('input', e => {
    S.search = e.target.value;
    if (S.search.trim().length >= 2) { if (S.view !== 'search') { S.view = 'search'; renderCard(); } else { renderSearchResults(); const sp = $('#card .ch-title span'); if (sp) sp.textContent = S.search; } }
  });
  $('#rail').onclick = e => {
    const o = e.target.closest('[data-open]'); if (o) return openChat(o.dataset.open);
    const p = e.target.closest('[data-person]'); if (p) return personPop(p.dataset.person, p);
    const s = e.target.closest('[data-space]'); if (s) { S.space = S.space === s.dataset.space ? null : s.dataset.space; S.tab = 'all'; renderTabs(); renderList(); renderRail(); }
  };
  $('#list-items').onclick = e => {
    if (e.target.closest('[data-fame]')) { S.view = 'fame'; S.open = null; renderCard(); renderList(); return; }
    const pin = e.target.closest('[data-pin]'); if (pin) { const c = chat(pin.dataset.pin); c.pinned = !c.pinned; return renderList(); }
    const mute = e.target.closest('[data-mute]'); if (mute) { const c = chat(mute.dataset.mute); c.muted = !c.muted; return renderList(); }
    const lv = e.target.closest('[data-leave]'); if (lv) { S.client.leaveChannel(lv.dataset.leave); S.chats.delete(lv.dataset.leave); saveCustom(); return renderList(); }
    const th = e.target.closest('[data-thread]'); if (th) { const [c, id] = th.dataset.thread.split('|'); return openChat(c, { thread: id }); }
    const it = e.target.closest('[data-open]'); if (it) openChat(it.dataset.open);
  };
  $('#list-items').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('[role="button"]')?.click(); });
  $('#new-chat').onclick = newChatModal;
  $('#card').addEventListener('click', onCardClick);
  $('#card').addEventListener('dragover', e => e.preventDefault());
  $('#card').addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files?.length && S.view === 'chat') attachFiles([...e.dataTransfer.files]); });
  $('#me-btn').onclick = () => settingsModal();
  $('#bell').onclick = e => {
    S.notesSeen = S.notes.length; $('#bell-n').hidden = true;
    pop(e.currentTarget, `<h4>${t('notif')}</h4>${S.notes.length ? S.notes.slice(0, 12).map((n, i) => `<button type="button" class="pi" data-n="${i}">${esc(n.text)}</button>`).join('') : `<p>${t('notif.empty')}</p>`}`, ev => {
      const b = ev.target.closest('[data-n]'); if (b) { closePop(); openChat(S.notes[+b.dataset.n].chatId); }
    });
  };
  $('#tools-btn').onclick = () => {
    const tb = $('#toolbar'); tb.hidden = !tb.hidden;
    $('#tools-btn').setAttribute('aria-expanded', String(!tb.hidden));
  };
  $('#toolbar').onclick = e => { const b = e.target.closest('[data-tool]'); if (b) openTool(b.dataset.tool); };
  $('#planet-name').onclick = nextPlanet;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.open) { chat(S.open).unread = 0; schedule('list'); } });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.view) renderCard(); }, 250); });
}

// ---------------------------------------------------------------------
//  Старт
// ---------------------------------------------------------------------
async function main() {
  applyPrefs();
  initOnboardingEvents();
  initAppEvents();
  const bgReady = initBackground();
  // ключ сессии и демо-участники готовятся, пока идёт заставка
  S.identity = new Identity();
  if (!S.profile || S.mode === 'demo' || !S.url) startDemoBackground();
  await playBoot($('#boot'));
  await bgReady;
  if (S.profile) {
    await connect(S.mode === 'demo' || !S.url ? 'demo' : 'server');
    $('#boot').classList.add('leaving');
    showApp();
  } else {
    await startOnboarding();
    $('#boot').classList.add('leaving');
  }
  setTimeout(() => { $('#boot').hidden = true; }, 900);
}
main();

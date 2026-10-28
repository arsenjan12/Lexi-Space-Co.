// =====================================================================
//  Фоны по эскизу:
//   1) главная — тусклая случайная планета (можно сменить), в т.ч. экзопланеты;
//   2) ветки, чаты, каналы — тусклые созвездия (каталог линий из базы LEXI Space);
//   3) поиск и LexiAI — глубокий космос;
//   + Земля со спутниками для регистрации и звёздное поле для приветствия.
//  Всё рисуется процедурно на canvas, без внешних картинок (кроме текстуры Земли).
// =====================================================================

// ---------- шум ----------
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = t => t * t * (3 - 2 * t);
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
}
function fbm(x, y, z, oct = 5) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function seeded(seed) {
  let s = seed >>> 0 || 7;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// ---------- каталог планет ----------
export const PLANETS = [
  { id: 'mars', ru: 'Марс', en: 'Mars', sys: 'Солнечная система', kind: 'rock', pal: ['#5a2414', '#a4532c', '#c9784a', '#e0a676'], cap: true, atm: '#e7a27a' },
  { id: 'jupiter', ru: 'Юпитер', en: 'Jupiter', sys: 'Солнечная система', kind: 'gas', pal: ['#6b4a33', '#c9a27d', '#efe0c6', '#a86b47', '#d9c3a2'], spot: true, atm: '#f0d9b5' },
  { id: 'saturn', ru: 'Сатурн', en: 'Saturn', sys: 'Солнечная система', kind: 'gas', pal: ['#8a7349', '#d8c08b', '#efe2bb', '#b79b63'], rings: true, atm: '#f1e1b0' },
  { id: 'neptune', ru: 'Нептун', en: 'Neptune', sys: 'Солнечная система', kind: 'gas', pal: ['#1c3a8a', '#2f5fcf', '#5d8cf0', '#244ba8'], atm: '#7fa8ff' },
  { id: 'uranus', ru: 'Уран', en: 'Uranus', sys: 'Солнечная система', kind: 'gas', pal: ['#7fc3c9', '#a7dde0', '#c3eef0'], soft: true, atm: '#bff3f5' },
  { id: 'trappist1e', ru: 'TRAPPIST-1 e', en: 'TRAPPIST-1 e', sys: 'TRAPPIST-1 · 40 св. лет', kind: 'ocean', pal: ['#0f2c4a', '#1c4f75', '#4f6b3a', '#8a8256', '#e8eef2'], cap: true, atm: '#ffb07a', star: '#ff8a5c' },
  { id: 'k452b', ru: 'Kepler-452 b', en: 'Kepler-452 b', sys: 'Kepler-452 · 1800 св. лет', kind: 'ocean', pal: ['#14324a', '#245a7a', '#5b7a43', '#a59a6a', '#f2f2ea'], cap: true, atm: '#9cc8ff' },
  { id: 'hd189733b', ru: 'HD 189733 b', en: 'HD 189733 b', sys: 'Лисичка · 64 св. года', kind: 'gas', pal: ['#0b1f5c', '#1d47b0', '#3a74e0', '#0f2e85'], atm: '#5aa0ff' },
  { id: '51pegb', ru: '51 Пегаса b', en: '51 Pegasi b', sys: 'Пегас · 50 св. лет', kind: 'gas', pal: ['#3b1208', '#8a2a10', '#d4602a', '#f3a050'], hot: true, atm: '#ff7a3a' },
  { id: 'proximab', ru: 'Проксима b', en: 'Proxima b', sys: 'Альфа Центавра · 4,2 св. года', kind: 'rock', pal: ['#2a1d1a', '#5b3b30', '#8a5d48', '#b98b6c'], atm: '#ff8f6b', star: '#ff6b4a' },
  { id: 'k16b', ru: 'Kepler-16 b', en: 'Kepler-16 b', sys: 'Kepler-16 · две звезды', kind: 'gas', pal: ['#4b4f5c', '#878b96', '#b9bcc4', '#6c707b'], rings: true, atm: '#d6d9e2' },
  { id: '55cnce', ru: '55 Рака e', en: '55 Cancri e', sys: 'Рак · 41 св. год', kind: 'lava', pal: ['#120605', '#3a0f08', '#c2410c', '#ffb02e'], atm: '#ff6a2a' },
];

// Рисует планету в квадратный canvas размера size
export function paintPlanet(planet, size = 640, seed = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const R = size * 0.42, cx = size / 2, cy = size / 2;
  const pal = planet.pal.map(hexRgb);
  const atm = hexRgb(planet.atm);
  const L = [-0.62, -0.38, 0.68]; // свет слева сверху
  const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  const tilt = planet.rings ? -0.38 : -0.18;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const sOff = seed * 13.37;
  const pick = t => {
    const n = pal.length - 1;
    const x = Math.max(0, Math.min(0.9999, t)) * n;
    const i = Math.floor(x);
    return mix(pal[i], pal[i + 1], x - i);
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = (px - cx) / R, dy = (py - cy) / R;
      const r2 = dx * dx + dy * dy;
      const o = (py * size + px) * 4;
      if (r2 > 1.18) continue;
      if (r2 > 1) {
        // атмосферное свечение по краю
        const g = Math.max(0, 1 - (Math.sqrt(r2) - 1) / 0.085);
        const lit = Math.max(0, -(dx * L[0] + dy * L[1]) / Math.sqrt(r2) * 0.8 + 0.35);
        const a = g * g * lit * 0.85;
        img.data[o] = atm[0]; img.data[o + 1] = atm[1]; img.data[o + 2] = atm[2]; img.data[o + 3] = a * 255;
        continue;
      }
      const dz = Math.sqrt(1 - r2);
      // поворот оси
      const x = dx * ct - dy * st, y = dx * st + dy * ct, z = dz;
      const lat = Math.asin(y), lon = Math.atan2(x, z);
      let col;
      if (planet.kind === 'gas') {
        const turb = fbm(x * 3 + sOff, y * 3, z * 3, 4);
        const band = 0.5 + 0.5 * Math.sin(lat * (planet.soft ? 6 : 15) + turb * (planet.soft ? 1.2 : 4.2) + seed);
        col = pick(band * 0.85 + turb * 0.15);
        if (planet.spot) {
          const sd = Math.hypot((lon - 0.5) * 1.1, (lat + 0.36) * 2.4);
          if (sd < 0.16) col = mix(col, [190, 92, 60], (1 - sd / 0.16) * 0.8);
        }
        if (planet.hot) col = mix(col, [255, 170, 80], Math.max(0, 0.5 - lon * 0.4) * 0.3);
      } else if (planet.kind === 'lava') {
        const n = fbm(x * 4 + sOff, y * 4, z * 4, 5);
        const cracks = Math.abs(n - 0.5) < 0.035 ? 1 : 0;
        col = mix(pick(n * 0.45), pal[3], cracks * 0.9);
      } else {
        const n = fbm(x * 2.3 + sOff, y * 2.3, z * 2.3, 6);
        if (planet.kind === 'ocean') {
          col = n < 0.5 ? mix(pal[0], pal[1], n / 0.5) : pick(0.25 + (n - 0.5) * 1.6);
        } else {
          const crater = fbm(x * 9 + 3, y * 9, z * 9, 3);
          col = pick(n * 0.9 + crater * 0.15);
        }
        if (planet.cap && Math.abs(lat) > 1.18 - n * 0.25) col = mix(col, [236, 240, 244], 0.85);
        if (planet.kind === 'ocean') {
          const cl = fbm(x * 3.1 + 9, y * 5.2, z * 3.1 + sOff, 5);
          if (cl > 0.56) col = mix(col, [240, 244, 248], Math.min(1, (cl - 0.56) * 4) * 0.8);
        }
      }
      const ndl = dx * L[0] + dy * L[1] + dz * L[2];
      const shade = Math.max(0.02, ndl) ** 0.9;
      const rim = Math.pow(1 - dz, 3) * 0.5;
      const lum = shade * (1 - rim * 0.3);
      img.data[o] = Math.min(255, col[0] * lum + atm[0] * rim * shade);
      img.data[o + 1] = Math.min(255, col[1] * lum + atm[1] * rim * shade);
      img.data[o + 2] = Math.min(255, col[2] * lum + atm[2] * rim * shade);
      img.data[o + 3] = 255;
    }
  }
  const body = document.createElement('canvas');
  body.width = body.height = size;
  body.getContext('2d').putImageData(img, 0, 0);
  // кольца: дальняя половина под планетой, ближняя — поверх
  const ring = front => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(1, 0.24);
    ctx.beginPath();
    if (front) ctx.rect(-size, 0, size * 2, size); else ctx.rect(-size, -size, size * 2, size);
    ctx.clip();
    for (let r = R * 1.25; r < R * 2.05; r += 1.2) {
      const t = (r - R * 1.25) / (R * 0.8);
      const a = (0.25 + 0.55 * Math.abs(Math.sin(t * 23) * Math.sin(t * 7.3))) * (t > 0.62 && t < 0.67 ? 0.1 : 1);
      ctx.strokeStyle = `rgba(${pal[2].map(Math.round).join(',')},${a * 0.55})`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  };
  if (planet.rings) ring(false);
  ctx.drawImage(body, 0, 0);
  if (planet.rings) ring(true);
  return cv;
}

// ---------- звёзды ----------
function drawStars(ctx, w, h, rnd, n, maxR = 1.2, tint = null) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, m = rnd() ** 3;
    const r = 0.3 + m * maxR;
    const t = tint || (rnd() < 0.15 ? [255, 214, 170] : rnd() < 0.3 ? [190, 210, 255] : [255, 255, 255]);
    ctx.fillStyle = `rgba(${t[0]},${t[1]},${t[2]},${0.25 + m * 0.75})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------- глубокий космос ----------
export function paintDeepSpace(canvas, seed = 11) {
  const w = canvas.width = Math.max(320, Math.round(canvas.clientWidth * 0.6));
  const h = canvas.height = Math.max(240, Math.round(canvas.clientHeight * 0.6));
  const ctx = canvas.getContext('2d');
  const rnd = seeded(seed);
  ctx.fillStyle = '#020207'; ctx.fillRect(0, 0, w, h);
  // туманность: низкое разрешение шума → растянуть
  const nw = 160, nh = Math.round(160 * h / w);
  const off = document.createElement('canvas'); off.width = nw; off.height = nh;
  const oc = off.getContext('2d'); const im = oc.createImageData(nw, nh);
  const c1 = [70, 30, 110], c2 = [20, 70, 120], c3 = [140, 70, 40];
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const n1 = fbm(x / 38 + seed, y / 38, 0.3, 5), n2 = fbm(x / 22, y / 22 + seed, 4.1, 4);
    const d = Math.max(0, n1 - 0.47) * 2.4, e = Math.max(0, n2 - 0.55) * 2.2;
    const col = mix(mix(c1, c2, n2), c3, e * 0.6);
    const o = (y * nw + x) * 4;
    im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = Math.min(255, (d * 0.9 + e * 0.35) * 255);
  }
  oc.putImageData(im, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.75; ctx.drawImage(off, 0, 0, w, h); ctx.globalAlpha = 1;
  drawStars(ctx, w, h, rnd, Math.round(w * h / 380), 1.1);
  // далёкие галактики
  for (let i = 0; i < 9; i++) {
    const x = rnd() * w, y = rnd() * h, r = 4 + rnd() ** 2 * 22, ang = rnd() * Math.PI;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(1, 0.3 + rnd() * 0.5);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const warm = rnd() < 0.5;
    g.addColorStop(0, warm ? 'rgba(255,236,200,.85)' : 'rgba(210,225,255,.85)');
    g.addColorStop(0.35, warm ? 'rgba(220,170,110,.25)' : 'rgba(120,150,230,.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}

// ---------- созвездия ----------
let constData = null;
export async function loadConstellations() {
  if (constData) return constData;
  try {
    const j = await (await fetch(new URL('../data/constellations.lines.json', import.meta.url))).json();
    constData = j.features.map(f => ({ id: f.id, lines: f.geometry.coordinates }));
  } catch { constData = []; }
  return constData;
}
export const CONST_RU = { Ori: 'Орион', UMa: 'Большая Медведица', Cas: 'Кассиопея', Cyg: 'Лебедь', Lyr: 'Лира', Sco: 'Скорпион', Leo: 'Лев', Gem: 'Близнецы', Tau: 'Телец', Peg: 'Пегас', And: 'Андромеда', Per: 'Персей', Aql: 'Орёл', Cru: 'Южный Крест', Sgr: 'Стрелец', Boo: 'Волопас', Aur: 'Возничий', Cep: 'Цефей', Dra: 'Дракон', UMi: 'Малая Медведица', Her: 'Геркулес', Vir: 'Дева', CMa: 'Большой Пёс', Cen: 'Центавр' };
const FEATURED = Object.keys(CONST_RU);

export function constellationFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FEATURED[h % FEATURED.length];
}

// Стереографическая проекция вокруг центра созвездия
export function paintConstellations(canvas, focusId, { color = '196,157,71', labelTop = 0 } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.width = Math.round(canvas.clientWidth * dpr);
  const h = canvas.height = Math.round(canvas.clientHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!constData || !w || !h) return;
  const focus = constData.find(c => c.id === focusId) || constData[0];
  const pts = focus.lines.flat();
  // центр через средний единичный вектор (корректно через 0h RA)
  let vx = 0, vy = 0, vz = 0;
  for (const [ra, dec] of pts) {
    const a = ra * Math.PI / 180, d = dec * Math.PI / 180;
    vx += Math.cos(d) * Math.cos(a); vy += Math.cos(d) * Math.sin(a); vz += Math.sin(d);
  }
  const ra0 = Math.atan2(vy, vx), dec0 = Math.atan2(vz, Math.hypot(vx, vy));
  const proj = (ra, dec) => {
    const a = ra * Math.PI / 180 - ra0, d = dec * Math.PI / 180;
    const k = 2 / (1 + Math.sin(dec0) * Math.sin(d) + Math.cos(dec0) * Math.cos(d) * Math.cos(a));
    return [k * Math.cos(d) * Math.sin(a), k * (Math.cos(dec0) * Math.sin(d) - Math.sin(dec0) * Math.cos(d) * Math.cos(a)), k];
  };
  // масштаб — чтобы фокусное созвездие заняло ~60% ширины
  let ext = 0.05;
  for (const [ra, dec] of pts) { const [x, y] = proj(ra, dec); ext = Math.max(ext, Math.abs(x), Math.abs(y) * w / h); }
  const scale = (w * 0.34) / ext;
  const cx = w * 0.62, cy = h * 0.45;
  ctx.lineCap = 'round';
  for (const c of constData) {
    const isF = c.id === focus.id;
    ctx.strokeStyle = `rgba(${color},${isF ? 0.34 : 0.12})`;
    ctx.lineWidth = (isF ? 1.1 : 0.7) * dpr;
    for (const line of c.lines) {
      ctx.beginPath();
      let started = false;
      for (const [ra, dec] of line) {
        const [x, y, k] = proj(ra, dec);
        if (k > 6) { started = false; continue; }
        const X = cx + x * scale, Y = cy - y * scale;
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      ctx.stroke();
      for (const [ra, dec] of line) {
        const [x, y, k] = proj(ra, dec);
        if (k > 6) continue;
        ctx.fillStyle = `rgba(255,248,230,${isF ? 0.55 : 0.25})`;
        ctx.beginPath(); ctx.arc(cx + x * scale, cy - y * scale, (isF ? 1.8 : 1.1) * dpr, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  const rnd = seeded(focus.id.charCodeAt(0) * 97 + focus.id.charCodeAt(1));
  drawStars(ctx, w, h, rnd, Math.round(w * h / (2600 * dpr)), 0.8 * dpr);
  ctx.font = `${10 * dpr}px "JetBrains Mono", monospace`;
  ctx.fillStyle = `rgba(${color},.55)`;
  ctx.textAlign = 'right';
  ctx.fillText(((CONST_RU[focus.id] || focus.id) + ' · ' + focus.id).toUpperCase(), w - 16 * dpr, labelTop ? labelTop * dpr : h - 14 * dpr);
}

// ---------- мерцающее звёздное поле (приветствие, загрузка) ----------
export function starfield(canvas, { density = 1, speed = 1 } = {}) {
  const ctx = canvas.getContext('2d');
  let stars = [], raf = 0, w = 0, h = 0;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.width = canvas.clientWidth * dpr; h = canvas.height = canvas.clientHeight * dpr;
    const rnd = seeded(42);
    stars = Array.from({ length: Math.round(w * h / 2600 * density) }, () => ({ x: rnd() * w, y: rnd() * h, r: (0.3 + rnd() ** 4 * 1.6) * dpr, p: rnd() * 6.28, s: 0.5 + rnd() * 2, z: rnd() }));
  };
  const frame = t => {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 1000 * s.s * speed + s.p)) * (0.4 + s.z * 0.6);
      ctx.fillStyle = `rgba(255,250,235,${a})`;
      ctx.fillRect(s.x, (s.y + t * 0.004 * s.z * speed * 3) % h, s.r, s.r);
    }
    raf = requestAnimationFrame(frame);
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}

// ---------- Земля (регистрация): текстура LEXI Space на сфере ----------
export async function earth(canvas) {
  const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  let day, night;
  try {
    [day, night] = await Promise.all([load(import.meta.resolve('lexi-space/textures/earth-day.jpg')), load(import.meta.resolve('lexi-space/textures/earth-night.jpg'))]);
  } catch { return () => {}; }
  const tex = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
  const D = tex(day), N = tex(night), TW = D.width, TH = D.height;
  const ctx = canvas.getContext('2d');
  const S = canvas.width = canvas.height = 420;
  const img = ctx.createImageData(S, S);
  const R = S * 0.5 - 1, c = S / 2;
  const L = [-0.75, -0.2, 0.62]; const n = Math.hypot(...L); L.forEach((v, i) => L[i] = v / n);
  // заранее: нормали и широты для каждого пикселя
  const px = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - c) / R, dy = (y - c) / R, r2 = dx * dx + dy * dy;
    if (r2 >= 1) continue;
    const dz = Math.sqrt(1 - r2);
    const tilt = 0.41, yy = dy * Math.cos(tilt) - dz * Math.sin(tilt), zz = dy * Math.sin(tilt) + dz * Math.cos(tilt);
    const lat = Math.asin(-yy), lon = Math.atan2(dx, zz);
    px.push([(y * S + x) * 4, lon, Math.floor((0.5 - lat / Math.PI) * (TH - 1)), Math.max(-1, dx * L[0] + dy * L[1] + dz * L[2]), dz]);
  }
  let raf = 0, rot = 0, last = performance.now();
  const frame = t => {
    rot += (t - last) * 0.00006; last = t;
    for (const [o, lon, ty, ndl, dz] of px) {
      let u = (lon + rot) / (2 * Math.PI) + 0.5; u -= Math.floor(u);
      const ti = (ty * TW + Math.floor(u * (TW - 1))) * 4;
      const dayK = Math.min(1, Math.max(0, ndl * 3 + 0.15));
      const rim = (1 - dz) ** 2.2;
      img.data[o] = D.data[ti] * dayK * 0.92 + N.data[ti] * (1 - dayK) * 1.1 + rim * 70 * dayK;
      img.data[o + 1] = D.data[ti + 1] * dayK * 0.92 + N.data[ti + 1] * (1 - dayK) * 0.9 + rim * 120 * dayK;
      img.data[o + 2] = D.data[ti + 2] * dayK * 0.95 + N.data[ti + 2] * (1 - dayK) * 0.6 + rim * 200 * dayK;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

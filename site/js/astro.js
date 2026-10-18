// Время, точка наблюдения и астрономия. Положения тел Солнечной системы считает
// astronomy-engine (точность ~1′), звёзды и галактики — из каталога базы с переводом
// в горизонтальные координаты для вашей точки.

import * as A from '../vendor/astronomy.js';

export { A };

// ---------------------------------------------------------------------
//  Время: реальное или ускоренное
// ---------------------------------------------------------------------
export const clock = {
  speed: 0,          // 0 — реальное время; иначе секунд сцены на секунду жизни
  simMs: Date.now(), // текущее время сцены
  lastReal: performance.now(),
  get live() { return this.speed === 0; },
  tick() {
    const realNow = performance.now();
    const dt = realNow - this.lastReal;
    this.lastReal = realNow;
    this.simMs = this.live ? Date.now() : this.simMs + dt * this.speed;
  },
  setSpeed(s) {
    this.speed = s;
    if (s === 0) this.simMs = Date.now();
  },
  date() { return new Date(this.simMs); },
};

// ---------------------------------------------------------------------
//  Точка наблюдения (по умолчанию Москва, пока пользователь не разрешит геолокацию)
// ---------------------------------------------------------------------
export const observer = {
  lat: 55.7558, lon: 37.6173, h: 0.15,   // градусы, км
  fromDevice: false,
  accuracy: null,
  get astro() { return new A.Observer(this.lat, this.lon, this.h * 1000); },
  // для satellite.js — радианы и километры
  get gd() { return { latitude: this.lat * Math.PI / 180, longitude: this.lon * Math.PI / 180, height: this.h }; },
};

const geoListeners = [];
export const onPosition = fn => geoListeners.push(fn);

export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('geolocation'));
    navigator.geolocation.watchPosition(p => {
      observer.lat = p.coords.latitude;
      observer.lon = p.coords.longitude;
      observer.h = (p.coords.altitude || 150) / 1000;
      observer.accuracy = p.coords.accuracy;
      observer.fromDevice = true;
      geoListeners.forEach(fn => fn(p));
      resolve(p);
    }, reject, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  });
}

// ---------------------------------------------------------------------
//  Солнечная система
// ---------------------------------------------------------------------
export const SOLAR = ['Sun', 'Mercury', 'Venus', 'Earth', 'Moon', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

// Всё, что можно сказать о теле прямо сейчас
export function bodyNow(name, date = clock.date()) {
  const time = A.MakeTime(date);
  const obs = observer.astro;
  const out = { name };
  if (name !== 'Earth') {
    const eq = A.Equator(name, time, obs, true, true);         // RA/Dec даты, с аберрацией
    const hor = A.Horizon(time, obs, eq.ra, eq.dec, 'normal');
    const j2000 = A.Equator(name, time, obs, false, true);
    out.ra = j2000.ra; out.dec = j2000.dec;                   // часы, градусы
    out.alt = hor.altitude; out.az = hor.azimuth;
    out.distAu = eq.dist;
    out.con = A.Constellation(j2000.ra, j2000.dec).symbol;
    try {
      const ill = A.Illumination(name, time);
      out.mag = ill.mag; out.phase = ill.phase_fraction;
    } catch { /* у Солнца фазы нет */ }
    if (name !== 'Sun') out.elong = A.AngleFromSun(name, time);
    out.rise = riseSetSafe(name, obs, +1, time);
    out.set = riseSetSafe(name, obs, -1, time);
  }
  if (name !== 'Sun' && name !== 'Moon') out.helioAu = A.HelioDistance(name, time);
  if (name === 'Moon') {
    out.moonPhaseDeg = A.MoonPhase(time);
    out.nextQuarter = A.SearchMoonQuarter(time);
  }
  return out;
}

function riseSetSafe(body, obs, dir, time) {
  try { return A.SearchRiseSet(body, obs, dir, time, 1)?.date || null; } catch { return null; }
}

// Гелиоцентрическое положение в плоскости эклиптики, а.е.
const EQJ_ECL = A.Rotation_EQJ_ECL();
export function helioEcliptic(name, date = clock.date()) {
  const v = A.HelioVector(name, A.MakeTime(date));
  const e = A.RotateVector(EQJ_ECL, v);
  return { x: e.x, y: e.y, z: e.z };
}

// Геоцентрический вектор Солнца/Луны в экваториальной системе J2000 (≈ ECI), км
export function geoVectorKm(name, date = clock.date()) {
  const time = A.MakeTime(date);
  const v = name === 'Moon' ? A.GeoMoon(time) : A.GeoVector(name, time, true);
  return { x: v.x * A.KM_PER_AU, y: v.y * A.KM_PER_AU, z: v.z * A.KM_PER_AU };
}

// ---------------------------------------------------------------------
//  Звёзды и галактики: фиксированные RA/Dec (J2000)
// ---------------------------------------------------------------------

// Матрица J2000 → горизонт наблюдателя. В горизонтальной системе astronomy-engine
// x смотрит на север, y — на запад, z — в зенит.
export function eqjToHorizon(date = clock.date()) {
  return A.Rotation_EQJ_HOR(A.MakeTime(date), observer.astro);
}

export function fixedNow(raDeg, decDeg, distLy, date = clock.date()) {
  const time = A.MakeTime(date);
  const vec = A.VectorFromSphere(new A.Spherical(decDeg, raDeg, 1), time);
  const hor = A.HorizonFromVector(A.RotateVector(A.Rotation_EQJ_HOR(time, observer.astro), vec), 'normal');
  const out = { alt: hor.lat, az: hor.lon, con: A.Constellation(raDeg / 15, decDeg).symbol };
  // Восход и заход звезды: регистрируем её как пользовательское тело Star1
  try {
    A.DefineStar(A.Body.Star1, raDeg / 15, decDeg, Math.max(distLy || 1000, 1));
    const obs = observer.astro;
    const rise = A.SearchRiseSet(A.Body.Star1, obs, +1, time, 1);
    const set = A.SearchRiseSet(A.Body.Star1, obs, -1, time, 1);
    out.rise = rise?.date || null;
    out.set = set?.date || null;
    // Если не нашлось ни восхода, ни захода — объект либо незаходящий, либо невосходящий
    if (!rise && !set) out.always = decDeg * Math.sign(observer.lat || 1) > 0 ? 'up' : 'down';
  } catch { /* редкий случай у полюса */ }
  return out;
}

// Единичный вектор направления по RA/Dec (градусы) в J2000
export function unitFromRaDec(raDeg, decDeg) {
  const ra = raDeg * Math.PI / 180, dec = decDeg * Math.PI / 180;
  return { x: Math.cos(dec) * Math.cos(ra), y: Math.cos(dec) * Math.sin(ra), z: Math.sin(dec) };
}

// ---------------------------------------------------------------------
//  Формат
// ---------------------------------------------------------------------
export const raText = h => {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.round(((h - hh) * 60 - mm) * 60);
  return `${hh}ʰ${String(mm).padStart(2, '0')}ᵐ${String(ss % 60).padStart(2, '0')}ˢ`;
};
export const decText = d => {
  const s = d < 0 ? '−' : '+', a = Math.abs(d), dd = Math.floor(a), mm = Math.round((a - dd) * 60);
  return `${s}${dd}°${String(mm % 60).padStart(2, '0')}′`;
};
export const azText = az => {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return `${az.toFixed(0)}° ${dirs[Math.round(az / 45) % 8]}`;
};

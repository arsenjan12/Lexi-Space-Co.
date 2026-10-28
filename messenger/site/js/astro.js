// =====================================================================
//  Астрономия для инструментов: прогноз ночи, планирование наблюдений,
//  пересчёт координат. Считает astronomy-engine (тот же, что в LEXI Space).
// =====================================================================

import * as A from 'lexi-space/vendor/astronomy.js';
export { A };

export const DEG = Math.PI / 180;

export function observer(loc) {
  return new A.Observer(+loc.lat || 0, +loc.lon || 0, +loc.h || 0);
}

// ---------- каталог Мессье из базы LEXI Space ----------
let messier = null;
export async function loadMessier() {
  if (messier) return messier;
  try {
    const j = await (await fetch(new URL('../data/messier.json', import.meta.url))).json();
    messier = j.features.map(f => ({
      id: f.id,
      name: f.properties.alt || f.properties.desig || f.id,
      desig: f.properties.desig,
      type: f.properties.type,
      mag: f.properties.mag,
      dim: f.properties.dim,
      ra: (f.geometry.coordinates[0] + 360) % 360,   // градусы
      dec: f.geometry.coordinates[1],
    }));
  } catch { messier = []; }
  return messier;
}
export const TYPE_RU = { s: 'спиральная галактика', e: 'эллиптическая галактика', i: 'неправильная галактика', pos: 'звёздное поле', sfr: 'область звездообразования', gc: 'шаровое скопление', oc: 'рассеянное скопление', pn: 'планетарная туманность', en: 'эмиссионная туманность', rn: 'отражательная туманность', snr: 'остаток сверхновой', sg: 'спиральная галактика', eg: 'эллиптическая галактика', lg: 'линзовидная галактика', ig: 'неправильная галактика', g: 'галактика', ds: 'двойная звезда', as: 'астеризм', sc: 'звёздное облако', bn: 'туманность', dn: 'тёмная туманность', '**': 'двойная звезда' };

export const PLANETS = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
export const PLANET_RU = { Sun: 'Солнце', Moon: 'Луна', Mercury: 'Меркурий', Venus: 'Венера', Mars: 'Марс', Jupiter: 'Юпитер', Saturn: 'Сатурн', Uranus: 'Уран', Neptune: 'Нептун' };

// Горизонтальные координаты: target = { body } или { ra (град), dec }
export function altAz(target, date, obs) {
  if (target.body) {
    const eq = A.Equator(target.body, date, obs, true, true);
    const hor = A.Horizon(date, obs, eq.ra, eq.dec, 'normal');
    return { alt: hor.altitude, az: hor.azimuth, ra: eq.ra * 15, dec: eq.dec };
  }
  const rot = A.Rotation_EQJ_HOR(date, obs);
  const v = A.VectorFromSphere(new A.Spherical(target.dec, target.ra, 1), date);
  const hv = A.RotateVector(rot, v);
  const hor = A.HorizonFromVector(hv, 'normal');
  return { alt: hor.lat, az: hor.lon, ra: target.ra, dec: target.dec };
}

export const airmass = alt => alt <= 0 ? Infinity : 1 / (Math.sin((alt + 244 / (165 + 47 * alt ** 1.1)) * DEG));

// Кривая высоты на сутки, начиная с ближайшего полудня
export function altitudeCurve(target, day, obs, steps = 144) {
  const start = new Date(day);
  start.setHours(12, 0, 0, 0);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = new Date(start.getTime() + i * 86400000 / steps);
    const s = altAz({ body: A.Body.Sun }, t, obs).alt;
    const m = altAz({ body: A.Body.Moon }, t, obs).alt;
    const o = altAz(target, t, obs);
    pts.push({ t, alt: o.alt, az: o.az, sun: s, moon: m });
  }
  return pts;
}

function evt(fn) { try { return fn()?.date || null; } catch { return null; } }

// Ночь: закат/рассвет, сумерки, Луна
export function nightReport(date, obs) {
  const noon = new Date(date); noon.setHours(12, 0, 0, 0);
  const sunset = evt(() => A.SearchRiseSet(A.Body.Sun, obs, -1, noon, 1));
  const sunrise = evt(() => A.SearchRiseSet(A.Body.Sun, obs, +1, sunset || noon, 1.2));
  const civil = evt(() => A.SearchAltitude(A.Body.Sun, obs, -1, noon, 1, -6));
  const nautical = evt(() => A.SearchAltitude(A.Body.Sun, obs, -1, noon, 1, -12));
  const astroDusk = evt(() => A.SearchAltitude(A.Body.Sun, obs, -1, noon, 1, -18));
  const astroDawn = evt(() => A.SearchAltitude(A.Body.Sun, obs, +1, astroDusk || noon, 1.2, -18));
  const moonrise = evt(() => A.SearchRiseSet(A.Body.Moon, obs, +1, noon, 1));
  const moonset = evt(() => A.SearchRiseSet(A.Body.Moon, obs, -1, noon, 1));
  const midnight = new Date(noon.getTime() + 12 * 3600e3);
  const phaseAngle = A.MoonPhase(midnight);
  const illum = A.Illumination(A.Body.Moon, midnight).phase_fraction;

  // Тёмное время без Луны (шаг 10 мин)
  let darkMin = 0, moonlessMin = 0;
  if (astroDusk && astroDawn) {
    for (let t = astroDusk.getTime(); t < astroDawn.getTime(); t += 600e3) {
      darkMin += 10;
      if (altAz({ body: A.Body.Moon }, new Date(t), obs).alt < 0) moonlessMin += 10;
    }
  }
  const score = Math.max(1, Math.min(5, Math.round(1 + (moonlessMin / 60) * 0.6 + (1 - illum) * 1.5)));
  return { sunset, sunrise, civil, nautical, astroDusk, astroDawn, moonrise, moonset, phaseAngle, illum, darkMin, moonlessMin, score, polar: !astroDusk };
}

export function phaseName(angle, lang = 'ru') {
  const ru = ['Новолуние', 'Растущий серп', 'Первая четверть', 'Растущая Луна', 'Полнолуние', 'Убывающая Луна', 'Последняя четверть', 'Убывающий серп'];
  const en = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  const i = Math.round(angle / 45) % 8;
  return (lang === 'en' ? en : ru)[i];
}

// ---------- системы координат ----------
// from: 'eq' (RA/Dec J2000), 'gal' (l,b), 'ecl' (λ,β) — всё в градусах
export function convertCoords(from, lonDeg, latDeg, date, obs) {
  const t = A.MakeTime(date);
  const sph = new A.Spherical(latDeg, lonDeg, 1);
  let eqj;
  if (from === 'eq') eqj = A.VectorFromSphere(sph, t);
  else if (from === 'gal') eqj = A.RotateVector(A.Rotation_GAL_EQJ(), A.VectorFromSphere(sph, t));
  else eqj = A.RotateVector(A.Rotation_ECL_EQJ(), A.VectorFromSphere(sph, t));
  const eq = A.SphereFromVector(eqj);
  const gal = A.SphereFromVector(A.RotateVector(A.Rotation_EQJ_GAL(), eqj));
  const ecl = A.SphereFromVector(A.RotateVector(A.Rotation_EQJ_ECL(), eqj));
  const hor = A.HorizonFromVector(A.RotateVector(A.Rotation_EQJ_HOR(t, obs), eqj), 'normal');
  const con = A.Constellation(eq.lon / 15, eq.lat);
  return {
    eq: { ra: (eq.lon + 360) % 360, dec: eq.lat },
    gal: { l: (gal.lon + 360) % 360, b: gal.lat },
    ecl: { lon: (ecl.lon + 360) % 360, lat: ecl.lat },
    hor: { alt: hor.lat, az: (hor.lon + 360) % 360, airmass: airmass(hor.lat) },
    constellation: con.name,
    lst: A.SiderealTime(t) + obs.longitude / 15,
  };
}

// «12h 30m 49.4s» / «12:30:49» / «187.7» → градусы
export function parseAngle(str, isRA = false) {
  const s = String(str).trim().replace(',', '.');
  if (!s) return NaN;
  const parts = s.match(/-?\d+(?:\.\d+)?/g);
  if (!parts) return NaN;
  const neg = /^\s*-/.test(s);
  const hasSex = /[hм:°d'′"ʺ]|\s/.test(s.replace(/^-/, '')) && parts.length > 1;
  if (!hasSex) return +parts[0] * (isRA && /h/i.test(s) ? 15 : 1);
  const [a, b = 0, c = 0] = parts.map(x => Math.abs(+x));
  const v = a + b / 60 + c / 3600;
  return (neg ? -1 : 1) * (isRA ? v * 15 : v);
}

export function fmtHMS(deg) {
  let h = ((deg / 15) % 24 + 24) % 24;
  const H = Math.floor(h); h = (h - H) * 60;
  const M = Math.floor(h); const S = (h - M) * 60;
  return `${String(H).padStart(2, '0')}h ${String(M).padStart(2, '0')}m ${S.toFixed(1).padStart(4, '0')}s`;
}
export function fmtDMS(deg) {
  const sgn = deg < 0 ? '−' : '+';
  let d = Math.abs(deg);
  const D = Math.floor(d); d = (d - D) * 60;
  const M = Math.floor(d); const S = (d - M) * 60;
  return `${sgn}${String(D).padStart(2, '0')}° ${String(M).padStart(2, '0')}′ ${S.toFixed(0).padStart(2, '0')}″`;
}

// ---------- световое загрязнение ----------
// Предельная звёздная величина из яркости неба SQM (формула Шефера / Crumey в упрощении)
export const nelmFromSqm = sqm => 7.93 - 5 * Math.log10(10 ** (4.316 - sqm / 5) + 1);
export function bortleFromSqm(sqm) {
  const t = [[21.99, 1], [21.89, 2], [21.69, 3], [20.49, 4], [19.5, 5], [18.94, 6], [18.38, 7], [17.8, 8]];
  for (const [v, b] of t) if (sqm >= v) return b;
  return 9;
}
export const BORTLE_RU = ['', 'Идеально тёмное небо', 'Типичное тёмное место', 'Сельское небо', 'Переход село–пригород', 'Пригород', 'Яркий пригород', 'Переход пригород–город', 'Городское небо', 'Центр города'];

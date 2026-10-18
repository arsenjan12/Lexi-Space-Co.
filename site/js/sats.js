// Спутники: орбитальные элементы (TLE) из CelesTrak и расчёт положения по SGP4.
// Данные сначала просим у своего сервера (/api/tle) — он подписывает их ML-DSA-65.
// Если сервера нет (локальный просмотр без функций) — берём у CelesTrak напрямую, без подписи.

import * as S from '../vendor/satellite.es.js';
import { observer } from './astro.js';
import { verifySigned } from './pq.js';

export { S };

const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=';
const CACHE_MS = 2 * 3600e3;          // CelesTrak обновляет элементы раз в несколько часов — чаще не дёргаем

// Контрольная сумма строки TLE: цифры + по единице за каждый минус, по модулю 10
export function tleChecksumOk(line) {
  if (!line || line.length < 69) return false;
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += +ch;
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === +line[68];
}

// Эпоха элементов из первой строки: YYDDD.DDDDDDDD
function tleEpoch(l1) {
  const yy = +l1.slice(18, 20), day = +l1.slice(20, 32);
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, 0, 1) + (day - 1) * 86400e3);
}

export function parseTle(text, group) {
  const lines = text.split(/\r?\n/).map(s => s.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      const name = lines[i].trim(), l1 = lines[i + 1], l2 = lines[i + 2];
      const satrec = S.twoline2satrec(l1, l2);
      if (!satrec.error) {
        out.push({
          id: 'sat:' + satrec.satnum.trim(),
          norad: +satrec.satnum, name, group, l1, l2, satrec,
          epoch: tleEpoch(l1),
          checksumOk: tleChecksumOk(l1) && tleChecksumOk(l2),
          incl: +l2.slice(8, 16), ecc: +('0.' + l2.slice(26, 33).trim()), meanMotion: +l2.slice(52, 63),
          pos: null,
        });
      }
      i += 2;
    }
  }
  return out;
}

function cacheGet(key) {
  try {
    const c = JSON.parse(localStorage.getItem(key));
    return c && Date.now() - c.at < CACHE_MS ? c : null;
  } catch { return null; }
}
function cacheSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify({ ...value, at: Date.now() })); } catch { /* переполнено — переживём */ }
}

// Загрузка группы. Возвращает { sats, signed, source, fetchedAt }
export async function loadGroup(group) {
  const key = 'lexi-tle-' + group;
  const cached = cacheGet(key);
  if (cached) return { ...cached, sats: parseTle(cached.tle, group), cached: true };

  // 1) свой сервер с постквантовой подписью
  try {
    const res = await fetch('/api/tle?group=' + encodeURIComponent(group));
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
      const signed = await res.json();
      const check = await verifySigned(signed);
      const payload = JSON.parse(signed.payload);
      const result = { tle: payload.tle, signed: check, source: 'lexi', fetchedAt: payload.fetchedAt };
      if (check.ok) cacheSet(key, result);
      return { ...result, sats: parseTle(payload.tle, group) };
    }
  } catch { /* сервера нет — идём напрямую */ }

  // 2) CelesTrak напрямую
  const res = await fetch(CELESTRAK + encodeURIComponent(group));
  if (!res.ok) throw new Error(`CelesTrak ${group}: ${res.status}`);
  const tle = await res.text();
  const result = { tle, signed: { ok: false, reason: 'unsigned' }, source: 'celestrak', fetchedAt: new Date().toISOString() };
  cacheSet(key, result);
  return { ...result, sats: parseTle(tle, group) };
}

// ---------------------------------------------------------------------
//  Положение и всё, что из него следует
// ---------------------------------------------------------------------

// Положение в ECI (км) — для 3D
export function eci(sat, date) {
  const pv = S.propagate(sat.satrec, date);
  return pv && pv.position ? pv : null;
}

const GPS_L1 = 1575.42e6, C = 299792.458;

// Полная сводка для карточки спутника
export function satNow(sat, date) {
  const pv = eci(sat, date);
  if (!pv) return null;
  const gmst = S.gstime(date);
  const geo = S.eciToGeodetic(pv.position, gmst);
  const ecf = S.eciToEcf(pv.position, gmst);
  const look = S.ecfToLookAngles(observer.gd, ecf);
  const v = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
  // Скорость сближения считаем численно: дальность через секунду минус дальность сейчас
  const later = eci(sat, new Date(date.getTime() + 1000));
  let rangeRate = null;
  if (later) {
    const ecf2 = S.eciToEcf(later.position, S.gstime(new Date(date.getTime() + 1000)));
    rangeRate = S.ecfToLookAngles(observer.gd, ecf2).rangeSat - look.rangeSat;   // км/с
  }
  const periodMin = 1440 / sat.meanMotion;
  return {
    lat: S.degreesLat(geo.latitude), lon: S.degreesLong(geo.longitude), altKm: geo.height,
    speed: v, periodMin,
    az: look.azimuth * 180 / Math.PI, el: look.elevation * 180 / Math.PI, rangeKm: look.rangeSat,
    rangeRate,
    // Доплер на частоте L1 — тот самый f_d = f0·v/c из модуля GNSS
    dopplerL1: rangeRate == null ? null : -GPS_L1 * rangeRate / C,
    ageDays: (date - sat.epoch) / 86400e3,
  };
}

// Следующий пролёт над наблюдателем (угол места > 10°) в ближайшие сутки
export function nextPass(sat, from) {
  const step = 30e3;
  let wasUp = null;
  for (let t = from.getTime(); t < from.getTime() + 86400e3; t += step) {
    const d = new Date(t);
    const pv = eci(sat, d);
    if (!pv) return null;
    const look = S.ecfToLookAngles(observer.gd, S.eciToEcf(pv.position, S.gstime(d)));
    const up = look.elevation * 180 / Math.PI > 10;
    if (wasUp === false && up) return d;
    if (wasUp === null && up) return 'now';
    wasUp = up;
  }
  return null;
}

// Трасса на один виток вперёд — для линии орбиты в 3D
export function orbitTrack(sat, from, points = 180) {
  const period = 1440 / sat.meanMotion * 60e3;
  const out = [];
  for (let i = 0; i <= points; i++) {
    const pv = eci(sat, new Date(from.getTime() + period * i / points));
    if (pv) out.push(pv.position);
  }
  return out;
}

// ---------------------------------------------------------------------
//  Геометрия навигационных спутников над наблюдателем (PDOP, RAIM)
// ---------------------------------------------------------------------
export function gnssGeometry(sats, date, maskDeg = 5) {
  const gmst = S.gstime(date);
  const rows = [];
  for (const sat of sats) {
    const pv = eci(sat, date);
    if (!pv) continue;
    const look = S.ecfToLookAngles(observer.gd, S.eciToEcf(pv.position, gmst));
    const el = look.elevation, az = look.azimuth;
    if (el * 180 / Math.PI < maskDeg) continue;
    // Единичный вектор на спутник в локальных осях восток-север-зенит
    const e = Math.cos(el) * Math.sin(az), n = Math.cos(el) * Math.cos(az), u = Math.sin(el);
    rows.push([-e, -n, -u, 1]);
  }
  const visible = rows.length;
  if (visible < 4) return { visible, pdop: null, hdop: null };
  // (GᵀG)⁻¹ — матрица 4×4
  const GtG = [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const inv = invert4(GtG);
  if (!inv) return { visible, pdop: null, hdop: null };
  return {
    visible,
    pdop: Math.sqrt(inv[0][0] + inv[1][1] + inv[2][2]),
    hdop: Math.sqrt(inv[0][0] + inv[1][1]),
    // RAIM: 5 спутников — сбой можно заметить, 6 — ещё и исключить
    raim: visible >= 6 ? 'fde' : visible >= 5 ? 'fd' : 'none',
  };
}

function invert4(m) {
  const n = 4, a = m.map((row, i) => [...row, ...[0, 1, 2, 3].map(j => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const k = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= k;
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map(row => row.slice(n));
}

// Южно-Атлантическая аномалия: грубый контур области повышенного потока протонов на высотах МКС
export function inSaa(lat, lon) {
  return lat > -50 && lat < 0 && lon > -90 && lon < 40 && ((lat + 25) / 25) ** 2 + ((lon + 25) / 65) ** 2 < 1;
}

// Живые показатели защиты — вместо прежних «вечных true» из SECURITY_CONFIG.
// Каждый показатель реально вычисляется здесь же, из настоящих данных:
// орбит CelesTrak, индекса Kp от NOAA, вашей геолокации и криптографии в браузере.
// Если данных нет — так и пишем, ничего не придумываем.

import { t, num } from './i18n.js';
import { clock, observer, onPosition } from './astro.js';
import { satNow, gnssGeometry, inSaa } from './sats.js';
import { hybridHandshake, verifySigned } from './pq.js';
import { chi2Quantile } from './formulas.js';

// state: wait | ok | warn | alarm | na | ask
export const indicators = {
  i_pq_signature: { state: 'wait', value: '', detail: {} },
  i_hybrid_key: { state: 'wait', value: '', detail: {} },
  i_tle_integrity: { state: 'wait', value: '', detail: {} },
  i_saa: { state: 'wait', value: '', detail: {} },
  i_gnss_geometry: { state: 'wait', value: '', detail: {} },
  i_raim: { state: 'wait', value: '', detail: {} },
  i_ekf_position: { state: 'ask', value: '', detail: {} },
  i_kp: { state: 'wait', value: '', detail: {} },
};

// Журнал инцидентов (цель модуля GNSS «протоколирование инцидентов»): каждое изменение состояния
export const journal = [];
const listeners = [];
export const onIndicators = fn => listeners.push(fn);

function set(id, state, value, detail = {}) {
  const ind = indicators[id];
  if (ind.state !== state && ind.state !== 'wait' && ['warn', 'alarm', 'ok'].includes(state)) {
    journal.unshift({ at: new Date(), id, from: ind.state, to: state, value, lat: observer.lat, lon: observer.lon });
    journal.length = Math.min(journal.length, 50);
  }
  Object.assign(ind, { state, value, detail: { ...ind.detail, ...detail }, at: new Date() });
  listeners.forEach(fn => fn(id, ind));
}

// ---------------------------------------------------------------------
//  Криптография
// ---------------------------------------------------------------------
export function runHybridSelfTest() {
  // Пусть страница сначала отрисуется — ML-KEM занимает десятки миллисекунд
  setTimeout(() => {
    try {
      const r = hybridHandshake();
      set('i_hybrid_key', r.ok ? 'ok' : 'alarm', r.ok ? `${num(r.ms, 0)} ${t('unit.ms')}` : t('ind.alarm'), r);
    } catch (e) {
      set('i_hybrid_key', 'alarm', t('ind.alarm'), { error: e.message });
    }
  }, 600);
}

// Результаты проверки подписей по всем загруженным группам
const signatures = {};
export function reportSignature(group, check, source) {
  signatures[group] = { ...check, source };
  const all = Object.values(signatures);
  const bad = all.filter(s => s.reason === 'invalid' || s.reason === 'kid' || s.reason === 'alg');
  const verified = all.filter(s => s.ok);
  if (bad.length) set('i_pq_signature', 'alarm', t('ind.invalid'), { groups: { ...signatures } });
  else if (verified.length === all.length) set('i_pq_signature', 'ok', t('ind.verified'), { groups: { ...signatures }, ms: verified[0]?.ms });
  else set('i_pq_signature', 'na', t('ind.unsigned'), { groups: { ...signatures } });
}

// ---------------------------------------------------------------------
//  Орбитальные данные
// ---------------------------------------------------------------------
export function checkTle(allSats) {
  if (!allSats.length) return set('i_tle_integrity', 'na', t('ind.na'));
  const failed = allSats.filter(s => !s.checksumOk);
  const now = clock.date();
  const ages = allSats.map(s => (now - s.epoch) / 86400e3).sort((a, b) => a - b);
  const median = ages[Math.floor(ages.length / 2)];
  const state = failed.length ? 'alarm' : median > 7 ? 'alarm' : median > 3 ? 'warn' : 'ok';
  set('i_tle_integrity', state, `${allSats.length - failed.length}/${allSats.length} · ${num(median, 1)} ${t('unit.d')}`,
    { total: allSats.length, failed: failed.map(s => s.name).slice(0, 10), medianAge: median, maxAge: ages[ages.length - 1] });
}

export function checkSaa(iss) {
  if (!iss) return set('i_saa', 'na', t('ind.na'));
  const now = satNow(iss, clock.date());
  if (!now) return set('i_saa', 'na', t('ind.na'));
  const over = inSaa(now.lat, now.lon);
  set('i_saa', over ? 'warn' : 'ok', over ? t('ind.over') : t('ind.clear'), { lat: now.lat, lon: now.lon, alt: now.altKm });
}

export function checkGnss(gpsSats) {
  if (!gpsSats?.length) { set('i_gnss_geometry', 'na', t('ind.na')); set('i_raim', 'na', t('ind.na')); return; }
  const g = gnssGeometry(gpsSats, clock.date());
  const pdopState = g.pdop == null ? 'alarm' : g.pdop > 6 ? 'alarm' : g.pdop > 4 ? 'warn' : 'ok';
  set('i_gnss_geometry', pdopState, g.pdop == null ? '—' : `PDOP ${num(g.pdop, 2)}`, g);
  const raimState = g.raim === 'fde' ? 'ok' : g.raim === 'fd' ? 'warn' : 'alarm';
  set('i_raim', raimState, `${g.visible} ${t('ind.sats')}`, g);
}

// ---------------------------------------------------------------------
//  Космическая погода: индекс Kp
// ---------------------------------------------------------------------
const NOAA_KP = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';

function lastKp(rows) {
  // NOAA отдавал и массив массивов с шапкой, и массив объектов — поддерживаем оба
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const kp = Array.isArray(r) ? parseFloat(r[1]) : parseFloat(r.Kp ?? r.kp_index ?? r.kp);
    const time = Array.isArray(r) ? r[0] : (r.time_tag ?? r.time);
    if (Number.isFinite(kp)) return { kp, time };
  }
  return null;
}

export async function checkKp() {
  let rows = null, signed = null;
  try {
    const res = await fetch('/api/kp');
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
      const s = await res.json();
      signed = await verifySigned(s);
      rows = JSON.parse(s.payload).rows;
    }
  } catch { /* без сервера — напрямую */ }
  if (!rows) {
    try { rows = await (await fetch(NOAA_KP)).json(); } catch { return set('i_kp', 'na', t('ind.na')); }
  }
  const last = lastKp(rows);
  if (!last) return set('i_kp', 'na', t('ind.na'));
  const state = last.kp >= 7 ? 'alarm' : last.kp >= 5 ? 'warn' : 'ok';
  set('i_kp', state, `Kp ${num(last.kp, 1)}`, { kp: last.kp, time: last.time, signed });
}

// ---------------------------------------------------------------------
//  Фильтр Калмана по геолокации устройства
// ---------------------------------------------------------------------
// Состояние [восток, север, v_восток, v_север] в метрах от первой точки, модель — постоянная скорость.
const kf = { x: null, P: null, origin: null, last: null, anomalies: 0, n: 0, eps: null };
const CHI2_THR = chi2Quantile(1 - 0.001, 2);      // α = 0,001 → ≈ 13,8

function toLocal(lat, lon) {
  const R = 6371000, la0 = kf.origin.lat * Math.PI / 180;
  return [(lon - kf.origin.lon) * Math.PI / 180 * R * Math.cos(la0), (lat - kf.origin.lat) * Math.PI / 180 * R];
}

function kalmanStep(pos) {
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  const tSec = pos.timestamp / 1000;
  if (!kf.origin) {
    kf.origin = { lat, lon };
    kf.x = [0, 0, 0, 0];
    kf.P = [[accuracy ** 2, 0, 0, 0], [0, accuracy ** 2, 0, 0], [0, 0, 25, 0], [0, 0, 0, 25]];
    kf.last = tSec;
    set('i_ekf_position', 'ok', `±${num(accuracy, 0)} ${t('unit.m')}`, { accuracy, n: 0 });
    return;
  }
  const dt = Math.max(0.5, tSec - kf.last);
  kf.last = tSec;
  // Прогноз: x = F x, P = F P Fᵀ + Q (ускорение пешехода/машины ~ 1 м/с²)
  const [e, n, ve, vn] = kf.x;
  kf.x = [e + ve * dt, n + vn * dt, ve, vn];
  const q = 1.0, dt2 = dt * dt, dt3 = dt2 * dt / 2, dt4 = dt2 * dt2 / 4;
  const P = kf.P, F = (i, j) => (i === j ? 1 : (i === 0 && j === 2) || (i === 1 && j === 3) ? dt : 0);
  const FP = P.map((_, i) => P[0].map((__, j) => [0, 1, 2, 3].reduce((s, k) => s + F(i, k) * P[k][j], 0)));
  const FPFt = FP.map((row, i) => row.map((_, j) => [0, 1, 2, 3].reduce((s, k) => s + FP[i][k] * F(j, k), 0)));
  const Q = [[dt4, 0, dt3, 0], [0, dt4, 0, dt3], [dt3, 0, dt2, 0], [0, dt3, 0, dt2]].map(r => r.map(v => v * q));
  kf.P = FPFt.map((row, i) => row.map((v, j) => v + Q[i][j]));

  // Невязка ν = z − Hx и её ковариация S = H P Hᵀ + R
  const z = toLocal(lat, lon);
  const nu = [z[0] - kf.x[0], z[1] - kf.x[1]];
  const r = accuracy ** 2;
  const S = [[kf.P[0][0] + r, kf.P[0][1]], [kf.P[1][0], kf.P[1][1] + r]];
  const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
  const Si = [[S[1][1] / det, -S[0][1] / det], [-S[1][0] / det, S[0][0] / det]];
  // Тест χ²: ε = νᵀ S⁻¹ ν
  const eps = nu[0] * (Si[0][0] * nu[0] + Si[0][1] * nu[1]) + nu[1] * (Si[1][0] * nu[0] + Si[1][1] * nu[1]);
  kf.eps = eps; kf.n++;
  const anomalous = eps > CHI2_THR;
  if (anomalous) kf.anomalies++;

  // Обновление: K = P Hᵀ S⁻¹ (аномальную точку не принимаем, чтобы подмена не увела фильтр)
  if (!anomalous) {
    const K = [0, 1, 2, 3].map(i => [kf.P[i][0] * Si[0][0] + kf.P[i][1] * Si[1][0], kf.P[i][0] * Si[0][1] + kf.P[i][1] * Si[1][1]]);
    kf.x = kf.x.map((v, i) => v + K[i][0] * nu[0] + K[i][1] * nu[1]);
    kf.P = kf.P.map((row, i) => row.map((v, j) => v - (K[i][0] * kf.P[0][j] + K[i][1] * kf.P[1][j])));
  }
  set('i_ekf_position', anomalous ? 'alarm' : 'ok', `ε ${num(eps, 1)}`,
    { eps, threshold: CHI2_THR, n: kf.n, anomalies: kf.anomalies, accuracy, jumpM: Math.hypot(nu[0], nu[1]) });
}

onPosition(pos => { if (pos) kalmanStep(pos); });   // null — точку выбрали вручную, фильтру нечего считать

// Состояние «ask» меняется, когда пользователь разрешит геолокацию
export function geoDenied() { set('i_ekf_position', 'na', t('ind.na')); }

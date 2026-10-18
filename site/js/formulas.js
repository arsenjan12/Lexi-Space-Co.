// Калькуляторы для формул из базы. Имя функции = поле formulas.calc.
// Каждая принимает объект параметров (имена из formula_params) и возвращает
// { value, lines, bad? }: value — главное число, lines — что показать человеку.

import { lang, num } from './i18n.js';
import { hybridHandshake } from './pq.js';

const ru = () => lang === 'ru';
const G = 6.67430e-11, C = 299792458, K_B = 1.380649e-23;
const MU_EARTH = 398600.4418;        // км³/с², GM Земли
const R_EARTH = 6371.0;              // км
const M_EARTH = 5.972e24;
const dB = x => 10 * Math.log10(x);
const fromDb = x => 10 ** (x / 10);
const sci = x => {
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -3 && e < 6) return num(x, 4);
  const m = x / 10 ** e;
  return `${m.toFixed(2).replace('.', ru() ? ',' : '.')}·10${String(e).replace('-', '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}`;
};

// Квантиль χ² — приближение Уилсона — Хилферти (точность лучше 1 % при m ≥ 2)
function chi2Quantile(p, m) {
  const z = normalQuantile(p);
  const h = 2 / (9 * m);
  return m * (1 - h + z * Math.sqrt(h)) ** 3;
}
// Квантиль нормального распределения (Acklam)
function normalQuantile(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const lo = 0.02425, hi = 1 - lo;
  let q, r;
  if (p < lo) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > hi) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export { chi2Quantile };

export const calculators = {
  // --- Модуль 1 ---
  tcVerify({ sn, snLast, macOk }) {
    const fresh = sn > snLast, ok = !!macOk && fresh;
    return { value: ok ? 1 : 0, bad: !ok, lines: [
      ru() ? `MAC: ${macOk ? 'верный' : 'неверный'}` : `MAC: ${macOk ? 'valid' : 'invalid'}`,
      ru() ? `Номер: ${fresh ? 'новый' : 'уже был — это повтор'}` : `Number: ${fresh ? 'fresh' : 'already seen — replay'}`,
      ok ? (ru() ? '→ команда исполняется' : '→ command executes') : (ru() ? '→ команда отброшена' : '→ command rejected'),
    ] };
  },
  forgeProbability({ tau }) {
    const log10p = -tau * Math.log10(2);
    return { value: 2 ** -tau, lines: [
      `P ≈ 10^${log10p.toFixed(1)}`,
      ru() ? `Даже при миллиарде попыток в секунду — ${sci(2 ** tau / 1e9 / 3.156e7)} лет на одну удачу`
           : `Even at a billion tries per second — ${sci(2 ** tau / 1e9 / 3.156e7)} years per success`,
    ] };
  },
  seuRate({ sigma, flux, kbytes }) {
    const perBit = sigma * flux;                 // сбоев на бит в секунду
    const bits = kbytes * 1024 * 8;
    const perDay = perBit * bits * 86400;
    return { value: perDay, lines: [
      `λ = ${sci(perBit)} ${ru() ? '1/(бит·с)' : '1/(bit·s)'}`,
      ru() ? `Для ${num(kbytes)} КБ памяти: ≈ ${num(perDay, 2)} сбоев в сутки` : `For ${num(kbytes)} KB of memory: ≈ ${num(perDay, 2)} upsets per day`,
      perDay > 1 ? (ru() ? 'Без EDAC и scrubbing ошибки будут копиться каждый день' : 'Without EDAC and scrubbing errors pile up daily') : '',
    ].filter(Boolean) };
  },
  tmrReliability({ r }) {
    const rt = 3 * r ** 2 - 2 * r ** 3;
    return { value: rt, bad: rt < r, lines: [
      `R_TMR = ${num(rt, 6)}`,
      rt >= r ? (ru() ? `Лучше одной копии на ${num((rt - r) * 100, 3)} п.п.` : `Better than one copy by ${num((rt - r) * 100, 3)} pp`)
              : (ru() ? 'Хуже одной копии: при R < 0,5 троирование вредит' : 'Worse than one copy: TMR hurts when R < 0.5'),
    ] };
  },
  friis({ ptW, gtDb, grDb, fGHz, dKm, sensDbm }) {
    const lambda = C / (fGHz * 1e9);
    const fspl = (4 * Math.PI * dKm * 1000 / lambda) ** 2;
    const prW = ptW * fromDb(gtDb) * fromDb(grDb) / fspl;
    const prDbm = dB(prW * 1000);
    const margin = prDbm - sensDbm;
    // На каком расстоянии запас станет нулевым
    const dMaxKm = dKm * 10 ** (margin / 20);
    return { value: prDbm, bad: margin > 0, lines: [
      `P_r = ${num(prDbm, 1)} ${ru() ? 'дБм' : 'dBm'}`,
      margin > 0 ? (ru() ? `Запас ${num(margin, 1)} дБ — перехват возможен. Шифровать обязательно.` : `Margin ${num(margin, 1)} dB — interception is possible. Encryption is a must.`)
                 : (ru() ? `Ниже чувствительности на ${num(-margin, 1)} дБ` : `Below sensitivity by ${num(-margin, 1)} dB`),
      ru() ? `Перехват реален до ≈ ${num(dMaxKm, 0)} км` : `Interception works up to ≈ ${num(dMaxKm, 0)} km`,
    ] };
  },

  // --- Модуль 2 ---
  thermalNoise({ tK }) {
    const n0 = dB(K_B * tK * 1000);   // дБм/Гц
    return { value: n0, lines: [`N₀ = ${num(n0, 1)} ${ru() ? 'дБм/Гц' : 'dBm/Hz'}`] };
  },
  cn0Effective({ cn0, jc, q, rc }) {
    const eff = dB(1 / (1 / fromDb(cn0) + fromDb(jc) / (q * rc)));
    const lost = eff < 28;
    return { value: eff, bad: lost, lines: [
      `(C/N₀)eff = ${num(eff, 1)} ${ru() ? 'дБ·Гц' : 'dB-Hz'}`,
      lost ? (ru() ? 'Ниже ~28 дБ·Гц — приёмник теряет слежение' : 'Below ~28 dB-Hz — the receiver loses tracking')
           : (ru() ? 'Слежение сохраняется' : 'Tracking holds'),
    ] };
  },
  doppler({ f0MHz, v, thetaDeg }) {
    const fd = f0MHz * 1e6 * v / C * Math.cos(thetaDeg * Math.PI / 180);
    return { value: fd, lines: [`f_d = ${num(fd, 1)} ${ru() ? 'Гц' : 'Hz'} (${num(fd / 1000, 3)} ${ru() ? 'кГц' : 'kHz'})`] };
  },
  pseudorange({ rangeKm, dtuUs, dtiUs, ionoM, tropoM }) {
    const rho = rangeKm * 1000 + C * (dtuUs - dtiUs) * 1e-6 + ionoM + tropoM;
    return { value: rho / 1000, lines: [
      `ρ = ${num(rho / 1000, 3)} ${ru() ? 'км' : 'km'}`,
      ru() ? `Из них ошибка часов: ${num(C * (dtuUs - dtiUs) * 1e-6, 1)} м` : `Clock error share: ${num(C * (dtuUs - dtiUs) * 1e-6, 1)} m`,
    ] };
  },
  // MVDR для линейной решётки с шагом λ/2. R = σ²I + J·a_j·a_jᴴ, обратная — по формуле Шермана — Моррисона.
  mvdrSuppression({ n, sigDeg, jamDeg, jnrDb }) {
    n = Math.round(n);
    const steer = deg => Array.from({ length: n }, (_, k) => { const ph = Math.PI * k * Math.sin(deg * Math.PI / 180); return [Math.cos(ph), Math.sin(ph)]; });
    const as = steer(sigDeg), aj = steer(jamDeg), J = fromDb(jnrDb);
    const dot = (x, y) => x.reduce((s, xi, i) => [s[0] + xi[0] * y[i][0] + xi[1] * y[i][1], s[1] + xi[0] * y[i][1] - xi[1] * y[i][0]], [0, 0]); // xᴴy
    // R⁻¹v = v − (J/(1+J·n)) · a_j (a_jᴴ v)   (σ² = 1)
    const rinv = v => { const c = dot(aj, v), k = J / (1 + J * n); return v.map((vi, i) => [vi[0] - k * (aj[i][0] * c[0] - aj[i][1] * c[1]), vi[1] - k * (aj[i][0] * c[1] + aj[i][1] * c[0])]); };
    const ra = rinv(as), den = dot(as, ra);
    const w = ra.map(x => { const d = den[0] ** 2 + den[1] ** 2; return [(x[0] * den[0] + x[1] * den[1]) / d, (x[1] * den[0] - x[0] * den[1]) / d]; });
    const gain = a => { const g = dot(w, a); return g[0] ** 2 + g[1] ** 2; };
    const supp = dB(gain(as) / Math.max(gain(aj), 1e-30));
    return { value: supp, lines: [
      ru() ? `Помеха с ${jamDeg}° ослаблена на ${num(supp, 1)} дБ относительно спутника` : `Jammer at ${jamDeg}° suppressed by ${num(supp, 1)} dB relative to the satellite`,
      ru() ? `Решётка из ${n} элементов может поставить до ${n - 1} провалов` : `An ${n}-element array can place up to ${n - 1} nulls`,
      ru() ? 'Это идеальная модель; на практике ошибки калибровки ограничивают подавление 30–50 дБ' : 'This is the ideal model; in practice calibration errors cap suppression at 30–50 dB',
    ] };
  },
  chi2Test({ eps, m, alpha }) {
    const thr = chi2Quantile(1 - alpha, Math.round(m));
    const bad = eps > thr;
    return { value: thr, bad, lines: [
      `χ²(${Math.round(m)}, ${1 - alpha}) = ${num(thr, 2)}`,
      bad ? (ru() ? `ε = ${num(eps, 2)} > порога → измерение аномально` : `ε = ${num(eps, 2)} > threshold → anomalous measurement`)
          : (ru() ? `ε = ${num(eps, 2)} ≤ порога → норма` : `ε = ${num(eps, 2)} ≤ threshold → normal`),
    ] };
  },
  visViva({ rKm, aKm }) {
    const v = Math.sqrt(MU_EARTH * (2 / rKm - 1 / aKm));
    return { value: v, bad: !Number.isFinite(v), lines: [`v = ${num(v, 3)} ${ru() ? 'км/с' : 'km/s'}`] };
  },
  orbitalPeriod({ aKm }) {
    const T = 2 * Math.PI * Math.sqrt(aKm ** 3 / MU_EARTH);
    return { value: T / 60, lines: [`T = ${num(T / 60, 2)} ${ru() ? 'мин' : 'min'}`, ru() ? `≈ ${num(86400 / T, 2)} витков в сутки` : `≈ ${num(86400 / T, 2)} orbits per day`] };
  },
  gpsRelativity({ rKm }) {
    const r = rKm * 1000, re = R_EARTH * 1000, gm = MU_EARTH * 1e9;
    const v2 = gm / r;                                     // круговая орбита
    const grav = gm / C ** 2 * (1 / re - 1 / r), kin = v2 / (2 * C ** 2);
    const usDay = (grav - kin) * 86400 * 1e6;
    return { value: usDay, lines: [
      ru() ? `Гравитация: +${num(grav * 86400e6, 1)} мкс/сут, скорость: −${num(kin * 86400e6, 1)} мкс/сут` : `Gravity: +${num(grav * 86400e6, 1)} µs/day, velocity: −${num(kin * 86400e6, 1)} µs/day`,
      ru() ? `Итого ${num(usDay, 1)} мкс/сут ≈ ${num(usDay * 1e-6 * C / 1000, 1)} км ошибки дальности в сутки` : `Net ${num(usDay, 1)} µs/day ≈ ${num(usDay * 1e-6 * C / 1000, 1)} km of range error per day`,
    ] };
  },

  // --- Модуль 3 ---
  mosca({ x, y, z }) {
    const bad = x + y > z;
    return { value: x + y - z, bad, lines: [
      `${x} + ${y} = ${x + y} ${bad ? '>' : '≤'} ${z}`,
      bad ? (ru() ? `Данные уже под угрозой: опоздание ${x + y - z} лет. Переход на ML-KEM нужен сейчас.` : `Data is already at risk: ${x + y - z} years late. Move to ML-KEM now.`)
          : (ru() ? `Запас ${z - x - y} лет` : `${z - x - y} years of margin`),
    ] };
  },
  hybridKey() {
    const r = hybridHandshake();
    return { value: r.ms, bad: !r.ok, lines: [
      r.ok ? (ru() ? 'Обе стороны получили один и тот же ключ' : 'Both sides derived the same key') : (ru() ? 'Ключи не совпали!' : 'Keys do not match!'),
      ru() ? `Отпечаток K: ${r.fingerprint}…` : `K fingerprint: ${r.fingerprint}…`,
      ru() ? `Ключ ML-KEM-768: ${r.sizes.encapKey} Б, шифртекст: ${r.sizes.cipherText} Б` : `ML-KEM-768 key: ${r.sizes.encapKey} B, ciphertext: ${r.sizes.cipherText} B`,
      ru() ? `Заняло ${num(r.ms, 1)} мс в вашем браузере` : `Took ${num(r.ms, 1)} ms in your browser`,
    ] };
  },
  groverSecurity({ k }) {
    return { value: k / 2, bad: k / 2 < 128, lines: [
      `k_eff = ${k / 2} ${ru() ? 'бит' : 'bits'}`,
      k / 2 >= 128 ? (ru() ? 'Достаточно' : 'Enough') : (ru() ? 'Мало: нужен ключ 256 бит' : 'Too few: use a 256-bit key'),
    ] };
  },
  shorOps({ n }) {
    return { value: n ** 3, lines: [ru() ? `≈ ${sci(n ** 3)} квантовых операций — полином, а не экспонента` : `≈ ${sci(n ** 3)} quantum operations — polynomial, not exponential`] };
  },

  // --- Гоша и астрономия ---
  orbitalVelocity({ rKm, tSec }) {
    const v = 2 * Math.PI * rKm / tSec;
    return { value: v, lines: [`v = ${num(v, 3)} ${ru() ? 'км/с' : 'km/s'}`] };
  },
  circularVelocity({ rKm }) {
    const v = Math.sqrt(G * M_EARTH / (rKm * 1000)) / 1000;
    return { value: v, lines: [`v = ${num(v, 3)} ${ru() ? 'км/с' : 'km/s'}`] };
  },
  kepler3({ aAu }) {
    const T = Math.sqrt(aAu ** 3);
    return { value: T, lines: [`T = ${num(T, 3)} ${ru() ? 'лет' : 'yr'} = ${num(T * 365.25, 1)} ${ru() ? 'сут' : 'd'}`] };
  },
  escapeVelocity({ massKg, radiusKm }) {
    const v = Math.sqrt(2 * G * massKg / (radiusKm * 1000)) / 1000;
    return { value: v, lines: [`v_esc = ${num(v, 2)} ${ru() ? 'км/с' : 'km/s'}`] };
  },
  lightTime({ dKm }) {
    const s = dKm * 1000 / C;
    const text = s < 120 ? `${num(s, 2)} ${ru() ? 'с' : 's'}` : s < 7200 ? `${num(s / 60, 1)} ${ru() ? 'мин' : 'min'}` : `${num(s / 3600, 2)} ${ru() ? 'ч' : 'h'}`;
    return { value: s / 60, lines: [`t = ${text}`] };
  },
  absoluteMagnitude({ m, dPc }) {
    const M = m - 5 * Math.log10(dPc / 10);
    return { value: M, lines: [`M = ${num(M, 2)}`] };
  },
  luminosity({ absMag }) {
    const L = 10 ** (0.4 * (4.83 - absMag));
    return { value: L, lines: [`L = ${sci(L)} L☉`] };
  },
  starTemperature({ bv }) {
    const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
    return { value: T, lines: [`T ≈ ${num(T, 0)} K`] };
  },
  hubbleVelocity({ dMly }) {
    const v = 70 * dMly / 3.2616;
    return { value: v, lines: [`v ≈ ${num(v, 0)} ${ru() ? 'км/с' : 'km/s'}`, dMly < 10 ? (ru() ? 'Для такой близкой галактики собственная скорость важнее расширения' : 'For such a close galaxy its own motion dominates the expansion') : ''].filter(Boolean) };
  },
};

export function runFormula(calcName, params) {
  const fn = calculators[calcName];
  if (!fn) return null;
  try {
    return fn(params);
  } catch (e) {
    return { value: NaN, bad: true, lines: [e.message] };
  }
}

// Для карточек: температура звезды и её цвет по B−V
export const starTempK = bv => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));

// =====================================================================
//  TOOLS — правая колонка по эскизу:
//  Астропрогноз · Планирование наблюдений · Карта светового загрязнения ·
//  Алерты · Калькулятор систем координат · Редактор формул · Lexi Space
// =====================================================================

import * as S from './astro.js';
import { tex, esc, katexReady } from './render.js';
import { getLang } from './i18n.js';

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const hm = d => d ? d.toLocaleTimeString(getLang() === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
const L = (ru, en) => getLang() === 'en' ? en : ru;
const num = v => parseFloat(String(v).replace(',', '.'));

function locOf(ctx) {
  const p = ctx.profile();
  const lat = num(p.lat), lon = num(p.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, guess: false } : { lat: 53.9, lon: 27.56, guess: true };
}
function locLine(ctx) {
  const l = locOf(ctx);
  return `<p class="note mono">${l.lat.toFixed(2)}°, ${l.lon.toFixed(2)}° ${l.guess ? L('· Минск по умолчанию, точку можно задать в профиле', '· Minsk by default, set yours in the profile') : ''}</p>`;
}
const isoDate = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------
function moonDisk(canvas, phaseAngle) {
  const c = canvas.getContext('2d'), s = canvas.width, r = s / 2 - 3;
  c.clearRect(0, 0, s, s);
  c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.arc(s / 2, s / 2, r, 0, Math.PI * 2); c.fill();
  const k = Math.cos(phaseAngle * Math.PI / 180);           // 1 — новолуние, −1 — полнолуние
  const waxing = phaseAngle < 180;
  c.fillStyle = css('--ink') || '#f3f0e8';
  c.beginPath();
  c.arc(s / 2, s / 2, r, -Math.PI / 2, Math.PI / 2, !waxing);
  c.ellipse(s / 2, s / 2, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing);
  c.fill();
}

const forecast = {
  id: 'forecast', icon: 'i-moon', title: () => L('Астропрогноз', 'Astro forecast'), sub: () => L('Сумерки, Луна, окно тёмного неба', 'Twilight, Moon, dark-sky window'),
  render(el, ctx) {
    let day = new Date();
    const draw = async () => {
      const loc = locOf(ctx), obs = S.observer(loc);
      const n = S.nightReport(day, obs);
      const h = m => `${Math.floor(m / 60)} ${L('ч', 'h')} ${m % 60} ${L('мин', 'min')}`;
      el.innerHTML = `<div class="stack">
        ${locLine(ctx)}
        <label class="field"><span>${L('Дата', 'Date')}</span><input class="inp mono" type="date" id="fc-date" value="${isoDate(day)}"></label>
        <div style="display:flex;gap:1rem;align-items:center">
          <canvas width="84" height="84" id="fc-moon" style="width:84px;height:84px"></canvas>
          <div><div class="big">${S.phaseName(n.phaseAngle, getLang())}</div>
          <p class="note mono">${L('освещённость', 'illuminated')} ${Math.round(n.illum * 100)} %</p>
          <p class="stars5" aria-label="${n.score}/5">${'★'.repeat(n.score)}${'☆'.repeat(5 - n.score)}</p></div>
        </div>
        ${n.polar ? `<p class="note">${L('Астрономическая ночь не наступает (белые ночи или полярный день).', 'No astronomical night at this date and latitude.')}</p>` : ''}
        <dl class="kv">
          <dt>${L('Закат', 'Sunset')}</dt><dd>${hm(n.sunset)}</dd>
          <dt>${L('Гражд. сумерки', 'Civil dusk')}</dt><dd>${hm(n.civil)}</dd>
          <dt>${L('Навиг. сумерки', 'Nautical dusk')}</dt><dd>${hm(n.nautical)}</dd>
          <dt>${L('Астрон. ночь', 'Astro night')}</dt><dd>${hm(n.astroDusk)} – ${hm(n.astroDawn)}</dd>
          <dt>${L('Тёмное небо', 'Dark sky')}</dt><dd>${h(n.darkMin)}</dd>
          <dt>${L('Без Луны', 'Moonless')}</dt><dd>${h(n.moonlessMin)}</dd>
          <dt>${L('Восход Луны', 'Moonrise')}</dt><dd>${hm(n.moonrise)}</dd>
          <dt>${L('Заход Луны', 'Moonset')}</dt><dd>${hm(n.moonset)}</dd>
          <dt>${L('Рассвет', 'Sunrise')}</dt><dd>${hm(n.sunrise)}</dd>
        </dl>
        <div id="fc-wx"><p class="note mono">${L('Облачность: запрос к 7Timer…', 'Clouds: asking 7Timer…')}</p></div>
        <button type="button" class="btn-line sm" id="fc-post">${L('Отправить прогноз в канал', 'Post forecast to channel')}</button>
      </div>`;
      moonDisk(el.querySelector('#fc-moon'), n.phaseAngle);
      el.querySelector('#fc-date').onchange = e => { const d = new Date(e.target.value + 'T12:00'); if (!isNaN(d)) { day = d; draw(); } };
      el.querySelector('#fc-post').onclick = () => ctx.insert(`**${L('Астропрогноз', 'Astro forecast')}** ${isoDate(day)} · ${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°\n${S.phaseName(n.phaseAngle, getLang())}, ${Math.round(n.illum * 100)} %. ${L('Астрономическая ночь', 'Astronomical night')} ${hm(n.astroDusk)}–${hm(n.astroDawn)}, ${L('без Луны', 'moonless')} ${h(n.moonlessMin)}. ${'★'.repeat(n.score)}`);
      // облачность: 7Timer (открытый API, может быть недоступен в песочнице)
      const wx = el.querySelector('#fc-wx');
      try {
        const ctl = new AbortController(); setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(`https://www.7timer.info/bin/astro.php?lon=${loc.lon.toFixed(2)}&lat=${loc.lat.toFixed(2)}&ac=0&unit=metric&output=json&tzshift=0`, { signal: ctl.signal });
        const j = await r.json();
        const base = j.init; // YYYYMMDDHH UTC
        const t0 = Date.UTC(+base.slice(0, 4), +base.slice(4, 6) - 1, +base.slice(6, 8), +base.slice(8, 10));
        const rows = j.dataseries.slice(0, 8).map(d => {
          const t = new Date(t0 + d.timepoint * 3600e3);
          const cc = d.cloudcover; // 1..9
          return `<div style="display:grid;grid-template-columns:3.2rem 1fr 2.6rem;gap:.5rem;align-items:center"><span class="mono note">${hm(t)}</span><span style="height:6px;border-radius:3px;background:linear-gradient(90deg,var(--accent) ${(10 - cc) * 11}%,var(--line2) 0)"></span><span class="mono note">${Math.round((cc - 1) * 12.5)}%</span></div>`;
        }).join('');
        wx.innerHTML = `<p class="note mono">${L('Ясно ← облачность (7Timer, 24 ч)', 'Clear ← cloud cover (7Timer, 24 h)')}</p><div style="display:grid;gap:.3rem">${rows}</div>`;
      } catch {
        wx.innerHTML = `<p class="note">${L('Прогноз облачности недоступен: нет связи с 7Timer из этой среды. На сайте LEXI он подгружается.', 'Cloud forecast unavailable: 7Timer is unreachable from here.')}</p>`;
      }
    };
    draw();
  },
};

// ---------------------------------------------------------------------
function altChart(canvas, pts, label) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = canvas.width = canvas.clientWidth * dpr, h = canvas.height = canvas.clientHeight * dpr;
  const c = canvas.getContext('2d');
  const pad = { l: 30 * dpr, r: 8 * dpr, t: 10 * dpr, b: 20 * dpr };
  const X = i => pad.l + (i / (pts.length - 1)) * (w - pad.l - pad.r);
  const Y = a => pad.t + (1 - (a + 10) / 100) * (h - pad.t - pad.b);
  const ink = css('--mute'), acc = css('--accent-hi'), line = 'rgba(255,255,255,.08)';
  c.clearRect(0, 0, w, h);
  // ночь: тёмные полосы по высоте Солнца
  pts.forEach((p, i) => {
    if (i === pts.length - 1) return;
    const a = p.sun < -18 ? 0.5 : p.sun < -12 ? 0.32 : p.sun < -6 ? 0.18 : p.sun < 0 ? 0.08 : 0;
    if (a) { c.fillStyle = `rgba(${css('--secure-rgb')},${a * 0.25})`; c.fillRect(X(i), pad.t, X(i + 1) - X(i) + 1, h - pad.t - pad.b); }
  });
  c.font = `${9 * dpr}px "JetBrains Mono", monospace`;
  c.fillStyle = ink; c.strokeStyle = line; c.lineWidth = dpr;
  for (const a of [0, 30, 60, 90]) {
    c.beginPath(); c.moveTo(pad.l, Y(a)); c.lineTo(w - pad.r, Y(a)); c.stroke();
    c.fillText(a + '°', 4 * dpr, Y(a) + 3 * dpr);
  }
  for (let i = 0; i < pts.length; i += 24) c.fillText(String(pts[i].t.getHours()).padStart(2, '0'), X(i) - 6 * dpr, h - 6 * dpr);
  // Луна
  c.setLineDash([3 * dpr, 4 * dpr]); c.strokeStyle = ink; c.beginPath();
  pts.forEach((p, i) => i ? c.lineTo(X(i), Y(Math.max(-10, p.moon))) : c.moveTo(X(i), Y(Math.max(-10, p.moon)))); c.stroke(); c.setLineDash([]);
  // объект
  c.strokeStyle = acc; c.lineWidth = 2 * dpr; c.beginPath();
  pts.forEach((p, i) => i ? c.lineTo(X(i), Y(Math.max(-10, p.alt))) : c.moveTo(X(i), Y(Math.max(-10, p.alt)))); c.stroke();
  let best = 0; pts.forEach((p, i) => { if (p.sun < -12 && p.alt > pts[best].alt) best = i; if (pts[best].sun >= -12 && p.alt > pts[best].alt) best = i; });
  c.fillStyle = acc; c.beginPath(); c.arc(X(best), Y(pts[best].alt), 4 * dpr, 0, Math.PI * 2); c.fill();
  c.fillText(label, pad.l + 4 * dpr, pad.t + 10 * dpr);
  return best;
}

const planner = {
  id: 'planner', icon: 'i-scope', title: () => L('Планирование наблюдений', 'Observation planning'), sub: () => L('Высота объекта за ночь, Луна, воздушная масса', 'Altitude through the night, Moon, airmass'),
  async render(el, ctx, arg) {
    const cat = await S.loadMessier();
    let day = new Date();
    const opts = [...S.PLANETS.map(p => `<option value="body:${p}">${L(S.PLANET_RU[p], p)}</option>`), ...cat.map(o => `<option value="m:${o.id}">${o.id}${o.name !== o.id ? ' · ' + esc(o.name) : ''}</option>`), `<option value="custom">${L('Свои координаты…', 'Custom coordinates…')}</option>`].join('');
    el.innerHTML = `<div class="stack">
      ${locLine(ctx)}
      <div class="row"><label class="field"><span>${L('Объект', 'Target')}</span><select class="inp" id="pl-obj">${opts}</select></label>
      <label class="field"><span>${L('Дата', 'Date')}</span><input class="inp mono" type="date" id="pl-date" value="${isoDate(day)}"></label></div>
      <div class="row" id="pl-custom" hidden><label class="field"><span>RA</span><input class="inp mono" id="pl-ra" placeholder="05h 35m 17s"></label><label class="field"><span>Dec</span><input class="inp mono" id="pl-dec" placeholder="-05° 23′ 28″"></label></div>
      <canvas class="chart" id="pl-chart" aria-label="${L('График высоты', 'Altitude chart')}"></canvas>
      <p class="note">${L('Сплошная — объект, пунктир — Луна, подсветка — сумерки и ночь.', 'Solid: target, dashed: Moon, shading: twilight and night.')}</p>
      <dl class="kv" id="pl-out"></dl>
      <button type="button" class="btn-line sm" id="pl-post">${L('Вставить план в сообщение', 'Insert plan into message')}</button>
    </div>`;
    const sel = el.querySelector('#pl-obj');
    if (arg) {
      const m = cat.find(o => o.id.toLowerCase() === String(arg).toLowerCase().replace(/\s/g, ''));
      if (m) sel.value = 'm:' + m.id;
    } else sel.value = 'm:M42';
    let summary = '';
    const go = () => {
      const loc = locOf(ctx), obs = S.observer(loc);
      let target, name;
      const v = sel.value;
      el.querySelector('#pl-custom').hidden = v !== 'custom';
      if (v.startsWith('body:')) { const b = v.slice(5); target = { body: S.A.Body[b] }; name = L(S.PLANET_RU[b], b); }
      else if (v.startsWith('m:')) { const o = cat.find(x => x.id === v.slice(2)); target = { ra: o.ra, dec: o.dec }; name = o.id + (o.name !== o.id ? ' (' + o.name + ')' : ''); }
      else {
        const ra = S.parseAngle(el.querySelector('#pl-ra').value || '05h 35m 17s', true), dec = S.parseAngle(el.querySelector('#pl-dec').value || '-05 23 28');
        if (!Number.isFinite(ra) || !Number.isFinite(dec)) return;
        target = { ra, dec }; name = `${S.fmtHMS(ra)} ${S.fmtDMS(dec)}`;
      }
      const pts = S.altitudeCurve(target, day, obs);
      const best = altChart(el.querySelector('#pl-chart'), pts, name);
      const top = pts.reduce((a, p) => p.alt > a.alt ? p : a, pts[0]);
      const b = pts[best];
      const sep = (() => { try { const mo = S.altAz({ body: S.A.Body.Moon }, b.t, obs); const tg = S.altAz(target, b.t, obs); const d = Math.acos(Math.sin(mo.alt * S.DEG) * Math.sin(tg.alt * S.DEG) + Math.cos(mo.alt * S.DEG) * Math.cos(tg.alt * S.DEG) * Math.cos((mo.az - tg.az) * S.DEG)); return d / S.DEG; } catch { return NaN; } })();
      el.querySelector('#pl-out').innerHTML = `
        <dt>${L('Кульминация', 'Transit')}</dt><dd>${hm(top.t)} · ${top.alt.toFixed(1)}°</dd>
        <dt>${L('Лучшее время ночью', 'Best at night')}</dt><dd>${b.alt > 0 ? hm(b.t) + ' · ' + b.alt.toFixed(1) + '°' : L('не поднимается', 'below horizon')}</dd>
        <dt>${L('Воздушная масса', 'Airmass')}</dt><dd>${b.alt > 0 ? S.airmass(b.alt).toFixed(2) : '—'}</dd>
        <dt>${L('До Луны', 'Moon distance')}</dt><dd>${Number.isFinite(sep) ? sep.toFixed(0) + '°' : '—'}</dd>`;
      summary = `🔭 **${L('План', 'Plan')}: ${name}** · ${isoDate(day)}\n${L('Лучшее время', 'Best time')} ${hm(b.t)}, ${L('высота', 'alt')} ${b.alt.toFixed(1)}°, X = ${b.alt > 0 ? S.airmass(b.alt).toFixed(2) : '—'}; ${L('до Луны', 'Moon')} ${Number.isFinite(sep) ? sep.toFixed(0) + '°' : '—'}.`;
    };
    sel.onchange = go;
    el.querySelector('#pl-date').onchange = e => { const d = new Date(e.target.value + 'T12:00'); if (!isNaN(d)) { day = d; go(); } };
    el.querySelector('#pl-ra').oninput = el.querySelector('#pl-dec').oninput = go;
    el.querySelector('#pl-post').onclick = () => ctx.insert(summary);
    requestAnimationFrame(go);
  },
};

// ---------------------------------------------------------------------
const lightpol = {
  id: 'lightpol', icon: 'i-map', title: () => L('Карта светового загрязнения', 'Light-pollution map'), sub: () => L('Шкала Бортля, SQM, предельная величина', 'Bortle scale, SQM, limiting magnitude'),
  render(el, ctx) {
    const loc = locOf(ctx);
    el.innerHTML = `<div class="stack">
      ${locLine(ctx)}
      <a class="btn-gold sm" target="_blank" rel="noopener noreferrer" href="https://www.lightpollutionmap.info/#zoom=9.00&lat=${loc.lat.toFixed(4)}&lon=${loc.lon.toFixed(4)}&state=eyJiYXNlbWFwIjoiTGF5ZXJCaW5nUm9hZCIsIm92ZXJsYXkiOiJ3YV8yMDE1Iiwib3ZlcmxheWNvbG9yIjpmYWxzZSwib3ZlcmxheW9wYWNpdHkiOjYwLCJmZWF0dXJlc29wYWNpdHkiOjg1fQ==">${L('Открыть карту для этой точки', 'Open map at this point')} ↗</a>
      <label class="field"><span>${L('Яркость неба SQM, зв. вел./″²', 'Sky brightness SQM, mag/arcsec²')}</span><input type="range" id="lp-sqm" min="16" max="22" step="0.05" value="20.4"></label>
      <div style="display:flex;align-items:baseline;gap:.8rem"><span class="big" id="lp-b">4</span><span id="lp-d"></span></div>
      <dl class="kv"><dt>SQM</dt><dd id="lp-s"></dd><dt>${L('Пред. звёздная вел.', 'Naked-eye limit')}</dt><dd id="lp-n"></dd></dl>
      <p class="note">${L('Предельная величина: NELM = 7,93 − 5·lg(10^(4,316 − SQM/5) + 1). Цифры по SQM-метру или по карте выше.', 'NELM = 7.93 − 5·log₁₀(10^(4.316 − SQM/5) + 1). Read SQM from a meter or the map above.')}</p>
    </div>`;
    const r = el.querySelector('#lp-sqm');
    const upd = () => {
      const s = +r.value, b = S.bortleFromSqm(s);
      el.querySelector('#lp-b').textContent = L('Бортль ', 'Bortle ') + b;
      el.querySelector('#lp-d').textContent = L(S.BORTLE_RU[b], ['', 'Excellent dark site', 'Typical dark site', 'Rural sky', 'Rural/suburban', 'Suburban', 'Bright suburban', 'Suburban/urban', 'City sky', 'Inner city'][b]);
      el.querySelector('#lp-s').textContent = s.toFixed(2);
      el.querySelector('#lp-n').textContent = S.nelmFromSqm(s).toFixed(1) + 'ᵐ';
    };
    r.oninput = upd; upd();
  },
};

// ---------------------------------------------------------------------
// Алерты: только настоящие данные — расчёт событий неба и индекс Kp NOAA
const SHOWERS = [
  ['Квадрантиды', 'Quadrantids', 0, 3], ['Лириды', 'Lyrids', 3, 22], ['Эта-Аквариды', 'Eta Aquariids', 4, 6], ['Персеиды', 'Perseids', 7, 12],
  ['Ориониды', 'Orionids', 9, 21], ['Леониды', 'Leonids', 10, 17], ['Геминиды', 'Geminids', 11, 14],
];
function skyEvents(now = new Date(), days = 60) {
  const A = S.A, end = now.getTime() + days * 864e5, out = [];
  const QN = [L('Новолуние', 'New Moon'), L('Первая четверть', 'First quarter'), L('Полнолуние', 'Full Moon'), L('Последняя четверть', 'Last quarter')];
  try {
    let q = A.SearchMoonQuarter(now);
    while (q.time.date.getTime() < end) { out.push({ ts: q.time.date.getTime(), kind: 'moon', text: QN[q.quarter] }); q = A.NextMoonQuarter(q); }
  } catch {}
  try {
    const e = A.SearchLunarEclipse(now);
    if (e.peak.date.getTime() < now.getTime() + 365 * 864e5) out.push({ ts: e.peak.date.getTime(), kind: 'ecl', text: L('Лунное затмение', 'Lunar eclipse') + ` (${e.kind})` });
  } catch {}
  try {
    const e = A.SearchGlobalSolarEclipse(now);
    if (e.peak.date.getTime() < now.getTime() + 365 * 864e5) out.push({ ts: e.peak.date.getTime(), kind: 'ecl', text: L('Солнечное затмение', 'Solar eclipse') + ` (${e.kind})` });
  } catch {}
  for (const b of ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    try {
      const t = A.SearchRelativeLongitude(A.Body[b], 0, now);
      if (t.date.getTime() < now.getTime() + 365 * 864e5) out.push({ ts: t.date.getTime(), kind: 'opp', text: L(`Противостояние: ${S.PLANET_RU[b]}`, `${b} at opposition`) });
    } catch {}
  }
  for (const [ru, en, m, d] of SHOWERS) {
    let t = new Date(now.getFullYear(), m, d, 3);
    if (t < now - 864e5) t = new Date(now.getFullYear() + 1, m, d, 3);
    out.push({ ts: t.getTime(), kind: 'met', text: L(`Метеорный поток ${ru} — максимум`, `${en} meteor shower peak`) });
  }
  return out.filter(e => e.ts >= now.getTime() - 864e5).sort((x, y) => x.ts - y.ts);
}
const alerts = {
  id: 'alerts', icon: 'i-alert', title: () => L('Алерты', 'Alerts'), sub: () => L('События неба и космическая погода', 'Sky events and space weather'),
  render(el) {
    let filter = 'all';
    const kinds = { all: L('все', 'all'), moon: L('Луна', 'Moon'), ecl: L('затмения', 'eclipses'), opp: L('планеты', 'planets'), met: L('метеоры', 'meteors') };
    const fmt = ts => new Date(ts).toLocaleString(getLang() === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const events = skyEvents();
    const draw = () => {
      const list = events.filter(a => filter === 'all' || a.kind === filter);
      el.innerHTML = `<div class="stack">
        <div id="al-kp"></div>
        <div class="chips">${Object.entries(kinds).map(([k, v]) => `<button type="button" class="chip" aria-pressed="${filter === k}" data-k="${k}">${v}</button>`).join('')}</div>
        ${list.length ? list.slice(0, 14).map(a => `<div class="alert ${a.kind}"><small>${fmt(a.ts)}</small><div>${esc(a.text)}</div></div>`).join('') : `<p class="note">${L('В ближайшее время ничего.', 'Nothing soon.')}</p>`}
      </div>`;
      el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { filter = b.dataset.k; draw(); });
      kp(el.querySelector('#al-kp'));
    };
    let kpHTML = null;
    const kp = async box => {
      if (kpHTML !== null) { box.innerHTML = kpHTML; return; }
      try {
        const ctl = new AbortController(); setTimeout(() => ctl.abort(), 5000);
        const j = await (await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', { signal: ctl.signal })).json();
        const last = j[j.length - 1];
        const v = parseFloat(last[1] ?? last.Kp ?? last.kp_index);
        kpHTML = Number.isFinite(v) ? `<div class="alert live"><small>NOAA SWPC · ${esc(String(last[0] ?? last.time_tag ?? ''))} UTC</small><div><b>Kp = ${v.toFixed(2)}</b> — ${v >= 5 ? L('геомагнитная буря', 'geomagnetic storm') : v >= 4 ? L('возмущённо', 'active') : L('спокойно', 'quiet')}</div></div>` : '';
      } catch { kpHTML = ''; }
      box.innerHTML = kpHTML;
    };
    draw();
  },
};

const coords = {
  id: 'coords', icon: 'i-compass', title: () => L('Калькулятор систем координат', 'Coordinate converter'), sub: () => L('Экваториальные, галактические, эклиптика, горизонт', 'Equatorial, galactic, ecliptic, horizon'),
  async render(el, ctx) {
    const cat = await S.loadMessier();
    el.innerHTML = `<div class="stack">
      ${locLine(ctx)}
      <label class="field"><span>${L('Из системы', 'From')}</span><select class="inp" id="cc-sys">
        <option value="eq">RA / Dec (J2000)</option><option value="gal">${L('Галактические', 'Galactic')} l / b</option><option value="ecl">${L('Эклиптические', 'Ecliptic')} λ / β</option></select></label>
      <div class="row"><label class="field"><span id="cc-l1">RA</span><input class="inp mono" id="cc-a" value="00h 42m 44.3s"></label>
      <label class="field"><span id="cc-l2">Dec</span><input class="inp mono" id="cc-b" value="+41° 16′ 09″"></label></div>
      <label class="field"><span>${L('Или объект', 'Or object')}</span><select class="inp" id="cc-obj"><option value="">—</option>${cat.map(o => `<option value="${o.id}">${o.id}${o.name !== o.id ? ' · ' + esc(o.name) : ''}</option>`).join('')}</select></label>
      <dl class="kv" id="cc-out"></dl>
      <button type="button" class="btn-line sm" id="cc-ins">${L('Вставить в сообщение', 'Insert into message')}</button>
    </div>`;
    const $ = s => el.querySelector(s);
    let last = '';
    const go = () => {
      const sys = $('#cc-sys').value;
      $('#cc-l1').textContent = { eq: 'RA', gal: 'l, °', ecl: 'λ, °' }[sys];
      $('#cc-l2').textContent = { eq: 'Dec', gal: 'b, °', ecl: 'β, °' }[sys];
      const a = S.parseAngle($('#cc-a').value, sys === 'eq'), b = S.parseAngle($('#cc-b').value);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) > 90) { $('#cc-out').innerHTML = `<dt>!</dt><dd>${L('Проверьте ввод', 'Check the input')}</dd>`; return; }
      const r = S.convertCoords(sys, a, b, new Date(), S.observer(locOf(ctx)));
      $('#cc-out').innerHTML = `
        <dt>RA</dt><dd>${S.fmtHMS(r.eq.ra)}</dd><dt>Dec</dt><dd>${S.fmtDMS(r.eq.dec)}</dd>
        <dt>l / b</dt><dd>${r.gal.l.toFixed(4)}° / ${r.gal.b >= 0 ? '+' : ''}${r.gal.b.toFixed(4)}°</dd>
        <dt>λ / β</dt><dd>${r.ecl.lon.toFixed(4)}° / ${r.ecl.lat >= 0 ? '+' : ''}${r.ecl.lat.toFixed(4)}°</dd>
        <dt>Alt / Az</dt><dd>${r.hor.alt.toFixed(2)}° / ${r.hor.az.toFixed(2)}°</dd>
        <dt>${L('Возд. масса', 'Airmass')}</dt><dd>${Number.isFinite(r.hor.airmass) ? r.hor.airmass.toFixed(3) : L('под горизонтом', 'below horizon')}</dd>
        <dt>${L('Созвездие', 'Constellation')}</dt><dd>${r.constellation}</dd>
        <dt>LST</dt><dd>${S.fmtHMS(((r.lst % 24) + 24) % 24 * 15)}</dd>`;
      last = `RA ${S.fmtHMS(r.eq.ra)}, Dec ${S.fmtDMS(r.eq.dec)} → $l = ${r.gal.l.toFixed(3)}^\\circ,\\ b = ${r.gal.b.toFixed(3)}^\\circ$; ${L('сейчас', 'now')} Alt ${r.hor.alt.toFixed(1)}°, Az ${r.hor.az.toFixed(1)}° (${r.constellation})`;
    };
    $('#cc-sys').onchange = () => { $('#cc-a').value = ''; $('#cc-b').value = ''; go(); };
    $('#cc-a').oninput = $('#cc-b').oninput = go;
    $('#cc-obj').onchange = e => {
      const o = cat.find(x => x.id === e.target.value); if (!o) return;
      $('#cc-sys').value = 'eq'; $('#cc-a').value = S.fmtHMS(o.ra); $('#cc-b').value = S.fmtDMS(o.dec); go();
    };
    $('#cc-ins').onclick = () => ctx.insert(last);
    go();
  },
};

// ---------------------------------------------------------------------
const TEMPLATES = [
  ['Доплер', 'Doppler', "f' \\approx f_0\\left(1 \\pm \\frac{v}{c}\\right)"],
  ['Вис-вива', 'Vis-viva', 'v^2 = GM\\left(\\frac{2}{r} - \\frac{1}{a}\\right)'],
  ['III закон Кеплера', "Kepler's 3rd law", 'T^2 = \\frac{4\\pi^2}{GM}\\,a^3'],
  ['Циолковский', 'Tsiolkovsky', '\\Delta v = I_{sp}\\, g_0 \\ln\\frac{m_0}{m_f}'],
  ['Хаббл', 'Hubble', 'v = H_0\\, d,\\quad H_0 \\approx 70\\ \\text{км/с/Мпк}'],
  ['Стефан–Больцман', 'Stefan–Boltzmann', 'L = 4\\pi R^2 \\sigma T^4'],
  ['Шварцшильд', 'Schwarzschild', 'r_s = \\frac{2GM}{c^2}'],
  ['Погсон', 'Pogson', 'm_1 - m_2 = -2.5\\,\\log_{10}\\frac{F_1}{F_2}'],
  ['Модуль расстояния', 'Distance modulus', 'm - M = 5\\log_{10} d - 5'],
  ['Пропускная способность', 'Shannon capacity', 'C = B \\log_2\\!\\left(1 + \\frac{S}{N}\\right)'],
];
const formula = {
  id: 'formula', icon: 'i-sigma', title: () => L('Редактор формул', 'Formula editor'), sub: () => L('LaTeX с живым предпросмотром', 'LaTeX with live preview'),
  async render(el, ctx) {
    await katexReady;
    el.innerHTML = `<div class="stack">
      <div class="chips">${TEMPLATES.map((t, i) => `<button type="button" class="chip" data-i="${i}">${L(t[0], t[1])}</button>`).join('')}</div>
      <label class="field"><span>LaTeX</span><textarea class="inp mono" id="fx-src" rows="4" spellcheck="false">${TEMPLATES[0][2]}</textarea></label>
      <div class="tex-out" id="fx-out"></div>
      <div class="row"><button type="button" class="btn-gold sm" id="fx-ins">${L('В сообщение', 'Insert')}</button><button type="button" class="btn-line sm" id="fx-inline">${L('В строку $…$', 'Inline $…$')}</button></div>
      <p class="note">${L('Формулы рендерятся у каждого получателя после расшифровки; по сети идёт только шифротекст исходника.', 'Formulas render for each recipient after decryption; only ciphertext of the source travels.')}</p>
    </div>`;
    const src = el.querySelector('#fx-src'), out = el.querySelector('#fx-out');
    const upd = () => { out.innerHTML = tex(src.value, true); };
    src.oninput = upd; upd();
    el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { src.value = TEMPLATES[+b.dataset.i][2]; upd(); });
    el.querySelector('#fx-ins').onclick = () => ctx.insert(`$$${src.value}$$`);
    el.querySelector('#fx-inline').onclick = () => ctx.insert(`$${src.value}$`);
  },
};

// ---------------------------------------------------------------------
const lexispace = {
  id: 'lexispace', icon: 'i-rocket', title: () => 'Lexi Space', sub: () => L('Спутники, небо и формулы защиты в 3D', 'Satellites, sky and protection formulas in 3D'),
  render(el, ctx) {
    el.innerHTML = `<div class="stack">
      <p class="note">${L('Ситуационный центр LEXI: спутники в реальном времени (SGP4), небо и Солнечная система, 16 угроз и 27 контрмер с формулами, LexiAI в браузере.', 'The LEXI situation centre: real-time satellites (SGP4), the sky and Solar System, 16 threats and 27 countermeasures with formulas, LexiAI in the browser.')}</p>
      <a class="btn-gold sm" href="https://lexi-space.netlify.app/" target="_blank" rel="noopener noreferrer">${L('Открыть LEXI Space', 'Open LEXI Space')} ↗</a>
      <label class="field"><span>${L('Поделиться объектом', 'Share an object')}</span><input class="inp" id="ls-q" placeholder="${L('МКС, Сириус, M31…', 'ISS, Sirius, M31…')}"></label>
      <button type="button" class="btn-line sm" id="ls-ins">${L('Вставить ссылку lexi:', 'Insert lexi: link')}</button>
      <p class="note">${L('В сообщении ссылка станет карточкой объекта с переходом в LEXI Space, SIMBAD и NED.', 'In a message the link becomes an object card linking to LEXI Space, SIMBAD and NED.')}</p>
    </div>`;
    el.querySelector('#ls-ins').onclick = () => {
      const q = el.querySelector('#ls-q').value.trim(); if (!q) return;
      ctx.insert(/\s/.test(q) ? `lexi:"${q}"` : `lexi:${q}`);
    };
  },
};

export const TOOLS = [forecast, planner, lightpol, alerts, coords, formula, lexispace];

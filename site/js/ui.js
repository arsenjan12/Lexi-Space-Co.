// Интерфейс: карточки объектов, формул и угроз, экран модулей, поиск.
// Всё, что показывается, берётся из базы (db.js) и живых расчётов (astro.js, sats.js).

import katex from '../vendor/katex.mjs';
import * as db from './db.js';
import { t, lang, num, locale, unit } from './i18n.js';
import { clock, observer, bodyNow, fixedNow, raText, decText, azText, A } from './astro.js';
import { satNow, nextPass } from './sats.js';
import { runFormula, starTempK } from './formulas.js';
import { indicators, journal } from './security.js';
import { createPreview } from './models.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------
//  Формулы и разметка портала
// ---------------------------------------------------------------------
export const tex = (src, display = false) => katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore' });

// **жирный**, • пункт, $…$ и $$…$$ — та же разметка, что в lexi-translations.js
export function portalMarkup(text) {
  const blocks = String(text || '').split(/\n{2,}/);
  return blocks.map(block => {
    const lines = block.split('\n');
    const inline = s => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\$\$([^$]+)\$\$/g, (_, m) => `<div class="eq">${tex(unesc(m), true)}</div>`)
      .replace(/\$([^$]+)\$/g, (_, m) => tex(unesc(m)));
    if (lines.every(l => l.startsWith('• '))) return `<ul>${lines.map(l => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
    return lines.map(l => l.startsWith('$$') ? inline(l) : `<p>${inline(l)}</p>`).join('');
  }).join('');
}
const unesc = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// ---------------------------------------------------------------------
//  Панель справа
// ---------------------------------------------------------------------
const panel = $('#panel'), sheet = $('#panel .sheet'), body = $('#panel-body');
let tickFn = null, disposePreview = null, current = null;
const history = [];

export function openPanel(html, { wide = false, modal = false, tick = null, ref = null } = {}) {
  disposePreview?.(); disposePreview = null;
  if (current) history.push(current);
  current = ref;
  body.innerHTML = html;
  sheet.classList.toggle('wide', wide);
  panel.classList.toggle('modal', modal);
  panel.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => panel.classList.add('show'));
  sheet.scrollTop = 0;
  tickFn = tick;
  tick?.();
  wireCalcs(body);
}

export function closePanel() {
  panel.classList.remove('show');
  panel.setAttribute('aria-hidden', 'true');
  disposePreview?.(); disposePreview = null;
  tickFn = null; current = null; history.length = 0;
  onClose?.();
}
let onClose = null;
export const setOnClose = fn => { onClose = fn; };
panel.addEventListener('click', e => { if (e.target.closest('[data-close]')) closePanel(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('show')) closePanel(); });

export const panelTick = () => tickFn?.();
export const panelRef = () => current;

function preview(spec) {
  const canvas = $('.preview canvas', body);
  if (canvas) disposePreview = createPreview(canvas, spec);
}

// ---------------------------------------------------------------------
//  Блоки карточек
// ---------------------------------------------------------------------
const fact = (key, value, live = false) => `<div><dt>${esc(t(key))}</dt><dd${live ? ' class="live"' : ''} data-f="${key}">${value ?? '—'}</dd></div>`;
const setFact = (key, value) => { const el = body.querySelector(`[data-f="${key}"]`); if (el && el.innerHTML !== String(value)) el.innerHTML = value ?? '—'; };

const timeFmt = d => d ? d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) + (d.toDateString() !== new Date().toDateString() ? ' ' + d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '') : '—';
const distText = km => km < 1e6 ? `${num(km, 0)} ${t('unit.km')}` : `${num(km / 1.495978707e8, 3)} ${t('unit.au')} · ${num(km / 1e6, 1)} млн ${t('unit.km')}`.replace('млн', lang === 'ru' ? 'млн' : 'M');
const lightText = sec => sec < 120 ? `${num(sec, 1)} с`.replace(' с', lang === 'ru' ? ' с' : ' s') : sec < 7200 ? `${num(sec / 60, 1)} ${t('unit.min')}` : `${num(sec / 3600, 1)} ${t('unit.h')}`;
const lyText = ly => ly >= 1e6 ? `${num(ly / 1e6, 2)} ${lang === 'ru' ? 'млн' : 'M'} ${t('unit.ly')}` : `${num(ly, ly < 100 ? 1 : 0)} ${t('unit.ly')}`;
const altAz = (alt, az) => alt == null ? '—' : `${azText(az)} / ${alt >= 0 ? '' : '−'}${Math.abs(alt).toFixed(1)}°${alt < 0 ? ` <small>(${t('f.below')})</small>` : ''}`;

// Блок формулы: LaTeX, пояснение и калькулятор с подставленными значениями
export function formulaBlock(id, values = {}, { title = true } = {}) {
  const f = db.formula(id);
  if (!f) return '';
  const params = db.formulaParams(id);
  const inputs = params.map(p => {
    const v = values[p.name] ?? p.def;
    return `<label>${esc(lang === 'ru' ? p.label_ru : p.label_en)}<span class="sym">${p.unit ? esc(unit(p.unit)) : ''}</span>
      <input type="number" name="${p.name}" value="${v}" ${p.step ? `step="${p.step}"` : 'step="any"'} ${p.min != null ? `min="${p.min}"` : ''} ${p.max != null ? `max="${p.max}"` : ''} inputmode="decimal"></label>`;
  }).join('');
  return `<div class="fblock">
    ${title ? `<p class="p-text"><b><button type="button" class="linkish" data-open="formula:${id}">${esc(f.title)}</button></b></p>` : ''}
    <div class="eq">${tex(f.latex, true)}</div>
    ${f.calc ? `<form class="calc" data-calc="${f.calc}">${inputs}<output></output></form>` : `<p class="p-note">${t('p.noCalc')}</p>`}
  </div>`;
}

function wireCalcs(root) {
  root.querySelectorAll('form.calc[data-calc]').forEach(form => {
    const run = () => {
      const params = Object.fromEntries([...form.querySelectorAll('input')].map(i => [i.name, parseFloat(i.value)]));
      const r = runFormula(form.dataset.calc, params);
      const out = form.querySelector('output');
      if (!r) { out.textContent = ''; return; }
      out.textContent = r.lines.join('\n');
      out.classList.toggle('bad', !!r.bad);
    };
    form.addEventListener('input', run);
    form.addEventListener('submit', e => e.preventDefault());
    run();
  });
}

const linkList = items => items.length ? `<ul class="links">${items.map(i =>
  `<li><button type="button" data-open="${i.type}:${i.id}">${esc(i.title)}<small>${esc(i.tag || '')}</small></button></li>`).join('')}</ul>` : '';

// ---------------------------------------------------------------------
//  Карточки небесных объектов
// ---------------------------------------------------------------------
export function showObject(ref, ctx) {
  if (ref.type === 'sat') return showSatellite(ref.sat, ctx);
  if (ref.type === 'body') return showBody(ref.id, ctx);
  if (ref.type === 'star') return showStar(ref.row, ctx);
  if (ref.type === 'dso') return showDso(ref.row, ctx);
  if (ref.type === 'neo') return showNeo(ref.neo, ctx);
}

function showSatellite(sat, ctx) {
  const known = db.knownSatellite(sat.norad);
  const group = db.one('SELECT * FROM sat_groups WHERE id = ?', [sat.group]);
  const name = known ? db.pick(known, 'name') : sat.name;
  const src = ctx.groupSource?.(sat.group);
  const isGnss = ['gps-ops', 'glo-ops', 'galileo', 'beidou'].includes(sat.group);
  const a = Math.cbrt(398600.4418 * (86400 / (2 * Math.PI * sat.meanMotion)) ** 2);
  let pass = null, passAt = -Infinity;   // -∞: посчитать сразу при открытии

  openPanel(`
    <p class="p-kind">${t('kind.satellite')} · ${esc(db.pick(group, 'name') || sat.group)}</p>
    <h2 class="p-title" id="panel-title">${esc(name)}</h2>
    <p class="p-sub">${esc(known ? db.pick(known, 'about') : db.pick(group, 'purpose') || '')}</p>
    <div class="preview"><canvas></canvas></div>
    <p class="kicker"><span class="dot live"></span>${t('p.now')}</p>
    <dl class="facts">
      ${fact('f.lat', '', true)}${fact('f.lon', '', true)}${fact('f.alt', '', true)}${fact('f.speed', '', true)}
      ${fact('f.azel', '', true)}${fact('f.range', '', true)}
      ${isGnss ? fact('f.doppler', '', true) : ''}${fact('f.nextpass', '…')}
      ${fact('f.period', `${num(1440 / sat.meanMotion, 1)} ${t('unit.min')}`)}${fact('f.incl', `${num(sat.incl, 2)}°`)}
      ${fact('f.ecc', num(sat.ecc, 5))}${fact('f.epoch', '', true)}
      ${fact('f.norad', sat.norad)}${known ? fact('f.launched', known.launched) : ''}
      ${known?.operator ? fact('f.operator', esc(known.operator)) : ''}
    </dl>
    <p class="p-note">${t('p.source')}: ${esc(src?.signed?.ok ? t('sat.source.signed') : t('sat.source.direct'))}. TLE ${sat.checksumOk ? '✓ checksum' : '✗ checksum'}.</p>
    <h3 class="p-h">${t('p.formulas')}</h3>
    ${formulaBlock('f_period', { aKm: Math.round(a) })}
    ${formulaBlock('f_visviva', { rKm: Math.round(a), aKm: Math.round(a) })}
    ${isGnss ? formulaBlock('f_doppler', { f0MHz: 1575.42, v: 0, thetaDeg: 0 }) : formulaBlock('f_circular_velocity', { rKm: Math.round(a) })}
    ${relatedForGroup(sat.group)}
    <p><button type="button" class="btn-line sm" data-ask="${esc(name)}">${t('p.askAi')}</button></p>
  `, {
    ref: { type: 'sat', sat },
    tick() {
      const d = clock.date(), s = satNow(sat, d);
      if (!s) return;
      setFact('f.lat', `${s.lat.toFixed(3)}°`); setFact('f.lon', `${s.lon.toFixed(3)}°`);
      setFact('f.alt', `${num(s.altKm, 1)} ${t('unit.km')}`); setFact('f.speed', `${num(s.speed, 3)} ${t('unit.kms')}`);
      setFact('f.azel', altAz(s.el, s.az)); setFact('f.range', `${num(s.rangeKm, 0)} ${t('unit.km')}`);
      if (isGnss && s.dopplerL1 != null) setFact('f.doppler', `${num(s.dopplerL1 / 1000, 3)} ${t('unit.khz')}`);
      setFact('f.epoch', `${num(s.ageDays, 2)} ${t('unit.d')}`);
      if (performance.now() - passAt > 60000) {
        passAt = performance.now();
        pass = nextPass(sat, d);
        setFact('f.nextpass', pass === 'now' ? `<b>${lang === 'ru' ? 'сейчас над вами' : 'overhead now'}</b>` : timeFmt(pass));
      }
    },
  });
  preview({ type: 'satellite' });
}

function relatedForGroup(group) {
  const links = db.linksFrom('sat_group', group);
  if (!links.length) return '';
  return `<h3 class="p-h">${t('p.related')}</h3>` + linkList(links.map(l => ({ type: l.to_type, id: l.to_id, title: db.titleOf(l.to_type, l.to_id), tag: lang === 'ru' ? l.note_ru || '' : l.note_en || '' })));
}

function showBody(id, ctx) {
  const b = db.body(id);
  const name = db.pick(b, 'name');
  const kindKey = id === 'Sun' ? 'kind.sun' : `kind.${b.kind}`;
  const isEarth = id === 'Earth';
  openPanel(`
    <p class="p-kind">${t(kindKey)}</p>
    <h2 class="p-title" id="panel-title">${esc(name)}</h2>
    <p class="p-sub">${esc(db.pick(b, 'fact'))}</p>
    <div class="preview"><canvas></canvas></div>
    ${isEarth ? '' : `<p class="kicker"><span class="dot live"></span>${t('p.now')}</p>
    <dl class="facts">
      ${fact('f.dist', '', true)}${fact('f.light', '', true)}${fact('f.azel', '', true)}${fact('f.radec', '', true)}
      ${fact('f.con', '', true)}${id !== 'Sun' ? fact('f.mag', '', true) : ''}
      ${fact('f.rise', '…')}${fact('f.set', '…')}
      ${!['Sun', 'Moon'].includes(id) ? fact('f.helio', '', true) : ''}${id !== 'Sun' ? fact('f.phase', '', true) : ''}
    </dl>`}
    <h3 class="p-h">${t('p.about')}</h3>
    <dl class="facts">
      ${fact('f.mass', `${b.mass_kg.toExponential(3).replace('e+', '·10^')} ${t('unit.kg')}`)}${fact('f.radius', `${num(b.radius_km, 1)} ${t('unit.km')}`)}
      ${fact('f.gravity', `${num(b.gravity, 2)} ${t('unit.ms2')}`)}${b.day_hours ? fact('f.day', `${num(Math.abs(b.day_hours), 2)} ${t('unit.h')}${b.day_hours < 0 ? (lang === 'ru' ? ' (обратное)' : ' (retrograde)') : ''}`) : ''}
      ${b.period_days ? fact('f.year', `${num(b.period_days, 2)} ${t('unit.d')}`) : ''}${b.moons != null ? fact('f.moons', b.moons) : ''}
      ${fact('f.temp', `${num(b.temp_c, 0)} °C`)}${fact('f.atm', esc(db.pick(b, 'atmosphere')))}
    </dl>
    <h3 class="p-h">${t('p.formulas')}</h3>
    ${formulaBlock('f_escape', { massKg: b.mass_kg, radiusKm: b.radius_km })}
    ${b.a_au && b.kind !== 'moon' ? formulaBlock('f_kepler3', { aAu: b.a_au }) : ''}
    ${!isEarth ? `<div data-light>${formulaBlock('f_light_time', {})}</div>` : ''}
    ${id === 'Sun' ? `<p class="p-text">${lang === 'ru' ? 'Активность Солнца — это индекс Kp в «Состоянии защиты»: при бурях навигация теряет точность.' : 'Solar activity shows up as the Kp index in Protection status: storms degrade navigation.'} <button type="button" class="linkish" data-open="indicator:i_kp">Kp →</button></p>` : ''}
    <p><button type="button" class="btn-line sm" data-ask="${esc(name)}">${t('p.askAi')}</button></p>
  `, {
    ref: { type: 'body', id },
    tick: isEarth ? null : (() => {
      let riseAt = -Infinity, lightSet = false;
      return () => {
        const n = bodyNow(id, clock.date());
        const km = n.distAu * 1.495978707e8;
        setFact('f.dist', distText(km)); setFact('f.light', lightText(km / 299792.458));
        setFact('f.azel', altAz(n.alt, n.az)); setFact('f.radec', `${raText(n.ra)} ${decText(n.dec)}`);
        const con = db.constellation(n.con); setFact('f.con', esc(db.pick(con, 'name') || n.con));
        if (n.mag != null) setFact('f.mag', num(n.mag, 2));
        if (n.helioAu != null) setFact('f.helio', `${num(n.helioAu, 3)} ${t('unit.au')}`);
        if (n.phase != null) setFact('f.phase', `${num(n.phase * 100, 1)} %`);
        if (performance.now() - riseAt > 60000) { riseAt = performance.now(); setFact('f.rise', timeFmt(n.rise)); setFact('f.set', timeFmt(n.set)); }
        if (!lightSet) {   // подставить текущее расстояние в калькулятор времени света
          lightSet = true;
          const inp = body.querySelector('[data-light] input[name="dKm"]');
          if (inp) { inp.value = Math.round(km); inp.dispatchEvent(new Event('input', { bubbles: true })); }
        }
      };
    })(),
  });
  preview(id === 'Sun' ? { type: 'star', temp: 5772 } : isEarth ? { type: 'earth' } : { type: 'planet', id });
}

function showStar(s, ctx) {
  const con = db.constellation(s.con);
  const name = (lang === 'ru' ? s.name_ru : s.name_en) || s.name_en || s.name_ru
    || [s.bayer, s.flam].filter(Boolean).join(' ') + (s.con ? ` ${s.con}` : '') || `HIP ${s.hip}`;
  const ly = s.dist_pc ? s.dist_pc * 3.26156 : null;
  const temp = s.ci != null ? starTempK(s.ci) : null;
  const leftYear = ly ? Math.round(clock.date().getUTCFullYear() - ly) : null;
  let riseAt = -Infinity;
  openPanel(`
    <p class="p-kind">${t('kind.star')}${con ? ' · ' + esc(db.pick(con, 'name')) : ''}</p>
    <h2 class="p-title" id="panel-title">${esc(name)}</h2>
    <p class="p-sub">${[s.hip && `HIP ${s.hip}`, s.hd && `HD ${s.hd}`].filter(Boolean).join(' · ')}</p>
    <div class="preview"><canvas></canvas></div>
    <p class="kicker"><span class="dot live"></span>${t('p.now')}</p>
    <dl class="facts">
      ${fact('f.azel', '', true)}${fact('f.rise', '…')}${fact('f.set', '…')}${fact('f.radec', `${raText(s.ra_deg / 15)} ${decText(s.dec_deg)}`)}
    </dl>
    <h3 class="p-h">${t('p.about')}</h3>
    <dl class="facts">
      ${fact('f.dist', ly ? `${lyText(ly)} · ${num(s.dist_pc, 2)} ${t('unit.pc')}` : '—')}
      ${fact('f.lightLeft', leftYear != null ? (leftYear > 0 ? t('f.yearIn', { y: leftYear }) : `${num(-leftYear + clock.date().getUTCFullYear(), 0)} ${t('f.yearsAgo')}`) : '—')}
      ${fact('f.mag', num(s.mag, 2))}${fact('f.absmag', s.absmag != null ? num(s.absmag, 2) : '—')}
      ${fact('f.spect', esc(s.spect || '—'))}${fact('f.tempK', temp ? `≈ ${num(temp, 0)} K` : '—')}
      ${fact('f.lum', s.lum ? `${num(s.lum, s.lum < 10 ? 2 : 0)} L☉` : '—')}
    </dl>
    <h3 class="p-h">${t('p.formulas')}</h3>
    ${s.ci != null ? formulaBlock('f_star_temp', { bv: s.ci }) : ''}
    ${s.dist_pc ? formulaBlock('f_abs_mag', { m: s.mag, dPc: s.dist_pc }) : ''}
    ${s.absmag != null ? formulaBlock('f_luminosity', { absMag: s.absmag }) : ''}
    <p><button type="button" class="btn-line sm" data-ask="${esc(name)}">${t('p.askAi')}</button></p>
  `, {
    ref: { type: 'star', row: s },
    tick() {
      const n = fixedNow(s.ra_deg, s.dec_deg, ly);
      setFact('f.azel', altAz(n.alt, n.az));
      if (performance.now() - riseAt > 60000) {
        riseAt = performance.now();
        setFact('f.rise', n.always === 'up' ? t('f.circumpolar') : n.always === 'down' ? t('f.never') : timeFmt(n.rise));
        setFact('f.set', n.always === 'up' ? t('f.circumpolar') : n.always === 'down' ? t('f.never') : timeFmt(n.set));
      }
    },
  });
  preview({ type: 'star', temp: temp || 5800 });
}

function showDso(d, ctx) {
  const name = (lang === 'ru' ? d.name_ru : d.name_en) || d.name_en || '';
  const conSym = A.Constellation(d.ra_deg / 15, d.dec_deg).symbol;
  const con = db.constellation(conSym);
  const family = d.kind.startsWith('galaxy') ? 'galaxy' : ['globular', 'open'].includes(d.kind) ? 'cluster' : ['nebula', 'planetary', 'snr'].includes(d.kind) ? 'nebula' : 'other';
  let riseAt = -Infinity;
  openPanel(`
    <p class="p-kind">${t('kind.' + d.kind)}${con ? ' · ' + esc(db.pick(con, 'name')) : ''}</p>
    <h2 class="p-title" id="panel-title">${esc(d.id)}${name ? ` <span class="serif" style="color:var(--gold-hi);font-style:italic">${esc(name)}</span>` : ''}</h2>
    <p class="p-sub">${esc(d.ngc && d.ngc !== d.id ? d.ngc : '')}</p>
    <div class="preview"><canvas></canvas></div>
    <p class="kicker"><span class="dot live"></span>${t('p.now')}</p>
    <dl class="facts">
      ${fact('f.azel', '', true)}${fact('f.rise', '…')}${fact('f.set', '…')}${fact('f.radec', `${raText(d.ra_deg / 15)} ${decText(d.dec_deg)}`)}
    </dl>
    <h3 class="p-h">${t('p.about')}</h3>
    <dl class="facts">
      ${fact('f.dist', d.dist_ly ? `≈ ${lyText(d.dist_ly)}` : '—')}
      ${fact('f.lightLeft', d.dist_ly ? `${lyText(d.dist_ly).replace(t('unit.ly'), '')}${t('f.yearsAgo')}` : '—')}
      ${fact('f.mag', d.mag != null ? num(d.mag, 1) : '—')}${fact('f.size', d.size ? esc(d.size) + '′' : '—')}
      ${fact('f.morph', esc(d.morph || '—'))}
      ${d.kind.startsWith('galaxy') && d.dist_ly ? fact('f.hubble', `≈ ${num(70 * d.dist_ly / 3.2616e6, 0)} ${t('unit.kms')}`) : ''}
    </dl>
    ${d.kind.startsWith('galaxy') && d.dist_ly ? `<h3 class="p-h">${t('p.formulas')}</h3>${formulaBlock('f_hubble', { dMly: d.dist_ly / 1e6 })}` : ''}
    <p class="p-note">${lang === 'ru' ? 'Модель построена по типу объекта, а не по фотографии: так выглядят объекты этого класса.' : 'The model is generated from the object type, not a photo: this is how objects of this class look.'}</p>
    <p><button type="button" class="btn-line sm" data-ask="${esc(d.id)}">${t('p.askAi')}</button></p>
  `, {
    ref: { type: 'dso', row: d },
    tick() {
      const n = fixedNow(d.ra_deg, d.dec_deg, d.dist_ly);
      setFact('f.azel', altAz(n.alt, n.az));
      if (performance.now() - riseAt > 60000) {
        riseAt = performance.now();
        setFact('f.rise', n.always === 'up' ? t('f.circumpolar') : n.always === 'down' ? t('f.never') : timeFmt(n.rise));
        setFact('f.set', n.always === 'up' ? t('f.circumpolar') : n.always === 'down' ? t('f.never') : timeFmt(n.set));
      }
    },
  });
  const seed = [...d.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 50;
  preview(family === 'galaxy' ? { type: 'galaxy', kind: d.kind, seed } : family === 'cluster' ? { type: 'cluster', kind: d.kind } : family === 'nebula' ? { type: 'nebula', kind: d.kind } : { type: 'star', temp: 9000 });
}

function showNeo(neo) {
  openPanel(`
    <p class="p-kind">${t('kind.neo')}</p>
    <h2 class="p-title" id="panel-title">${esc(neo.name)}</h2>
    <p class="p-sub">NASA NeoWs · ${esc(neo.id)}</p>
    <div class="preview"><canvas></canvas></div>
    <dl class="facts">
      ${fact('f.approach', esc(new Date(neo.approachMs).toLocaleString(locale(), { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })))}
      ${fact('f.miss', `${num(neo.missKm, 0)} ${t('unit.km')} · ${num(neo.missKm / 384400, 2)} ${t('unit.ld')}`)}
      ${fact('f.vel', `${num(neo.velKms, 2)} ${t('unit.kms')}`)}
      ${fact('f.diam', `${num(neo.dMin, 0)}–${num(neo.dMax, 0)} ${t('unit.m')}`)}
      ${fact('f.hazard', neo.hazardous ? `<b style="color:var(--red)">${t('f.yes')}</b>` : t('f.no'))}
    </dl>
    <h3 class="p-h">${t('p.formulas')}</h3>
    ${formulaBlock('f_light_time', { dKm: Math.round(neo.missKm) })}
  `, { ref: { type: 'neo', neo } });
  preview({ type: 'asteroid', seed: neo.id.length });
}

// ---------------------------------------------------------------------
//  Карточки знаний: угроза, защита, формула, показатель, цель, модуль
// ---------------------------------------------------------------------
const sevDots = n => `<span class="sev">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
const linksOf = (type, id, relation, toType) => db.linksFrom(type, id).filter(l => l.relation === relation && (!toType || l.to_type === toType));
const backOf = (type, id, relation, fromType) => db.linksTo(type, id).filter(l => l.relation === relation && (!fromType || l.from_type === fromType));
const asItems = (links, side = 'to') => links.map(l => {
  const type = side === 'to' ? l.to_type : l.from_type, id = side === 'to' ? l.to_id : l.from_id;
  return { type, id, title: db.titleOf(type, id), tag: (lang === 'ru' ? l.note_ru : l.note_en) || t('kind.' + type) };
});

export function showKnowledge(type, id) {
  if (type === 'threat') {
    const th = db.threat(id);
    const forms = linksOf('threat', id, 'quantified_by', 'formula').concat(linksOf('threat', id, 'detected_by', 'formula'));
    openPanel(`
      <p class="p-kind">${t('kind.threat')} · ${esc(db.titleOf('module', th.module_id))}</p>
      <h2 class="p-title" id="panel-title">${esc(th.title)}</h2>
      <p class="p-sub">${t('p.severity')}: ${th.severity}/5 · ${esc(th.framework || '')}</p>
      <p class="p-text">${esc(th.body)}</p>
      ${th.signs ? `<h3 class="p-h">${t('p.signs')}</h3><p class="p-text">${esc(th.signs)}</p>` : ''}
      <h3 class="p-h">${t('p.detect')}</h3>${linkList(asItems(linksOf('threat', id, 'detected_by'))) || '<p class="p-note">—</p>'}
      <h3 class="p-h">${t('p.mitigate')}</h3>${linkList(asItems(linksOf('threat', id, 'mitigated_by')))}
      ${backOf('threat', id, 'watches', 'indicator').length ? `<h3 class="p-h">${t('mod.indicators')}</h3>${linkList(asItems(backOf('threat', id, 'watches', 'indicator'), 'from'))}` : ''}
      ${forms.length ? `<h3 class="p-h">${t('p.measure')}</h3>${forms.map(l => formulaBlock(l.to_id)).join('')}` : ''}
      <p><button type="button" class="btn-line sm" data-ask="${esc(th.title)}">${t('p.askAi')}</button></p>
    `, { wide: true, modal: true, ref: { type, id } });
  } else if (type === 'countermeasure') {
    const c = db.countermeasure(id);
    const covers = [...backOf('countermeasure', id, 'mitigated_by', 'threat'), ...backOf('countermeasure', id, 'detected_by', 'threat')];
    const uses = linksOf('countermeasure', id, 'uses', 'formula');
    openPanel(`
      <p class="p-kind">${t('kind.countermeasure')} · ${esc(db.titleOf('module', c.module_id))}</p>
      <h2 class="p-title" id="panel-title">${esc(c.title)}</h2>
      <p class="p-text">${esc(c.body)}</p>
      <h3 class="p-h">${t('p.covers')}</h3>${linkList(asItems(covers, 'from')) || '<p class="p-note">—</p>'}
      ${linksOf('countermeasure', id, 'serves', 'goal').length ? `<h3 class="p-h">${t('p.serves')}</h3>${linkList(asItems(linksOf('countermeasure', id, 'serves', 'goal')))}` : ''}
      ${linksOf('countermeasure', id, 'uses', 'countermeasure').length ? `<h3 class="p-h">${t('p.related')}</h3>${linkList(asItems(linksOf('countermeasure', id, 'uses', 'countermeasure')))}` : ''}
      ${uses.length ? `<h3 class="p-h">${t('p.uses')}</h3>${uses.map(l => formulaBlock(l.to_id)).join('')}` : ''}
    `, { wide: true, modal: true, ref: { type, id } });
  } else if (type === 'formula') {
    const f = db.formula(id);
    const users = [...db.linksTo('formula', id)];
    openPanel(`
      <p class="p-kind">${t('kind.formula')}${f.module_id ? ' · ' + esc(db.titleOf('module', f.module_id)) : ` · ${t('mod.astro')}`}</p>
      <h2 class="p-title" id="panel-title">${esc(f.title)}</h2>
      <p class="p-text">${esc(f.explanation)}</p>
      ${formulaBlock(id, {}, { title: false })}
      ${users.length ? `<h3 class="p-h">${t('p.usedBy')}</h3>${linkList(asItems(users, 'from'))}` : ''}
    `, { wide: true, modal: true, ref: { type, id } });
  } else if (type === 'indicator') {
    const i = db.indicator(id), live = indicators[id];
    const watches = linksOf('indicator', id, 'watches', 'threat');
    const rows = journal.filter(j => j.id === id).slice(0, 8);
    openPanel(`
      <p class="p-kind">${t('kind.indicator')} · ${esc(db.titleOf('module', i.module_id))}</p>
      <h2 class="p-title" id="panel-title">${esc(i.title)}</h2>
      <p class="p-sub"><span class="st ${live.state}" style="display:inline-block;margin-right:8px"></span>${esc(live.value || t('ind.' + (live.state === 'ask' ? 'ask' : live.state === 'na' ? 'na' : live.state)))}</p>
      <h3 class="p-h">${t('p.how')}</h3><p class="p-text">${esc(i.how)}</p>
      <h3 class="p-h">${t('p.data')}</h3><pre class="p-note mono" style="white-space:pre-wrap">${esc(indicatorDetail(id, live))}</pre>
      ${id === 'i_ekf_position' && live.state === 'ask' ? `<p><button type="button" class="btn-gold sm" data-locate>${t('hud.locate')}</button></p>` : ''}
      ${watches.length ? `<h3 class="p-h">${t('p.watches')}</h3>${linkList(asItems(watches))}` : ''}
      ${i.formula_id ? `<h3 class="p-h">${t('p.formulas')}</h3>${formulaBlock(i.formula_id)}` : ''}
      ${rows.length ? `<h3 class="p-h">${lang === 'ru' ? 'Журнал' : 'Log'}</h3><ul class="links">${rows.map(r => `<li><button type="button">${timeFmt(r.at)} · ${r.from} → ${r.to}<small>${esc(r.value)}</small></button></li>`).join('')}</ul>` : ''}
    `, { modal: true, ref: { type, id } });
  } else if (type === 'goal') {
    const g = db.goal(id);
    openPanel(`
      <p class="p-kind">${t('mod.goals')} · ${esc(db.titleOf('module', g.module_id))}</p>
      <h2 class="p-title" id="panel-title">${esc(g.title)}</h2>
      <p class="p-text">${esc(g.body)}</p>
      <h3 class="p-h">${t('mod.counter')}</h3>${linkList(asItems(backOf('goal', id, 'serves', 'countermeasure'), 'from'))}
    `, { modal: true, ref: { type, id } });
  } else if (type === 'module') {
    ctxOpenModule?.(id);
  }
}
let ctxOpenModule = null;
export const setModuleOpener = fn => { ctxOpenModule = fn; };

function indicatorDetail(id, live) {
  const d = live.detail || {};
  const L = lang === 'ru';
  switch (id) {
    case 'i_pq_signature': return Object.entries(d.groups || {}).map(([g, s]) => `${g}: ${s.ok ? (L ? 'подпись верна' : 'valid') : s.reason}${s.ms ? ` · ${s.ms.toFixed(1)} ms` : ''} · ${s.source}`).join('\n') || '—';
    case 'i_hybrid_key': return d.sizes ? `K = ${d.fingerprint}…\nML-KEM-768: ${d.sizes.encapKey} B / ${d.sizes.cipherText} B\n${d.ms?.toFixed(1)} ms` : '—';
    case 'i_tle_integrity': return d.total ? `${L ? 'Элементов' : 'Element sets'}: ${d.total}\n${L ? 'Контрольная сумма не сошлась' : 'Checksum failures'}: ${d.failed?.length || 0}${d.failed?.length ? ' (' + d.failed.join(', ') + ')' : ''}\n${L ? 'Медианный возраст' : 'Median age'}: ${d.medianAge?.toFixed(2)} ${t('unit.d')}\n${L ? 'Самые старые' : 'Oldest'}: ${d.maxAge?.toFixed(1)} ${t('unit.d')}` : '—';
    case 'i_saa': return d.lat != null ? `ISS: ${d.lat.toFixed(2)}°, ${d.lon.toFixed(2)}°, ${d.alt?.toFixed(0)} km` : '—';
    case 'i_gnss_geometry': case 'i_raim': return d.visible != null ? `${L ? 'Видно GPS выше 5°' : 'GPS above 5°'}: ${d.visible}\nPDOP: ${d.pdop?.toFixed(2) ?? '—'}\nHDOP: ${d.hdop?.toFixed(2) ?? '—'}\nRAIM: ${d.raim === 'fde' ? (L ? 'обнаружение и исключение' : 'detection + exclusion') : d.raim === 'fd' ? (L ? 'только обнаружение' : 'detection only') : (L ? 'недоступен' : 'unavailable')}\n${L ? 'Точка' : 'Point'}: ${observer.lat.toFixed(3)}°, ${observer.lon.toFixed(3)}°` : '—';
    case 'i_ekf_position': return d.n != null ? `${L ? 'Точек' : 'Fixes'}: ${d.n}\nε: ${d.eps?.toFixed(2) ?? '—'} / ${L ? 'порог' : 'threshold'} ${d.threshold?.toFixed(2) ?? '13.82'}\n${L ? 'Аномалий' : 'Anomalies'}: ${d.anomalies ?? 0}\n${L ? 'Точность' : 'Accuracy'}: ±${d.accuracy?.toFixed(0)} m` : (L ? 'Нужно разрешение на геолокацию' : 'Needs location permission');
    case 'i_kp': return d.kp != null ? `Kp = ${d.kp} (${d.time})\nNOAA SWPC${d.signed?.ok ? ' · ML-DSA ✓' : ''}` : '—';
    default: return '—';
  }
}

// ---------------------------------------------------------------------
//  Экран «Модули»
// ---------------------------------------------------------------------
export function renderModules(root, active = 'module1') {
  const mods = db.modules();
  const tabs = $('#mod-tabs', root.closest('section') || document);
  tabs.innerHTML = mods.map(m => `<button type="button" role="tab" data-mod="${m.id}" aria-selected="${m.id === active}">${m.num}. ${esc(m.title)}</button>`).join('')
    + `<button type="button" role="tab" data-mod="astro" aria-selected="${active === 'astro'}">${t('mod.astro')}</button>`;

  if (active === 'astro') {
    const fs = db.formulas().filter(f => !f.module_id);
    root.innerHTML = `<p class="lead">${t('mod.astroLead')}</p><div class="mgrid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${fs.map(f =>
      `<button type="button" class="mcard" data-open="formula:${f.id}"><b>${esc(f.title)}</b><div class="eq" style="margin:.6rem 0 0">${tex(f.latex)}</div><p>${esc(f.explanation)}</p></button>`).join('')}</div>`;
    return;
  }

  const m = mods.find(x => x.id === active);
  const ths = db.threats(active), cms = db.countermeasures(active), fs = db.formulas().filter(f => f.module_id === active);
  const inds = db.indicators().filter(i => i.module_id === active);
  root.innerHTML = `
    <p class="lead" style="max-width:760px">${esc(m.lead || '')}</p>
    <p class="p-note">${t('mod.hint')}</p>
    <div class="mgrid" id="mgraph">
      <div class="mcol"><h3>${t('mod.threats')}</h3>${ths.map(th => `<button type="button" class="mcard" data-node="threat:${th.id}" data-open="threat:${th.id}">${sevDots(th.severity)}<b>${esc(th.title)}</b><p>${esc(th.signs || '')}</p></button>`).join('')}</div>
      <div class="mcol"><h3>${t('mod.counter')}</h3>${cms.map(c => `<button type="button" class="mcard" data-node="countermeasure:${c.id}" data-open="countermeasure:${c.id}"><b>${esc(c.title)}</b><p>${esc(c.body)}</p></button>`).join('')}</div>
      <div class="mcol"><h3>${t('mod.formulas')}</h3>${fs.map(f => `<button type="button" class="mcard" data-node="formula:${f.id}" data-open="formula:${f.id}"><b>${esc(f.title)}</b><div class="eq" style="margin:.6rem 0 0">${tex(f.latex)}</div>${f.calc ? `<span class="tag">${t('p.calc')} →</span>` : ''}</button>`).join('')}
        ${inds.length ? `<h3 style="margin-top:22px">${t('mod.indicators')}</h3>${inds.map(i => `<button type="button" class="mcard" data-node="indicator:${i.id}" data-open="indicator:${i.id}"><b><span class="st ${indicators[i.id]?.state || 'wait'}" style="display:inline-block;margin-right:8px;vertical-align:middle"></span>${esc(i.title)}</b><p>${esc(indicators[i.id]?.value || '')}</p></button>`).join('')}` : ''}
      </div>
    </div>
    <details class="mod-text doc">
      <summary>${t('mod.fulltext')}</summary>
      <h4>${t('mod.goals')}</h4>${portalMarkup(m.goals)}
      <h4>${t('mod.threats')}</h4>${portalMarkup(m.threats_text)}
      <h4>${t('mod.math')}</h4>${portalMarkup(m.physics_math)}
      <h4>${t('mod.tech')}</h4>${portalMarkup(m.tech_standards)}
    </details>`;

  // Подсветка связей при наведении: угроза → её защита и формулы
  const graph = $('#mgraph', root);
  const neighbours = node => {
    const [type, id] = node.split(':');
    const set = new Set([node]);
    for (const l of db.linksFrom(type, id)) set.add(`${l.to_type}:${l.to_id}`);
    for (const l of db.linksTo(type, id)) set.add(`${l.from_type}:${l.from_id}`);
    // второй шаг: формулы, которые использует связанная защита
    for (const n of [...set]) {
      const [tt, ii] = n.split(':');
      if (tt === 'countermeasure') for (const l of db.linksFrom(tt, ii)) if (l.relation === 'uses') set.add(`${l.to_type}:${l.to_id}`);
    }
    return set;
  };
  graph.addEventListener('pointerover', e => {
    const card = e.target.closest('[data-node]');
    if (!card) return;
    const near = neighbours(card.dataset.node);
    graph.querySelectorAll('[data-node]').forEach(c => {
      c.classList.toggle('dim', !near.has(c.dataset.node));
      c.classList.toggle('hot', c !== card && near.has(c.dataset.node));
    });
  });
  graph.addEventListener('pointerleave', () => graph.querySelectorAll('[data-node]').forEach(c => c.classList.remove('dim', 'hot')));
}

// ---------------------------------------------------------------------
//  Поиск по всему: звёзды, галактики, планеты, спутники, угрозы, формулы
// ---------------------------------------------------------------------
export function initSearch(getIndex, onPick) {
  const input = $('#search'), list = $('#search-list');
  let items = [], sel = 0;
  const norm = s => s.toLowerCase().replace(/ё/g, 'е');
  const render = () => {
    list.innerHTML = items.map((it, i) => `<li role="option" aria-selected="${i === sel}" data-i="${i}">${esc(it.label)}<span>${esc(it.tag)}</span></li>`).join('');
    list.hidden = !items.length;
  };
  input.addEventListener('input', () => {
    const q = norm(input.value.trim());
    sel = 0;
    if (q.length < 2) { items = []; render(); return; }
    const scored = [];
    for (const it of getIndex()) {
      const k = it.key;
      const pos = k.indexOf(q);
      if (pos >= 0) scored.push([pos === 0 ? 0 : k.includes(' ' + q) ? 1 : 2, it.rank || 0, it]);
    }
    items = scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 12).map(x => x[2]);
    render();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    if (e.key === 'Enter' && items[sel]) { onPick(items[sel]); input.value = ''; items = []; render(); input.blur(); }
    if (e.key === 'Escape') { items = []; render(); input.blur(); }
  });
  list.addEventListener('pointerdown', e => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    onPick(items[+li.dataset.i]); input.value = ''; items = []; render(); input.blur();
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
}

export function toast(msg) {
  const el = $('#toast');
  $('#toast-txt').textContent = msg;
  el.classList.add('on');
  clearTimeout(el._h);
  el._h = setTimeout(() => el.classList.remove('on'), 4200);
}

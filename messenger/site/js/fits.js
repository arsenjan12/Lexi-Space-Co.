// =====================================================================
//  FITS: чтение, отрисовка и синтетические кадры для демо.
//  Поддержка: BITPIX 8/16/32/-32/-64, NAXIS 2 (у куба берётся первый слой),
//  BZERO/BSCALE, BLANK. Растяжки linear/sqrt/log/asinh, палитры.
// =====================================================================

const CARD = 80, BLOCK = 2880;

export function isFits(u8) {
  if (!u8 || u8.length < BLOCK) return false;
  return String.fromCharCode(...u8.subarray(0, 9)) === 'SIMPLE  =';
}

export function parseFits(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const header = {};
  const cards = [];
  let off = 0, ended = false;
  while (!ended && off + BLOCK <= u8.length) {
    for (let i = 0; i < BLOCK / CARD; i++) {
      const card = String.fromCharCode(...u8.subarray(off + i * CARD, off + (i + 1) * CARD));
      const key = card.slice(0, 8).trim();
      if (key === 'END') { ended = true; break; }
      if (!key) continue;
      cards.push(card.trimEnd());
      if (card[8] === '=') {
        let raw = card.slice(10);
        let val, comment = '';
        if (raw.trimStart().startsWith("'")) {
          const m = raw.match(/'((?:[^']|'')*)'\s*(?:\/(.*))?/);
          val = m ? m[1].replace(/''/g, "'").trimEnd() : raw.trim();
          comment = m?.[2]?.trim() || '';
        } else {
          const slash = raw.indexOf('/');
          if (slash >= 0) { comment = raw.slice(slash + 1).trim(); raw = raw.slice(0, slash); }
          raw = raw.trim();
          val = raw === 'T' ? true : raw === 'F' ? false : (isNaN(Number(raw)) ? raw : Number(raw));
        }
        header[key] = val;
        if (comment) header[key + '#'] = comment;
      }
    }
    off += BLOCK;
  }
  if (!ended) throw new Error('FITS: не найден END');
  const bitpix = header.BITPIX, nx = header.NAXIS1, ny = header.NAXIS2 || 1;
  if (!header.NAXIS || !nx) throw new Error('FITS: нет изображения в первичном HDU');
  const bytes = Math.abs(bitpix) / 8;
  const n = nx * ny;
  if (off + n * bytes > u8.length) throw new Error('FITS: файл обрезан');
  const dv = new DataView(u8.buffer, u8.byteOffset + off, n * bytes);
  const bzero = header.BZERO ?? 0, bscale = header.BSCALE ?? 1, blank = header.BLANK;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v;
    switch (bitpix) {
      case 8: v = dv.getUint8(i); break;
      case 16: v = dv.getInt16(i * 2); break;
      case 32: v = dv.getInt32(i * 4); break;
      case -32: v = dv.getFloat32(i * 4); break;
      case -64: v = dv.getFloat64(i * 8); break;
      default: throw new Error('FITS: BITPIX ' + bitpix + ' не поддерживается');
    }
    data[i] = (blank !== undefined && v === blank && bitpix > 0) ? NaN : bzero + bscale * v;
  }
  return { header, cards, width: nx, height: ny, data };
}

function percentiles(data, lo, hi) {
  const step = Math.max(1, Math.floor(data.length / 40000));
  const s = [];
  for (let i = 0; i < data.length; i += step) if (Number.isFinite(data[i])) s.push(data[i]);
  s.sort((a, b) => a - b);
  if (!s.length) return [0, 1];
  return [s[Math.floor(lo * (s.length - 1))], s[Math.floor(hi * (s.length - 1))]];
}

export const COLORMAPS = {
  gray: t => [t, t, t],
  gold: t => [Math.min(1, t * 1.25), Math.min(1, t * 1.02) ** 1.2, Math.min(1, t ** 2.2 * 0.85)],
  heat: t => [Math.min(1, t * 2.2), Math.max(0, Math.min(1, t * 2 - 0.45)), Math.max(0, t * 3 - 2)],
  cyan: t => [t ** 2.4 * 0.7, Math.min(1, t * 1.1), Math.min(1, t * 1.3)],
  red: t => [t, t * 0.18, t * 0.12],
};

const STRETCH = {
  linear: t => t,
  sqrt: t => Math.sqrt(t),
  log: t => Math.log10(1 + 999 * t) / 3,
  asinh: t => Math.asinh(10 * t) / Math.asinh(10),
};

export function renderFits(img, { stretch = 'asinh', cmap = 'gold', lo = 0.005, hi = 0.997, flipY = true } = {}) {
  const { width: w, height: h, data } = img;
  const [vmin, vmax] = percentiles(data, lo, hi);
  const span = vmax - vmin || 1;
  const f = STRETCH[stretch] || STRETCH.asinh;
  const c = COLORMAPS[cmap] || COLORMAPS.gray;
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const sy = flipY ? h - 1 - y : y;  // FITS начинается снизу слева
    for (let x = 0; x < w; x++) {
      const v = data[sy * w + x];
      const t = Number.isFinite(v) ? f(Math.min(1, Math.max(0, (v - vmin) / span))) : 0;
      const [r, g, b] = c(t);
      const o = (y * w + x) * 4;
      out.data[o] = r * 255; out.data[o + 1] = g * 255; out.data[o + 2] = b * 255; out.data[o + 3] = 255;
    }
  }
  return out;
}

export function fitsToCanvas(img, opts) {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  cv.getContext('2d').putImageData(renderFits(img, opts), 0, 0);
  return cv;
}

// ---------- синтетический кадр (для демо: «галактика» + звёзды + шум) ----------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function gauss(r) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function makeSyntheticFits({ width = 256, height = 256, seed = 4414, object = 'NGC 4414', kind = 'spiral', ra = 186.6125, dec = 31.2233, exptime = 300 } = {}) {
  const r = rng(seed);
  const data = new Float32Array(width * height);
  const cx = width / 2 + (r() - .5) * 10, cy = height / 2 + (r() - .5) * 10;
  const pa = r() * Math.PI, inc = 0.45 + r() * 0.35;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x - cx, dy = y - cy;
    const xr = dx * Math.cos(pa) + dy * Math.sin(pa);
    const yr = (-dx * Math.sin(pa) + dy * Math.cos(pa)) / inc;
    const rad = Math.hypot(xr, yr);
    const th = Math.atan2(yr, xr);
    let g = 0;
    if (kind === 'spiral') {
      const arms = 0.55 + 0.45 * Math.cos(2 * th - 2.3 * Math.log(rad + 1));
      g = 900 * Math.exp(-rad / 22) * (0.5 + arms * 0.9) + 2400 * Math.exp(-((rad / 5) ** 2));
    } else if (kind === 'elliptical') {
      g = 2600 * Math.exp(-7.67 * ((rad / 30) ** 0.25 - 1)) / 2200;
    } else {
      g = 700 * Math.exp(-rad / 26) * (0.6 + 0.4 * Math.sin(3 * th + rad / 6));
    }
    data[y * width + x] = 120 + g + gauss(r) * 9;
  }
  for (let k = 0; k < 70; k++) {   // звёзды поля
    const sx = r() * width, sy = r() * height, f = 200 + r() ** 3 * 9000, s = 1.1 + r() * 0.6;
    for (let y = Math.max(0, sy - 8 | 0); y < Math.min(height, sy + 8); y++)
      for (let x = Math.max(0, sx - 8 | 0); x < Math.min(width, sx + 8); x++)
        data[y * width + x] += f * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * s * s));
  }
  const cards = [
    ['SIMPLE', 'T', 'conforms to FITS standard'],
    ['BITPIX', -32, 'IEEE single precision'],
    ['NAXIS', 2, ''],
    ['NAXIS1', width, ''],
    ['NAXIS2', height, ''],
    ['OBJECT', `'${object}'`, 'synthetic demo frame'],
    ['TELESCOP', "'LEXI-DEMO'", ''],
    ['INSTRUME', "'SIM-CCD'", ''],
    ['FILTER', "'r'", ''],
    ['EXPTIME', exptime, '[s]'],
    ['DATE-OBS', `'${new Date().toISOString().slice(0, 19)}'`, ''],
    ['CRVAL1', ra, '[deg] RA'],
    ['CRVAL2', dec, '[deg] Dec'],
    ['CDELT1', -0.000277, '[deg/px]'],
    ['CDELT2', 0.000277, '[deg/px]'],
    ['BUNIT', "'ADU'", ''],
    ['COMMENT', null, 'Synthetic image generated by LEXI Messenger demo'],
  ];
  let head = '';
  for (const [k, v, c] of cards) {
    let line;
    if (k === 'COMMENT') line = 'COMMENT ' + c;
    else {
      const val = typeof v === 'string' && v.startsWith("'") ? v.padEnd(20) : String(v).padStart(20);
      line = k.padEnd(8) + '= ' + val + (c ? ' / ' + c : '');
    }
    head += line.slice(0, 80).padEnd(80);
  }
  head += 'END'.padEnd(80);
  while (head.length % BLOCK) head += ' ';
  const dataBytes = Math.ceil((width * height * 4) / BLOCK) * BLOCK;
  const out = new Uint8Array(head.length + dataBytes);
  for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i);
  const dv = new DataView(out.buffer, head.length);
  for (let i = 0; i < width * height; i++) dv.setFloat32(i * 4, data[i]);
  return out;
}

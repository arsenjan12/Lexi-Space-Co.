// =====================================================================
//  Загрузка по эскизу: логотип LEXI на мерцающем звёздном небе
//  рассыпается на точки и собирается в Землю — «значок сети»,
//  по бокам проявляется «Lexi … Messenger».
// =====================================================================

const MARK = [
  'm55.5 49 28.2-25.1c2.3-1.9 7.8-5.6 11.1-7.5-3.4 3.9-29.6 29.4-29.6 29.4l-9.7 3.2z',
  'm57.1 56 26.5-25.1 22.1-21.6c-1.3 2.5-3.7 6.7-6.2 9.3l-31 32.5-11.4 4.9z',
  'm66.4 56 12.3-12.2 22.1-23.4c-1.7 3.6-5.6 9.5-7.5 11.8-4.6 5.6-18.2 20-18.2 20l-8.8 3.8h0.1z',
  'm62.9 40.5c-0.7-1.6-1.1-4.3-1-6.8 0.5-9.8 9.7-19.6 22.7-18.3-11.1-1.4-19.8 9.6-18.7 18.8 0.1 2.1 8-4.6 10.5-6.3-2.5 2.7-13 12-13.5 12.6z',
  'm67.5 28.8c1.6-7.9 10.9-15.3 21.4-10.8l-2.8 1.7c-5.5-2.2-15-0.6-18.6 9.1z',
  'm77.6 52.6 8.9-10.5-4.7 6.5c4.5-0.4 10-3.5 12.6-10.5-0.9 7.6-9 15.4-16.8 14.3v0.2z',
  'm77.6 52.7c10.2 0.9 19.6-8.8 17.9-20.9l2.6-3.9c3.2 8.3-0.4 19.4-10.3 23.5-3.6 1.7-7.8 1.9-10.2 1.3z',
];
export const MARK_PATHS = MARK;

const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const hex2rgb = h => { const m = h.replace('#', '').match(/.{2}/g); return m ? m.map(x => parseInt(x, 16)) : [196, 157, 71]; };

// точки суши: по карте бликов LEXI Space (вода светлая, суша тёмная)
async function landPoints(n) {
  const fib = [];
  const N = 5200, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
    fib.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  let land = null;
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = import.meta.resolve('lexi-space/textures/earth-spec.jpg'); });
    const c = document.createElement('canvas'); c.width = 360; c.height = 180;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 360, 180);
    const d = x.getImageData(0, 0, 360, 180).data;
    land = (lat, lon) => {
      const px = Math.floor((lon / (2 * Math.PI) + 0.5) * 359), py = Math.floor((0.5 - lat / Math.PI) * 179);
      return d[(py * 360 + px) * 4] < 60;
    };
  } catch {}
  const pts = fib.filter(([x, y, z]) => land ? land(Math.asin(y), Math.atan2(x, z)) : (Math.sin(x * 5) * Math.cos(z * 4) + y * 0.3) > 0.2);
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  while (pts.length < n) pts.push(...pts.slice(0, n - pts.length));
  return pts.slice(0, n);
}

export async function playBoot(root, { minMs = 4200 } = {}) {
  const canvas = root.querySelector('canvas');
  const word = root.querySelector('.boot-word');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  let W = 0, H = 0;
  const size = () => { W = canvas.width = innerWidth * dpr; H = canvas.height = innerHeight * dpr; };
  size(); addEventListener('resize', size);

  // звёзды
  const stars = Array.from({ length: Math.round(innerWidth * innerHeight / 1400) }, () => ({
    x: Math.random(), y: Math.random(), r: (0.3 + Math.random() ** 5 * 1.8) * dpr, p: Math.random() * 6.28, s: 0.6 + Math.random() * 2.2,
  }));
  const shooting = [];

  // точки логотипа
  const N = 1100;
  const mc = document.createElement('canvas'); mc.width = mc.height = 200;
  const mx = mc.getContext('2d', { willReadFrequently: true });
  mx.translate(100 - 80.5 * 3.2, 100 - 33 * 3.2); mx.scale(3.2, 3.2);
  mx.fillStyle = '#fff'; for (const p of MARK) mx.fill(new Path2D(p));
  const md = mx.getImageData(0, 0, 200, 200).data;
  const src = [];
  while (src.length < N) {
    const x = Math.random() * 200, y = Math.random() * 200;
    if (md[((y | 0) * 200 + (x | 0)) * 4 + 3] > 128) src.push([(x - 100) / 100, (y - 100) / 100]);
  }
  const dst = await landPoints(N);
  const arcs = Array.from({ length: 6 }, () => [dst[Math.floor(Math.random() * N)], dst[Math.floor(Math.random() * N)], Math.random()]);

  const gold = hex2rgb(css('--accent') || '#c49d47'), sec = hex2rgb(css('--secure') || '#45f3ff');
  let skip = false;
  const onSkip = () => { skip = true; };
  root.addEventListener('pointerdown', onSkip);
  addEventListener('keydown', onSkip, { once: true });

  const t0 = performance.now();
  await new Promise(resolve => {
    const frame = now => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      // небо
      for (const s of stars) {
        const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
        ctx.fillStyle = `rgba(255,250,236,${a * 0.85})`;
        ctx.fillRect(s.x * W, s.y * H, s.r, s.r);
      }
      if (Math.random() < 0.012) shooting.push({ x: Math.random() * W, y: Math.random() * H * 0.5, life: 0 });
      for (const sh of shooting) {
        sh.life += 0.02;
        const g = ctx.createLinearGradient(sh.x, sh.y, sh.x - 120 * dpr, sh.y - 40 * dpr);
        g.addColorStop(0, `rgba(255,255,255,${0.8 * (1 - sh.life)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x - 120 * dpr, sh.y - 40 * dpr); ctx.stroke();
        sh.x += 9 * dpr; sh.y += 3 * dpr;
      }
      while (shooting.length && shooting[0].life >= 1) shooting.shift();

      // фазы: 0–1.1 с логотип проявляется, 1.5–3.0 морфинг, далее вращение и дуги
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) * 0.12;
      const appear = Math.min(1, t / 1.1);
      const m = ease(Math.min(1, Math.max(0, (t - 1.5) / 1.5)));
      const rot = t * 0.35;
      const cr = Math.cos(rot), sr = Math.sin(rot), tilt = 0.35;
      ctx.save();
      ctx.shadowColor = `rgba(${gold},0.8)`; ctx.shadowBlur = 14 * dpr * (1 - m);
      for (let i = 0; i < N; i++) {
        const [sx, sy] = src[i];
        const [x0, y0, z0] = dst[i];
        const x1 = x0 * cr + z0 * sr, z1 = -x0 * sr + z0 * cr;
        const y2 = y0 * Math.cos(tilt) - z1 * Math.sin(tilt), z2 = y0 * Math.sin(tilt) + z1 * Math.cos(tilt);
        const gx = cx + x1 * R, gy = cy - y2 * R;
        const ax = cx + sx * R * 1.05, ay = cy + sy * R * 1.05;
        const x = ax + (gx - ax) * m, y = ay + (gy - ay) * m;
        const front = z2 > 0 ? 1 : 0.22;
        const alpha = appear * (1 - m + m * front);
        const col = gold.map((g, k) => Math.round(g + (sec[k] - g) * m * 0.35));
        ctx.fillStyle = `rgba(${col},${alpha})`;
        const r = (1.1 + (1 - m) * 0.4) * dpr;
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
      ctx.restore();
      // контур Земли и дуги сети
      if (m > 0.6) {
        const a = (m - 0.6) / 0.4;
        ctx.strokeStyle = `rgba(${gold},${0.35 * a})`; ctx.lineWidth = 1 * dpr;
        ctx.beginPath(); ctx.arc(cx, cy, R * 1.01, 0, Math.PI * 2); ctx.stroke();
        for (const [p, q, ph] of arcs) {
          const pts = [];
          for (let k = 0; k <= 24; k++) {
            const u = k / 24;
            let v = p.map((c, j) => c * (1 - u) + q[j] * u);
            const L = Math.hypot(...v) || 1, lift = 1 + Math.sin(u * Math.PI) * 0.18;
            v = v.map(c => c / L * lift);
            const x1 = v[0] * cr + v[2] * sr, z1 = -v[0] * sr + v[2] * cr;
            const y2 = v[1] * Math.cos(tilt) - z1 * Math.sin(tilt), z2 = v[1] * Math.sin(tilt) + z1 * Math.cos(tilt);
            pts.push([cx + x1 * R, cy - y2 * R, z2]);
          }
          ctx.lineWidth = 1.1 * dpr;
          for (let k = 1; k < pts.length; k++) {
            if (pts[k][2] < 0) continue;
            const pulse = Math.max(0, 1 - Math.abs(((t * 0.5 + ph) % 1) - k / 24) * 6);
            ctx.strokeStyle = `rgba(${sec},${a * (0.25 + 0.75 * pulse)})`;
            ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
          }
        }
      }
      if (m > 0.75 && word) word.classList.add('in');
      if ((skip && t > 0.3) || now - t0 > minMs) return resolve();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  word?.classList.add('in');
  root.removeEventListener('pointerdown', onSkip);
  removeEventListener('resize', size);
}

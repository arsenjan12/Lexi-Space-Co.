// =====================================================================
//  Отрисовка текста сообщений: Markdown (безопасное подмножество), LaTeX
//  через KaTeX, ссылки на каталоги SIMBAD / NED / arXiv / NASA ADS / LEXI Space.
//  Сначала всё экранируется — HTML из сообщения никогда не вставляется как есть.
// =====================================================================

let katex = null;
export const katexReady = import('lexi-space/vendor/katex.mjs').then(m => { katex = m.default; }).catch(() => {});

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { esc };

export function tex(src, display = false) {
  if (!katex) return `<code class="tex-raw">${esc(src)}</code>`;
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', output: 'html', maxSize: 20, maxExpand: 200 });
  } catch {
    return `<code class="tex-raw">${esc(src)}</code>`;
  }
}

// ---------- каталоги ----------
const enc = encodeURIComponent;
export const CATALOGS = {
  simbad: { label: 'SIMBAD', url: q => `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${enc(q)}` },
  ned: { label: 'NED', url: q => `https://ned.ipac.caltech.edu/byname?objname=${enc(q)}` },
  arxiv: { label: 'arXiv', url: q => /^\d{4}\.\d{4,5}(v\d+)?$/.test(q) ? `https://arxiv.org/abs/${q}` : `https://arxiv.org/a/${enc(q)}` },
  ads: { label: 'NASA ADS', url: q => /^\d{4}[A-Za-z&.]{5}/.test(q) ? `https://ui.adsabs.harvard.edu/abs/${enc(q)}` : `https://ui.adsabs.harvard.edu/search/q=${enc(q)}` },
  nasa: { label: 'NASA', url: q => `https://images.nasa.gov/search?q=${enc(q)}` },
  lexi: { label: 'LEXI Space', url: q => `https://lexi-space.netlify.app/?q=${enc(q)}` },
};

export function catalogLinks(name) {
  return ['simbad', 'ned', 'ads', 'nasa', 'lexi'].map(k => ({ key: k, label: CATALOGS[k].label, href: CATALOGS[k].url(name) }));
}

const chip = (kind, query, label) =>
  `<button type="button" class="obj-chip" data-obj="${esc(query)}" data-cat="${kind}"><span class="obj-cat">${esc(CATALOGS[kind]?.label || kind)}</span>${esc(label || query)}</button>`;

// ---------- Markdown ----------
// Порядок важен: вынимаем код и формулы в «заглушки», экранируем остальное,
// оформляем, возвращаем заглушки на место.
export function renderText(src, { channels = new Set(), me = '' } = {}) {
  const slots = [];
  const hold = html => `\u0000${slots.push(html) - 1}\u0000`;
  let s = String(src ?? '');

  s = s.replace(/```([a-z0-9+-]*)\n?([\s\S]*?)```/gi, (_, lang, code) => hold(`<pre class="code"><span class="code-lang">${esc(lang || 'code')}</span><code>${esc(code.replace(/\n$/, ''))}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => hold(`<div class="tex-block">${tex(t.trim(), true)}</div>`));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => hold(`<div class="tex-block">${tex(t.trim(), true)}</div>`));
  s = s.replace(/(^|[^\\$\w])\$([^$\n]+?)\$(?!\w)/g, (_, pre, t) => pre + hold(tex(t, false)));

  // явные префиксы каталогов: simbad:M31, ned:"NGC 4993", arXiv:2401.01234
  s = s.replace(/\b(simbad|ned|arxiv|ads|nasa|lexi):(?:"([^"\n]{1,60})"|([^\s,;)]+))/gi, (_, k, q1, q2) => {
    const kind = k.toLowerCase();
    return hold(chip(kind, q1 || q2));
  });
  s = esc(s);

  s = s.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (_, p, u) => p + hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https?:\/\//, '').slice(0, 48)}${u.length > 56 ? '…' : ''}</a>`));
  // объекты без префикса: M1–M110, NGC/IC
  s = s.replace(/\b(M\s?(?:1[01]\d|[1-9]\d?)|(?:NGC|IC)\s?\d{1,4}[A-Z]?)\b/g, m => hold(chip('simbad', m.replace(/\s+/, ' ').replace(/^M (\d)/, 'M$1'))));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/(^|\s)@([\p{L}\d_.-]{2,32})/gu, (_, p, n) => `${p}<span class="mention${n.toLowerCase() === me.toLowerCase() ? ' me' : ''}">@${n}</span>`);
  s = s.replace(/(^|\s)#([a-z0-9][a-z0-9_-]{1,40})\b/gi, (m, p, n) => channels.has(n.toLowerCase()) ? `${p}<button type="button" class="chan-link" data-chan="${n.toLowerCase()}">#${n}</button>` : m);

  // блочные элементы построчно
  const lines = s.split('\n');
  const out = [];
  let list = null;
  for (const ln of lines) {
    const li = ln.match(/^\s*(?:[-•*]|(\d+)[.)])\s+(.*)$/);
    if (li) {
      const tag = li[1] ? 'ol' : 'ul';
      if (list !== tag) { if (list) out.push(`</${list}>`); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${li[2]}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    const h = ln.match(/^(#{1,3})\s+(.+)$/);
    if (h) { out.push(`<p class="h h${h[1].length}">${h[2]}</p>`); continue; }
    const q = ln.match(/^&gt;\s?(.*)$/);
    if (q) { out.push(`<blockquote>${q[1]}</blockquote>`); continue; }
    out.push(ln === '' ? '<br>' : `<span class="ln">${ln}</span><br>`);
  }
  if (list) out.push(`</${list}>`);
  let html = out.join('').replace(/(<br>)+$/, '');
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
  // заглушки могли оказаться внутри других заглушек
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
  return html;
}

// Классы содержимого — для фильтров ленты
export function contentKinds(payload) {
  const k = new Set();
  const t = payload.text || '';
  if (/\$[^$]+\$|\\\[/.test(t)) k.add('formula');
  if (/\b(simbad|ned|arxiv|ads|nasa|lexi):|\b(M\s?\d{1,3}|NGC\s?\d+|IC\s?\d+)\b/i.test(t)) k.add('catalog');
  for (const a of payload.att || []) k.add(a.kind === 'fits' ? 'data' : 'data');
  if (payload.t === 'poll') k.add('poll');
  return k;
}

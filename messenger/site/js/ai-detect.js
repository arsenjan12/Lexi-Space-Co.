// =====================================================================
//  Подсказка модератору: «похоже на текст нейросети».
//  Это эвристика по стилю, а не доказательство: короткие сообщения
//  не оцениваем, результат видит только модератор канала.
// =====================================================================

const MARKERS_RU = [
  'важно отметить', 'стоит отметить', 'следует отметить', 'в целом', 'таким образом', 'кроме того', 'в заключение',
  'давайте разберём', 'давайте рассмотрим', 'это не просто', 'не только', 'играет ключевую роль', 'является важным',
  'в современном мире', 'подводя итог', 'отличный вопрос', 'надеюсь, это поможет', 'вот несколько', 'ключевые моменты',
  'с одной стороны', 'с другой стороны', 'в данном контексте', 'рассмотрим подробнее',
];
const MARKERS_EN = [
  'it is important to note', "it's worth noting", 'in conclusion', 'overall', 'moreover', 'furthermore', 'delve',
  'great question', 'i hope this helps', 'here are some', 'key points', 'in today\'s world', 'plays a crucial role', 'tapestry',
];

export function aiLikelihood(text) {
  const t = String(text || '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 40) return null;                    // слишком мало текста для оценки
  const low = t.toLowerCase();
  let s = 0;
  const hits = [...MARKERS_RU, ...MARKERS_EN].filter(m => low.includes(m)).length;
  s += Math.min(hits, 5) * 0.11;
  const dashes = (t.match(/ — /g) || []).length / words.length * 100;
  s += Math.min(dashes, 3) * 0.06;
  // одинаковая длина предложений — признак генерации; у людей разброс больше
  const sent = t.split(/[.!?]+\s/).map(x => x.split(/\s+/).length).filter(n => n > 2);
  if (sent.length >= 4) {
    const mean = sent.reduce((a, b) => a + b, 0) / sent.length;
    const sd = Math.sqrt(sent.reduce((a, b) => a + (b - mean) ** 2, 0) / sent.length);
    const cv = sd / mean;
    if (cv < 0.35) s += 0.22; else if (cv < 0.5) s += 0.1;
  }
  const bullets = (t.match(/^\s*(?:[-•*]|\d+[.)])\s+\*\*/gm) || []).length;
  s += Math.min(bullets, 4) * 0.07;
  if (/^(конечно|разумеется|certainly|sure)[,!]/i.test(t)) s += 0.12;
  const emojiBullets = (t.match(/^\s*[\u{1F300}-\u{1FAFF}✅❌⭐]/gmu) || []).length;
  s += Math.min(emojiBullets, 3) * 0.05;
  return Math.max(0, Math.min(0.95, s));
}

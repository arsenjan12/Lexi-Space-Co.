// =====================================================================
//  Демо-режим: участники, которые общаются между собой.
//  Каждый — настоящий LexiIRCClient со своим ML-KEM-ключом; сообщения
//  проходят то же шифрование, что и ваши.
// =====================================================================

import { LexiIRCClient } from './lexi-client.js';
import { makeSyntheticFits } from './fits.js';
import { b64 } from './lexi-e2e.js';
import { nightReport, observer, phaseName, altAz, A, PLANETS, PLANET_RU } from './astro.js';

// kind: channel — пишут администраторы; group — пишут все; direct — личный
export const CHATS = [
  { id: 'lexi-news', kind: 'channel', title: 'LEXI', desc: 'Новости проекта', admins: ['lexi'] },
  { id: 'sky-today', kind: 'channel', title: 'Небо сегодня', desc: 'Луна, планеты и условия на ночь', admins: ['lexi'] },
  { id: 'observers', kind: 'group', title: 'Наблюдатели', desc: 'Кто что смотрит и чем' },
  { id: 'orbit', kind: 'group', title: 'Орбита', desc: 'Орбитальная механика и связь со спутниками' },
  { id: 'data-lab', kind: 'group', title: 'Обработка данных', desc: 'FITS, калибровка, фотометрия' },
  { id: 'radio', kind: 'group', title: 'Радио', desc: 'Радиоастрономия и антенны' },
  { id: 'galaxy-zoo', kind: 'group', title: 'Классификация галактик', desc: 'Вместе размечаем кадры', admins: ['lev'], premod: true },
];

const BOTS = [
  { id: 'lexi', name: 'LEXI', role: 'Команда проекта', org: 'LEXI', color: '#c49d47', verified: true, chats: ['lexi-news', 'sky-today'] },
  { id: 'vega', name: 'Вега Ильина', handle: 'vega', role: 'Астрофизик', org: 'Обсерватория «Северная корона»', color: '#ecd391', verified: true, chats: ['observers', 'data-lab', 'galaxy-zoo'] },
  { id: 'timur', name: 'Тимур Алиев', handle: 'timur', role: 'Радиоастроном', org: 'РТ-32', color: '#9fb4ff', verified: true, chats: ['radio', 'orbit', 'observers'] },
  { id: 'mira', name: 'Мира Соколова', handle: 'mira', role: 'Наблюдатель', org: '10″ Добсон', color: '#e88aa6', chats: ['observers', 'galaxy-zoo'] },
  { id: 'oleg', name: 'Олег Белов', handle: 'oleg', role: 'Оператор ЦУП', org: 'LEXI Ground', color: '#45f3ff', chats: ['orbit', 'radio'] },
  { id: 'lev', name: 'Лев Орлов', handle: 'lev', role: 'Модератор', org: 'LEXI', color: '#f0a94b', chats: ['galaxy-zoo', 'observers'] },
  { id: 'anya', name: 'Аня Ким', handle: 'anya', role: 'Студентка, астрофизика', org: 'БГУ', color: '#c7a6ff', chats: ['data-lab', 'galaxy-zoo', 'observers'] },
  { id: 'dmitry', name: 'Дмитрий Зуев', handle: 'dima', role: 'Инженер связи', org: 'LEXI Ground', color: '#7ee0a8', chats: ['orbit', 'radio'] },
  { id: 'sofia', name: 'София Ремез', handle: 'sofia', role: 'Обработка данных', org: 'Обсерватория «Северная корона»', color: '#ff8f6b', verified: true, chats: ['data-lab', 'galaxy-zoo'] },
  { id: 'nikita', name: 'Никита Ветров', handle: 'nikita', role: 'Астрофотограф', org: '', color: '#9fd8ff', chats: ['observers', 'data-lab'] },
];

const min = m => Date.now() - m * 60000;
const wait = ms => new Promise(r => setTimeout(r, ms));
const pick = a => a[Math.floor(Math.random() * a.length)];

function fitsAtt(opts, name) {
  const bytes = makeSyntheticFits({ width: 200, height: 200, ...opts });
  return { kind: 'fits', name, size: bytes.length, data: b64(bytes) };
}

// История каналов: [кто, минут назад, текст, доп.поля]
const HISTORY = {
  'lexi-news': [
    ['lexi', 600, 'Lexi Messenger открыт для тестирования. Пишите, что неудобно, — поправим.'],
    ['lexi', 240, 'В LEXI Space обновили орбиты спутников и добавили LexiAI. Здесь он тоже работает: вкладка LexiAI или @lexi в любом чате.'],
  ],
  observers: [
    ['mira', 300, 'Вчера наконец поймала M31 из города. Ядро видно, пылевых полос нет 🙂'],
    ['nikita', 296, 'Это нормально для Бортля 5. За городом полосы вылезут сразу'],
    ['vega', 290, 'Если будешь фотографировать — снимай сериями по 60 с, потом сложишь'],
    ['mira', 288, 'Ок, попробую в выходные'],
    ['timur', 120, 'Кто-нибудь видел Юпитер в прошлую ночь? Сиинг был отличный'],
    ['nikita', 118, 'Видел, полосы чёткие, Большое красное пятно на краю'],
    ['anya', 60, 'А где посмотреть, когда Луна не мешает?'],
    ['vega', 58, 'Справа TOOLS → «Астропрогноз», там окно тёмного неба на ночь'],
  ],
  orbit: [
    ['oleg', 240, 'Пролёт в 21:40, элевация 63°'],
    ['dmitry', 236, 'На 437,5 МГц доплер до ±10 кГц, перестраиваем приёмник по таблице'],
    ['timur', 230, 'Формула та же: $f\' \\approx f_0\\left(1 \\pm \\frac{v}{c}\\right)$'],
    ['oleg', 200, 'Связь была 9 минут, телеметрия вся пришла'],
    ['dmitry', 90, 'В конце пролёта SNR просел до 6 дБ, похоже на помеху. Посмотрю спектр'],
  ],
  'data-lab': [
    ['sofia', 320, 'Выложила кадр NGC 4414 для проверки просмотрщика. Открывается по нажатию, можно крутить растяжку', { fits: { seed: 4414, object: 'NGC 4414', kind: 'spiral' }, name: 'ngc4414_r_300s.fits' }],
    ['anya', 310, 'Красиво! А флэты к нему есть?'],
    ['sofia', 305, 'Есть, завтра скину'],
    ['nikita', 150, 'Подскажите, чем лучше складывать серии? Siril или DSS?'],
    ['vega', 146, 'Siril, там и калибровка, и выравнивание по звёздам'],
  ],
  radio: [
    ['timur', 400, 'Линия водорода 1420,4 МГц сегодня отлично видна в направлении Лебедя'],
    ['dmitry', 395, 'Сколько накапливал?'],
    ['timur', 392, 'Минут двадцать. Профиль двугорбый, рукава Галактики разошлись по скорости'],
    ['oleg', 100, 'Антенну в пятницу будем юстировать, кто поможет?'],
  ],
  'galaxy-zoo': [
    ['lev', 200, 'Новый объект для разметки. Какая морфология?', { fits: { seed: 17, object: 'LEXI-CS-017', kind: 'elliptical', ra: 187.7, dec: 12.39 }, name: 'lexi_cs_017.fits' }],
    ['mira', 180, 'Эллиптическая: рукавов нет, профиль гладкий'],
    ['sofia', 176, 'Согласна, E2 примерно'],
    ['anya', 170, 'Тоже за эллиптическую'],
    ['lev', 20, 'Сообщения новых участников здесь проходят модерацию — это нормально, ждите пару минут'],
  ],
};

// Живые диалоги: проигрываются по одному сообщению раз в 30–80 с
const LIVE = {
  observers: [
    [['nikita', 'Облака расходятся, иду ставить телескоп'], ['mira', 'Удачи! Напиши, что получится'], ['nikita', 'Сатурн низковато, но кольца видно']],
    [['anya', 'Вопрос новичка: окуляр 10 мм или 25 мм для планет?'], ['vega', 'Для планет — 10 мм, но при плохом сиинге лучше 15'], ['anya', 'Спасибо!']],
    [['timur', 'Сегодня влажно, роса на всём'], ['mira', 'Фен для оптики спасает 😄']],
  ],
  orbit: [
    [['oleg', 'Следующий пролёт через 95 минут'], ['dmitry', 'Принято, приёмник готов']],
    [['dmitry', 'Спектр посмотрел: узкая помеха на 437,48 МГц'], ['oleg', 'Это не наш спутник, кто-то рядом'], ['timur', 'Запиши время, сверим с соседями']],
  ],
  'data-lab': [
    [['anya', 'Сделала фотометрию переменной, амплитуда 0,4ᵐ'], ['sofia', 'Покажи кривую блеска, посмотрим'], ['anya', 'Скину вечером']],
    [['nikita', 'Есть кто знает, как убрать градиент от фонаря?'], ['sofia', 'Модель фона по пустым участкам и вычесть. В Siril это одна кнопка']],
  ],
  radio: [
    [['timur', 'Пульсар B0329+54 сегодня поймали'], ['dmitry', 'Ого, на 32-метровой?'], ['timur', 'Да, период 0,714 с, как по учебнику']],
  ],
  'galaxy-zoo': [
    [['mira', 'Следующий кадр будет?'], ['lev', 'Вечером выложу партию']],
  ],
};

export async function startDemo(relay, { onProgress } = {}) {
  const bots = {};
  for (const def of BOTS) {
    const c = new LexiIRCClient({ socketFactory: relay.socketFactory, profile: { name: def.name, color: def.color } });
    await c.connect('demo://relay', def.name, { channel: def.chats[0] });
    for (const ch of def.chats) {
      const meta = CHATS.find(x => x.id === ch);
      const founder = (meta.admins?.[0] || BOTS.find(b => b.chats.includes(ch)).id) === def.id;
      c.joinChannel(ch, { found: founder });
    }
    bots[def.id] = { def, c };
    if (def.verified) relay.verified.add(c.uid);
    onProgress?.(def.name);
  }
  for (let i = 0; i < 60; i++) {
    if (BOTS.every(d => d.chats.every(ch => bots[d.id].c.keyInfo(ch)))) break;
    await wait(100);
  }
  const B = id => bots[id].c;
  const uidOf = id => bots[id].c.uid;

  for (const d of BOTS) for (const ch of d.chats) {
    B(d.id).sendPayload(ch, { t: 'profile', role: d.role, org: d.org, handle: d.handle || '', color: d.color, ts: min(700) });
  }
  for (const ch of CHATS) {
    const founder = ch.admins?.[0] || BOTS.find(b => b.chats.includes(ch.id)).id;
    B(founder).sendPayload(ch.id, { t: 'meta', kind: ch.kind, title: ch.title, desc: ch.desc, admins: (ch.admins || []).map(uidOf), premod: !!ch.premod, ts: min(690) });
  }

  const ids = {};
  for (const [ch, lines] of Object.entries(HISTORY)) {
    for (const [who, ago, text, extra = {}] of lines) {
      const p = { t: 'text', text, ts: min(ago) };
      if (extra.fits) p.att = [fitsAtt(extra.fits, extra.name)];
      const r = await B(who).sendPayload(ch, p);
      if (r?.payload) (ids[ch] ||= []).push({ id: r.payload.id, who });
      await wait(15);
    }
  }
  // в чате с премодерацией старые сообщения уже одобрены модератором
  const zoo = CHATS.find(c => c.id === 'galaxy-zoo');
  for (const m of ids['galaxy-zoo'] || []) if (!zoo.admins.includes(m.who)) await B('lev').sendPayload('galaxy-zoo', { t: 'approve', ref: m.id, ok: true, ts: min(1) });

  // небо сегодня — настоящие расчёты на Минск
  await postSky(B('lexi'));

  // реакции: часть сообщений набирает 3+ и попадает в «Зал славы»
  const react = (ch, idx, list) => {
    const m = ids[ch]?.[idx]; if (!m) return;
    for (const [who, e] of list) if (who !== m.who && BOTS.find(b => b.id === who).chats.includes(ch)) B(who).sendPayload(ch, { t: 'react', ref: m.id, emoji: e, ts: min(5) });
  };
  react('data-lab', 0, [['anya', '⭐'], ['nikita', '🔭'], ['vega', '⭐']]);
  react('galaxy-zoo', 1, [['sofia', '👍'], ['anya', '👍'], ['lev', '⭐'], ['vega', '👍']]);
  react('radio', 2, [['dmitry', '🔥'], ['oleg', '⭐'], ['timur', '👍']]);
  react('orbit', 1, [['oleg', '👍'], ['timur', '⭐'], ['dmitry', '✅']]);
  react('observers', 2, [['mira', '❤️'], ['nikita', '👍'], ['anya', '⭐']]);

  startLive(bots);
  return bots;
}

async function postSky(c) {
  try {
    const obs = observer({ lat: 53.9, lon: 27.56 });
    const n = nightReport(new Date(), obs);
    const hm = d => d ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
    const vis = [];
    const mid = new Date(); mid.setHours(23, 0, 0, 0);
    for (const p of PLANETS.filter(x => x !== 'Moon')) {
      const h = altAz({ body: A.Body[p] }, mid, obs);
      if (h.alt > 10) vis.push(`${PLANET_RU[p]} ${Math.round(h.alt)}°`);
    }
    const text = `${phaseName(n.phaseAngle)}, освещённость ${Math.round(n.illum * 100)} %.\nТемно с ${hm(n.astroDusk)} до ${hm(n.astroDawn)}.${vis.length ? `\nВ 23:00 над горизонтом: ${vis.join(', ')}.` : ''}\nТочка расчёта — Минск; свою можно задать в профиле.`;
    await c.sendPayload('sky-today', { t: 'text', text, ts: min(30) });
  } catch {}
}

function startLive(bots) {
  const B = id => bots[id].c;
  const isBot = uid => Object.values(bots).some(b => b.c.uid === uid);
  const queue = Object.entries(LIVE).map(([ch, dialogs]) => ({ ch, dialogs, d: 0, l: 0 }));
  const tick = () => {
    const q = pick(queue);
    const [who, text] = q.dialogs[q.d][q.l];
    B(who).sendPayload(q.ch, { t: 'text', text });
    q.l++;
    if (q.l >= q.dialogs[q.d].length) { q.l = 0; q.d = (q.d + 1) % q.dialogs.length; }
    setTimeout(tick, 30000 + Math.random() * 50000);
  };
  setTimeout(tick, 25000);

  for (const { c, def } of Object.values(bots)) {
    c.on('chat', ev => {
      const p = ev.payload;
      if (ev.history || isBot(ev.from.uid)) return;
      if (p.t === 'dm' && p.to === c.uid) {
        c.joinChannel(p.channel);
        return;
      }
      if (p.t !== 'text') return;
      if (def.id === 'lev' && ev.channel === 'galaxy-zoo') setTimeout(() => c.sendPayload(ev.channel, { t: 'approve', ref: p.id, ok: true }), 4000);
      const text = (p.text || '').toLowerCase();
      if (ev.channel.startsWith('dm-')) {
        setTimeout(() => c.sendPayload(ev.channel, { t: 'text', text: pick(['Привет! Да, слушаю', 'Привет 🙂', 'Сейчас посмотрю и отвечу', 'Ок, понял(а)']) }), 1800 + Math.random() * 2000);
        return;
      }
      const mentioned = def.handle && text.includes('@' + def.handle) || text.includes('@' + def.name.split(' ')[0].toLowerCase());
      if (mentioned) setTimeout(() => c.sendPayload(ev.channel, { t: 'text', text: pick(['Да?', 'Тут', 'Сейчас гляну', 'Ага, видел(а)']), reply: p.id }), 1500 + Math.random() * 1500);
      else if (Math.random() < 0.12) setTimeout(() => c.sendPayload(ev.channel, { t: 'react', ref: p.id, emoji: pick(['👍', '⭐', '🔭']) }), 3000 + Math.random() * 6000);
    });
  }
}

export const DEMO_BOTS = BOTS;

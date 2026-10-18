// Тексты интерфейса. Тексты модулей, угроз и объектов лежат в базе (lexi.sqlite),
// здесь только «обвязка». Язык берётся из ?lang=…, потом из памяти браузера,
// ключ тот же, что на портале: lexi-lang.

const I18N = {
  ru: {
    'meta.title': 'LEXI Space — ситуационный центр',
    'nav.aria': 'Разделы', 'nav.orbit': 'Орбита', 'nav.solar': 'Солнечная система', 'nav.sky': 'Небо', 'nav.modules': 'Модули', 'nav.back': '← LEXI', 'warp.portal': 'Возвращаемся в LEXI',
    'lang.label': 'Язык', 'search.ph': 'Сириус, МКС, M31, Марс…', 'search.open': 'Поиск', 'ui.close': 'Закрыть',
    'hud.toggle': 'Показать состояние', 'hud.short': 'Статус', 'hud.locate': 'Моё местоположение',
    'time.live': 'Реальное время', 'time.sim': 'Ускоренное время', 'time.label': 'Время', 'time.now': 'Сейчас', 'time.day': '×1д',
    'sec.title': 'Состояние защиты', 'sec.note': 'Каждый показатель реально вычисляется в браузере. Нажмите, чтобы увидеть как.',
    'boot.db': 'Открываем базу знаний', 'boot.scene': 'Строим сцену', 'boot.sats': 'Загружаем орбиты спутников', 'boot.ready': 'Готово',
    'where.unknown': 'Точка наблюдения: Москва (по умолчанию)', 'where.you': 'Вы', 'where.default': 'Москва (по умолчанию)',
    'where.denied': 'Геолокация не разрешена — считаем для Москвы',
    'geo.kind': 'Точка наблюдения', 'geo.title': 'Где вы?', 'geo.locating': 'Определяем…',
    'geo.denied': 'Браузер запретил сайту доступ к местоположению.',
    'geo.unavailable': 'Устройство не смогло определить местоположение. На компьютере это обычно значит, что выключена служба геолокации (Windows: Параметры → Конфиденциальность → Расположение).',
    'geo.timeout': 'Местоположение не определилось за 15 секунд.',
    'geo.howto': 'Чтобы разрешить: нажмите на значок замка слева от адреса сайта → «Местоположение» → «Разрешить», затем обновите страницу. Или просто выберите город ниже — все расчёты пересчитаются для него.',
    'geo.retry': 'Попробовать ещё раз', 'geo.cities': 'Выбрать город', 'geo.manual': 'Или координаты вручную', 'geo.apply': 'Применить',
    'mod.kicker': 'Формулы, алгоритмы, связи', 'mod.title': 'Как LEXI защищает космос',
    'mod.lead': 'Три модуля портала LEXI, разобранные по связям: какая угроза чем обнаруживается, чем закрывается и какой формулой считается. Любую формулу можно посчитать прямо здесь.',
    'mod.threats': 'Угрозы', 'mod.counter': 'Защита и алгоритмы', 'mod.formulas': 'Формулы', 'mod.indicators': 'Живые показатели',
    'mod.fulltext': 'Полный текст модуля с портала', 'mod.goals': 'Цели', 'mod.math': 'Физика и математика', 'mod.tech': 'Технологии и стандарты',
    'mod.astro': 'Астрономия', 'mod.astroLead': 'Формулы для карточек небесных объектов и орбитальной механики.',
    'mod.hint': 'Наведите на угрозу — подсветятся её защита и формулы.',
    'kind.satellite': 'Спутник', 'kind.planet': 'Планета', 'kind.star': 'Звезда', 'kind.dwarf': 'Карликовая планета', 'kind.moon': 'Спутник Земли',
    'kind.sun': 'Звезда', 'kind.neo': 'Околоземный астероид', 'kind.threat': 'Угроза', 'kind.countermeasure': 'Защита', 'kind.formula': 'Формула',
    'kind.indicator': 'Живой показатель', 'kind.galaxy_spiral': 'Спиральная галактика', 'kind.galaxy_elliptical': 'Эллиптическая галактика',
    'kind.galaxy_lenticular': 'Линзовидная галактика', 'kind.galaxy_irregular': 'Неправильная галактика', 'kind.globular': 'Шаровое скопление',
    'kind.open': 'Рассеянное скопление', 'kind.planetary': 'Планетарная туманность', 'kind.nebula': 'Туманность', 'kind.snr': 'Остаток сверхновой', 'kind.other': 'Объект',
    'f.lat': 'Широта', 'f.lon': 'Долгота', 'f.alt': 'Высота', 'f.speed': 'Скорость', 'f.period': 'Период', 'f.incl': 'Наклонение', 'f.ecc': 'Эксцентриситет',
    'f.epoch': 'Возраст элементов', 'f.norad': 'NORAD', 'f.group': 'Группа', 'f.azel': 'Азимут / угол места', 'f.range': 'Дальность от вас',
    'f.doppler': 'Доплер для вас', 'f.visible': 'Видно отсюда', 'f.nextpass': 'Следующий пролёт', 'f.dist': 'Расстояние', 'f.light': 'Свет идёт',
    'f.radec': 'Прямое восх. / склонение', 'f.con': 'Созвездие', 'f.mag': 'Звёздная величина', 'f.rise': 'Восход', 'f.set': 'Заход', 'f.transit': 'Кульминация',
    'f.phase': 'Освещённость', 'f.elong': 'Элонгация', 'f.helio': 'От Солнца', 'f.mass': 'Масса', 'f.radius': 'Радиус', 'f.gravity': 'Гравитация',
    'f.day': 'Сутки', 'f.year': 'Год', 'f.moons': 'Спутников', 'f.temp': 'Температура', 'f.atm': 'Атмосфера', 'f.spect': 'Спектр', 'f.tempK': 'Температура поверхности',
    'f.lum': 'Светимость', 'f.absmag': 'Абсолютная величина', 'f.lightLeft': 'Свет вышел', 'f.size': 'Угловой размер', 'f.morph': 'Морфология',
    'f.hubble': 'Скорость удаления (Хаббл)', 'f.approach': 'Сближение', 'f.miss': 'Пролетит на', 'f.diam': 'Диаметр', 'f.hazard': 'Потенциально опасен',
    'f.vel': 'Скорость', 'f.circumpolar': 'не заходит', 'f.never': 'не восходит', 'f.yes': 'да', 'f.no': 'нет', 'f.below': 'под горизонтом',
    'f.operator': 'Оператор', 'f.launched': 'Запущен', 'f.ago': 'назад', 'f.yearsAgo': 'лет назад', 'f.yearIn': 'в {y} году',
    'p.now': 'Сейчас, в реальном времени', 'p.about': 'О объекте', 'p.formulas': 'Формулы', 'p.related': 'Связи', 'p.how': 'Как считается',
    'p.signs': 'Признаки', 'p.detect': 'Чем обнаруживается', 'p.mitigate': 'Чем закрывается', 'p.measure': 'Чем считается', 'p.covers': 'Какие угрозы закрывает',
    'p.uses': 'Какие формулы использует', 'p.serves': 'Каким целям служит', 'p.usedBy': 'Где используется', 'p.watches': 'За чем следит',
    'p.calc': 'Посчитать', 'p.noCalc': 'Эта формула поясняющая: её смысл — в устройстве алгоритма, а не в одном числе.',
    'p.data': 'Данные', 'p.source': 'Источник', 'p.severity': 'Опасность', 'p.module': 'Модуль', 'p.askAi': 'Спросить LexiAI',
    'p.showOnScene': 'Показать на сцене',
    'sat.source.signed': 'Сервер LEXI Space, подпись ML-DSA-65 проверена', 'sat.source.direct': 'CelesTrak напрямую (без подписи)',
    'layers.neo': 'Астероиды дня', 'layers.lines': 'Созвездия', 'layers.dso': 'Галактики и туманности', 'layers.grid': 'Горизонт',
    'layers.orbits': 'Орбиты', 'layers.labels': 'Подписи',
    'ind.wait': 'считаем…', 'ind.na': 'нет данных', 'ind.ok': 'норма', 'ind.warn': 'внимание', 'ind.alarm': 'тревога',
    'ind.verified': 'проверена', 'ind.unsigned': 'нет подписи', 'ind.invalid': 'подпись неверна', 'ind.agree': 'ключи совпали',
    'ind.over': 'над аномалией', 'ind.clear': 'вне аномалии', 'ind.ask': 'разрешить', 'ind.sats': 'спутн.',
    'ai.ph': 'Спросите про угрозу, формулу или объект…', 'ai.send': 'Отправить',
    'ai.modeLite': 'Режим: база знаний + расчёты', 'ai.modeLLM': 'Режим: нейросеть LexiAI ({m}) + база знаний',
    'ai.loadTitle': 'Нейросеть LexiAI обучена на модулях, угрозах, формулах и каталогах LEXI. Работает прямо в браузере, без сервера.',
    'ai.load': 'Включить нейросеть', 'ai.loading': 'Загружаем модель: {p}%', 'ai.noModel': 'Файл модели ещё не выложен — LexiAI отвечает по базе знаний.',
    'ai.loadFail': 'Не удалось загрузить модель: {e}. Отвечаю по базе знаний.', 'ai.size': 'Размер ≈ {s}, скачивается один раз.',
    'ai.lowmem': 'На этом устройстве мало памяти: нейросеть может не запуститься. Без неё LexiAI отвечает по базе знаний.',
    'ai.hello': 'Привет! Я LexiAI. Спросите, как обнаружить спуфинг, посчитайте Фрииса для межспутниковой линии или узнайте, где сейчас МКС.',
    'ai.nothing': 'Не нашёл ответа в базе LEXI. Попробуйте переформулировать: назовите угрозу, формулу или объект.',
    'ai.sources': 'Источники', 'ai.thinking': 'думаю…', 'ai.calcDone': 'Посчитал по формуле «{f}»:',
    'ai.hint1': 'Как обнаружить спуфинг?', 'ai.hint2': 'Где сейчас МКС?', 'ai.hint3': 'Неравенство Моски для 25 лет', 'ai.hint4': 'Что такое M31?',
    'toast.locate': 'Точка наблюдения обновлена', 'toast.noTle': 'Не удалось загрузить орбиты группы «{g}»',
    'credits': 'Данные: CelesTrak (орбиты), NASA NeoWs (астероиды), NOAA SWPC (индекс Kp), каталог звёзд HYG v4.1 (CC BY-SA 4.0), d3-celestial (BSD-3). Расчёты: astronomy-engine, satellite.js (SGP4), noble-post-quantum (ML-KEM, ML-DSA). LexiAI — Qwen2.5 (Apache 2.0), дообучена на базе LEXI.',
    'unit.km': 'км', 'unit.kms': 'км/с', 'unit.min': 'мин', 'unit.h': 'ч', 'unit.d': 'сут', 'unit.au': 'а.е.', 'unit.ly': 'св. лет', 'unit.pc': 'пк',
    'unit.kg': 'кг', 'unit.ms2': 'м/с²', 'unit.hz': 'Гц', 'unit.khz': 'кГц', 'unit.ld': 'LD', 'unit.m': 'м', 'unit.y': 'лет', 'unit.ms': 'мс',
  },
  en: {
    'meta.title': 'LEXI Space — situation center',
    'nav.aria': 'Sections', 'nav.orbit': 'Orbit', 'nav.solar': 'Solar System', 'nav.sky': 'Sky', 'nav.modules': 'Modules', 'warp.portal': 'Back to LEXI', 'nav.back': '← LEXI',
    'lang.label': 'Language', 'search.ph': 'Sirius, ISS, M31, Mars…', 'search.open': 'Search', 'ui.close': 'Close',
    'hud.toggle': 'Show status', 'hud.short': 'Status', 'hud.locate': 'My location',
    'time.live': 'Real time', 'time.sim': 'Accelerated time', 'time.label': 'Time', 'time.now': 'Now', 'time.day': '×1d',
    'sec.title': 'Protection status', 'sec.note': 'Every indicator is really computed in your browser. Tap one to see how.',
    'boot.db': 'Opening the knowledge base', 'boot.scene': 'Building the scene', 'boot.sats': 'Loading satellite orbits', 'boot.ready': 'Ready',
    'where.unknown': 'Observer: Moscow (default)', 'where.you': 'You', 'where.default': 'Moscow (default)',
    'where.denied': 'Location not allowed — computing for Moscow',
    'geo.kind': 'Observer', 'geo.title': 'Where are you?', 'geo.locating': 'Locating…',
    'geo.denied': 'The browser blocked location access for this site.',
    'geo.unavailable': 'The device could not determine its location. On a computer this usually means location services are off (Windows: Settings → Privacy → Location).',
    'geo.timeout': 'Location did not resolve within 15 seconds.',
    'geo.howto': 'To allow it: click the lock icon left of the site address → Location → Allow, then reload. Or just pick a city below — everything will be recomputed for it.',
    'geo.retry': 'Try again', 'geo.cities': 'Pick a city', 'geo.manual': 'Or enter coordinates', 'geo.apply': 'Apply',
    'mod.kicker': 'Formulas, algorithms, links', 'mod.title': 'How LEXI protects space',
    'mod.lead': 'The three LEXI portal modules taken apart by their links: which threat is detected by what, mitigated by what and computed with which formula. Every formula can be calculated right here.',
    'mod.threats': 'Threats', 'mod.counter': 'Protection and algorithms', 'mod.formulas': 'Formulas', 'mod.indicators': 'Live indicators',
    'mod.fulltext': 'Full module text from the portal', 'mod.goals': 'Goals', 'mod.math': 'Physics and maths', 'mod.tech': 'Technology and standards',
    'mod.astro': 'Astronomy', 'mod.astroLead': 'Formulas behind the celestial object cards and orbital mechanics.',
    'mod.hint': 'Hover a threat to highlight its protection and formulas.',
    'kind.satellite': 'Satellite', 'kind.planet': 'Planet', 'kind.star': 'Star', 'kind.dwarf': 'Dwarf planet', 'kind.moon': 'Earth\'s moon',
    'kind.sun': 'Star', 'kind.neo': 'Near-Earth asteroid', 'kind.threat': 'Threat', 'kind.countermeasure': 'Protection', 'kind.formula': 'Formula',
    'kind.indicator': 'Live indicator', 'kind.galaxy_spiral': 'Spiral galaxy', 'kind.galaxy_elliptical': 'Elliptical galaxy',
    'kind.galaxy_lenticular': 'Lenticular galaxy', 'kind.galaxy_irregular': 'Irregular galaxy', 'kind.globular': 'Globular cluster',
    'kind.open': 'Open cluster', 'kind.planetary': 'Planetary nebula', 'kind.nebula': 'Nebula', 'kind.snr': 'Supernova remnant', 'kind.other': 'Object',
    'f.lat': 'Latitude', 'f.lon': 'Longitude', 'f.alt': 'Altitude', 'f.speed': 'Speed', 'f.period': 'Period', 'f.incl': 'Inclination', 'f.ecc': 'Eccentricity',
    'f.epoch': 'Element age', 'f.norad': 'NORAD', 'f.group': 'Group', 'f.azel': 'Azimuth / elevation', 'f.range': 'Range from you',
    'f.doppler': 'Doppler for you', 'f.visible': 'Visible from here', 'f.nextpass': 'Next pass', 'f.dist': 'Distance', 'f.light': 'Light travel',
    'f.radec': 'RA / Dec', 'f.con': 'Constellation', 'f.mag': 'Magnitude', 'f.rise': 'Rise', 'f.set': 'Set', 'f.transit': 'Transit',
    'f.phase': 'Illuminated', 'f.elong': 'Elongation', 'f.helio': 'From the Sun', 'f.mass': 'Mass', 'f.radius': 'Radius', 'f.gravity': 'Gravity',
    'f.day': 'Day', 'f.year': 'Year', 'f.moons': 'Moons', 'f.temp': 'Temperature', 'f.atm': 'Atmosphere', 'f.spect': 'Spectrum', 'f.tempK': 'Surface temperature',
    'f.lum': 'Luminosity', 'f.absmag': 'Absolute magnitude', 'f.lightLeft': 'Light left', 'f.size': 'Angular size', 'f.morph': 'Morphology',
    'f.hubble': 'Recession speed (Hubble)', 'f.approach': 'Close approach', 'f.miss': 'Miss distance', 'f.diam': 'Diameter', 'f.hazard': 'Potentially hazardous',
    'f.vel': 'Velocity', 'f.circumpolar': 'never sets', 'f.never': 'never rises', 'f.yes': 'yes', 'f.no': 'no', 'f.below': 'below horizon',
    'f.operator': 'Operator', 'f.launched': 'Launched', 'f.ago': 'ago', 'f.yearsAgo': 'years ago', 'f.yearIn': 'in {y}',
    'p.now': 'Now, in real time', 'p.about': 'About', 'p.formulas': 'Formulas', 'p.related': 'Links', 'p.how': 'How it is computed',
    'p.signs': 'Signs', 'p.detect': 'Detected by', 'p.mitigate': 'Mitigated by', 'p.measure': 'Computed with', 'p.covers': 'Threats it covers',
    'p.uses': 'Formulas it uses', 'p.serves': 'Goals it serves', 'p.usedBy': 'Used by', 'p.watches': 'Watches',
    'p.calc': 'Calculate', 'p.noCalc': 'This formula is explanatory: its point is how the algorithm works, not a single number.',
    'p.data': 'Data', 'p.source': 'Source', 'p.severity': 'Severity', 'p.module': 'Module', 'p.askAi': 'Ask LexiAI',
    'p.showOnScene': 'Show in scene',
    'sat.source.signed': 'LEXI Space server, ML-DSA-65 signature verified', 'sat.source.direct': 'CelesTrak directly (unsigned)',
    'layers.neo': 'Today\'s asteroids', 'layers.lines': 'Constellations', 'layers.dso': 'Galaxies and nebulae', 'layers.grid': 'Horizon',
    'layers.orbits': 'Orbits', 'layers.labels': 'Labels',
    'ind.wait': 'computing…', 'ind.na': 'no data', 'ind.ok': 'normal', 'ind.warn': 'caution', 'ind.alarm': 'alarm',
    'ind.verified': 'verified', 'ind.unsigned': 'unsigned', 'ind.invalid': 'bad signature', 'ind.agree': 'keys match',
    'ind.over': 'over the anomaly', 'ind.clear': 'clear', 'ind.ask': 'allow', 'ind.sats': 'sats',
    'ai.ph': 'Ask about a threat, a formula or an object…', 'ai.send': 'Send',
    'ai.modeLite': 'Mode: knowledge base + calculations', 'ai.modeLLM': 'Mode: LexiAI neural net ({m}) + knowledge base',
    'ai.loadTitle': 'The LexiAI neural net is trained on LEXI modules, threats, formulas and catalogues. It runs right in your browser, no server.',
    'ai.load': 'Turn on the neural net', 'ai.loading': 'Loading the model: {p}%', 'ai.noModel': 'The model file is not published yet — LexiAI answers from the knowledge base.',
    'ai.loadFail': 'Could not load the model: {e}. Answering from the knowledge base.', 'ai.size': 'Size ≈ {s}, downloaded once.',
    'ai.lowmem': 'This device has little memory: the neural net may not start. Without it LexiAI answers from the knowledge base.',
    'ai.hello': 'Hi! I am LexiAI. Ask how to detect spoofing, run Friis for an inter-satellite link, or find out where the ISS is right now.',
    'ai.nothing': 'I found nothing in the LEXI base. Try rephrasing: name a threat, a formula or an object.',
    'ai.sources': 'Sources', 'ai.thinking': 'thinking…', 'ai.calcDone': 'Computed with «{f}»:',
    'ai.hint1': 'How to detect spoofing?', 'ai.hint2': 'Where is the ISS now?', 'ai.hint3': 'Mosca\'s inequality for 25 years', 'ai.hint4': 'What is M31?',
    'toast.locate': 'Observer location updated', 'toast.noTle': 'Could not load orbits for “{g}”',
    'credits': 'Data: CelesTrak (orbits), NASA NeoWs (asteroids), NOAA SWPC (Kp index), HYG v4.1 star catalogue (CC BY-SA 4.0), d3-celestial (BSD-3). Maths: astronomy-engine, satellite.js (SGP4), noble-post-quantum (ML-KEM, ML-DSA). LexiAI is Qwen2.5 (Apache 2.0) fine-tuned on the LEXI base.',
    'unit.km': 'km', 'unit.kms': 'km/s', 'unit.min': 'min', 'unit.h': 'h', 'unit.d': 'd', 'unit.au': 'AU', 'unit.ly': 'ly', 'unit.pc': 'pc',
    'unit.kg': 'kg', 'unit.ms2': 'm/s²', 'unit.hz': 'Hz', 'unit.khz': 'kHz', 'unit.ld': 'LD', 'unit.m': 'm', 'unit.y': 'yr', 'unit.ms': 'ms',
  },
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим — не страшно */ } },
};

export let lang = (() => {
  if (typeof location === 'undefined') return 'ru';   // запуск из Node (сборка обучающей выборки)
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const l = fromUrl || store.get('lexi-lang') || (navigator.language || 'ru').slice(0, 2);
  return I18N[l] ? l : 'ru';
})();

const hooks = [];
export const onLang = fn => hooks.push(fn);

export function t(key, vars) {
  let s = I18N[lang][key] ?? I18N.ru[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export const locale = () => (lang === 'ru' ? 'ru-RU' : 'en-US');

// Единицы в базе записаны по-русски; для английского интерфейса переводим
const UNIT_EN = { 'км': 'km', 'м': 'm', 'с': 's', 'мкс': 'µs', 'мин': 'min', 'лет': 'yr', 'сут': 'd', 'бит': 'bits', 'КБ': 'KB',
  'Вт': 'W', 'дБ': 'dB', 'дБм': 'dBm', 'дБи': 'dBi', 'ГГц': 'GHz', 'МГц': 'MHz', 'Гц': 'Hz', 'м/с': 'm/s', 'км/с': 'km/s',
  'дБ·Гц': 'dB-Hz', 'чип/с': 'chip/s', 'см²/бит': 'cm²/bit', 'см⁻²·с⁻¹': 'cm⁻²·s⁻¹', 'кг': 'kg', 'а.е.': 'AU', 'пк': 'pc',
  'млн св. лет': 'Mly', 'спутн.': 'sats', 'K': 'K', '°': '°' };
export const unit = (u, l = lang) => (!u ? '' : l === 'en' ? (UNIT_EN[u] ?? u) : u);

// Число по-человечески: 12 345,6 / 12,345.6
export function num(x, digits = 0) {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

// Для Node-скриптов: сменить язык без DOM
export function setLang(l) { lang = I18N[l] ? l : 'ru'; }

export function applyLang(l, save = true) {
  lang = I18N[l] ? l : 'ru';
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  if (save) store.set('lexi-lang', lang);
  hooks.forEach(fn => fn(lang));
}

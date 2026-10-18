-- =====================================================================
--  LEXI Space — база данных
--
--  Три части:
--    1. Знания портала: модули, цели, угрозы, формулы, контрмеры и связи
--       между ними («что с чем взаимодействует»).
--    2. Небо: звёзды, созвездия, галактики и туманности, тела Солнечной
--       системы, группы спутников.
--    3. LexiAI: фрагменты знаний для поиска и сценарии-примеры для обучения.
--
--  Тексты на двух языках лежат в отдельных таблицах *_texts (lang = 'ru' | 'en'),
--  чтобы добавить третий язык можно было без изменения схемы.
--  Собирается командой: npm run db  →  site/data/lexi.sqlite
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
--  1. Модули и логика портала
-- ---------------------------------------------------------------------

CREATE TABLE modules (
  id      TEXT PRIMARY KEY,          -- module1 … module3, как на портале
  num     INTEGER NOT NULL,
  slug    TEXT NOT NULL UNIQUE       -- cyber | gnss | pqc
);

CREATE TABLE module_texts (
  module_id       TEXT NOT NULL REFERENCES modules(id),
  lang            TEXT NOT NULL,
  title           TEXT NOT NULL,
  lead            TEXT,              -- одна фраза «зачем это»
  goals           TEXT,              -- полный текст с портала (разметка портала: **, •, $…$)
  threats         TEXT,
  physics_math    TEXT,
  tech_standards  TEXT,
  PRIMARY KEY (module_id, lang)
);

-- Цели модуля по отдельности — чтобы на них можно было ссылаться из связей
CREATE TABLE goals (
  id         TEXT PRIMARY KEY,
  module_id  TEXT NOT NULL REFERENCES modules(id)
);
CREATE TABLE goal_texts (
  goal_id  TEXT NOT NULL REFERENCES goals(id),
  lang     TEXT NOT NULL,
  title    TEXT NOT NULL,
  body     TEXT,
  PRIMARY KEY (goal_id, lang)
);

-- Угрозы. severity: 1 — неприятно, 5 — потеря аппарата / данных
CREATE TABLE threats (
  id         TEXT PRIMARY KEY,
  module_id  TEXT NOT NULL REFERENCES modules(id),
  severity   INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  framework  TEXT                    -- SPARTA / STRIDE / NIST и т.п.
);
CREATE TABLE threat_texts (
  threat_id  TEXT NOT NULL REFERENCES threats(id),
  lang       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  signs      TEXT,                   -- по каким признакам угрозу видно
  PRIMARY KEY (threat_id, lang)
);

-- Контрмеры (алгоритмы и решения)
CREATE TABLE countermeasures (
  id         TEXT PRIMARY KEY,
  module_id  TEXT NOT NULL REFERENCES modules(id)
);
CREATE TABLE countermeasure_texts (
  countermeasure_id  TEXT NOT NULL REFERENCES countermeasures(id),
  lang               TEXT NOT NULL,
  title              TEXT NOT NULL,
  body               TEXT,
  PRIMARY KEY (countermeasure_id, lang)
);

-- Формулы. calc — имя функции-калькулятора в site/js/formulas.js (NULL, если формула
-- поясняющая и посчитать её «в лоб» нельзя, например Module-LWE).
CREATE TABLE formulas (
  id         TEXT PRIMARY KEY,
  module_id  TEXT REFERENCES modules(id),   -- NULL — общая астрономия (формулы Гоши)
  latex      TEXT NOT NULL,
  calc       TEXT,
  result_unit TEXT,
  origin     TEXT NOT NULL DEFAULT 'portal'  -- portal | gosha | space
);
CREATE TABLE formula_texts (
  formula_id   TEXT NOT NULL REFERENCES formulas(id),
  lang         TEXT NOT NULL,
  title        TEXT NOT NULL,
  explanation  TEXT,
  PRIMARY KEY (formula_id, lang)
);
CREATE TABLE formula_params (
  formula_id  TEXT NOT NULL REFERENCES formulas(id),
  pos         INTEGER NOT NULL,
  name        TEXT NOT NULL,         -- имя аргумента калькулятора
  symbol      TEXT NOT NULL,         -- обозначение в LaTeX
  unit        TEXT,
  def         REAL,                  -- значение по умолчанию
  min         REAL,
  max         REAL,
  step        REAL,
  label_ru    TEXT NOT NULL,
  label_en    TEXT NOT NULL,
  PRIMARY KEY (formula_id, name)
);

-- Связи «что с чем взаимодействует». Один общий граф:
--   угроза  --detected_by-->  формула / контрмера
--   угроза  --mitigated_by--> контрмера
--   контрмера --uses-->       формула
--   контрмера --serves-->     цель
--   модуль  --feeds-->        модуль  (например, GNSS отдаёт инциденты в ситуационный центр)
--   группа спутников --monitored_by--> модуль
CREATE TABLE links (
  from_type  TEXT NOT NULL,   -- module | goal | threat | countermeasure | formula | sat_group | indicator
  from_id    TEXT NOT NULL,
  relation   TEXT NOT NULL,
  to_type    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  note_ru    TEXT,
  note_en    TEXT,
  PRIMARY KEY (from_type, from_id, relation, to_type, to_id)
);

-- Живые показатели безопасности, которые сайт реально вычисляет.
-- Здесь только описание и пороги; сами значения считаются в site/js/security.js.
CREATE TABLE indicators (
  id         TEXT PRIMARY KEY,
  module_id  TEXT NOT NULL REFERENCES modules(id),
  formula_id TEXT REFERENCES formulas(id),
  warn_at    REAL,
  alarm_at   REAL,
  unit       TEXT
);
CREATE TABLE indicator_texts (
  indicator_id  TEXT NOT NULL REFERENCES indicators(id),
  lang          TEXT NOT NULL,
  title         TEXT NOT NULL,
  how           TEXT NOT NULL,       -- как считается, человеческим языком
  PRIMARY KEY (indicator_id, lang)
);

-- ---------------------------------------------------------------------
--  2. Небо
-- ---------------------------------------------------------------------

CREATE TABLE constellations (
  id          TEXT PRIMARY KEY,      -- And, Ori …
  name_ru     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  ra_deg      REAL,                  -- центр подписи
  dec_deg     REAL,
  lines_json  TEXT                   -- [[[ra,dec],[ra,dec]…], …]
);

CREATE TABLE stars (
  id        INTEGER PRIMARY KEY,     -- id в каталоге HYG
  hip       INTEGER,
  hd        INTEGER,
  name_ru   TEXT,
  name_en   TEXT,
  bayer     TEXT,
  flam      TEXT,
  con       TEXT REFERENCES constellations(id),
  ra_deg    REAL NOT NULL,
  dec_deg   REAL NOT NULL,
  dist_pc   REAL,                    -- NULL, если расстояние неизвестно
  mag       REAL NOT NULL,           -- видимая звёздная величина
  absmag    REAL,
  spect     TEXT,                    -- спектральный класс
  ci        REAL,                    -- показатель цвета B–V
  lum       REAL                     -- светимость в солнечных
);
CREATE INDEX stars_mag ON stars(mag);
CREATE INDEX stars_name ON stars(name_ru, name_en);

-- Галактики, туманности, скопления
CREATE TABLE deep_sky (
  id        TEXT PRIMARY KEY,        -- M31, LMC …
  ngc       TEXT,
  kind      TEXT NOT NULL,           -- galaxy_spiral | galaxy_elliptical | galaxy_lenticular | galaxy_irregular
                                     -- | globular | open | planetary | nebula | snr | other
  name_ru   TEXT,
  name_en   TEXT,
  ra_deg    REAL NOT NULL,
  dec_deg   REAL NOT NULL,
  mag       REAL,
  size      TEXT,                    -- угловой размер, угл. минуты
  dist_ly   REAL,                    -- приблизительно
  morph     TEXT,                    -- морфология (SA(s)b и т.п.)
  con       TEXT
);

-- Солнце, планеты, Луна, карликовые планеты
CREATE TABLE bodies (
  id             TEXT PRIMARY KEY,   -- имя тела в astronomy-engine: Sun, Mercury … Pluto, Moon
  kind           TEXT NOT NULL,      -- star | planet | dwarf | moon
  name_ru        TEXT NOT NULL,
  name_en        TEXT NOT NULL,
  mass_kg        REAL,
  radius_km      REAL,
  gravity        REAL,               -- м/с²
  period_days    REAL,               -- сидерический период обращения
  day_hours      REAL,               -- период вращения (минус — обратное)
  a_au           REAL,               -- большая полуось
  ecc            REAL,
  incl_deg       REAL,
  moons          INTEGER,
  temp_c         REAL,               -- средняя температура поверхности / облаков
  color          TEXT,               -- цвет для 3D
  atmosphere_ru  TEXT,
  atmosphere_en  TEXT,
  fact_ru        TEXT,
  fact_en        TEXT
);

-- Группы спутников (как в CelesTrak) и их связь с модулями
CREATE TABLE sat_groups (
  id          TEXT PRIMARY KEY,      -- имя группы CelesTrak: stations, gps-ops …
  name_ru     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  purpose_ru  TEXT,
  purpose_en  TEXT,
  color       TEXT NOT NULL,
  max_count   INTEGER NOT NULL DEFAULT 200,  -- сколько объектов группы рисовать
  on_by_default INTEGER NOT NULL DEFAULT 1
);

-- Известные аппараты с описанием (остальные берутся из CelesTrak как есть)
CREATE TABLE satellites (
  norad       INTEGER PRIMARY KEY,
  group_id    TEXT REFERENCES sat_groups(id),
  name_ru     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  operator    TEXT,
  launched    TEXT,
  about_ru    TEXT,
  about_en    TEXT
);

-- ---------------------------------------------------------------------
--  3. LexiAI
-- ---------------------------------------------------------------------

-- Фрагменты знаний: на них LexiAI опирается в ответах (поиск по ключевым словам)
-- и из них же собирается обучающая выборка.
CREATE TABLE ai_knowledge (
  id      INTEGER PRIMARY KEY,
  lang    TEXT NOT NULL,
  kind    TEXT NOT NULL,             -- module | threat | countermeasure | formula | body | deep_sky | star | sat_group | indicator
  ref_id  TEXT NOT NULL,
  title   TEXT NOT NULL,
  body    TEXT NOT NULL
);
CREATE VIRTUAL TABLE ai_search USING fts4(title, body, tokenize=unicode61);

-- Разговорные слова → термины базы. Поиск LexiAI дописывает их к запросу,
-- чтобы «навигатор врёт» находил спуфинг, а «хакеры» — атаки.
-- word — начало слова (как его пишут люди), terms — через пробел.
CREATE TABLE ai_synonyms (
  lang   TEXT NOT NULL,
  word   TEXT NOT NULL,
  terms  TEXT NOT NULL,
  PRIMARY KEY (lang, word)
);

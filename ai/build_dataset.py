"""Обучающая выборка для LexiAI.

Всё берётся из той же базы, что и у сайта (site/data/lexi.sqlite): модули, цели, угрозы,
контрмеры, формулы, связи между ними, живые показатели, тела Солнечной системы, звёзды,
галактики и спутники. Из каждой сущности получаются несколько вопросов разными словами
и ответ, собранный из её полей и связей — так модель учится задачам LEXI: обнаружить угрозу,
назвать защиту, посчитать формулу, рассказать об объекте, честно сказать «не знаю».

Каждый пример — ровно тот запрос, который сайт отправит модели (ai/prompt.py): контекст
собирается тем же поиском, что на сайте (ai/retrieval.py), плюс живые данные и результат расчёта.

Запуск: python ai/build_dataset.py   →   ai/out/train.jsonl, ai/out/val.jsonl
"""

import json
import random
import sqlite3
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

from prompt import messages
from retrieval import search

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "ai" / "out"
DB = ROOT / "site" / "data" / "lexi.sqlite"
random.seed(42)

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
q = lambda sql, *p: [dict(r) for r in db.execute(sql, p)]
one = lambda sql, *p: (q(sql, *p) or [None])[0]

# Все фрагменты знаний по языкам — из них же ищет сайт
CHUNKS = defaultdict(list)
BY_REF = {}
for c in q("SELECT * FROM ai_knowledge"):
    CHUNKS[c["lang"]].append(c)
    BY_REF.setdefault((c["lang"], c["kind"], c["ref_id"]), []).append(c)

examples = []


def ctx(lang, question, targets, distractors=None):
    """Контекст как на сайте: что нашёл поиск по вопросу + нужные фрагменты (если поиск их пропустил).

    Так модель привыкает к настоящему контексту: иногда это ровно карточка угрозы,
    а иногда — общий раздел модуля, из которого ответ нужно собрать самой.
    """
    targets = [t for t in targets if t]
    if distractors is not None:          # для отказов — случайные посторонние фрагменты
        out = targets + random.sample(CHUNKS[lang], distractors)
        random.shuffle(out)
        return out
    out = list(targets)
    for f in search(db, question, lang, 4):
        if len(out) >= 4:
            break
        if all(f["title"] != t["title"] for t in out):
            out.append(f)
    random.shuffle(out)
    return out


def add(lang, question, answer, targets, live=None, calc=None, distractors=None, kind=""):
    examples.append({
        "kind": kind,
        "messages": messages(question, answer.strip(), ctx(lang, question, targets, distractors), live, calc, lang),
    })


def add_all(lang, questions, answer, targets, **kw):
    """Каждая формулировка вопроса — отдельный пример со своим контекстом."""
    for question in questions:
        add(lang, question, answer, targets, **kw)


def num(x, digits=0, lang="ru"):
    s = f"{x:,.{digits}f}".replace(",", " ")
    if digits:
        s = s.rstrip("0").rstrip(".")
    return s.replace(".", ",") if lang == "ru" else s.replace(" ", ",")


def join(items, lang):
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    last = " и " if lang == "ru" else " and "
    return ", ".join(items[:-1]) + last + items[-1]


UNIT_EN = {"км": "km", "м": "m", "с": "s", "мкс": "µs", "мин": "min", "лет": "yr", "сут": "d", "бит": "bits", "КБ": "KB",
           "Вт": "W", "дБ": "dB", "дБм": "dBm", "дБи": "dBi", "ГГц": "GHz", "МГц": "MHz", "Гц": "Hz", "м/с": "m/s", "км/с": "km/s",
           "дБ·Гц": "dB-Hz", "чип/с": "chip/s", "см²/бит": "cm²/bit", "см⁻²·с⁻¹": "cm⁻²·s⁻¹", "кг": "kg", "а.е.": "AU", "пк": "pc",
           "млн св. лет": "Mly"}
unit = lambda u, lang: (UNIT_EN.get(u, u) if lang == "en" else u) if u else ""
lower1 = lambda s: s[:1].lower() + s[1:] if s and not s[:2].isupper() else s
pick = random.choice


def title_of(kind, ref, lang):
    table = {"threat": ("threat_texts", "threat_id"), "countermeasure": ("countermeasure_texts", "countermeasure_id"),
             "formula": ("formula_texts", "formula_id"), "goal": ("goal_texts", "goal_id"),
             "indicator": ("indicator_texts", "indicator_id"), "module": ("module_texts", "module_id")}[kind]
    r = one(f"SELECT title FROM {table[0]} WHERE {table[1]} = ? AND lang = ?", ref, lang)
    return r["title"] if r else ref


def links_from(t, i, rel=None, to=None):
    return [l for l in q("SELECT * FROM links WHERE from_type = ? AND from_id = ?", t, i)
            if (rel is None or l["relation"] == rel) and (to is None or l["to_type"] == to)]


def links_to(t, i, rel=None, frm=None):
    return [l for l in q("SELECT * FROM links WHERE to_type = ? AND to_id = ?", t, i)
            if (rel is None or l["relation"] == rel) and (frm is None or l["from_type"] == frm)]


chunk = lambda lang, kind, ref: (BY_REF.get((lang, kind, ref)) or [None])[0]

# Разговорные названия угроз — люди редко спрашивают официальными терминами
ALIASES = {
    "t_spoofing": {"ru": ["спуфинг", "подмену координат", "подделку сигналов GNSS", "spoofing"], "en": ["spoofing", "GNSS spoofing", "fake navigation signals"]},
    "t_jamming": {"ru": ["глушение", "джамминг", "РЭБ-помехи", "глушилки GPS"], "en": ["jamming", "GPS jamming", "interference"]},
    "t_meaconing": {"ru": ["ретрансляцию сигнала", "meaconing", "переизлучение сигнала"], "en": ["meaconing", "signal replay", "rebroadcast attacks"]},
    "t_cmd_injection": {"ru": ["перехват управления спутником", "подделку телекоманд", "повтор телекоманд"], "en": ["command injection", "telecommand replay", "spacecraft hijacking"]},
    "t_fw_spoof": {"ru": ["подмену прошивки", "заражённую прошивку"], "en": ["firmware tampering", "malicious firmware"]},
    "t_sndl": {"ru": ["«сохрани сейчас — расшифруй потом»", "Store Now Decrypt Later", "запись трафика на будущее"], "en": ["store now decrypt later", "harvest now decrypt later"]},
    "t_shor": {"ru": ["алгоритм Шора", "квантовый взлом RSA"], "en": ["Shor's algorithm", "quantum attacks on RSA"]},
    "t_fault_injection": {"ru": ["сбои от радиации", "внесение сбоев", "одиночные сбои"], "en": ["fault injection", "radiation upsets", "single-event upsets"]},
    "t_space_weather": {"ru": ["магнитные бури", "космическую погоду"], "en": ["geomagnetic storms", "space weather"]},
    "t_time_attack": {"ru": ["атаки на время", "сдвиг времени GPS"], "en": ["timing attacks", "GPS time attacks"]},
    "t_isl_eaves": {"ru": ["прослушку межспутниковых каналов", "перехват межспутниковой связи"], "en": ["ISL eavesdropping", "inter-satellite link interception"]},
}

# Бытовые вопросы, за которыми стоит угроза: так люди спрашивают на самом деле
SITUATIONS = {
    "t_jamming": {"ru": ["Почему навигатор вдруг пропадает рядом с аэропортом?", "Почему GPS в телефоне перестал ловить возле границы?",
                         "Что значит, если пропали все спутники разом?"],
                  "en": ["Why does my GPS drop out near airports?", "Why did all satellites disappear from my receiver at once?"]},
    "t_spoofing": {"ru": ["Почему навигатор показывает, что я в аэропорту, хотя я дома?", "Почему навигатор в машине может врать возле границы?",
                          "Можно ли подделать мои координаты?", "Почему у корабля GPS показывает, что он на суше?"],
                   "en": ["Why would a ship's GPS show it on land?", "Can someone fake my GPS position?", "Why does my phone think I am at the airport?"]},
    "t_meaconing": {"ru": ["Может ли кто-то записать сигнал GPS и проиграть его позже?", "Почему часы приёмника вдруг скакнули?"],
                    "en": ["Can someone record a GPS signal and replay it later?", "Why did my receiver clock suddenly jump?"]},
    "t_time_attack": {"ru": ["Зачем банкам и энергосетям точное время со спутников?", "Чем опасен сдвиг времени на пару микросекунд?"],
                      "en": ["Why do banks and power grids need satellite time?", "What harm can a few microseconds of time shift do?"]},
    "t_navmsg_tamper": {"ru": ["Можно ли подменить эфемериды в навигационном сообщении?"], "en": ["Can the ephemerides in a navigation message be forged?"]},
    "t_space_weather": {"ru": ["Влияют ли солнечные вспышки на GPS?", "Почему во время магнитной бури навигация хуже?"],
                        "en": ["Do solar flares affect GPS?", "Why is navigation worse during a magnetic storm?"]},
    "t_cmd_injection": {"ru": ["Как спутник понимает, что команда пришла от своих, а не от хакеров?", "Может ли хакер развернуть чужой спутник?",
                               "Что будет, если кто-то повторит старую команду спутнику?"],
                        "en": ["How does a satellite know a command came from its own team?", "Could a hacker steer someone else's satellite?"]},
    "t_fw_spoof": {"ru": ["Можно ли залить на спутник заражённую прошивку?", "Зачем закрывать отладочный порт после сборки спутника?"],
                   "en": ["Can someone upload malicious firmware to a satellite?", "Why lock the debug port after building a satellite?"]},
    "t_isl_eaves": {"ru": ["Можно ли подслушать лазерную связь между спутниками Starlink?", "Зачем шифровать связь между спутниками, если она в космосе?"],
                    "en": ["Can laser links between Starlink satellites be intercepted?", "Why encrypt links between satellites in space?"]},
    "t_fault_injection": {"ru": ["Может ли радиация взломать спутник?", "Почему электроника на орбите сбоит?"],
                          "en": ["Can radiation break a satellite's security?", "Why does electronics glitch in orbit?"]},
    "t_supply_chain": {"ru": ["Можно ли заразить спутник ещё на Земле, при сборке?"], "en": ["Can a satellite be compromised on the ground, during the build?"]},
    "t_shor": {"ru": ["Чем постквантовое шифрование лучше обычного RSA?", "Правда ли, что квантовый компьютер взломает RSA?"],
               "en": ["Why is post-quantum crypto better than RSA?", "Is it true quantum computers will break RSA?"]},
    "t_grover": {"ru": ["Хватит ли AES-128, когда появятся квантовые компьютеры?"], "en": ["Will AES-128 be enough once quantum computers arrive?"]},
    "t_sndl": {"ru": ["Зачем переходить на постквантовое шифрование уже сейчас, если квантовых компьютеров ещё нет?", "Могут ли наши переписки расшифровать через 10 лет?"],
               "en": ["Why switch to post-quantum crypto now if quantum computers do not exist yet?", "Could our messages be decrypted in ten years?"]},
    "t_impl_attacks": {"ru": ["Если алгоритм стойкий, значит программа точно защищена?"], "en": ["If the algorithm is strong, is the software automatically secure?"]},
    "t_downgrade": {"ru": ["Можно ли заставить мессенджер отказаться от постквантовой защиты?"], "en": ["Can a messenger be forced to drop post-quantum protection?"]},
}


def threat_story(th, det, mit, lang, intro=True):
    """Связный ответ про угрозу — с разными оборотами, чтобы модель не заучивала одну фразу."""
    ru = lang == "ru"
    t = th["title"]
    parts = []
    if intro:
        parts.append(pick([f"Похоже на угрозу «{t}».", f"Скорее всего, дело в угрозе «{t}».", f"Это {lower1(t)}."] if ru else
                          [f"That sounds like {lower1(t)}.", f"Most likely it is {lower1(t)}.", f"This is {lower1(t)}."]))
    parts.append(th["body"])
    if th["signs"]:
        parts.append(pick([f"Выдают её такие признаки: {lower1(th['signs'])}", f"Заметить её можно так: {lower1(th['signs'])}"] if ru else
                          [f"Tell-tale signs: {lower1(th['signs'])}", f"You can spot it by this: {lower1(th['signs'])}"]))
    if det:
        parts.append(pick([f"В LEXI её ловят {join(det, lang)}.", f"Обнаруживают её {join(det, lang)}."] if ru else
                          [f"LEXI catches it with {join(det, lang)}.", f"It is detected by {join(det, lang)}."]))
    if mit:
        parts.append(pick([f"Защита — {join(mit, lang)}.", f"Закрывают её {join(mit, lang)}."] if ru else
                          [f"Protection: {join(mit, lang)}.", f"It is mitigated by {join(mit, lang)}."]))
    return " ".join(p if p.rstrip().endswith((".", "!", "?", "»")) else p.rstrip() + "." for p in parts)


# =====================================================================
#  1. Угрозы: что это, как обнаружить, как защититься, чем опасна, бытовые вопросы
# =====================================================================
for lang in ("ru", "en"):
    ru = lang == "ru"
    for th in q("SELECT t.*, x.title, x.body, x.signs FROM threats t JOIN threat_texts x ON x.threat_id = t.id AND x.lang = ?", lang):
        tid = th["id"]
        c = chunk(lang, "threat", tid)
        det = [title_of(l["to_type"], l["to_id"], lang) for l in links_from("threat", tid, "detected_by")]
        mit_ids = [l["to_id"] for l in links_from("threat", tid, "mitigated_by")]
        mit = [title_of("countermeasure", m, lang) for m in mit_ids]
        calc = [title_of("formula", l["to_id"], lang) for l in links_from("threat", tid, "quantified_by")]
        names = [lower1(th["title"])] + ALIASES.get(tid, {}).get(lang, [])
        module = title_of("module", th["module_id"], lang)
        sev = th["severity"]

        for name in names[:3]:
            # что это
            qs = [f"Что такое {name}?", f"Расскажи про {name}", f"Объясни, что значит {name}"] if ru else \
                 [f"What is {name}?", f"Tell me about {name}", f"Explain {name}"]
            for question in random.sample(qs, 2):
                ans = pick([f"{th['title']} — угроза из модуля «{module}». ", f"Это угроза из модуля «{module}». ", ""] if ru else
                           [f"{th['title']} is a threat from the “{module}” module. ", f"It is a threat covered by the “{module}” module. ", ""])
                add(lang, question, ans + threat_story(th, [], mit if random.random() < 0.5 else [], lang, intro=False), [c], kind="threat_what")

            # как обнаружить
            if det or th["signs"]:
                qs = [f"Как обнаружить {name}?", f"Как понять, что идёт {name}?", f"Как LEXI замечает {name}?"] if ru else \
                     [f"How do you detect {name}?", f"How can I tell {name} is happening?", f"How does LEXI notice {name}?"]
                for question in random.sample(qs, 2):
                    if ru:
                        ans = pick([f"Главное — признаки: {lower1(th['signs'] or '—')}", f"Выдают её признаки: {lower1(th['signs'] or '—')}",
                                    f"Смотрим на признаки: {lower1(th['signs'] or '—')}"])
                        if det:
                            ans += pick([f"\n\nВ LEXI для этого работают {join(det, lang)}.", f" Для обнаружения используются {join(det, lang)}."])
                        if mit:
                            ans += pick([f" Когда угроза подтверждена, её закрывают {join(mit, lang)}.", f" Дальше в дело идут {join(mit, lang)}."])
                    else:
                        ans = pick([f"Watch for the signs: {lower1(th['signs'] or '—')}", f"The giveaway signs: {lower1(th['signs'] or '—')}"])
                        if det:
                            ans += pick([f"\n\nLEXI detects it with {join(det, lang)}.", f" Detection relies on {join(det, lang)}."])
                        if mit:
                            ans += pick([f" Once confirmed, it is mitigated by {join(mit, lang)}.", f" Then {join(mit, lang)} take over."])
                    add(lang, question, ans, [c], kind="threat_detect")

            # как защититься
            if mit:
                qs = [f"Как защититься от угрозы «{th['title']}»?", f"Чем закрывается {name}?", f"Что делать против {name}?"] if ru else \
                     [f"How to protect against {name}?", f"What mitigates {name}?", f"What can be done against {name}?"]
                bodies = []
                for m in mit_ids:
                    cm = one("SELECT title, body FROM countermeasure_texts WHERE countermeasure_id = ? AND lang = ?", m, lang)
                    bodies.append(f"— {cm['title']}: {lower1(cm['body'])}")
                for question in random.sample(qs, 2):
                    ans = ((pick([f"Против угрозы «{th['title']}» в LEXI работают:\n", "Защита строится так:\n", "Помогает вот что:\n"]) if ru else
                            pick([f"Against “{th['title']}” LEXI uses:\n", "Protection works like this:\n", "What helps:\n"])) + "\n".join(bodies))
                    if calc:
                        ans += (f"\n\nОценить масштаб помогает расчёт: {join(calc, lang)}." if ru else f"\n\nIts scale is estimated with: {join(calc, lang)}.")
                    add(lang, question, ans, [c] + [chunk(lang, "countermeasure", m) for m in mit_ids[:1]], kind="threat_mitigate")

        # насколько опасна
        qs = [f"Насколько опасна угроза «{th['title']}»?", f"Чем опасна {names[-1]}?"] if ru else [f"How dangerous is {names[-1]}?", f"Why is {th['title']} a problem?"]
        level = {1: "низкая", 2: "умеренная", 3: "заметная", 4: "высокая", 5: "критическая"}[sev] if ru else \
                {1: "low", 2: "moderate", 3: "noticeable", 4: "high", 5: "critical"}[sev]
        ans = (f"Опасность {level} — {sev} из 5. {th['body']}" if ru else f"Severity is {level} — {sev} out of 5. {th['body']}")
        add_all(lang, qs, ans, [c], kind="threat_severity")

        # бытовые вопросы: поиск часто приносит общий раздел модуля — модель учится собирать ответ из него
        for question in SITUATIONS.get(tid, {}).get(lang, []):
            for _ in range(2):
                add(lang, question, threat_story(th, det, mit, lang), [c] if random.random() < 0.6 else [], kind="threat_situation")

# =====================================================================
#  2. Контрмеры: как работает, от чего защищает, какие формулы
# =====================================================================
for lang in ("ru", "en"):
    ru = lang == "ru"
    for cm in q("SELECT c.*, x.title, x.body FROM countermeasures c JOIN countermeasure_texts x ON x.countermeasure_id = c.id AND x.lang = ?", lang):
        cid = cm["id"]
        c = chunk(lang, "countermeasure", cid)
        covers = [title_of("threat", l["from_id"], lang) for l in links_to("countermeasure", cid, frm="threat")]
        uses = [title_of("formula", l["to_id"], lang) for l in links_from("countermeasure", cid, "uses", "formula")]
        serves = [title_of("goal", l["to_id"], lang) for l in links_from("countermeasure", cid, "serves", "goal")]
        qs = [f"Как работает {cm['title']}?", f"Что такое {cm['title']}?", f"Зачем нужен {cm['title']}?"] if ru else \
             [f"How does {cm['title']} work?", f"What is {cm['title']}?", f"Why do we need {cm['title']}?"]
        ans = cm["body"]
        if covers:
            ans += (f"\n\nЗакрывает угрозы: {join(sorted(set(covers)), lang)}." if ru else f"\n\nCovers threats: {join(sorted(set(covers)), lang)}.")
        if serves:
            ans += (f" Служит цели «{serves[0]}»." if ru else f" Serves the goal “{serves[0]}”.")
        for question in random.sample(qs, 2):
            add(lang, question, ans, [c], kind="cm_what")
        if uses:
            qs = [f"На какой математике держится {cm['title']}?", f"Какие формулы использует {cm['title']}?"] if ru else \
                 [f"What maths is behind {cm['title']}?", f"Which formulas does {cm['title']} use?"]
            ans = (f"{cm['title']} опирается на {join(uses, lang)}." if ru else f"{cm['title']} relies on {join(uses, lang)}.")
            add_all(lang, qs, ans, [c] + [chunk(lang, "formula", l["to_id"]) for l in links_from("countermeasure", cid, "uses", "formula")][:2], kind="cm_formulas")

# =====================================================================
#  3. Формулы: смысл, параметры и настоящие расчёты
# =====================================================================
calc_file = OUT / "calc.jsonl"
OUT.mkdir(parents=True, exist_ok=True)
with open(calc_file, "w", encoding="utf-8") as fh:
    subprocess.run(["node", "ai/calc_examples.mjs", "6"], cwd=ROOT, stdout=fh, check=True)
CALCS = [json.loads(l) for l in open(calc_file, encoding="utf-8")]

for lang in ("ru", "en"):
    ru = lang == "ru"
    for f in q("SELECT f.*, x.title, x.explanation FROM formulas f JOIN formula_texts x ON x.formula_id = f.id AND x.lang = ?", lang):
        c = chunk(lang, "formula", f["id"])
        params = q("SELECT * FROM formula_params WHERE formula_id = ? ORDER BY pos", f["id"])
        plist = "; ".join(f"{p['symbol']} — {(p['label_ru'] if ru else p['label_en']).lower()}" + (f", {unit(p['unit'], lang)}" if p["unit"] else "") for p in params)
        qs = [f"Что означает формула «{f['title']}»?", f"Объясни {lower1(f['title'])}", f"Как устроена формула {lower1(f['title'])}?"] if ru else \
             [f"What does the {f['title']} formula mean?", f"Explain {f['title']}", f"How does {f['title']} work?"]
        ans = f"{f['explanation']}\n\n{f['title']}: {f['latex']}"
        if plist:
            ans += (f"\nЗдесь {plist}." if ru else f"\nHere {plist}.")
        for question in random.sample(qs, 2):
            add(lang, question, ans, [c], kind="formula_what")
        users = [title_of(l["from_type"], l["from_id"], lang) for l in links_to("formula", f["id"])]
        if users:
            qs = [f"Где в LEXI применяется {lower1(f['title'])}?", f"Зачем LEXI {lower1(f['title'])}?"] if ru else [f"Where does LEXI use {f['title']}?", f"Why does LEXI need {f['title']}?"]
            ans = (f"{f['title']} работает в LEXI здесь: {join(sorted(set(users)), lang)}. {f['explanation']}" if ru else f"In LEXI, {f['title']} is used by: {join(sorted(set(users)), lang)}. {f['explanation']}")
            add_all(lang, qs, ans, [c], kind="formula_where")

for ex in CALCS:
    lang, ru = ex["lang"], ex["lang"] == "ru"
    c = chunk(lang, "formula", ex["formula_id"])
    vals = ", ".join(f"{p['label'].lower()} {num(p['value'], 6, lang)}{(' ' + p['unit']) if p['unit'] else ''}" for p in ex["params"])
    qs = [f"Посчитай {lower1(ex['title'])}: {vals}", f"Сколько получится по формуле «{ex['title']}», если {vals}?", f"Рассчитай {lower1(ex['title'])} для {vals}"] if ru else \
         [f"Calculate {ex['title']}: {vals}", f"What does {ex['title']} give for {vals}?", f"Compute {ex['title']} with {vals}"]
    lines = ex["lines"]
    ans = (f"По формуле «{ex['title']}»: {lines[0]}." if ru else f"Using {ex['title']}: {lines[0]}.")
    if len(lines) > 1:
        ans += " " + " ".join(l if l.endswith(".") else l + "." for l in lines[1:])
    add(lang, pick(qs), ans, [c], calc=ex["text"], kind="calc")

# =====================================================================
#  4. Модули, цели, живые показатели, связи между модулями
# =====================================================================
for lang in ("ru", "en"):
    ru = lang == "ru"
    for m in q("SELECT m.*, x.* FROM modules m JOIN module_texts x ON x.module_id = m.id AND x.lang = ?", lang):
        mod_chunks = BY_REF.get((lang, "module", m["module_id"]), [])
        goals = [r["title"] for r in q("SELECT x.title FROM goals g JOIN goal_texts x ON x.goal_id = g.id AND x.lang = ? WHERE g.module_id = ?", lang, m["module_id"])]
        ths = [r["title"] for r in q("SELECT x.title FROM threats t JOIN threat_texts x ON x.threat_id = t.id AND x.lang = ? WHERE t.module_id = ? ORDER BY t.severity DESC", lang, m["module_id"])]
        fs = [r["title"] for r in q("SELECT x.title FROM formulas f JOIN formula_texts x ON x.formula_id = f.id AND x.lang = ? WHERE f.module_id = ?", lang, m["module_id"])]
        qs = [f"Чем занимается модуль «{m['title']}»?", f"Расскажи про модуль {m['num']}", f"Зачем нужен модуль «{m['title']}»?"] if ru else \
             [f"What does the “{m['title']}” module do?", f"Tell me about module {m['num']}", f"Why is the “{m['title']}” module needed?"]
        ans = (f"{m['lead']}\n\nЕго цели: {join([lower1(g) for g in goals], lang)}." if ru else f"{m['lead']}\n\nIts goals: {join([lower1(g) for g in goals], lang)}.")
        lead_chunk = [c for c in mod_chunks if c["title"] == m["title"]]
        add_all(lang, qs, ans, lead_chunk, kind="module")
        qs = [f"Какие угрозы разбирает модуль «{m['title']}»?", f"От чего защищает модуль {m['num']}?"] if ru else [f"Which threats does module {m['num']} cover?", f"What does the “{m['title']}” module protect against?"]
        ans = (f"Модуль «{m['title']}» разбирает: {join(ths, lang)}." if ru else f"The “{m['title']}” module covers: {join(ths, lang)}.")
        add_all(lang, qs, ans, lead_chunk, kind="module_threats")
        qs = [f"Какие формулы есть в модуле {m['num']}?", f"На какой математике стоит модуль «{m['title']}»?"] if ru else [f"Which formulas are in module {m['num']}?", f"What maths underpins the “{m['title']}” module?"]
        ans = (f"В модуле «{m['title']}»: {join(fs, lang)}. Любую из них можно посчитать на экране «Модули»." if ru else f"The “{m['title']}” module has: {join(fs, lang)}. Any of them can be calculated on the Modules screen.")
        add_all(lang, qs, ans, lead_chunk, kind="module_formulas")

    for g in q("SELECT g.*, x.title, x.body FROM goals g JOIN goal_texts x ON x.goal_id = g.id AND x.lang = ?", lang):
        serving = [title_of("countermeasure", l["from_id"], lang) for l in links_to("goal", g["id"], "serves")]
        qs = [f"Как достигается цель «{g['title']}»?", f"Что значит «{lower1(g['title'])}»?"] if ru else [f"How is “{g['title']}” achieved?", f"What does “{g['title']}” mean?"]
        ans = g["body"] + ((f" Этой цели служат: {join(serving, lang)}." if ru else f" It is served by: {join(serving, lang)}.") if serving else "")
        # пункт цели в разделе модуля — по началу названия цели
        goal_item = [c for c in BY_REF.get((lang, "module", g["module_id"]), []) if g["title"][:18].lower() in c["title"].lower()][:1]
        add_all(lang, qs, ans, goal_item + [chunk(lang, "countermeasure", l["from_id"]) for l in links_to("goal", g["id"], "serves")][:1], kind="goal")

    for i in q("SELECT i.*, x.title, x.how FROM indicators i JOIN indicator_texts x ON x.indicator_id = i.id AND x.lang = ?", lang):
        c = chunk(lang, "indicator", i["id"])
        qs = [f"Как считается показатель «{i['title']}»?", f"Что показывает «{lower1(i['title'])}» в состоянии защиты?", f"Откуда берётся {lower1(i['title'])}?"] if ru else \
             [f"How is “{i['title']}” computed?", f"What does “{i['title']}” show in Protection status?", f"Where does {i['title']} come from?"]
        add_all(lang, qs, i["how"], [c], kind="indicator")

    for l in q("SELECT * FROM links WHERE from_type = 'module' AND to_type = 'module'"):
        a, b = title_of("module", l["from_id"], lang), title_of("module", l["to_id"], lang)
        note = l["note_ru"] if ru else l["note_en"]
        verb = {"protects": ("защищает", "protects"), "feeds": ("снабжает данными", "feeds")}[l["relation"]][0 if ru else 1]
        qs = [f"Как связаны модули «{a}» и «{b}»?", f"Что модуль «{a}» даёт модулю «{b}»?"] if ru else [f"How are “{a}” and “{b}” connected?", f"What does “{a}” give “{b}”?"]
        ans = (f"Модуль «{a}» {verb} модуль «{b}»: {lower1(note)}." if ru else f"“{a}” {verb} “{b}”: {lower1(note)}.")
        add_all(lang, qs, ans, BY_REF.get((lang, "module", l["from_id"]), [None])[:1] + BY_REF.get((lang, "module", l["to_id"]), [None])[:1], kind="module_link")

# =====================================================================
#  5. Небо: тела, звёзды, галактики, спутники — в том числе с живыми данными
# =====================================================================
CON = {r["id"]: r for r in q("SELECT * FROM constellations")}
AZ = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def az_text(az):
    return f"{az:.0f}° {AZ[round(az / 45) % 8]}"


def vis(alt, lang):
    if alt > 0:
        return f"над горизонтом, высота {alt:.0f}°" if lang == "ru" else f"above the horizon at {alt:.0f}°"
    return "под горизонтом" if lang == "ru" else "below the horizon"


for lang in ("ru", "en"):
    ru = lang == "ru"
    for b in q("SELECT * FROM bodies"):
        name = b["name_ru"] if ru else b["name_en"]
        c = chunk(lang, "body", b["id"])
        qs = [f"Расскажи про {name}", f"Что за планета {name}?" if b["kind"] == "planet" else f"Что такое {name}?", f"Интересный факт про {name}"] if ru else \
             [f"Tell me about {name}", f"What is {name} like?", f"An interesting fact about {name}"]
        add(lang, pick(qs), c["body"], [c], kind="body")
        if b["id"] in ("Earth", "Sun"):
            continue
        for _ in range(3):   # живые данные — разные моменты времени
            dist = random.uniform(0.4, 1.6) * (b["a_au"] if b["kind"] != "moon" else 0.00257) + (1 if b["kind"] not in ("moon",) else 0) * random.uniform(-0.3, 0.3)
            dist = abs(dist) + 0.0024
            km = dist * 1.495978707e8
            alt, az = random.uniform(-60, 70), random.uniform(0, 359)
            con = random.choice(list(CON.values()))
            con_name = con["name_ru"] if ru else con["name_en"]
            if ru:
                live = f"{name}: расстояние {num(dist, 3, lang)} а.е. ({num(km / 1e6, 1, lang)} млн км), свет идёт {num(km / 299792.458 / 60, 1, lang)} мин; {vis(alt, lang)}, азимут {az_text(az)}; созвездие {con_name}."
                qs = [f"Где сейчас {name}?", f"Видно ли сейчас {name}?", f"Как далеко сейчас {name}?"]
                ans = (f"{name} сейчас {vis(alt, lang)}, азимут {az_text(az)}, в созвездии {con_name}. " +
                       f"До неё {num(dist, 3, lang)} а.е. — свет идёт {num(km / 299792.458 / 60, 1, lang)} мин." +
                       (" Чтобы увидеть, нужно подождать восхода." if alt <= 0 else " Можно поискать на небе."))
            else:
                live = f"{name}: distance {num(dist, 3, lang)} AU ({num(km / 1e6, 1, lang)} M km), light takes {num(km / 299792.458 / 60, 1, lang)} min; {vis(alt, lang)}, azimuth {az_text(az)}; constellation {con_name}."
                qs = [f"Where is {name} now?", f"Can I see {name} right now?", f"How far is {name} now?"]
                ans = (f"{name} is now {vis(alt, lang)}, azimuth {az_text(az)}, in {con_name}. " +
                       f"It is {num(dist, 3, lang)} AU away — light takes {num(km / 299792.458 / 60, 1, lang)} min." +
                       (" Wait for it to rise to see it." if alt <= 0 else " You can look for it in the sky."))
            add(lang, pick(qs), ans, [c], live=live, kind="body_live")

    stars = q("SELECT * FROM stars WHERE name_en IS NOT NULL OR name_ru IS NOT NULL ORDER BY mag LIMIT 140")
    for s in stars:
        name = (s["name_ru"] if ru else s["name_en"]) or s["name_en"] or s["name_ru"]
        c = next((x for x in CHUNKS[lang] if x["kind"] == "star" and x["ref_id"] == str(s["id"])), None)
        if not c:
            continue
        qs = [f"Что за звезда {name}?", f"Расскажи про {name}", f"Как далеко {name}?"] if ru else [f"What star is {name}?", f"Tell me about {name}", f"How far away is {name}?"]
        add(lang, pick(qs), c["body"], [c], kind="star")
        if random.random() < 0.5:
            alt, az = random.uniform(-50, 80), random.uniform(0, 359)
            live = (f"{name} сейчас {vis(alt, lang)}, азимут {az_text(az)}." if ru else f"{name} is now {vis(alt, lang)}, azimuth {az_text(az)}.")
            qs = [f"Где сейчас {name}?", f"Видна ли сейчас {name}?"] if ru else [f"Where is {name} now?", f"Is {name} visible now?"]
            ans = live + ((" " + ("Чтобы найти её, ищите в созвездии " + CON[s["con"]]["name_ru"] + ".") if ru else (" Look for it in " + CON[s["con"]]["name_en"] + ".")) if s["con"] in CON and alt > 0 else "")
            add(lang, pick(qs), ans, [c], live=live, kind="star_live")

    for d in q("SELECT * FROM deep_sky"):
        c = chunk(lang, "deep_sky", d["id"])
        nm = (d["name_ru"] if ru else d["name_en"])
        label = f"{d['id']} ({nm})" if nm else d["id"]
        qs = [f"Что такое {d['id']}?", f"Расскажи про {nm or d['id']}", f"Как далеко {nm or d['id']}?"] if ru else \
             [f"What is {d['id']}?", f"Tell me about {nm or d['id']}", f"How far is {nm or d['id']}?"]
        add(lang, pick(qs), c["body"], [c], kind="dso")

    for s in q("SELECT * FROM satellites"):
        name = s["name_ru"] if ru else s["name_en"]
        c = chunk(lang, "satellite", str(s["norad"]))
        add(lang, (f"Что такое {name}?" if ru else f"What is {name}?"), c["body"], [c], kind="sat")
        for _ in range(4):
            alt_km = random.uniform(380, 440) if s["norad"] in (25544, 48274) else random.uniform(500, 900)
            lat, lon = random.uniform(-51.6, 51.6), random.uniform(-180, 180)
            speed, rng, el = random.uniform(7.4, 7.7), random.uniform(500, 12000), random.uniform(-80, 85)
            live = (f"{name}: широта {lat:.2f}°, долгота {lon:.2f}°, высота {num(alt_km, 0, lang)} км, скорость {num(speed, 2, lang)} км/с; от вас {num(rng, 0, lang)} км, {vis(el, lang)}." if ru else
                    f"{name}: latitude {lat:.2f}°, longitude {lon:.2f}°, altitude {num(alt_km, 0, lang)} km, speed {num(speed, 2, lang)} km/s; {num(rng, 0, lang)} km from you, {vis(el, lang)}.")
            qs = [f"Где сейчас {name}?", f"Над чем сейчас летит {name}?", f"Видно ли {name} отсюда?"] if ru else [f"Where is {name} now?", f"What is {name} flying over?", f"Can I see {name} from here?"]
            if ru:
                ans = (f"{name} сейчас на высоте {num(alt_km, 0, lang)} км над точкой {lat:.2f}° широты и {lon:.2f}° долготы, летит со скоростью {num(speed, 2, lang)} км/с. "
                       f"От вас до неё {num(rng, 0, lang)} км, {'она ' + vis(el, lang) + ' — можно поискать на небе' if el > 10 else 'сейчас она ' + vis(el, lang) if el <= 0 else 'она низко над горизонтом'}.")
            else:
                ans = (f"{name} is at {num(alt_km, 0, lang)} km above {lat:.2f}° latitude, {lon:.2f}° longitude, moving at {num(speed, 2, lang)} km/s. "
                       f"It is {num(rng, 0, lang)} km from you, {vis(el, lang) + ' — worth a look' if el > 10 else vis(el, lang) if el <= 0 else 'low over the horizon'}.")
            add(lang, pick(qs), ans, [c], live=live, kind="sat_live")

    for g in q("SELECT * FROM sat_groups"):
        name = g["name_ru"] if ru else g["name_en"]
        c = chunk(lang, "sat_group", g["id"])
        mods = [title_of("module", l["to_id"], lang) for l in links_from("sat_group", g["id"], "monitored_by")]
        qs = [f"Что за спутники {name}?", f"Зачем нужны {name}?"] if ru else [f"What are the {name} satellites?", f"What is {name} for?"]
        ans = c["body"] + ((f" За ними следит модуль «{mods[0]}»." if ru else f" They are watched by the “{mods[0]}” module.") if mods else "")
        add_all(lang, qs, ans, [c], kind="sat_group")

# =====================================================================
#  6. Честное «не знаю»
# =====================================================================
OFF_TOPIC = {
    "ru": ["Какой сегодня курс доллара?", "Как приготовить борщ?", "Кто выиграл чемпионат мира по футболу?", "Напиши стих про любовь",
           "Сколько стоит iPhone?", "Какая погода завтра в Сочи?", "Посоветуй сериал", "Как починить кран?", "Кто президент Бразилии?",
           "Переведи на китайский «привет»", "Как похудеть к лету?", "Какой пароль от Wi-Fi?"],
    "en": ["What is the dollar exchange rate today?", "How do I cook borscht?", "Who won the football World Cup?", "Write a love poem",
           "How much is an iPhone?", "What's the weather in Paris tomorrow?", "Recommend a TV series", "How do I fix a tap?",
           "Who is the president of Brazil?", "Translate hello into Chinese", "How to lose weight by summer?", "What is the Wi-Fi password?"],
}
REFUSE = {
    "ru": ["В базе LEXI об этом ничего нет. Я отвечаю про ситуационный центр: угрозы и защиту космической инфраструктуры, формулы, спутники и небесные объекты.",
           "Этого в контексте нет, поэтому не буду выдумывать. Спросите меня про спутники, планеты, звёзды или модули LEXI — тут помогу.",
           "Не знаю: такого в базе LEXI нет. Зато могу рассказать, где сейчас МКС, или посчитать формулу из модулей."],
    "en": ["There is nothing about this in the LEXI base. I answer about the situation center: threats and protection of space infrastructure, formulas, satellites and celestial objects.",
           "That is not in the context, so I won't make it up. Ask me about satellites, planets, stars or the LEXI modules — I can help there.",
           "I don't know: the LEXI base has nothing on it. I can tell you where the ISS is now, or calculate a formula from the modules."],
}
# Похоже на тему LEXI, но в базе этого нет — тоже честно говорим, что не знаем
NEAR_TOPIC = {
    "ru": ["Сколько стоит запуск Falcon 9?", "Когда люди полетят на Марс?", "Сколько всего спутников у Starlink прямо сейчас?",
           "Кто изобрёл GPS?", "Какая зарплата у космонавта?", "Когда следующий запуск с Байконура?"],
    "en": ["How much does a Falcon 9 launch cost?", "When will people fly to Mars?", "Who invented GPS?",
           "What is an astronaut's salary?", "When is the next launch from Baikonur?"],
}
for lang in ("ru", "en"):
    for qq in OFF_TOPIC[lang]:
        for _ in range(4):
            add(lang, qq, pick(REFUSE[lang]), [], distractors=random.choice([0, 2, 3]), kind="refuse")
    for qq in NEAR_TOPIC[lang]:
        for _ in range(2):
            add(lang, qq, pick(REFUSE[lang]), [], kind="refuse_near")    # контекст — что нашёл поиск, но ответа в нём нет

# =====================================================================
#  Сохранение
# =====================================================================
random.shuffle(examples)
n_val = max(40, len(examples) // 25)
val, train = examples[:n_val], examples[n_val:]
for name, rows in (("train", train), ("val", val)):
    with open(OUT / f"{name}.jsonl", "w", encoding="utf-8") as fh:
        for ex in rows:
            fh.write(json.dumps(ex, ensure_ascii=False) + "\n")

stats = defaultdict(int)
for ex in examples:
    stats[ex["kind"]] += 1
print(f"Примеров: {len(examples)} (обучение {len(train)}, проверка {len(val)})")
for k, v in sorted(stats.items(), key=lambda x: -x[1]):
    print(f"  {k:18} {v}")

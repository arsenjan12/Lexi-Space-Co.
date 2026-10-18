"""Поиск фрагментов знаний — копия searchKnowledge из site/js/db.js.

Нужен в двух местах: smoke_test.py (проверка модели) и build_dataset.py (обучающие примеры
получают тот же контекст, что модель увидит на сайте). Меняете поиск на сайте — меняйте и здесь.
"""

import math
import re
import struct

STOP = set(("один два три четыре пять как что где когда сейчас такое это для про под над при или ли чем чего кто какой какая какие сколько можно нужно "
            "расскажи покажи посчитай рассчитай объясни скажи лет год года раз мне нам вас есть был была будет "
            "the what where when how is are of for to in on and or now tell me about show calculate explain does do why which with").split())


def search(db, query, lang, limit=4):
    """То же, что searchKnowledge в site/js/db.js."""
    words = [w for w in re.findall(r"\w{3,}", query.lower()) if w not in STOP and not w.isdigit()]
    if not words:
        return []
    stem = lambda w: w[:max(4, len(w) - 2)] if len(w) > 5 else w
    syn = db.execute("SELECT word, terms FROM ai_synonyms WHERE lang = ?", (lang,)).fetchall()
    extra = [t for w in words for word, terms in syn if w.startswith(word) for t in re.findall(r"\w{2,}", terms.lower())]
    words = list(dict.fromkeys(words + extra))
    match = " OR ".join(f"{stem(w)}*" if len(w) >= 4 else w for w in words)   # короткие слова — целиком
    rows = db.execute("""SELECT k.title, k.body, matchinfo(ai_search, 'pcnx') FROM ai_search s JOIN ai_knowledge k ON k.id = s.rowid
                         WHERE ai_search MATCH ? AND k.lang = ?""", (match, lang)).fetchall()
    scored = []
    for title, body, mi in rows:
        m = struct.unpack(f"{len(mi) // 4}I", mi)
        phrases, cols, total = m[0], m[1], m[2]
        s = 0.0
        for p_ in range(phrases):
            for c in range(cols):
                i = 3 + 3 * (p_ * cols + c)
                if m[i]:
                    s += (3 if c == 0 else 1) * min(m[i], 3) * math.log(1 + total / max(m[i + 2], 1))
        s += sum(6 for w in words if w[:5] in title.lower())
        scored.append((s, title, body))
    scored.sort(key=lambda x: -x[0])
    if not scored:
        return []
    top = scored[0][0]
    return [{"title": t, "body": b} for s, t, b in scored if s >= top * 0.45][:limit]

"""Формат запроса к LexiAI.

Должен совпадать с site/js/lexiai.js (SYSTEM и buildUserMessage): модель учится
ровно на том виде запроса, который потом увидит в браузере. Меняете здесь — меняйте и там.
"""

SYSTEM = {
    "ru": "Ты — LexiAI, ассистент ситуационного центра LEXI Space. Отвечай по-русски, коротко и по делу, "
          "человеческим языком. Опирайся только на контекст: фрагменты базы LEXI, живые данные и результаты "
          "расчётов. Числа бери из контекста и не выдумывай. Если в контексте ответа нет — честно скажи об этом.",
    "en": "You are LexiAI, the assistant of the LEXI Space situation center. Answer in English, briefly and to "
          "the point, in plain human language. Rely only on the context: LEXI knowledge-base fragments, live data "
          "and calculation results. Take numbers from the context and never invent them. If the context has no "
          "answer, say so honestly.",
}


CLIP = 700   # символов на фрагмент: 4 фрагмента + вопрос помещаются в окно модели (2048 токенов)


def clip(text, limit=CLIP):
    """Обрезка по границе предложения — так же, как clip() в site/js/lexiai.js."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(m) for m in (". ", ".\n", "; ", "!\n", "?\n"))
    if end > limit * 0.5:
        return cut[:end + 1].rstrip() + " …"
    return cut[:cut.rfind(" ")].rstrip() + " …"


def build_user_message(question, chunks, live=None, calc=None, lang="ru"):
    ru = lang == "ru"
    parts = []
    if chunks:
        lines = [f"[{i + 1}] {c['title']}: {clip(c['body'])}" for i, c in enumerate(chunks)]
        parts.append(("Контекст:\n" if ru else "Context:\n") + "\n".join(lines))
    if live:
        parts.append(("Данные сейчас: " if ru else "Live data: ") + live)
    if calc:
        parts.append(("Расчёт: " if ru else "Calculation: ") + calc)
    parts.append(("Вопрос: " if ru else "Question: ") + question)
    return "\n\n".join(parts)


def messages(question, answer, chunks, live=None, calc=None, lang="ru"):
    return [
        {"role": "system", "content": SYSTEM[lang]},
        {"role": "user", "content": build_user_message(question, chunks, live, calc, lang)},
        {"role": "assistant", "content": answer},
    ]

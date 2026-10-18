"""Живая проверка LexiAI на вопросах, которых нет в обучающей выборке.

Контекст собирается тем же поиском, что на сайте (FTS4 по ai_knowledge, те же стоп-слова
и обрезка окончаний), так что это честная репетиция того, что увидит пользователь.

    ai\\.venv\\Scripts\\python ai\\smoke_test.py                                   # ai/out/merged
    ai\\.venv\\Scripts\\python ai\\smoke_test.py --adapter ai/out/checkpoints/checkpoint-170
    ai\\.venv\\Scripts\\python ai\\smoke_test.py --base                            # исходная Qwen для сравнения
"""

import argparse
import sqlite3
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from prompt import SYSTEM, build_user_message
from retrieval import search

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "ai/cache/Qwen2.5-1.5B-Instruct"

QUESTIONS = [
    ("ru", "Почему навигатор в машине может врать рядом с аэропортом или границей?"),
    ("ru", "Как спутник понимает, что команда пришла от своих, а не от хакеров?"),
    ("ru", "Зачем хранить на спутнике три копии одной переменной?"),
    ("ru", "Чем постквантовое шифрование лучше обычного RSA?"),
    ("ru", "Если данные должны быть секретны 30 лет, а квантовый компьютер появится через 10, что делать?"),
    ("ru", "Можно ли подслушать лазерную связь между спутниками Starlink?"),
    ("ru", "Что за яркая звезда Вега?"),
    ("ru", "Сколько стоит биткоин?"),
    ("en", "Why would a ship's GPS suddenly show it on land?"),
    ("en", "What protects LEXI's server data from being forged?"),
    ("en", "Is the Andromeda galaxy far away?"),
]

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--adapter")
    p.add_argument("--base", action="store_true")
    args = p.parse_args()

    if args.base or args.adapter:
        path = BASE
    else:
        path = ROOT / "ai/out/merged"
    tok = AutoTokenizer.from_pretrained(path)
    model = AutoModelForCausalLM.from_pretrained(
        path, device_map={"": 0},
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16))
    if args.adapter:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()

    db = sqlite3.connect(ROOT / "site/data/lexi.sqlite")
    for lang, question in QUESTIONS:
        chunks = search(db, question, lang)
        msgs = [{"role": "system", "content": SYSTEM[lang]},
                {"role": "user", "content": build_user_message(question, chunks, lang=lang)}]
        ids = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(ids, max_new_tokens=220, do_sample=False, repetition_penalty=1.1)
        answer = tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True).strip()
        print(f"\n### {question}\n[контекст: {'; '.join(c['title'] for c in chunks) or '—'}]\n{answer}")


if __name__ == "__main__":
    main()

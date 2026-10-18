"""Проверка LexiAI после обучения: прогоняем отложенные вопросы через модель
и сравниваем с эталоном — совпадают ли ключевые числа и названия.

    ai\\.venv\\Scripts\\python ai\\evaluate.py               # дообученная модель (ai/out/merged)
    ai\\.venv\\Scripts\\python ai\\evaluate.py --base        # для сравнения — исходная Qwen
"""

import argparse
import json
import re
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser()
p.add_argument("--base", action="store_true")
p.add_argument("-n", type=int, default=40)
args = p.parse_args()

path = ROOT / ("ai/cache/Qwen2.5-1.5B-Instruct" if args.base else "ai/out/merged")
tok = AutoTokenizer.from_pretrained(path)
model = AutoModelForCausalLM.from_pretrained(path, torch_dtype=torch.float16, device_map={"": 0} if torch.cuda.is_available() else None)
model.eval()

rows = [json.loads(line) for line in open(ROOT / "ai/out/val.jsonl", encoding="utf-8")][: args.n]


def keys(text):
    """Что должно совпасть: числа и слова с заглавной буквы (названия)."""
    nums = set(re.findall(r"\d+(?:[.,]\d+)?", text))
    names = set(re.findall(r"\b[A-ZА-ЯЁ][\w-]{2,}", text))
    return nums | names


score, total = 0.0, 0
for ex in rows:
    msgs = ex["messages"]
    ids = tok.apply_chat_template(msgs[:-1], add_generation_prompt=True, return_tensors="pt").to(model.device)
    with torch.no_grad():
        gen = model.generate(ids, max_new_tokens=220, do_sample=False, repetition_penalty=1.1)
    answer = tok.decode(gen[0, ids.shape[1]:], skip_special_tokens=True).strip()
    want = keys(msgs[-1]["content"])
    hit = len(want & keys(answer)) / max(1, len(want))
    score += hit
    total += 1
    question = msgs[1]["content"].rsplit("\n", 1)[-1]
    print(f"\n[{ex['kind']}] {question}\n→ {answer[:400]}\n  совпадение ключевых фактов: {hit:.0%}")

print(f"\nИтого: {score / max(1, total):.0%} ключевых фактов на {total} вопросах ({path.name})")

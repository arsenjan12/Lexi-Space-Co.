"""Дообучение LexiAI на видеокарте с 6 ГБ памяти (RTX 3060 Laptop).

Метод — QLoRA: базовая модель загружается в 4 битах и не меняется, обучаются только
небольшие LoRA-матрицы поверх неё. Так модель на 1,5 млрд параметров помещается в 6 ГБ.
Потеря считается только по ответу ассистента — вопрос и контекст модель не «зубрит».

Запуск:
    ai\\.venv\\Scripts\\python ai\\train.py                    # обучить
    ai\\.venv\\Scripts\\python ai\\train.py --merge-only       # только склеить готовый LoRA с базой

Результат: ai/out/lora (адаптер) и ai/out/merged (полная модель для экспорта в GGUF).
"""

import argparse
import json
import math
import time
import warnings
from pathlib import Path

import torch
from peft import LoraConfig, PeftModel, get_peft_model
from transformers import (AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, Trainer,
                          TrainerCallback, TrainingArguments)

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

ROOT = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser()
p.add_argument("--base", default=str(ROOT / "ai/cache/Qwen2.5-1.5B-Instruct"))
p.add_argument("--data", default=str(ROOT / "ai/out"))
p.add_argument("--out", default=str(ROOT / "ai/out"))
# Одна эпоха с lr 1e-4: модель запоминает факты LEXI, но не превращается в попугая шаблонов (см. README)
p.add_argument("--epochs", type=float, default=1)
p.add_argument("--lr", type=float, default=1e-4)
p.add_argument("--rank", type=int, default=16)
# 6 ГБ видеопамяти: батч 1 × накопление 16 (как 2 × 8, но логиты по словарю 152 тыс. токенов вдвое меньше)
p.add_argument("--batch", type=int, default=1)
p.add_argument("--accum", type=int, default=16)
p.add_argument("--max-len", type=int, default=1152)
p.add_argument("--merge-only", action="store_true")
args = p.parse_args()

out = Path(args.out)
lora_dir, merged_dir = out / "lora", out / "merged"


# ---------------------------------------------------------------------
#  Данные: токенизируем диалог, маскируем всё, кроме ответа
# ---------------------------------------------------------------------
def load_jsonl(path):
    return [json.loads(line) for line in open(path, encoding="utf-8")]


def encode(tok, ex):
    msgs = ex["messages"]
    prompt = tok.apply_chat_template(msgs[:-1], add_generation_prompt=True, tokenize=True)
    full = tok.apply_chat_template(msgs, tokenize=True)
    if full[:len(prompt)] != prompt:          # шаблон чата должен давать общий префикс
        return None
    if len(full) > args.max_len:
        return None
    return {"input_ids": full, "labels": [-100] * len(prompt) + full[len(prompt):]}


class Collator:
    def __init__(self, pad_id):
        self.pad_id = pad_id

    def __call__(self, batch):
        n = max(len(b["input_ids"]) for b in batch)
        ids = torch.full((len(batch), n), self.pad_id, dtype=torch.long)
        labels = torch.full((len(batch), n), -100, dtype=torch.long)
        mask = torch.zeros((len(batch), n), dtype=torch.long)
        for i, b in enumerate(batch):
            k = len(b["input_ids"])
            ids[i, :k] = torch.tensor(b["input_ids"])
            labels[i, :k] = torch.tensor(b["labels"])
            mask[i, :k] = 1
        return {"input_ids": ids, "labels": labels, "attention_mask": mask}


class ListDataset(torch.utils.data.Dataset):
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        return self.rows[i]


class Progress(TrainerCallback):
    """Короткий человеческий лог: шаг, потеря, сколько осталось."""

    def on_train_begin(self, a, state, control, **kw):
        self.t0 = time.time()

    def on_log(self, a, state, control, logs=None, **kw):
        if not logs:
            return
        done = state.global_step / max(1, state.max_steps)
        eta = (time.time() - self.t0) / max(done, 1e-6) * (1 - done)
        parts = [f"шаг {state.global_step}/{state.max_steps}"]
        if "loss" in logs:
            parts.append(f"loss {logs['loss']:.3f}")
        if "eval_loss" in logs:
            parts.append(f"eval_loss {logs['eval_loss']:.3f}")
        parts.append(f"осталось ~{eta / 60:.0f} мин")
        if torch.cuda.is_available():
            parts.append(f"VRAM {torch.cuda.max_memory_allocated() / 2**30:.1f} ГБ")
        print(" · ".join(parts), flush=True)


# ---------------------------------------------------------------------
#  Обучение
# ---------------------------------------------------------------------
def train():
    assert torch.cuda.is_available(), "Нужна видеокарта с CUDA (проверьте драйвер и сборку PyTorch с cu124)"
    print(f"GPU: {torch.cuda.get_device_name(0)}, {torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} ГБ")
    tok = AutoTokenizer.from_pretrained(args.base)
    tok.pad_token = tok.pad_token or tok.eos_token

    train_rows = [e for e in (encode(tok, x) for x in load_jsonl(Path(args.data) / "train.jsonl")) if e]
    val_rows = [e for e in (encode(tok, x) for x in load_jsonl(Path(args.data) / "val.jsonl")) if e]
    lens = sorted(len(r["input_ids"]) for r in train_rows)
    print(f"Примеров: {len(train_rows)} обучение, {len(val_rows)} проверка; длина медиана {lens[len(lens) // 2]}, максимум {lens[-1]} токенов")

    bf16 = torch.cuda.is_bf16_supported()
    model = AutoModelForCausalLM.from_pretrained(
        args.base,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16 if bf16 else torch.float16),
        torch_dtype=torch.bfloat16 if bf16 else torch.float16,
        device_map={"": 0},
        attn_implementation="sdpa",
    )
    # Вместо prepare_model_for_kbit_training: она переводит эмбеддинги (233 млн параметров) во float32
    # и съедает лишний гигабайт — на 6 ГБ из-за этого Windows начинает выгружать память в ОЗУ.
    model.config.use_cache = False
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
    model.print_trainable_parameters()

    steps_per_epoch = math.ceil(len(train_rows) / (args.batch * args.accum))
    trainer = Trainer(
        model=model,
        args=TrainingArguments(
            output_dir=str(out / "checkpoints"),
            num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch,
            per_device_eval_batch_size=args.batch,
            gradient_accumulation_steps=args.accum,
            learning_rate=args.lr,
            lr_scheduler_type="cosine",
            warmup_ratio=0.03,
            weight_decay=0.0,
            logging_steps=10,
            eval_strategy="steps",
            eval_steps=max(20, steps_per_epoch // 2),
            save_strategy="steps",
            save_steps=max(20, steps_per_epoch // 2),
            save_total_limit=2,
            bf16=bf16,
            fp16=not bf16,
            optim="paged_adamw_8bit",
            gradient_checkpointing=True,
            gradient_checkpointing_kwargs={"use_reentrant": False},
            group_by_length=True,
            dataloader_num_workers=0,
            report_to="none",
            disable_tqdm=True,
            remove_unused_columns=False,
        ),
        train_dataset=ListDataset(train_rows),
        eval_dataset=ListDataset(val_rows),
        data_collator=Collator(tok.pad_token_id),
        callbacks=[Progress()],
    )
    trainer.train()
    model.save_pretrained(lora_dir)
    tok.save_pretrained(lora_dir)
    print(f"LoRA сохранён: {lora_dir}")
    del model, trainer
    torch.cuda.empty_cache()


# ---------------------------------------------------------------------
#  Склейка LoRA с базой → полная модель для GGUF
# ---------------------------------------------------------------------
def merge():
    print("Склеиваем LoRA с базовой моделью…")
    base = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=torch.float16, device_map={"": "cpu"})
    model = PeftModel.from_pretrained(base, lora_dir).merge_and_unload()
    model.save_pretrained(merged_dir, safe_serialization=True)
    AutoTokenizer.from_pretrained(lora_dir).save_pretrained(merged_dir)
    print(f"Готово: {merged_dir}")


if __name__ == "__main__":
    if not args.merge_only:
        train()
    merge()

"""Экспорт обученной LexiAI в формат GGUF для браузера.

Шаги:
  1. скачать llama.cpp (скрипт конвертации и готовые программы для Windows) — один раз;
  2. ai/out/merged → GGUF f16;
  3. сжать до Q5_K_M (≈ 1,1 ГБ для 1,5B; можно --quant Q4_K_M — 0,94 ГБ);
  4. порезать на куски по 95 МБ — так их спокойно отдаёт Netlify и браузер качает их параллельно;
  5. положить в site/models/ и записать site/data/ai-model.json — сайт подхватит модель сам.

Запуск: ai\\.venv\\Scripts\\python ai\\export_gguf.py
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "ai/cache"
OUT = ROOT / "ai/out"
MODELS = ROOT / "site/models"


def fetch(url, dest):
    if dest.exists():
        return dest
    print(f"  скачиваю {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "lexi-space"})) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    tmp.rename(dest)
    return dest


def llama_cpp():
    """Свежая сборка llama.cpp (теги bNNNN): исходники для конвертера и программы под Windows."""
    releases = json.load(urllib.request.urlopen("https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30"))
    # «latest» у llama.cpp бывает служебным релизом без программ — берём первый, где есть сборка win-cpu-x64
    info = next(r for r in releases if any(re.search(r"bin-win-cpu-x64\.zip$", a["name"]) for a in r["assets"]))
    tag = info["tag_name"]
    src, bin_dir = CACHE / f"llama.cpp-{tag}", CACHE / f"llama.cpp-{tag}-bin"
    if not src.exists():
        tgz = fetch(f"https://codeload.github.com/ggml-org/llama.cpp/tar.gz/refs/tags/{tag}", CACHE / f"llama.cpp-{tag}.tar.gz")
        with tarfile.open(tgz) as t:
            t.extractall(CACHE, filter="data")
    if not bin_dir.exists():
        asset = next(a for a in info["assets"] if re.search(r"bin-win-cpu-x64\.zip$", a["name"]))
        z = fetch(asset["browser_download_url"], CACHE / asset["name"])
        zipfile.ZipFile(z).extractall(bin_dir)
    exe = lambda name: next(bin_dir.rglob(f"{name}.exe"))
    return tag, src, exe("llama-quantize"), exe("llama-gguf-split")


def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merged", default=str(OUT / "merged"), help="папка склеенной модели")
    # Q5_K_M: на ~17 % больше Q4_K_M, но маленькая модель заметно реже путает названия
    ap.add_argument("--quant", default="Q5_K_M")
    args = ap.parse_args()
    NAME = f"lexi-ai-1.5b-{args.quant.lower()}"
    merged = Path(args.merged)
    if not (merged / "config.json").exists():
        sys.exit("Нет ai/out/merged — сначала обучите модель: ai\\.venv\\Scripts\\python ai\\train.py")
    CACHE.mkdir(parents=True, exist_ok=True)

    print("1. llama.cpp")
    tag, src, quantize, split = llama_cpp()

    print("2. HF → GGUF f16")
    f16 = OUT / "lexi-ai-1.5b-f16.gguf"
    env = {**__import__("os").environ, "PYTHONPATH": str(src / "gguf-py"), "PYTHONIOENCODING": "utf-8"}
    run([sys.executable, src / "convert_hf_to_gguf.py", merged, "--outfile", f16, "--outtype", "f16"], env=env)

    print(f"3. Сжатие {args.quant}")
    q4 = OUT / f"{NAME}.gguf"
    run([quantize, f16, q4, args.quant])

    print("4. Нарезка на куски по 95 МБ")
    MODELS.mkdir(parents=True, exist_ok=True)
    for old in MODELS.glob("lexi-ai-*.gguf"):
        old.unlink()
    run([split, "--split", "--split-max-size", "95M", q4, MODELS / NAME])
    parts = sorted(MODELS.glob(f"{NAME}-*.gguf"))

    size_mb = round(q4.stat().st_size / 2**20)
    (ROOT / "site/data/ai-model.json").write_text(json.dumps({
        "name": "LexiAI 1.5B",
        "url": f"models/{parts[0].name}",
        "parts": len(parts),
        "sizeMB": size_mb,
        "base": "Qwen2.5-1.5B-Instruct",
        "method": "QLoRA, обучено на базе LEXI Space",
        "quant": args.quant,
        "llama_cpp": tag,
        "trained": date.today().isoformat(),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Готово: {len(parts)} файлов в site/models, {size_mb} МБ. Сайт подхватит модель из site/data/ai-model.json")


if __name__ == "__main__":
    main()

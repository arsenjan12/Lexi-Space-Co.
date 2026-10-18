// Скачивает файлы модели LexiAI из GitHub Releases в site/models.
//
// Браузер не может брать их с GitHub напрямую (GitHub не отдаёт заголовок CORS),
// поэтому модель скачивает Netlify во время сборки и раздаёт вместе с сайтом.
// Какие файлы и из какого релиза — в site/data/ai-model.json (поле release).
//
// Запуск: node scripts/fetch-model.mjs   (Netlify делает это сам, см. netlify.toml)

import { readFileSync, existsSync, mkdirSync, statSync, createWriteStream, renameSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const info = JSON.parse(readFileSync('site/data/ai-model.json', 'utf8'));
const rel = info.release;
if (!rel) {
  console.log('fetch-model: в ai-model.json нет поля release — пропускаю');
  process.exit(0);
}

mkdirSync('site/models', { recursive: true });
for (const file of rel.files) {
  const dest = `site/models/${file.name}`;
  if (existsSync(dest) && statSync(dest).size === file.size) {
    console.log(`есть    ${file.name}`);
    continue;
  }
  const url = `https://github.com/${rel.repo}/releases/download/${rel.tag}/${file.name}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest + '.part'));
      if (statSync(dest + '.part').size !== file.size) throw new Error('размер не совпал');
      renameSync(dest + '.part', dest);
      console.log(`скачан  ${file.name}`);
      break;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${file.name}: ${e.message}`);
      console.log(`повтор  ${file.name}: ${e.message}`);
    }
  }
}
console.log(`fetch-model: готово, ${rel.files.length} файлов из ${rel.repo}@${rel.tag}`);

// Создаёт ключи постквантовой подписи ML-DSA-65 для сервера LEXI Space.
//   открытый ключ  → site/data/pq-public.json (публикуется вместе с сайтом)
//   секретное зерно → .env (LEXI_PQ_SEED) — его же нужно добавить в Netlify:
//                     Site configuration → Environment variables → LEXI_PQ_SEED
// Запуск: npm run keys   (повторный запуск создаст НОВУЮ пару — старые подписи перестанут проверяться)

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';

if (existsSync('.env') && /LEXI_PQ_SEED=/.test(readFileSync('.env', 'utf8')) && !process.argv.includes('--force')) {
  console.log('Ключ уже есть в .env. Чтобы создать новый: npm run keys -- --force');
  process.exit(0);
}

const seed = randomBytes(32);
const { publicKey } = ml_dsa65.keygen(new Uint8Array(seed));
const kid = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);

writeFileSync('site/data/pq-public.json', JSON.stringify({
  alg: 'ML-DSA-65', standard: 'FIPS 204', kid,
  publicKey: Buffer.from(publicKey).toString('base64'),
  created: new Date().toISOString(),
}, null, 2) + '\n');

const env = existsSync('.env') ? readFileSync('.env', 'utf8').replace(/^LEXI_PQ_SEED=.*\n?/m, '') : '';
writeFileSync('.env', env + `LEXI_PQ_SEED=${seed.toString('hex')}\n`);

console.log(`Готово. kid = ${kid}`);
console.log('Добавьте в Netlify переменную окружения LEXI_PQ_SEED из файла .env (файл не публикуйте).');

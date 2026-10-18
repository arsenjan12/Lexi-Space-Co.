// Подпись ответов сервера постквантовой подписью ML-DSA-65 (FIPS 204).
// Секретный ключ не хранится: он каждый раз выводится из 32-байтного зерна LEXI_PQ_SEED.

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { createHash } from 'node:crypto';

let keys = null;
function getKeys() {
  if (keys) return keys;
  const hex = process.env.LEXI_PQ_SEED;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) return null;
  const pair = ml_dsa65.keygen(new Uint8Array(Buffer.from(hex, 'hex')));
  keys = { ...pair, kid: createHash('sha256').update(pair.publicKey).digest('hex').slice(0, 16) };
  return keys;
}

// Подписываем ровно ту строку, которую отдаём, — браузер проверяет её же
export function signedResponse(payload, { cdnSeconds = 600, vary } = {}) {
  const text = JSON.stringify(payload);
  const k = getKeys();
  const body = k
    ? { alg: 'ML-DSA-65', kid: k.kid, payload: text, sig: Buffer.from(ml_dsa65.sign(k.secretKey, new TextEncoder().encode(text))).toString('base64') }
    : { alg: 'none', payload: text };      // ключ не настроен — честно отдаём без подписи
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=300',
    'netlify-cdn-cache-control': `public, durable, s-maxage=${cdnSeconds}, stale-while-revalidate=${cdnSeconds}`,
  };
  if (vary) headers['netlify-vary'] = vary;
  return new Response(JSON.stringify(body), { headers });
}

export const errorResponse = (status, message) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

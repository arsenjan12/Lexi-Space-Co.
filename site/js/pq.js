// Постквантовая криптография в браузере (noble-post-quantum, FIPS 203/204).
//   verifySigned — проверка подписи ML-DSA-65 на данных от сервера LEXI Space
//   hybridHandshake — настоящее гибридное согласование ключа X25519 + ML-KEM-768 → HKDF

import { ml_dsa65, ml_kem768, hkdf, sha256, x25519 } from '../vendor/pq.js';

const enc = new TextEncoder();
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');

let publicKey = null;
function getPublicKey() {
  // один запрос на всех: группы спутников проверяются параллельно
  publicKey ??= fetch('data/pq-public.json').then(async res => {
    if (!res.ok) throw new Error('нет открытого ключа');
    const j = await res.json();
    return { kid: j.kid, key: b64(j.publicKey) };
  });
  return publicKey;
}

// signed = { alg, kid, payload (строка), sig (base64) }
export async function verifySigned(signed) {
  const t0 = performance.now();
  try {
    if (signed.alg === 'none') return { ok: false, reason: 'unsigned' };   // на сервере не задан ключ
    if (signed.alg !== 'ML-DSA-65') return { ok: false, reason: 'alg' };
    const pk = await getPublicKey();
    if (signed.kid !== pk.kid) return { ok: false, reason: 'kid' };
    const ok = ml_dsa65.verify(pk.key, enc.encode(signed.payload), b64(signed.sig));
    return { ok, reason: ok ? 'verified' : 'invalid', ms: performance.now() - t0, kid: pk.kid };
  } catch (e) {
    return { ok: false, reason: 'error', error: e.message };
  }
}

// Две стороны — «станция» и «аппарат» — договариваются о ключе, не передавая его.
// Возвращает, совпали ли ключи у обеих сторон, и сколько это заняло.
export function hybridHandshake() {
  const t0 = performance.now();
  // Станция публикует два открытых ключа: классический и постквантовый
  const stationX = x25519.utils.randomPrivateKey();
  const stationXPub = x25519.getPublicKey(stationX);
  const stationK = ml_kem768.keygen();

  // Аппарат: свой X25519 и инкапсуляция ML-KEM под ключ станции
  const satX = x25519.utils.randomPrivateKey();
  const satXPub = x25519.getPublicKey(satX);
  const { cipherText, sharedSecret: satKem } = ml_kem768.encapsulate(stationK.publicKey);
  const satEcdh = x25519.getSharedSecret(satX, stationXPub);

  // Станция: восстанавливает оба секрета
  const stationKem = ml_kem768.decapsulate(cipherText, stationK.secretKey);
  const stationEcdh = x25519.getSharedSecret(stationX, satXPub);

  // K = HKDF(ss_ML-KEM ‖ ss_X25519, transcript) — как в модуле 3
  const transcript = enc.encode('LEXI hybrid v1|' + hex(stationXPub) + '|' + hex(satXPub) + '|' + hex(cipherText.slice(0, 32)));
  const join = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  const kSat = hkdf(sha256, join(satKem, satEcdh), undefined, transcript, 32);
  const kStation = hkdf(sha256, join(stationKem, stationEcdh), undefined, transcript, 32);

  return {
    ok: hex(kSat) === hex(kStation),
    ms: performance.now() - t0,
    fingerprint: hex(kSat).slice(0, 16),
    sizes: { encapKey: stationK.publicKey.length, cipherText: cipherText.length, secret: kSat.length },
  };
}

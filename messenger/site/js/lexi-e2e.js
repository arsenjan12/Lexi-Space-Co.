// =====================================================================
//  LEXI Messenger — криптографический слой (в браузере)
//
//  Что здесь настоящее, а не симуляция:
//    • ML-KEM-768 (FIPS 203) — noble-post-quantum, тот же бандл, что в LEXI Space;
//    • HKDF-SHA-256 — noble;
//    • AES-256-GCM — WebCrypto браузера (аппаратное ускорение, ключи неэкспортируемые).
//
//  Две независимые защиты:
//    1) Транспорт клиент↔сервер: ML-KEM-768 → HKDF → AES-256-GCM. Параметры HKDF
//       (соль/инфо) совпадают с crypto_utils.generate_symmetric_key сервера, формат
//       шифротекста base64(iv‖ct‖tag) — с crypto_utils.encrypt_message.
//    2) Сквозное шифрование канала (E2E): у канала есть ключ эпохи (32 байта).
//       Его раздают участникам, «заворачивая» под их ML-KEM-ключ. Сервер видит только
//       шифротекст и никогда не получает ключ канала.
// =====================================================================

import { ml_kem768, hkdf, sha256 } from 'lexi-space/vendor/pq.js';

export const SUITE = Object.freeze({
  kem: 'ML-KEM-768',
  kemStandard: 'FIPS 203',
  aead: 'AES-256-GCM',
  kdf: 'HKDF-SHA-256',
  ivBits: 96,
  tagBits: 128,
  pkBytes: 1184,
  ctBytes: 1088,
});

const te = new TextEncoder();
const td = new TextDecoder();
export const utf8 = s => te.encode(s);
export const fromUtf8 = u8 => td.decode(u8);

// ---------- кодировки ----------
export function b64(u8) {
  // по кускам, чтобы большие вложения (FITS) не упирались в лимит аргументов
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');

// Безопасный генератор. В исходном client.js был Math.random() — он предсказуем,
// ключи из него можно восстановить. Только crypto.getRandomValues.
export function randomBytes(n) {
  const u8 = new Uint8Array(n);
  crypto.getRandomValues(u8);
  return u8;
}
export const randomId = (n = 12) => hex(randomBytes(n));

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Отпечаток открытого ключа для сверки «глазами» (как safety number в Signal)
export function fingerprint(pk) {
  const h = hex(sha256(pk)).slice(0, 40).toUpperCase();
  return h.match(/.{4}/g).join(' ');
}

export function cryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function';
}

// ---------- AES-256-GCM ----------
const keyCache = new WeakMap();
async function aesKey(raw) {
  if (raw instanceof CryptoKey) return raw;
  let k = keyCache.get(raw);
  if (!k) {
    k = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    keyCache.set(raw, k);
  }
  return k;
}

export async function aesEncrypt(rawKey, plain, aad) {
  const iv = randomBytes(12);
  const params = { name: 'AES-GCM', iv, tagLength: 128 };
  if (aad) params.additionalData = aad;
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, await aesKey(rawKey), plain));
  return { iv, ct };
}

export async function aesDecrypt(rawKey, iv, ct, aad) {
  const params = { name: 'AES-GCM', iv, tagLength: 128 };
  if (aad) params.additionalData = aad;
  return new Uint8Array(await crypto.subtle.decrypt(params, await aesKey(rawKey), ct));
}

// Формат crypto_utils.py: base64(iv ‖ ciphertext ‖ tag), без AAD
export async function encryptCompat(rawKey, text) {
  const { iv, ct } = await aesEncrypt(rawKey, utf8(text));
  return b64(concat(iv, ct));
}
export async function decryptCompat(rawKey, packed) {
  const all = unb64(packed);
  return fromUtf8(await aesDecrypt(rawKey, all.subarray(0, 12), all.subarray(12)));
}

// ---------- транспорт: ML-KEM-768 с сервером ----------
// Те же соль и info, что в crypto_utils.generate_symmetric_key — сервер получит тот же ключ.
const HKDF_SALT = utf8('LEXI_MESSENGER_HKDF_SALT');
const HKDF_INFO = utf8('LEXI_MESSENGER_KEY_DERIVATION');
export const deriveSessionKey = sharedSecret => hkdf(sha256, sharedSecret, HKDF_SALT, HKDF_INFO, 32);

// Клиент инкапсулирует секрет под ключ сервера. Если сервер прислал не ключ ML-KEM-768
// (у сервера v1 это 32 случайных байта), честно сообщаем: транспорт — заглушка.
export function transportEncapsulate(serverPkB64) {
  const t0 = performance.now();
  let pk;
  try { pk = unb64(serverPkB64 || ''); } catch { pk = new Uint8Array(0); }
  if (pk.length !== SUITE.pkBytes) {
    return { mode: 'stub', serverKeyBytes: pk.length, ms: performance.now() - t0 };
  }
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(pk);
  return {
    mode: 'ml-kem-768',
    serverKeyBytes: pk.length,
    cipherText: b64(cipherText),
    ctBytes: cipherText.length,
    sessionKey: deriveSessionKey(sharedSecret),
    ms: performance.now() - t0,
  };
}

// ---------- личность участника (ML-KEM-ключ на сессию) ----------
export class Identity {
  constructor() {
    const t0 = performance.now();
    const { publicKey, secretKey } = ml_kem768.keygen();
    this.publicKey = publicKey;
    this.secretKey = secretKey;          // никогда не покидает вкладку
    this.pkB64 = b64(publicKey);
    this.fingerprint = fingerprint(publicKey);
    this.keygenMs = performance.now() - t0;
  }
}

// ---------- ключи каналов ----------
// Эпоха — момент создания ключа + случайный хвост. Сравнение строк = сравнение времени,
// поэтому при гонке «два основателя» все сходятся на самой ранней эпохе.
const newEpoch = () => Date.now().toString(36).padStart(9, '0') + '-' + randomId(3);

export class ChannelKeyring {
  constructor(channel) {
    this.channel = channel;
    this.keys = new Map();   // epoch -> { raw, from, at }
    this.current = null;
  }
  get has() { return this.current !== null; }
  create(fromUid) {
    const epoch = newEpoch();
    this.add(epoch, randomBytes(32), fromUid);
    return epoch;
  }
  add(epoch, raw, from) {
    if (!this.keys.has(epoch)) this.keys.set(epoch, { raw, from, at: Date.now() });
    if (this.current === null || epoch < this.current) this.current = epoch;
    return this.current === epoch;
  }
  get(epoch) { return this.keys.get(epoch)?.raw || null; }
  fingerprint(epoch = this.current) {
    const raw = this.get(epoch);
    return raw ? hex(sha256(concat(utf8('LEXI-epoch|' + this.channel + '|' + epoch + '|'), raw))).slice(0, 16).toUpperCase() : '—';
  }
}

const WRAP_SALT = utf8('LEXI-E2E-v1');
const wrapInfo = (channel, epoch, to) => utf8(`LEXI-E2E-v1|wrap|${channel}|${epoch}|${to}`);

// Завернуть ключ канала для участника: ML-KEM encapsulate → HKDF → AES-GCM.
export async function wrapChannelKey(recipientPkB64, channel, epoch, raw, toUid) {
  const t0 = performance.now();
  const pk = unb64(recipientPkB64);
  if (pk.length !== SUITE.pkBytes) throw new Error('bad ML-KEM public key');
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(pk);
  const info = wrapInfo(channel, epoch, toUid);
  const kek = hkdf(sha256, sharedSecret, WRAP_SALT, info, 32);
  const { iv, ct } = await aesEncrypt(kek, raw, info);
  return { kem_ct: b64(cipherText), iv: b64(iv), wrapped: b64(ct), ms: performance.now() - t0 };
}

export async function unwrapChannelKey(identity, share, channel, myUid) {
  const ss = ml_kem768.decapsulate(unb64(share.kem_ct), identity.secretKey);
  const info = wrapInfo(channel, share.epoch, myUid);
  const kek = hkdf(sha256, ss, WRAP_SALT, info, 32);
  return aesDecrypt(kek, unb64(share.iv), unb64(share.wrapped), info);
}

// ---------- сообщения канала ----------
// AAD привязывает шифротекст к каналу, эпохе, автору и id: сервер не может
// переслать сообщение в другой канал или выдать его за чужое.
const msgAad = (channel, epoch, from, id) => utf8(`LEXI1|${channel}|${epoch}|${from}|${id}`);

export async function sealPayload(keyring, from, payload) {
  const epoch = keyring.current;
  const raw = keyring.get(epoch);
  if (!raw) throw new Error('no channel key');
  const plain = utf8(JSON.stringify(payload));
  const { iv, ct } = await aesEncrypt(raw, plain, msgAad(keyring.channel, epoch, from, payload.id));
  return { from, epoch, id: payload.id, iv: b64(iv), ct: b64(ct), n: plain.length };
}

export async function openPayload(keyring, env) {
  const raw = keyring.get(env.epoch);
  if (!raw) return null; // ключа этой эпохи пока нет — сообщение подождёт
  const plain = await aesDecrypt(raw, unb64(env.iv), unb64(env.ct), msgAad(keyring.channel, env.epoch, env.from, env.id));
  const payload = JSON.parse(fromUtf8(plain));
  if (payload.id !== env.id) throw new Error('id mismatch');
  return payload;
}

// ---------- конверты поверх обычного поля content ----------
// Так E2E работает даже через сервер v1: он просто пересылает строку.
//   LEXI1.pk.<json>   — объявление открытого ML-KEM-ключа (публичные данные)
//   LEXI1.key.<json>  — ключ канала, завёрнутый для одного участника
//   LEXI1.msg.<json>  — зашифрованная полезная нагрузка (iv, ct — base64)
export const ENVELOPE_PREFIX = 'LEXI1.';
export function encodeEnvelope(kind, obj) {
  return ENVELOPE_PREFIX + kind + '.' + JSON.stringify(obj);
}
export function decodeEnvelope(content) {
  if (typeof content !== 'string' || !content.startsWith(ENVELOPE_PREFIX)) return null;
  const rest = content.slice(ENVELOPE_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot < 1) return null;
  try {
    return { kind: rest.slice(0, dot), obj: JSON.parse(rest.slice(dot + 1)) };
  } catch {
    return null;
  }
}

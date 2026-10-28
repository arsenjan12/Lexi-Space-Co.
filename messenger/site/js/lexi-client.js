// =====================================================================
//  LexiIRCClient v2 — доработанный клиент LEXI (v1 → v2).
//
//  Публичный интерфейс сохранён (connect, joinChannel, sendMessage,
//  sendEncryptedMessage, sendCommand, listChannels, listUsers, setTopic,
//  disconnect, on/emit), исправлено то, из-за чего связка не работала:
//
//   • ключи — настоящий ML-KEM-768 (был Math.random в hex);
//   • «шифрование» btoa(message + key) заменено на AES-256-GCM —
//     раньше ключ буквально лежал внутри шифротекста, а кириллица роняла btoa;
//   • рукопожатие: клиент инкапсулирует секрет под ключ сервера и отправляет
//     шифротекст; если сервер прислал не ML-KEM-ключ — статус «заглушка», без обмана;
//   • сообщения от сервера v1 приходят без поля type — теперь распознаются;
//   • зашифрованные сообщения шли типом encrypted_message, который сервер
//     молча игнорирует; теперь E2E-конверт едет в обычном content и
//     сервер работает как «слепой» ретранслятор;
//   • переподключение не создаёт цепочку промисов и не срабатывает после
//     ручного disconnect(); экспоненциальная задержка с джиттером;
//   • дублирующиеся обработчики 'error' и console.log с содержимым
//     сообщений убраны (логи не должны видеть открытый текст).
// =====================================================================

import * as E from './lexi-e2e.js';

const MAX_FRAME_CHARS = 6 * 1024 * 1024;   // ~4,5 МБ вложений после base64
const KEY_WAIT_MS = 1600;                  // сколько ждём ключ от участников до «основания»
const WHO_POLL_MS = 20000;

export class LexiIRCClient {
  constructor({ socketFactory, uid, profile, debug = false } = {}) {
    this.ws = null;
    this.url = null;
    this.userId = null;                       // id сессии, который выдаёт сервер
    this.uid = uid || E.randomId(8);          // id клиента внутри E2E-конвертов
    this.userName = profile?.name || 'Anonymous';
    this.profile = profile || {};
    this.homeChannel = 'general';
    this.currentChannel = null;
    this.channels = new Map();
    this.identity = null;
    this.transport = { mode: 'none' };
    this.isConnected = false;
    this.state = 'idle';
    this.debug = debug;
    this.reconnect = { attempts: 0, max: 6, base: 800, timer: null, enabled: false };
    this.eventListeners = new Map();
    this.stats = { sealed: 0, opened: 0, failed: 0, wrapped: 0, unwrapped: 0, framesOut: 0, framesIn: 0, bytesOut: 0, bytesIn: 0, rtt: null, rttAvg: null };
    this.sent = new Map();
    this.socketFactory = socketFactory || (url => new WebSocket(url));
    this._chain = Promise.resolve();
    this._who = null;
  }

  // ------------------------------------------------------------------
  //  События
  // ------------------------------------------------------------------
  on(event, handler) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    this.eventListeners.get(event).add(handler);
    return () => this.off(event, handler);
  }
  off(event, handler) { this.eventListeners.get(event)?.delete(handler); }
  emit(event, data) {
    this.eventListeners.get(event)?.forEach(h => {
      try { h(data); } catch (e) { console.error('[lexi] обработчик', event, e); }
    });
  }
  log(level, text, extra) {
    if (this.debug) console.debug('[lexi]', text, extra ?? '');
    this.emit('log', { level, text, extra, t: Date.now() });
  }
  _setState(state, extra = {}) {
    this.state = state;
    this.emit('state', { state, ...extra });
  }

  // ------------------------------------------------------------------
  //  Подключение
  // ------------------------------------------------------------------
  async connect(url = 'ws://localhost:8000/ws', userName = this.userName, { channel } = {}) {
    if (!E.cryptoAvailable()) throw new Error('WebCrypto недоступен: откройте страницу по https или с localhost');
    this.url = String(url).replace(/\/+$/, '');
    this.userName = userName || 'Anonymous';
    if (channel) this.homeChannel = channel;
    this._ch(this.homeChannel).wanted = true;
    this.reconnect.enabled = true;
    this.reconnect.attempts = 0;
    if (!this.identity) {
      this.identity = new E.Identity();
      this.log('ok', `ML-KEM-768 keygen: pk ${E.SUITE.pkBytes} Б, sk 2400 Б · ${this.identity.keygenMs.toFixed(1)} мс`);
      this.log('info', `отпечаток ${this.identity.fingerprint}`);
    }
    return this._open();
  }

  _open() {
    clearTimeout(this.reconnect.timer);
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, v) => { if (!settled) { settled = true; fn(v); } };
      const target = `${this.url}/${encodeURIComponent(this.homeChannel)}`;
      this._setState('connecting', { attempt: this.reconnect.attempts });
      this.log('info', `WebSocket → ${target}`);
      let ws;
      try { ws = this.socketFactory(target); } catch (e) {
        this._setState('offline');
        return reject(e);
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        settle(reject, new Error('Сервер не ответил на рукопожатие'));
        try { ws.close(); } catch {}
      }, 12000);

      ws.onopen = () => {
        this._setState('handshake');
        // Первый кадр читает сервер: имя и открытый ключ
        this._sendNow({ type: 'init', user_name: this.userName, public_key: this.identity.pkB64, uid: this.uid, client: 'lexi-web/2' });
      };
      ws.onmessage = ev => this._onFrame(ev.data, () => { clearTimeout(timer); settle(resolve, this); });
      ws.onerror = () => this.log('warn', 'ошибка WebSocket');
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.ws === ws) this.ws = null;
        const was = this.isConnected;
        this.isConnected = false;
        clearInterval(this._who);
        for (const ch of this.channels.values()) ch.joined = false;
        settle(reject, new Error('Соединение закрыто'));
        if (was) this.log('warn', 'соединение разорвано');
        if (this.reconnect.enabled) this._scheduleReconnect();
        else { this._setState('offline'); this.emit('disconnected', { manual: true }); }
      };
    });
  }

  _scheduleReconnect() {
    const r = this.reconnect;
    if (r.attempts >= r.max) {
      this._setState('offline');
      this.emit('disconnected', { message: 'Не удалось восстановить соединение' });
      return;
    }
    r.attempts++;
    const delay = Math.min(15000, r.base * 2 ** (r.attempts - 1)) * (0.7 + Math.random() * 0.6);
    this._setState('reconnecting', { attempt: r.attempts, delay });
    this.log('warn', `переподключение ${r.attempts}/${r.max} через ${(delay / 1000).toFixed(1)} с`);
    r.timer = setTimeout(() => this._open().catch(() => {}), delay);
  }

  retryNow() {
    this.reconnect.enabled = true;
    this.reconnect.attempts = 0;
    return this._open();
  }

  disconnect() {
    this.reconnect.enabled = false;
    clearTimeout(this.reconnect.timer);
    clearInterval(this._who);
    if (this.ws) {
      this._sendNow({ type: 'irc_command', command: 'QUIT', args: [] });
      try { this.ws.close(); } catch {}
    }
  }

  // ------------------------------------------------------------------
  //  Отправка кадров (по порядку; при защищённом транспорте — в AES-GCM)
  // ------------------------------------------------------------------
  _sendNow(obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    const text = JSON.stringify(obj);
    if (text.length > MAX_FRAME_CHARS) {
      this.emit('error', { message: 'Сообщение слишком большое' });
      return false;
    }
    ws.send(text);
    this.stats.framesOut++;
    this.stats.bytesOut += text.length;
    return true;
  }

  sendRawMessage(obj) {
    // кадры уходят строго по очереди, даже если шифрование кадра асинхронно
    this._chain = this._chain.then(async () => {
      if (this.transport.frames && this.transport.sessionKey) {
        const data = await E.encryptCompat(this.transport.sessionKey, JSON.stringify(obj));
        return this._sendNow({ type: 'sealed', data });
      }
      return this._sendNow(obj);
    }).catch(e => this.emit('error', { message: e.message }));
    return this._chain;
  }

  // ------------------------------------------------------------------
  //  Приём кадров
  // ------------------------------------------------------------------
  async _onFrame(data, onReady) {
    if (typeof data !== 'string') return;
    this.stats.framesIn++;
    this.stats.bytesIn += data.length;
    let m;
    try { m = JSON.parse(data); } catch { return this.log('warn', 'не-JSON кадр от сервера проигнорирован'); }

    if (m.type === 'sealed' && this.transport.sessionKey) {
      try { m = JSON.parse(await E.decryptCompat(this.transport.sessionKey, m.data)); }
      catch { this.stats.failed++; return this.log('err', 'кадр не прошёл проверку AES-GCM — отброшен'); }
    }

    // сервер v1 рассылает Message.to_dict() без поля type
    const type = m.type || (m.content !== undefined && m.channel ? 'message' : 'unknown');
    switch (type) {
      case 'pqc_handshake': return this._handshake(m, onReady);
      case 'join_success': return this._joined(m.channel);
      case 'message': return this._onChannelMessage(m);
      case 'history':
        for (const x of m.messages || []) await this._onChannelMessage({ ...x, channel: m.channel, history: true });
        return;
      case 'user_list': return this.emit('user_list', m);
      case 'channel_list': return this.emit('channel_list', m);
      case 'topic_set': return this.emit('topic', m);
      case 'quit_success': return;
      case 'join_error':
      case 'send_error':
      case 'error':
      case 'user_list_error':
      case 'channel_list_error':
      case 'topic_error':
        this.log('err', m.message || type);
        return this.emit('error', m);
      default:
        return this.emit('unknown_message', m);
    }
  }

  _handshake(m, onReady) {
    this.userId = m.user_id || null;
    const t = E.transportEncapsulate(m.server_public_key);
    if (t.mode === 'ml-kem-768') {
      this.transport = { mode: t.mode, sessionKey: t.sessionKey, ctBytes: t.ctBytes, ms: t.ms, frames: false, server: m.server || 'lexi' };
      this._sendNow({ type: 'pqc_exchange', kem: 'ML-KEM-768', ciphertext: t.cipherText });
      this.log('ok', `транспорт: ML-KEM-768 encapsulate · ct ${t.ctBytes} Б · ${t.ms.toFixed(1)} мс`);
      this.log('ok', 'HKDF-SHA-256 → сеансовый ключ AES-256-GCM (параметры crypto_utils)');
      // Сервер v2 сообщает, что дальше кадры идут в AES-GCM
      if (m.frames === 'aes-256-gcm') {
        this.transport.frames = true;
        this.log('ok', 'кадры WebSocket зашифрованы сеансовым ключом');
      }
    } else {
      this.transport = { mode: 'stub', serverKeyBytes: t.serverKeyBytes, ms: t.ms, frames: false, server: m.server || 'lexi-v1' };
      // сервер v1 ждёт любой ответ, прежде чем пустить в канал
      this._sendNow({ type: 'pqc_exchange', kem: 'none', note: `server key is ${t.serverKeyBytes} bytes, ML-KEM-768 expects ${E.SUITE.pkBytes}` });
      this.log('warn', `транспорт: ключ сервера ${t.serverKeyBytes} Б вместо ${E.SUITE.pkBytes} — у сервера заглушка KEM`);
      this.log('info', 'конфиденциальность держится на E2E-слое: сервер видит только шифротекст');
    }
    this.isConnected = true;
    this.reconnect.attempts = 0;
    this._setState('online');
    this.emit('handshake', { transport: { ...this.transport, sessionKey: undefined } });
    this.emit('connected', { userId: this.userId, transport: this.transport.mode });
    for (const [name, ch] of this.channels) if (ch.wanted) this.sendCommand('JOIN', [name]);
    clearInterval(this._who);
    this._who = setInterval(() => { for (const [n, ch] of this.channels) if (ch.joined) this.listUsers(n); }, WHO_POLL_MS);
    onReady?.();
  }

  // ------------------------------------------------------------------
  //  Каналы и ключи
  // ------------------------------------------------------------------
  _ch(name) {
    let ch = this.channels.get(name);
    if (!ch) {
      ch = {
        name, wanted: false, joined: false,
        keyring: new E.ChannelKeyring(name),
        members: new Map(),        // uid -> { uid, name, pk, fp, lastSeen }
        pending: [],               // сообщения, для которых ещё нет ключа эпохи
        outbox: [],                // свои сообщения до получения ключа
        sharesSeen: new Set(),     // `${to}|${epoch}` — чтобы не дублировать раздачу
        repliedHello: new Set(),
        lastNeed: 0,
        keyTimer: null,
      };
      this.channels.set(name, ch);
    }
    return ch;
  }

  joinChannel(channelName, { found = false } = {}) {
    const name = String(channelName).replace(/^#/, '').trim();
    if (!name) return;
    const ch = this._ch(name);
    ch.wanted = true;
    ch.found = ch.found || found;
    if (this.isConnected) this.sendCommand('JOIN', [name]);
    return name;
  }

  leaveChannel(name) {
    // в протоколе v1 нет PART — отписываемся локально
    const ch = this.channels.get(name);
    if (ch) { ch.wanted = false; ch.joined = false; clearTimeout(ch.keyTimer); }
  }

  _joined(name) {
    const ch = this._ch(name);
    ch.wanted = true;
    ch.joined = true;
    this.currentChannel = name;
    this.emit('joined', { channel: name });
    this._announce(name, { hello: true });
    clearTimeout(ch.keyTimer);
    if (ch.found && !ch.keyring.has) return this._foundKey(name);
    ch.keyTimer = setTimeout(() => { if (!ch.keyring.has) this._foundKey(name); }, KEY_WAIT_MS);
  }

  _announce(channel, extra = {}) {
    const ch = this._ch(channel);
    this.sendRawMessage({
      type: 'message', channel,
      content: E.encodeEnvelope('pk', { uid: this.uid, name: this.userName, pk: this.identity.pkB64, color: this.profile.color, ...extra }),
      timestamp: new Date().toISOString(),
    });
    if (extra.need) ch.lastNeed = Date.now();
  }

  async _foundKey(channel) {
    const ch = this._ch(channel);
    if (ch.keyring.has) return;
    const epoch = ch.keyring.create(this.uid);
    this.log('ok', `#${channel}: создан ключ канала, эпоха ${epoch} · ${ch.keyring.fingerprint()}`);
    this.emit('key', { channel, epoch, source: 'created', fp: ch.keyring.fingerprint() });
    for (const m of ch.members.values()) this._shareKey(channel, m, epoch);
    this._flush(channel);
  }

  async _shareKey(channel, member, epoch = this._ch(channel).keyring.current, { jitter = false } = {}) {
    const ch = this._ch(channel);
    const raw = ch.keyring.get(epoch);
    if (!raw || !member.pk) return;
    const tag = `${member.uid}|${epoch}`;
    if (jitter) await new Promise(r => setTimeout(r, 60 + Math.random() * 380));
    if (ch.sharesSeen.has(tag)) return;          // кто-то из участников уже передал
    ch.sharesSeen.add(tag);
    try {
      const w = await E.wrapChannelKey(member.pk, channel, epoch, raw, member.uid);
      this.stats.wrapped++;
      this.sendRawMessage({
        type: 'message', channel,
        content: E.encodeEnvelope('key', { to: member.uid, from: this.uid, epoch, kem_ct: w.kem_ct, iv: w.iv, wrapped: w.wrapped }),
        timestamp: new Date().toISOString(),
      });
      this.log('ok', `#${channel}: ключ завёрнут для ${member.name} (ML-KEM ct ${E.SUITE.ctBytes} Б, ${w.ms.toFixed(1)} мс)`);
    } catch (e) {
      this.log('err', `не удалось передать ключ ${member.name}: ${e.message}`);
    }
  }

  async _onChannelMessage(m) {
    const channel = m.channel;
    const ch = this._ch(channel);
    if (!ch.wanted && !m.history) return;
    const env = E.decodeEnvelope(m.content);
    if (!env) {
      // Старый клиент без шифрования: показываем, но с предупреждением
      return this.emit('plain', { channel, userId: m.user_id, content: String(m.content ?? ''), timestamp: m.timestamp });
    }
    const o = env.obj;

    if (env.kind === 'pk') {
      if (!o || o.uid === this.uid) return;
      let fp;
      try {
        const pk = E.unb64(o.pk);
        if (pk.length !== E.SUITE.pkBytes) throw 0;
        fp = E.fingerprint(pk);
      } catch { return this.log('warn', `#${channel}: отклонён некорректный ключ от «${o.name}»`); }
      const known = ch.members.get(o.uid);
      const member = { ...(known || {}), uid: o.uid, name: String(o.name || 'Anonymous').slice(0, 64), pk: o.pk, fp, color: o.color, lastSeen: Date.now() };
      if (known && known.pk !== o.pk) {
        member.keyChanged = true;
        this.log('warn', `#${channel}: у «${member.name}» сменился ключ — сверьте отпечаток`);
      }
      ch.members.set(o.uid, member);
      this.emit('members', { channel, members: [...ch.members.values()] });
      if (!known) this.log('info', `#${channel}: ${member.name} · ${fp.slice(0, 19)}…`);
      if (o.hello && !ch.repliedHello.has(o.uid)) {
        ch.repliedHello.add(o.uid);
        this._announce(channel, { hello: false });
      }
      if (ch.keyring.has) {
        this._shareKey(channel, member, ch.keyring.current, { jitter: true });
        if (o.need && ch.keyring.get(o.need)) this._shareKey(channel, member, o.need, { jitter: true });
      }
      return;
    }

    if (env.kind === 'key') {
      if (!o) return;
      ch.sharesSeen.add(`${o.to}|${o.epoch}`);
      if (o.to !== this.uid || ch.keyring.get(o.epoch)) return;
      try {
        const raw = await E.unwrapChannelKey(this.identity, o, channel, this.uid);
        this.stats.unwrapped++;
        const becameCurrent = ch.keyring.add(o.epoch, raw, o.from);
        clearTimeout(ch.keyTimer);
        const from = ch.members.get(o.from)?.name || o.from;
        this.log('ok', `#${channel}: получен ключ эпохи ${o.epoch} от ${from} (ML-KEM decapsulate)`);
        this.emit('key', { channel, epoch: o.epoch, source: 'received', from: o.from, current: becameCurrent, fp: ch.keyring.fingerprint() });
        await this._flush(channel);
      } catch {
        this.stats.failed++;
        this.log('err', `#${channel}: ключ не расшифровался — возможно, подмена`);
      }
      return;
    }

    if (env.kind === 'msg') {
      if (o.from === this.uid) {
        const t0 = this.sent.get(o.id);
        if (t0 !== undefined) {
          this.sent.delete(o.id);
          const rtt = performance.now() - t0;
          this.stats.rtt = rtt;
          this.stats.rttAvg = this.stats.rttAvg == null ? rtt : this.stats.rttAvg * 0.8 + rtt * 0.2;
          this.emit('delivered', { channel, id: o.id, rtt });
        } else if (m.history) {
          await this._open1(channel, o, m);
        }
        return;
      }
      return this._open1(channel, o, m);
    }
  }

  async _open1(channel, envObj, frame) {
    const ch = this._ch(channel);
    let payload;
    try {
      payload = await E.openPayload(ch.keyring, envObj);
    } catch {
      this.stats.failed++;
      this.log('err', `#${channel}: сообщение ${envObj.id} не прошло проверку подлинности GCM`);
      return this.emit('tampered', { channel, id: envObj.id, from: envObj.from });
    }
    if (!payload) {
      ch.pending.push({ envObj, frame });
      this.emit('pending', { channel, count: ch.pending.length });
      if (Date.now() - ch.lastNeed > 3000) this._announce(channel, { hello: false, need: envObj.epoch });
      return;
    }
    this.stats.opened++;
    const member = ch.members.get(envObj.from);
    this.emit('chat', {
      channel,
      payload,
      mine: envObj.from === this.uid,
      history: !!frame.history,
      from: { uid: envObj.from, name: member?.name || payload.name || 'Anonymous', fp: member?.fp, color: member?.color },
      meta: { epoch: envObj.epoch, iv: envObj.iv, ctBytes: Math.floor(envObj.ct.length * 3 / 4), plainBytes: envObj.n, ctPreview: envObj.ct.slice(0, 180), receivedAt: Date.now(), serverTs: frame.timestamp },
    });
  }

  async _flush(channel) {
    const ch = this._ch(channel);
    const pend = ch.pending.splice(0);
    for (const p of pend) await this._open1(channel, p.envObj, p.frame);
    if (pend.length) this.emit('pending', { channel, count: ch.pending.length });
    const out = ch.outbox.splice(0);
    for (const p of out) await this.sendPayload(channel, p);
  }

  // ------------------------------------------------------------------
  //  Отправка сообщений
  // ------------------------------------------------------------------
  // Любая полезная нагрузка канала: текст, правка, реакция, голос, опрос…
  async sendPayload(channel, payload) {
    const ch = this._ch(channel);
    payload.id ||= E.randomId(8);
    payload.ts ||= Date.now();
    payload.name ||= this.userName;
    if (!ch.keyring.has) {
      ch.outbox.push(payload);
      this.log('info', `#${channel}: ждём ключ канала, сообщение в очереди`);
      return { queued: true, payload };
    }
    const env = await E.sealPayload(ch.keyring, this.uid, payload);
    this.stats.sealed++;
    this.sent.set(env.id, performance.now());
    await this.sendRawMessage({ type: 'message', channel, content: E.encodeEnvelope('msg', env), timestamp: new Date().toISOString() });
    return { payload, meta: { epoch: env.epoch, iv: env.iv, ctBytes: Math.floor(env.ct.length * 3 / 4), plainBytes: env.n, ctPreview: env.ct.slice(0, 180), sentAt: Date.now() } };
  }

  // Имя метода из исходного клиента; теперь это настоящее E2E-шифрование
  sendEncryptedMessage(channel, text, extra = {}) {
    if (!this.isConnected) return this.emit('error', { message: 'Нет активного соединения' });
    return this.sendPayload(channel, { t: 'text', text: String(text), ...extra });
  }

  // Открытый текст — только для совместимости со старыми клиентами
  sendMessage(channel, text) {
    if (!this.isConnected) return;
    this.log('warn', `#${channel}: отправка БЕЗ шифрования`);
    return this.sendRawMessage({ type: 'message', channel, content: String(text), timestamp: new Date().toISOString() });
  }

  sendCommand(command, args = []) {
    if (!this.isConnected) return;
    return this.sendRawMessage({ type: 'irc_command', command, args });
  }
  listChannels() { return this.sendCommand('LIST'); }
  listUsers(channel) { return this.sendCommand('WHO', [channel]); }

  // Тема шифруется как обычное сообщение канала. Для совместимости с сервером v1
  // (он принимает TOPIC с одним аргументом и только для «домашнего» канала)
  // дублируем команду, но открытого текста темы там нет, если она секретная.
  setTopic(channel, topic, { mirrorToServer = false } = {}) {
    if (mirrorToServer && channel === this.homeChannel) this.sendCommand('TOPIC', [topic]);
    return this.sendPayload(channel, { t: 'topic', topic: String(topic).slice(0, 300) });
  }

  // Личный канал: имя выводится из двух uid, приглашение идёт зашифрованным
  dmChannelName(otherUid) {
    const pair = [this.uid, otherUid].sort().join('|');
    return 'dm-' + E.hex(E.utf8(pair)).slice(0, 8) + '-' + pair.split('|').map(s => s.slice(0, 4)).join('');
  }

  keyInfo(channel) {
    const ch = this.channels.get(channel);
    if (!ch || !ch.keyring.has) return null;
    return { epoch: ch.keyring.current, fp: ch.keyring.fingerprint(), epochs: ch.keyring.keys.size, founder: ch.keyring.keys.get(ch.keyring.current)?.from === this.uid };
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = LexiIRCClient;
export default LexiIRCClient;

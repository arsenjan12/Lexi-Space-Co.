// =====================================================================
//  Демо-ретранслятор: сервер LEXI, работающий прямо во вкладке.
//
//  Нужен, чтобы мессенджер можно было показать без запущенного сервера LEXI
//  (на НПК, на Netlify). Протокол тот же, что у сервера LEXI v1, плюс
//  возможности протокола v2:
//    • настоящий ML-KEM-768 в рукопожатии (ключ сервера 1184 Б);
//    • кадры после рукопожатия — в AES-256-GCM (формат crypto_utils);
//    • история канала (только шифротекст E2E) при входе.
//  Сервер-ретранслятор не знает ключей каналов и не может прочитать сообщения.
// =====================================================================

import { ml_kem768 } from 'lexi-space/vendor/pq.js';
import * as E from './lexi-e2e.js';

const HISTORY_LIMIT = 400;

class DemoSocket {
  constructor(relay, url) {
    this.relay = relay;
    this.url = url;
    this.readyState = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.peer = null;
    setTimeout(() => {
      this.readyState = 1;
      this.peer = relay._accept(this);
      this.onopen?.({});
    }, 30 + Math.random() * 40);
  }
  send(text) {
    if (this.readyState !== 1) throw new Error('socket not open');
    this.relay._receive(this.peer, text);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.relay._drop(this.peer);
    setTimeout(() => this.onclose?.({ code: 1000 }), 0);
  }
  _deliver(text) {
    if (this.readyState === 1) this.onmessage?.({ data: text });
  }
}

export class DemoRelay {
  constructor({ latency = [12, 45] } = {}) {
    this.latency = latency;
    this.peers = new Set();
    this.channels = new Map();   // name -> { peers:Set, history:[], topic }
    this.kem = ml_kem768.keygen();
    this.pkB64 = E.b64(this.kem.publicKey);
    this.stored = 0;
    this.verified = new Set();   // uid проверенных учёных (в реальном сервере — из базы, ставит админ)
  }

  socketFactory = url => new DemoSocket(this, url);

  _chan(name) {
    let c = this.channels.get(name);
    if (!c) { c = { peers: new Set(), history: [], topic: '' }; this.channels.set(name, c); }
    return c;
  }

  _accept(sock) {
    const home = decodeURIComponent(sock.url.split('/').pop() || 'general');
    const peer = { sock, id: crypto.randomUUID(), name: 'Anonymous', home, stage: 'init', key: null, queue: Promise.resolve(), connectedAt: new Date().toISOString() };
    this.peers.add(peer);
    return peer;
  }

  _drop(peer) {
    this.peers.delete(peer);
    for (const c of this.channels.values()) c.peers.delete(peer);
  }

  _delay() {
    const [a, b] = this.latency;
    return a + Math.random() * (b - a);
  }

  // Кадры одного клиента обрабатываем строго по порядку
  _receive(peer, text) {
    peer.queue = peer.queue.then(() => this._handle(peer, text)).catch(e => console.warn('[relay]', e));
  }

  async _send(peer, obj) {
    let out = obj;
    if (peer.key && peer.stage === 'ready') out = { type: 'sealed', data: await E.encryptCompat(peer.key, JSON.stringify(obj)) };
    const text = JSON.stringify(out);
    setTimeout(() => peer.sock._deliver(text), this._delay());
  }

  async _handle(peer, text) {
    let m = JSON.parse(text);
    if (m.type === 'sealed') {
      if (!peer.key) return;
      m = JSON.parse(await E.decryptCompat(peer.key, m.data));
    }

    if (peer.stage === 'init') {
      peer.name = String(m.user_name || 'Anonymous').slice(0, 64);
      peer.uid = typeof m.uid === 'string' ? m.uid.slice(0, 32) : null;
      peer.stage = 'handshake';
      return this._send(peer, { type: 'pqc_handshake', server_public_key: this.pkB64, user_id: peer.id, frames: 'aes-256-gcm', server: 'demo-relay' });
    }
    if (peer.stage === 'handshake') {
      if (m.ciphertext) {
        const ss = ml_kem768.decapsulate(E.unb64(m.ciphertext), this.kem.secretKey);
        peer.key = E.deriveSessionKey(ss);
      }
      peer.stage = 'ready';
      this._chan(peer.home).peers.add(peer);   // как сервер v1: «домашний» канал из URL
      return;
    }

    if (m.type === 'irc_command') {
      const [a0] = m.args || [];
      switch (m.command) {
        case 'JOIN': return this._join(peer, String(a0 || '').replace(/^#/, ''));
        case 'WHO': return this._who(peer, a0 || peer.home);
        case 'LIST': return this._send(peer, { type: 'channel_list', channels: [...this.channels.keys()].filter(n => !n.startsWith('dm-')) });
        case 'TOPIC': this._chan(peer.home).topic = String(a0 || ''); return this._send(peer, { type: 'topic_set', channel: peer.home, topic: a0 });
        case 'QUIT': this._drop(peer); return this._send(peer, { type: 'quit_success' });
      }
      return;
    }

    if (m.type === 'message') {
      const name = String(m.channel || peer.home);
      const c = this._chan(name);
      if (!c.peers.has(peer)) return this._send(peer, { type: 'error', message: `not in #${name}` });
      const frame = { type: 'message', user_id: peer.id, channel: name, content: m.content, timestamp: new Date().toISOString() };
      // В «базу» попадает только шифротекст сообщений, не служебные конверты
      if (typeof m.content === 'string' && m.content.startsWith('LEXI1.msg.')) {
        c.history.push(frame);
        this.stored++;
        if (c.history.length > HISTORY_LIMIT) c.history.shift();
      }
      for (const p of c.peers) this._send(p, frame);
    }
  }

  async _join(peer, name) {
    if (!name) return;
    const c = this._chan(name);
    c.peers.add(peer);
    await this._send(peer, { type: 'join_success', channel: name });
    if (c.history.length) await this._send(peer, { type: 'history', channel: name, messages: c.history.slice(-200) });
    return this._who(peer, name);
  }

  _who(peer, name) {
    const c = this._chan(name);
    return this._send(peer, { type: 'user_list', channel: name, users: [...c.peers].map(p => ({ id: p.id, uid: p.uid, name: p.name, verified: this.verified.has(p.uid), connected_at: p.connectedAt })) });
  }
}

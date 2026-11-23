'use strict';
// WebSocket mínimo (RFC 6455), sem dependências.
const crypto = require('crypto');
const { EventEmitter } = require('events');

class Conn extends EventEmitter {
  constructor(socket, maxMessageBytes) {
    super();
    this.socket = socket;
    this.max = maxMessageBytes;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragBytes = 0;
    this.alive = true;
    this.closed = false;
    socket.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.parse();
    });
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  parse() {
    while (!this.closed) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(this.max)) return this.close();
        len = Number(big);
        off = 10;
      }
      if (!masked) return this.close();
      // Limite vale para a mensagem inteira, somando fragmentos de continuação.
      if (len > this.max || this.fragBytes + len > this.max) return this.close();
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.from(this.buf.subarray(off, off + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + len);

      if (op === 0x8) return this.close();
      if (op === 0x9) { this.frame(0xa, payload); continue; }
      if (op === 0xa) { this.alive = true; continue; }
      if (op === 0x0 || op === 0x1 || op === 0x2) {
        this.frags.push(payload);
        this.fragBytes += payload.length;
        if (fin) {
          const text = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
          this.fragBytes = 0;
          this.emit('message', text);
        }
      }
    }
  }

  frame(op, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(obj) {
    this.frame(0x1, Buffer.from(JSON.stringify(obj)));
  }

  close() {
    if (this.closed) return;
    try { this.frame(0x8, Buffer.alloc(0)); } catch {}
    this.socket.end();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

// Completa o handshake e devolve a conexão, ou null se o pedido não for um upgrade válido.
function accept(req, socket, maxMessageBytes) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return null;
  const acceptKey = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );
  socket.setNoDelay(true);
  return new Conn(socket, maxMessageBytes);
}

module.exports = { accept, Conn };

// Ressoa — servidor de sinalização + arquivos estáticos.
// Zero dependências: precisa apenas do Node.js 18+.
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');
const CERT_DIR = path.join(__dirname, 'cert');
const MAX_HISTORY = 200;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const PALETTE = ['#2dd4bf', '#f59e0b', '#f472b6', '#60a5fa', '#a3e635', '#fb7185', '#c084fc', '#facc15'];
const uid = () => crypto.randomBytes(6).toString('hex');

// ---------------------------------------------------------------- dados
function defaultData() {
  return {
    servers: [
      {
        id: uid(),
        name: 'Lobby',
        color: PALETTE[0],
        channels: [
          { id: uid(), name: 'Geral' },
          { id: uid(), name: 'Jogos' },
          { id: uid(), name: 'Trabalho' },
        ],
      },
    ],
    messages: {},
  };
}

let db;
try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(db.servers)) throw new Error('inválido');
  db.messages = db.messages || {};
} catch {
  db = defaultData();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), (err) => {
      if (err) console.error('Falha ao salvar dados:', err.message);
    });
  }, 300);
}
save();

function findChannel(channelId) {
  for (const server of db.servers) {
    const channel = server.channels.find((c) => c.id === channelId);
    if (channel) return { server, channel };
  }
  return null;
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------------------------------------------------------------- WebSocket mínimo (RFC 6455)
class Conn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
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
        if (big > 4n * 1024n * 1024n) return this.close();
        len = Number(big);
        off = 10;
      }
      if (!masked) return this.close();
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
        if (fin) {
          const text = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
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

function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !req.url.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);
  onConnection(new Conn(socket));
}

// ---------------------------------------------------------------- lógica da aplicação
const clients = new Map(); // id -> { id, conn, name, channelId, state }

const pub = (c) => ({ id: c.id, name: c.name, state: c.state });

function snapshot() {
  const all = [...clients.values()].filter((c) => c.name);
  return db.servers.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    channels: s.channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      members: all.filter((c) => c.channelId === ch.id).map(pub),
    })),
  }));
}

function broadcastSnapshot() {
  const servers = snapshot();
  for (const c of clients.values()) if (c.name) c.conn.send({ t: 'snapshot', servers });
}

function inChannel(channelId, exceptId) {
  return [...clients.values()].filter((c) => c.channelId === channelId && c.id !== exceptId);
}

function leaveChannel(client) {
  const channelId = client.channelId;
  if (!channelId) return;
  client.channelId = null;
  client.state = {};
  for (const other of inChannel(channelId)) other.conn.send({ t: 'peer-left', id: client.id });
}

function sanitizeState(s) {
  s = s && typeof s === 'object' ? s : {};
  const id = (v) => (typeof v === 'string' ? v.slice(0, 100) : null);
  return {
    muted: !!s.muted,
    deafened: !!s.deafened,
    camera: !!s.camera,
    screen: !!s.screen,
    micStreamId: id(s.micStreamId),
    camStreamId: id(s.camStreamId),
    screenStreamId: id(s.screenStreamId),
  };
}

const handlers = {
  hello(c, m) {
    c.name = clean(m.name, 32) || 'Anônimo';
    c.conn.send({ t: 'welcome', id: c.id, servers: snapshot() });
    broadcastSnapshot();
  },

  'create-server'(c, m) {
    const name = clean(m.name, 40);
    if (!name) return;
    const server = {
      id: uid(),
      name,
      color: PALETTE[db.servers.length % PALETTE.length],
      channels: [{ id: uid(), name: 'Geral' }],
    };
    db.servers.push(server);
    save();
    broadcastSnapshot();
    c.conn.send({ t: 'server-created', id: server.id });
  },

  'delete-server'(c, m) {
    const server = db.servers.find((s) => s.id === m.serverId);
    if (!server) return;
    const busy = server.channels.some((ch) => inChannel(ch.id).length > 0);
    if (busy) return c.conn.send({ t: 'error', message: 'Há pessoas em chamada neste servidor.' });
    if (db.servers.length === 1) return c.conn.send({ t: 'error', message: 'É preciso manter pelo menos um servidor.' });
    db.servers = db.servers.filter((s) => s !== server);
    for (const ch of server.channels) delete db.messages[ch.id];
    save();
    broadcastSnapshot();
  },

  'create-channel'(c, m) {
    const server = db.servers.find((s) => s.id === m.serverId);
    const name = clean(m.name, 40);
    if (!server || !name) return;
    if (server.channels.length >= 50) return;
    const channel = { id: uid(), name };
    server.channels.push(channel);
    save();
    broadcastSnapshot();
    c.conn.send({ t: 'channel-created', id: channel.id });
  },

  'delete-channel'(c, m) {
    const found = findChannel(m.channelId);
    if (!found) return;
    if (inChannel(found.channel.id).length) return c.conn.send({ t: 'error', message: 'O canal tem pessoas em chamada.' });
    if (found.server.channels.length === 1) return c.conn.send({ t: 'error', message: 'O servidor precisa de pelo menos um canal.' });
    found.server.channels = found.server.channels.filter((ch) => ch !== found.channel);
    delete db.messages[found.channel.id];
    save();
    broadcastSnapshot();
  },

  join(c, m) {
    if (!findChannel(m.channelId)) return;
    leaveChannel(c);
    c.channelId = m.channelId;
    c.state = sanitizeState(m.state);
    const others = inChannel(c.channelId, c.id);
    for (const o of others) o.conn.send({ t: 'peer-joined', peer: pub(c) });
    c.conn.send({ t: 'joined', channelId: c.channelId, peers: others.map(pub) });
    broadcastSnapshot();
  },

  leave(c) {
    leaveChannel(c);
    broadcastSnapshot();
  },

  state(c, m) {
    if (!c.channelId) return;
    c.state = sanitizeState(m.state);
    for (const o of inChannel(c.channelId, c.id)) o.conn.send({ t: 'peer-state', id: c.id, state: c.state });
    broadcastSnapshot();
  },

  signal(c, m) {
    const target = clients.get(m.to);
    if (!target || !c.channelId || target.channelId !== c.channelId) return;
    target.conn.send({ t: 'signal', from: c.id, data: m.data });
  },

  history(c, m) {
    if (!findChannel(m.channelId)) return;
    c.conn.send({ t: 'history', channelId: m.channelId, messages: db.messages[m.channelId] || [] });
  },

  chat(c, m) {
    const text = String(m.text ?? '').trim().slice(0, 2000);
    if (!text || !findChannel(m.channelId)) return;
    const msg = { id: uid(), authorId: c.id, author: c.name, text, ts: Date.now() };
    const list = (db.messages[m.channelId] = db.messages[m.channelId] || []);
    list.push(msg);
    if (list.length > MAX_HISTORY) list.splice(0, list.length - MAX_HISTORY);
    save();
    for (const o of clients.values()) if (o.name) o.conn.send({ t: 'chat', channelId: m.channelId, message: msg });
  },
};

function onConnection(conn) {
  const client = { id: uid(), conn, name: null, channelId: null, state: {} };
  clients.set(client.id, client);

  conn.on('message', (text) => {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t !== 'hello' && !client.name) return;
    const fn = handlers[m.t];
    if (fn) {
      try { fn(client, m); } catch (err) { console.error('Erro ao tratar', m.t, err); }
    }
  });

  conn.on('close', () => {
    leaveChannel(client);
    clients.delete(client.id);
    broadcastSnapshot();
  });
}

setInterval(() => {
  for (const c of clients.values()) {
    if (!c.conn.alive) { c.conn.close(); continue; }
    c.conn.alive = false;
    c.conn.frame(0x9, Buffer.alloc(0));
  }
}, 25000);

// ---------------------------------------------------------------- HTTP
// Servidores STUN/TURN entregues ao navegador. Para TURN, defina as variáveis
// TURN_URLS (separadas por vírgula), TURN_USERNAME e TURN_CREDENTIAL.
function iceConfig() {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turnUrls = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  return { iceServers };
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (url.pathname === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ice: iceConfig() }));
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const keyFile = path.join(CERT_DIR, 'key.pem');
const certFile = path.join(CERT_DIR, 'cert.pem');
const useHttps = fs.existsSync(keyFile) && fs.existsSync(certFile);
const server = useHttps
  ? https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, serveStatic)
  : http.createServer(serveStatic);

server.on('upgrade', handleUpgrade);
server.listen(PORT, () => {
  const proto = useHttps ? 'https' : 'http';
  console.log('\n  Ressoa está no ar!\n');
  console.log(`  Neste computador:  ${proto}://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  Na rede local:     ${proto}://${a.address}:${PORT}`);
    }
  }
  if (process.env.RENDER_EXTERNAL_URL) console.log(`  Endereço público:  ${process.env.RENDER_EXTERNAL_URL}`);
  else if (!useHttps) {
    console.log('\n  Aviso: microfone, câmera e tela só funcionam em "localhost" ou HTTPS.');
    console.log('  Para outros PCs, veja a seção "Usar em outros computadores" no README.md.\n');
  }
});

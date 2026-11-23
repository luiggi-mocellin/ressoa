'use strict';
// Liga mensagens WebSocket e pedidos HTTP aos controllers.
const ws = require('./lib/websocket');
const rate = require('./lib/rateLimit');
const cfg = require('./config');
const presence = require('./models/presence');
const notify = require('./controllers/notify');
const session = require('./controllers/sessionController');
const serverCtl = require('./controllers/serverController');
const channelCtl = require('./controllers/channelController');
const call = require('./controllers/callController');
const chat = require('./controllers/chatController');
const http = require('./controllers/httpController');

const wsRoutes = {
  hello: session.hello,
  'create-server': serverCtl.create,
  'delete-server': serverCtl.remove,
  'join-server': serverCtl.joinByInvite,
  'create-channel': channelCtl.create,
  'delete-channel': channelCtl.remove,
  join: call.join,
  leave: call.leave,
  state: call.state,
  signal: call.signal,
  history: chat.history,
  chat: chat.send,
};

function onConnection(conn) {
  const client = presence.add(conn);

  conn.on('message', (text) => {
    if (!rate.hit(client, 'all', cfg.RATE_ALL)) return conn.close();
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string' || !Object.hasOwn(wsRoutes, m.t)) return;
    if (m.t !== 'hello' && !client.user) return; // tudo exige sessão
    try { wsRoutes[m.t](client, m); } catch (err) { console.error('Erro ao tratar', m.t, err); }
  });

  conn.on('close', () => {
    call.leaveChannel(client);
    presence.remove(client);
    notify.broadcastSnapshot();
  });
}

// Bloqueia WebSocket aberto por outro site no navegador da vítima (CSWSH).
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // clientes fora do navegador não mandam Origin
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function handleUpgrade(req, socket) {
  if (!req.url.startsWith('/ws') || !sameOrigin(req)) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const conn = ws.accept(req, socket, cfg.MAX_MESSAGE_BYTES);
  if (!conn) return socket.destroy();
  onConnection(conn);
}

// Ping periódico: derruba conexões que pararam de responder.
function startHeartbeat() {
  const timer = setInterval(() => {
    for (const c of presence.all()) {
      if (!c.conn.alive) { c.conn.close(); continue; }
      c.conn.alive = false;
      c.conn.frame(0x9, Buffer.alloc(0));
    }
  }, 25000);
  timer.unref();
  return timer;
}

module.exports = { handleHttp: http.handle, handleUpgrade, startHeartbeat };

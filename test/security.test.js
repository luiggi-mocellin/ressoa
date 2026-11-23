'use strict';
// Testes de regressão dos achados da auditoria de segurança. Rode com: npm test  (Node 22+, usa WebSocket nativo)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ressoa-test-'));
delete process.env.TURN_URLS;
const { start } = require('../server');
const { Conn } = require('../src/lib/websocket');
const { resolvePublic } = require('../src/controllers/httpController');

let server, base, victim, attacker, priv, channelId;
before(async () => {
  server = start(0);
  await new Promise((r) => server.once('listening', r));
  base = `localhost:${server.address().port}`;
  victim = await connect('Vitima');
  attacker = await connect('Atacante');
  const created = victim.next('server-created');
  victim.send({ t: 'create-server', name: 'Privado' });
  const id = (await created).id;
  await wait(50);
  priv = victim.last('snapshot').servers.find((s) => s.id === id);
  channelId = priv.channels[0].id;
});
after(() => {
  victim?.ws.close();
  attacker?.ws.close();
  server.closeAllConnections?.();
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(name, token) {
  const ws = new WebSocket(`ws://${base}/ws`);
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const c = {
    ws, msgs,
    send: (m) => ws.send(JSON.stringify(m)),
    last: (t) => [...msgs].reverse().find((m) => m.t === t),
    async next(t, ms = 1000) {
      const seen = msgs.length;
      for (let i = 0; i < ms / 20; i++) {
        const hit = msgs.slice(seen).find((m) => m.t === t);
        if (hit) return hit;
        await wait(20);
      }
      return null;
    },
  };
  const welcome = c.next('welcome');
  c.send({ t: 'hello', name, token });
  c.welcome = await welcome;
  return c;
}


test('S1-01: servidor privado não aparece no snapshot de quem não é membro', async () => {
  assert.ok(priv.owner && priv.invite, 'dono vê o servidor com convite');
  await wait(50);
  assert.ok(!attacker.last('snapshot').servers.some((s) => s.id === priv.id));
});

test('S1-02: chat de servidor privado não chega a quem não é membro', async () => {
  const leak = attacker.next('chat', 300);
  victim.send({ t: 'chat', channelId, text: 'segredo' });
  assert.ok(await victim.next('chat'));
  assert.equal(await leak, null);
});

test('S3-03/S3-04/S3-05: history, join e chat são recusados para não-membro', async () => {
  attacker.send({ t: 'history', channelId });
  assert.equal(await attacker.next('history', 300), null);
  attacker.send({ t: 'join', channelId });
  assert.equal(await attacker.next('joined', 300), null);
  attacker.send({ t: 'chat', channelId, text: 'spam' });
  await wait(100);
  victim.send({ t: 'history', channelId });
  const h = await victim.next('history');
  assert.deepEqual(h.messages.map((m) => m.text), ['segredo']);
});

test('S3-01/S3-02/S3-06: não-dono não exclui servidor nem cria/exclui canais', async () => {
  attacker.send({ t: 'delete-server', serverId: priv.id });
  assert.ok(await attacker.next('error'));
  attacker.send({ t: 'create-channel', serverId: priv.id, name: 'x' });
  attacker.send({ t: 'delete-channel', channelId });
  await wait(100);
  const s = victim.last('snapshot').servers.find((x) => x.id === priv.id);
  assert.ok(s, 'servidor continua existindo');
  assert.equal(s.channels.length, 1);
});

test('S3-06: servidor público (Lobby) não aceita criar canais de ninguém', async () => {
  const lobby = attacker.welcome.servers.find((s) => !s.invite);
  attacker.send({ t: 'create-channel', serverId: lobby.id, name: 'x' });
  assert.ok(await attacker.next('error'));
});

test('S2-02: nome de outro usuário é recusado; hello repetido não troca a identidade', async () => {
  const impostor = new WebSocket(`ws://${base}/ws`);
  const got = new Promise((r) => { impostor.onmessage = (e) => r(JSON.parse(e.data)); });
  await new Promise((r) => { impostor.onopen = r; });
  impostor.send(JSON.stringify({ t: 'hello', name: 'vitima' }));
  assert.equal((await got).t, 'hello-error');
  impostor.close();

  attacker.send({ t: 'hello', name: 'Outro' });
  await wait(100);
  const lobby = attacker.welcome.servers.find((s) => !s.invite);
  attacker.send({ t: 'chat', channelId: lobby.channels[0].id, text: 'oi' });
  const msg = await attacker.next('chat');
  assert.equal(msg.message.author, 'Atacante');
});

test('S2-01: token reconecta a mesma conta e mantém a posse', async () => {
  const again = await connect('Vitima', victim.welcome.token);
  assert.equal(again.welcome.userId, victim.welcome.userId);
  assert.equal(again.welcome.token, null, 'token não é reenviado');
  assert.ok(again.welcome.servers.find((s) => s.id === priv.id).owner);
  again.ws.close();
});

test('convite: quem tem o código entra e passa a ler o canal', async () => {
  const guest = await connect('Convidado');
  guest.send({ t: 'join-server', code: 'codigo-errado' });
  assert.ok(await guest.next('error'));
  guest.send({ t: 'join-server', code: priv.invite });
  assert.equal((await guest.next('server-joined')).id, priv.id);
  guest.send({ t: 'history', channelId });
  assert.ok((await guest.next('history')).messages.length >= 1);
  const s = guest.last('snapshot').servers.find((x) => x.id === priv.id);
  assert.equal(s.owner, false);
  guest.ws.close();
});

test('S4-01: /config não existe mais e o ICE vem só no welcome', async () => {
  const res = await fetch(`http://${base}/config`);
  assert.equal(res.status, 404);
  assert.ok(Array.isArray(victim.welcome.ice.iceServers));
});

test('S5-01: respostas trazem CSP, nosniff e no-referrer', async () => {
  const res = await fetch(`http://${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('X-02: path traversal para pasta irmã "public*" é bloqueado', () => {
  assert.equal(resolvePublic('/..%2fpublic-backup/x.txt'), null);
  assert.equal(resolvePublic('/..%2fserver.js'), null);
  assert.ok(resolvePublic('/index.html'));
});

test('X-03: upgrade com Origin de outro site é recusado', async () => {
  const status = await new Promise((resolve) => {
    const req = http.request({
      host: 'localhost', port: server.address().port, path: '/ws',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', Origin: 'https://malicioso.example' },
    });
    req.on('upgrade', () => resolve(101));
    req.on('response', (r) => resolve(r.statusCode));
    req.on('error', () => resolve('erro'));
    req.end();
  });
  assert.equal(status, 403);
});

test('X-01: mensagem fragmentada acima do limite fecha a conexão', () => {
  const sock = Object.assign(new EventEmitter(), { write() {}, end() {}, destroyed: false });
  const conn = new Conn(sock, 1000);
  let closed = false;
  conn.on('close', () => { closed = true; });
  const frame = (fin, op, size) => {
    const hdr = Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | 126, size >> 8, size & 0xff, 0, 0, 0, 0]);
    return Buffer.concat([hdr, Buffer.alloc(size)]);
  };
  sock.emit('data', frame(false, 0x1, 600));
  assert.equal(closed, false);
  sock.emit('data', frame(false, 0x0, 600));
  assert.equal(closed, true);
});

test('S4-01: com TURN_SECRET a credencial é temporária (HMAC) e o segredo não sai do servidor', () => {
  const crypto = require('crypto');
  const { TURN } = require('../src/config');
  const turn = require('../src/services/turn');
  Object.assign(TURN, { urls: ['turn:turn.example:3478'], secret: 'segredo-de-teste', username: 'fixo', credential: 'fixa' });
  try {
    const t = turn.iceFor({ id: 'u1' }).iceServers[1];
    const [expiry, user] = t.username.split(':');
    assert.equal(user, 'u1');
    assert.ok(Number(expiry) > Date.now() / 1000);
    assert.equal(t.credential, crypto.createHmac('sha1', 'segredo-de-teste').update(t.username).digest('base64'));
    assert.ok(!JSON.stringify(t).includes('segredo-de-teste') && !JSON.stringify(t).includes('fixa'));
  } finally {
    Object.assign(TURN, { urls: [], secret: '', username: '', credential: '' });
  }
});

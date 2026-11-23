'use strict';
// Entrada/saída de chamadas e sinalização WebRTC.
const servers = require('../models/server');
const presence = require('../models/presence');
const view = require('../views/serverView');
const notify = require('./notify');

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

function leaveChannel(client) {
  const channelId = client.channelId;
  if (!channelId) return;
  client.channelId = null;
  client.state = {};
  for (const other of presence.inChannel(channelId)) other.conn.send({ t: 'peer-left', id: client.id });
}

function join(client, m) {
  const found = servers.findChannel(m.channelId);
  if (!found || !servers.canAccess(found.server, client.user.id)) return;
  leaveChannel(client);
  client.channelId = found.channel.id;
  client.state = sanitizeState(m.state);
  const others = presence.inChannel(client.channelId, client.id);
  for (const o of others) o.conn.send({ t: 'peer-joined', peer: view.peer(client) });
  client.conn.send({ t: 'joined', channelId: client.channelId, peers: others.map(view.peer) });
  notify.broadcastSnapshot();
}

function leave(client) {
  leaveChannel(client);
  notify.broadcastSnapshot();
}

function state(client, m) {
  if (!client.channelId) return;
  client.state = sanitizeState(m.state);
  for (const o of presence.inChannel(client.channelId, client.id)) o.conn.send({ t: 'peer-state', id: client.id, state: client.state });
  notify.broadcastSnapshot();
}

// Só repassa entre duas pessoas na mesma chamada.
function signal(client, m) {
  const target = presence.get(m.to);
  if (!target || !client.channelId || target.channelId !== client.channelId) return;
  target.conn.send({ t: 'signal', from: client.id, data: m.data });
}

module.exports = { join, leave, state, signal, leaveChannel };

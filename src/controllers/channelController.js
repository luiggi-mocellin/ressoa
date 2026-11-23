'use strict';
const servers = require('../models/server');
const messages = require('../models/message');
const presence = require('../models/presence');
const notify = require('./notify');
const rate = require('../lib/rateLimit');
const cfg = require('../config');
const { clean } = require('../lib/ids');

function create(client, m) {
  const server = servers.byId(m.serverId);
  const name = clean(m.name, 40);
  if (!server || !name || !servers.canAccess(server, client.user.id)) return;
  if (!servers.isOwner(server, client.user.id)) return notify.error(client, 'Só o dono do servidor pode criar canais.');
  if (server.channels.length >= cfg.MAX_CHANNELS_PER_SERVER) return notify.error(client, 'Limite de canais atingido.');
  if (!rate.hit(client, 'create', cfg.RATE_CREATE)) return notify.error(client, 'Muitas criações seguidas. Aguarde um pouco.');
  const channel = servers.addChannel(server, name);
  notify.broadcastSnapshot();
  client.conn.send({ t: 'channel-created', id: channel.id });
}

function remove(client, m) {
  const found = servers.findChannel(m.channelId);
  if (!found || !servers.canAccess(found.server, client.user.id)) return;
  if (!servers.isOwner(found.server, client.user.id)) return notify.error(client, 'Só o dono do servidor pode excluir canais.');
  if (presence.inChannel(found.channel.id).length) return notify.error(client, 'O canal tem pessoas em chamada.');
  if (found.server.channels.length === 1) return notify.error(client, 'O servidor precisa de pelo menos um canal.');
  servers.removeChannel(found.server, found.channel);
  messages.clear(found.channel.id);
  notify.broadcastSnapshot();
}

module.exports = { create, remove };

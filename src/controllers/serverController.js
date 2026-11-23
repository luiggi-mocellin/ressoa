'use strict';
const servers = require('../models/server');
const messages = require('../models/message');
const presence = require('../models/presence');
const notify = require('./notify');
const rate = require('../lib/rateLimit');
const cfg = require('../config');
const { clean } = require('../lib/ids');

const NOT_FOUND = 'Servidor não encontrado.';

function create(client, m) {
  const name = clean(m.name, 40);
  if (!name) return;
  if (!rate.hit(client, 'create', cfg.RATE_CREATE)) return notify.error(client, 'Muitas criações seguidas. Aguarde um pouco.');
  if (servers.ownedCount(client.user.id) >= cfg.MAX_SERVERS_PER_USER) {
    return notify.error(client, `Você já tem ${cfg.MAX_SERVERS_PER_USER} servidores.`);
  }
  const server = servers.create(name, client.user.id);
  notify.broadcastSnapshot();
  client.conn.send({ t: 'server-created', id: server.id });
}

function remove(client, m) {
  const server = servers.byId(m.serverId);
  // Quem não tem acesso recebe a mesma resposta de "não existe", para não revelar IDs.
  if (!server || !servers.canAccess(server, client.user.id)) return notify.error(client, NOT_FOUND);
  if (!servers.isOwner(server, client.user.id)) return notify.error(client, 'Só o dono pode excluir este servidor.');
  if (server.channels.some((ch) => presence.inChannel(ch.id).length)) {
    return notify.error(client, 'Há pessoas em chamada neste servidor.');
  }
  servers.remove(server);
  for (const ch of server.channels) messages.clear(ch.id);
  notify.broadcastSnapshot();
}

function joinByInvite(client, m) {
  const server = servers.byInvite(m.code);
  if (!server) return notify.error(client, 'Convite inválido ou servidor excluído.');
  servers.addMember(server, client.user.id);
  notify.broadcastSnapshot();
  client.conn.send({ t: 'server-joined', id: server.id });
}

module.exports = { create, remove, joinByInvite };

'use strict';
// Quem está conectado agora (só em memória). Uma conexão = um cliente; um usuário pode ter várias.
const { uid } = require('../lib/ids');

const clients = new Map(); // id -> { id, conn, user, channelId, state }

function add(conn) {
  const client = { id: uid(), conn, user: null, channelId: null, state: {} };
  clients.set(client.id, client);
  return client;
}

const remove = (client) => clients.delete(client.id);
const get = (id) => (typeof id === 'string' ? clients.get(id) : undefined);
const all = () => [...clients.values()];
const online = () => all().filter((c) => c.user);
const inChannel = (channelId, exceptId) => online().filter((c) => c.channelId === channelId && c.id !== exceptId);

module.exports = { add, remove, get, all, online, inChannel };

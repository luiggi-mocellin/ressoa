'use strict';
// Envio de atualizações respeitando o que cada um pode ver.
const presence = require('../models/presence');
const servers = require('../models/server');
const view = require('../views/serverView');

function broadcastSnapshot() {
  for (const c of presence.online()) c.conn.send({ t: 'snapshot', servers: view.serversFor(c.user) });
}

function toServer(server, payload) {
  for (const c of presence.online()) if (servers.canAccess(server, c.user.id)) c.conn.send(payload);
}

const error = (client, message) => client.conn.send({ t: 'error', message });

module.exports = { broadcastSnapshot, toServer, error };

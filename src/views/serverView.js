'use strict';
// O que cada usuário enxerga: só servidores a que tem acesso, e presença só dentro deles.
const servers = require('../models/server');
const presence = require('../models/presence');

const peer = (c) => ({ id: c.id, name: c.user.name, state: c.state });

function serversFor(user) {
  const online = presence.online();
  return servers.visibleTo(user.id).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    owner: servers.isOwner(s, user.id),
    invite: s.public ? null : s.invite,
    channels: s.channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      members: online.filter((c) => c.channelId === ch.id).map(peer),
    })),
  }));
}

module.exports = { peer, serversFor };

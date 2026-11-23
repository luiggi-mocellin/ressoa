'use strict';
// Servidores (grupos de canais), seus donos, membros e convites.
const { db, save } = require('./store');
const { uid, secret } = require('../lib/ids');

const PALETTE = ['#2dd4bf', '#f59e0b', '#f472b6', '#60a5fa', '#a3e635', '#fb7185', '#c084fc', '#facc15'];

function build(name, ownerId, channelNames = ['Geral']) {
  return {
    id: uid(),
    name,
    color: PALETTE[db.servers.length % PALETTE.length],
    ownerId,
    public: !ownerId,
    invite: ownerId ? secret() : null,
    members: ownerId ? [ownerId] : [],
    channels: channelNames.map((n) => ({ id: uid(), name: n })),
  };
}

// Migração: servidores antigos não têm dono. Eles continuam públicos (como eram) e não podem ser excluídos.
for (const s of db.servers) {
  if (!s.ownerId) Object.assign(s, { ownerId: null, public: true, invite: null });
  s.members = s.members || [];
}
// Sempre existe um servidor público para quem acabou de chegar.
if (!db.servers.some((s) => s.public)) db.servers.unshift(build('Lobby', null, ['Geral', 'Jogos', 'Trabalho']));
save();

const canAccess = (server, userId) => server.public || server.members.includes(userId);
const isOwner = (server, userId) => !!server.ownerId && server.ownerId === userId;

function byId(id) {
  return db.servers.find((s) => s.id === id) || null;
}

function byInvite(code) {
  if (typeof code !== 'string' || !code) return null;
  return db.servers.find((s) => s.invite && s.invite === code) || null;
}

function findChannel(channelId) {
  for (const server of db.servers) {
    const channel = server.channels.find((c) => c.id === channelId);
    if (channel) return { server, channel };
  }
  return null;
}

const visibleTo = (userId) => db.servers.filter((s) => canAccess(s, userId));
const ownedCount = (userId) => db.servers.filter((s) => s.ownerId === userId).length;

function create(name, ownerId) {
  const server = build(name, ownerId);
  db.servers.push(server);
  save();
  return server;
}

function remove(server) {
  db.servers = db.servers.filter((s) => s !== server);
  save();
}

function addMember(server, userId) {
  if (server.public || server.members.includes(userId)) return;
  server.members.push(userId);
  save();
}

function addChannel(server, name) {
  const channel = { id: uid(), name };
  server.channels.push(channel);
  save();
  return channel;
}

function removeChannel(server, channel) {
  server.channels = server.channels.filter((c) => c !== channel);
  save();
}

module.exports = {
  canAccess, isOwner, byId, byInvite, findChannel, visibleTo, ownedCount,
  create, remove, addMember, addChannel, removeChannel,
};

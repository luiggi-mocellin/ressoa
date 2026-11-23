'use strict';
// Histórico de chat por canal.
const { db, save } = require('./store');
const { uid } = require('../lib/ids');
const cfg = require('../config');

const history = (channelId) => db.messages[channelId] || [];

function append(channelId, user, text) {
  const msg = { id: uid(), authorId: user.id, author: user.name, text, ts: Date.now() };
  const list = (db.messages[channelId] = db.messages[channelId] || []);
  list.push(msg);
  if (list.length > cfg.MAX_HISTORY) list.splice(0, list.length - cfg.MAX_HISTORY);
  save();
  return msg;
}

function clear(channelId) {
  delete db.messages[channelId];
  save();
}

module.exports = { history, append, clear };

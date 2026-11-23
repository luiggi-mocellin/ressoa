'use strict';
const servers = require('../models/server');
const messages = require('../models/message');
const notify = require('./notify');
const rate = require('../lib/rateLimit');
const cfg = require('../config');

// Canal acessível pelo cliente, ou null.
function accessible(client, channelId) {
  const found = servers.findChannel(channelId);
  return found && servers.canAccess(found.server, client.user.id) ? found : null;
}

function history(client, m) {
  const found = accessible(client, m.channelId);
  if (!found) return;
  client.conn.send({ t: 'history', channelId: found.channel.id, messages: messages.history(found.channel.id) });
}

function send(client, m) {
  const text = String(m.text ?? '').trim().slice(0, 2000);
  const found = text && accessible(client, m.channelId);
  if (!found) return;
  if (!rate.hit(client, 'chat', cfg.RATE_CHAT)) return notify.error(client, 'Você está enviando mensagens rápido demais.');
  const message = messages.append(found.channel.id, client.user, text);
  notify.toServer(found.server, { t: 'chat', channelId: found.channel.id, message });
}

module.exports = { history, send };

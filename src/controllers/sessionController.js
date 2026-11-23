'use strict';
const users = require('../models/user');
const view = require('../views/serverView');
const turn = require('../services/turn');
const notify = require('./notify');
const { clean } = require('../lib/ids');

// Primeira mensagem de toda conexão. O token (se houver) recupera a conta; sem ele, cria uma nova.
function hello(client, m) {
  if (client.user) return; // identidade não muda no meio da conexão
  const name = clean(m.name, 32);
  if (!name) return client.conn.send({ t: 'hello-error', message: 'Escolha um nome.' });

  let user = users.findByToken(m.token);
  const owner = users.findByName(name);
  if (owner && owner !== user) {
    return client.conn.send({ t: 'hello-error', message: 'Esse nome já está em uso. Escolha outro.' });
  }
  let token = null;
  if (user) {
    users.rename(user, name);
  } else {
    const created = users.create(name);
    if (!created) return client.conn.send({ t: 'hello-error', message: 'O servidor atingiu o limite de contas.' });
    ({ user, token } = created);
  }

  client.user = user;
  client.conn.send({
    t: 'welcome',
    id: client.id,
    userId: user.id,
    token, // só vem quando a conta é nova; o navegador guarda
    servers: view.serversFor(user),
    ice: turn.iceFor(user),
  });
  notify.broadcastSnapshot();
}

module.exports = { hello };

'use strict';
// Contas: um token aleatório por navegador identifica o usuário. Só o hash fica salvo.
const { db, save } = require('./store');
const { uid, secret, hash } = require('../lib/ids');
const cfg = require('../config');

const byTokenHash = new Map(Object.values(db.users).map((u) => [u.tokenHash, u]));
const key = (name) => name.toLocaleLowerCase('pt-BR');

function findByToken(token) {
  if (typeof token !== 'string' || !token || token.length > 100) return null;
  return byTokenHash.get(hash(token)) || null;
}

function findByName(name) {
  const k = key(name);
  return Object.values(db.users).find((u) => key(u.name) === k) || null;
}

// Devolve { user, token } ou null se o limite de contas foi atingido.
function create(name) {
  if (Object.keys(db.users).length >= cfg.MAX_USERS) return null;
  const token = secret();
  const user = { id: uid(), name, tokenHash: hash(token), createdAt: Date.now() };
  db.users[user.id] = user;
  byTokenHash.set(user.tokenHash, user);
  save();
  return { user, token };
}

function rename(user, name) {
  if (user.name === name) return;
  user.name = name;
  save();
}

module.exports = { findByToken, findByName, create, rename };

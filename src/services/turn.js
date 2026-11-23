'use strict';
// Servidores STUN/TURN entregues ao navegador.
// Com TURN_SECRET: credenciais temporárias no formato "TURN REST API" (coturn: use-auth-secret / static-auth-secret).
const crypto = require('crypto');
const { TURN } = require('../config');

const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };

function iceFor(user) {
  const iceServers = [STUN];
  if (!TURN.urls.length) return { iceServers };
  if (TURN.secret) {
    const username = `${Math.floor(Date.now() / 1000) + TURN.ttlSeconds}:${user.id}`;
    const credential = crypto.createHmac('sha1', TURN.secret).update(username).digest('base64');
    iceServers.push({ urls: TURN.urls, username, credential });
  } else if (TURN.username) {
    iceServers.push({ urls: TURN.urls, username: TURN.username, credential: TURN.credential });
  }
  return { iceServers };
}

const usesStaticCredentials = () => TURN.urls.length > 0 && !TURN.secret && !!TURN.username;

module.exports = { iceFor, usesStaticCredentials };

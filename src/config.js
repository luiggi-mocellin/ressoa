'use strict';
// Configuração central: caminhos, limites e variáveis de ambiente.
const path = require('path');

const ROOT = path.join(__dirname, '..');
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  // Dados ficam fora da pasta do código e fora do git (ver .gitignore).
  DATA_DIR: process.env.DATA_DIR || path.join(ROOT, 'data'),
  LEGACY_DATA_FILE: path.join(ROOT, 'data.json'),
  CERT_DIR: path.join(ROOT, 'cert'),

  MAX_HISTORY: 200,
  MAX_MESSAGE_BYTES: 256 * 1024, // soma de todos os fragmentos de uma mensagem WebSocket
  MAX_CHANNELS_PER_SERVER: 50,
  MAX_SERVERS_PER_USER: 10,
  // shortcut: teto fixo de contas para não deixar o data.json crescer sem fim; trocar por expiração de contas inativas se o app crescer.
  MAX_USERS: 10000,
  RATE_ALL: { windowMs: 5000, max: 300 }, // por conexão; acima disso a conexão é fechada
  RATE_CHAT: { windowMs: 10000, max: 20 },
  RATE_CREATE: { windowMs: 60000, max: 10 },

  TURN: {
    urls: list(process.env.TURN_URLS),
    secret: process.env.TURN_SECRET || '', // preferido: credenciais temporárias (coturn use-auth-secret)
    username: process.env.TURN_USERNAME || '',
    credential: process.env.TURN_CREDENTIAL || '',
    ttlSeconds: 24 * 60 * 60,
  },
};

'use strict';
// Persistência em JSON. Todos os models leem e gravam o mesmo objeto `db`.
const fs = require('fs');
const path = require('path');
const cfg = require('../config');

const FILE = path.join(cfg.DATA_DIR, 'data.json');

function load() {
  // Lê o local novo e, se não existir, o data.json antigo da raiz (migração).
  for (const file of [FILE, cfg.LEGACY_DATA_FILE]) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data.servers)) return data;
    } catch {}
  }
  return { servers: [] };
}

const db = load();
db.messages = db.messages || {};
db.users = db.users || {};

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

function flush() {
  clearTimeout(timer);
  try {
    fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
    // Grava num temporário e renomeia: uma queda no meio não corrompe o arquivo.
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 2));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (err) {
    console.error('Falha ao salvar dados:', err.message);
  }
}

module.exports = { db, save, flush };

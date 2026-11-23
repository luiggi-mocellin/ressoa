'use strict';
const crypto = require('crypto');

module.exports = {
  uid: () => crypto.randomBytes(6).toString('hex'),
  secret: () => crypto.randomBytes(24).toString('base64url'),
  hash: (s) => crypto.createHash('sha256').update(s).digest('hex'),
  clean: (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max),
};

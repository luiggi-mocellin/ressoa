'use strict';
// Arquivos estáticos e health check.
const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('../config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', // o link de convite leva um segredo na URL
};

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers }).end(body);
}

// Caminho dentro de public/ ou null se escapar dela.
function resolvePublic(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, rel);
  const r = path.relative(PUBLIC_DIR, file);
  if (!r || r === '..' || r.startsWith('..' + path.sep) || path.isAbsolute(r)) return null;
  return file;
}

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return send(res, 200, { 'Content-Type': 'text/plain' }, 'ok');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { Allow: 'GET, HEAD' });
  const file = resolvePublic(url.pathname);
  if (!file) return send(res, 403, {});
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Não encontrado');
    send(res, 200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, data);
  });
}

module.exports = { handle, resolvePublic };

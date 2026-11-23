// Ressoa — servidor de sinalização + arquivos estáticos.
// Zero dependências: precisa apenas do Node.js 18+.
// Estrutura MVC em src/: models (dados), views (o que cada usuário vê), controllers (ações), routes.js (ligações).
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('./src/config');
const routes = require('./src/routes');
const turn = require('./src/services/turn');
const store = require('./src/models/store');

function start(port = cfg.PORT) {
  const keyFile = path.join(cfg.CERT_DIR, 'key.pem');
  const certFile = path.join(cfg.CERT_DIR, 'cert.pem');
  const useHttps = fs.existsSync(keyFile) && fs.existsSync(certFile);
  const server = useHttps
    ? https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, routes.handleHttp)
    : http.createServer(routes.handleHttp);

  server.on('upgrade', routes.handleUpgrade);
  routes.startHeartbeat();
  server.listen(port, () => {
    if (require.main !== module) return;
    const proto = useHttps ? 'https' : 'http';
    console.log('\n  Ressoa está no ar!\n');
    console.log(`  Neste computador:  ${proto}://localhost:${server.address().port}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  Na rede local:     ${proto}://${a.address}:${server.address().port}`);
      }
    }
    if (process.env.RENDER_EXTERNAL_URL) console.log(`  Endereço público:  ${process.env.RENDER_EXTERNAL_URL}`);
    else if (!useHttps) {
      console.log('\n  Aviso: microfone, câmera e tela só funcionam em "localhost" ou HTTPS.');
      console.log('  Para outros PCs, veja a seção "Usar em outros computadores" no README.md.\n');
    }
    if (turn.usesStaticCredentials()) {
      console.warn('  Aviso: TURN com usuário/senha fixos. Prefira TURN_SECRET (credenciais temporárias).\n');
    }
  });
  return server;
}

if (require.main === module) {
  start();
  // Grava pendências antes de sair (Ctrl+C ou parada do Render).
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });
}

module.exports = { start };

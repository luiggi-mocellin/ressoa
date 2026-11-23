// Ressoa Desktop — janela própria que abre o servidor Ressoa escolhido,
// com seletor de tela/janela e captura do áudio do sistema no Windows.
'use strict';

const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, session, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(s) ? 'http://' : 'https://') + s;
  try {
    const u = new URL(s);
    return u.origin;
  } catch {
    return null;
  }
}

const config = readConfig();
const serverUrl = normalizeUrl(config.serverUrl);

// Em http:// (rede local) o Chromium bloqueia microfone e tela; liberamos só para o servidor escolhido.
if (serverUrl && serverUrl.startsWith('http://')) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', serverUrl);
}
// Permite tocar áudio sem precisar de clique antes.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#0b0d12',
    title: 'Ressoa',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false, // chamada continua fluida com a janela minimizada
    },
  });

  if (serverUrl) win.loadURL(serverUrl);
  else win.loadFile(path.join(__dirname, 'setup.html'));

  // Links externos abrem no navegador padrão.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = (serverUrl && url.startsWith(serverUrl)) || url.startsWith('file:');
    if (!allowed) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3 || !serverUrl || !url.startsWith(serverUrl)) return; // -3 = navegação cancelada
    win.loadFile(path.join(__dirname, 'setup.html'), { query: { erro: `${desc} (${code})`, url: serverUrl } });
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Ressoa',
      submenu: [
        { label: 'Trocar servidor…', click: () => win.loadFile(path.join(__dirname, 'setup.html'), { query: { url: serverUrl || '' } }) },
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { label: 'Procurar atualizações', click: () => checkForUpdates(true) },
        { label: `Versão ${app.getVersion()}`, enabled: false },
        { type: 'separator' },
        { label: 'Ferramentas do desenvolvedor', accelerator: 'CmdOrCtrl+Shift+I', click: () => win.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { role: 'resetZoom', label: 'Zoom padrão' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- permissões
function setupPermissions() {
  const ses = session.defaultSession;
  const trusted = (origin) => !!serverUrl && String(origin || '').startsWith(serverUrl);
  const allowedKinds = new Set(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen', 'notifications', 'speaker-selection']);

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowedKinds.has(permission) && trusted(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowedKinds.has(permission) && trusted(origin));

  // Seletor próprio para compartilhar tela ou janela.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    let answered = false;
    const answer = (streams) => {
      if (answered) return;
      answered = true;
      try { callback(streams); } catch (err) { console.error('Resposta do seletor recusada:', err.message); }
    };
    openPicker(request.audioRequested)
      .then((choice) => {
        if (!choice) return answer(); // cancelado: a página recebe um erro e segue normalmente
        const streams = { video: choice.source };
        // Áudio do sistema SEM o som do próprio Ressoa (as vozes da chamada não voltam para os outros).
        if (choice.audio && process.platform === 'win32') streams.audio = 'loopbackWithoutChrome';
        answer(streams);
      })
      .catch((err) => {
        console.error('Falha no seletor de tela:', err);
        answer();
      });
  });
}

let pickerOpen = null;
async function openPicker(audioRequested) {
  if (pickerOpen) return null;
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  const list = sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen') ? 'screen' : 'window',
    thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
    icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
  }));

  const picker = new BrowserWindow({
    parent: win,
    modal: true,
    width: 760,
    height: 560,
    resizable: true,
    minimizable: false,
    maximizable: false,
    title: 'Compartilhar tela',
    backgroundColor: '#12151d',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true },
  });
  picker.setMenu(null);

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      pickerOpen = null;
      ipcMain.removeHandler('picker:sources');
      ipcMain.removeAllListeners('picker:choose');
      if (!picker.isDestroyed()) picker.close();
      resolve(value);
    };
    pickerOpen = picker;
    ipcMain.handle('picker:sources', () => ({ sources: list, audioRequested, canAudio: process.platform === 'win32' }));
    ipcMain.on('picker:choose', (_e, payload) => {
      if (!payload || !payload.id) return finish(null);
      const source = sources.find((s) => s.id === payload.id);
      finish(source ? { source, audio: !!payload.audio } : null);
    });
    picker.on('closed', () => finish(null));
    picker.loadFile(path.join(__dirname, 'picker.html'));
  });
}

// ---------------------------------------------------------------- tela de configuração
ipcMain.handle('setup:get', () => ({ serverUrl: serverUrl || '' }));
ipcMain.handle('setup:save', (_e, raw) => {
  const url = normalizeUrl(raw);
  if (!url) return { ok: false, error: 'Endereço inválido. Exemplo: https://ressoa-abcd.onrender.com' };
  writeConfig({ ...readConfig(), serverUrl: url });
  // Reinicia para aplicar as permissões ao novo servidor.
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

// ---------------------------------------------------------------- atualização automática
// Procura versões novas nos Releases do GitHub (configurado em package.json > build.publish),
// baixa em segundo plano e oferece reiniciar. Se ninguém reiniciar, instala ao fechar o app.
let updateReady = false;
let manualCheck = false;

function setupUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', message: `Baixando a versão ${info.version}…`, detail: 'Você pode continuar usando o Ressoa enquanto isso.' });
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', message: 'Você já está na versão mais recente.', detail: `Versão ${app.getVersion()}` });
    manualCheck = false;
  });
  autoUpdater.on('error', (err) => {
    console.error('Atualização falhou:', err && err.message);
    if (manualCheck) dialog.showMessageBox(win, { type: 'warning', message: 'Não foi possível procurar atualizações agora.', detail: 'Confira sua internet e tente de novo mais tarde.' });
    manualCheck = false;
  });
  autoUpdater.on('update-downloaded', async (info) => {
    manualCheck = false;
    if (updateReady) return;
    updateReady = true;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      message: `A versão ${info.version} do Ressoa está pronta.`,
      detail: 'Se estiver em uma chamada, escolha "Depois": a atualização é instalada quando você fechar o app.',
    });
    if (response === 0) autoUpdater.quitAndInstall(true, true);
  });

  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), 3 * 60 * 60 * 1000);
}

function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox(win, { type: 'info', message: 'Atualizações só funcionam no app instalado.' });
    return;
  }
  if (updateReady) {
    if (manual) autoUpdater.quitAndInstall(true, true);
    return;
  }
  manualCheck = manual;
  autoUpdater.checkForUpdates().catch(() => {});
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  setupPermissions();
  buildMenu();
  createWindow();
  setupUpdater();
});

app.on('window-all-closed', () => app.quit());

process.on('uncaughtException', (err) => {
  dialog.showErrorBox('Ressoa', String(err && err.stack ? err.stack : err));
});

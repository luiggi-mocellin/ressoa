'use strict';

/* ==================================================================
   Ressoa — cliente
   Sinalização via WebSocket, mídia via WebRTC (malha P2P,
   "perfect negotiation" para renegociar câmera e tela).
   ================================================================== */

// Padrão; substituído pelo que o servidor entregar em /config (inclui TURN, se configurado).
let ICE_CONFIG = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};
fetch('/config')
  .then((r) => (r.ok ? r.json() : null))
  .then((cfg) => { if (cfg && cfg.ice && Array.isArray(cfg.ice.iceServers)) ICE_CONFIG = cfg.ice; })
  .catch(() => {});

// ---------------------------------------------------------------- utilidades
const $ = (sel, el = document) => el.querySelector(sel);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const I = {
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>'),
  micOff: svg('<path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5 2.2M5 10a7 7 0 0 0 11.5 5.4M19 10a7 7 0 0 1-.5 2.5M12 17v4M8 21h8M3 3l18 18"/>'),
  head: svg('<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>'),
  headOff: svg('<path d="M3 14v-2a9 9 0 0 1 14.5-7.1M21 12v2"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/><path d="M3 3l18 18"/>'),
  cam: svg('<rect x="2" y="6" width="14" height="12" rx="3"/><path d="M16 10.5l6-3.5v10l-6-3.5"/>'),
  camOff: svg('<path d="M16 16v1a1 1 0 0 1-1 1H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h1M10 6h3a3 3 0 0 1 3 3v1.5l6-3.5v10M3 3l18 18"/>'),
  screen: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v6"/>'),
  screenStop: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M9 7l6 6M15 7l-6 6"/>'),
  hangup: svg('<path d="M3 15.5c5.5-5 12.5-5 18 0l-2.5 3-3.5-1.5v-3a12 12 0 0 0-6 0v3L5.5 18.5z"/>'),
  voice: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  link: svg('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>'),
  expand: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  vol: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'),
  volOff: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
};

function colorFor(str) {
  let hash = 0;
  for (const ch of String(str)) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 70% 62%)`;
}
function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] || '')).toUpperCase();
}
function avatar(name, cls = '') {
  return h('div', { class: `avatar ${cls}`, style: `--c:${colorFor(name)}` }, initials(name));
}
function toast(text, ms = 3500) {
  const el = h('div', { class: 'toast' }, text);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
  return null;
}

// Sons curtos de entrar/sair, gerados na hora.
let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function blip(up = true) {
  try {
    const ac = ctx();
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t = ac.currentTime;
    o.frequency.setValueAtTime(up ? 520 : 660, t);
    o.frequency.exponentialRampToValueAtTime(up ? 880 : 380, t + 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + 0.25);
  } catch {}
}

// ---------------------------------------------------------------- estado
const S = {
  me: null,
  name: '',
  servers: [],
  serverId: null,
  viewChannel: null,
  voiceChannel: null,
  peers: new Map(),
  mic: null, micStream: null,
  cam: null, camStream: null,
  screenStream: null,
  muted: store('ressoa.muted') === '1',
  deafened: false,
  messages: {},
  unread: {},
  focus: null,
  tiles: new Map(),
  levels: new Map(), // chave -> { analyser, data }
  speaking: new Set(),
  rms: new Map(),
  micRaw: null, micSrc: null, micGraph: null,
  prefs: loadJSON('ressoa.prefs', {}), // volume por pessoa (chave = nome)
  cfg: Object.assign(
    { micId: '', outId: '', noise: true, echo: true, agc: true, micGain: 1, outVol: 1, screenQuality: '1080p30', screenAudio: true },
    loadJSON('ressoa.cfg', {})
  ),
};

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
const prefFor = (name) => Object.assign({ v: 1, s: 1, m: false }, S.prefs[name]);
function setPref(name, patch) {
  S.prefs[name] = Object.assign(prefFor(name), patch);
  saveJSON('ressoa.prefs', S.prefs);
  for (const p of S.peers.values()) if (p.name === name) applyVolumes(p);
}

const SCREEN_QUALITY = {
  '720p30': { width: 1280, height: 720, frameRate: 30, bitrate: 2_500_000 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, bitrate: 4_000_000 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, bitrate: 8_000_000 },
  '1440p60': { width: 2560, height: 1440, frameRate: 60, bitrate: 12_000_000 },
};

const server = () => S.servers.find((s) => s.id === S.serverId);
function channelById(id) {
  for (const s of S.servers) {
    const c = s.channels.find((c) => c.id === id);
    if (c) return { server: s, channel: c };
  }
  return null;
}

// ---------------------------------------------------------------- WebSocket
let ws = null;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => send({ t: 'hello', name: S.name });
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMessage(m);
  };
  ws.onclose = () => {
    if (S.voiceChannel) cleanupCall();
    toast('Conexão com o servidor perdida. Reconectando…');
    setTimeout(connect, 2000);
  };
}
function send(m) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome': {
      S.me = m.id;
      S.servers = m.servers;
      const wanted = new URLSearchParams(location.search).get('s') || store('ressoa.server');
      selectServer(S.servers.some((s) => s.id === wanted) ? wanted : S.servers[0]?.id);
      break;
    }
    case 'snapshot':
      S.servers = m.servers;
      if (!server()) selectServer(S.servers[0]?.id);
      else if (!channelById(S.viewChannel)) selectChannel(server().channels[0]?.id);
      renderAll();
      break;
    case 'server-created':
      selectServer(m.id);
      break;
    case 'channel-created':
      selectChannel(m.id);
      break;
    case 'joined':
      S.voiceChannel = m.channelId;
      for (const p of m.peers) createPeer(p);
      blip(true);
      renderAll();
      break;
    case 'peer-joined':
      createPeer(m.peer);
      blip(true);
      renderStage();
      break;
    case 'peer-left':
      closePeer(m.id);
      blip(false);
      renderStage();
      break;
    case 'peer-state': {
      const p = S.peers.get(m.id);
      if (p) {
        const hadScreen = p.state.screen;
        p.state = m.state || {};
        applyVolumes(p);
        if (!hadScreen && p.state.screen && !S.focus) S.focus = `${p.id}:screen`;
        renderStage();
      }
      break;
    }
    case 'signal':
      onSignal(m.from, m.data);
      break;
    case 'history':
      S.messages[m.channelId] = m.messages;
      if (m.channelId === S.viewChannel) renderChat();
      break;
    case 'chat': {
      const list = S.messages[m.channelId];
      if (list) list.push(m.message);
      if (m.channelId === S.viewChannel) renderChat();
      else {
        S.unread[m.channelId] = (S.unread[m.channelId] || 0) + 1;
        renderChannels();
      }
      break;
    }
    case 'error':
      toast(m.message);
      break;
  }
}

// ---------------------------------------------------------------- navegação
function selectServer(id) {
  if (!id) return;
  S.serverId = id;
  store('ressoa.server', id);
  const s = server();
  const keep = s.channels.some((c) => c.id === S.viewChannel);
  if (!keep) {
    const voiceHere = s.channels.find((c) => c.id === S.voiceChannel);
    selectChannel((voiceHere || s.channels[0])?.id, false);
  }
  renderAll();
}

function selectChannel(id, render = true) {
  if (!id) return;
  S.viewChannel = id;
  delete S.unread[id];
  if (!S.messages[id]) send({ t: 'history', channelId: id });
  if (render) renderAll();
}

// ---------------------------------------------------------------- chamada
function currentState() {
  return {
    muted: S.muted || S.deafened,
    deafened: S.deafened,
    camera: !!S.cam,
    screen: !!S.screenStream,
    micStreamId: S.micStream?.id || null,
    camStreamId: S.camStream?.id || null,
    screenStreamId: S.screenStream?.id || null,
  };
}
const sendState = () => S.voiceChannel && send({ t: 'state', state: currentState() });

let joining = false;
async function joinVoice(channelId) {
  if (joining || S.voiceChannel === channelId) return;
  if (!navigator.mediaDevices) {
    toast('Microfone, câmera e tela exigem HTTPS ou localhost. Veja o README.', 6000);
    return;
  }
  joining = true;
  ctx(); // libera o áudio após o clique do usuário
  if (S.voiceChannel) leaveVoice(false);
  if (!S.mic) {
    try {
      await openMic();
    } catch {
      toast('Microfone indisponível — você vai entrar só ouvindo.', 5000);
    }
  }
  masterGain();
  joining = false;
  send({ t: 'join', channelId, state: currentState() });
}

function leaveVoice(notify = true) {
  if (!S.voiceChannel) return;
  if (notify) send({ t: 'leave' });
  cleanupCall();
  if (notify) blip(false);
  renderAll();
}

function cleanupCall() {
  for (const id of [...S.peers.keys()]) closePeer(id);
  stopCam(false);
  stopScreen(false);
  closeMic();
  S.voiceChannel = null;
  S.focus = null;
  renderAll();
}

function applyMute() {
  if (S.mic) S.mic.enabled = !(S.muted || S.deafened);
}

// ---------------------------------------------------------------- áudio
// Microfone: dispositivo -> ganho -> faixa enviada. Trocar de dispositivo ou
// de filtro só religa a entrada; a faixa enviada aos outros continua a mesma.
async function openMic() {
  const base = { echoCancellation: S.cfg.echo, noiseSuppression: S.cfg.noise, autoGainControl: S.cfg.agc };
  let raw;
  try {
    raw = await navigator.mediaDevices.getUserMedia({
      audio: S.cfg.micId ? { ...base, deviceId: { exact: S.cfg.micId } } : base,
    });
  } catch (e) {
    if (!S.cfg.micId) throw e;
    raw = await navigator.mediaDevices.getUserMedia({ audio: base }); // dispositivo salvo sumiu
  }
  const ac = ctx();
  if (!S.micGraph) {
    const gain = ac.createGain();
    const dest = ac.createMediaStreamDestination();
    gain.connect(dest);
    S.micGraph = { gain, dest };
    S.micStream = dest.stream;
    S.mic = dest.stream.getAudioTracks()[0];
    watchLevel('me', S.micStream);
  }
  if (S.micRaw) {
    S.micRaw.getTracks().forEach((t) => t.stop());
    try { S.micSrc.disconnect(); } catch {}
  }
  S.micRaw = raw;
  S.micSrc = ac.createMediaStreamSource(raw);
  S.micSrc.connect(S.micGraph.gain);
  S.micGraph.gain.value = S.cfg.micGain;
  applyMute();
}

function closeMic() {
  if (S.micRaw) S.micRaw.getTracks().forEach((t) => t.stop());
  try { S.micSrc?.disconnect(); } catch {}
  if (S.mic) S.mic.stop();
  S.micRaw = S.micSrc = S.micGraph = S.mic = S.micStream = null;
  unwatchLevel('me');
}

// Saída: cada faixa recebida -> ganho próprio (volume da pessoa ou da tela) -> ganho geral.
let master = null;
function masterGain() {
  const ac = ctx();
  if (!master) {
    master = ac.createGain();
    master.connect(ac.destination);
    if (S.cfg.outId && ac.setSinkId) ac.setSinkId(S.cfg.outId).catch(() => {});
  }
  master.gain.value = S.deafened ? 0 : S.cfg.outVol;
  return master;
}

function applyVolumes(p) {
  const pref = prefFor(p.name);
  for (const a of Object.values(p.audio)) {
    const isScreen = a.streamId === p.state.screenStreamId;
    a.gain.gain.value = pref.m ? 0 : isScreen ? pref.s : pref.v;
  }
}

function toggleMute() {
  if (S.deafened) { toggleDeafen(); return; }
  S.muted = !S.muted;
  store('ressoa.muted', S.muted ? '1' : '0');
  applyMute();
  sendState();
  renderAll();
}

function toggleDeafen() {
  S.deafened = !S.deafened;
  masterGain();
  applyMute();
  sendState();
  renderAll();
}

async function toggleCam() {
  if (!S.voiceChannel) return;
  if (S.cam) { stopCam(); return; }
  try {
    const st = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    S.cam = st.getVideoTracks()[0];
    S.camStream = st;
    S.cam.onended = () => stopCam();
    for (const p of S.peers.values()) p.senders.cam = p.pc.addTrack(S.cam, S.camStream);
  } catch {
    toast('Não foi possível acessar a câmera.');
    return;
  }
  sendState();
  renderAll();
}

function stopCam(update = true) {
  if (!S.cam) return;
  for (const p of S.peers.values()) {
    if (p.senders.cam) {
      try { p.pc.removeTrack(p.senders.cam); } catch {}
      delete p.senders.cam;
    }
  }
  S.cam.stop();
  S.cam = null;
  S.camStream = null;
  if (update) { sendState(); renderAll(); }
}

async function toggleScreen() {
  if (!S.voiceChannel) return;
  if (S.screenStream) { stopScreen(); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast('Seu navegador não suporta compartilhamento de tela.');
    return;
  }
  try {
    const q = SCREEN_QUALITY[S.cfg.screenQuality] || SCREEN_QUALITY['1080p30'];
    const st = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: q.frameRate, max: q.frameRate }, width: { ideal: q.width }, height: { ideal: q.height } },
      // Áudio da aba/sistema sem nenhum filtro de voz: é música, jogo ou vídeo.
      audio: S.cfg.screenAudio ? { ...RAW_AUDIO, channelCount: 2, suppressLocalAudioPlayback: false } : false,
    });
    if (!S.voiceChannel) { st.getTracks().forEach((t) => t.stop()); return; }
    for (const t of st.getAudioTracks()) {
      t.contentHint = 'music';
      t.applyConstraints(RAW_AUDIO).catch(() => {});
    }
    S.screenStream = st;
    const video = st.getVideoTracks()[0];
    if (video) {
      video.contentHint = 'detail';
      video.onended = () => stopScreen();
    }
    for (const p of S.peers.values()) addScreenTracks(p);
    S.focus = 'me:screen';
  } catch (e) {
    if (e && e.name !== 'NotAllowedError') toast('Não foi possível compartilhar a tela.');
    return;
  }
  sendState();
  renderAll();
}

function addScreenTracks(p) {
  for (const t of S.screenStream.getTracks()) {
    const sender = p.pc.addTrack(t, S.screenStream);
    p.senders[`screen-${t.kind}`] = sender;
    if (t.kind === 'video') tuneScreenSender(sender);
    else setAudioBitrate(sender, 160_000);
  }
}

// Sem isto o navegador trata tudo como voz em mono e ~32 kbps, o que
// "achata" música e o som de jogos/vídeos.
const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const OPUS_PARAMS = { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: '160000', usedtx: '0', useinbandfec: '1' };

function setAudioBitrate(sender, bps) {
  try {
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = bps;
    sender.setParameters(params).catch(() => {});
  } catch {}
}

function tuneSdp(sdp) {
  // Cada canal de áudio (voz, tela) tem sua própria linha: ajusta todas (flag g).
  const pts = [...new Set([...sdp.matchAll(/a=rtpmap:(\d+) opus\/48000\/2/gi)].map((m) => m[1]))];
  for (const pt of pts) {
    const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g');
    if (new RegExp(`a=fmtp:${pt} `).test(sdp)) {
      sdp = sdp.replace(fmtp, (_, params) => {
        const map = new Map(params.split(';').map((s) => s.trim()).filter(Boolean).map((kv) => kv.split('=')));
        for (const [k, v] of Object.entries(OPUS_PARAMS)) map.set(k, v);
        return `a=fmtp:${pt} ${[...map].map(([k, v]) => `${k}=${v}`).join(';')}`;
      });
    } else {
      const line = Object.entries(OPUS_PARAMS).map(([k, v]) => `${k}=${v}`).join(';');
      sdp = sdp.replace(new RegExp(`(a=rtpmap:${pt} opus\\/48000\\/2\\r?\\n)`, 'gi'), `$1a=fmtp:${pt} ${line}\r\n`);
    }
  }
  return sdp;
}

async function setLocal(pc, type) {
  const desc = type === 'offer' ? await pc.createOffer() : await pc.createAnswer();
  if (type === 'offer' && pc.signalingState !== 'stable') return false;
  await pc.setLocalDescription({ type: desc.type, sdp: tuneSdp(desc.sdp) });
  return true;
}

function tuneScreenSender(sender) {
  // Mais banda para a tela ficar legível.
  try {
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) return;
    params.encodings[0].maxBitrate = (SCREEN_QUALITY[S.cfg.screenQuality] || SCREEN_QUALITY['1080p30']).bitrate;
    params.degradationPreference = 'maintain-resolution';
    sender.setParameters(params).catch(() => {});
  } catch {}
}

function stopScreen(update = true) {
  if (!S.screenStream) return;
  for (const p of S.peers.values()) {
    for (const key of ['screen-video', 'screen-audio']) {
      if (p.senders[key]) {
        try { p.pc.removeTrack(p.senders[key]); } catch {}
        delete p.senders[key];
      }
    }
  }
  S.screenStream.getTracks().forEach((t) => t.stop());
  S.screenStream = null;
  if (S.focus === 'me:screen') S.focus = null;
  if (update) { sendState(); renderAll(); }
}

// ---------------------------------------------------------------- WebRTC
function createPeer(info) {
  if (S.peers.has(info.id)) return S.peers.get(info.id);
  const pc = new RTCPeerConnection(ICE_CONFIG);
  const p = {
    id: info.id,
    name: info.name,
    state: info.state || {},
    pc,
    polite: S.me < info.id,
    makingOffer: false,
    ignoreOffer: false,
    senders: {},
    streams: {},
    audio: {},
    queue: Promise.resolve(),
  };
  S.peers.set(p.id, p);

  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true;
      if (!(await setLocal(pc, 'offer'))) return;
      send({ t: 'signal', to: p.id, data: { description: pc.localDescription } });
    } catch (e) {
      console.warn('negociação falhou', e);
    } finally {
      p.makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) send({ t: 'signal', to: p.id, data: { candidate } });
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') pc.restartIce();
  };
  pc.ontrack = ({ track, streams }) => {
    const stream = streams[0] || new MediaStream([track]);
    p.streams[stream.id] = stream;
    if (track.kind === 'audio' && !p.audio[track.id]) {
      // O Chrome só "liga" o áudio WebRTC no Web Audio se ele também estiver
      // preso a um elemento de mídia; o elemento fica mudo e o som sai pelo ganho.
      const el = h('audio', { autoplay: true });
      el.muted = true;
      el.srcObject = new MediaStream([track]);
      $('#audio-sink').append(el);
      el.play().catch(() => {});
      const ac = ctx();
      const src = ac.createMediaStreamSource(new MediaStream([track]));
      const gain = ac.createGain();
      src.connect(gain).connect(masterGain());
      p.audio[track.id] = { el, src, gain, streamId: stream.id };
      applyVolumes(p);
      // Indicador de fala: usa o áudio do microfone (não o áudio da tela).
      const isMic = p.state.micStreamId ? stream.id === p.state.micStreamId : stream.id !== p.state.screenStreamId;
      if (isMic && !S.levels.has(p.id)) watchLevel(p.id, new MediaStream([track]));
    }
    stream.onremovetrack = () => renderStage();
    renderStage();
  };

  if (S.mic) {
    p.senders.mic = pc.addTrack(S.mic, S.micStream);
    setAudioBitrate(p.senders.mic, 96_000);
  }
  if (S.cam) p.senders.cam = pc.addTrack(S.cam, S.camStream);
  if (S.screenStream) addScreenTracks(p);
  return p;
}

function onSignal(from, data) {
  const p = S.peers.get(from);
  if (!p) return;
  // Processa em ordem para não adicionar ICE antes da descrição remota.
  p.queue = p.queue.then(() => handleSignal(p, data)).catch((e) => console.warn('sinal', e));
}

async function handleSignal(p, { description, candidate }) {
  const pc = p.pc;
  if (pc.signalingState === 'closed') return;
  if (description) {
    const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
    p.ignoreOffer = !p.polite && collision;
    if (p.ignoreOffer) return;
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await setLocal(pc, 'answer');
      send({ t: 'signal', to: p.id, data: { description: pc.localDescription } });
    }
  } else if (candidate) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (e) {
      if (!p.ignoreOffer) console.warn('ICE', e);
    }
  }
}

function closePeer(id) {
  const p = S.peers.get(id);
  if (!p) return;
  try { p.pc.close(); } catch {}
  for (const a of Object.values(p.audio)) {
    try { a.src.disconnect(); a.gain.disconnect(); } catch {}
    a.el.srcObject = null;
    a.el.remove();
  }
  unwatchLevel(id);
  S.peers.delete(id);
  if (S.focus && S.focus.startsWith(id + ':')) S.focus = null;
}

// ---------------------------------------------------------------- indicador de fala
function watchLevel(key, stream) {
  try {
    const ac = ctx();
    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    S.levels.set(key, { analyser, src, data: new Uint8Array(analyser.fftSize) });
  } catch {}
}
function unwatchLevel(key) {
  const l = S.levels.get(key);
  if (l) { try { l.src.disconnect(); } catch {} }
  S.levels.delete(key);
  S.speaking.delete(key);
}
setInterval(() => {
  let changed = false;
  for (const [key, l] of S.levels) {
    l.analyser.getByteTimeDomainData(l.data);
    let sum = 0;
    for (const v of l.data) sum += (v - 128) * (v - 128);
    const rms = Math.sqrt(sum / l.data.length);
    S.rms.set(key, rms);
    const silenced = key === 'me' ? S.muted || S.deafened : S.peers.get(key)?.state.muted;
    const on = rms > 4 && !silenced;
    if (on !== S.speaking.has(key)) {
      on ? S.speaking.add(key) : S.speaking.delete(key);
      changed = true;
    }
  }
  if (changed) {
    for (const [key, el] of S.tiles) {
      const who = key.split(':')[0];
      if (!key.endsWith(':screen')) el.classList.toggle('speaking', S.speaking.has(who));
    }
    document.querySelectorAll('.member[data-id]').forEach((el) => {
      const id = el.dataset.id === S.me ? 'me' : el.dataset.id;
      el.classList.toggle('speaking', S.speaking.has(id));
    });
  }
}, 120);

// ---------------------------------------------------------------- renderização
function renderAll() {
  renderRail();
  renderSidebar();
  renderHeader();
  renderStage();
  renderControls();
  renderChat();
}

function renderRail() {
  const rail = $('#rail');
  rail.replaceChildren(
    ...S.servers.map((s) => {
      const live = s.channels.some((c) => c.id === S.voiceChannel);
      return h(
        'button',
        {
          class: `srv ${s.id === S.serverId ? 'active' : ''}`,
          style: `--c:${s.color}`,
          title: s.name,
          onclick: () => selectServer(s.id),
        },
        initials(s.name),
        live && h('span', { class: 'live' })
      );
    }),
    h('div', { class: 'sep' }),
    h('button', { class: 'srv add', title: 'Criar servidor', html: I.plus, onclick: createServer })
  );
}

function renderSidebar() {
  const s = server();
  if (!s) return;
  $('#server-name').textContent = s.name;
  renderChannels();

  const vc = channelById(S.voiceChannel);
  $('#voice-status').hidden = !vc;
  if (vc) $('#vs-where').textContent = `${vc.channel.name} / ${vc.server.name}`;

  $('#me-name').textContent = S.name;
  $('#me-avatar').replaceWith(Object.assign(avatar(S.name, 'sm'), { id: 'me-avatar' }));
  $('#me-sub').textContent = vc ? 'em chamada' : 'online';
  const mic = $('#me-mic');
  mic.innerHTML = S.muted || S.deafened ? I.micOff : I.mic;
  mic.classList.toggle('off', S.muted || S.deafened);
  const deaf = $('#me-deaf');
  deaf.innerHTML = S.deafened ? I.headOff : I.head;
  deaf.classList.toggle('off', S.deafened);
}

function renderChannels() {
  const s = server();
  if (!s) return;
  const list = $('#channels');
  list.replaceChildren(
    ...s.channels.map((c) => {
      const li = h('li');
      const unread = S.unread[c.id];
      li.append(
        h(
          'div',
          {
            class: `channel ${c.id === S.viewChannel ? 'viewing' : ''} ${c.id === S.voiceChannel ? 'in-voice' : ''}`,
            onclick: () => selectChannel(c.id),
            ondblclick: () => joinVoice(c.id),
            title: 'Clique para ver, clique duplo para entrar',
          },
          h('span', { html: I.voice, style: 'display:grid' }),
          h('span', { class: 'name' }, c.name),
          unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : unread) : null,
          h('button', {
            class: 'icon-btn sm del',
            title: 'Excluir canal',
            html: I.x,
            onclick: (e) => { e.stopPropagation(); deleteChannel(c); },
          })
        )
      );
      if (c.members.length) {
        li.append(
          h(
            'ul',
            { class: 'members' },
            c.members.map((m) =>
              h(
                'li',
                {
                  class: `member ${S.speaking.has(m.id === S.me ? 'me' : m.id) ? 'speaking' : ''} ${m.id !== S.me ? 'clickable' : ''}`,
                  'data-id': m.id,
                  title: m.id !== S.me ? `Ajustar volume de ${m.name}` : null,
                  onclick: m.id !== S.me ? (e) => openUserPop(m.name, e) : null,
                  oncontextmenu: m.id !== S.me ? (e) => openUserPop(m.name, e) : null,
                },
                avatar(m.name, 'xs'),
                h('span', { class: 'nm' }, m.name),
                m.id !== S.me && prefFor(m.name).m && h('span', { html: I.volOff, style: 'display:grid', title: 'Silenciado para você' }),
                m.state.screen && h('span', { class: 'tag-live' }, 'AO VIVO'),
                m.state.deafened ? h('span', { html: I.headOff, style: 'display:grid' })
                  : m.state.muted && h('span', { html: I.micOff, style: 'display:grid' })
              )
            )
          )
        );
      }
      return li;
    })
  );
}

function renderHeader() {
  const c = channelById(S.viewChannel)?.channel;
  $('#channel-icon').innerHTML = I.voice;
  $('#channel-name').textContent = c ? c.name : '—';
  $('#channel-count').textContent = c && c.members.length ? `${c.members.length} na chamada` : '';
  $('#chat-input').placeholder = c ? `Mensagem em #${c.name}` : 'Enviar mensagem…';
}

function renderControls() {
  const inCall = !!S.voiceChannel && S.voiceChannel === S.viewChannel;
  $('#controls').hidden = !inCall;
  const mic = $('#c-mic');
  const off = S.muted || S.deafened;
  mic.innerHTML = off ? I.micOff : I.mic;
  mic.className = `ctl ${off ? 'off' : ''}`;
  mic.title = off ? 'Ativar microfone' : 'Silenciar microfone';
  const cam = $('#c-cam');
  cam.innerHTML = S.cam ? I.cam : I.camOff;
  cam.className = `ctl ${S.cam ? 'on' : ''}`;
  cam.title = S.cam ? 'Desligar câmera' : 'Ligar câmera';
  const scr = $('#c-screen');
  scr.innerHTML = S.screenStream ? I.screenStop : I.screen;
  scr.className = `ctl ${S.screenStream ? 'on' : ''}`;
  scr.title = S.screenStream ? 'Parar de compartilhar' : 'Compartilhar tela';
  $('#c-leave').innerHTML = I.hangup;
}

function renderStage() {
  const stage = $('#stage');
  const view = channelById(S.viewChannel);
  if (!view) { stage.replaceChildren(); return; }

  if (S.voiceChannel !== S.viewChannel) {
    for (const el of S.tiles.values()) el.remove();
    S.tiles.clear();
    stage.classList.remove('focus');
    const members = view.channel.members;
    const elsewhere = channelById(S.voiceChannel);
    stage.replaceChildren(
      h(
        'div',
        { class: 'join-panel' },
        h(
          'div',
          { class: 'inner' },
          members.length
            ? h('div', { class: 'faces' }, members.slice(0, 6).map((m) => avatar(m.name)))
            : h('div', { class: 'ring', html: I.voice }),
          h('h3', {}, view.channel.name),
          h(
            'p',
            { class: 'muted' },
            members.length
              ? `${members.map((m) => m.name).join(', ')} ${members.length === 1 ? 'está' : 'estão'} na chamada.`
              : 'Ninguém por aqui ainda. Entre e chame a galera!'
          ),
          h(
            'button',
            { class: 'btn primary big', onclick: () => joinVoice(view.channel.id) },
            elsewhere ? 'Trocar para este canal' : 'Entrar na chamada'
          )
        )
      )
    );
    return;
  }

  // Monta a lista de blocos (câmera/avatar de cada pessoa + telas compartilhadas).
  const tiles = [];
  tiles.push({ key: 'me:cam', name: `${S.name} (você)`, stream: S.camStream, mirror: true, muted: S.muted || S.deafened });
  if (S.screenStream) tiles.push({ key: 'me:screen', name: 'Sua tela', stream: S.screenStream, screen: true });
  for (const p of S.peers.values()) {
    const st = p.state;
    const cam = st.camera && st.camStreamId ? p.streams[st.camStreamId] : null;
    const pref = prefFor(p.name);
    tiles.push({ key: `${p.id}:cam`, name: p.name, person: p.name, stream: liveVideo(cam), muted: st.muted, localOff: pref.m || pref.v === 0 });
    if (st.screen && st.screenStreamId) {
      tiles.push({
        key: `${p.id}:screen`, name: `Tela de ${p.name}`, person: p.name,
        stream: liveVideo(p.streams[st.screenStreamId]), screen: true, localOff: pref.m || pref.s === 0,
      });
    }
  }

  const keys = new Set(tiles.map((t) => t.key));
  for (const [key, el] of S.tiles) if (!keys.has(key)) { el.remove(); S.tiles.delete(key); }
  if (S.focus && !keys.has(S.focus)) S.focus = null;

  let grid = $('.grid', stage);
  if (!grid) {
    grid = h('div', { class: 'grid' });
    stage.replaceChildren(grid);
  }
  let strip = $('.strip', grid);
  if (!strip) strip = h('div', { class: 'strip' });

  const focused = S.focus;
  stage.classList.toggle('focus', !!focused);
  const els = tiles.map((t) => updateTile(t));
  if (focused) {
    const main = S.tiles.get(focused);
    grid.replaceChildren(main, strip);
    strip.replaceChildren(...els.filter((el) => el !== main));
    for (const el of els) el.classList.toggle('main', el === main);
    grid.style.removeProperty('--cols');
  } else {
    strip.replaceChildren();
    grid.replaceChildren(...els);
    for (const el of els) el.classList.remove('main');
    const n = els.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    grid.style.setProperty('--cols', cols);
    grid.style.setProperty('--mcols', Math.min(cols, 2));
  }
  for (const el of els) {
    const v = $('video', el);
    if (v.srcObject && v.paused) v.play().catch(() => {});
  }
}

function liveVideo(stream) {
  if (!stream) return null;
  return stream.getVideoTracks().some((t) => t.readyState === 'live') ? stream : null;
}

function updateTile(t) {
  let el = S.tiles.get(t.key);
  if (!el) {
    const video = h('video', { autoplay: true, playsinline: true });
    video.muted = true; // o áudio sai pelos elementos <audio>
    el = h(
      'div',
      { class: 'tile', 'data-key': t.key, onclick: () => { S.focus = S.focus === t.key ? null : t.key; renderStage(); } },
      video,
      h('div', { class: 'face' }),
      h('div', { class: 'label' }),
      h(
        'div',
        { class: 'tile-tools' },
        t.person && h('button', {
          class: 'icon-btn',
          title: t.screen ? 'Volume da tela' : `Volume de ${t.person}`,
          html: I.vol,
          onclick: (e) => openUserPop(t.person, e),
        }),
        h('button', {
          class: 'icon-btn',
          title: 'Tela cheia',
          html: I.expand,
          onclick: (e) => { e.stopPropagation(); el.requestFullscreen?.().catch(() => {}); },
        })
      )
    );
    if (t.person) el.addEventListener('contextmenu', (e) => openUserPop(t.person, e));
    S.tiles.set(t.key, el);
  }
  const video = $('video', el);
  if (video.srcObject !== t.stream) video.srcObject = t.stream || null;
  el.classList.toggle('has-video', !!t.stream);
  el.classList.toggle('screen', !!t.screen);
  el.classList.toggle('mirror', !!t.mirror && !!t.stream);
  if (!t.screen) el.classList.toggle('speaking', S.speaking.has(t.key.startsWith('me:') ? 'me' : t.key.split(':')[0]));

  const face = $('.face', el);
  const faceName = t.screen ? t.name.replace(/^Tela de /, '') : t.name.replace(/ \(você\)$/, '');
  if (face.dataset.name !== faceName) {
    face.dataset.name = faceName;
    face.replaceChildren(t.screen ? h('div', { class: 'muted' }, 'Carregando tela…') : avatar(faceName));
  }
  const label = $('.label', el);
  label.replaceChildren(
    ...[
      t.screen && h('span', { class: 'scr', html: I.screen, style: 'display:grid' }),
      t.muted && h('span', { html: I.micOff, style: 'display:grid' }),
      t.localOff && h('span', { html: I.volOff, style: 'display:grid', title: 'Silenciado para você' }),
      h('span', {}, t.name),
    ].filter(Boolean)
  );
  return el;
}

function renderChat() {
  const box = $('#messages');
  const list = S.messages[S.viewChannel];
  if (!list) { box.replaceChildren(); return; }
  if (!list.length) {
    box.replaceChildren(h('div', { class: 'empty' }, 'Nenhuma mensagem ainda. Diga oi! 👋'));
    return;
  }
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  let prev = null;
  box.replaceChildren(
    ...list.map((m) => {
      const cont = prev && prev.author === m.author && m.ts - prev.ts < 5 * 60 * 1000;
      prev = m;
      return h(
        'div',
        { class: `msg ${cont ? 'cont' : ''}` },
        avatar(m.author, 'sm'),
        h(
          'div',
          {},
          cont ? null : h('div', { class: 'who' }, h('b', { style: `color:${colorFor(m.author)}` }, m.author), h('time', {}, fmtTime(m.ts))),
          h('div', { class: 'txt' }, m.text)
        )
      );
    })
  );
  if (atBottom || prev?.authorId === S.me) box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------- volume por pessoa
let popAt = { x: 0, y: 0 };
function openUserPop(name, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
    popAt = { x: e.clientX, y: e.clientY };
  }
  const pop = $('#userpop');
  const pref = prefFor(name);
  const sharing = [...S.peers.values()].some((p) => p.name === name && p.state.screen);

  const slider = (label, key, hint) => {
    const value = Math.round(pref[key] * 100);
    const out = h('output', {}, `${value}%`);
    const input = h('input', {
      type: 'range', min: 0, max: 200, step: 5, value, id: `pop-${key}`,
      'aria-label': label,
      oninput: (ev) => {
        out.textContent = `${ev.target.value}%`;
        setPref(name, { [key]: ev.target.value / 100 });
      },
      onchange: () => renderStage(),
    });
    return h('div', { class: 'pop-row' },
      h('div', { class: 'pop-label' }, h('span', {}, label), out),
      input,
      hint && h('small', { class: 'muted' }, hint));
  };

  pop.replaceChildren(
    h('div', { class: 'pop-head' }, avatar(name, 'sm'), h('b', {}, name)),
    slider('Volume da voz', 'v'),
    slider('Volume da tela compartilhada', 's', sharing ? null : 'Vale quando essa pessoa compartilhar a tela.'),
    h('label', { class: 'pop-check' },
      h('input', {
        type: 'checkbox', id: 'pop-mute', checked: pref.m,
        onchange: (ev) => { setPref(name, { m: ev.target.checked }); renderStage(); renderChannels(); },
      }),
      'Silenciar para mim'),
    h('button', {
      class: 'btn ghost sm',
      onclick: () => { setPref(name, { v: 1, s: 1, m: false }); openUserPop(name); renderStage(); renderChannels(); },
    }, 'Restaurar padrão')
  );
  pop.hidden = false;
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(popAt.x, innerWidth - r.width - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(popAt.y, innerHeight - r.height - 8))}px`;
}
function closeUserPop() { $('#userpop').hidden = true; }
document.addEventListener('pointerdown', (e) => {
  if (!$('#userpop').hidden && !e.target.closest('#userpop')) closeUserPop();
});

// ---------------------------------------------------------------- configurações
let meterTimer = null;
async function openSettings() {
  const dlg = $('#settings');
  const c = S.cfg;
  $('#set-micgain').value = Math.round(c.micGain * 100);
  $('#set-micgain-out').textContent = `${Math.round(c.micGain * 100)}%`;
  $('#set-outvol').value = Math.round(c.outVol * 100);
  $('#set-outvol-out').textContent = `${Math.round(c.outVol * 100)}%`;
  $('#set-noise').checked = c.noise;
  $('#set-echo').checked = c.echo;
  $('#set-agc').checked = c.agc;
  $('#set-quality').value = c.screenQuality;
  $('#set-screenaudio').checked = c.screenAudio;
  $('#set-out-row').hidden = !('setSinkId' in AudioContext.prototype);

  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch {}
  const fill = (sel, kind, current) => {
    const list = devices.filter((d) => d.kind === kind);
    sel.replaceChildren(
      h('option', { value: '' }, 'Padrão do sistema'),
      ...list.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) =>
        h('option', { value: d.deviceId, selected: d.deviceId === current }, d.label || `Dispositivo ${i + 1}`))
    );
  };
  fill($('#set-mic'), 'audioinput', c.micId);
  fill($('#set-out'), 'audiooutput', c.outId);
  $('#set-labels-hint').hidden = devices.some((d) => d.label);

  dlg.showModal();
  clearInterval(meterTimer);
  meterTimer = setInterval(() => {
    const rms = S.mic && S.mic.enabled ? S.rms.get('me') || 0 : 0;
    $('#set-meter i').style.width = `${Math.min(100, rms * 3)}%`;
  }, 80);
}

function saveCfg(patch) {
  Object.assign(S.cfg, patch);
  saveJSON('ressoa.cfg', S.cfg);
}

function bindSettings() {
  const reopenMic = () => { if (S.micGraph) openMic().catch(() => toast('Não foi possível usar esse microfone.')); };
  $('#set-mic').onchange = (e) => { saveCfg({ micId: e.target.value }); reopenMic(); };
  $('#set-noise').onchange = (e) => { saveCfg({ noise: e.target.checked }); reopenMic(); };
  $('#set-echo').onchange = (e) => { saveCfg({ echo: e.target.checked }); reopenMic(); };
  $('#set-agc').onchange = (e) => { saveCfg({ agc: e.target.checked }); reopenMic(); };
  $('#set-micgain').oninput = (e) => {
    saveCfg({ micGain: e.target.value / 100 });
    $('#set-micgain-out').textContent = `${e.target.value}%`;
    if (S.micGraph) S.micGraph.gain.gain.value = S.cfg.micGain;
  };
  $('#set-outvol').oninput = (e) => {
    saveCfg({ outVol: e.target.value / 100 });
    $('#set-outvol-out').textContent = `${e.target.value}%`;
    if (master) masterGain();
  };
  $('#set-out').onchange = (e) => {
    saveCfg({ outId: e.target.value });
    const ac = ctx();
    if (ac.setSinkId) ac.setSinkId(e.target.value || '').catch(() => toast('Não foi possível usar essa saída de áudio.'));
  };
  $('#set-quality').onchange = (e) => {
    saveCfg({ screenQuality: e.target.value });
    if (S.screenStream) toast('A nova qualidade vale no próximo compartilhamento.');
  };
  $('#set-screenaudio').onchange = (e) => saveCfg({ screenAudio: e.target.checked });
  $('#settings').addEventListener('close', () => clearInterval(meterTimer));
}

// ---------------------------------------------------------------- modais
function ask({ title, text = '', placeholder = '', ok = 'Criar', confirm = false }) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-text').textContent = text;
  $('#modal-ok').textContent = ok;
  const input = $('#modal-input');
  input.value = '';
  input.placeholder = placeholder;
  input.required = !confirm;
  dlg.classList.toggle('confirm', confirm);
  dlg.returnValue = '';
  dlg.showModal();
  if (!confirm) input.focus();
  return new Promise((resolve) => {
    dlg.addEventListener(
      'close',
      () => resolve(dlg.returnValue === 'ok' ? (confirm ? true : input.value.trim() || null) : null),
      { once: true }
    );
  });
}

async function createServer() {
  const name = await ask({ title: 'Criar servidor', text: 'Dê um nome para o seu novo servidor.', placeholder: 'Ex.: Amigos da facul' });
  if (name) send({ t: 'create-server', name });
}
async function createChannel() {
  const s = server();
  if (!s) return;
  const name = await ask({ title: 'Criar canal de voz', text: `Novo canal em ${s.name}.`, placeholder: 'Ex.: Sala de estudos' });
  if (name) send({ t: 'create-channel', serverId: s.id, name });
}
async function deleteChannel(c) {
  const yes = await ask({ title: `Excluir "${c.name}"?`, text: 'As mensagens do canal também serão apagadas.', ok: 'Excluir', confirm: true });
  if (yes) send({ t: 'delete-channel', channelId: c.id });
}
async function deleteServer() {
  const s = server();
  if (!s) return;
  const yes = await ask({ title: `Excluir "${s.name}"?`, text: 'Todos os canais e mensagens serão apagados.', ok: 'Excluir', confirm: true });
  if (yes) send({ t: 'delete-server', serverId: s.id });
}
async function copyInvite() {
  const url = `${location.origin}${location.pathname}?s=${S.serverId}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link de convite copiado!');
  } catch {
    toast(url, 8000);
  }
}

// ---------------------------------------------------------------- eventos
$('#invite-btn').innerHTML = I.link;
$('#server-menu-btn').innerHTML = I.trash;
$('#add-channel').innerHTML = I.plus;
$('#vs-leave').innerHTML = I.hangup;
$('#toggle-chat').innerHTML = I.chat;
$('#chat-close').innerHTML = I.x;
$('#me-settings').innerHTML = I.gear;
$('#me-settings').onclick = openSettings;
bindSettings();
$('#chat-close').onclick = () => $('#app').classList.remove('chat-open');

$('#invite-btn').onclick = copyInvite;
$('#server-menu-btn').onclick = deleteServer;
$('#add-channel').onclick = createChannel;
$('#vs-leave').onclick = () => leaveVoice();
$('#c-leave').onclick = () => leaveVoice();
$('#me-mic').onclick = toggleMute;
$('#c-mic').onclick = toggleMute;
$('#me-deaf').onclick = toggleDeafen;
$('#c-cam').onclick = toggleCam;
$('#c-screen').onclick = toggleScreen;
$('#toggle-chat').onclick = () => {
  const app = $('#app');
  if (matchMedia('(max-width: 1100px)').matches) app.classList.toggle('chat-open');
  else app.classList.toggle('chat-hidden');
};

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text || !S.viewChannel) return;
  send({ t: 'chat', channelId: S.viewChannel, text });
  input.value = '';
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog')) return;
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); toggleMute(); }
  if (e.key === 'Escape') {
    if (!$('#userpop').hidden) closeUserPop();
    else if (S.focus) { S.focus = null; renderStage(); }
  }
});

window.addEventListener('beforeunload', () => send({ t: 'leave' }));

const nameInput = $('#login-name');
nameInput.value = store('ressoa.name') || '';
$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim().slice(0, 32);
  if (!name) return;
  S.name = name;
  store('ressoa.name', name);
  $('#login').hidden = true;
  $('#app').hidden = false;
  connect();
});
nameInput.focus();

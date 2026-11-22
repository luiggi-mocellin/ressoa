# Ressoa

App de chamadas no navegador com **servidores**, **canais de voz**, **vídeo**, **compartilhamento de tela** e **chat** por canal.

## Como rodar

1. Instale o [Node.js](https://nodejs.org) 18 ou mais novo (não há outras dependências — nada de `npm install`).
2. Nesta pasta, rode:

   ```powershell
   node server.js
   ```

3. Abra **http://localhost:3000** no Chrome, Edge ou Firefox.

Para testar sozinho, abra duas abas (ou uma aba normal e uma anônima), entre com nomes diferentes e dê clique duplo no mesmo canal.

## Recursos

- **Servidores** na barra da esquerda: crie (`+`), troque, copie link de convite, exclua.
- **Canais de voz** dentro de cada servidor: clique para ver quem está lá; clique duplo (ou "Entrar na chamada") para entrar.
- **Microfone / áudio**: silenciar (`Ctrl+Shift+M`) e desativar o som de todos.
- **Câmera** liga/desliga a qualquer momento da chamada.
- **Compartilhar tela**: janela, aba ou tela inteira (com áudio da aba quando o navegador permitir). A tela compartilhada vira o destaque automaticamente; clique em qualquer bloco para destacar/voltar à grade, ou use o botão de tela cheia.
- **Indicador de fala** (contorno verde) em quem está falando.
- **Chat** por canal, com histórico salvo em `data.json`.

## Como funciona

- `server.js` — servidor HTTP + WebSocket (implementado à mão, sem bibliotecas). Guarda servidores, canais e mensagens em `data.json` e faz a **sinalização** das chamadas.
- `public/app.js` — cliente. Áudio, vídeo e tela vão **direto entre os navegadores** via WebRTC (malha P2P), sem passar pelo servidor. Funciona bem para grupos de até ~6 pessoas por canal.

## Usar em outros computadores

Navegadores só liberam microfone, câmera e tela em **localhost** ou **HTTPS**. Em outro PC acessando `http://192.168.x.x:3000` esses recursos ficam bloqueados. Opções:

- **HTTPS próprio**: coloque `key.pem` e `cert.pem` numa pasta `cert/` ao lado do `server.js`. O servidor passa a usar HTTPS automaticamente.
- **Túnel com HTTPS** (mais fácil, funciona pela internet): por exemplo `cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000`, e compartilhe o link `https://…` gerado.
- **Só para testes na rede local**: no Chrome do outro PC, abra `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, adicione `http://IP-DO-SERVIDOR:3000` e reinicie o navegador.

Pela internet, algumas redes (4G, redes corporativas) bloqueiam conexões P2P diretas. Nesses casos é preciso um servidor **TURN** (ex.: coturn) — adicione-o em `ICE_CONFIG` no topo de `public/app.js`.

## Porta

Use outra porta com:

```powershell
$env:PORT = 8080; node server.js
```

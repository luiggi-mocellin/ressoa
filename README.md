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

- **Servidores** na barra da esquerda: crie (`+`), troque, copie link de convite, exclua (só o dono).
- **Privacidade**: um servidor criado por você só é visto por quem entrar pelo seu link de convite. O *Lobby* é público e não pode ser alterado.
- **Canais de voz** dentro de cada servidor: clique para ver quem está lá; clique duplo (ou "Entrar na chamada") para entrar.
- **Microfone / áudio**: silenciar (`Ctrl+Shift+M`) e desativar o som de todos.
- **Câmera** liga/desliga a qualquer momento da chamada.
- **Compartilhar tela**: janela, aba ou tela inteira (com áudio da aba quando o navegador permitir). A tela compartilhada vira o destaque automaticamente; clique em qualquer bloco para destacar/voltar à grade, ou use o botão de tela cheia.
- **Indicador de fala** (contorno verde) em quem está falando.
- **Chat** por canal, com histórico salvo em `data/data.json`.

## Como funciona

O backend segue **MVC**, sem bibliotecas:

```
server.js                 inicialização (HTTP/HTTPS + WebSocket)
src/config.js             caminhos, limites e variáveis de ambiente
src/routes.js             liga mensagens WebSocket e HTTP aos controllers
src/models/               dados: store (data/data.json), user, server, message, presence
src/views/serverView.js   o que cada usuário pode ver (só servidores a que tem acesso)
src/controllers/          ações: session, server, channel, call, chat, http
src/services/turn.js      credenciais STUN/TURN
src/lib/                  WebSocket (RFC 6455), rate limit, ids
public/                   cliente (camada de apresentação)
```

- Cada navegador recebe um **token de sessão** no primeiro acesso (guardado no navegador; o servidor guarda só o hash). É ele que identifica o dono dos servidores e o autor das mensagens. Um nome não pode ser usado por duas contas.
- Áudio, vídeo e tela vão **direto entre os navegadores** via WebRTC (malha P2P), sem passar pelo servidor. Funciona bem para grupos de até ~6 pessoas por canal.
- Dados ficam em `data/` (ou em `DATA_DIR`), fora do git. Um `data.json` antigo na raiz é lido automaticamente; servidores antigos viram públicos.

## Testes

```powershell
npm test
```

Testes de segurança (`test/security.test.js`, Node 22+) cobrem isolamento entre servidores, posse, convites, path traversal, Origin, limites e cabeçalhos.

## Usar em outros computadores

Navegadores só liberam microfone, câmera e tela em **localhost** ou **HTTPS**. Em outro PC acessando `http://192.168.x.x:3000` esses recursos ficam bloqueados. Opções:

- **HTTPS próprio**: coloque `key.pem` e `cert.pem` numa pasta `cert/` ao lado do `server.js`. O servidor passa a usar HTTPS automaticamente.
- **Túnel com HTTPS** (mais fácil, funciona pela internet): por exemplo `cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000`, e compartilhe o link `https://…` gerado.
- **Só para testes na rede local**: no Chrome do outro PC, abra `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, adicione `http://IP-DO-SERVIDOR:3000` e reinicie o navegador.

Pela internet, algumas redes (4G, redes corporativas) bloqueiam conexões P2P diretas. Nesses casos é preciso um servidor **TURN** (ex.: coturn). Defina `TURN_URLS` e, de preferência, `TURN_SECRET` (o mesmo `static-auth-secret` do coturn com `use-auth-secret`): o servidor gera credenciais temporárias por usuário. `TURN_USERNAME`/`TURN_CREDENTIAL` fixos ainda funcionam, mas são entregues a todo usuário conectado.

## Porta

Use outra porta com:

```powershell
$env:PORT = 8080; node server.js
```

"""Gera docs/security-audit/relatorio-auditoria-seguranca.pdf.

Uso (ambiente isolado, nada global):
    python -m venv .venv
    .venv/Scripts/python -m pip install reportlab matplotlib     # Windows
    .venv/Scripts/python docs/security-audit/gerar_relatorio.py

Os achados ficam nas listas FINDINGS / STRENGTHS / ISSUES abaixo: edite-as e rode de novo.
"""
import io
import os
from collections import Counter
from xml.sax.saxutils import escape

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (Image, PageBreak, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(OUT_DIR, "relatorio-auditoria-seguranca.pdf")
PROJECT = "Ressoa"
DATE = "23/11/2026"
COMMIT = "f47e666 (branch main)"
REPORT_NAME = f"Relatório de Auditoria de Segurança — {PROJECT}"

# ------------------------------------------------------------------ fontes (DejaVu vem com o matplotlib)
FD = os.path.join(matplotlib.get_data_path(), "fonts", "ttf")
pdfmetrics.registerFont(TTFont("Sans", os.path.join(FD, "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Sans-B", os.path.join(FD, "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Mono", os.path.join(FD, "DejaVuSansMono.ttf")))
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-B", italic="Sans", boldItalic="Sans-B")

SEV = {  # nome: (cor, ordem)
    "Crítica": ("#B91C1C", 0), "Alta": ("#EA580C", 1), "Média": ("#D97706", 2),
    "Baixa": ("#2563EB", 3), "Informativa": ("#6B7280", 4),
}
GREEN = "#059669"
INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#4B5563")
LINE = colors.HexColor("#E5E7EB")

ss = {
    "h1": ParagraphStyle("h1", fontName="Sans-B", fontSize=18, leading=23, textColor=INK, spaceBefore=4, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName="Sans-B", fontSize=13, leading=17, textColor=INK, spaceBefore=12, spaceAfter=6, keepWithNext=1),
    "h3": ParagraphStyle("h3", fontName="Sans-B", fontSize=10.5, leading=14, textColor=INK, spaceBefore=8, spaceAfter=4, keepWithNext=1),
    "p": ParagraphStyle("p", fontName="Sans", fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=5),
    "small": ParagraphStyle("small", fontName="Sans", fontSize=8.3, leading=11.5, textColor=MUTED),
    "cell": ParagraphStyle("cell", fontName="Sans", fontSize=8.3, leading=11.2, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="Sans-B", fontSize=8.3, leading=11.2, textColor=INK),
    "code": ParagraphStyle("code", fontName="Mono", fontSize=7.4, leading=9.6, textColor=colors.HexColor("#1F2937")),
    "md": ParagraphStyle("md", fontName="Mono", fontSize=7.6, leading=10, textColor=colors.HexColor("#111827")),
    "chip": ParagraphStyle("chip", fontName="Sans-B", fontSize=7.6, leading=9.5, textColor=colors.white, alignment=TA_CENTER),
    "bul": ParagraphStyle("bul", fontName="Sans", fontSize=9.5, leading=13.5, textColor=INK, leftIndent=12, bulletIndent=2, spaceAfter=3),
}

# ------------------------------------------------------------------ dados da auditoria
CATEGORIES = [
    ("C1", "Banco sem tranca (isolamento)"),
    ("C2", "Permissão definida no navegador"),
    ("C3", "IDOR"),
    ("C4", "Chaves expostas"),
    ("C5", "Inputs sem tratamento (XSS)"),
    ("CX", "Fora das 5 categorias"),
]

METHOD = [
    ("Stack detectada",
     "Node.js ≥ 18 sem dependências: servidor HTTP/HTTPS + WebSocket (RFC 6455) escrito à mão em <b>server.js</b>; "
     "persistência num arquivo JSON único (<b>data.json</b>), sem ORM nem banco; frontend em JavaScript puro "
     "(<b>public/app.js</b>, <b>index.html</b>) com WebRTC P2P; deploy no Render (<b>render.yaml</b>). Não há Docker, CI, Helm nem Terraform. "
     "Não existe mecanismo de autenticação: o cliente só envia um nome no evento <i>hello</i>."),
    ("1. Isolamento",
     "Não há RLS nem banco. O 'inquilino' natural é o <i>servidor</i> (grupo de canais). Procurou-se qualquer filtro por "
     "dono/membro em snapshot(), broadcast de chat e histórico. Mecanismo de isolamento encontrado: <b>nenhum</b>."),
    ("2. Permissão no navegador",
     "Busca por gates de papel no frontend (isAdmin, role, owner, canEdit, hidden/disabled por papel) e cruzamento com os handlers "
     "WebSocket equivalentes. O frontend não tem gates de papel; o servidor também não tem modelo de autorização."),
    ("3. IDOR",
     "As 'rotas' são os 11 handlers WebSocket (server.js:249-350) e as 3 rotas HTTP (server.js:398-428). Todos foram percorridos, "
     "verificando se o ID recebido (serverId/channelId/to) é conferido contra o chamador. PoC executada contra cópia isolada do servidor."),
    ("4. Chaves expostas",
     "Varredura de todos os arquivos versionados, render.yaml, README e do histórico git completo (5 commits, git log -p) por "
     "tokens, senhas, chaves privadas e defaults; o 'bundle' do frontend é o próprio public/app.js (sem build)."),
    ("5. XSS",
     "Todos os sinks de HTML no frontend (innerHTML, atributo html do helper h(), setAttribute, style, href/src, eval) e respostas do "
     "backend. Não há lib de sanitização; verificou-se se ela é necessária em cada ponto."),
]

# (id, cat, severidade, arquivo:linha, título, descrição, trecho, condição)
FINDINGS = [
    ("S2-01", "C2", "Crítica", "server.js:249-363",
     "Nenhuma autenticação ou autorização no servidor",
     "O único requisito para qualquer ação é ter enviado <i>hello</i> com um nome qualquer (linha 360). Não existe dono, papel ou "
     "membro: qualquer pessoa que alcance a URL pode criar, excluir e ler tudo. O frontend mostra o botão de excluir canal/servidor "
     "a todos (app.js:946-951, 1515-1519) e a única barreira é o diálogo de confirmação no próprio navegador (app.js:1512, 1517).",
     "if (m.t !== 'hello' && !client.name) return;\nconst fn = handlers[m.t];",
     "Explorável por qualquer visitante quando publicado (render.yaml faz deploy público no Render)."),
    ("S2-02", "C2", "Média", "server.js:250-251",
     "Identidade escolhida pelo cliente — personificação",
     "O nome é a identidade e vem do cliente, sem unicidade, e <i>hello</i> pode ser reenviado a qualquer momento para trocar o nome. "
     "Mensagens forjadas saem com o nome da vítima (confirmado na PoC). As preferências locais (volume/mudo) são indexadas por nome (app.js:152), "
     "então o impostor herda-as.",
     "hello(c, m) {\n  c.name = clean(m.name, 32) || 'Anônimo';",
     "Sempre."),
    ("S1-01", "C1", "Alta", "server.js:204-221",
     "Snapshot global expõe todos os servidores, canais e membros a todos",
     "snapshot() serializa <b>todos</b> os servidores e quem está em cada canal (nome e estado de mídia) e broadcastSnapshot() envia a "
     "todo cliente conectado. O 'link de convite' (app.js:1522) sugere servidor privado, mas o ID já chega a todos. Confirmado na PoC (1).",
     "return db.servers.map((s) => ({ ... members: all.filter(...)\n...\nfor (const c of clients.values()) if (c.name) c.conn.send({ t: 'snapshot', servers });",
     "Sempre."),
    ("S1-02", "C1", "Alta", "server.js:348",
     "Toda mensagem de chat é enviada a todos os clientes de todos os servidores",
     "O broadcast de chat não filtra por canal nem servidor; o filtro existe só no navegador (app.js:257-264). Qualquer cliente com um "
     "WebSocket aberto recebe em tempo real todas as conversas do sistema. Confirmado na PoC (2).",
     "for (const o of clients.values()) if (o.name) o.conn.send({ t: 'chat', channelId: m.channelId, message: msg });",
     "Sempre."),
    ("S3-01", "C3", "Alta", "server.js:271-281",
     "IDOR: excluir servidor de terceiros por serverId",
     "Busca o servidor pelo ID recebido e apaga, junto com todas as mensagens, sem verificar dono. Únicas travas: ninguém em chamada e "
     "não ser o último servidor. Confirmado na PoC (5).",
     "const server = db.servers.find((s) => s.id === m.serverId);\n...\ndb.servers = db.servers.filter((s) => s !== server);",
     "Servidor sem ninguém em chamada (o estado normal)."),
    ("S3-02", "C3", "Alta", "server.js:295-304",
     "IDOR: excluir canal de terceiros por channelId",
     "Mesmo padrão: apaga o canal e o histórico de mensagens de qualquer servidor.",
     "const found = findChannel(m.channelId);\n...\ndelete db.messages[found.channel.id];",
     "Canal vazio e não ser o único do servidor."),
    ("S3-03", "C3", "Alta", "server.js:335-338",
     "IDOR: ler histórico de qualquer canal",
     "Devolve as últimas 200 mensagens de qualquer channelId, sem exigir que o chamador seja membro. Confirmado na PoC (3).",
     "history(c, m) {\n  if (!findChannel(m.channelId)) return;\n  c.conn.send({ t: 'history', ... messages: db.messages[m.channelId] || [] });",
     "Sempre (IDs vazam via snapshot)."),
    ("S3-04", "C3", "Alta", "server.js:306-315",
     "IDOR: entrar em chamada de qualquer canal",
     "join aceita qualquer channelId existente. Os clientes já presentes criam a conexão WebRTC automaticamente ao receber "
     "<i>peer-joined</i> (app.js:225-229), então áudio, vídeo e tela passam a fluir para o intruso.",
     "join(c, m) {\n  if (!findChannel(m.channelId)) return;\n  ...\n  c.channelId = m.channelId;",
     "O intruso aparece na lista de membros, mas nada o impede."),
    ("S3-05", "C3", "Média", "server.js:340-349",
     "IDOR: publicar mensagem em canal de terceiros",
     "chat só valida que o canal existe; não exige que o autor esteja no canal/servidor.",
     "if (!text || !findChannel(m.channelId)) return;",
     "Sempre."),
    ("S3-06", "C3", "Baixa", "server.js:283-293",
     "IDOR: criar canais em servidor de terceiros",
     "Qualquer cliente adiciona canais em qualquer servidor (até 50 por servidor).",
     "const server = db.servers.find((s) => s.id === m.serverId);\n...\nserver.channels.push(channel);",
     "Sempre."),
    ("S4-01", "C4", "Média", "server.js:385-396, 404-407",
     "Credenciais TURN estáticas entregues sem autenticação em /config",
     "Não estão no código (vêm de variáveis de ambiente), mas a rota pública /config devolve TURN_USERNAME/TURN_CREDENTIAL de longa "
     "duração a qualquer pessoa, que pode usar o relay TURN (banda paga) fora do app.",
     "username: process.env.TURN_USERNAME || '',\ncredential: process.env.TURN_CREDENTIAL || '',",
     "Só se TURN_URLS estiver configurado."),
    ("S4-02", "C4", "Baixa", "server.js:15, 430-431",
     "Sem .gitignore: data.json e cert/key.pem moram na raiz do repositório",
     "O servidor grava o histórico de chat em data.json e lê a chave privada TLS de cert/key.pem dentro da pasta do projeto. Não há "
     ".gitignore e os commits são feitos por upload em massa ('Add files via upload'), então um próximo upload pode publicar a chave e as conversas.",
     "const DATA_FILE = path.join(__dirname, 'data.json');\nconst keyFile = path.join(CERT_DIR, 'key.pem');",
     "Preventivo: nada disso foi commitado até f47e666."),
    ("S5-01", "C5", "Informativa", "server.js:401, 405, 422-425",
     "Sem Content-Security-Policy nem cabeçalhos de segurança",
     "Nenhuma resposta envia CSP, X-Content-Type-Options ou frame-ancestors. Não há XSS hoje, mas o helper h() aceita "
     "<i>html:</i> (app.js:26) e um uso futuro com dado do usuário ficaria sem rede de proteção.",
     "res.writeHead(200, {\n  'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',\n  'Cache-Control': 'no-cache',\n});",
     "Defesa em profundidade."),
    ("X-01", "CX", "Média", "server.js:115, 130-136, 256-269",
     "DoS: fragmentos WebSocket sem limite e nenhum rate limit",
     "O limite de 4 MB só vale para frames com tamanho de 64 bits; fragmentos (op 0x0) se acumulam em this.frags sem teto. Não há "
     "limite de mensagens por segundo nem de servidores criados, e tudo é persistido em data.json. Verificado por leitura, não executado.",
     "this.frags.push(payload);\nif (fin) { const text = Buffer.concat(this.frags)...",
     "Qualquer cliente."),
    ("X-02", "CX", "Baixa", "server.js:412-413",
     "Checagem de path traversal por prefixo sem separador",
     "file.startsWith(PUBLIC_DIR) aceita diretórios irmãos que começam com 'public'. Testado: /..%2fpublic-backup/x resolve para "
     "ressoa/public-backup/x e passa na checagem. ../server.js é bloqueado corretamente.",
     "const file = path.normalize(path.join(PUBLIC_DIR, rel));\nif (!file.startsWith(PUBLIC_DIR)) {",
     "Só se existir uma pasta irmã 'public*' (hoje não existe)."),
    ("X-03", "CX", "Baixa", "server.js:179-184",
     "Upgrade WebSocket sem verificação de Origin",
     "Qualquer site pode abrir o WebSocket a partir do navegador da vítima (CSWSH). Impacto baixo hoje porque não há cookie/sessão; "
     "vira alto assim que for adicionada autenticação por cookie.",
     "if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !req.url.startsWith('/ws')) {",
     "Relevante ao corrigir S2-01."),
]

STRENGTHS = [
    ("C3", "server.js:329-333", "<b>signal</b> valida que remetente e destino estão no mesmo canal antes de repassar SDP/ICE — o único handler com checagem de posse."),
    ("C3", "server.js:343, 353", "ID do cliente e <i>authorId</i> das mensagens são gerados no servidor (crypto.randomBytes), nunca aceitos do cliente."),
    ("C3", "server.js:235-247, 79", "sanitizeState e clean() normalizam tipos e limitam tamanho de todo dado que é retransmitido (nomes 32/40, texto 2000)."),
    ("C4", "render.yaml:13-18", "Credenciais TURN declaradas com <i>sync: false</i>: o valor fica só no painel do Render, não no repositório."),
    ("C4", "histórico git (5 commits)", "git log -p completo sem tokens, senhas, chaves privadas, .env ou data.json. Nenhum default de segredo do tipo ${VAR:-valor}."),
    ("C4", "public/app.js:10", "O frontend só embute STUN público do Google, que não é segredo."),
    ("C5", "public/app.js:21-35", "O helper h() insere conteúdo como nó de texto (createTextNode); nomes, mensagens e títulos nunca viram HTML."),
    ("C5", "public/app.js:26, 919-1009, 1532-1541", "Todo innerHTML / atributo html: recebe apenas ícones SVG constantes do objeto I."),
    ("C5", "public/app.js:1481-1483, 78", "Modal e toasts usam textContent / texto; cor de avatar vem de hash (colorFor) e cor de servidor da paleta do servidor (server.js:262)."),
    ("C5", "public/app.js (todo)", "Sem eval, new Function, href/src controlados por usuário ou markdown. O backend só responde JSON/texto — sem templates HTML ou e-mail."),
    ("CX", "server.js:410-416", "decodeURIComponent protegido por try/catch e ../ fora de public/ bloqueado (exceto o caso X-02)."),
    ("CX", "server.js:119", "Frames não mascarados do cliente são rejeitados, como exige a RFC 6455."),
]

NOT_APPLICABLE = [
    ("C1", "Não há Supabase/RLS nem SQL: a categoria foi mapeada para o filtro por servidor/membro nos broadcasts e leituras."),
    ("C2", "O frontend não tem nenhum gate por papel (0 ocorrências de isAdmin/role/owner/canEdit). O problema real é o oposto: nem cliente nem servidor têm o conceito de permissão (S2-01)."),
    ("C5", "Nenhum XSS encontrado; não há lib de sanitização e hoje ela não é necessária, porque todo dado do usuário entra como texto."),
]

RECS = [
    ("P1", "Criar identidade e posse no servidor",
     "Emitir um token de sessão aleatório no <i>hello</i> (guardado no localStorage e reapresentado na reconexão), gravar <i>ownerId</i> "
     "em cada servidor e uma lista de membros. Exigir dono em delete-server, delete-channel e create-channel. Corrige S2-01, S2-02, S3-01, S3-02, S3-06."),
    ("P1", "Isolar dados por servidor",
     "snapshot e broadcast de chat só para membros do servidor; join, history e chat exigem membership. O link de convite deve carregar um "
     "token de convite separado do ID. Corrige S1-01, S1-02, S3-03, S3-04, S3-05."),
    ("P2", "Credenciais TURN temporárias",
     "Usar credenciais efêmeras (TURN REST / coturn <i>use-auth-secret</i>: HMAC com validade de minutos) e só entregar /config a clientes com sessão. Corrige S4-01."),
    ("P2", "Limites anti-abuso",
     "Teto de tamanho total por mensagem (somando fragmentos), rate limit por conexão e limite de servidores por usuário. Corrige X-01."),
    ("P3", "Endurecimento",
     "Adicionar .gitignore (data.json, cert/, .env), mover dados para fora do diretório do código, checar path com path.relative/sep, "
     "validar Origin no upgrade e enviar CSP + X-Content-Type-Options. Corrige S4-02, X-02, X-03, S5-01."),
]

ISSUES = [
    {
        "title": "[Segurança] Servidor não tem autenticação nem autorização; qualquer visitante pode tudo",
        "labels": ["security", "severity:critical"],
        "refs": ["S2-01", "S2-02"],
        "problem": "O servidor WebSocket aceita qualquer ação de qualquer conexão que tenha enviado `hello` com um nome livre. Não existe dono, papel nem sessão. A interface mostra os botões de excluir a todos e a única barreira é a confirmação no navegador. O nome é escolhido pelo cliente e pode ser trocado a qualquer momento, permitindo se passar por outra pessoa no chat.",
        "evidence": [("server.js:360-361", "if (m.t !== 'hello' && !client.name) return;\nconst fn = handlers[m.t];"),
                     ("server.js:250-251", "hello(c, m) {\n  c.name = clean(m.name, 32) || 'Anônimo';")],
        "impact": "Em deploy público (render.yaml) qualquer pessoa na internet pode excluir servidores e canais, ler e forjar mensagens com o nome de outro usuário.",
        "fix": "- Gerar token de sessão aleatório (`crypto.randomBytes(32)`) no primeiro `hello`, devolver ao cliente e exigir na reconexão.\n- Guardar `ownerId` em cada servidor e checar em `delete-server`, `delete-channel` e `create-channel`.\n- Rejeitar `hello` repetido que troque o nome, ou registrar troca de nome de forma visível.\n- Opcional: impedir nomes duplicados no mesmo servidor.",
        "accept": ["Cliente sem token válido não consegue executar nenhum handler além de `hello`",
                   "`delete-server`/`delete-channel`/`create-channel` vindos de quem não é dono retornam `error` e não alteram `data.json`",
                   "Reenviar `hello` com outro nome não altera o autor de mensagens já identificadas pela sessão",
                   "Teste automatizado com dois clientes cobrindo os casos acima"],
    },
    {
        "title": "[Segurança] Snapshot e chat vazam dados de todos os servidores para todos os clientes",
        "labels": ["security", "severity:high"],
        "refs": ["S1-01", "S1-02"],
        "problem": "`snapshot()` serializa todos os servidores, canais e membros e é enviado a todo cliente. O broadcast de chat manda cada mensagem para todos os clientes conectados, independentemente de canal ou servidor; o filtro existe só no navegador.",
        "evidence": [("server.js:204-221", "return db.servers.map((s) => ({ ... members: all.filter((c) => c.channelId === ch.id).map(pub) ...\nfor (const c of clients.values()) if (c.name) c.conn.send({ t: 'snapshot', servers });"),
                     ("server.js:348", "for (const o of clients.values()) if (o.name) o.conn.send({ t: 'chat', channelId: m.channelId, message: msg });")],
        "impact": "Qualquer pessoa com um WebSocket aberto vê a lista de servidores 'privados', quem está em cada chamada e recebe em tempo real todas as conversas do sistema (confirmado em PoC).",
        "fix": "- Introduzir membership por servidor (entrada via token de convite, não pelo ID).\n- `snapshot` por cliente: só servidores dos quais ele é membro.\n- Broadcast de `chat` só para membros do servidor do canal.",
        "accept": ["Cliente B, não membro do servidor X, não recebe X em nenhum `snapshot`",
                   "Mensagem enviada em canal de X não chega a B",
                   "Teste automatizado reproduzindo a PoC passa a falhar no vazamento"],
    },
    {
        "title": "[Segurança] IDOR: excluir servidores/canais e criar canais de terceiros por ID",
        "labels": ["security", "severity:high"],
        "refs": ["S3-01", "S3-02", "S3-06"],
        "problem": "`delete-server`, `delete-channel` e `create-channel` buscam o objeto pelo ID enviado e agem sem verificar se o chamador é dono. Os IDs são distribuídos a todos pelo snapshot.",
        "evidence": [("server.js:271-281", "const server = db.servers.find((s) => s.id === m.serverId);\n...\ndb.servers = db.servers.filter((s) => s !== server);"),
                     ("server.js:295-304", "const found = findChannel(m.channelId);\n...\ndelete db.messages[found.channel.id];"),
                     ("server.js:283-293", "const server = db.servers.find((s) => s.id === m.serverId);\n...\nserver.channels.push(channel);")],
        "impact": "Perda permanente de servidores, canais e histórico de mensagens de outros usuários (exclusão confirmada em PoC).",
        "fix": "- Depois de localizar o objeto, comparar `server.ownerId` com a sessão do chamador; caso contrário responder `error`.\n- Centralizar num helper `requireOwner(client, server)` usado pelos três handlers.",
        "accept": ["Não-dono recebe `error` em `delete-server`, `delete-channel` e `create-channel`",
                   "`data.json` permanece inalterado nesses casos",
                   "Dono continua conseguindo executar as três ações"],
    },
    {
        "title": "[Segurança] IDOR: ler histórico, postar e entrar em chamadas de canais alheios",
        "labels": ["security", "severity:high"],
        "refs": ["S3-03", "S3-04", "S3-05"],
        "problem": "`history`, `chat` e `join` só verificam que o canal existe. Entrar num canal faz os outros participantes abrirem WebRTC automaticamente com o intruso.",
        "evidence": [("server.js:335-338", "history(c, m) {\n  if (!findChannel(m.channelId)) return;"),
                     ("server.js:306-310", "join(c, m) {\n  if (!findChannel(m.channelId)) return;\n  ...\n  c.channelId = m.channelId;"),
                     ("server.js:342", "if (!text || !findChannel(m.channelId)) return;"),
                     ("public/app.js:225-226", "case 'peer-joined':\n  createPeer(m.peer);")],
        "impact": "Leitura das últimas 200 mensagens de qualquer canal (confirmado em PoC), escuta de áudio/vídeo/tela de chamadas alheias e spam em canais de terceiros.",
        "fix": "- Helper `requireMember(client, channelId)` que resolve o servidor do canal e exige membership.\n- Aplicar em `history`, `chat` e `join`.",
        "accept": ["Não-membro recebe `error` em `history`, `chat` e `join`",
                   "Nenhum `peer-joined` é emitido para não-membros",
                   "Testes automatizados cobrindo os três handlers"],
    },
    {
        "title": "[Segurança] Credenciais TURN de longa duração expostas sem autenticação em /config",
        "labels": ["security", "severity:medium"],
        "refs": ["S4-01"],
        "problem": "A rota pública `/config` devolve `TURN_USERNAME` e `TURN_CREDENTIAL` estáticos para qualquer requisição HTTP.",
        "evidence": [("server.js:389-393", "iceServers.push({\n  urls: turnUrls,\n  username: process.env.TURN_USERNAME || '',\n  credential: process.env.TURN_CREDENTIAL || '',\n});"),
                     ("server.js:404-406", "if (url.pathname === '/config') {\n  ...\n  res.end(JSON.stringify({ ice: iceConfig() }));")],
        "impact": "Terceiros podem usar o servidor TURN como relay de tráfego, consumindo banda paga. Só se aplica com TURN configurado.",
        "fix": "- Trocar por credenciais efêmeras (TURN REST API / coturn `use-auth-secret`): `username = <expira>:<sessão>`, `credential = HMAC-SHA1(segredo, username)`.\n- Validade curta (ex.: 1 h) e entregar só a clientes com sessão (ver issue de autenticação).",
        "accept": ["`/config` sem sessão não retorna credencial TURN",
                   "Credencial retornada expira e é rejeitada pelo TURN após a validade",
                   "O segredo do TURN nunca é enviado ao navegador"],
    },
    {
        "title": "[Segurança] DoS: fragmentos WebSocket sem limite e ausência de rate limit",
        "labels": ["security", "severity:medium"],
        "refs": ["X-01"],
        "problem": "O teto de 4 MB vale só para frames com tamanho de 64 bits. Fragmentos de continuação se acumulam em `this.frags` sem limite. Não há rate limit nem teto de servidores criados, e tudo é persistido.",
        "evidence": [("server.js:130-136", "this.frags.push(payload);\nif (fin) {\n  const text = Buffer.concat(this.frags).toString('utf8');"),
                     ("server.js:256-266", "'create-server'(c, m) { ... db.servers.push(server); save();")],
        "impact": "Um único cliente pode esgotar memória do processo (fragmentos) ou encher o disco/data.json (criação em massa). No plano free do Render isso derruba o serviço.",
        "fix": "- Somar o tamanho dos fragmentos e fechar a conexão acima de ~64 KB (mensagens do app são pequenas).\n- Rate limit simples por conexão (ex.: 20 mensagens/s).\n- Limite de servidores por usuário.",
        "accept": ["Mensagem fragmentada acima do limite fecha a conexão",
                   "Cliente acima do rate limit é desconectado ou ignorado",
                   "Teste automatizado para os dois limites"],
    },
    {
        "title": "[Segurança] Endurecimento: .gitignore, checagem de path, Origin do WebSocket e cabeçalhos",
        "labels": ["security", "severity:low"],
        "refs": ["S4-02", "X-02", "X-03", "S5-01"],
        "problem": "Itens de baixo risco agrupados: (1) sem `.gitignore`, `data.json` e `cert/key.pem` ficam na raiz e podem ser commitados por upload; (2) `startsWith(PUBLIC_DIR)` aceita pasta irmã `public*` via `%2f`; (3) upgrade WebSocket não valida `Origin`; (4) nenhuma resposta envia CSP/`X-Content-Type-Options`.",
        "evidence": [("server.js:15", "const DATA_FILE = path.join(__dirname, 'data.json');"),
                     ("server.js:413", "if (!file.startsWith(PUBLIC_DIR)) {"),
                     ("server.js:181", "if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !req.url.startsWith('/ws')) {"),
                     ("server.js:422-425", "res.writeHead(200, { 'Content-Type': ..., 'Cache-Control': 'no-cache' });")],
        "impact": "Vazamento de chave TLS e conversas se commitados; leitura de arquivos fora de public/ em cenário específico; CSWSH quando houver sessão por cookie; ausência de defesa em profundidade contra XSS futuro.",
        "fix": "- Criar `.gitignore` com `data.json`, `cert/`, `.env`.\n- Trocar a checagem por `const r = path.relative(PUBLIC_DIR, file); if (r.startsWith('..') || path.isAbsolute(r))`.\n- Validar `req.headers.origin` contra o host esperado no upgrade.\n- Enviar `Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:` e `X-Content-Type-Options: nosniff`.",
        "accept": ["`git status` não lista `data.json` nem `cert/` após rodar o servidor",
                   "`GET /..%2fpublic-x/arquivo` retorna 403",
                   "Upgrade com `Origin` de outro domínio é recusado",
                   "Respostas HTML trazem CSP e nosniff"],
    },
]

# ------------------------------------------------------------------ gráficos
SEV_ORDER = ["Crítica", "Alta", "Média", "Baixa", "Informativa"]
count = Counter(f[2] for f in FINDINGS)


def fig_png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    return buf


def donut():
    labels = [s for s in SEV_ORDER if count[s]]
    vals = [count[s] for s in labels]
    fig, ax = plt.subplots(figsize=(3.6, 3.2))
    ax.pie(vals, colors=[SEV[s][0] for s in labels], startangle=90, counterclock=False,
           wedgeprops=dict(width=0.38, edgecolor="white", linewidth=2))
    ax.text(0, 0.08, str(sum(vals)), ha="center", va="center", fontsize=22, fontweight="bold", color="#111827")
    ax.text(0, -0.2, "achados", ha="center", va="center", fontsize=9, color="#4B5563")
    ax.legend([f"{s} ({count[s]})" for s in labels], loc="center left", bbox_to_anchor=(1, 0.5), frameon=False, fontsize=8.5)
    ax.set_title("Achados por severidade", fontsize=10, fontweight="bold", color="#111827")
    return fig_png(fig)


def bars():
    cats = CATEGORIES
    fig, ax = plt.subplots(figsize=(6.6, 3.3))
    y = list(range(len(cats)))
    left = [0] * len(cats)
    for s in SEV_ORDER:
        vals = [sum(1 for f in FINDINGS if f[1] == c[0] and f[2] == s) for c in cats]
        if any(vals):
            ax.barh([i - 0.18 for i in y], vals, left=left, color=SEV[s][0], label=s, height=0.34, edgecolor="white")
            left = [a + b for a, b in zip(left, vals)]
    strong = [sum(1 for st in STRENGTHS if st[0] == c[0]) for c in cats]
    ax.barh([i + 0.18 for i in y], strong, color=GREEN, height=0.34, label="Ponto forte", edgecolor="white")
    ax.set_yticks(y)
    ax.set_yticklabels([c[1] for c in cats], fontsize=8.5)
    ax.invert_yaxis()
    ax.xaxis.set_major_locator(matplotlib.ticker.MaxNLocator(integer=True))
    ax.tick_params(axis="x", labelsize=8)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.grid(axis="x", color="#E5E7EB", linewidth=0.8)
    ax.set_axisbelow(True)
    ax.legend(loc="upper center", bbox_to_anchor=(0.4, -0.1), fontsize=7.5, frameon=False, ncol=6)
    ax.set_title("Achados (barra superior) e pontos fortes (verde) por categoria", fontsize=10, fontweight="bold", color="#111827")
    return fig_png(fig)


# ------------------------------------------------------------------ helpers de layout
def P(text, st="p"):
    return Paragraph(text, ss[st])


def code(text, st="code"):
    lines = [escape(l).replace("  ", "&nbsp;&nbsp;") or "&nbsp;" for l in text.split("\n")]
    return Paragraph("<br/>".join(lines), ss[st])


def chip(sev, width=2.0 * cm):
    color = SEV[sev][0] if sev in SEV else GREEN
    t = Table([[Paragraph(sev.upper(), ss["chip"])]], colWidths=[width], rowHeights=[0.5 * cm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(color)),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("ROUNDEDCORNERS", [4, 4, 4, 4]),
                           ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                           ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2)]))
    return t


def grid(rows, widths, header=True):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
             ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
             ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3F4F6")),
                  ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#9CA3AF"))]
    t.setStyle(TableStyle(style))
    return t


def bullets(items):
    return [Paragraph(i, ss["bul"], bulletText="•") for i in items]


W = A4[0] - 4 * cm


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("Sans", 7.5)
    canvas.setFillColor(MUTED)
    if doc.page > 1:
        canvas.drawString(2 * cm, A4[1] - 1.3 * cm, REPORT_NAME)
        canvas.drawRightString(A4[0] - 2 * cm, A4[1] - 1.3 * cm, DATE)
        canvas.setStrokeColor(LINE)
        canvas.line(2 * cm, A4[1] - 1.45 * cm, A4[0] - 2 * cm, A4[1] - 1.45 * cm)
    canvas.line(2 * cm, 1.45 * cm, A4[0] - 2 * cm, 1.45 * cm)
    canvas.drawString(2 * cm, 1.05 * cm, f"{PROJECT} — confidencial")
    canvas.drawRightString(A4[0] - 2 * cm, 1.05 * cm, f"Página {doc.page}")
    canvas.restoreState()


# ------------------------------------------------------------------ documento
def build():
    story = []
    cat_name = dict(CATEGORIES)

    # a) capa
    story += [Spacer(1, 3 * cm),
              Paragraph("RELATÓRIO", ParagraphStyle("k", parent=ss["small"], fontName="Sans-B", textColor=colors.HexColor(GREEN))),
              Paragraph(REPORT_NAME, ParagraphStyle("t", parent=ss["h1"], fontSize=24, leading=30)),
              P(f"Data: <b>{DATE}</b> &nbsp;&nbsp;·&nbsp;&nbsp; Versão auditada: <b>{COMMIT}</b>"),
              Spacer(1, 0.4 * cm),
              P("<b>Escopo auditado:</b> todos os 7 arquivos versionados — server.js (452 linhas), public/app.js, public/index.html, "
                "public/style.css, render.yaml, package.json, README.md — e o histórico git completo (5 commits). Os achados de "
                "isolamento e IDOR foram confirmados por prova de conceito contra uma cópia isolada do servidor, sem tocar no data.json do projeto."),
              Spacer(1, 0.3 * cm), P("Nota metodológica", "h2")]
    story.append(grid([[P(a, "cellb"), P(b, "cell")] for a, b in METHOD], [3.4 * cm, W - 3.4 * cm], header=False))
    story.append(PageBreak())

    # b) resumo executivo
    story.append(P("Resumo executivo", "h1"))
    total = len(FINDINGS)
    story.append(P(f"Foram encontrados <b>{total} achados</b> e registrados <b>{len(STRENGTHS)} pontos fortes</b>. "
                   "O risco central é estrutural: o Ressoa não tem identidade nem posse no servidor. Qualquer pessoa que acesse a URL "
                   "publicada vê todos os servidores, recebe todas as mensagens em tempo real, lê históricos, entra em chamadas alheias "
                   "e exclui servidores e canais de outras pessoas. O frontend, por outro lado, está bem protegido contra XSS e não há "
                   "segredos no código nem no histórico git."))
    chips = [[chip(s, 2.3 * cm) for s in SEV_ORDER],
             [Paragraph(f"<b>{count[s]}</b>", ParagraphStyle("n", parent=ss["h1"], alignment=TA_CENTER, spaceAfter=0)) for s in SEV_ORDER]]
    ct = Table(chips, colWidths=[W / 5] * 5)
    ct.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story += [Spacer(1, 0.2 * cm), ct, Spacer(1, 0.3 * cm)]
    story.append(Image(donut(), width=9.5 * cm, height=8.4 * cm * 0.85))
    story.append(Image(bars(), width=W, height=W * 3.6 / 6.6))
    story.append(P("Achados 'Fora das 5 categorias' foram verificados durante a auditoria e incluídos por relevância; "
                   "não entram na contagem das cinco categorias pedidas.", "small"))
    story.append(PageBreak())

    # c) pontos fortes e fracos
    story.append(P("Pontos fortes", "h1"))
    story.append(P("O que foi verificado e está correto, com evidência — também serve de prova de cobertura.", "small"))
    rows = [[P("Categoria", "cellb"), P("Evidência", "cellb"), P("O que está protegido", "cellb")]]
    for c, ev, txt in STRENGTHS:
        rows.append([P(cat_name[c], "cell"), P(f"<font name='Mono' size='7.4'>{escape(ev)}</font>", "cell"), P(txt, "cell")])
    t = grid(rows, [3.3 * cm, 3.9 * cm, W - 7.2 * cm])
    t.setStyle(TableStyle([("LINEBEFORE", (0, 1), (0, -1), 3, colors.HexColor(GREEN))]))
    story.append(t)
    story.append(P("Categorias sem achado ou adaptadas à stack", "h3"))
    story += bullets([f"<b>{cat_name[c]}:</b> {t}" for c, t in NOT_APPLICABLE])

    story.append(P("Pontos fracos (riscos centrais)", "h2"))
    story += bullets([
        "<b>Sem autenticação nem autorização</b> (S2-01): o servidor confia em qualquer conexão; o nome é a identidade e é escolhido pelo cliente.",
        "<b>Sem isolamento entre servidores</b> (S1-01, S1-02): snapshot e chat são globais; o 'convite' não protege nada.",
        "<b>IDOR em 5 de 11 handlers</b> (S3-01 a S3-06): excluir, criar, ler, postar e entrar por ID sem checar posse.",
        "<b>Credencial TURN pública</b> quando configurada (S4-01) e <b>ausência de limites anti-abuso</b> (X-01).",
    ])
    story.append(PageBreak())

    # d) tabela de achados
    story.append(P("Achados detalhados por categoria", "h1"))
    for cid, cname in CATEGORIES:
        fs = sorted([f for f in FINDINGS if f[1] == cid], key=lambda f: SEV[f[2]][1])
        story.append(P(cname, "h2"))
        if not fs:
            story.append(P("Nenhum achado verificado nesta categoria. Ver pontos fortes.", "small"))
            continue
        rows = [[P("Severidade", "cellb"), P("Arquivo:linha", "cellb"), P("Descrição", "cellb")]]
        for fid, _, sev, loc, title, desc, snip, cond in fs:
            body = [P(f"<b>{fid} — {title}</b>", "cell"), Spacer(1, 2), P(desc, "cell"), Spacer(1, 3),
                    Table([[code(snip)]], colWidths=[W - 6.6 * cm],
                          style=[("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F4F6")),
                                 ("LEFTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 4),
                                 ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]),
                    Spacer(1, 3), P(f"<i>Condição de explorabilidade:</i> {cond}", "small")]
            rows.append([chip(sev, 2.1 * cm), P(f"<font name='Mono' size='7.6'>{escape(loc)}</font>", "cell"), body])
        story.append(grid(rows, [2.5 * cm, 3.6 * cm, W - 6.1 * cm]))
    story.append(PageBreak())

    # e) recomendações
    story.append(P("Recomendações priorizadas", "h1"))
    prio_color = {"P1": SEV["Crítica"][0], "P2": SEV["Média"][0], "P3": SEV["Baixa"][0]}
    rows = [[P("Prioridade", "cellb"), P("Ação", "cellb"), P("Detalhe", "cellb")]]
    for p, a, d in RECS:
        c = Table([[Paragraph(p, ss["chip"])]], colWidths=[1.2 * cm], rowHeights=[0.5 * cm],
                  style=[("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(prio_color[p])), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                         ("ROUNDEDCORNERS", [4, 4, 4, 4])])
        rows.append([c, P(f"<b>{a}</b>", "cell"), P(d, "cell")])
    story.append(grid(rows, [2.1 * cm, 4.2 * cm, W - 6.3 * cm]))
    story.append(Spacer(1, 0.3 * cm))
    story.append(P("P1 resolve 10 dos 16 achados e deve vir antes de qualquer divulgação pública do link do Render. "
                   "As correções de P1 tornam X-03 (Origin) relevante — aplicar P3 junto.", "small"))
    story.append(PageBreak())

    # f) issues
    story.append(P("ISSUES PARA O GITHUB", "h1"))
    story.append(P(f"{len(ISSUES)} issues prontas para copiar e colar. Achados relacionados foram agrupados para não gerar spam. "
                   "Copie o conteúdo entre os delimitadores.", "small"))
    for n, iss in enumerate(ISSUES, 1):
        md = [f"--- ISSUE {n} ---", f"# {iss['title']}", "", f"**Labels sugeridas:** {', '.join('`' + l + '`' for l in iss['labels'])}",
              f"**Achados do relatório:** {', '.join(iss['refs'])}", "", "## Descrição do problema", iss["problem"], "", "## Evidência"]
        for loc, snip in iss["evidence"]:
            md += [f"`{loc}`", "```js", *snip.split("\n"), "```"]
        md += ["", "## Impacto", iss["impact"], "", "## Sugestão de correção", *iss["fix"].split("\n"), "",
               "## Critérios de aceite", *[f"- [ ] {a}" for a in iss["accept"]], f"--- FIM ISSUE {n} ---"]
        sev = {"severity:critical": "Crítica", "severity:high": "Alta", "severity:medium": "Média", "severity:low": "Baixa"}[iss["labels"][1]]
        head = Table([[chip(sev, 2.0 * cm), P(f"<b>Issue {n}</b> — {escape(iss['title'])}", "cell")]], colWidths=[2.3 * cm, W - 2.3 * cm],
                     style=[("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)])
        rows = [[code(l, "md")] for l in md]
        box = Table(rows, colWidths=[W])
        box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F9FAFB")),
                                 ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#D1D5DB")),
                                 ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor(SEV[sev][0])),
                                 ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                                 ("LEFTPADDING", (0, 0), (-1, -1), 8)]))
        story += [Spacer(1, 0.35 * cm), head, Spacer(1, 4), box]

    doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                            title=REPORT_NAME, author="Auditoria de segurança", subject=f"Segurança — {PROJECT}")
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(OUT)


if __name__ == "__main__":
    build()

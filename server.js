// Servidor HTTP sem dependências: API REST + Server-Sent Events para as telas em tempo real.
// Todo acesso (páginas, API e tempo real) passa pela sessão e pelas permissões do cargo.

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarStore, ErroValidacao } = require('./src/store');
const { loja, cozinhas, cardapioPublico } = require('./src/menu');
const impressora = require('./src/impressora');
const { popularExemplos } = require('./src/seed');
const { ligarPersistencia } = require('./src/persistencia');
const { criarAuth, pode, CARGOS, ErroAuth } = require('./src/auth');

const PRINCIPAL = require.main === module;
const PORTA = Number(process.env.PORT) || 3000;
const VERSAO = process.env.VERSAO || 'dev'; // commit publicado; o deploy confere por aqui
const PUBLICO = path.join(__dirname, 'public');
const PASTA_DADOS = path.dirname(process.env.ARQUIVO_DADOS || path.join(__dirname, 'dados', 'pedidos.json'));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const store = criarStore();
// Em testes (módulo importado) os usuários ficam só em memória.
const auth = criarAuth({ arquivo: PRINCIPAL ? process.env.ARQUIVO_USUARIOS || path.join(PASTA_DADOS, 'usuarios.json') : null });

// ---------- Sessão ----------
const COOKIE = 'sessao';
const IDADE_COOKIE_S = 30 * 24 * 60 * 60;

function lerCookie(req, nome) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [chave, ...valor] = parte.trim().split('=');
    if (chave === nome) return decodeURIComponent(valor.join('='));
  }
  return null;
}

function cookieSessao(token, idade = IDADE_COOKIE_S) {
  const seguro = process.env.COOKIE_SEGURO === '1' ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${idade}${seguro}`;
}

const usuarioDe = (req) => auth.sessao(lerCookie(req, COOKIE));

class ErroAcesso extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// Exige sessão (e, se informado, uma das permissões). Devolve o usuário.
function exigir(req, ...permissoes) {
  const u = usuarioDe(req);
  if (!u) throw new ErroAcesso(401, 'Faça login para continuar.');
  if (u.trocarSegredo) throw new ErroAcesso(403, 'Troque sua senha temporária antes de continuar.');
  if (permissoes.length && !permissoes.some((p) => pode(u, p))) {
    throw new ErroAcesso(403, 'Seu cargo não tem acesso a isto.');
  }
  return u;
}

const veTodosPedidos = (u) => pode(u, 'pedido:ver:todos');
const vePedido = (u, pedido) => veTodosPedidos(u) || (pode(u, 'pedido:ver:proprios') && pedido.garcomId === u.id);

// ---------- Tempo real (SSE) ----------
// Cada cliente assina um canal ("cozinha:1", "cozinha:2", "garcom" ou "impressoras")
// e só recebe o que o seu usuário pode ver.
const clientes = new Set();

function transmitir(canal, evento, dados, podeVer = () => true) {
  const msg = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const c of clientes) if (c.canal === canal && podeVer(c.usuario)) c.res.write(msg);
}

function abrirStream(req, res, canal, usuario) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  const cliente = { canal, res, usuario };
  clientes.add(cliente);
  req.on('close', () => clientes.delete(cliente));
}

setInterval(() => {
  for (const c of clientes) c.res.write(': ping\n\n');
}, 25000).unref();

// Usuário desativado ou com PIN trocado: derruba as telas abertas na hora.
auth.eventos.on('sessoes:revogadas', (usuarioId) => {
  for (const c of clientes) {
    if (c.usuario.id === usuarioId) {
      c.res.end();
      clientes.delete(c);
    }
  }
});

// ---------- Impressão ----------
// Guarda as últimas impressões de cada cozinha para a tela de simulação.
const MAX_IMPRESSOES = 30;
const impressoes = [];
let proximaImpressao = 1;

async function imprimir(cozinhaId, tipo, linhas, ticket = null) {
  const job = {
    id: proximaImpressao++,
    cozinhaId,
    tipo, // 'pedido' | 'cancelamento' | 'teste'
    ticketId: ticket ? ticket.id : null,
    numeroPedido: ticket ? ticket.numeroPedido : null,
    rotulo: ticket ? ticket.rotulo : null,
    ...impressora.descreverDestino(cozinhaId),
    status: 'ok',
    erro: null,
    linhas,
    em: new Date().toISOString(),
  };
  // Entra no histórico já na ordem dos pedidos, mesmo que o envio de outro termine antes.
  impressoes.push(job);
  const daCozinha = impressoes.filter((j) => j.cozinhaId === cozinhaId);
  if (daCozinha.length > MAX_IMPRESSOES) impressoes.splice(impressoes.indexOf(daCozinha[0]), 1);
  try {
    await impressora.enviar(cozinhaId, linhas);
  } catch (err) {
    job.status = 'falhou';
    job.erro = err.message;
    console.error(`Falha na impressora da cozinha ${cozinhaId}: ${err.message}`);
  }
  transmitir('impressoras', 'impressao', job, (u) => pode(u, `impressora:${cozinhaId}`));
  return job;
}

async function imprimirTicket(ticket) {
  const job = await imprimir(ticket.cozinhaId, 'pedido', impressora.linhasDoTicket(ticket), ticket);
  const resultado = job.status === 'falhou' ? 'falhou' : job.modo === 'rede' ? 'impresso' : 'simulado';
  return store.atualizarTicket(ticket.id, { impressao: resultado });
}

function estadoDasImpressoras(u) {
  return Object.values(cozinhas)
    .filter((c) => pode(u, `impressora:${c.id}`))
    .map((c) => ({
      cozinhaId: c.id,
      nome: c.nome,
      setor: c.setor,
      ...impressora.descreverDestino(c.id),
      impressoes: impressoes.filter((j) => j.cozinhaId === c.id),
    }));
}

// ---------- Eventos do store -> telas e impressoras ----------
const daCozinha = (cozinhaId) => (u) => pode(u, `cozinha:${cozinhaId}`);
const doPedido = (pedidoOuTicket) => (u) => vePedido(u, pedidoOuTicket);

store.eventos.on('ticket:novo', (ticket) => {
  transmitir(`cozinha:${ticket.cozinhaId}`, 'ticket', ticket, daCozinha(ticket.cozinhaId));
  imprimirTicket(ticket);
});
store.eventos.on('ticket:atualizado', (ticket) => {
  transmitir(`cozinha:${ticket.cozinhaId}`, 'ticket', ticket, daCozinha(ticket.cozinhaId));
  transmitir('garcom', 'ticket', ticket, doPedido(ticket));
});
store.eventos.on('ticket:cancelado', (ticket) => {
  transmitir(`cozinha:${ticket.cozinhaId}`, 'ticket', ticket, daCozinha(ticket.cozinhaId));
  imprimir(ticket.cozinhaId, 'cancelamento', impressora.linhasDoCancelamento(ticket), ticket);
});
store.eventos.on('pedido', (pedido) => transmitir('garcom', 'pedido', pedido, doPedido(pedido)));
store.eventos.on('pedido:atualizado', (pedido) => transmitir('garcom', 'pedido', pedido, doPedido(pedido)));

// ---------- HTTP ----------
function json(res, status, dados, cabecalhos = {}) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...cabecalhos });
  res.end(JSON.stringify(dados));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let corpo = '';
    req.on('data', (parte) => {
      corpo += parte;
      if (corpo.length > 100_000) req.destroy(new Error('Corpo muito grande'));
    });
    req.on('end', () => {
      try {
        resolve(corpo ? JSON.parse(corpo) : {});
      } catch {
        reject(new ErroValidacao('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function redirecionar(res, destino) {
  res.writeHead(302, { Location: destino, 'Cache-Control': 'no-store' });
  res.end();
}

// Quem pode abrir cada página. Arquivos fora desta lista (css, js, ícones) são públicos.
const PAGINAS = {
  '/index.html': (u) => pode(u, 'pedido:criar'),
  '/cozinha.html': (u, url) => pode(u, `cozinha:${url.searchParams.get('id')}`),
  '/impressoras.html': (u) => pode(u, 'impressora:1') || pode(u, 'impressora:2'),
  '/painel.html': (u) => pode(u, 'painel'),
  '/usuarios.html': (u) => pode(u, 'usuarios:todos') || pode(u, 'usuarios:equipe'),
  '/conta.html': () => true,
};

function servirPagina(req, res, url) {
  const caminho = url.pathname === '/' ? '/index.html' : url.pathname;
  const regra = PAGINAS[caminho];
  if (regra) {
    const u = usuarioDe(req);
    if (!u) return redirecionar(res, `/login.html?volta=${encodeURIComponent(url.pathname + url.search)}`);
    if (u.trocarSegredo && caminho !== '/conta.html') return redirecionar(res, '/conta.html?primeiro=1');
    if (!regra(u, url)) return redirecionar(res, `${u.inicio}${u.inicio.includes('?') ? '&' : '?'}negado=1`);
  }
  servirArquivo(res, caminho);
}

function servirArquivo(res, caminho) {
  let relativo;
  try {
    relativo = decodeURIComponent(caminho);
  } catch {
    return json(res, 400, { erro: 'Endereço inválido' });
  }
  const arquivo = path.normalize(path.join(PUBLICO, relativo));
  if (!arquivo.startsWith(PUBLICO + path.sep)) return json(res, 403, { erro: 'Proibido' });
  fs.readFile(arquivo, (err, conteudo) => {
    if (err) return json(res, 404, { erro: 'Não encontrado' });
    const ext = path.extname(arquivo);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Páginas não ficam em cache: ao sair, o botão voltar não mostra dados antigos.
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    });
    res.end(conteudo);
  });
}

// IPs da rede local, com Wi-Fi/Ethernet primeiro. Adaptadores virtuais (WSL, Docker,
// VirtualBox...) ficam de fora: o celular não alcança esses endereços.
const ADAPTADOR_VIRTUAL = /vethernet|wsl|hyper-v|docker|virtualbox|vmware|vbox|loopback|tailscale|zerotier/i;
const ADAPTADOR_FISICO = /wi-?fi|wlan|wireless|ethernet|^en|^eth/i;

function enderecosLocais() {
  return Object.entries(os.networkInterfaces())
    .filter(([nome]) => !ADAPTADOR_VIRTUAL.test(nome))
    .flatMap(([nome, lista]) => lista.map((i) => ({ nome, ...i })))
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .sort((a, b) => ADAPTADOR_FISICO.test(b.nome) - ADAPTADOR_FISICO.test(a.nome))
    .map((i) => i.address);
}

async function rotear(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const get = req.method === 'GET';
  const post = req.method === 'POST';
  const patch = req.method === 'PATCH';
  let m;

  // ----- Público -----
  if (get && p === '/api/info') {
    const u = usuarioDe(req);
    const basico = { loja, versao: VERSAO };
    return json(res, 200, u ? { ...basico, porta: PORTA, enderecos: enderecosLocais(), cozinhas: Object.values(cozinhas) } : basico);
  }
  if (post && p === '/api/entrar') {
    const { usuario, segredo } = await lerCorpo(req);
    const r = auth.entrar({ usuario, segredo, ip: req.socket.remoteAddress });
    return json(res, 200, { usuario: r.usuario }, { 'Set-Cookie': cookieSessao(r.token) });
  }
  if (post && p === '/api/sair') {
    auth.sair(lerCookie(req, COOKIE));
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao('', 0) });
  }

  // ----- Minha conta (permitido mesmo com senha temporária) -----
  if (get && p === '/api/eu') {
    const u = usuarioDe(req);
    return u ? json(res, 200, u) : json(res, 401, { erro: 'Faça login para continuar.' });
  }
  if (post && p === '/api/eu/segredo') {
    const u = usuarioDe(req);
    if (!u) throw new ErroAcesso(401, 'Faça login para continuar.');
    const atualizado = auth.trocarProprioSegredo(u, await lerCorpo(req));
    return json(res, 200, atualizado);
  }

  // ----- Daqui para baixo, só com sessão -----
  if (p.startsWith('/api/')) {
    if (get && p === '/api/menu') {
      exigir(req);
      return json(res, 200, cardapioPublico());
    }

    if (get && p === '/api/resumo') {
      const u = exigir(req, 'painel');
      const r = store.resumo();
      if (!pode(u, 'faturamento')) {
        delete r.faturamento;
        delete r.ticketMedio;
      }
      return json(res, 200, r);
    }

    // Pedidos
    if (get && p === '/api/pedidos') {
      const u = exigir(req, 'pedido:ver:todos', 'pedido:ver:proprios');
      return json(res, 200, store.pedidosRecentes(30, (pedido) => vePedido(u, pedido)));
    }
    if (post && p === '/api/pedidos') {
      const u = exigir(req, 'pedido:criar');
      const dados = await lerCorpo(req);
      return json(res, 201, store.criarPedido({ ...dados, garcom: u.nome, garcomId: u.id }));
    }
    if (post && (m = p.match(/^\/api\/pedidos\/(\d+)\/cancelar$/))) {
      const u = exigir(req, 'pedido:cancelar:todos', 'pedido:cancelar:proprios');
      const pedido = store.buscarPedido(m[1]);
      if (!pedido || !vePedido(u, pedido)) return json(res, 404, { erro: 'Pedido não encontrado' });
      if (!pode(u, 'pedido:cancelar:todos')) {
        if (pedido.garcomId !== u.id) throw new ErroAcesso(403, 'Você só pode cancelar os seus pedidos.');
        const comecou = pedido.ticketIds.map(store.buscarTicket).some((t) => t.status !== 'novo');
        if (comecou) throw new ErroAcesso(403, 'A cozinha já começou este pedido. Peça ao gerente para cancelar.');
      }
      return json(res, 200, store.cancelarPedido(pedido.id));
    }
    if (get && p === '/api/garcom/stream') {
      const u = exigir(req, 'pedido:ver:todos', 'pedido:ver:proprios');
      return abrirStream(req, res, 'garcom', u);
    }

    // Cozinhas e tickets
    if (get && (m = p.match(/^\/api\/cozinhas\/(\d+)\/(tickets|stream)$/))) {
      if (!cozinhas[m[1]]) return json(res, 404, { erro: 'Cozinha não encontrada' });
      const u = exigir(req, `cozinha:${m[1]}`);
      if (m[2] === 'stream') return abrirStream(req, res, `cozinha:${m[1]}`, u);
      return json(res, 200, store.ticketsDaCozinha(m[1]));
    }
    if ((m = p.match(/^\/api\/tickets\/(\d+)(\/imprimir)?$/)) && (patch || post)) {
      const ticket = store.buscarTicket(m[1]);
      if (!ticket) return json(res, 404, { erro: 'Ticket não encontrado' });
      exigir(req, `cozinha:${ticket.cozinhaId}`);
      if (patch && !m[2]) {
        const { status } = await lerCorpo(req);
        return json(res, 200, store.atualizarTicket(ticket.id, { status }));
      }
      if (post && m[2]) return json(res, 200, await imprimirTicket(ticket));
    }

    // Impressoras
    if (get && p === '/api/impressoras') {
      const u = exigir(req, 'impressora:1', 'impressora:2');
      return json(res, 200, estadoDasImpressoras(u));
    }
    if (get && p === '/api/impressoras/stream') {
      const u = exigir(req, 'impressora:1', 'impressora:2');
      return abrirStream(req, res, 'impressoras', u);
    }
    if (post && (m = p.match(/^\/api\/impressoras\/(\d+)\/teste$/))) {
      const cozinhaId = Number(m[1]);
      if (!cozinhas[cozinhaId]) return json(res, 404, { erro: 'Cozinha não encontrada' });
      exigir(req, `impressora:${cozinhaId}`);
      const { destino } = impressora.descreverDestino(cozinhaId);
      return json(res, 200, await imprimir(cozinhaId, 'teste', impressora.linhasDoTeste(cozinhaId, destino)));
    }

    // Usuários
    if (get && p === '/api/usuarios') {
      const u = exigir(req, 'usuarios:todos', 'usuarios:equipe');
      const cargos = auth.cargosCriaveis(u).map((id) => ({ id, nome: CARGOS[id].nome, login: CARGOS[id].login }));
      return json(res, 200, { usuarios: auth.listar(u), cargos });
    }
    if (post && p === '/api/usuarios') {
      const u = exigir(req, 'usuarios:todos', 'usuarios:equipe');
      return json(res, 201, auth.criarUsuario(u, await lerCorpo(req)));
    }
    if (patch && (m = p.match(/^\/api\/usuarios\/(\d+)$/))) {
      const u = exigir(req, 'usuarios:todos', 'usuarios:equipe');
      return json(res, 200, auth.atualizarUsuario(u, m[1], await lerCorpo(req)));
    }

    return json(res, 404, { erro: 'Rota não encontrada' });
  }

  // ----- Páginas -----
  if ((m = p.match(/^\/cozinha\/(\d+)\/?$/))) return redirecionar(res, `/cozinha.html?id=${m[1]}`);
  if (p === '/impressoras') return redirecionar(res, '/impressoras.html');
  if (p === '/painel') return redirecionar(res, '/painel.html');
  if (p === '/usuarios') return redirecionar(res, '/usuarios.html');
  if (p === '/login') return redirecionar(res, '/login.html');
  if (get) return servirPagina(req, res, url);
  return json(res, 404, { erro: 'Rota não encontrada' });
}

const servidor = http.createServer((req, res) => {
  rotear(req, res).catch((err) => {
    if (err instanceof ErroValidacao) return json(res, 400, { erro: err.message });
    if (err instanceof ErroAuth || err instanceof ErroAcesso) return json(res, err.status, { erro: err.message });
    console.error(err);
    json(res, 500, { erro: 'Erro interno' });
  });
});

if (PRINCIPAL) {
  const arquivoDados = process.env.ARQUIVO_DADOS || path.join(PASTA_DADOS, 'pedidos.json');
  const { restaurado } = ligarPersistencia(store, arquivoDados);
  if (restaurado) console.log(`\n  Pedidos restaurados de ${arquivoDados}`);
  else if (process.env.SEM_EXEMPLOS !== '1') popularExemplos(store);

  const senhaDono = auth.garantirDono();
  servidor.listen(PORTA, () => {
    const ip = enderecosLocais()[0] || 'localhost';
    console.log(`\n  ${loja.nome} - sistema de pedidos (versão ${VERSAO.slice(0, 7)})\n`);
    console.log(`  Entrar:            http://localhost:${PORTA}/login`);
    console.log(`  Garçom (celular):  http://${ip}:${PORTA}/`);
    console.log(`  Cozinha 1:         http://${ip}:${PORTA}/cozinha/1`);
    console.log(`  Cozinha 2:         http://${ip}:${PORTA}/cozinha/2\n`);
    for (const c of Object.values(cozinhas)) {
      const d = impressora.descreverDestino(c.id);
      console.log(`  Impressora ${c.nome}: ${d.modo === 'rede' ? d.destino : 'simulada'}`);
    }
    if (senhaDono) {
      console.log('\n  ============================================================');
      console.log('  PRIMEIRO ACESSO: entre como dono e defina uma senha nova');
      console.log(`    usuário: dono`);
      console.log(`    senha temporária: ${senhaDono}`);
      console.log('  ============================================================');
    }
    console.log('');
  });
}

module.exports = { servidor, store, auth };

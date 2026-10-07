// Servidor HTTP sem dependências: API REST + Server-Sent Events para as telas em tempo real.

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarStore, ErroValidacao } = require('./src/store');
const { loja, cozinhas, cardapioPublico } = require('./src/menu');
const impressora = require('./src/impressora');
const { popularExemplos } = require('./src/seed');
const { ligarPersistencia } = require('./src/persistencia');

const PORTA = Number(process.env.PORT) || 3000;
const PUBLICO = path.join(__dirname, 'public');
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

// ---------- Tempo real (SSE) ----------
// Cada cliente assina um canal: "cozinha:1", "cozinha:2", "garcom" ou "impressoras".
const clientes = new Set();

function transmitir(canal, evento, dados) {
  const msg = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const c of clientes) if (c.canal === canal) c.res.write(msg);
}

function abrirStream(req, res, canal) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  const cliente = { canal, res };
  clientes.add(cliente);
  req.on('close', () => clientes.delete(cliente));
}

setInterval(() => {
  for (const c of clientes) c.res.write(': ping\n\n');
}, 25000).unref();

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
  transmitir('impressoras', 'impressao', job);
  return job;
}

async function imprimirTicket(ticket) {
  const job = await imprimir(ticket.cozinhaId, 'pedido', impressora.linhasDoTicket(ticket), ticket);
  const resultado = job.status === 'falhou' ? 'falhou' : job.modo === 'rede' ? 'impresso' : 'simulado';
  return store.atualizarTicket(ticket.id, { impressao: resultado });
}

function estadoDasImpressoras() {
  return Object.values(cozinhas).map((c) => ({
    cozinhaId: c.id,
    nome: c.nome,
    setor: c.setor,
    ...impressora.descreverDestino(c.id),
    impressoes: impressoes.filter((j) => j.cozinhaId === c.id),
  }));
}

// ---------- Eventos do store -> telas e impressoras ----------
store.eventos.on('ticket:novo', (ticket) => {
  transmitir(`cozinha:${ticket.cozinhaId}`, 'ticket', ticket);
  imprimirTicket(ticket);
});
store.eventos.on('ticket:atualizado', (ticket) => {
  transmitir(`cozinha:${ticket.cozinhaId}`, 'ticket', ticket);
  transmitir('garcom', 'ticket', ticket);
});
store.eventos.on('ticket:cancelado', (ticket) => {
  transmitir(`cozinha:${ticket.cozinhaId}`, 'ticket', ticket);
  imprimir(ticket.cozinhaId, 'cancelamento', impressora.linhasDoCancelamento(ticket), ticket);
});
store.eventos.on('pedido', (pedido) => transmitir('garcom', 'pedido', pedido));
store.eventos.on('pedido:atualizado', (pedido) => transmitir('garcom', 'pedido', pedido));

// ---------- HTTP ----------
function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
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

function servirArquivo(res, caminhoUrl) {
  const relativo = decodeURIComponent(caminhoUrl === '/' ? '/index.html' : caminhoUrl);
  const arquivo = path.normalize(path.join(PUBLICO, relativo));
  if (!arquivo.startsWith(PUBLICO + path.sep)) return json(res, 403, { erro: 'Proibido' });
  fs.readFile(arquivo, (err, conteudo) => {
    if (err) return json(res, 404, { erro: 'Não encontrado' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream' });
    res.end(conteudo);
  });
}

function redirecionar(res, destino) {
  res.writeHead(302, { Location: destino });
  res.end();
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
  let m;

  // Cardápio e informações
  if (get && p === '/api/menu') return json(res, 200, cardapioPublico());
  if (get && p === '/api/info') {
    return json(res, 200, { loja, porta: PORTA, enderecos: enderecosLocais(), cozinhas: Object.values(cozinhas) });
  }

  if (get && p === '/api/resumo') return json(res, 200, store.resumo());

  // Pedidos
  if (get && p === '/api/pedidos') return json(res, 200, store.pedidosRecentes());
  if (post && p === '/api/pedidos') return json(res, 201, store.criarPedido(await lerCorpo(req)));
  if (post && (m = p.match(/^\/api\/pedidos\/(\d+)\/cancelar$/))) {
    const pedido = store.cancelarPedido(m[1]);
    return pedido ? json(res, 200, pedido) : json(res, 404, { erro: 'Pedido não encontrado' });
  }
  if (get && p === '/api/garcom/stream') return abrirStream(req, res, 'garcom');

  // Cozinhas e tickets
  if (get && (m = p.match(/^\/api\/cozinhas\/(\d+)\/(tickets|stream)$/))) {
    if (!cozinhas[m[1]]) return json(res, 404, { erro: 'Cozinha não encontrada' });
    if (m[2] === 'stream') return abrirStream(req, res, `cozinha:${m[1]}`);
    return json(res, 200, store.ticketsDaCozinha(m[1]));
  }
  if (req.method === 'PATCH' && (m = p.match(/^\/api\/tickets\/(\d+)$/))) {
    const { status } = await lerCorpo(req);
    const ticket = store.atualizarTicket(m[1], { status });
    return ticket ? json(res, 200, ticket) : json(res, 404, { erro: 'Ticket não encontrado' });
  }
  if (post && (m = p.match(/^\/api\/tickets\/(\d+)\/imprimir$/))) {
    const ticket = store.buscarTicket(m[1]);
    if (!ticket) return json(res, 404, { erro: 'Ticket não encontrado' });
    return json(res, 200, await imprimirTicket(ticket));
  }

  // Impressoras
  if (get && p === '/api/impressoras') return json(res, 200, estadoDasImpressoras());
  if (get && p === '/api/impressoras/stream') return abrirStream(req, res, 'impressoras');
  if (post && (m = p.match(/^\/api\/impressoras\/(\d+)\/teste$/))) {
    const cozinhaId = Number(m[1]);
    if (!cozinhas[cozinhaId]) return json(res, 404, { erro: 'Cozinha não encontrada' });
    const { destino } = impressora.descreverDestino(cozinhaId);
    return json(res, 200, await imprimir(cozinhaId, 'teste', impressora.linhasDoTeste(cozinhaId, destino)));
  }

  // Atalhos de página
  if ((m = p.match(/^\/cozinha\/(\d+)\/?$/))) return redirecionar(res, `/cozinha.html?id=${m[1]}`);
  if (p === '/impressoras') return redirecionar(res, '/impressoras.html');
  if (p === '/painel') return redirecionar(res, '/painel.html');

  if (get && !p.startsWith('/api/')) return servirArquivo(res, p);
  return json(res, 404, { erro: 'Rota não encontrada' });
}

const servidor = http.createServer((req, res) => {
  rotear(req, res).catch((err) => {
    if (err instanceof ErroValidacao) return json(res, 400, { erro: err.message });
    console.error(err);
    json(res, 500, { erro: 'Erro interno' });
  });
});

if (require.main === module) {
  const arquivoDados = process.env.ARQUIVO_DADOS || path.join(__dirname, 'dados', 'pedidos.json');
  const { restaurado } = ligarPersistencia(store, arquivoDados);
  if (restaurado) console.log(`\n  Pedidos restaurados de ${arquivoDados}`);
  else if (process.env.SEM_EXEMPLOS !== '1') popularExemplos(store);
  servidor.listen(PORTA, () => {
    const ip = enderecosLocais()[0] || 'localhost';
    console.log(`\n  ${loja.nome} - sistema de pedidos\n`);
    console.log(`  Painel:            http://localhost:${PORTA}/painel`);
    console.log(`  Garçom (celular):  http://${ip}:${PORTA}/`);
    console.log(`  Cozinha 1:         http://${ip}:${PORTA}/cozinha/1`);
    console.log(`  Cozinha 2:         http://${ip}:${PORTA}/cozinha/2`);
    console.log(`  Impressoras:       http://${ip}:${PORTA}/impressoras\n`);
    for (const c of Object.values(cozinhas)) {
      const d = impressora.descreverDestino(c.id);
      console.log(`  Impressora ${c.nome}: ${d.modo === 'rede' ? d.destino : 'simulada'}`);
    }
    console.log('');
  });
}

module.exports = { servidor, store };

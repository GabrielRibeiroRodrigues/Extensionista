// Servidor HTTP sem dependências: API REST + Server-Sent Events para as telas em tempo real.

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarStore, ErroValidacao } = require('./src/store');
const { cozinhas, cardapioPublico } = require('./src/menu');
const { imprimir } = require('./src/impressora');
const { popularExemplos } = require('./src/seed');

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
// Cada cliente assina um canal: "cozinha:1", "cozinha:2" ou "garcom".
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

store.eventos.on('ticket:novo', (ticket) => {
  transmitir(`cozinha:${ticket.cozinhaId}`, 'ticket', ticket);
  enviarParaImpressora(ticket);
});
store.eventos.on('ticket:atualizado', (ticket) => {
  transmitir(`cozinha:${ticket.cozinhaId}`, 'ticket', ticket);
  transmitir('garcom', 'ticket', ticket);
});
store.eventos.on('pedido', (pedido) => transmitir('garcom', 'pedido', pedido));
store.eventos.on('pedido:atualizado', (pedido) => transmitir('garcom', 'pedido', pedido));
store.eventos.on('ticket:cancelado', (ticket) => transmitir(`cozinha:${ticket.cozinhaId}`, 'ticket', ticket));

async function enviarParaImpressora(ticket) {
  try {
    const r = await imprimir(ticket);
    store.atualizarTicket(ticket.id, { impressao: r.modo === 'rede' ? 'impresso' : 'simulado' });
  } catch (err) {
    console.error(`Falha ao imprimir ticket ${ticket.id} (cozinha ${ticket.cozinhaId}):`, err.message);
    store.atualizarTicket(ticket.id, { impressao: 'falhou' });
  }
}

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

async function rotear(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  let m;

  if (req.method === 'GET' && p === '/api/menu') {
    return json(res, 200, cardapioPublico());
  }
  if (req.method === 'GET' && p === '/api/pedidos') {
    return json(res, 200, store.pedidosRecentes());
  }
  if (req.method === 'POST' && p === '/api/pedidos') {
    return json(res, 201, store.criarPedido(await lerCorpo(req)));
  }
  if ((m = p.match(/^\/api\/pedidos\/(\d+)\/cancelar$/)) && req.method === 'POST') {
    const pedido = store.cancelarPedido(m[1]);
    return pedido ? json(res, 200, pedido) : json(res, 404, { erro: 'Pedido não encontrado' });
  }
  if (req.method === 'GET' && p === '/api/garcom/stream') {
    return abrirStream(req, res, 'garcom');
  }
  if ((m = p.match(/^\/api\/cozinhas\/(\d+)\/(tickets|stream)$/)) && req.method === 'GET') {
    if (!cozinhas[m[1]]) return json(res, 404, { erro: 'Cozinha não encontrada' });
    if (m[2] === 'stream') return abrirStream(req, res, `cozinha:${m[1]}`);
    return json(res, 200, store.ticketsDaCozinha(m[1]));
  }
  if ((m = p.match(/^\/api\/tickets\/(\d+)$/)) && req.method === 'PATCH') {
    const { status } = await lerCorpo(req);
    const ticket = store.atualizarTicket(m[1], { status });
    return ticket ? json(res, 200, ticket) : json(res, 404, { erro: 'Ticket não encontrado' });
  }
  if ((m = p.match(/^\/api\/tickets\/(\d+)\/imprimir$/)) && req.method === 'POST') {
    const ticket = store.buscarTicket(m[1]);
    if (!ticket) return json(res, 404, { erro: 'Ticket não encontrado' });
    await enviarParaImpressora(ticket);
    return json(res, 200, store.buscarTicket(m[1]));
  }
  if ((m = p.match(/^\/cozinha\/(\d+)\/?$/))) {
    res.writeHead(302, { Location: `/cozinha.html?id=${m[1]}` });
    return res.end();
  }
  if (req.method === 'GET' && !p.startsWith('/api/')) return servirArquivo(res, p);
  return json(res, 404, { erro: 'Rota não encontrada' });
}

const servidor = http.createServer((req, res) => {
  rotear(req, res).catch((err) => {
    if (err instanceof ErroValidacao) return json(res, 400, { erro: err.message });
    console.error(err);
    json(res, 500, { erro: 'Erro interno' });
  });
});

function enderecosLocais() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

if (require.main === module) {
  if (process.env.SEM_EXEMPLOS !== '1') popularExemplos(store);
  servidor.listen(PORTA, () => {
    const ips = ['localhost', ...enderecosLocais()];
    console.log('Pizzaria rodando!\n');
    for (const ip of ips) {
      console.log(`  Garçom (celular): http://${ip}:${PORTA}/`);
    }
    console.log(`  Cozinha 1:        http://${ips.at(-1)}:${PORTA}/cozinha/1`);
    console.log(`  Cozinha 2:        http://${ips.at(-1)}:${PORTA}/cozinha/2\n`);
  });
}

module.exports = { servidor, store };

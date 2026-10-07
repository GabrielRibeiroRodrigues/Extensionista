const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { servidor } = require('../server');

let base;
test.before(() => new Promise((r) => servidor.listen(0, () => {
  base = `http://127.0.0.1:${servidor.address().port}`;
  r();
})));
test.after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

function esperarEvento(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let buffer = '';
      res.on('data', (d) => {
        buffer += d;
        const m = buffer.match(/event: ticket\ndata: (.*)\n\n/);
        if (m) {
          req.destroy();
          resolve(JSON.parse(m[1]));
        }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

test('pedido chega na tela da cozinha certa em tempo real', async () => {
  const naCozinha2 = esperarEvento(`${base}/api/cozinhas/2/stream`);
  await new Promise((r) => setTimeout(r, 50));

  const res = await fetch(`${base}/api/pedidos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mesa: '10', itens: [{ produtoId: 'p1', qtd: 1 }, { produtoId: 'm4', qtd: 1 }] }),
  });
  assert.equal(res.status, 201);
  const pedido = await res.json();
  assert.deepEqual(pedido.tickets.map((t) => t.cozinhaId), [1, 2]);

  const ticket = await naCozinha2;
  assert.equal(ticket.cozinhaId, 2);
  assert.deepEqual(ticket.itens.map((i) => i.nome), ['Nhoque ao Sugo']);
});

test('cozinha muda status do ticket', async () => {
  const [ticket] = await (await fetch(`${base}/api/cozinhas/1/tickets`)).json();
  const res = await fetch(`${base}/api/tickets/${ticket.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'pronto' }),
  });
  assert.equal((await res.json()).status, 'pronto');
});

test('pedido inválido retorna 400', async () => {
  const res = await fetch(`${base}/api/pedidos`, { method: 'POST', body: JSON.stringify({ mesa: '', itens: [] }) });
  assert.equal(res.status, 400);
});

test('impressora: teste e comprovante de cancelamento ficam no histórico', async () => {
  const teste = await (await fetch(`${base}/api/impressoras/1/teste`, { method: 'POST' })).json();
  assert.equal(teste.tipo, 'teste');
  assert.equal(teste.modo, 'simulada');

  const pedido = await (await fetch(`${base}/api/pedidos`, {
    method: 'POST',
    body: JSON.stringify({ tipo: 'balcao', mesa: 'Rita', itens: [{ produtoId: 'm5', qtd: 1 }] }),
  })).json();
  await fetch(`${base}/api/pedidos/${pedido.id}/cancelar`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 50));

  const [, cozinha2] = await (await fetch(`${base}/api/impressoras`)).json();
  const tipos = cozinha2.impressoes.filter((j) => j.numeroPedido === pedido.numero).map((j) => j.tipo);
  assert.deepEqual(tipos, ['pedido', 'cancelamento']);
});

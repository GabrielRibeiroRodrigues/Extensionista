const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { imprimir, textoDoTicket } = require('../src/impressora');

const ticket = {
  id: 9,
  numeroPedido: 5,
  cozinhaId: 2,
  cozinhaNome: 'Cozinha 2 - Massas',
  mesa: '7',
  garcom: 'Ana',
  itens: [{ nome: 'Espaguete à Bolonhesa', qtd: 2, obs: 'sem queijo ralado' }],
  criadoEm: new Date().toISOString(),
};

test('texto do ticket tem cozinha, pedido, mesa e itens sem acento', () => {
  const texto = textoDoTicket(ticket);
  assert.match(texto, /COZINHA 2 - MASSAS/);
  assert.match(texto, /PEDIDO #5/);
  assert.match(texto, /MESA: 7/);
  assert.match(texto, /2x Espaguete a Bolonhesa/);
  assert.match(texto, /OBS: sem queijo ralado/);
});

test('envia ESC/POS para a impressora de rede configurada', async () => {
  const recebido = [];
  const impressoraFake = net.createServer((sock) => sock.on('data', (d) => recebido.push(d)));
  await new Promise((r) => impressoraFake.listen(0, '127.0.0.1', r));
  process.env.IMPRESSORA_COZINHA_2 = `127.0.0.1:${impressoraFake.address().port}`;
  try {
    const r = await imprimir(ticket);
    assert.equal(r.modo, 'rede');
    await new Promise((r) => setTimeout(r, 50));
    const bytes = Buffer.concat(recebido);
    assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40]); // ESC @ (inicializa)
    assert.ok(bytes.includes(Buffer.from([0x1d, 0x56, 0x42, 0x00]))); // corte do papel
    assert.ok(bytes.toString('latin1').includes('PEDIDO #5'));
  } finally {
    delete process.env.IMPRESSORA_COZINHA_2;
    impressoraFake.close();
  }
});

test('falha quando a impressora de rede não responde', async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const porta = s.address().port;
  await new Promise((r) => s.close(r));
  process.env.IMPRESSORA_COZINHA_2 = `127.0.0.1:${porta}`;
  try {
    await assert.rejects(imprimir(ticket));
  } finally {
    delete process.env.IMPRESSORA_COZINHA_2;
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {
  LARGURA,
  linhasDoTicket,
  linhasDoCancelamento,
  linhasDoTeste,
  paraTexto,
  enviar,
} = require('../src/impressora');

const ticket = {
  id: 9,
  numeroPedido: 5,
  cozinhaId: 2,
  cozinhaNome: 'Cozinha 2 - Massas',
  tipo: 'mesa',
  mesa: '7',
  rotulo: 'Mesa 7',
  garcom: 'Ana',
  itens: [{ nome: 'Espaguete à Bolonhesa', sabores: ['Espaguete à Bolonhesa'], tamanho: null, qtd: 2, obs: 'sem queijo ralado' }],
  criadoEm: new Date().toISOString(),
  atualizadoEm: new Date().toISOString(),
};

test('ticket tem cozinha, pedido, mesa e itens sem acento', () => {
  const texto = paraTexto(linhasDoTicket(ticket));
  assert.match(texto, /C O Z I N H A {3}2/); // linha em fonte grande
  assert.match(texto, /P E D I D O {3}# 5/);
  assert.match(texto, /2x Espaguete a Bolonhesa/);
  assert.match(texto, />> SEM QUEIJO RALADO/);
  for (const linha of texto.split('\n')) assert.ok(linha.length <= LARGURA, `linha longa: ${linha}`);
});

test('pizza meio a meio sai com tamanho e os dois sabores', () => {
  const pizza = {
    ...ticket,
    cozinhaId: 1,
    cozinhaNome: 'Cozinha 1 - Pizzas',
    tipo: 'delivery',
    rotulo: 'Delivery · João',
    itens: [{ nome: '½ Calabresa + ½ Pepperoni', sabores: ['Calabresa', 'Pepperoni'], tamanho: 'Grande', qtd: 1, obs: '' }],
  };
  const linhas = linhasDoTicket(pizza);
  const textos = linhas.map((l) => l.texto);
  assert.ok(textos.includes('1x [GRANDE] MEIO A MEIO'));
  assert.ok(textos.includes('    1/2 Calabresa'));
  assert.ok(textos.includes('    1/2 Pepperoni'));
  assert.ok(linhas.some((l) => l.texto === 'DELIVERY - JOAO' && l.invertido));
  assert.ok(textos.includes('EMBALAR PARA VIAGEM'));
});

test('comprovante de cancelamento e página de teste', () => {
  assert.equal(linhasDoCancelamento(ticket)[0].texto, '*** CANCELADO ***');
  assert.match(paraTexto(linhasDoTeste(1, null)), /Modo simulado/);
});

test('envia ESC/POS para a impressora de rede configurada', async () => {
  const recebido = [];
  const impressoraFake = net.createServer((sock) => sock.on('data', (d) => recebido.push(d)));
  await new Promise((r) => impressoraFake.listen(0, '127.0.0.1', r));
  process.env.IMPRESSORA_COZINHA_2 = `127.0.0.1:${impressoraFake.address().port}`;
  try {
    const r = await enviar(2, linhasDoTicket(ticket));
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
    await assert.rejects(enviar(2, linhasDoTicket(ticket)));
  } finally {
    delete process.env.IMPRESSORA_COZINHA_2;
  }
});

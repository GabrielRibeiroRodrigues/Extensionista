const test = require('node:test');
const assert = require('node:assert/strict');
const { criarStore, ErroValidacao } = require('../src/store');
const { precoNoTamanho, produtos } = require('../src/menu');

test('divide o pedido em um ticket por cozinha', () => {
  const store = criarStore();
  const pedido = store.criarPedido({
    mesa: '7',
    itens: [
      { produtoId: 'p1', qtd: 2 },
      { produtoId: 'm1', qtd: 1, obs: 'sem queijo' },
      { produtoId: 'd1', qtd: 1 },
      { produtoId: 'b1', qtd: 3 },
    ],
  });

  assert.equal(pedido.ticketIds.length, 2);
  const [pizzas] = store.ticketsDaCozinha(1);
  const [massas] = store.ticketsDaCozinha(2);
  assert.deepEqual(pizzas.itens.map((i) => i.nome), ['Margherita', 'Chocolate com Morango']);
  assert.equal(massas.itens.length, 1);
  assert.equal(massas.itens[0].nome, 'Espaguete à Bolonhesa');
  assert.equal(massas.itens[0].obs, 'sem queijo');
  assert.equal(massas.itens[0].tamanho, null);
  assert.equal(pedido.total, 206.1);
});

test('pedido só de bebidas não gera ticket de cozinha', () => {
  const store = criarStore();
  const pedido = store.criarPedido({ mesa: '1', itens: [{ produtoId: 'b2', qtd: 1 }] });
  assert.equal(pedido.ticketIds.length, 0);
});

test('emite evento de ticket novo para cada cozinha', () => {
  const store = criarStore();
  const recebidos = [];
  store.eventos.on('ticket:novo', (t) => recebidos.push(t.cozinhaId));
  store.criarPedido({ mesa: '3', itens: [{ produtoId: 'p2', qtd: 1 }, { produtoId: 'm3', qtd: 1 }] });
  assert.deepEqual(recebidos.sort(), [1, 2]);
});

test('valida identificação, produto e quantidade', () => {
  const store = criarStore();
  const pizza = [{ produtoId: 'p1', qtd: 1 }];
  assert.throws(() => store.criarPedido({ mesa: '', itens: pizza }), ErroValidacao);
  assert.throws(() => store.criarPedido({ mesa: 'abc', itens: pizza }), /número da mesa/);
  assert.throws(() => store.criarPedido({ tipo: 'delivery', mesa: ' ', itens: pizza }), /nome do cliente/);
  assert.throws(() => store.criarPedido({ tipo: 'xpto', mesa: '1', itens: pizza }), ErroValidacao);
  assert.throws(() => store.criarPedido({ mesa: '1', itens: [] }), ErroValidacao);
  assert.throws(() => store.criarPedido({ mesa: '1', itens: [{ produtoId: 'x', qtd: 1 }] }), ErroValidacao);
  assert.throws(() => store.criarPedido({ mesa: '1', itens: [{ produtoId: 'p1', qtd: 0 }] }), ErroValidacao);
});

test('rótulo do pedido conforme o tipo', () => {
  const store = criarStore();
  const pizza = [{ produtoId: 'p1', qtd: 1 }];
  assert.equal(store.criarPedido({ mesa: '12', itens: pizza }).rotulo, 'Mesa 12');
  assert.equal(store.criarPedido({ tipo: 'balcao', mesa: 'Ana', itens: pizza }).rotulo, 'Balcão · Ana');
  const delivery = store.criarPedido({ tipo: 'delivery', mesa: 'João', itens: pizza });
  assert.equal(delivery.rotulo, 'Delivery · João');
  assert.equal(delivery.tickets[0].rotulo, 'Delivery · João');
});

test('pizza por tamanho com preço proporcional', () => {
  const store = criarStore();
  const margherita = produtos.find((p) => p.id === 'p1');
  assert.equal(precoNoTamanho(margherita, 'G'), 49.9);
  assert.equal(precoNoTamanho(margherita, 'M'), 42.9);
  assert.equal(precoNoTamanho(margherita, 'B'), 29.9);

  const pedido = store.criarPedido({ mesa: '5', itens: [{ produtoId: 'p1', tamanho: 'B', qtd: 2 }] });
  assert.equal(pedido.total, 59.8);
  assert.equal(pedido.tickets[0].itens[0].tamanho, 'Broto');
  assert.throws(() => store.criarPedido({ mesa: '5', itens: [{ produtoId: 'p1', tamanho: 'XG', qtd: 1 }] }), ErroValidacao);
});

test('meio a meio cobra o sabor mais caro e só combina a mesma categoria', () => {
  const store = criarStore();
  const pedido = store.criarPedido({
    mesa: '8',
    itens: [{ produtoId: 'p2', metadeId: 'p6', tamanho: 'G', qtd: 1 }],
  });
  const [item] = pedido.tickets[0].itens;
  assert.equal(item.nome, '½ Calabresa + ½ Pepperoni');
  assert.deepEqual(item.sabores, ['Calabresa', 'Pepperoni']);
  assert.equal(pedido.total, 58.9);

  assert.throws(() => store.criarPedido({ mesa: '8', itens: [{ produtoId: 'p2', metadeId: 'd1', qtd: 1 }] }), ErroValidacao);
  assert.throws(() => store.criarPedido({ mesa: '8', itens: [{ produtoId: 'p2', metadeId: 'p2', qtd: 1 }] }), ErroValidacao);
  assert.throws(() => store.criarPedido({ mesa: '8', itens: [{ produtoId: 'm1', metadeId: 'm2', qtd: 1 }] }), ErroValidacao);
});

test('atualiza status do ticket', () => {
  const store = criarStore();
  const pedido = store.criarPedido({ mesa: '2', itens: [{ produtoId: 'p1', qtd: 1 }] });
  const ticket = store.atualizarTicket(pedido.ticketIds[0], { status: 'preparo' });
  assert.equal(ticket.status, 'preparo');
  assert.throws(() => store.atualizarTicket(ticket.id, { status: 'xyz' }), ErroValidacao);
});

test('cancelar pedido cancela os tickets de todas as cozinhas', () => {
  const store = criarStore();
  const cancelados = [];
  store.eventos.on('ticket:cancelado', (t) => cancelados.push(t.cozinhaId));
  const pedido = store.criarPedido({ mesa: '9', itens: [{ produtoId: 'p1', qtd: 1 }, { produtoId: 'm1', qtd: 1 }] });

  const resultado = store.cancelarPedido(pedido.id);
  assert.equal(resultado.cancelado, true);
  assert.deepEqual(resultado.tickets.map((t) => t.status), ['cancelado', 'cancelado']);
  assert.deepEqual(cancelados.sort(), [1, 2]);
  assert.throws(() => store.cancelarPedido(pedido.id), /já está cancelado/);
  assert.throws(() => store.atualizarTicket(pedido.ticketIds[0], { status: 'pronto' }), /cancelado/);
});

test('exporta e importa o estado mantendo a numeração', () => {
  const origem = criarStore();
  origem.criarPedido({ mesa: '1', itens: [{ produtoId: 'p1', qtd: 1 }] });
  const copia = criarStore();
  copia.importar(JSON.parse(JSON.stringify(origem.exportar())));
  assert.equal(copia.ticketsDaCozinha(1).length, 1);
  assert.equal(copia.criarPedido({ mesa: '2', itens: [{ produtoId: 'p1', qtd: 1 }] }).numero, 2);
});

test('resumo soma faturamento sem os cancelados e conta tickets por cozinha', () => {
  const store = criarStore();
  store.criarPedido({ mesa: '1', itens: [{ produtoId: 'p1', qtd: 1 }, { produtoId: 'm1', qtd: 1 }] });
  const cancelado = store.criarPedido({ mesa: '2', itens: [{ produtoId: 'p2', qtd: 1 }] });
  store.cancelarPedido(cancelado.id);

  const r = store.resumo();
  assert.equal(r.pedidos, 1);
  assert.equal(r.cancelados, 1);
  assert.equal(r.faturamento, 89.8);
  assert.deepEqual(r.porCozinha['1'], { novo: 1, preparo: 0, pronto: 0, cancelado: 1 });
  assert.deepEqual(r.porCozinha['2'], { novo: 1, preparo: 0, pronto: 0, cancelado: 0 });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarStore, ErroValidacao } = require('../src/store');

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
  assert.deepEqual(massas.itens, [{ nome: 'Espaguete à Bolonhesa', qtd: 1, obs: 'sem queijo' }]);
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

test('valida mesa, produto e quantidade', () => {
  const store = criarStore();
  assert.throws(() => store.criarPedido({ mesa: '', itens: [{ produtoId: 'p1', qtd: 1 }] }), ErroValidacao);
  assert.throws(() => store.criarPedido({ mesa: '1', itens: [] }), ErroValidacao);
  assert.throws(() => store.criarPedido({ mesa: '1', itens: [{ produtoId: 'x', qtd: 1 }] }), ErroValidacao);
  assert.throws(() => store.criarPedido({ mesa: '1', itens: [{ produtoId: 'p1', qtd: 0 }] }), ErroValidacao);
});

test('atualiza status do ticket', () => {
  const store = criarStore();
  const pedido = store.criarPedido({ mesa: '2', itens: [{ produtoId: 'p1', qtd: 1 }] });
  const ticket = store.atualizarTicket(pedido.ticketIds[0], { status: 'preparo' });
  assert.equal(ticket.status, 'preparo');
  assert.throws(() => store.atualizarTicket(ticket.id, { status: 'xyz' }), ErroValidacao);
});

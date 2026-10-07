// Pedidos de exemplo para as telas das cozinhas não começarem vazias.

const exemplos = [
  { mesa: '4', garcom: 'Ana', itens: [{ produtoId: 'p1', qtd: 1 }, { produtoId: 'm2', qtd: 2, obs: 'Um sem bacon' }, { produtoId: 'b1', qtd: 2 }] },
  { mesa: '12', garcom: 'Carlos', itens: [{ produtoId: 'p4', qtd: 1, obs: 'Borda recheada' }, { produtoId: 'p6', qtd: 1 }] },
  { mesa: 'Delivery - João', garcom: 'Balcão', itens: [{ produtoId: 'm3', qtd: 1 }, { produtoId: 'd1', qtd: 1 }] },
];

function popularExemplos(store) {
  for (const pedido of exemplos) store.criarPedido(pedido);
}

module.exports = { popularExemplos };

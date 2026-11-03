// Pedidos e perfis de exemplo (dados mockados para demonstração).

// Perfis do modo demonstração (DEMO=1). Segredos simples de propósito: é só para apresentar.
const PERFIS_DEMO = [
  { usuario: 'dono', nome: 'Rosângela Prado', cargo: 'dono', segredo: 'frangonete' },
  { usuario: 'carla', nome: 'Carla Mendes', cargo: 'gerente', segredo: 'gerente123' },
  { usuario: 'ana', nome: 'Ana Souza', cargo: 'garcom', segredo: '1111' },
  { usuario: 'bruno', nome: 'Bruno Lima', cargo: 'garcom', segredo: '2222' },
  { usuario: 'ze', nome: 'Zé do Forno', cargo: 'cozinha1', segredo: '3333' },
  { usuario: 'lu', nome: 'Lu das Massas', cargo: 'cozinha2', segredo: '4444' },
];

// minutos: há quanto tempo o pedido entrou; status: como está em cada cozinha.
const EXEMPLOS = [
  {
    minutos: 38, garcom: 'bruno', status: { 1: 'pronto' },
    pedido: { mesa: '2', itens: [{ produtoId: 'p1', tamanho: 'G', qtd: 1 }, { produtoId: 'b1', qtd: 2 }] },
  },
  {
    minutos: 24, garcom: 'ana', status: { 1: 'preparo', 2: 'pronto' },
    pedido: { mesa: '4', itens: [{ produtoId: 'p7', tamanho: 'G', qtd: 1 }, { produtoId: 'm2', qtd: 2, obs: 'Um sem bacon' }, { produtoId: 'b2', qtd: 2 }] },
  },
  {
    minutos: 15, garcom: 'bruno', status: { 1: 'preparo' },
    pedido: { mesa: '12', itens: [{ produtoId: 'p4', tamanho: 'G', qtd: 1, obs: 'Borda recheada' }, { produtoId: 'p2', metadeId: 'p6', tamanho: 'M', qtd: 1 }] },
  },
  {
    minutos: 11, garcom: 'carla', status: { 1: 'preparo', 2: 'preparo' },
    pedido: { tipo: 'delivery', mesa: 'Marcos', itens: [{ produtoId: 'm3', qtd: 1 }, { produtoId: 'd1', tamanho: 'B', qtd: 1 }, { produtoId: 'b3', qtd: 2 }] },
  },
  {
    minutos: 7, garcom: 'ana', status: {},
    pedido: { mesa: '7', itens: [{ produtoId: 'p8', tamanho: 'M', qtd: 2 }, { produtoId: 'm6', qtd: 1, obs: 'Pouco sal' }] },
  },
  {
    minutos: 4, garcom: 'ana', status: {},
    pedido: { tipo: 'balcao', mesa: 'Júlia', itens: [{ produtoId: 'm5', qtd: 1 }, { produtoId: 'b1', qtd: 1 }] },
  },
  {
    minutos: 1, garcom: 'bruno', status: {},
    pedido: { mesa: '9', itens: [{ produtoId: 'p3', tamanho: 'G', qtd: 1, obs: 'Sem ervilha' }, { produtoId: 'p5', metadeId: 'p7', tamanho: 'G', qtd: 1 }] },
  },
];

// `usuarios` mapeia login -> { id, nome } (perfis de demonstração). Sem ele,
// os pedidos ficam só com o primeiro nome, sem vínculo com um usuário.
function popularExemplos(store, usuarios = {}) {
  const agora = Date.now();
  for (const ex of EXEMPLOS) {
    const quem = usuarios[ex.garcom];
    const nomePadrao = PERFIS_DEMO.find((p) => p.usuario === ex.garcom).nome.split(' ')[0];
    const pedido = store.criarPedido(
      { ...ex.pedido, garcom: quem ? quem.nome : nomePadrao, garcomId: quem ? quem.id : null },
      { criadoEm: new Date(agora - ex.minutos * 60000).toISOString() }
    );
    for (const ticket of pedido.tickets) {
      const status = ex.status[ticket.cozinhaId];
      if (status) store.atualizarTicket(ticket.id, { status });
    }
  }
}

module.exports = { popularExemplos, PERFIS_DEMO };

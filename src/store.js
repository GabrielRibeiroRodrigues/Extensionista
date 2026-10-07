// Armazenamento em memória dos pedidos e tickets de cozinha.
// Um pedido do garçom é dividido em um ticket por cozinha.

const { EventEmitter } = require('node:events');
const { produtos, cozinhas, cozinhaDoProduto } = require('./menu');

const STATUS = ['novo', 'preparo', 'pronto'];

class ErroValidacao extends Error {}

function dividirPorCozinha(itens) {
  const grupos = new Map();
  for (const item of itens) {
    if (item.cozinhaId == null) continue;
    if (!grupos.has(item.cozinhaId)) grupos.set(item.cozinhaId, []);
    grupos.get(item.cozinhaId).push(item);
  }
  return grupos;
}

function criarStore() {
  const eventos = new EventEmitter();
  const pedidos = [];
  const tickets = [];
  let proximoNumero = 1;
  let proximoTicket = 1;

  function validarItens(itens) {
    if (!Array.isArray(itens) || itens.length === 0) {
      throw new ErroValidacao('O pedido precisa ter pelo menos um item.');
    }
    return itens.map((item) => {
      const produto = produtos.find((p) => p.id === item.produtoId);
      if (!produto) throw new ErroValidacao(`Produto inválido: ${item.produtoId}`);
      const qtd = Number(item.qtd);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 50) {
        throw new ErroValidacao(`Quantidade inválida para ${produto.nome}.`);
      }
      const obs = typeof item.obs === 'string' ? item.obs.trim().slice(0, 140) : '';
      return {
        produtoId: produto.id,
        nome: produto.nome,
        preco: produto.preco,
        qtd,
        obs,
        cozinhaId: cozinhaDoProduto(produto),
      };
    });
  }

  function buscarTicket(id) {
    return tickets.find((t) => t.id === Number(id)) || null;
  }

  function criarPedido({ mesa, garcom, itens }) {
    const mesaTxt = String(mesa ?? '').trim().slice(0, 20);
    if (!mesaTxt) throw new ErroValidacao('Informe a mesa ou o nome do cliente.');
    const itensValidos = validarItens(itens);

    const numero = proximoNumero++;
    const pedido = {
      id: numero,
      numero,
      mesa: mesaTxt,
      garcom: String(garcom ?? '').trim().slice(0, 40),
      itens: itensValidos,
      total: Math.round(itensValidos.reduce((s, i) => s + i.preco * i.qtd, 0) * 100) / 100,
      criadoEm: new Date().toISOString(),
      ticketIds: [],
    };

    const novos = [];
    for (const [cozinhaId, itensCozinha] of dividirPorCozinha(itensValidos)) {
      const ticket = {
        id: proximoTicket++,
        pedidoId: pedido.id,
        numeroPedido: pedido.numero,
        cozinhaId,
        cozinhaNome: `${cozinhas[cozinhaId].nome} - ${cozinhas[cozinhaId].setor}`,
        mesa: pedido.mesa,
        garcom: pedido.garcom,
        itens: itensCozinha.map(({ nome, qtd, obs }) => ({ nome, qtd, obs })),
        status: 'novo',
        impressao: 'pendente',
        criadoEm: pedido.criadoEm,
        atualizadoEm: pedido.criadoEm,
      };
      tickets.push(ticket);
      pedido.ticketIds.push(ticket.id);
      novos.push(ticket);
    }

    pedidos.push(pedido);
    eventos.emit('pedido', pedido);
    for (const ticket of novos) eventos.emit('ticket:novo', ticket);
    return pedido;
  }

  function atualizarTicket(id, campos) {
    const ticket = buscarTicket(id);
    if (!ticket) return null;
    if (campos.status !== undefined) {
      if (!STATUS.includes(campos.status)) throw new ErroValidacao('Status inválido.');
      ticket.status = campos.status;
    }
    if (campos.impressao !== undefined) ticket.impressao = campos.impressao;
    ticket.atualizadoEm = new Date().toISOString();
    eventos.emit('ticket:atualizado', ticket);
    return ticket;
  }

  function ticketsDaCozinha(cozinhaId) {
    return tickets.filter((t) => t.cozinhaId === Number(cozinhaId));
  }

  function pedidosRecentes(limite = 30) {
    return pedidos
      .slice(-limite)
      .reverse()
      .map((p) => ({ ...p, tickets: p.ticketIds.map(buscarTicket) }));
  }

  return { eventos, criarPedido, buscarTicket, atualizarTicket, ticketsDaCozinha, pedidosRecentes };
}

module.exports = { criarStore, dividirPorCozinha, ErroValidacao, STATUS };

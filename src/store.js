// Armazenamento em memória dos pedidos e tickets de cozinha.
// Um pedido do garçom é dividido em um ticket por cozinha.

const { EventEmitter } = require('node:events');
const { produtos, cozinhas, tamanhos, categoriaDoProduto, precoNoTamanho } = require('./menu');

const STATUS = ['novo', 'preparo', 'pronto'];
const TIPOS = {
  mesa: 'Mesa',
  balcao: 'Balcão',
  delivery: 'Delivery',
};

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

function rotuloDoPedido(tipo, identificador) {
  return tipo === 'mesa' ? `Mesa ${identificador}` : `${TIPOS[tipo]} · ${identificador}`;
}

function validarIdentificacao({ tipo = 'mesa', mesa }) {
  if (!TIPOS[tipo]) throw new ErroValidacao('Tipo de pedido inválido.');
  const identificador = String(mesa ?? '').trim().slice(0, 30);
  if (tipo === 'mesa' && !/^\d{1,3}$/.test(identificador)) {
    throw new ErroValidacao('Informe o número da mesa.');
  }
  if (!identificador) throw new ErroValidacao('Informe o nome do cliente.');
  return { tipo, identificador };
}

function validarItem(item) {
  const produto = produtos.find((p) => p.id === item.produtoId);
  if (!produto) throw new ErroValidacao(`Produto inválido: ${item.produtoId}`);
  const categoria = categoriaDoProduto(produto);

  const qtd = Number(item.qtd);
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > 50) {
    throw new ErroValidacao(`Quantidade inválida para ${produto.nome}.`);
  }

  let tamanho = null;
  if (categoria.temTamanho) {
    tamanho = tamanhos.find((t) => t.id === (item.tamanho || 'G'));
    if (!tamanho) throw new ErroValidacao(`Tamanho inválido para ${produto.nome}.`);
  }

  const sabores = [produto];
  if (item.metadeId) {
    const metade = produtos.find((p) => p.id === item.metadeId);
    if (!categoria.meioAMeio || !metade || metade.categoria !== produto.categoria || metade.id === produto.id) {
      throw new ErroValidacao(`Meio a meio inválido para ${produto.nome}.`);
    }
    sabores.push(metade);
  }

  // Meio a meio cobra pelo sabor mais caro, como é praxe em pizzaria.
  const preco = Math.max(...sabores.map((s) => precoNoTamanho(s, tamanho && tamanho.id)));
  const nome = sabores.length === 2 ? `½ ${sabores[0].nome} + ½ ${sabores[1].nome}` : produto.nome;

  return {
    produtoId: produto.id,
    metadeId: sabores[1] ? sabores[1].id : null,
    nome,
    sabores: sabores.map((s) => s.nome),
    tamanho: tamanho ? tamanho.nome : null,
    preco,
    qtd,
    obs: typeof item.obs === 'string' ? item.obs.trim().slice(0, 140) : '',
    cozinhaId: categoria.cozinha,
  };
}

function criarStore() {
  const eventos = new EventEmitter();
  let pedidos = [];
  let tickets = [];
  let proximoNumero = 1;
  let proximoTicket = 1;

  function buscarTicket(id) {
    return tickets.find((t) => t.id === Number(id)) || null;
  }

  function buscarPedido(id) {
    return pedidos.find((p) => p.id === Number(id)) || null;
  }

  function comTickets(pedido) {
    return { ...pedido, tickets: pedido.ticketIds.map(buscarTicket) };
  }

  function criarPedido({ tipo, mesa, garcom, itens }) {
    const { tipo: tipoOk, identificador } = validarIdentificacao({ tipo, mesa });
    if (!Array.isArray(itens) || itens.length === 0) {
      throw new ErroValidacao('O pedido precisa ter pelo menos um item.');
    }
    const itensValidos = itens.map(validarItem);

    const numero = proximoNumero++;
    const agora = new Date().toISOString();
    const pedido = {
      id: numero,
      numero,
      tipo: tipoOk,
      mesa: identificador,
      rotulo: rotuloDoPedido(tipoOk, identificador),
      garcom: String(garcom ?? '').trim().slice(0, 40),
      itens: itensValidos,
      total: Math.round(itensValidos.reduce((s, i) => s + i.preco * i.qtd, 0) * 100) / 100,
      cancelado: false,
      criadoEm: agora,
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
        tipo: pedido.tipo,
        mesa: pedido.mesa,
        rotulo: pedido.rotulo,
        garcom: pedido.garcom,
        itens: itensCozinha.map(({ nome, sabores, tamanho, qtd, obs }) => ({ nome, sabores, tamanho, qtd, obs })),
        status: 'novo',
        impressao: 'pendente',
        criadoEm: agora,
        atualizadoEm: agora,
      };
      tickets.push(ticket);
      pedido.ticketIds.push(ticket.id);
      novos.push(ticket);
    }

    pedidos.push(pedido);
    eventos.emit('pedido', comTickets(pedido));
    for (const ticket of novos) eventos.emit('ticket:novo', ticket);
    return comTickets(pedido);
  }

  function atualizarTicket(id, campos) {
    const ticket = buscarTicket(id);
    if (!ticket) return null;
    if (campos.status !== undefined) {
      if (!STATUS.includes(campos.status)) throw new ErroValidacao('Status inválido.');
      if (ticket.status === 'cancelado') throw new ErroValidacao('Este pedido foi cancelado.');
      ticket.status = campos.status;
    }
    if (campos.impressao !== undefined) ticket.impressao = campos.impressao;
    ticket.atualizadoEm = new Date().toISOString();
    eventos.emit('ticket:atualizado', ticket);
    return ticket;
  }

  function cancelarPedido(id) {
    const pedido = buscarPedido(id);
    if (!pedido) return null;
    if (pedido.cancelado) throw new ErroValidacao('O pedido já está cancelado.');
    pedido.cancelado = true;
    const agora = new Date().toISOString();
    for (const ticket of pedido.ticketIds.map(buscarTicket)) {
      ticket.status = 'cancelado';
      ticket.atualizadoEm = agora;
      eventos.emit('ticket:cancelado', ticket);
    }
    eventos.emit('pedido:atualizado', comTickets(pedido));
    return comTickets(pedido);
  }

  function ticketsDaCozinha(cozinhaId) {
    return tickets.filter((t) => t.cozinhaId === Number(cozinhaId));
  }

  function pedidosRecentes(limite = 30) {
    return pedidos.slice(-limite).reverse().map(comTickets);
  }

  function resumo() {
    const validos = pedidos.filter((p) => !p.cancelado);
    const porCozinha = {};
    for (const id of Object.keys(cozinhas)) {
      const daCozinha = tickets.filter((t) => t.cozinhaId === Number(id));
      porCozinha[id] = Object.fromEntries(
        [...STATUS, 'cancelado'].map((s) => [s, daCozinha.filter((t) => t.status === s).length])
      );
    }
    return {
      pedidos: validos.length,
      cancelados: pedidos.length - validos.length,
      faturamento: Math.round(validos.reduce((s, p) => s + p.total, 0) * 100) / 100,
      ticketMedio: validos.length ? Math.round((validos.reduce((s, p) => s + p.total, 0) / validos.length) * 100) / 100 : 0,
      porCozinha,
    };
  }

  // Persistência: o servidor salva/carrega este retrato em disco.
  function exportar() {
    return { proximoNumero, proximoTicket, pedidos, tickets };
  }

  function importar(dados) {
    pedidos = dados.pedidos || [];
    tickets = dados.tickets || [];
    proximoNumero = dados.proximoNumero || pedidos.length + 1;
    proximoTicket = dados.proximoTicket || tickets.length + 1;
  }

  return {
    eventos,
    criarPedido,
    buscarPedido,
    buscarTicket,
    atualizarTicket,
    cancelarPedido,
    ticketsDaCozinha,
    pedidosRecentes,
    resumo,
    exportar,
    importar,
  };
}

module.exports = { criarStore, dividirPorCozinha, ErroValidacao, STATUS, TIPOS };

// App do garçom: monta o pedido no celular e envia para o servidor,
// que divide entre as cozinhas.

const $ = (sel) => document.querySelector(sel);
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
// "12" vira "Mesa 12"; textos livres (ex.: "Delivery - João") aparecem como estão.
const rotuloMesa = (m) => (/^\d+$/.test(m) ? `Mesa ${m}` : m);
const ROTULO_STATUS = { novo: 'Na fila', preparo: 'Preparando', pronto: 'Pronto' };

const estado = {
  menu: null,
  carrinho: new Map(), // produtoId -> { qtd, obs }
  pedidos: [],
};

function guardar(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch {}
}
function lerGuardado(chave) {
  try { return localStorage.getItem(chave) || ''; } catch { return ''; }
}

// ---------- Cardápio ----------
function cozinhaDaCategoria(catId) {
  return estado.menu.categorias.find((c) => c.id === catId).cozinha;
}

function rotuloCozinha(cozinhaId) {
  if (!cozinhaId) return '<span class="tag-cozinha c0">Balcão</span>';
  const c = estado.menu.cozinhas[cozinhaId];
  return `<span class="tag-cozinha c${c.id}">${esc(c.nome)}</span>`;
}

function renderCardapio() {
  const { categorias, produtos } = estado.menu;
  $('#categorias').innerHTML = categorias
    .map((c, i) => `<button class="chip${i === 0 ? ' ativa' : ''}" data-cat="${c.id}">${esc(c.nome)}</button>`)
    .join('');

  $('#produtos').innerHTML = categorias.map((c) => `
    <section class="grupo" id="cat-${c.id}">
      <h3>${esc(c.nome)} ${rotuloCozinha(c.cozinha)}</h3>
      ${produtos.filter((p) => p.categoria === c.id).map(htmlProduto).join('')}
    </section>`).join('');
}

function htmlProduto(p) {
  const item = estado.carrinho.get(p.id);
  const qtd = item ? item.qtd : 0;
  return `
    <article class="produto${qtd ? ' no-carrinho' : ''}" data-produto="${p.id}">
      <div class="info">
        <div class="nome">${esc(p.nome)}</div>
        <div class="desc">${esc(p.descricao)}</div>
        <div class="preco">${brl(p.preco)}</div>
      </div>
      <div class="passo">
        ${qtd ? `<button class="menos" data-acao="menos" aria-label="Remover">−</button><b>${qtd}</b>` : ''}
        <button class="mais" data-acao="mais" aria-label="Adicionar">+</button>
      </div>
    </article>`;
}

function alterarQtd(produtoId, delta) {
  const item = estado.carrinho.get(produtoId) || { qtd: 0, obs: '' };
  item.qtd += delta;
  if (item.qtd <= 0) estado.carrinho.delete(produtoId);
  else estado.carrinho.set(produtoId, item);

  const card = document.querySelector(`[data-produto="${produtoId}"]`);
  if (card) card.outerHTML = htmlProduto(estado.menu.produtos.find((p) => p.id === produtoId));
  renderBarra();
  if (!$('#carrinho').hidden) renderCarrinho();
}

function totalCarrinho() {
  let qtd = 0, total = 0;
  for (const [id, item] of estado.carrinho) {
    const p = estado.menu.produtos.find((x) => x.id === id);
    qtd += item.qtd;
    total += p.preco * item.qtd;
  }
  return { qtd, total };
}

function renderBarra() {
  const { qtd, total } = totalCarrinho();
  $('#barra-carrinho').hidden = qtd === 0;
  $('#qtd-carrinho').textContent = qtd;
  $('#total-carrinho').textContent = brl(total);
}

// ---------- Carrinho ----------
function renderCarrinho() {
  if (estado.carrinho.size === 0) return fecharCarrinho();
  $('#mesa-resumo').textContent = $('#mesa').value.trim() || '?';

  // Agrupa visualmente por destino, igual ao que a cozinha vai receber.
  const grupos = new Map();
  for (const [id, item] of estado.carrinho) {
    const p = estado.menu.produtos.find((x) => x.id === id);
    const cozinha = cozinhaDaCategoria(p.categoria) || 0;
    if (!grupos.has(cozinha)) grupos.set(cozinha, []);
    grupos.get(cozinha).push({ p, item });
  }

  const ordem = [...grupos.keys()].sort((a, b) => (a || 99) - (b || 99));
  $('#itens-carrinho').innerHTML = ordem.map((cozinha) => {
    const titulo = cozinha
      ? `${estado.menu.cozinhas[cozinha].nome} – ${estado.menu.cozinhas[cozinha].setor}`
      : 'Balcão (não vai para a cozinha)';
    return `<p class="destino-cozinha">→ ${esc(titulo)}</p>` + grupos.get(cozinha).map(({ p, item }) => `
      <div class="item-carrinho" data-produto="${p.id}">
        <div class="linha">
          <span class="nome">${esc(p.nome)}</span>
          <div class="passo">
            <button data-acao="menos" aria-label="Remover">−</button><b>${item.qtd}</b>
            <button class="mais" data-acao="mais" aria-label="Adicionar">+</button>
          </div>
        </div>
        ${cozinha ? `<input data-obs placeholder="Observação (ex.: sem cebola)" maxlength="140" value="${esc(item.obs)}">` : ''}
      </div>`).join('');
  }).join('');

  $('#total-folha').textContent = brl(totalCarrinho().total);
}

function abrirCarrinho() {
  $('#carrinho').hidden = false;
  $('#fundo').hidden = false;
  renderCarrinho();
}
function fecharCarrinho() {
  $('#carrinho').hidden = true;
  $('#fundo').hidden = true;
}

async function enviarPedido() {
  const mesaInput = $('#mesa');
  const mesa = mesaInput.value.trim();
  if (!mesa) {
    fecharCarrinho();
    mesaInput.classList.add('erro');
    mesaInput.focus();
    return avisar('Informe a mesa ou o nome do cliente.', 'erro');
  }

  const botao = $('#enviar');
  botao.disabled = true;
  botao.textContent = 'Enviando…';
  try {
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mesa,
        garcom: $('#garcom').value.trim(),
        itens: [...estado.carrinho].map(([produtoId, i]) => ({ produtoId, qtd: i.qtd, obs: i.obs })),
      }),
    });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || 'Falha ao enviar.');

    const destinos = dados.tickets.map((t) => t.cozinhaNome.split(' - ')[0]).join(' e ');
    avisar(`Pedido #${dados.numero} enviado${destinos ? ` para ${destinos}` : ''}!`, 'ok');
    estado.carrinho.clear();
    mesaInput.value = '';
    fecharCarrinho();
    renderCardapio();
    renderBarra();
  } catch (err) {
    avisar(err.message === 'Failed to fetch' ? 'Sem conexão com o servidor.' : err.message, 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Enviar para as cozinhas';
  }
}

// ---------- Acompanhamento ----------
function renderPedidos() {
  const meu = $('#garcom').value.trim().toLowerCase();
  const lista = estado.pedidos.filter((p) => p.tickets.length && (!meu || !p.garcom || p.garcom.toLowerCase() === meu));
  const prontos = lista.filter((p) => p.tickets.every((t) => t.status === 'pronto')).length;
  $('#badge-prontos').hidden = prontos === 0;
  $('#badge-prontos').textContent = prontos;

  $('#lista-pedidos').innerHTML = lista.length
    ? lista.map((p) => `
      <article class="pedido-card">
        <header><h4>#${p.numero} · ${esc(rotuloMesa(p.mesa))}</h4><time>${hora(p.criadoEm)}</time></header>
        ${p.tickets.map((t) => `
          <div class="status-linha">
            <span>${esc(t.cozinhaNome)} · ${t.itens.reduce((s, i) => s + i.qtd, 0)} itens</span>
            <span class="status ${t.status}">${ROTULO_STATUS[t.status]}</span>
          </div>`).join('')}
      </article>`).join('')
    : '<p class="vazio">Nenhum pedido enviado para as cozinhas ainda.</p>';
}

function conectarTempoReal() {
  const fonte = new EventSource('/api/garcom/stream');
  fonte.addEventListener('pedido', (e) => {
    const pedido = JSON.parse(e.data);
    estado.pedidos = [pedido, ...estado.pedidos.filter((p) => p.id !== pedido.id)];
    renderPedidos();
  });
  fonte.addEventListener('ticket', (e) => {
    const ticket = JSON.parse(e.data);
    const pedido = estado.pedidos.find((p) => p.id === ticket.pedidoId);
    if (!pedido) return;
    const anterior = pedido.tickets.find((t) => t.id === ticket.id);
    pedido.tickets = pedido.tickets.map((t) => (t.id === ticket.id ? ticket : t));
    if (anterior && anterior.status !== 'pronto' && ticket.status === 'pronto') {
      avisar(`${rotuloMesa(ticket.mesa)}: ${ticket.cozinhaNome.split(' - ')[1]} pronto!`, 'ok');
      if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
    }
    renderPedidos();
  });
  fonte.onopen = async () => {
    estado.pedidos = await (await fetch('/api/pedidos')).json();
    renderPedidos();
  };
}

// ---------- Geral ----------
let timerAviso;
function avisar(texto, tipo = '') {
  const el = $('#aviso');
  el.textContent = texto;
  el.className = `aviso ${tipo}`;
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (el.hidden = true), 3500);
}

function trocarAba(aba) {
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  $('#cardapio').hidden = aba !== 'cardapio';
  $('#pedidos').hidden = aba !== 'pedidos';
  $('#barra-carrinho').hidden = aba !== 'cardapio' || estado.carrinho.size === 0;
  if (aba === 'pedidos') renderPedidos();
}

function ligarEventos() {
  document.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-acao]');
    if (botao) {
      const id = botao.closest('[data-produto]').dataset.produto;
      alterarQtd(id, botao.dataset.acao === 'mais' ? 1 : -1);
      return;
    }
    const chip = e.target.closest('.chip');
    if (chip) {
      document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('ativa', c === chip));
      const alvo = document.getElementById(`cat-${chip.dataset.cat}`);
      window.scrollTo({ top: alvo.offsetTop - 150, behavior: 'smooth' });
      return;
    }
    const aba = e.target.closest('.aba');
    if (aba) trocarAba(aba.dataset.aba);
  });

  document.addEventListener('input', (e) => {
    if (e.target.matches('[data-obs]')) {
      const id = e.target.closest('[data-produto]').dataset.produto;
      estado.carrinho.get(id).obs = e.target.value;
    }
  });

  $('#mesa').addEventListener('input', (e) => e.target.classList.remove('erro'));
  $('#garcom').value = lerGuardado('garcom');
  $('#garcom').addEventListener('change', (e) => {
    guardar('garcom', e.target.value.trim());
    renderPedidos();
  });
  $('#barra-carrinho').addEventListener('click', abrirCarrinho);
  $('#fechar-carrinho').addEventListener('click', fecharCarrinho);
  $('#fundo').addEventListener('click', fecharCarrinho);
  $('#enviar').addEventListener('click', enviarPedido);
}

async function iniciar() {
  ligarEventos();
  try {
    estado.menu = await (await fetch('/api/menu')).json();
  } catch {
    return avisar('Não foi possível carregar o cardápio.', 'erro');
  }
  renderCardapio();
  conectarTempoReal();
}

iniciar();

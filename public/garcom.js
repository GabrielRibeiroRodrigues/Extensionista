// App do garçom: monta o pedido no celular e envia para o servidor,
// que divide entre as cozinhas.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ROTULO_STATUS = { novo: 'Na fila', preparo: 'Preparando', pronto: 'Pronto', cancelado: 'Cancelado' };
const TIPOS = {
  mesa: { rotulo: 'Nº da mesa', placeholder: 'Ex.: 12', modo: 'numeric', max: 3 },
  balcao: { rotulo: 'Nome do cliente', placeholder: 'Ex.: Ana', modo: 'text', max: 30 },
  delivery: { rotulo: 'Nome do cliente', placeholder: 'Ex.: João', modo: 'text', max: 30 },
};

const estado = {
  menu: null,
  tipo: 'mesa',
  linhas: [], // { id, produtoId, metadeId, tamanho, qtd, obs }
  pizza: null, // pizza sendo personalizada
  pedidos: [],
  filtro: 'meus',
  busca: '',
  prontosNaoVistos: 0,
};
let proximaLinha = 1;

function guardar(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch {}
}
function lerGuardado(chave) {
  try { return localStorage.getItem(chave) || ''; } catch { return ''; }
}

// ---------- Cardápio: consultas ----------
const produto = (id) => estado.menu.produtos.find((p) => p.id === id);
const categoria = (id) => estado.menu.categorias.find((c) => c.id === id);
const tamanho = (id) => estado.menu.tamanhos.find((t) => t.id === id);
const ehPizza = (p) => !!categoria(p.categoria).temTamanho;

function precoLinha(l) {
  const sabores = [produto(l.produtoId), l.metadeId && produto(l.metadeId)].filter(Boolean);
  return Math.max(...sabores.map((p) => (p.precos ? p.precos[l.tamanho] : p.preco)));
}

function nomeLinha(l) {
  const p = produto(l.produtoId);
  return l.metadeId ? `½ ${p.nome} + ½ ${produto(l.metadeId).nome}` : p.nome;
}

function cozinhaDaLinha(l) {
  return categoria(produto(l.produtoId).categoria).cozinha || 0;
}

function totais() {
  return estado.linhas.reduce(
    (acc, l) => ({ qtd: acc.qtd + l.qtd, total: acc.total + precoLinha(l) * l.qtd }),
    { qtd: 0, total: 0 }
  );
}

// ---------- Carrinho: alterações ----------
function adicionarLinha(nova) {
  const igual = estado.linhas.find((l) =>
    l.produtoId === nova.produtoId && l.metadeId === nova.metadeId && l.tamanho === nova.tamanho && l.obs === nova.obs);
  if (igual) igual.qtd += nova.qtd;
  else estado.linhas.push({ id: proximaLinha++, ...nova });
  atualizarTudo();
}

function alterarLinha(id, delta) {
  const linha = estado.linhas.find((l) => l.id === id);
  if (!linha) return;
  linha.qtd += delta;
  if (linha.qtd <= 0) estado.linhas = estado.linhas.filter((l) => l !== linha);
  atualizarTudo();
}

// Itens simples (sem tamanho) usam o "+/−" direto no card do cardápio.
function alterarSimples(produtoId, delta) {
  const linha = estado.linhas.find((l) => l.produtoId === produtoId && !l.obs);
  if (linha) return alterarLinha(linha.id, delta);
  if (delta > 0) adicionarLinha({ produtoId, metadeId: null, tamanho: null, qtd: 1, obs: '' });
}

function atualizarTudo() {
  renderProdutos();
  renderBarra();
  if (!$('#carrinho').hidden) renderCarrinho();
}

// ---------- Render: cardápio ----------
function renderCategorias() {
  $('#categorias').innerHTML = estado.menu.categorias
    .map((c, i) => `<button class="chip${i === 0 ? ' ativa' : ''}" data-cat="${c.id}">${esc(c.nome)}</button>`)
    .join('');
}

function rotuloCozinha(cozinhaId) {
  if (!cozinhaId) return '<span class="tag-cozinha c0">Balcão</span>';
  const c = estado.menu.cozinhas[cozinhaId];
  return `<span class="tag-cozinha c${c.id}">${esc(c.nome)}</span>`;
}

function htmlProduto(p) {
  if (ehPizza(p)) {
    const qtd = estado.linhas.filter((l) => l.produtoId === p.id).reduce((s, l) => s + l.qtd, 0);
    return `
      <article class="produto${qtd ? ' no-carrinho' : ''}" data-pizza="${p.id}">
        <div class="info">
          <div class="nome">${esc(p.nome)}</div>
          <div class="desc">${esc(p.descricao)}</div>
          <div class="preco"><small>a partir de</small> ${brl(p.precos.B)}</div>
          ${qtd ? `<div class="no-pedido">${qtd} no pedido</div>` : ''}
        </div>
        <div class="passo"><button class="mais" data-abrir-pizza aria-label="Escolher ${esc(p.nome)}">+</button></div>
      </article>`;
  }
  const linha = estado.linhas.find((l) => l.produtoId === p.id && !l.obs);
  const qtd = linha ? linha.qtd : 0;
  return `
    <article class="produto${qtd ? ' no-carrinho' : ''}" data-simples="${p.id}">
      <div class="info">
        <div class="nome">${esc(p.nome)}</div>
        <div class="desc">${esc(p.descricao)}</div>
        <div class="preco">${brl(p.preco)}</div>
      </div>
      <div class="passo">
        ${qtd ? `<button data-simples-delta="-1" aria-label="Remover">−</button><b>${qtd}</b>` : ''}
        <button class="mais" data-simples-delta="1" aria-label="Adicionar ${esc(p.nome)}">+</button>
      </div>
    </article>`;
}

function renderProdutos() {
  const termo = normalizar(estado.busca.trim());
  const combina = (p) => !termo || normalizar(`${p.nome} ${p.descricao}`).includes(termo);
  const grupos = estado.menu.categorias
    .map((c) => ({ c, itens: estado.menu.produtos.filter((p) => p.categoria === c.id && combina(p)) }))
    .filter((g) => g.itens.length);

  $('#produtos').innerHTML = grupos.length
    ? grupos.map(({ c, itens }) => `
      <section class="grupo" id="cat-${c.id}">
        <h3>${esc(c.nome)} ${rotuloCozinha(c.cozinha)}</h3>
        ${itens.map(htmlProduto).join('')}
      </section>`).join('')
    : `<p class="sem-resultado">Nada encontrado para “${esc(estado.busca)}”.</p>`;
}

function renderBarra() {
  const { qtd, total } = totais();
  $('#barra-carrinho').hidden = qtd === 0 || $('#cardapio').hidden;
  $('#qtd-carrinho').textContent = qtd;
  $('#total-carrinho').textContent = brl(total);
}

// ---------- Folhas ----------
function abrirFolha(id) {
  $$('.folha').forEach((f) => (f.hidden = f.id !== id));
  $('#fundo').hidden = false;
}
function fecharFolhas() {
  $$('.folha').forEach((f) => (f.hidden = true));
  $('#fundo').hidden = true;
  estado.pizza = null;
}

// ---------- Personalizar pizza ----------
function abrirPizza(produtoId) {
  estado.pizza = { produtoId, tamanho: 'G', metadeId: null, meioAMeio: false, qtd: 1, obs: '' };
  $('#meio-a-meio').checked = false;
  $('#obs-pizza').value = '';
  renderPizza();
  abrirFolha('personalizar');
}

function renderPizza() {
  const pz = estado.pizza;
  const p = produto(pz.produtoId);
  const metade = pz.metadeId && produto(pz.metadeId);
  $('#titulo-pizza').textContent = metade ? `½ ${p.nome} + ½ ${metade.nome}` : p.nome;

  $('#tamanhos').innerHTML = estado.menu.tamanhos.map((t) => {
    const preco = Math.max(p.precos[t.id], metade ? metade.precos[t.id] : 0);
    return `
      <button data-tamanho="${t.id}" class="${pz.tamanho === t.id ? 'ativo' : ''}">
        <b>${esc(t.nome)}</b><small>${t.fatias} fatias</small><span>${brl(preco)}</span>
      </button>`;
  }).join('');

  const sabores = $('#sabores');
  sabores.hidden = !pz.meioAMeio;
  sabores.innerHTML = estado.menu.produtos
    .filter((s) => s.categoria === p.categoria && s.id !== p.id)
    .map((s) => `<button data-metade="${s.id}" class="${pz.metadeId === s.id ? 'ativo' : ''}">${esc(s.nome)}</button>`)
    .join('');

  $('#qtd-pizza').textContent = pz.qtd;
  const preco = precoLinha(pz) * pz.qtd;
  $('#adicionar-pizza').textContent = `Adicionar · ${brl(preco)}`;
}

function confirmarPizza() {
  const pz = estado.pizza;
  if (pz.meioAMeio && !pz.metadeId) return avisar('Escolha o segundo sabor.', 'erro');
  adicionarLinha({
    produtoId: pz.produtoId,
    metadeId: pz.meioAMeio ? pz.metadeId : null,
    tamanho: pz.tamanho,
    qtd: pz.qtd,
    obs: $('#obs-pizza').value.trim(),
  });
  fecharFolhas();
  avisar(`${nomeLinha(pz)} adicionada.`, 'ok');
}

// ---------- Revisar pedido ----------
function renderCarrinho() {
  if (estado.linhas.length === 0) return fecharFolhas();
  const id = $('#identificador').value.trim();
  $('#titulo-carrinho').textContent = id ? rotuloIdentificacao(estado.tipo, id) : 'Revisar pedido';

  // Agrupa como a cozinha vai receber.
  const grupos = new Map();
  for (const l of estado.linhas) {
    const c = cozinhaDaLinha(l);
    if (!grupos.has(c)) grupos.set(c, []);
    grupos.get(c).push(l);
  }
  const ordem = [...grupos.keys()].sort((a, b) => (a || 99) - (b || 99));

  $('#itens-carrinho').innerHTML = ordem.map((c) => {
    const titulo = c
      ? `${estado.menu.cozinhas[c].nome} · ${estado.menu.cozinhas[c].setor}`
      : 'Balcão · não vai para a cozinha';
    return `<p class="destino-cozinha">→ ${esc(titulo)}</p>` + grupos.get(c).map((l) => `
      <div class="item-carrinho" data-linha="${l.id}">
        <div class="linha">
          <span class="nome">${esc(nomeLinha(l))}
            <small>${l.tamanho ? `${esc(tamanho(l.tamanho).nome)} · ` : ''}${brl(precoLinha(l))} cada</small>
          </span>
          <div class="passo">
            <button data-linha-delta="-1" aria-label="Remover">−</button><b>${l.qtd}</b>
            <button class="mais" data-linha-delta="1" aria-label="Adicionar">+</button>
          </div>
        </div>
        ${c ? `<input data-obs placeholder="Observação para a cozinha" maxlength="140" value="${esc(l.obs)}">` : ''}
      </div>`).join('');
  }).join('');

  $('#total-folha').textContent = brl(totais().total);
}

function rotuloIdentificacao(tipo, id) {
  return tipo === 'mesa' ? `Mesa ${id}` : `${tipo === 'balcao' ? 'Balcão' : 'Delivery'} · ${id}`;
}

function validarIdentificacao() {
  const input = $('#identificador');
  const valor = input.value.trim();
  const ok = estado.tipo === 'mesa' ? /^\d{1,3}$/.test(valor) : valor.length > 0;
  if (!ok) {
    fecharFolhas();
    input.classList.add('erro');
    input.focus();
    avisar(estado.tipo === 'mesa' ? 'Informe o número da mesa.' : 'Informe o nome do cliente.', 'erro');
  }
  return ok ? valor : null;
}

async function enviarPedido() {
  const identificador = validarIdentificacao();
  if (!identificador) return;

  const botao = $('#enviar');
  botao.disabled = true;
  botao.textContent = 'Enviando…';
  try {
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: estado.tipo,
        mesa: identificador,
        garcom: $('#garcom').value.trim(),
        itens: estado.linhas.map(({ produtoId, metadeId, tamanho, qtd, obs }) => ({ produtoId, metadeId, tamanho, qtd, obs })),
      }),
    });
    const pedido = await res.json();
    if (!res.ok) throw new Error(pedido.erro || 'Falha ao enviar.');

    estado.linhas = [];
    $('#identificador').value = '';
    fecharFolhas();
    atualizarTudo();
    mostrarSucesso(pedido);
  } catch (err) {
    avisar(err.message === 'Failed to fetch' ? 'Sem conexão com o servidor. Tente de novo.' : err.message, 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Enviar para as cozinhas';
  }
}

function mostrarSucesso(pedido) {
  const contar = (itens) => itens.reduce((s, i) => s + i.qtd, 0);
  const destinos = pedido.tickets.map((t) => ({ nome: t.cozinhaNome.replace(' - ', ' · '), qtd: contar(t.itens) }));
  const balcao = pedido.itens.filter((i) => i.cozinhaId == null);
  if (balcao.length) destinos.push({ nome: 'Balcão', qtd: contar(balcao) });

  $('#sucesso-titulo').textContent = `Pedido #${pedido.numero} · ${pedido.rotulo}`;
  $('#sucesso-destinos').innerHTML = destinos
    .map((d) => `<li>${esc(d.nome)} <small>${d.qtd} ${d.qtd === 1 ? 'item' : 'itens'}</small></li>`)
    .join('');
  $('#aviso').hidden = true;
  $('#sucesso').hidden = false;
  if (navigator.vibrate) navigator.vibrate(60);
}

// ---------- Acompanhar ----------
function renderPedidos() {
  const meu = normalizar($('#garcom').value.trim());
  const lista = estado.pedidos.filter((p) =>
    p.tickets.length && (estado.filtro === 'todos' || !meu || normalizar(p.garcom || '') === meu));

  $('#badge-prontos').hidden = estado.prontosNaoVistos === 0;
  $('#badge-prontos').textContent = estado.prontosNaoVistos;

  $('#lista-pedidos').innerHTML = lista.length
    ? lista.map((p) => {
      const qtd = p.itens.reduce((s, i) => s + i.qtd, 0);
      const podeCancelar = !p.cancelado && p.tickets.some((t) => t.status !== 'pronto');
      return `
        <article class="pedido-card${p.cancelado ? ' cancelado' : ''}">
          <header><h4>#${p.numero} · ${esc(p.rotulo)}</h4><time>${hora(p.criadoEm)}</time></header>
          <div class="resumo">${qtd} ${qtd === 1 ? 'item' : 'itens'} · ${brl(p.total)}${p.garcom ? ` · ${esc(p.garcom)}` : ''}</div>
          ${p.tickets.map((t) => `
            <div class="status-linha">
              <span>${esc(t.cozinhaNome.replace(' - ', ' · '))}</span>
              <span>
                ${t.impressao === 'falhou' ? '<span class="status impressao-falhou">Não impresso</span>' : ''}
                <span class="status ${t.status}">${ROTULO_STATUS[t.status]}</span>
              </span>
            </div>`).join('')}
          ${podeCancelar ? `<button class="cancelar" data-cancelar="${p.id}">Cancelar pedido</button>` : ''}
        </article>`;
    }).join('')
    : `<p class="vazio">${estado.filtro === 'meus' && meu ? 'Você ainda não enviou pedidos.' : 'Nenhum pedido enviado para as cozinhas.'}</p>`;
}

async function cancelarPedido(id) {
  const pedido = estado.pedidos.find((p) => p.id === id);
  const dialogo = $('#confirmar');
  $('#confirmar-titulo').textContent = `Cancelar pedido #${pedido.numero}?`;
  $('#confirmar-texto').textContent = `${pedido.rotulo}. As cozinhas serão avisadas e um comprovante de cancelamento será impresso.`;
  dialogo.returnValue = ''; // Esc não pode reaproveitar um "sim" anterior
  dialogo.showModal();
  const resposta = await new Promise((r) => dialogo.addEventListener('close', () => r(dialogo.returnValue), { once: true }));
  if (resposta !== 'sim') return;

  const res = await fetch(`/api/pedidos/${id}/cancelar`, { method: 'POST' });
  const dados = await res.json();
  if (!res.ok) return avisar(dados.erro || 'Não foi possível cancelar.', 'erro');
  avisar(`Pedido #${pedido.numero} cancelado.`, 'ok');
}

function conectarTempoReal() {
  const fonte = new EventSource('/api/garcom/stream');
  fonte.addEventListener('pedido', (e) => {
    const pedido = JSON.parse(e.data);
    estado.pedidos = [pedido, ...estado.pedidos.filter((p) => p.id !== pedido.id)].sort((a, b) => b.id - a.id);
    renderPedidos();
  });
  fonte.addEventListener('ticket', (e) => {
    const ticket = JSON.parse(e.data);
    const pedido = estado.pedidos.find((p) => p.id === ticket.pedidoId);
    if (!pedido) return;
    const anterior = pedido.tickets.find((t) => t.id === ticket.id);
    pedido.tickets = pedido.tickets.map((t) => (t.id === ticket.id ? ticket : t));
    if (anterior && anterior.status !== 'pronto' && ticket.status === 'pronto') {
      avisar(`${ticket.rotulo}: ${ticket.cozinhaNome.split(' - ')[1]} pronto!`, 'ok');
      if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
      if ($('#pedidos').hidden) estado.prontosNaoVistos++;
    }
    renderPedidos();
  });
  fonte.onopen = async () => {
    $('#conexao').classList.add('on');
    estado.pedidos = await (await fetch('/api/pedidos')).json();
    renderPedidos();
  };
  fonte.onerror = () => $('#conexao').classList.remove('on');
}

// ---------- Geral ----------
let timerAviso;
function avisar(texto, tipo = '') {
  const el = $('#aviso');
  el.textContent = texto;
  el.className = `aviso ${tipo}`;
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (el.hidden = true), 3200);
}

function trocarAba(aba) {
  $$('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  $('#cardapio').hidden = aba !== 'cardapio';
  $('#pedidos').hidden = aba !== 'pedidos';
  if (aba === 'pedidos') estado.prontosNaoVistos = 0;
  renderBarra();
  renderPedidos();
  window.scrollTo({ top: 0 });
}

function trocarTipo(tipo) {
  estado.tipo = tipo;
  $$('[data-tipo]').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.tipo === tipo);
    b.setAttribute('aria-checked', String(b.dataset.tipo === tipo));
  });
  const cfg = TIPOS[tipo];
  const input = $('#identificador');
  $('#rotulo-identificador').textContent = cfg.rotulo;
  input.placeholder = cfg.placeholder;
  input.inputMode = cfg.modo;
  input.maxLength = cfg.max;
  input.value = '';
  input.classList.remove('erro');
}

function ligarEventos() {
  document.addEventListener('click', (e) => {
    const alvo = e.target;
    let el;
    if ((el = alvo.closest('[data-simples-delta]'))) {
      return alterarSimples(el.closest('[data-simples]').dataset.simples, Number(el.dataset.simplesDelta));
    }
    if ((el = alvo.closest('[data-pizza]'))) return abrirPizza(el.dataset.pizza);
    if ((el = alvo.closest('[data-linha-delta]'))) {
      return alterarLinha(Number(el.closest('[data-linha]').dataset.linha), Number(el.dataset.linhaDelta));
    }
    if ((el = alvo.closest('[data-tamanho]'))) {
      estado.pizza.tamanho = el.dataset.tamanho;
      return renderPizza();
    }
    if ((el = alvo.closest('[data-metade]'))) {
      estado.pizza.metadeId = el.dataset.metade;
      return renderPizza();
    }
    if ((el = alvo.closest('[data-qtd-pizza]'))) {
      estado.pizza.qtd = Math.min(50, Math.max(1, estado.pizza.qtd + Number(el.dataset.qtdPizza)));
      return renderPizza();
    }
    if ((el = alvo.closest('[data-tipo]'))) return trocarTipo(el.dataset.tipo);
    if ((el = alvo.closest('[data-filtro]'))) {
      estado.filtro = el.dataset.filtro;
      $$('[data-filtro]').forEach((b) => b.classList.toggle('ativo', b === el));
      return renderPedidos();
    }
    if ((el = alvo.closest('[data-cancelar]'))) return cancelarPedido(Number(el.dataset.cancelar));
    if ((el = alvo.closest('.chip'))) {
      $$('.chip').forEach((c) => c.classList.toggle('ativa', c === el));
      const secao = document.getElementById(`cat-${el.dataset.cat}`);
      if (secao) window.scrollTo({ top: secao.offsetTop - 200, behavior: 'smooth' });
      return;
    }
    if ((el = alvo.closest('.aba'))) return trocarAba(el.dataset.aba);
    if (alvo.closest('[data-fechar]') || alvo.id === 'fundo') return fecharFolhas();
  });

  document.addEventListener('input', (e) => {
    if (e.target.matches('[data-obs]')) {
      const linha = estado.linhas.find((l) => l.id === Number(e.target.closest('[data-linha]').dataset.linha));
      linha.obs = e.target.value;
    }
  });

  $('#meio-a-meio').addEventListener('change', (e) => {
    estado.pizza.meioAMeio = e.target.checked;
    if (!e.target.checked) estado.pizza.metadeId = null;
    renderPizza();
  });
  $('#busca').addEventListener('input', (e) => {
    estado.busca = e.target.value;
    renderProdutos();
  });
  $('#identificador').addEventListener('input', (e) => e.target.classList.remove('erro'));
  $('#garcom').value = lerGuardado('garcom');
  $('#garcom').addEventListener('change', (e) => {
    guardar('garcom', e.target.value.trim());
    renderPedidos();
  });
  $('#barra-carrinho').addEventListener('click', () => {
    renderCarrinho();
    abrirFolha('carrinho');
  });
  $('#enviar').addEventListener('click', enviarPedido);
  $('#adicionar-pizza').addEventListener('click', confirmarPizza);
  $('#novo-pedido').addEventListener('click', () => {
    $('#sucesso').hidden = true;
    window.scrollTo({ top: 0 });
  });
}

async function iniciar() {
  ligarEventos();
  try {
    estado.menu = await (await fetch('/api/menu')).json();
  } catch {
    return avisar('Não foi possível carregar o cardápio. Verifique a conexão.', 'erro');
  }
  $('#nome-loja').textContent = estado.menu.loja.nome;
  document.title = `${estado.menu.loja.nome} · Garçom`;
  renderCategorias();
  renderProdutos();
  renderBarra();
  conectarTempoReal();
}

iniciar();

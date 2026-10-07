// Tela da cozinha (KDS): recebe só os tickets desta cozinha em tempo real.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
// "12" vira "Mesa 12"; textos livres (ex.: "Delivery - João") aparecem como estão.
const rotuloMesa = (m) => (/^\d+$/.test(m) ? `Mesa ${m}` : m);

const params = new URLSearchParams(location.search);
const COZINHA_ID = Number(params.get('id')) || 1;
const MINUTOS_ATRASO = 20;
const ROTULO_IMPRESSAO = {
  pendente: 'Imprimindo…',
  impresso: 'Impresso',
  simulado: 'Impresso (simulado)',
  falhou: 'Falha na impressora!',
};

const tickets = new Map();
const recemChegados = new Set();
let audio;

function guardar(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch {}
}
function lerGuardado(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}

// ---------- Render ----------
function minutosDesde(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function htmlTicket(t) {
  const min = minutosDesde(t.criadoEm);
  const classes = ['ticket', t.status];
  if (min >= MINUTOS_ATRASO) classes.push('atrasado');
  if (recemChegados.has(t.id)) classes.push('chegou');
  const acao = t.status === 'novo'
    ? `<button class="btn iniciar" data-status="preparo">Iniciar</button>`
    : `<button class="btn pronto" data-status="pronto">Pronto</button>`;

  return `
    <article class="${classes.join(' ')}" data-id="${t.id}">
      <header>
        <div>
          <div class="mesa">${esc(rotuloMesa(t.mesa))}</div>
          <div class="numero">Pedido #${t.numeroPedido} · ${hora(t.criadoEm)}${t.garcom ? ` · ${esc(t.garcom)}` : ''}</div>
        </div>
        <div class="tempo" data-tempo="${t.criadoEm}">${min} min</div>
      </header>
      <ul>
        ${t.itens.map((i) => `
          <li><span class="qtd">${i.qtd}×</span>${esc(i.nome)}
            ${i.obs ? `<span class="obs">⚠ ${esc(i.obs)}</span>` : ''}
          </li>`).join('')}
      </ul>
      <div class="rodape">
        <span class="info ${t.impressao}">${ROTULO_IMPRESSAO[t.impressao] || ''}</span>
        <button class="btn sec" data-reimprimir title="Reimprimir na impressora da cozinha">🖨</button>
        ${acao}
      </div>
    </article>`;
}

function render() {
  const todos = [...tickets.values()].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm) || a.id - b.id);
  const ativos = todos.filter((t) => t.status !== 'pronto');
  const prontos = todos.filter((t) => t.status === 'pronto').slice(-12).reverse();

  $('#tickets').innerHTML = ativos.length
    ? ativos.map(htmlTicket).join('')
    : '<p class="vazio">Nenhum pedido na fila 🎉</p>';
  $('#lista-prontos').innerHTML = prontos
    .map((t) => `<button class="chip-pronto" data-id="${t.id}" title="Tocar para voltar ao preparo">${esc(rotuloMesa(t.mesa))} <small>#${t.numeroPedido}</small></button>`)
    .join('');
  $('#n-novo').textContent = ativos.filter((t) => t.status === 'novo').length;
  $('#n-preparo').textContent = ativos.filter((t) => t.status === 'preparo').length;
}

function atualizarTempos() {
  document.querySelectorAll('[data-tempo]').forEach((el) => {
    const min = minutosDesde(el.dataset.tempo);
    el.textContent = `${min} min`;
    el.closest('.ticket').classList.toggle('atrasado', min >= MINUTOS_ATRASO);
  });
  $('#relogio').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ---------- Ações ----------
async function mudarStatus(id, status) {
  const res = await fetch(`/api/tickets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (res.ok) receber(await res.json(), false);
}

async function reimprimir(id) {
  const t = tickets.get(id);
  t.impressao = 'pendente';
  render();
  const res = await fetch(`/api/tickets/${id}/imprimir`, { method: 'POST' });
  if (res.ok) receber(await res.json(), false);
  if ($('#imprimir-local').checked) imprimirNoNavegador(t);
}

// ---------- Impressão pelo navegador (impressora USB ligada ao PC da cozinha) ----------
const filaImpressao = [];
let imprimindo = false;

function imprimirNoNavegador(t) {
  filaImpressao.push(t);
  if (!imprimindo) processarFila();
}

function processarFila() {
  const t = filaImpressao.shift();
  if (!t) {
    imprimindo = false;
    return;
  }
  imprimindo = true;
  $('#area-impressao').innerHTML = `
    <h2>${esc(t.cozinhaNome.toUpperCase())}</h2>
    <div class="grande">PEDIDO #${t.numeroPedido}</div>
    <div class="grande">${esc(rotuloMesa(t.mesa).toUpperCase())}</div>
    <hr>
    <p>Hora: ${hora(t.criadoEm)}${t.garcom ? ` · Garçom: ${esc(t.garcom)}` : ''}</p>
    <hr>
    ${t.itens.map((i) => `<p class="item">${i.qtd}x ${esc(i.nome)}</p>${i.obs ? `<p class="obs">OBS: ${esc(i.obs)}</p>` : ''}`).join('')}
    <hr>`;
  // window.print() bloqueia até o diálogo fechar; o setTimeout deixa o DOM pintar antes.
  setTimeout(() => {
    window.print();
    processarFila();
  }, 100);
}

// ---------- Som ----------
function bipar() {
  if (!audio) return;
  const agora = audio.currentTime;
  [0, 0.25, 0.5].forEach((atraso, i) => {
    const osc = audio.createOscillator();
    const ganho = audio.createGain();
    osc.frequency.value = i === 2 ? 1320 : 880;
    ganho.gain.setValueAtTime(0.0001, agora + atraso);
    ganho.gain.exponentialRampToValueAtTime(0.4, agora + atraso + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, agora + atraso + 0.2);
    osc.connect(ganho).connect(audio.destination);
    osc.start(agora + atraso);
    osc.stop(agora + atraso + 0.22);
  });
}

// ---------- Tempo real ----------
function receber(ticket, ehNovo) {
  const jaExistia = tickets.has(ticket.id);
  tickets.set(ticket.id, ticket);
  if (ehNovo && !jaExistia) {
    recemChegados.add(ticket.id);
    setTimeout(() => recemChegados.delete(ticket.id), 5000);
    bipar();
    if ($('#imprimir-local').checked) imprimirNoNavegador(ticket);
  }
  render();
}

function conectar() {
  const fonte = new EventSource(`/api/cozinhas/${COZINHA_ID}/stream`);
  fonte.addEventListener('ticket', (e) => receber(JSON.parse(e.data), true));
  fonte.onopen = async () => {
    $('#conexao').className = 'conexao on';
    $('#conexao').textContent = 'ao vivo';
    // Recarrega tudo ao (re)conectar para não perder pedidos enviados durante a queda.
    const lista = await (await fetch(`/api/cozinhas/${COZINHA_ID}/tickets`)).json();
    tickets.clear();
    for (const t of lista) tickets.set(t.id, t);
    render();
  };
  fonte.onerror = () => {
    $('#conexao').className = 'conexao off';
    $('#conexao').textContent = 'reconectando…';
  };
}

// ---------- Início ----------
async function iniciar() {
  document.documentElement.dataset.cozinha = COZINHA_ID;
  const outra = COZINHA_ID === 1 ? 2 : 1;
  $('#trocar').href = `/cozinha.html?id=${outra}`;
  $('#trocar').textContent = `Ir para Cozinha ${outra}`;

  try {
    const { cozinhas } = await (await fetch('/api/menu')).json();
    const c = cozinhas[COZINHA_ID];
    if (c) {
      $('#nome-cozinha').textContent = `${c.nome} · ${c.setor}`;
      $('#ativar-titulo').textContent = `Abrir ${c.nome} · ${c.setor}`;
      document.title = `${c.nome} · ${c.setor}`;
    }
  } catch {}

  const chaveImpressao = `imprimir-local-${COZINHA_ID}`;
  $('#imprimir-local').checked = lerGuardado(chaveImpressao) === '1';
  $('#imprimir-local').addEventListener('change', (e) => guardar(chaveImpressao, e.target.checked ? '1' : '0'));

  $('#botao-ativar').addEventListener('click', () => {
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
    $('#ativar').hidden = true;
  });

  document.addEventListener('click', (e) => {
    const card = e.target.closest('.ticket');
    const statusBtn = e.target.closest('[data-status]');
    if (card && statusBtn) return mudarStatus(card.dataset.id, statusBtn.dataset.status);
    if (card && e.target.closest('[data-reimprimir]')) return reimprimir(Number(card.dataset.id));
    const chip = e.target.closest('.chip-pronto');
    if (chip) mudarStatus(chip.dataset.id, 'preparo');
  });

  conectar();
  atualizarTempos();
  setInterval(atualizarTempos, 15000);
}

iniciar();

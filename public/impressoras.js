// Simulação das impressoras térmicas: recebe cada impressão do servidor
// e desenha o papel saindo, linha a linha.

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const LARGURA = 42;
const MS_POR_LINHA = 45;
const TIPO_ROTULO = { pedido: 'Pedido', cancelamento: 'Cancelado', teste: 'Teste' };

const impressoras = new Map(); // cozinhaId -> { estado, el, fila, imprimindo, exibindo }
let audio = null;

// ---------- Papel ----------
function htmlLinha(l) {
  if (l.separador) return `<div class="l sep">${l.separador.repeat(LARGURA)}</div>`;
  if (l.espaco) return '<div class="l"> </div>';
  const classes = ['l', l.centro && 'c', l.grande && 'g', l.alto && 'a', l.negrito && 'b'].filter(Boolean).join(' ');
  const texto = l.invertido ? `<span class="inv">${esc(l.texto)}</span>` : esc(l.texto);
  return `<div class="${classes}">${texto}</div>`;
}

function mostrarPapel(imp, job, animar) {
  const papel = $('.papel', imp.el);
  papel.classList.remove('vazio', 'saindo');
  $('.conteudo', papel).innerHTML = job.linhas.map(htmlLinha).join('');
  imp.exibindo = job.id;
  marcarHistorico(imp);
  if (!animar) return Promise.resolve();

  // Esconde todas as linhas e revela uma a uma, como a cabeça térmica.
  void papel.offsetWidth;
  papel.classList.add('saindo');
  const linhas = [...papel.querySelectorAll('.l')];
  linhas.forEach((l) => l.classList.add('oculta'));
  return new Promise((resolve) => {
    let i = 0;
    const passo = () => {
      if (i >= linhas.length) return resolve();
      linhas[i++].classList.remove('oculta');
      zumbido();
      setTimeout(passo, MS_POR_LINHA);
    };
    passo();
  });
}

// ---------- Fila por impressora ----------
async function processarFila(imp) {
  if (imp.imprimindo) return;
  imp.imprimindo = true;
  while (imp.fila.length) {
    const job = imp.fila.shift();
    imp.estado.impressoes.push(job);
    if (job.status === 'falhou') {
      mostrarErro(imp, job);
    } else {
      esconderErro(imp);
      setLed(imp, 'imprimindo');
      await mostrarPapel(imp, job, true);
      corte();
      await new Promise((r) => setTimeout(r, 400));
    }
    renderHistorico(imp);
    setLed(imp);
  }
  imp.imprimindo = false;
}

function mostrarErro(imp, job) {
  const el = $('.erro-impressora', imp.el);
  el.hidden = false;
  el.textContent = `⚠ Falha ao imprimir ${job.numeroPedido ? `pedido #${job.numeroPedido}` : 'teste'}: ${job.erro}`;
  setLed(imp);
  imp.falhou = true;
}

function esconderErro(imp) {
  $('.erro-impressora', imp.el).hidden = true;
  imp.falhou = false;
}

function setLed(imp, forcado) {
  const led = $('.led', imp.el);
  const estado = forcado || (imp.falhou ? 'falhou' : imp.estado.modo);
  led.className = `led ${estado}`;
  const textos = { imprimindo: 'Imprimindo…', falhou: 'Erro', simulada: 'Simulada', rede: 'Online' };
  $('.led-texto', imp.el).textContent = textos[estado] || '';
}

// ---------- Histórico ----------
function descricao(job) {
  if (job.tipo === 'teste') return 'Página de teste';
  return `#${job.numeroPedido} · ${job.rotulo}`;
}

function renderHistorico(imp) {
  const lista = [...imp.estado.impressoes].sort((a, b) => b.id - a.id);
  $('.contador b', imp.el).textContent = imp.estado.impressoes.filter((j) => j.status === 'ok').length;
  $('.historico', imp.el).innerHTML = lista.length
    ? lista.map((j) => `
      <li><button data-job="${j.id}">
        <span class="h-tipo ${j.tipo}">${TIPO_ROTULO[j.tipo]}</span>
        <span class="h-desc">${esc(descricao(j))}</span>
        <span class="h-status ${j.status}">${j.status === 'falhou' ? 'Falhou' : ''}</span>
        <span class="h-hora">${hora(j.em)}</span>
      </button></li>`).join('')
    : '<li class="vazio">Nada impresso ainda.</li>';
  marcarHistorico(imp);
}

function marcarHistorico(imp) {
  imp.el.querySelectorAll('.historico button').forEach((b) => {
    b.classList.toggle('atual', Number(b.dataset.job) === imp.exibindo);
  });
}

// ---------- Som (cabeça térmica + guilhotina) ----------
function ruido(duracao, volume, frequencia) {
  if (!audio) return;
  const amostras = Math.floor(audio.sampleRate * duracao);
  const buffer = audio.createBuffer(1, amostras, audio.sampleRate);
  const dados = buffer.getChannelData(0);
  for (let i = 0; i < amostras; i++) dados[i] = (Math.random() * 2 - 1) * (1 - i / amostras);
  const fonte = audio.createBufferSource();
  const filtro = audio.createBiquadFilter();
  const ganho = audio.createGain();
  fonte.buffer = buffer;
  filtro.type = 'bandpass';
  filtro.frequency.value = frequencia;
  ganho.gain.value = volume;
  fonte.connect(filtro).connect(ganho).connect(audio.destination);
  fonte.start();
}
const zumbido = () => ruido(0.035, 0.25, 2400);
const corte = () => ruido(0.12, 0.6, 900);

function alternarSom() {
  const botao = $('#som');
  if (audio) {
    audio.close();
    audio = null;
  } else {
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
  }
  botao.setAttribute('aria-pressed', String(!!audio));
  botao.textContent = audio ? '🔊 Som ligado' : '🔇 Som desligado';
}

// ---------- Montagem ----------
function criarImpressora(estado) {
  const el = $('#tpl-impressora').content.firstElementChild.cloneNode(true);
  $('.nome', el).textContent = `${estado.nome} · ${estado.setor}`;
  $('.destino', el).textContent = estado.modo === 'rede' ? `Rede ${estado.destino}` : 'Sem impressora configurada';
  const ultimas = estado.impressoes;
  const imp = { estado: { ...estado, impressoes: ultimas }, el, fila: [], imprimindo: false, exibindo: null, falhou: false };

  $('.teste', el).addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const res = await fetch(`/api/impressoras/${estado.cozinhaId}/teste`, { method: 'POST' });
      if (!res.ok) throw new Error(`o servidor respondeu ${res.status}`);
    } catch (err) {
      mostrarErro(imp, { erro: `${err.message}. Se o servidor foi atualizado, reinicie-o (Ctrl+C e npm start).` });
    } finally {
      setTimeout(() => (e.target.disabled = false), 800);
    }
  });
  $('.historico', el).addEventListener('click', (e) => {
    const botao = e.target.closest('[data-job]');
    if (!botao) return;
    const job = imp.estado.impressoes.find((j) => j.id === Number(botao.dataset.job));
    if (job && job.status === 'ok') mostrarPapel(imp, job, false);
  });

  const ultimaOk = [...ultimas].reverse().find((j) => j.status === 'ok');
  if (ultimaOk) mostrarPapel(imp, ultimaOk, false);
  renderHistorico(imp);
  setLed(imp);
  return imp;
}

async function carregar() {
  const raiz = $('#impressoras');
  const res = await fetch('/api/impressoras').catch(() => null);
  if (!res || !res.ok) {
    raiz.innerHTML = `<p class="falha-geral">Não foi possível carregar as impressoras${res ? ` (o servidor respondeu ${res.status})` : ''}.
      Se o sistema foi atualizado, reinicie o servidor: <code>Ctrl+C</code> e <code>npm start</code>.</p>`;
    return;
  }
  const lista = await res.json();
  raiz.innerHTML = '';
  impressoras.clear();
  for (const estado of lista) {
    const imp = criarImpressora(estado);
    impressoras.set(estado.cozinhaId, imp);
    raiz.appendChild(imp.el);
  }
}

function conectar() {
  const fonte = new EventSource('/api/impressoras/stream');
  fonte.addEventListener('impressao', (e) => {
    const job = JSON.parse(e.data);
    const imp = impressoras.get(job.cozinhaId);
    if (!imp || imp.estado.impressoes.some((j) => j.id === job.id)) return;
    imp.fila.push(job);
    processarFila(imp);
  });
  fonte.onopen = () => {
    $('#conexao').className = 'conexao on';
    $('#conexao').textContent = 'ao vivo';
    carregar();
  };
  fonte.onerror = () => {
    $('#conexao').className = 'conexao off';
    $('#conexao').textContent = 'reconectando…';
  };
}

$('#som').addEventListener('click', alternarSom);
carregar();
conectar();

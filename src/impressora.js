// Impressão dos tickets nas impressoras térmicas das cozinhas.
//
// Configure a impressora de cada cozinha por variável de ambiente (ESC/POS via rede, porta 9100):
//   IMPRESSORA_COZINHA_1=192.168.0.50:9100
//   IMPRESSORA_COZINHA_2=192.168.0.51
// Sem configuração, a impressão é simulada: aparece na tela /impressoras.html
// e fica registrada em impressoes/cozinha-N.txt.
//
// O ticket é montado uma única vez como lista de linhas com estilo; dela saem
// os bytes ESC/POS, o texto puro do log e o JSON que a simulação desenha na tela.

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { cozinhas } = require('./menu');

const LARGURA = 42; // colunas em papel 80mm (fonte A, com margem)
const PASTA_LOG = path.join(__dirname, '..', 'impressoes');

// Impressoras térmicas raramente têm a code page certa para acentos; removemos.
function semAcento(texto) {
  return String(texto)
    .replace(/½/g, '1/2')
    .replace(/·/g, '-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function quebrar(texto, largura) {
  const linhas = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    if (atual && (atual + ' ' + palavra).length > largura) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = atual ? `${atual} ${palavra}` : palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function dataHora(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

// ---------- Montagem ----------
// Linha: { texto, centro, grande (largura e altura duplas), alto (só altura dupla), negrito, invertido }
// ou { separador: '-' | '=' } ou { espaco: true }.
function criarMontador() {
  const linhas = [];
  return {
    linhas,
    texto(texto, estilo = {}) {
      const largura = estilo.grande ? LARGURA / 2 : LARGURA;
      const recuo = estilo.recuo || '';
      for (const parte of quebrar(semAcento(texto), largura - recuo.length)) {
        linhas.push({ ...estilo, recuo: undefined, texto: recuo + parte });
      }
    },
    separador(caractere = '-') {
      linhas.push({ separador: caractere });
    },
    espaco() {
      linhas.push({ espaco: true });
    },
  };
}

function cabecalho(m, ticket) {
  m.texto(ticket.cozinhaNome.toUpperCase(), { centro: true, grande: true });
  m.separador('=');
  m.texto(`PEDIDO #${ticket.numeroPedido}`, { centro: true, grande: true });
  m.texto(ticket.rotulo.toUpperCase(), { centro: true, grande: true, invertido: ticket.tipo === 'delivery' });
  if (ticket.tipo === 'delivery') m.texto('EMBALAR PARA VIAGEM', { centro: true, negrito: true });
  m.separador();
  m.texto(`${dataHora(ticket.criadoEm)}${ticket.garcom ? `   Garcom: ${ticket.garcom}` : ''}`);
  m.separador();
}

function itens(m, ticket) {
  for (const item of ticket.itens) {
    const tamanho = item.tamanho ? `[${item.tamanho.toUpperCase()}] ` : '';
    if (item.sabores && item.sabores.length === 2) {
      m.texto(`${item.qtd}x ${tamanho}MEIO A MEIO`, { negrito: true, alto: true });
      for (const sabor of item.sabores) m.texto(`1/2 ${sabor}`, { negrito: true, alto: true, recuo: '    ' });
    } else {
      m.texto(`${item.qtd}x ${tamanho}${item.nome}`, { negrito: true, alto: true });
    }
    if (item.obs) m.texto(`>> ${item.obs.toUpperCase()}`, { negrito: true, recuo: '    ' });
  }
}

function linhasDoTicket(ticket) {
  const m = criarMontador();
  cabecalho(m, ticket);
  itens(m, ticket);
  m.separador();
  const total = ticket.itens.reduce((s, i) => s + i.qtd, 0);
  m.texto(`${total} ${total === 1 ? 'item' : 'itens'} - Ticket ${ticket.id}`, { centro: true });
  return m.linhas;
}

function linhasDoCancelamento(ticket) {
  const m = criarMontador();
  m.texto('*** CANCELADO ***', { centro: true, grande: true, invertido: true });
  m.espaco();
  cabecalho(m, ticket);
  m.texto('NAO PREPARAR OS ITENS ABAIXO:', { negrito: true });
  itens(m, ticket);
  m.separador();
  m.texto(`Cancelado em ${dataHora(ticket.atualizadoEm)}`, { centro: true });
  return m.linhas;
}

function linhasDoTeste(cozinhaId, destino) {
  const c = cozinhas[cozinhaId];
  const m = criarMontador();
  m.texto('TESTE DE IMPRESSAO', { centro: true, grande: true });
  m.separador('=');
  m.texto(`${c.nome} - ${c.setor}`, { centro: true, negrito: true });
  m.texto(destino ? `Destino: ${destino}` : 'Modo simulado', { centro: true });
  m.texto(dataHora(new Date().toISOString()), { centro: true });
  m.separador();
  m.texto('Texto normal 0123456789');
  m.texto('Texto em negrito', { negrito: true });
  m.texto('Altura dupla', { alto: true });
  m.texto('GRANDE', { grande: true });
  m.texto(' Invertido ', { invertido: true });
  m.texto('Acentos: ação, pão, é -> removidos');
  m.separador();
  m.texto('Se voce le isto, a impressora esta OK.', { centro: true });
  return m.linhas;
}

// ---------- Saídas ----------
function paraTexto(linhas) {
  return linhas
    .map((l) => {
      if (l.separador) return l.separador.repeat(LARGURA);
      if (l.espaco) return '';
      if (!l.centro) return l.texto;
      const visivel = l.grande ? l.texto.split('').join(' ') : l.texto;
      return ' '.repeat(Math.max(0, Math.floor((LARGURA - visivel.length) / 2))) + visivel;
    })
    .join('\n') + '\n';
}

const ESC = '\x1b';
const GS = '\x1d';

function paraEscPos(linhas) {
  let saida = ESC + '@';
  for (const l of linhas) {
    if (l.separador) {
      saida += ESC + 'a\x00' + l.separador.repeat(LARGURA) + '\n';
      continue;
    }
    if (l.espaco) {
      saida += '\n';
      continue;
    }
    const tamanho = l.grande ? '\x11' : l.alto ? '\x01' : '\x00';
    saida += ESC + 'a' + (l.centro ? '\x01' : '\x00');
    saida += GS + '!' + tamanho;
    saida += ESC + 'E' + (l.negrito ? '\x01' : '\x00');
    saida += GS + 'B' + (l.invertido ? '\x01' : '\x00');
    saida += l.texto + '\n';
  }
  saida += GS + '!\x00' + ESC + 'E\x00' + GS + 'B\x00';
  saida += '\n\n\n\n' + GS + 'V\x42\x00'; // avança e corta o papel
  return Buffer.from(saida, 'latin1');
}

// ---------- Envio ----------
function destinoDaCozinha(cozinhaId) {
  const valor = process.env[`IMPRESSORA_COZINHA_${cozinhaId}`];
  if (!valor) return null;
  const [host, porta] = valor.split(':');
  return { host, porta: Number(porta) || 9100 };
}

function descreverDestino(cozinhaId) {
  const d = destinoDaCozinha(cozinhaId);
  return d ? { modo: 'rede', destino: `${d.host}:${d.porta}` } : { modo: 'simulada', destino: null };
}

function enviarRede({ host, porta }, dados, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: porta });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`Tempo esgotado em ${host}:${porta}`)));
    socket.once('error', reject);
    socket.once('connect', () => socket.end(dados));
    socket.once('close', (comErro) => {
      if (!comErro) resolve();
    });
  });
}

async function registrarLog(cozinhaId, linhas) {
  await fs.promises.mkdir(PASTA_LOG, { recursive: true });
  const arquivo = path.join(PASTA_LOG, `cozinha-${cozinhaId}.txt`);
  await fs.promises.appendFile(arquivo, paraTexto(linhas) + '~'.repeat(LARGURA) + '\n\n');
}

// Envia as linhas para a impressora da cozinha. Sempre grava no log;
// lança erro se a impressora de rede não responder.
async function enviar(cozinhaId, linhas) {
  const destino = destinoDaCozinha(cozinhaId);
  await registrarLog(cozinhaId, linhas).catch(() => {});
  if (destino) await enviarRede(destino, paraEscPos(linhas));
  return descreverDestino(cozinhaId);
}

module.exports = {
  LARGURA,
  linhasDoTicket,
  linhasDoCancelamento,
  linhasDoTeste,
  paraTexto,
  paraEscPos,
  enviar,
  descreverDestino,
  destinoDaCozinha,
};

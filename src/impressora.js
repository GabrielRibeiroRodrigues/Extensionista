// Impressão dos tickets nas impressoras térmicas das cozinhas.
//
// Configure a impressora de cada cozinha por variável de ambiente (ESC/POS via rede, porta 9100):
//   IMPRESSORA_COZINHA_1=192.168.0.50:9100
//   IMPRESSORA_COZINHA_2=192.168.0.51
// Sem configuração, o ticket é "impresso" em impressoes/cozinha-N.txt e no console (modo simulado).

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const LARGURA = 42; // colunas em papel 80mm (fonte A, com margem)
const PASTA_SIMULADA = path.join(__dirname, '..', 'impressoes');

const ESC = '\x1b';
const GS = '\x1d';
const CMD = {
  iniciar: ESC + '@',
  centro: ESC + 'a' + '\x01',
  esquerda: ESC + 'a' + '\x00',
  negritoOn: ESC + 'E' + '\x01',
  negritoOff: ESC + 'E' + '\x00',
  duplo: GS + '!' + '\x11',
  normal: GS + '!' + '\x00',
  cortar: GS + 'V' + '\x42' + '\x00',
};

// Impressoras térmicas raramente têm a code page certa para acentos; removemos.
function semAcento(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function quebrar(texto, largura, recuo = '') {
  const linhas = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    if ((atual + ' ' + palavra).trim().length > largura - recuo.length) {
      if (atual) linhas.push(recuo + atual);
      atual = palavra;
    } else {
      atual = (atual + ' ' + palavra).trim();
    }
  }
  if (atual) linhas.push(recuo + atual);
  return linhas;
}

function hora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Retorna as partes do ticket; `fmt` decide se aplica comandos ESC/POS ou texto puro.
function montar(ticket, fmt) {
  const sep = '-'.repeat(LARGURA);
  const out = [];
  out.push(fmt.centro + fmt.duplo + semAcento(ticket.cozinhaNome.toUpperCase()) + fmt.normal);
  out.push(fmt.duplo + `PEDIDO #${ticket.numeroPedido}` + fmt.normal);
  const mesa = /^\d+$/.test(ticket.mesa) ? `MESA: ${ticket.mesa}` : ticket.mesa.toUpperCase();
  out.push(fmt.negritoOn + semAcento(mesa) + fmt.negritoOff + fmt.esquerda);
  out.push(sep);
  out.push(semAcento(`Hora: ${hora(ticket.criadoEm)}` + (ticket.garcom ? `   Garcom: ${ticket.garcom}` : '')));
  out.push(sep);
  for (const item of ticket.itens) {
    out.push(fmt.negritoOn + quebrar(semAcento(`${item.qtd}x ${item.nome}`), LARGURA).join('\n') + fmt.negritoOff);
    if (item.obs) out.push(...quebrar(semAcento(`OBS: ${item.obs}`), LARGURA, '   '));
  }
  out.push(sep);
  out.push(fmt.centro + `Ticket ${ticket.id}` + fmt.esquerda);
  return out.join('\n') + '\n';
}

const SEM_FORMATACAO = Object.fromEntries(Object.keys(CMD).map((k) => [k, '']));

function textoDoTicket(ticket) {
  return montar(ticket, SEM_FORMATACAO);
}

function bytesEscPos(ticket) {
  const corpo = CMD.iniciar + montar(ticket, CMD) + '\n\n\n\n' + CMD.cortar;
  return Buffer.from(corpo, 'latin1');
}

function destinoDaCozinha(cozinhaId) {
  const valor = process.env[`IMPRESSORA_COZINHA_${cozinhaId}`];
  if (!valor) return null;
  const [host, porta] = valor.split(':');
  return { host, porta: Number(porta) || 9100 };
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

async function imprimir(ticket) {
  const destino = destinoDaCozinha(ticket.cozinhaId);
  if (destino) {
    await enviarRede(destino, bytesEscPos(ticket));
    return { modo: 'rede', destino: `${destino.host}:${destino.porta}` };
  }

  const texto = textoDoTicket(ticket);
  await fs.promises.mkdir(PASTA_SIMULADA, { recursive: true });
  const arquivo = path.join(PASTA_SIMULADA, `cozinha-${ticket.cozinhaId}.txt`);
  await fs.promises.appendFile(arquivo, texto + '='.repeat(LARGURA) + '\n\n');
  console.log(`\n[impressora simulada cozinha ${ticket.cozinhaId}]\n${texto}`);
  return { modo: 'simulada', destino: arquivo };
}

module.exports = { imprimir, textoDoTicket, bytesEscPos, destinoDaCozinha };

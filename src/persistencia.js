// Salva o estado do store em disco para não perder pedidos ao reiniciar o servidor.
// Grava num arquivo temporário e renomeia, para nunca deixar um JSON pela metade.

const fs = require('node:fs');
const path = require('node:path');

const EVENTOS_QUE_ALTERAM = ['pedido', 'pedido:atualizado', 'ticket:atualizado', 'ticket:cancelado'];

function ligarPersistencia(store, arquivo, { atrasoMs = 300 } = {}) {
  let restaurado = false;
  try {
    store.importar(JSON.parse(fs.readFileSync(arquivo, 'utf8')));
    restaurado = true;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Arquivo corrompido: guarda uma cópia para análise e começa do zero.
      const copia = `${arquivo}.corrompido-${Date.now()}`;
      fs.renameSync(arquivo, copia);
      console.error(`Não foi possível ler ${arquivo} (${err.message}). Cópia salva em ${copia}.`);
    }
  }

  let agendado = null;
  function salvarAgora() {
    agendado = null;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const temporario = `${arquivo}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(store.exportar()));
    fs.renameSync(temporario, arquivo);
  }
  function agendar() {
    if (!agendado) agendado = setTimeout(salvarAgora, atrasoMs);
  }

  for (const evento of EVENTOS_QUE_ALTERAM) store.eventos.on(evento, agendar);

  // Garante a última gravação ao encerrar com Ctrl+C.
  function encerrar() {
    if (agendado) {
      clearTimeout(agendado);
      salvarAgora();
    }
    process.exit(0);
  }
  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);

  return { restaurado, salvarAgora };
}

module.exports = { ligarPersistencia };

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarStore } = require('../src/store');
const { ligarPersistencia } = require('../src/persistencia');

function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pizzaria-'));
}

test('salva pedidos e restaura ao reiniciar', async () => {
  const arquivo = path.join(pastaTemporaria(), 'pedidos.json');
  const antes = criarStore();
  const p1 = ligarPersistencia(antes, arquivo, { atrasoMs: 5 });
  assert.equal(p1.restaurado, false);
  const pedido = antes.criarPedido({ mesa: '3', itens: [{ produtoId: 'p1', qtd: 1 }] });
  antes.atualizarTicket(pedido.ticketIds[0], { status: 'preparo' });
  await new Promise((r) => setTimeout(r, 30));

  const depois = criarStore();
  const p2 = ligarPersistencia(depois, arquivo);
  assert.equal(p2.restaurado, true);
  assert.equal(depois.ticketsDaCozinha(1)[0].status, 'preparo');
});

test('arquivo corrompido é guardado à parte e o sistema começa vazio', () => {
  const pasta = pastaTemporaria();
  const arquivo = path.join(pasta, 'pedidos.json');
  fs.writeFileSync(arquivo, '{ isto não é json');
  const original = console.error;
  console.error = () => {};
  try {
    const { restaurado } = ligarPersistencia(criarStore(), arquivo);
    assert.equal(restaurado, false);
  } finally {
    console.error = original;
  }
  assert.ok(fs.readdirSync(pasta).some((f) => f.startsWith('pedidos.json.corrompido-')));
});

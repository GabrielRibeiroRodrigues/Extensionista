// Cada arquivo de teste roda num processo próprio: aqui o servidor sobe com DEMO=1.
process.env.DEMO = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { servidor, store, auth } = require('../server');
const { popularExemplos } = require('../src/seed');

let base;
test.before(() => new Promise((r) => servidor.listen(0, () => {
  base = `http://127.0.0.1:${servidor.address().port}`;
  r();
})));
test.after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

async function entrarDemo(usuario) {
  const res = await fetch(`${base}/api/demo/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario }),
  });
  return { status: res.status, cookie: (res.headers.get('set-cookie') || '').split(';')[0], dados: await res.json() };
}

test('lista os 6 perfis de demonstração sem expor segredos', async () => {
  const demo = await (await fetch(`${base}/api/demo`)).json();
  assert.equal(demo.ativo, true);
  assert.deepEqual(demo.perfis.map((p) => p.cargo).sort(), ['cozinha1', 'cozinha2', 'dono', 'garcom', 'garcom', 'gerente']);
  assert.ok(demo.perfis.every((p) => !('segredo' in p)));
});

test('entrada em 1 toque abre a sessão com as permissões do cargo', async () => {
  const ze = await entrarDemo('ze');
  assert.equal(ze.status, 200);
  assert.equal(ze.dados.usuario.inicio, '/cozinha/1');
  const negado = await fetch(`${base}/api/cozinhas/2/tickets`, { headers: { Cookie: ze.cookie } });
  assert.equal(negado.status, 403);
});

test('entrada em 1 toque não vale para usuários reais', async () => {
  const { usuario: dono } = auth.entrar({ usuario: 'dono', segredo: 'frangonete' });
  auth.criarUsuario(dono, { usuario: 'real', nome: 'Real', cargo: 'garcom', segredo: '9876' });
  assert.equal((await entrarDemo('real')).status, 404);
  assert.equal((await entrarDemo('ninguem')).status, 404);
});

test('os perfis também entram pelo PIN/senha de demonstração', () => {
  assert.ok(auth.entrar({ usuario: 'ana', segredo: '1111' }).token);
  assert.ok(auth.entrar({ usuario: 'carla', segredo: 'gerente123' }).token);
});

test('exemplos têm pedidos em todas as etapas, com garçons de verdade', () => {
  store.limpar();
  const mapa = Object.fromEntries(auth.perfisDemo().map((u) => [u.usuario, { id: u.id, nome: u.nome }]));
  popularExemplos(store, mapa);
  const pedidos = store.pedidosRecentes(50);
  const status = new Set(pedidos.flatMap((p) => p.tickets.map((t) => t.status)));
  assert.deepEqual([...status].sort(), ['novo', 'preparo', 'pronto']);
  assert.ok(pedidos.every((p) => p.garcomId), 'todo pedido tem garçom logado');
  const maisAntigo = Math.max(...pedidos.map((p) => (Date.now() - Date.parse(p.criadoEm)) / 60000));
  assert.ok(maisAntigo > 20, 'há pedido atrasado para mostrar o alerta');
});

test('restaurar exige login de dono/gerente e recria os exemplos', async () => {
  assert.equal((await fetch(`${base}/api/demo/restaurar`, { method: 'POST' })).status, 401);
  const ana = await entrarDemo('ana');
  assert.equal((await fetch(`${base}/api/demo/restaurar`, { method: 'POST', headers: { Cookie: ana.cookie } })).status, 403);

  const carla = await entrarDemo('carla');
  await fetch(`${base}/api/pedidos`, {
    method: 'POST',
    headers: { Cookie: carla.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mesa: '99', itens: [{ produtoId: 'p1', qtd: 1 }] }),
  });
  const r = await fetch(`${base}/api/demo/restaurar`, { method: 'POST', headers: { Cookie: carla.cookie } });
  assert.equal(r.status, 200);
  const mesas = store.pedidosRecentes(50).map((p) => p.mesa);
  assert.ok(!mesas.includes('99'));
  assert.equal(store.pedidosRecentes(50).length, 7);
});

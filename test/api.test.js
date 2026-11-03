const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { servidor, auth } = require('../server');

let base;
const sessoes = {}; // cargo -> cookie
const antesDaTroca = {};

async function chamar(metodo, caminho, { quem, corpo } = {}) {
  const res = await fetch(base + caminho, {
    method: metodo,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(quem ? { Cookie: sessoes[quem] } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const tipo = res.headers.get('content-type') || '';
  return { status: res.status, local: res.headers.get('location'), dados: tipo.includes('json') ? await res.json() : null, res };
}

async function entrar(usuario, segredo) {
  const r = await chamar('POST', '/api/entrar', { corpo: { usuario, segredo } });
  assert.equal(r.status, 200, `login de ${usuario}: ${JSON.stringify(r.dados)}`);
  return r.res.headers.get('set-cookie').split(';')[0];
}

test.before(async () => {
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  const senha = auth.garantirDono();
  sessoes.dono = await entrar('dono', senha);
  // Com a senha temporária, tudo fica travado até a troca.
  antesDaTroca.pedidos = (await chamar('GET', '/api/pedidos', { quem: 'dono' })).status;
  antesDaTroca.painel = (await chamar('GET', '/painel.html', { quem: 'dono' })).local;
  antesDaTroca.eu = (await chamar('GET', '/api/eu', { quem: 'dono' })).dados.trocarSegredo;
  await chamar('POST', '/api/eu/segredo', { quem: 'dono', corpo: { atual: senha, novo: 'dono-senha-123' } });

  const criar = (usuario, cargo, segredo) =>
    chamar('POST', '/api/usuarios', { quem: 'dono', corpo: { usuario, nome: usuario, cargo, segredo } });
  await criar('gil', 'gerente', 'gerente-123');
  await criar('ana', 'garcom', '1111');
  await criar('bia', 'garcom', '2222');
  await criar('forno', 'cozinha1', '3333');
  await criar('panela', 'cozinha2', '4444');
  sessoes.gerente = await entrar('gil', 'gerente-123');
  sessoes.ana = await entrar('ana', '1111');
  sessoes.bia = await entrar('bia', '2222');
  sessoes.cozinha1 = await entrar('forno', '3333');
  sessoes.cozinha2 = await entrar('panela', '4444');
});

test.after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

function esperarEvento(caminho, quem, evento = 'ticket', ms = 1500) {
  return new Promise((resolve, reject) => {
    const recebidos = [];
    const req = http.get(base + caminho, { headers: { Cookie: sessoes[quem] } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`stream ${res.statusCode}`));
      let buffer = '';
      res.on('data', (d) => {
        buffer += d;
        for (const m of buffer.matchAll(new RegExp(`event: ${evento}\\ndata: (.*)\\n\\n`, 'g'))) recebidos.push(JSON.parse(m[1]));
        buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    setTimeout(() => { req.destroy(); resolve(recebidos); }, ms);
  });
}

const pedidoMisto = { mesa: '10', itens: [{ produtoId: 'p1', qtd: 1 }, { produtoId: 'm4', qtd: 1 }] };

test('sem login: API responde 401 e páginas mandam para o login', async () => {
  assert.equal((await chamar('GET', '/api/pedidos')).status, 401);
  assert.equal((await chamar('POST', '/api/pedidos', { corpo: pedidoMisto })).status, 401);
  assert.equal((await chamar('GET', '/api/menu')).status, 401);
  const pagina = await chamar('GET', '/cozinha.html?id=1');
  assert.equal(pagina.status, 302);
  assert.equal(pagina.local, '/login.html?volta=%2Fcozinha.html%3Fid%3D1');
  assert.equal((await chamar('GET', '/login.html')).status, 200);
  // /api/info segue público (o deploy confere a versão), mas sem detalhes da rede
  const info = await chamar('GET', '/api/info');
  assert.deepEqual(Object.keys(info.dados).sort(), ['loja', 'versao']);
});

test('login errado não revela se o usuário existe', async () => {
  const a = await chamar('POST', '/api/entrar', { corpo: { usuario: 'ana', segredo: '9999' } });
  const b = await chamar('POST', '/api/entrar', { corpo: { usuario: 'ninguem', segredo: '9999' } });
  assert.equal(a.status, 401);
  assert.deepEqual(a.dados, b.dados);
});

test('cookie de sessão é HttpOnly e SameSite', async () => {
  const r = await chamar('POST', '/api/entrar', { corpo: { usuario: 'ana', segredo: '1111' } });
  const cookie = r.res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test('cada cargo só abre as suas páginas', async () => {
  const casos = [
    ['ana', '/', 200], ['ana', '/cozinha.html?id=1', 302], ['ana', '/painel.html', 302], ['ana', '/usuarios.html', 302],
    ['cozinha1', '/cozinha.html?id=1', 200], ['cozinha1', '/cozinha.html?id=2', 302], ['cozinha1', '/', 302],
    ['cozinha1', '/impressoras.html', 200], ['cozinha2', '/cozinha.html?id=2', 200],
    ['gerente', '/painel.html', 200], ['gerente', '/usuarios.html', 200], ['gerente', '/cozinha.html?id=2', 200],
  ];
  for (const [quem, pagina, esperado] of casos) {
    const r = await chamar('GET', pagina, { quem });
    assert.equal(r.status, esperado, `${quem} em ${pagina}`);
  }
  assert.equal((await chamar('GET', '/painel.html', { quem: 'cozinha1' })).local, '/cozinha/1?negado=1');
});

test('o pedido leva o garçom logado e chega só na cozinha certa', async () => {
  const naCozinha1 = esperarEvento('/api/cozinhas/1/stream', 'cozinha1');
  const naCozinha2 = esperarEvento('/api/cozinhas/2/stream', 'cozinha2');
  await new Promise((r) => setTimeout(r, 100));

  const r = await chamar('POST', '/api/pedidos', { quem: 'ana', corpo: { ...pedidoMisto, garcom: 'Fingindo ser outro' } });
  assert.equal(r.status, 201);
  assert.equal(r.dados.garcom, 'ana');

  const [t1, t2] = [await naCozinha1, await naCozinha2];
  assert.deepEqual([...new Set(t1.map((t) => t.cozinhaId))], [1]);
  assert.deepEqual([...new Set(t2.map((t) => t.cozinhaId))], [2]);
  assert.ok(t2.some((t) => t.itens[0].nome === 'Nhoque ao Sugo'));
});

test('cozinha não lê nem mexe na outra cozinha', async () => {
  assert.equal((await chamar('GET', '/api/cozinhas/2/tickets', { quem: 'cozinha1' })).status, 403);
  const [ticket2] = (await chamar('GET', '/api/cozinhas/2/tickets', { quem: 'cozinha2' })).dados;
  assert.equal((await chamar('PATCH', `/api/tickets/${ticket2.id}`, { quem: 'cozinha1', corpo: { status: 'pronto' } })).status, 403);
  assert.equal((await chamar('POST', `/api/tickets/${ticket2.id}/imprimir`, { quem: 'cozinha1' })).status, 403);
  assert.equal((await chamar('PATCH', `/api/tickets/${ticket2.id}`, { quem: 'cozinha2', corpo: { status: 'preparo' } })).dados.status, 'preparo');
  assert.equal((await chamar('POST', '/api/pedidos', { quem: 'cozinha1', corpo: pedidoMisto })).status, 403);
});

test('garçom vê só os próprios pedidos, inclusive no tempo real', async () => {
  const daBia = esperarEvento('/api/garcom/stream', 'bia', 'pedido');
  await new Promise((r) => setTimeout(r, 100));
  await chamar('POST', '/api/pedidos', { quem: 'ana', corpo: pedidoMisto });
  await chamar('POST', '/api/pedidos', { quem: 'bia', corpo: { mesa: '3', itens: [{ produtoId: 'p2', qtd: 1 }] } });
  const recebidos = await daBia;
  assert.deepEqual(recebidos.map((p) => p.garcom), ['bia']);

  const deAna = (await chamar('GET', '/api/pedidos', { quem: 'ana' })).dados;
  assert.ok(deAna.length >= 2 && deAna.every((p) => p.garcom === 'ana'));
  const doGerente = (await chamar('GET', '/api/pedidos', { quem: 'gerente' })).dados;
  assert.deepEqual([...new Set(doGerente.map((p) => p.garcom))].sort(), ['ana', 'bia']);
});

test('garçom cancela só o seu pedido e só antes da cozinha começar', async () => {
  const novo = (quem) => chamar('POST', '/api/pedidos', { quem, corpo: { mesa: '5', itens: [{ produtoId: 'm1', qtd: 1 }] } }).then((r) => r.dados);
  const daAna = await novo('ana');
  assert.equal((await chamar('POST', `/api/pedidos/${daAna.id}/cancelar`, { quem: 'bia' })).status, 404);

  const emPreparo = await novo('ana');
  await chamar('PATCH', `/api/tickets/${emPreparo.ticketIds[0]}`, { quem: 'cozinha2', corpo: { status: 'preparo' } });
  const negado = await chamar('POST', `/api/pedidos/${emPreparo.id}/cancelar`, { quem: 'ana' });
  assert.equal(negado.status, 403);
  assert.match(negado.dados.erro, /gerente/);
  assert.equal((await chamar('POST', `/api/pedidos/${emPreparo.id}/cancelar`, { quem: 'gerente' })).status, 200);

  assert.equal((await chamar('POST', `/api/pedidos/${daAna.id}/cancelar`, { quem: 'ana' })).dados.cancelado, true);
});

test('faturamento só para o dono', async () => {
  const doDono = (await chamar('GET', '/api/resumo', { quem: 'dono' })).dados;
  const doGerente = (await chamar('GET', '/api/resumo', { quem: 'gerente' })).dados;
  assert.equal(typeof doDono.faturamento, 'number');
  assert.equal(doGerente.faturamento, undefined);
  assert.equal(doGerente.ticketMedio, undefined);
  assert.ok(doGerente.porCozinha);
  assert.equal((await chamar('GET', '/api/resumo', { quem: 'ana' })).status, 403);
});

test('impressoras: cada cozinha vê só a sua e não imprime teste na outra', async () => {
  const daCozinha1 = (await chamar('GET', '/api/impressoras', { quem: 'cozinha1' })).dados;
  assert.deepEqual(daCozinha1.map((i) => i.cozinhaId), [1]);
  assert.equal((await chamar('POST', '/api/impressoras/2/teste', { quem: 'cozinha1' })).status, 403);
  assert.equal((await chamar('POST', '/api/impressoras/1/teste', { quem: 'cozinha1' })).dados.tipo, 'teste');
  assert.deepEqual((await chamar('GET', '/api/impressoras', { quem: 'gerente' })).dados.map((i) => i.cozinhaId), [1, 2]);
  assert.equal((await chamar('GET', '/api/impressoras', { quem: 'ana' })).status, 403);
});

test('gestão de usuários: gerente só a equipe, garçom nada', async () => {
  const lista = (await chamar('GET', '/api/usuarios', { quem: 'gerente' })).dados;
  assert.deepEqual(lista.cargos.map((c) => c.id), ['garcom', 'cozinha1', 'cozinha2']);
  assert.ok(lista.usuarios.every((u) => ['garcom', 'cozinha1', 'cozinha2'].includes(u.cargo)));
  assert.ok(lista.usuarios.every((u) => !('segredo' in u)));
  assert.equal((await chamar('POST', '/api/usuarios', { quem: 'gerente', corpo: { usuario: 'novo', nome: 'N', cargo: 'gerente', segredo: 'senha-123456' } })).status, 403);
  assert.equal((await chamar('GET', '/api/usuarios', { quem: 'ana' })).status, 403);
});

test('desativar o usuário derruba a sessão e o tempo real dele na hora', async () => {
  await chamar('POST', '/api/usuarios', { quem: 'dono', corpo: { usuario: 'temp', nome: 'Temp', cargo: 'cozinha1', segredo: '5555' } });
  sessoes.temp = await entrar('temp', '5555');
  const id = (await chamar('GET', '/api/eu', { quem: 'temp' })).dados.id;

  const fechou = new Promise((resolve) => {
    http.get(base + '/api/cozinhas/1/stream', { headers: { Cookie: sessoes.temp } }, (res) => res.on('end', () => resolve(true)).resume());
  });
  await new Promise((r) => setTimeout(r, 100));
  await chamar('PATCH', `/api/usuarios/${id}`, { quem: 'gerente', corpo: { ativo: false } });
  assert.equal(await Promise.race([fechou, new Promise((r) => setTimeout(() => r(false), 1000))]), true);
  assert.equal((await chamar('GET', '/api/cozinhas/1/tickets', { quem: 'temp' })).status, 401);
});

test('senha temporária do dono bloqueia tudo até ser trocada', async () => {
  assert.equal(antesDaTroca.eu, true);
  assert.equal(antesDaTroca.pedidos, 403);
  assert.equal(antesDaTroca.painel, '/conta.html?primeiro=1');
  // Depois da troca, liberado
  assert.equal((await chamar('GET', '/api/pedidos', { quem: 'dono' })).status, 200);
  assert.equal((await chamar('GET', '/painel.html', { quem: 'dono' })).status, 200);
});

test('sair invalida a sessão', async () => {
  const cookie = await entrar('bia', '2222');
  await fetch(base + '/api/sair', { method: 'POST', headers: { Cookie: cookie } });
  const r = await fetch(base + '/api/eu', { headers: { Cookie: cookie } });
  assert.equal(r.status, 401);
});

test('sem DEMO=1, não existe entrada em 1 toque', async () => {
  assert.deepEqual((await chamar('GET', '/api/demo')).dados, { ativo: false });
  assert.equal((await chamar('POST', '/api/demo/entrar', { corpo: { usuario: 'dono' } })).status, 404);
  assert.equal((await chamar('POST', '/api/demo/restaurar', { quem: 'dono' })).status, 404);
});

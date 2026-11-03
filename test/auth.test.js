const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarAuth, pode, ErroAuth } = require('../src/auth');

function preparar() {
  let relogio = Date.parse('2026-11-03T12:00:00Z');
  const auth = criarAuth({ agora: () => relogio });
  const senhaDono = auth.garantirDono();
  const { usuario: dono } = auth.entrar({ usuario: 'dono', segredo: senhaDono });
  return { auth, dono, senhaDono, avancar: (ms) => (relogio += ms) };
}

test('dono é criado uma vez, com senha temporária que precisa ser trocada', () => {
  const { auth, dono, senhaDono } = preparar();
  assert.equal(senhaDono.length, 12);
  assert.equal(dono.cargo, 'dono');
  assert.equal(dono.trocarSegredo, true);
  assert.equal(auth.garantirDono(), null);
  const atualizado = auth.trocarProprioSegredo(dono, { atual: senhaDono, novo: 'senha-nova-123' });
  assert.equal(atualizado.trocarSegredo, false);
  assert.ok(auth.entrar({ usuario: 'dono', segredo: 'senha-nova-123' }).token);
});

test('garçom e cozinha entram com PIN de 4 dígitos; dono e gerente com senha', () => {
  const { auth, dono } = preparar();
  assert.throws(() => auth.criarUsuario(dono, { usuario: 'ana', nome: 'Ana', cargo: 'garcom', segredo: '12345' }), /PIN/);
  assert.throws(() => auth.criarUsuario(dono, { usuario: 'gil', nome: 'Gil', cargo: 'gerente', segredo: '1234' }), /pelo menos 8/);
  auth.criarUsuario(dono, { usuario: 'ana', nome: 'Ana', cargo: 'garcom', segredo: '4821' });
  const { usuario } = auth.entrar({ usuario: 'ANA ', segredo: '4821' });
  assert.equal(usuario.nome, 'Ana');
  assert.equal(usuario.inicio, '/');
});

test('permissões por cargo', () => {
  const { auth, dono } = preparar();
  const criar = (usuario, cargo, segredo) => {
    auth.criarUsuario(dono, { usuario, nome: usuario, cargo, segredo });
    return auth.entrar({ usuario, segredo }).usuario;
  };
  const gerente = criar('gil', 'gerente', 'gerente-123');
  const garcom = criar('ana', 'garcom', '1111');
  const c1 = criar('forno', 'cozinha1', '2222');

  assert.ok(pode(dono, 'faturamento'));
  assert.ok(!pode(gerente, 'faturamento'));
  assert.ok(pode(gerente, 'cozinha:2'));
  assert.ok(pode(garcom, 'pedido:criar') && !pode(garcom, 'pedido:ver:todos') && !pode(garcom, 'cozinha:1'));
  assert.ok(pode(c1, 'cozinha:1') && !pode(c1, 'cozinha:2') && !pode(c1, 'pedido:criar'));
});

test('gerente gerencia só a equipe; ninguém mexe no dono nem em si mesmo', () => {
  const { auth, dono } = preparar();
  auth.criarUsuario(dono, { usuario: 'gil', nome: 'Gil', cargo: 'gerente', segredo: 'gerente-123' });
  const gerente = auth.entrar({ usuario: 'gil', segredo: 'gerente-123' }).usuario;

  const ana = auth.criarUsuario(gerente, { usuario: 'ana', nome: 'Ana', cargo: 'garcom', segredo: '1111' });
  assert.throws(() => auth.criarUsuario(gerente, { usuario: 'bob', nome: 'Bob', cargo: 'gerente', segredo: 'gerente-456' }), ErroAuth);
  assert.throws(() => auth.criarUsuario(dono, { usuario: 'dono2', nome: 'X', cargo: 'dono', segredo: 'senha-longa-1' }), ErroAuth);
  assert.throws(() => auth.atualizarUsuario(gerente, dono.id, { ativo: false }), ErroAuth);
  assert.throws(() => auth.atualizarUsuario(dono, dono.id, { ativo: false }), /Minha conta/);
  assert.deepEqual(auth.listar(gerente).map((u) => u.usuario), ['ana']);
  assert.deepEqual(auth.listar(dono).map((u) => u.usuario).sort(), ['ana', 'dono', 'gil']);
  assert.throws(() => auth.listar(auth.entrar({ usuario: 'ana', segredo: '1111' }).usuario), ErroAuth);

  // Promover garçom a cozinha mantém o login por PIN; a gerente exigiria senha.
  assert.equal(auth.atualizarUsuario(dono, ana.id, { cargo: 'cozinha2' }).cargo, 'cozinha2');
  assert.throws(() => auth.atualizarUsuario(dono, ana.id, { cargo: 'gerente' }), /defina uma senha/);
});

test('desativar ou trocar o PIN derruba as sessões abertas', () => {
  const { auth, dono } = preparar();
  const ana = auth.criarUsuario(dono, { usuario: 'ana', nome: 'Ana', cargo: 'garcom', segredo: '1111' });
  const { token } = auth.entrar({ usuario: 'ana', segredo: '1111' });
  const revogados = [];
  auth.eventos.on('sessoes:revogadas', (id) => revogados.push(id));

  assert.equal(auth.sessao(token).usuario, 'ana');
  auth.atualizarUsuario(dono, ana.id, { segredo: '9999' });
  assert.equal(auth.sessao(token), null);
  assert.deepEqual(revogados, [ana.id]);

  const novo = auth.entrar({ usuario: 'ana', segredo: '9999' }).token;
  auth.atualizarUsuario(dono, ana.id, { ativo: false });
  assert.equal(auth.sessao(novo), null);
  assert.throws(() => auth.entrar({ usuario: 'ana', segredo: '9999' }), /desativado/);
});

test('bloqueia o usuário após 5 PINs errados e libera após 15 minutos', () => {
  const { auth, dono, avancar } = preparar();
  auth.criarUsuario(dono, { usuario: 'ana', nome: 'Ana', cargo: 'garcom', segredo: '1111' });
  for (let i = 0; i < 5; i++) assert.throws(() => auth.entrar({ usuario: 'ana', segredo: '0000', ip: `10.0.0.${i}` }), /incorretos/);
  assert.throws(() => auth.entrar({ usuario: 'ana', segredo: '1111' }), /bloqueado/);
  avancar(15 * 60 * 1000 + 1);
  assert.ok(auth.entrar({ usuario: 'ana', segredo: '1111' }).token);
});

test('bloqueia o IP após 20 tentativas erradas, mesmo em usuários diferentes', () => {
  const { auth } = preparar();
  for (let i = 0; i < 20; i++) assert.throws(() => auth.entrar({ usuario: `x${i}`, segredo: '0000', ip: '1.2.3.4' }), /incorretos/);
  assert.throws(() => auth.entrar({ usuario: 'dono', segredo: 'qualquer', ip: '1.2.3.4' }), /Aguarde/);
});

test('sessão expira em 30 dias sem uso e é renovada com uso diário', () => {
  const { auth, dono, avancar } = preparar();
  auth.criarUsuario(dono, { usuario: 'ana', nome: 'Ana', cargo: 'garcom', segredo: '1111' });
  const { token } = auth.entrar({ usuario: 'ana', segredo: '1111' });
  for (let dia = 0; dia < 40; dia++) {
    avancar(24 * 60 * 60 * 1000);
    assert.ok(auth.sessao(token), `caiu no dia ${dia}`);
  }
  avancar(31 * 24 * 60 * 60 * 1000);
  assert.equal(auth.sessao(token), null);
});

test('persiste usuários e sessões em disco, sem senhas nem tokens em texto', () => {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auth-')), 'usuarios.json');
  const auth = criarAuth({ arquivo });
  const senha = auth.garantirDono();
  const { token } = auth.entrar({ usuario: 'dono', segredo: senha });

  const conteudo = fs.readFileSync(arquivo, 'utf8');
  assert.ok(!conteudo.includes(senha));
  assert.ok(!conteudo.includes(token));

  const recarregado = criarAuth({ arquivo });
  assert.equal(recarregado.garantirDono(), null);
  assert.equal(recarregado.sessao(token).usuario, 'dono');
});

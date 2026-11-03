// Usuários, cargos, login (senha ou PIN) e sessões.
//
// Senhas e PINs são guardados só como hash scrypt. As sessões são tokens
// aleatórios entregues num cookie HttpOnly; no disco fica apenas o hash do token.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

// ---------- Cargos e permissões ----------
const CARGOS = {
  dono: {
    nome: 'Dono',
    login: 'senha',
    inicio: '/painel',
    permissoes: [
      'pedido:criar', 'pedido:ver:todos', 'pedido:cancelar:todos',
      'cozinha:1', 'cozinha:2', 'impressora:1', 'impressora:2',
      'painel', 'faturamento', 'usuarios:todos',
    ],
  },
  gerente: {
    nome: 'Gerente',
    login: 'senha',
    inicio: '/painel',
    permissoes: [
      'pedido:criar', 'pedido:ver:todos', 'pedido:cancelar:todos',
      'cozinha:1', 'cozinha:2', 'impressora:1', 'impressora:2',
      'painel', 'usuarios:equipe',
    ],
  },
  garcom: {
    nome: 'Garçom',
    login: 'pin',
    inicio: '/',
    permissoes: ['pedido:criar', 'pedido:ver:proprios', 'pedido:cancelar:proprios'],
  },
  cozinha1: { nome: 'Cozinha 1', login: 'pin', inicio: '/cozinha/1', permissoes: ['cozinha:1', 'impressora:1'] },
  cozinha2: { nome: 'Cozinha 2', login: 'pin', inicio: '/cozinha/2', permissoes: ['cozinha:2', 'impressora:2'] },
};

// Cargos que o gerente pode criar e editar ("equipe").
const EQUIPE = ['garcom', 'cozinha1', 'cozinha2'];

const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const RENOVAR_APOS_MS = 24 * 60 * 60 * 1000; // estende a sessão no máximo 1x por dia
const MAX_FALHAS_USUARIO = 5;
const BLOQUEIO_USUARIO_MS = 15 * 60 * 1000;
const MAX_FALHAS_IP = 20;
const JANELA_IP_MS = 15 * 60 * 1000;

class ErroAuth extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

function pode(usuario, permissao) {
  return !!usuario && CARGOS[usuario.cargo].permissoes.includes(permissao);
}

// ---------- Hash de senha/PIN ----------
function gerarHash(segredo) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(segredo), sal, 32);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function confereHash(segredo, armazenado) {
  const [, salHex, hashHex] = String(armazenado).split('$');
  const esperado = Buffer.from(hashHex || '', 'hex');
  const calculado = crypto.scryptSync(String(segredo), Buffer.from(salHex || '', 'hex'), 32);
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
}

// Usado quando o usuário não existe, para a resposta levar o mesmo tempo.
const HASH_FALSO = gerarHash('nao-existe');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// ---------- Validação ----------
function validarSegredo(cargo, segredo) {
  const valor = String(segredo ?? '');
  if (CARGOS[cargo].login === 'pin') {
    if (!/^\d{4}$/.test(valor)) throw new ErroAuth('O PIN deve ter exatamente 4 números.');
  } else if (valor.length < 8) {
    throw new ErroAuth('A senha deve ter pelo menos 8 caracteres.');
  }
  return valor;
}

function validarNome(nome) {
  const valor = String(nome ?? '').trim();
  if (!valor || valor.length > 40) throw new ErroAuth('Informe o nome (até 40 caracteres).');
  return valor;
}

function senhaAleatoria() {
  // Sem caracteres ambíguos (0/O, 1/l/I) para ser fácil de digitar.
  const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(12), (b) => alfabeto[b % alfabeto.length]).join('');
}

// ---------- Serviço ----------
function criarAuth({ arquivo = null, agora = () => Date.now() } = {}) {
  const eventos = new EventEmitter();
  let usuarios = [];
  let sessoes = []; // { hash, usuarioId, criadaEm, expiraEm }
  let proximoId = 1;
  const falhasPorIp = new Map(); // ip -> { qtd, desde }

  if (arquivo && fs.existsSync(arquivo)) {
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    usuarios = dados.usuarios || [];
    sessoes = dados.sessoes || [];
    proximoId = dados.proximoId || usuarios.length + 1;
  }

  function salvar() {
    if (!arquivo) return;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const temporario = `${arquivo}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify({ proximoId, usuarios, sessoes }), { mode: 0o600 });
    fs.renameSync(temporario, arquivo);
  }

  // O que pode sair do servidor sobre um usuário (nunca o hash).
  function publico(u) {
    const cargo = CARGOS[u.cargo];
    return {
      id: u.id,
      usuario: u.usuario,
      nome: u.nome,
      cargo: u.cargo,
      cargoNome: cargo.nome,
      login: cargo.login,
      ativo: u.ativo,
      trocarSegredo: !!u.trocarSegredo,
      ultimoAcesso: u.ultimoAcesso || null,
      criadoEm: u.criadoEm,
    };
  }

  function daSessao(u) {
    return { ...publico(u), permissoes: CARGOS[u.cargo].permissoes, inicio: CARGOS[u.cargo].inicio };
  }

  const buscar = (id) => usuarios.find((u) => u.id === Number(id)) || null;
  const buscarPorLogin = (usuario) =>
    usuarios.find((u) => u.usuario === String(usuario ?? '').trim().toLowerCase()) || null;

  // Cria o dono no primeiro uso. Devolve a senha temporária (ou null se já existe).
  function garantirDono() {
    if (usuarios.some((u) => u.cargo === 'dono')) return null;
    const senha = senhaAleatoria();
    usuarios.push({
      id: proximoId++,
      usuario: 'dono',
      nome: 'Dono',
      cargo: 'dono',
      segredo: gerarHash(senha),
      trocarSegredo: true,
      ativo: true,
      criadoEm: new Date(agora()).toISOString(),
    });
    salvar();
    return senha;
  }

  // ---------- Modo demonstração ----------
  // Cria (ou restaura) os perfis de demonstração com segredos conhecidos.
  // Só perfis marcados como demo aceitam a entrada sem segredo.
  function prepararDemo(perfis) {
    for (const p of perfis) {
      let u = buscarPorLogin(p.usuario);
      if (!u) {
        u = { id: proximoId++, usuario: p.usuario, criadoEm: new Date(agora()).toISOString() };
        usuarios.push(u);
      }
      Object.assign(u, {
        nome: p.nome,
        cargo: p.cargo,
        segredo: gerarHash(p.segredo),
        trocarSegredo: false,
        ativo: true,
        demo: true,
        falhas: 0,
        bloqueadoAte: null,
      });
    }
    salvar();
  }

  function perfisDemo() {
    return usuarios.filter((u) => u.demo && u.ativo).map(publico);
  }

  function entrarDemo(login) {
    const u = buscarPorLogin(login);
    if (!u || !u.demo || !u.ativo) throw new ErroAuth('Perfil de demonstração não encontrado.', 404);
    u.ultimoAcesso = new Date(agora()).toISOString();
    const token = crypto.randomBytes(32).toString('base64url');
    sessoes.push({ hash: hashToken(token), usuarioId: u.id, criadaEm: agora(), expiraEm: agora() + DURACAO_SESSAO_MS });
    salvar();
    return { token, usuario: daSessao(u) };
  }

  // ---------- Login e sessões ----------
  function limiteIp(ip) {
    const registro = falhasPorIp.get(ip);
    if (registro && agora() - registro.desde > JANELA_IP_MS) falhasPorIp.delete(ip);
    const atual = falhasPorIp.get(ip);
    if (atual && atual.qtd >= MAX_FALHAS_IP) {
      throw new ErroAuth('Muitas tentativas erradas deste aparelho. Aguarde 15 minutos.', 429);
    }
  }

  function registrarFalhaIp(ip) {
    const atual = falhasPorIp.get(ip) || { qtd: 0, desde: agora() };
    atual.qtd++;
    falhasPorIp.set(ip, atual);
  }

  function entrar({ usuario, segredo, ip = 'desconhecido' }) {
    limiteIp(ip);
    const u = buscarPorLogin(usuario);
    const erro = new ErroAuth('Usuário, senha ou PIN incorretos.', 401);

    if (!u) {
      confereHash(String(segredo ?? ''), HASH_FALSO);
      registrarFalhaIp(ip);
      throw erro;
    }
    if (u.bloqueadoAte && u.bloqueadoAte > agora()) {
      const minutos = Math.ceil((u.bloqueadoAte - agora()) / 60000);
      throw new ErroAuth(`Usuário bloqueado por tentativas erradas. Tente em ${minutos} min.`, 429);
    }
    if (!confereHash(String(segredo ?? ''), u.segredo)) {
      registrarFalhaIp(ip);
      u.falhas = (u.falhas || 0) + 1;
      if (u.falhas >= MAX_FALHAS_USUARIO) {
        u.bloqueadoAte = agora() + BLOQUEIO_USUARIO_MS;
        u.falhas = 0;
      }
      salvar();
      throw erro;
    }
    if (!u.ativo) throw new ErroAuth('Este usuário está desativado.', 403);

    u.falhas = 0;
    u.bloqueadoAte = null;
    u.ultimoAcesso = new Date(agora()).toISOString();
    const token = crypto.randomBytes(32).toString('base64url');
    sessoes.push({ hash: hashToken(token), usuarioId: u.id, criadaEm: agora(), expiraEm: agora() + DURACAO_SESSAO_MS });
    salvar();
    return { token, usuario: daSessao(u) };
  }

  function sessao(token) {
    if (!token) return null;
    const hash = hashToken(token);
    const s = sessoes.find((x) => x.hash === hash);
    if (!s) return null;
    const u = buscar(s.usuarioId);
    if (!u || !u.ativo || s.expiraEm < agora()) {
      sessoes = sessoes.filter((x) => x !== s);
      salvar();
      return null;
    }
    // Sessão deslizante: quem usa todo dia nunca precisa logar de novo.
    if (s.expiraEm - agora() < DURACAO_SESSAO_MS - RENOVAR_APOS_MS) {
      s.expiraEm = agora() + DURACAO_SESSAO_MS;
      salvar();
    }
    return daSessao(u);
  }

  function sair(token) {
    if (!token) return;
    const hash = hashToken(token);
    sessoes = sessoes.filter((s) => s.hash !== hash);
    salvar();
  }

  function revogarSessoes(usuarioId) {
    sessoes = sessoes.filter((s) => s.usuarioId !== usuarioId);
    eventos.emit('sessoes:revogadas', usuarioId);
  }

  // ---------- Gestão de usuários ----------
  function podeGerenciar(ator, cargoAlvo) {
    if (pode(ator, 'usuarios:todos')) return cargoAlvo !== 'dono';
    if (pode(ator, 'usuarios:equipe')) return EQUIPE.includes(cargoAlvo);
    return false;
  }

  function cargosCriaveis(ator) {
    return Object.keys(CARGOS).filter((c) => podeGerenciar(ator, c));
  }

  function listar(ator) {
    if (!pode(ator, 'usuarios:todos') && !pode(ator, 'usuarios:equipe')) throw new ErroAuth('Sem permissão.', 403);
    return usuarios
      .filter((u) => pode(ator, 'usuarios:todos') || EQUIPE.includes(u.cargo))
      .map(publico);
  }

  function criarUsuario(ator, dados) {
    const cargo = String(dados.cargo || '');
    if (!CARGOS[cargo]) throw new ErroAuth('Cargo inválido.');
    if (!podeGerenciar(ator, cargo)) throw new ErroAuth('Você não pode criar usuários com este cargo.', 403);
    const login = String(dados.usuario ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(login)) {
      throw new ErroAuth('Usuário: 3 a 30 caracteres, só letras minúsculas, números, ponto, hífen ou _.');
    }
    if (buscarPorLogin(login)) throw new ErroAuth('Já existe um usuário com esse login.');

    const u = {
      id: proximoId++,
      usuario: login,
      nome: validarNome(dados.nome),
      cargo,
      segredo: gerarHash(validarSegredo(cargo, dados.segredo)),
      trocarSegredo: false,
      ativo: true,
      criadoEm: new Date(agora()).toISOString(),
    };
    usuarios.push(u);
    salvar();
    return publico(u);
  }

  function atualizarUsuario(ator, id, dados) {
    const u = buscar(id);
    if (!u) throw new ErroAuth('Usuário não encontrado.', 404);
    if (u.id === ator.id) throw new ErroAuth('Para alterar sua própria conta, use "Minha conta".', 403);
    if (!podeGerenciar(ator, u.cargo)) throw new ErroAuth('Você não pode alterar este usuário.', 403);

    let revogar = false;
    if (dados.nome !== undefined) u.nome = validarNome(dados.nome);
    if (dados.cargo !== undefined && dados.cargo !== u.cargo) {
      if (!CARGOS[dados.cargo] || !podeGerenciar(ator, dados.cargo)) throw new ErroAuth('Cargo inválido.', 403);
      // Trocar entre senha e PIN exige um segredo novo.
      if (CARGOS[dados.cargo].login !== CARGOS[u.cargo].login && dados.segredo === undefined) {
        throw new ErroAuth(`Ao mudar para ${CARGOS[dados.cargo].nome}, defina ${CARGOS[dados.cargo].login === 'pin' ? 'um PIN' : 'uma senha'}.`);
      }
      u.cargo = dados.cargo;
      revogar = true;
    }
    if (dados.segredo !== undefined) {
      u.segredo = gerarHash(validarSegredo(u.cargo, dados.segredo));
      u.trocarSegredo = false;
      u.falhas = 0;
      u.bloqueadoAte = null;
      revogar = true;
    }
    if (dados.ativo !== undefined) {
      u.ativo = !!dados.ativo;
      if (!u.ativo) revogar = true;
    }
    if (revogar) revogarSessoes(u.id);
    salvar();
    return publico(u);
  }

  function trocarProprioSegredo(ator, { atual, novo }) {
    const u = buscar(ator.id);
    if (!confereHash(String(atual ?? ''), u.segredo)) throw new ErroAuth(`${CARGOS[u.cargo].login === 'pin' ? 'PIN' : 'Senha'} atual incorreto(a).`, 401);
    if (String(novo) === String(atual)) throw new ErroAuth('O novo valor deve ser diferente do atual.');
    u.segredo = gerarHash(validarSegredo(u.cargo, novo));
    u.trocarSegredo = false;
    salvar();
    return daSessao(u);
  }

  return {
    eventos,
    garantirDono,
    prepararDemo,
    perfisDemo,
    entrarDemo,
    entrar,
    sessao,
    sair,
    listar,
    criarUsuario,
    atualizarUsuario,
    trocarProprioSegredo,
    cargosCriaveis,
  };
}

module.exports = { criarAuth, pode, CARGOS, EQUIPE, ErroAuth };

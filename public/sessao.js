// Sessão nas telas: quem está logado, menu com as telas do cargo, botão Sair
// e redirecionamento para o login quando a sessão cai.
// As permissões valem de fato no servidor; aqui só se adapta a interface.

const Sessao = (() => {
  let usuario = null;
  let demo = false;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nuncaResolve = () => new Promise(() => {});

  const TELAS = [
    { rotulo: 'Painel', url: '/painel', perm: ['painel'] },
    { rotulo: 'Novo pedido (garçom)', url: '/', perm: ['pedido:criar'] },
    { rotulo: 'Cozinha 1 · Pizzas', url: '/cozinha/1', perm: ['cozinha:1'] },
    { rotulo: 'Cozinha 2 · Massas', url: '/cozinha/2', perm: ['cozinha:2'] },
    { rotulo: 'Impressoras', url: '/impressoras', perm: ['impressora:1', 'impressora:2'] },
    { rotulo: 'Usuários', url: '/usuarios', perm: ['usuarios:todos', 'usuarios:equipe'] },
  ];

  function pode(...permissoes) {
    return !!usuario && permissoes.some((p) => usuario.permissoes.includes(p));
  }

  function irParaLogin() {
    location.href = `/login.html?volta=${encodeURIComponent(location.pathname + location.search)}`;
  }

  async function carregar() {
    let res;
    try {
      res = await fetch('/api/eu');
    } catch {
      avisar('Sem conexão com o servidor.');
      return nuncaResolve();
    }
    if (res.status === 401) {
      irParaLogin();
      return nuncaResolve();
    }
    usuario = await res.json();
    demo = await fetch('/api/demo').then((r) => r.json()).then((d) => d.ativo).catch(() => false);
    if (usuario.trocarSegredo && location.pathname !== '/conta.html') {
      location.href = '/conta.html?primeiro=1';
      return nuncaResolve();
    }
    montarCracha();
    const params = new URLSearchParams(location.search);
    if (params.has('negado')) {
      avisar('Seu cargo não tem acesso àquela tela.');
      params.delete('negado');
      history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : ''));
    }
    return usuario;
  }

  // fetch que manda para o login se a sessão tiver caído.
  async function api(url, opcoes = {}) {
    const res = await fetch(url, {
      ...opcoes,
      headers: { ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}), ...(opcoes.headers || {}) },
    });
    if (res.status === 401) {
      irParaLogin();
      return nuncaResolve();
    }
    return res;
  }

  // Tempo real: se a conexão cair porque a sessão acabou (ex.: usuário desativado), vai ao login.
  function vigiar(fonte) {
    // Demonstração restaurada: todas as telas abertas recarregam com os exemplos novos.
    fonte.addEventListener('recarregar', () => location.reload());
    fonte.addEventListener('error', async () => {
      const r = await fetch('/api/eu').catch(() => null);
      if (r && r.status === 401) irParaLogin();
    });
    return fonte;
  }

  async function sair() {
    await fetch('/api/sair', { method: 'POST' }).catch(() => {});
    location.href = '/login.html';
  }

  function montarCracha() {
    const alvo = document.getElementById('sessao');
    if (!alvo) return;
    const telas = TELAS.filter((t) => pode(...t.perm));
    const atual = location.pathname.replace(/\.html$/, '').replace(/^\/index$/, '/');
    const iniciais = usuario.nome.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    alvo.innerHTML = `
      <details class="cracha">
        <summary title="${esc(usuario.nome)} · ${esc(usuario.cargoNome)}">
          <span class="cracha-avatar">${esc(iniciais)}</span>
          <span class="cracha-texto"><b>${esc(usuario.nome)}</b><small>${esc(usuario.cargoNome)}</small></span>
        </summary>
        <div class="cracha-menu">
          ${telas.length > 1 ? `<div class="cracha-secao">Ir para</div>${telas.map((t) => `
            <a href="${t.url}" class="${atual === t.url || location.pathname + location.search === `/cozinha.html?id=${t.url.slice(-1)}` ? 'atual' : ''}">${esc(t.rotulo)}</a>`).join('')}<hr>` : ''}
          <a href="/conta.html">Minha conta</a>
          <button type="button" data-restaurar hidden>Restaurar pedidos de exemplo</button>
          <button type="button" data-sair>${demo ? 'Trocar de perfil' : 'Sair'}</button>
        </div>
      </details>`;
    alvo.querySelector('[data-sair]').addEventListener('click', sair);
    document.querySelectorAll('a.logo').forEach((a) => (a.href = usuario.inicio));
    if (demo) {
      const restaurar = alvo.querySelector('[data-restaurar]');
      restaurar.hidden = !pode('painel');
      restaurar.addEventListener('click', async () => {
        restaurar.disabled = true;
        await api('/api/demo/restaurar', { method: 'POST' });
        location.reload();
      });
    }
    document.addEventListener('click', (e) => {
      const menu = alvo.querySelector('.cracha');
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
  }

  let timerAviso;
  function avisar(texto) {
    let el = document.getElementById('sessao-aviso');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sessao-aviso';
      el.className = 'sessao-aviso';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = texto;
    el.hidden = false;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => (el.hidden = true), 4000);
  }

  return {
    carregar,
    pode,
    api,
    vigiar,
    sair,
    avisar,
    get usuario() {
      return usuario;
    },
  };
})();

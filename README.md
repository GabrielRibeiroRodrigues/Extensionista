# Frangonete – Pedidos para as cozinhas

O garçom faz o pedido no celular. O sistema separa os itens por cozinha, mostra cada parte na tela da cozinha certa e imprime na impressora dela.

| Categoria    | Destino                              |
|--------------|--------------------------------------|
| Pizzas       | **Cozinha 1** (tela + impressora 1)  |
| Pizzas Doces | **Cozinha 1**                        |
| Massas       | **Cozinha 2** (tela + impressora 2)  |
| Bebidas      | Balcão (não vai para cozinha)        |

O cardápio é mockado em `src/menu.js`. Nesse mesmo arquivo ficam o nome da loja, os tamanhos de pizza e a cozinha de cada categoria.

## Rodar

Requer Node.js 18 ou superior. Não há dependências para instalar.

```bash
npm start
```

**Primeiro acesso:** o terminal mostra o usuário `dono` e uma **senha temporária**. Entre em `http://localhost:3000/login`, aba *Dono · Gerente*, e defina uma senha nova (obrigatório). Depois, em **Usuários**, crie a equipe.

| Tela | Endereço | Onde usar |
|------|----------|-----------|
| Entrar | `http://IP:3000/login` | Qualquer aparelho; cada um cai na sua tela |
| Garçom | `http://IP:3000/` | Celular. Dá para "Adicionar à tela inicial" |
| Cozinha 1 · Pizzas | `http://IP:3000/cozinha/1` | TV ou monitor da cozinha |
| Cozinha 2 · Massas | `http://IP:3000/cozinha/2` | TV ou monitor da cozinha |
| Impressoras | `http://IP:3000/impressoras` | Simulação das impressoras térmicas |
| Painel | `http://IP:3000/painel` | Dono e gerente |
| Usuários | `http://IP:3000/usuarios` | Dono e gerente |

O celular precisa estar no mesmo Wi-Fi do computador que roda o servidor. Se o Windows perguntar sobre o firewall, permita o Node.js em redes privadas.

## Cargos e acesso

| | Dono | Gerente | Garçom | Cozinha 1 | Cozinha 2 |
|---|:-:|:-:|:-:|:-:|:-:|
| Entra com | senha | senha | PIN | PIN | PIN |
| Fazer pedidos | ✓ | ✓ | ✓ | – | – |
| Acompanhar pedidos | todos | todos | só os seus | – | – |
| Cancelar pedido | qualquer | qualquer | os seus, antes de a cozinha começar | – | – |
| Tela Cozinha 1 | ✓ | ✓ | – | ✓ | – |
| Tela Cozinha 2 | ✓ | ✓ | – | – | ✓ |
| Impressoras | as 2 | as 2 | – | a 1 | a 2 |
| Painel | ✓ | ✓ | – | – | – |
| Faturamento e ticket médio | ✓ | – | – | – | – |
| Gerenciar usuários | todos (menos outro dono) | garçons e cozinhas | – | – | – |

- **As permissões valem no servidor**, em cada rota da API, em cada página e no tempo real. Esconder um botão é só conforto: um garçom não recebe nem pela conexão ao vivo os pedidos dos colegas, e a Cozinha 1 não recebe nada da Cozinha 2.
- **PIN** de 4 números para garçom e cozinhas. O aparelho lembra o usuário, e a sessão dura 30 dias, renovada com o uso. A TV da cozinha não precisa logar de novo.
- **Bloqueio:** 5 erros seguidos travam o usuário por 15 minutos, e 20 erros vindos do mesmo aparelho travam o aparelho por 15 minutos.
- **Senhas e PINs** são guardados só como hash (scrypt), e as sessões só como hash do token. Tudo fica em `dados/usuarios.json`.
- **Desativar** um usuário, trocar o PIN dele ou mudar o cargo derruba na hora as telas abertas por ele.
- O pedido registra **o garçom logado**. Não dá para fazer pedido em nome de outro.
- Cada pessoa troca a própria senha ou PIN em **Minha conta**, no menu do crachá.

**Esqueceu a senha do dono?** Com o servidor parado, apague `dados/usuarios.json` e inicie de novo. Um dono novo é criado com outra senha temporária, mas os demais usuários também são apagados. Na VPS: `docker exec pizzaria-app rm /dados/usuarios.json && docker restart pizzaria-app` e depois `docker logs pizzaria-app`.

## Funcionalidades

**Garçom (celular)**
- Pedido do tipo **Mesa**, **Balcão** ou **Delivery**.
- Pizzas em Broto/Média/Grande. Meio a meio cobra o sabor mais caro.
- Observação por item, busca no cardápio e revisão agrupada pela cozinha de destino.
- Tela "Acompanhar": status de cada cozinha em tempo real, aviso (com vibração) quando fica pronto e cancelamento de pedido.

**Cozinhas**
- Cada cozinha vê só os seus itens, com alerta sonoro, cronômetro e destaque após 20 minutos.
- Botões **Iniciar** e **Pronto**. Tocar num pedido pronto o devolve para o preparo.
- Delivery aparece com a faixa "embalar para viagem".
- Pedido cancelado gera um alerta na tela e sai da fila.

**Impressão**
- Todo pedido novo é impresso na impressora da cozinha. Também saem um comprovante de cancelamento e uma página de teste.
- Na tela **Impressoras**, o papel sai linha a linha, exatamente como na impressora térmica. A tela também tem o histórico e o botão "Imprimir teste".

**Dados**
- Os pedidos ficam salvos em `dados/pedidos.json` e voltam quando o servidor reinicia.

## Impressoras de verdade

Sem configuração, as impressoras são **simuladas**: aparecem na tela `/impressoras` e ficam registradas em `impressoes/cozinha-N.txt`.

### Impressora térmica de rede (ESC/POS, porta 9100)

Informe o IP de cada impressora:

```powershell
$env:IMPRESSORA_COZINHA_1="192.168.0.50"; $env:IMPRESSORA_COZINHA_2="192.168.0.51:9100"; npm start
```

O ticket sai com fonte grande, negrito e corte automático do papel. Se a impressora não responder, a cozinha vê **"Falha na impressora"** no card e o garçom vê **"Não impresso"**. O botão **Reimprimir** tenta de novo.

### Impressora USB ligada ao PC da cozinha

Na tela da cozinha, marque **"Imprimir neste PC"**. Cada pedido novo abre a impressão do navegador, formatada para papel de 80mm. Para imprimir sem a janela de confirmação:

```
msedge --kiosk --kiosk-printing http://IP:3000/cozinha/1
```

## Publicação na VPS

O sistema roda em Docker na VPS como um projeto isolado (`pizzaria`), com container, rede e volume próprios. Ele usa a porta **8080** e não mexe nos outros serviços do servidor, que ficam nas portas 80 e 443.

- Painel: `http://187.41.102.56:8080/painel`
- Garçom: `http://187.41.102.56:8080/`

### CI/CD (GitHub Actions)

O workflow `.github/workflows/ci-cd.yml` faz o seguinte:

- **Push ou pull request para a `main`:** roda os testes, builda a imagem Docker e confere se o container sobe.
- **Push na `main` com tudo verde:** publica na VPS e confere se `/api/info` responde com o commit novo (`versao`). Se não responder, o job falha.

Deploys não rodam em paralelo: um push novo espera o anterior terminar. Também dá para disparar manualmente na aba *Actions* (*Run workflow*).

Configuração no GitHub (*Settings → Secrets and variables → Actions*):

| Nome | Tipo | Conteúdo |
|------|------|----------|
| `VPS_SSH_KEY` | secret | chave privada exclusiva do deploy |
| `VPS_KNOWN_HOSTS` | secret | impressão digital SSH da VPS (protege contra servidor falso) |
| `VPS_HOST` | variável | IP da VPS |

Na VPS, essa chave está no `authorized_keys` do root com `command="/opt/pizzaria-deploy/receber.sh",restrict`. Ela só consegue executar esse script, que recebe o código e atualiza o container `pizzaria-app`. Não abre terminal, não faz túnel e não roda outros comandos. Se `deploy/receber.sh` mudar no repositório, reinstale o script na VPS:

```bash
ssh root@187.41.102.56 "cat > /opt/pizzaria-deploy/receber.sh" < deploy/receber.sh
```

Para trocar a chave: gere outra (`ssh-keygen -t ed25519 -C github-actions-pizzaria`), substitua a linha `github-actions-pizzaria` no `authorized_keys` da VPS e atualize o secret `VPS_SSH_KEY`.

### Deploy manual

Sem passar pelo GitHub, com a sua própria chave SSH (no Git Bash):

```bash
./deploy.sh
```

O deploy manual usa o mesmo script receptor da VPS. Os pedidos ficam no volume `pizzaria_dados` e são mantidos entre deploys.

Comandos úteis na VPS:

```bash
docker logs -f pizzaria-app                                   # logs
docker restart pizzaria-app                                   # reiniciar
docker exec pizzaria-app rm /dados/pedidos.json && docker restart pizzaria-app   # zerar os pedidos
```

Na VPS, as impressoras de rede da pizzaria não são alcançáveis, porque estão na rede local dela. Lá a impressão fica no modo simulado (tela `/impressoras`) ou usa a opção "Imprimir neste PC" na tela da cozinha.

## Configuração

| Variável | Padrão | Uso |
|----------|--------|-----|
| `PORT` | `3000` | Porta do servidor |
| `IMPRESSORA_COZINHA_N` | – | `ip[:porta]` da impressora da cozinha N |
| `ARQUIVO_DADOS` | `dados/pedidos.json` | Onde os pedidos são salvos |
| `SEM_EXEMPLOS` | – | `1` para não criar pedidos de exemplo no primeiro uso |

Para começar um dia do zero, apague a pasta `dados/` com o servidor parado.

## API

| Método | Rota | Uso |
|--------|------|-----|
| GET    | `/api/menu` | Cardápio, tamanhos, categorias e cozinhas |
| POST   | `/api/pedidos` | `{ tipo, mesa, garcom, itens: [{ produtoId, tamanho, metadeId, qtd, obs }] }` |
| GET    | `/api/pedidos` | Pedidos recentes com o status por cozinha |
| POST   | `/api/pedidos/:id/cancelar` | Cancela o pedido em todas as cozinhas |
| GET    | `/api/cozinhas/:id/tickets` | Tickets da cozinha |
| PATCH  | `/api/tickets/:id` | `{ status: "novo" \| "preparo" \| "pronto" }` |
| POST   | `/api/tickets/:id/imprimir` | Reimprime o ticket |
| GET    | `/api/impressoras` | Estado e histórico das impressoras |
| POST   | `/api/impressoras/:id/teste` | Imprime a página de teste |
| GET    | `/api/resumo` | Pedidos, faturamento e fila por cozinha |
| GET    | `/api/info` | Público: loja e versão. Logado: também porta e IPs da rede |
| POST   | `/api/entrar` | `{ usuario, segredo }` (senha ou PIN); grava o cookie de sessão |
| POST   | `/api/sair` | Encerra a sessão |
| GET    | `/api/eu` | Usuário logado e permissões |
| POST   | `/api/eu/segredo` | `{ atual, novo }` troca a própria senha/PIN |
| GET/POST | `/api/usuarios` | Lista e cria usuários (dono e gerente) |
| PATCH  | `/api/usuarios/:id` | `{ nome, cargo, segredo, ativo }` |

Tempo real via Server-Sent Events: `/api/cozinhas/:id/stream`, `/api/garcom/stream` e `/api/impressoras/stream`.

## Estrutura

```
server.js            HTTP, rotas, tempo real e fila de impressão
src/menu.js          cardápio mockado, tamanhos e cozinha de cada categoria
src/store.js         pedidos, divisão por cozinha, status e cancelamento
src/impressora.js    layout do ticket, ESC/POS e envio para a impressora
src/persistencia.js  salvar/carregar os pedidos em disco
src/auth.js          cargos, permissões, login (senha/PIN) e sessões
public/              telas: login, garçom, cozinha, impressoras, painel, usuários e conta
test/                testes (npm test)
```

## Testes

```bash
npm test
```

## Limitações

- **Na VPS o acesso é por HTTP, sem HTTPS** (não há domínio). Senhas, PINs e o cookie de sessão viajam sem criptografia: alguém na mesma rede Wi-Fi pública conseguiria capturá-los. Com um domínio apontando para a VPS, dá para colocar HTTPS e usar `COOKIE_SEGURO=1`.
- Não há pagamento nem fechamento de conta.
- Os acentos são removidos no papel, porque muitas impressoras térmicas não imprimem acentos corretamente.

# Bella Massa – Pedidos para as cozinhas

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

Abra o **painel** em `http://localhost:3000/painel`. Ele mostra o resumo do movimento e os links de todas as telas, já com o IP do Wi-Fi para abrir no celular.

| Tela | Endereço | Onde usar |
|------|----------|-----------|
| Garçom | `http://IP:3000/` | Celular. Dá para "Adicionar à tela inicial" |
| Cozinha 1 · Pizzas | `http://IP:3000/cozinha/1` | TV ou monitor da cozinha |
| Cozinha 2 · Massas | `http://IP:3000/cozinha/2` | TV ou monitor da cozinha |
| Impressoras | `http://IP:3000/impressoras` | Simulação das impressoras térmicas |
| Painel | `http://IP:3000/painel` | Gerente / caixa |

O celular precisa estar no mesmo Wi-Fi do computador que roda o servidor. Se o Windows perguntar sobre o firewall, permita o Node.js em redes privadas.

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
| GET    | `/api/info` | Nome da loja, porta e IPs da rede |

Tempo real via Server-Sent Events: `/api/cozinhas/:id/stream`, `/api/garcom/stream` e `/api/impressoras/stream`.

## Estrutura

```
server.js            HTTP, rotas, tempo real e fila de impressão
src/menu.js          cardápio mockado, tamanhos e cozinha de cada categoria
src/store.js         pedidos, divisão por cozinha, status e cancelamento
src/impressora.js    layout do ticket, ESC/POS e envio para a impressora
src/persistencia.js  salvar/carregar os pedidos em disco
public/              telas: garçom, cozinha, impressoras e painel
test/                testes (npm test)
```

## Testes

```bash
npm test
```

## Limitações

- Não há login: qualquer pessoa na rede pode abrir as telas.
- Não há pagamento nem fechamento de conta.
- Os acentos são removidos no papel, porque muitas impressoras térmicas não imprimem acentos corretamente.

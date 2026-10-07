# Pizzaria – Pedidos para as cozinhas

O garçom faz o pedido no celular. O sistema separa os itens por cozinha, mostra cada parte na tela da cozinha certa e imprime na impressora dela.

| Categoria    | Destino                      |
|--------------|------------------------------|
| Pizzas       | **Cozinha 1** (tela + impressora 1) |
| Pizzas Doces | **Cozinha 1**                |
| Massas       | **Cozinha 2** (tela + impressora 2) |
| Bebidas      | Balcão (não vai para cozinha) |

Para mudar o que vai para cada cozinha, edite `cozinha` em `src/menu.js`. O cardápio é mockado nesse mesmo arquivo.

## Rodar

Requer Node.js 18 ou superior. Não há dependências para instalar.

```bash
npm start
```

O terminal mostra os endereços. Use o IP da rede local, por exemplo:

- **Celular do garçom:** `http://192.168.0.10:3000/` (dá para "Adicionar à tela inicial")
- **Tela da Cozinha 1:** `http://192.168.0.10:3000/cozinha/1`
- **Tela da Cozinha 2:** `http://192.168.0.10:3000/cozinha/2`

Celulares e telas precisam estar na mesma rede Wi-Fi do computador que roda o servidor. Ao abrir a tela da cozinha, toque no botão para liberar o som de novos pedidos.

Ao iniciar, o sistema carrega três pedidos de exemplo. Para começar vazio, use `SEM_EXEMPLOS=1 npm start`.

## Impressão

Há duas formas, e elas podem ser usadas juntas.

### 1. Impressora térmica de rede (recomendado)

O servidor envia o ticket direto para a impressora (ESC/POS, porta 9100), com corte de papel. Informe o IP de cada impressora:

```bash
IMPRESSORA_COZINHA_1=192.168.0.50:9100 IMPRESSORA_COZINHA_2=192.168.0.51 npm start
```

No Windows (PowerShell):

```powershell
$env:IMPRESSORA_COZINHA_1="192.168.0.50"; $env:IMPRESSORA_COZINHA_2="192.168.0.51"; npm start
```

Sem essas variáveis, a impressão é **simulada**: o ticket vai para `impressoes/cozinha-N.txt` e aparece no terminal. Se a impressora falhar, o card na tela mostra **"Falha na impressora!"**, e o botão 🖨 reimprime.

### 2. Impressora USB ligada ao PC da cozinha

Na tela da cozinha, marque **"Imprimir neste PC"**. Cada pedido novo abre a impressão do navegador, já formatada para papel de 80mm. Para imprimir sem a janela de confirmação, abra o Chrome ou o Edge em modo quiosque:

```
chrome --kiosk --kiosk-printing http://192.168.0.10:3000/cozinha/1
```

## API

| Método | Rota | Uso |
|--------|------|-----|
| GET    | `/api/menu` | Cardápio, categorias e cozinhas |
| POST   | `/api/pedidos` | `{ mesa, garcom, itens: [{ produtoId, qtd, obs }] }` |
| GET    | `/api/pedidos` | Pedidos recentes com o status por cozinha |
| GET    | `/api/cozinhas/:id/tickets` | Tickets da cozinha |
| GET    | `/api/cozinhas/:id/stream` | Tempo real (Server-Sent Events) |
| PATCH  | `/api/tickets/:id` | `{ status: "novo" \| "preparo" \| "pronto" }` |
| POST   | `/api/tickets/:id/imprimir` | Reimprime o ticket |

## Testes

```bash
npm test
```

## Limitações (protótipo)

- Os pedidos ficam em memória e são perdidos quando o servidor reinicia.
- Não há login.
- Não há pagamento nem fechamento de conta.

#!/usr/bin/env bash
# Roda NA VPS. Recebe o código (tar pela entrada padrão) e publica a pizzaria.
#
# É o único comando que a chave SSH do GitHub Actions pode executar
# (command= no authorized_keys), então a chave não serve para mais nada.
#
# Uso: tar ... | ssh root@vps /opt/pizzaria-deploy/receber.sh <commit>
#      (com a chave restrita, o <commit> chega em SSH_ORIGINAL_COMMAND)
set -euo pipefail

PASTA=/opt/pizzaria

# Só aceita um hash de commit; qualquer outra coisa é descartada.
VERSAO="${1:-${SSH_ORIGINAL_COMMAND:-}}"
VERSAO="$(printf '%s' "$VERSAO" | tr -cd '0-9a-f' | cut -c1-40)"
[ -n "$VERSAO" ] || VERSAO=desconhecida

# Um deploy por vez.
exec 9> /var/lock/pizzaria-deploy.lock
flock 9

NOVA="$(mktemp -d /opt/.pizzaria-nova.XXXXXX)"
trap 'rm -rf "$NOVA"' EXIT
tar -x -C "$NOVA"
[ -f "$NOVA/docker-compose.yml" ] || { echo "Pacote inválido: falta docker-compose.yml" >&2; exit 1; }

# Troca o código (os pedidos ficam no volume Docker, não nesta pasta).
chmod 755 "$NOVA"
if [ -d "$PASTA" ]; then mv "$PASTA" "$PASTA.antiga"; fi
mv "$NOVA" "$PASTA"
rm -rf "$PASTA.antiga"

cd "$PASTA"
echo "Publicando versão $VERSAO..."
VERSAO="$VERSAO" docker compose up -d --build
docker image prune -f --filter label=app=pizzaria > /dev/null
echo "Container pizzaria-app atualizado."

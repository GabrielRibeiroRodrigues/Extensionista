#!/usr/bin/env bash
# Publica a versão commitada na VPS, sem mexer em outros serviços do servidor.
# Uso: ./deploy.sh            (padrão root@187.41.102.56)
#      VPS=usuario@ip ./deploy.sh
set -euo pipefail

VPS="${VPS:-root@187.41.102.56}"
PASTA="/opt/pizzaria"

if [ -n "$(git status --porcelain)" ]; then
  echo "Há alterações não commitadas; o deploy envia só o que está commitado." >&2
fi

echo "Enviando $(git rev-parse --short HEAD) para $VPS:$PASTA..."
git archive --format=tar HEAD | ssh "$VPS" "mkdir -p $PASTA && tar -x -C $PASTA"

# O prune filtra pela etiqueta do Dockerfile: imagens de outros projetos não são tocadas.
ssh "$VPS" "cd $PASTA && docker compose up -d --build && docker image prune -f --filter label=app=pizzaria > /dev/null"

HOST="${VPS#*@}"
echo "Aguardando o servidor responder..."
for _ in $(seq 1 20); do
  if curl -fs "http://$HOST:8080/api/info" > /dev/null; then
    echo "Publicado: http://$HOST:8080/painel"
    exit 0
  fi
  sleep 1
done
echo "O servidor não respondeu. Veja os logs: ssh $VPS 'docker logs pizzaria-app'" >&2
exit 1

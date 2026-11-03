#!/usr/bin/env bash
# Publica manualmente a versão commitada na VPS (o mesmo caminho do CI/CD).
# Normalmente não é preciso: todo push na main já publica pelo GitHub Actions.
# Uso: ./deploy.sh            (padrão root@187.41.102.56)
#      VPS=usuario@ip ./deploy.sh
set -euo pipefail

VPS="${VPS:-root@187.41.102.56}"
HOST="${VPS#*@}"
COMMIT="$(git rev-parse HEAD)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Há alterações não commitadas; o deploy envia só o que está commitado." >&2
fi

echo "Enviando ${COMMIT:0:7} para $VPS..."
git archive --format=tar HEAD | ssh "$VPS" /opt/pizzaria-deploy/receber.sh "$COMMIT"

echo "Conferindo a versão no ar..."
for _ in $(seq 1 30); do
  if curl -fs "http://$HOST:8080/api/info" | grep -q "\"versao\":\"$COMMIT\""; then
    echo "Publicado: http://$HOST:8080/painel"
    exit 0
  fi
  sleep 2
done
echo "A versão $COMMIT não apareceu no ar. Logs: ssh $VPS 'docker logs pizzaria-app'" >&2
exit 1

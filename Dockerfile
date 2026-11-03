FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    ARQUIVO_DADOS=/dados/pedidos.json

# Sem dependências externas: basta copiar o código.
COPY package.json server.js ./
COPY src ./src
COPY public ./public

# /dados guarda os pedidos (volume); /app/impressoes é o log da impressão simulada.
RUN mkdir -p /dados /app/impressoes && chown -R node:node /dados /app/impressoes
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/info > /dev/null || exit 1

CMD ["node", "server.js"]

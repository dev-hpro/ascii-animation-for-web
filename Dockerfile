# ASCII Studio — imagem pronta pra deploy (Coolify, Docker, etc.)

# Estágio 1: compila o ascii-image-converter (a conversão é feita no servidor)
FROM golang:1.22-alpine AS conversor
RUN CGO_ENABLED=0 go install github.com/TheZoraiz/ascii-image-converter@v1.13.1

# Estágio 2: runtime Node (sem dependências npm)
FROM node:22-alpine
COPY --from=conversor /go/bin/ascii-image-converter /usr/local/bin/ascii-image-converter

WORKDIR /app
COPY package.json servidor.js index.html frames.js ./

ENV HOST=0.0.0.0 \
    PORT=8000
# Limites contra sobrecarga — sobrescreva nas variáveis de ambiente do Coolify
ENV MAX_ARQUIVOS=200 \
    MAX_TAMANHO_KB=500

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/ping" || exit 1

CMD ["node", "servidor.js"]

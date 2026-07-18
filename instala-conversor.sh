#!/usr/bin/env bash
# Baixa o binário ascii-image-converter pra pasta do projeto.
# Usado pelo "npm run build" (deploy com Nixpacks no Coolify) — no deploy
# com o Dockerfile ele não é necessário, o binário é compilado na imagem.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
VERSAO="${AIC_VERSAO:-1.13.1}"
DESTINO="$DIR/ascii-image-converter"

if [ -x "$DESTINO" ] && "$DESTINO" --help >/dev/null 2>&1; then
  echo "ascii-image-converter já instalado em $DESTINO"
  exit 0
fi

if [ "$(uname -s)" != "Linux" ]; then
  echo "AVISO: instalação automática só no Linux — baixe manualmente:"
  echo "https://github.com/TheZoraiz/ascii-image-converter/releases"
  exit 0
fi

case "$(uname -m)" in
  x86_64)         ARQ="amd64_64bit" ;;
  aarch64|arm64)  ARQ="arm64_64bit" ;;
  armv7l|armv6l)  ARQ="armv6_32bit" ;;
  i386|i686)      ARQ="i386_32bit" ;;
  *) echo "ERRO: arquitetura não suportada: $(uname -m)"; exit 1 ;;
esac

URL="https://github.com/TheZoraiz/ascii-image-converter/releases/download/v${VERSAO}/ascii-image-converter_Linux_${ARQ}.tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Baixando $URL …"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMP/aic.tar.gz"
else
  wget -qO "$TMP/aic.tar.gz" "$URL"
fi

tar xzf "$TMP/aic.tar.gz" -C "$TMP"
BIN="$(find "$TMP" -type f -name ascii-image-converter | head -1)"
if [ -z "$BIN" ]; then
  echo "ERRO: binário não encontrado dentro do pacote baixado"
  exit 1
fi

cp "$BIN" "$DESTINO"
chmod +x "$DESTINO"
"$DESTINO" --help >/dev/null
echo "ascii-image-converter instalado em $DESTINO"

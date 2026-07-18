#!/usr/bin/env bash
# Converte toda imagem em img/ para ASCII art em frames/, na ordem natural dos nomes.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
IMG_DIR="$DIR/input"
OUT_DIR="$DIR/frames"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$OUT_DIR"

shopt -s nullglob nocaseglob
imagens=("$IMG_DIR"/*.png "$IMG_DIR"/*.jpg "$IMG_DIR"/*.jpeg)
shopt -u nocaseglob

if [ ${#imagens[@]} -eq 0 ]; then
    echo "Nenhuma imagem encontrada em $IMG_DIR"
    exit 1
fi

# Ordena por nome em ordem natural (quadro-2 antes de quadro-10)
mapfile -t imagens < <(printf '%s\n' "${imagens[@]}" | sort -V)

i=0
ok=0
for img in "${imagens[@]}"; do
    i=$((i + 1))
    if ascii-image-converter "$img" -d 400,124 -m "@%#*+=:-. " --negative --only-save --save-txt "$TMP_DIR" 2>/dev/null; then
        nome="$(basename "$img")"
        cp "$TMP_DIR/${nome%.*}-ascii-art.txt" "$OUT_DIR/$i.txt"
        ok=$((ok + 1))
        echo "[$i] $nome -> frames/$i.txt ($(wc -l < "$OUT_DIR/$i.txt") linhas)"
    else
        echo "[$i] ERRO ao converter: $img"
    fi
done

# Gera frames.js com todos os frames embutidos, pro index.html abrir direto do disco
JS="$DIR/frames.js"
{
    echo "// gerado por converte.sh — não editar na mão"
    echo "window.FRAMES = ["
    for f in $(ls "$OUT_DIR"/*.txt | sort -V); do
        awk 'BEGIN{printf "\""} {gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); printf "%s\\n", $0} END{print "\","}' "$f"
    done
    echo "];"
} > "$JS"

echo "Pronto: $ok/${#imagens[@]} imagens convertidas em $OUT_DIR"
echo "frames.js atualizado — abra o index.html direto no navegador"

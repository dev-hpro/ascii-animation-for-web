# ascii-animation-for-web
Projeto para transformar frames de imagem de qualquer formato em animação ASCII que roda direto do navegador.

***

## Como usar

1. Transforme o vídeo que você quer em PNG, JPG ou qualquer outro formato de imagem — use algum programa para extrair os frames (por exemplo, o kdenlive).
2. Rode o servidor (precisa do Node e do binário `ascii-image-converter` — veja abaixo):

   ```bash
   npm start
   # ou: node servidor.js [porta]
   ```

3. Abra http://localhost:8000
4. Na interface, arraste os frames pra tela (ou use ⚙ config → escolher imagens) e ajuste largura, mapa de caracteres, cor etc.
5. Ao final, exporte o resultado como um HTML puro, num arquivo único com a animação embutida.

### Conversão no servidor

Toda a conversão é feita no servidor pelo binário [ascii-image-converter](https://github.com/TheZoraiz/ascii-image-converter/releases) — nada roda no navegador do cliente. O servidor procura o binário no PATH, em `~/.local/bin/` ou na pasta do projeto, e não sobe sem ele (no deploy com o Dockerfile ele já vem instalado).

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `8000` | porta do servidor |
| `HOST` | `127.0.0.1` | use `0.0.0.0` pra expor na rede/container |
| `MAX_ARQUIVOS` | `200` | nº máximo de arquivos por conversão |
| `MAX_TAMANHO_KB` | `500` | tamanho máximo por arquivo, em KB |

Os limites evitam sobrecarga do servidor: pedidos acima deles são recusados com HTTP 413. Arquivos maiores que `MAX_TAMANHO_KB` não são recusados na interface — o navegador do usuário comprime (redimensiona e reencoda em JPEG) até caber no limite antes de enviar.

### Deploy no Coolify (ou qualquer Docker)

O repositório traz um `Dockerfile` pronto que compila o `ascii-image-converter` na build e sobe o servidor:

1. No Coolify, crie um recurso apontando pra este repositório e escolha **Dockerfile** como build pack.
2. A porta exposta é a **8000** (o `HOST=0.0.0.0` já vem definido na imagem).
3. Ajuste `MAX_ARQUIVOS` e `MAX_TAMANHO_KB` nas variáveis de ambiente, se quiser.

O healthcheck da imagem usa `GET /api/ping`.

### Conversão em lote pela linha de comando

O `converte.sh` converte todas as imagens da pasta `input/` para `frames/` e gera o `frames.js` (requer o binário `ascii-image-converter`).

***

**OBS:** quanto mais frames, maior fica o arquivo — ideal para pequenas animações e transições. Mesmo que rode no seu computador, verifique o consumo de RAM do navegador na hora da build: tem que ter bastante memória.

Este é um projeto para criação de animações usando ASCII, voltado para quem quer implementar em um app ou coisa do tipo. Quanto mais chars e frames tiver, maior será o peso; ideal para criar pequenas animações e inserir em páginas da web, blogs etc.

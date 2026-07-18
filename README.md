# ascii-animation-for-web
Projeto para transformar frames de imagem de qualquer formato em animação ASCII que roda direto do navegador.

***

## Como usar

1. Transforme o vídeo que você quer em PNG, JPG ou qualquer outro formato de imagem — use algum programa para extrair os frames (por exemplo, o kdenlive).
2. Rode o servidor (só precisa do Node, sem dependências):

   ```bash
   npm start
   # ou: node servidor.js [porta]
   ```

3. Abra http://localhost:8000
4. Na interface, arraste os frames pra tela (ou use ⚙ config → escolher imagens) e ajuste largura, mapa de caracteres, cor etc.
5. Ao final, exporte o resultado como um HTML puro, num arquivo único com a animação embutida.

### Conversão no servidor (opcional)

Se o binário [ascii-image-converter](https://github.com/TheZoraiz/ascii-image-converter/releases) estiver instalado (no PATH, em `~/.local/bin/` ou na pasta do projeto), a conversão pesada é feita pelo servidor. Sem ele, a conversão acontece no próprio navegador — tudo continua funcionando.

Também dá pra usar sem servidor nenhum: basta abrir o `index.html` direto no navegador.

Variáveis de ambiente do servidor: `PORT` (porta, padrão 8000) e `HOST` (padrão `127.0.0.1`; use `0.0.0.0` pra expor na rede).

### Conversão em lote pela linha de comando

O `converte.sh` converte todas as imagens da pasta `input/` para `frames/` e gera o `frames.js` (requer o binário `ascii-image-converter`).

***

**OBS:** quanto mais frames, maior fica o arquivo — ideal para pequenas animações e transições. Mesmo que rode no seu computador, verifique o consumo de RAM do navegador na hora da build: tem que ter bastante memória.

Este é um projeto para criação de animações usando ASCII, voltado para quem quer implementar em um app ou coisa do tipo. Quanto mais chars e frames tiver, maior será o peso; ideal para criar pequenas animações e inserir em páginas da web, blogs etc.

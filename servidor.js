#!/usr/bin/env node
// Servidor do ASCII Studio — converte imagens usando o binário ascii-image-converter,
// tirando o trabalho pesado do navegador. Zero dependências, só Node.
//
// Uso:  node servidor.js [porta]     (padrão: 8000)
// Abra: http://localhost:8000

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const PORTA = +process.argv[2] || +process.env.PORT || 8000;

// ---------- limites (contra sobrecarga) ----------
// MAX_ARQUIVOS    — nº máximo de arquivos por conversão (padrão 200)
// MAX_TAMANHO_KB  — tamanho máximo por arquivo, em KB (padrão 500);
//                   acima disso o navegador comprime antes de enviar
const MAX_ARQUIVOS = Math.max(1, Math.floor(+process.env.MAX_ARQUIVOS) || 200);
const MAX_TAMANHO_KB = +process.env.MAX_TAMANHO_KB > 0 ? +process.env.MAX_TAMANHO_KB : 500;
const MAX_TAMANHO_ARQUIVO = Math.round(MAX_TAMANHO_KB * 1024);
// corpo JSON: arquivos em base64 (~4/3 do tamanho) + folga pra estrutura
const LIMITE_BODY = Math.ceil(MAX_ARQUIVOS * MAX_TAMANHO_ARQUIVO * 4 / 3) + 1024 * 1024;

// ---------- modo dev × deploy ----------
// Acesso local (loopback) é modo dev: upload liberado, sem limite de quantidade
// de imagens. Qualquer outro acesso (deploy) fica com o upload DESATIVADO por
// enquanto (fase de testes). MODO=dev força o modo dev mesmo atrás de proxy.
const FORCA_DEV = process.env.MODO === 'dev';
function ehDev(req) {
  if (FORCA_DEV) return true;
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// ---------- localizar o binário ----------
function acharBinario() {
  const candidatos = [
    path.join(DIR, 'ascii-image-converter'),
    path.join(os.homedir(), '.local/bin/ascii-image-converter'),
    'ascii-image-converter', // PATH
  ];
  for (const c of candidatos) {
    const r = spawnSync(c, ['--help'], { stdio: 'ignore' });
    if (!r.error) return c;
  }
  return null;
}
const BINARIO = acharBinario();
if (!BINARIO) {
  console.error('ERRO: ascii-image-converter não encontrado — a conversão é feita no servidor e precisa dele.');
  console.error('Baixe em https://github.com/TheZoraiz/ascii-image-converter/releases');
  console.error('(no deploy com o Dockerfile deste repositório ele já vem instalado)');
  process.exit(1);
}

// ---------- cache de imagens por sessão ----------
// Cada navegador gera um id de sessão e manda as imagens uma vez; ajustes de
// config reusam o cache daquela sessão. Vários usuários podem usar ao mesmo
// tempo sem ver as imagens uns dos outros. Nada é persistido: sessões paradas
// expiram e tudo morre com o processo.
const SESSAO_TTL = 30 * 60 * 1000; // 30 min sem uso
const MAX_SESSOES = 100;
const caches = new Map(); // sessao -> { dir, arquivos: [caminho...], usado }

function limparSessao(sessao) {
  const c = caches.get(sessao);
  if (c) fs.rmSync(c.dir, { recursive: true, force: true });
  caches.delete(sessao);
}
function limparTudo() {
  for (const s of [...caches.keys()]) limparSessao(s);
}
process.on('exit', limparTudo);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {
  const agora = Date.now();
  for (const [s, c] of caches) if (agora - c.usado > SESSAO_TTL) limparSessao(s);
}, 5 * 60 * 1000).unref();

// ---------- validação dos arquivos ----------
// Só imagem raster entra, identificada pela assinatura binária (magic bytes) —
// nome e MIME informados pelo cliente são ignorados. SVG (XML que pode carregar
// script), HTML e qualquer outro tipo são recusados.
const ASSINATURAS = [
  { ext: '.png',  ok: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  { ext: '.jpg',  ok: b => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { ext: '.gif',  ok: b => b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8' },
  { ext: '.webp', ok: b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { ext: '.bmp',  ok: b => b.length > 2 && b[0] === 0x42 && b[1] === 0x4D },
];
function tipoImagem(buf) {
  for (const a of ASSINATURAS) if (a.ok(buf)) return a.ext;
  return null;
}

// ---------- zip ----------
// Extrator mínimo (só zlib): aceita entradas armazenadas (método 0) ou
// deflate (método 8), que é o que qualquer zip comum usa. Serve pra enviar
// milhares de quadros de uma vez sem esbarrar no limite de seleção de
// arquivos do navegador.
const ehZip = buf => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;

function extrairZip(buf) {
  // End of Central Directory: procura a assinatura de trás pra frente
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip inválido (fim do diretório central não encontrado)');
  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16); // início do diretório central

  const entradas = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('zip inválido (diretório central corrompido)');
    const metodo = buf.readUInt16LE(pos + 10);
    const tamComp = buf.readUInt32LE(pos + 20);
    const nomeLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const comentLen = buf.readUInt16LE(pos + 32);
    const offsetLocal = buf.readUInt32LE(pos + 42);
    const nome = buf.toString('utf8', pos + 46, pos + 46 + nomeLen);
    pos += 46 + nomeLen + extraLen + comentLen;

    // pastas e lixo de zip do macOS ficam de fora
    if (nome.endsWith('/') || nome.startsWith('__MACOSX/') || path.basename(nome).startsWith('.')) continue;

    const nomeLocalLen = buf.readUInt16LE(offsetLocal + 26);
    const extraLocalLen = buf.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + nomeLocalLen + extraLocalLen;
    const dados = buf.subarray(inicio, inicio + tamComp);

    let conteudo;
    if (metodo === 0) conteudo = Buffer.from(dados);
    else if (metodo === 8) conteudo = zlib.inflateRawSync(dados);
    else throw new Error(`"${nome}": método de compressão ${metodo} não suportado`);
    entradas.push({ nome: path.basename(nome), buf: conteudo });
  }
  // mesma ordem natural que o navegador usa pra sequências numeradas
  entradas.sort((a, b) => a.nome.localeCompare(b.nome, undefined, { numeric: true, sensitivity: 'base' }));
  return entradas;
}

function salvarImagens(sessao, validadas) {
  limparSessao(sessao);
  // muita gente ao mesmo tempo? derruba a sessão parada há mais tempo
  while (caches.size >= MAX_SESSOES) {
    let velha = null;
    for (const [s, c] of caches) if (!velha || c.usado < caches.get(velha).usado) velha = s;
    limparSessao(velha);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascii-studio-'));
  const arquivos = validadas.map((v, i) => {
    const f = path.join(dir, `img${String(i + 1).padStart(4, '0')}${v.ext}`);
    fs.writeFileSync(f, v.buf);
    return f;
  });
  caches.set(sessao, { dir, arquivos, usado: Date.now() });
}

// ---------- conversão ----------
function converter(cache, cfg) {
  const out = path.join(cache.dir, 'out');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);

  const frames = [];
  for (const img of cache.arquivos) {
    const args = [img, '-m', cfg.mapa, '--only-save', '--save-txt', out];
    if (cfg.altura > 0) args.push('-d', `${cfg.largura},${cfg.altura + 1}`);
    else args.push('-W', String(cfg.largura));
    if (cfg.negativo) args.push('-n');

    const r = spawnSync(BINARIO, args, { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`falha ao converter ${path.basename(img)}: ${(r.stderr || r.stdout || '').trim()}`);
    }
    const txt = path.join(out, `${path.basename(img, path.extname(img))}-ascii-art.txt`);
    frames.push(fs.readFileSync(txt, 'utf8'));
  }
  return frames;
}

// ---------- http ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.gz': 'application/gzip', // exemplo.json.gz — já comprimido, servido como está
};

function lerBody(req, limite = LIMITE_BODY) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', c => {
      tam += c.length;
      if (tam > limite) { reject(new Error('payload grande demais')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  try {
    if (req.method === 'GET' && url.pathname === '/api/ping') {
      const dev = ehDev(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        conversor: true,
        binario: BINARIO,
        upload: dev, // deployado: upload desativado (fase de testes)
        // maxArquivos 0 = sem limite de quantidade (modo dev)
        limites: { maxArquivos: dev ? 0 : MAX_ARQUIVOS, maxTamanhoKb: MAX_TAMANHO_KB },
      }));
      return;
    }

    // modo dev: grava a animação atual como o exemplo do site (exemplo.json.gz,
    // JSON gzipado — ASCII art encolhe ~20x e cabe no limite de arquivo do GitHub).
    // O arquivo fica no repositório — commit + deploy publicam o novo exemplo.
    if (req.method === 'POST' && url.pathname === '/api/exemplo') {
      if (!ehDev(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'disponível só em modo dev (fase de testes)' }));
        return;
      }
      const body = JSON.parse((await lerBody(req, Infinity)).toString('utf8'));
      const frames = body.frames;
      if (!Array.isArray(frames) || !frames.length || frames.some(f => typeof f !== 'string')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'frames inválidos' }));
        return;
      }
      // áudio opcional: vira o audio-exemplo.mp3 servido junto do exemplo
      let audioSalvo = false;
      if (typeof body.audioB64 === 'string' && body.audioB64) {
        const buf = Buffer.from(body.audioB64, 'base64');
        const ehMp3 = buf.length > 3 &&
          (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0));
        if (!ehMp3) {
          res.writeHead(415, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'o áudio precisa ser um MP3' }));
          return;
        }
        fs.writeFileSync(path.join(DIR, 'audio-exemplo.mp3'), buf);
        audioSalvo = true;
      }
      fs.writeFileSync(path.join(DIR, 'exemplo.json.gz'),
        zlib.gzipSync(JSON.stringify(frames), { level: 9 }));
      console.log(`exemplo atualizado: ${frames.length} frames em exemplo.json.gz` +
        (audioSalvo ? ' + audio-exemplo.mp3' : ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, frames: frames.length, audio: audioSalvo }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/converter') {
      const dev = ehDev(req);
      if (!dev) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'o envio de imagens está em fase de testes' }));
        return;
      }
      const body = JSON.parse((await lerBody(req, Infinity)).toString('utf8'));
      const cfg = {
        largura: Math.min(800, Math.max(20, +body.cfg?.largura || 400)),
        altura: Math.min(400, Math.max(0, +body.cfg?.altura || 0)),
        mapa: String(body.cfg?.mapa || '@%#*+=:-. '),
        negativo: !!body.cfg?.negativo,
      };
      const sessao = String(body.sessao || '').slice(0, 64);
      if (!sessao) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'sessão não informada' }));
        return;
      }
      // modo dev: sem limite de quantidade de imagens
      if (Array.isArray(body.imagens) && body.imagens.length) {
        const validadas = [];
        const validar = (nome, buf) => {
          if (buf.length > MAX_TAMANHO_ARQUIVO) {
            throw Object.assign(new Error(`"${nome}" excede o limite de ${MAX_TAMANHO_KB} KB por arquivo`), { http: 413 });
          }
          const ext = tipoImagem(buf);
          if (!ext) {
            throw Object.assign(new Error(`"${nome}" não é um formato de imagem permitido (PNG, JPG, GIF, WebP, BMP)`), { http: 415 });
          }
          validadas.push({ buf, ext });
        };
        try {
          for (const im of body.imagens) {
            const nome = String(im.nome || 'arquivo').slice(0, 200);
            const buf = Buffer.from(String(im.b64 || ''), 'base64');
            // zip: extrai e valida cada quadro de dentro (o zip em si não tem
            // limite de tamanho — o limite por arquivo vale pro conteúdo)
            if (ehZip(buf)) {
              const entradas = extrairZip(buf);
              if (!entradas.length) throw Object.assign(new Error(`"${nome}" não tem nenhum arquivo dentro`), { http: 400 });
              for (const e of entradas) validar(`${nome}/${e.nome}`, e.buf);
            } else {
              validar(nome, buf);
            }
          }
        } catch (e) {
          res.writeHead(e.http || 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: e.message }));
          return;
        }
        salvarImagens(sessao, validadas);
      }
      const cache = caches.get(sessao);
      if (!cache) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'nenhuma imagem enviada ainda' }));
        return;
      }
      cache.usado = Date.now();
      const inicio = Date.now();
      const frames = converter(cache, cfg);
      console.log(`convertido: ${frames.length} frames em ${Date.now() - inicio}ms ` +
        `(largura=${cfg.largura} altura=${cfg.altura || 'auto'} negativo=${cfg.negativo} sessões=${caches.size})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ frames }));
      return;
    }

    // estáticos
    if (req.method === 'GET') {
      let alvo = url.pathname === '/' ? '/index.html' : url.pathname;
      alvo = path.normalize(alvo).replace(/^(\.\.[/\\])+/, '');
      const arquivo = path.join(DIR, alvo);
      if (arquivo.startsWith(DIR) && fs.existsSync(arquivo) && fs.statSync(arquivo).isFile()) {
        const ext = path.extname(arquivo);
        const cabecalhos = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
        // texto vai gzipado (frames.js de exemplo encolhe ~20x)
        const gzip = ['.html', '.js', '.css', '.txt'].includes(ext) &&
          /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        if (gzip) {
          cabecalhos['Content-Encoding'] = 'gzip';
          res.writeHead(200, cabecalhos);
          fs.createReadStream(arquivo).pipe(zlib.createGzip()).pipe(res);
        } else {
          res.writeHead(200, cabecalhos);
          fs.createReadStream(arquivo).pipe(res);
        }
        return;
      }
    }

    res.writeHead(404);
    res.end('não encontrado');
  } catch (e) {
    console.error(e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: e.message }));
  }
});

// 0.0.0.0 por padrão pra funcionar atrás do proxy em container (Coolify etc.);
// use HOST=127.0.0.1 pra restringir ao acesso local
const HOST = process.env.HOST || '0.0.0.0';
servidor.listen(PORTA, HOST, () => {
  console.log(`ASCII Studio no ar: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORTA}`);
  console.log(`binário: ${BINARIO}`);
  console.log(`limites: ${MAX_ARQUIVOS} arquivos, ${MAX_TAMANHO_KB} KB por arquivo (MAX_ARQUIVOS / MAX_TAMANHO_KB)`);
});

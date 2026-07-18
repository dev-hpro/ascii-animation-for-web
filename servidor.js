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
const { spawnSync } = require('child_process');

const DIR = __dirname;
const PORTA = +process.argv[2] || 8000;
const LIMITE_BODY = 300 * 1024 * 1024; // 300 MB

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
  console.error('ERRO: ascii-image-converter não encontrado.');
  console.error('Baixe em https://github.com/TheZoraiz/ascii-image-converter/releases');
  process.exit(1);
}

// ---------- cache das imagens enviadas ----------
// O navegador manda as imagens uma vez; ajustes de config reusam o cache,
// então mudar largura/mapa/etc. não re-envia nada.
let cache = null; // { dir, arquivos: [caminho...] }

function limparCache() {
  if (cache) fs.rmSync(cache.dir, { recursive: true, force: true });
  cache = null;
}
process.on('exit', limparCache);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

function salvarImagens(imagens) {
  limparCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascii-studio-'));
  const arquivos = imagens.map((im, i) => {
    const ext = (path.extname(im.nome || '') || '.png').toLowerCase();
    const f = path.join(dir, `img${String(i + 1).padStart(4, '0')}${ext}`);
    fs.writeFileSync(f, Buffer.from(im.b64, 'base64'));
    return f;
  });
  cache = { dir, arquivos };
}

// ---------- conversão ----------
function converter(cfg) {
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

// Mantém frames/ e frames.js do projeto em dia com a última conversão
function persistir(frames) {
  const dirFrames = path.join(DIR, 'frames');
  fs.rmSync(dirFrames, { recursive: true, force: true });
  fs.mkdirSync(dirFrames);
  frames.forEach((f, i) => fs.writeFileSync(path.join(dirFrames, `${i + 1}.txt`), f));
  fs.writeFileSync(
    path.join(DIR, 'frames.js'),
    '// gerado pelo servidor.js — não editar na mão\nwindow.FRAMES = ' +
      JSON.stringify(frames) + ';\n'
  );
}

// ---------- http ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
};

function lerBody(req) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', c => {
      tam += c.length;
      if (tam > LIMITE_BODY) { reject(new Error('payload grande demais')); req.destroy(); return; }
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, binario: BINARIO }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/converter') {
      const body = JSON.parse((await lerBody(req)).toString('utf8'));
      const cfg = {
        largura: Math.min(800, Math.max(20, +body.cfg?.largura || 400)),
        altura: Math.min(400, Math.max(0, +body.cfg?.altura || 0)),
        mapa: String(body.cfg?.mapa || '@%#*+=:-. '),
        negativo: !!body.cfg?.negativo,
      };
      if (Array.isArray(body.imagens) && body.imagens.length) salvarImagens(body.imagens);
      if (!cache) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'nenhuma imagem enviada ainda' }));
        return;
      }
      const inicio = Date.now();
      const frames = converter(cfg);
      persistir(frames);
      console.log(`convertido: ${frames.length} frames em ${Date.now() - inicio}ms ` +
        `(largura=${cfg.largura} altura=${cfg.altura || 'auto'} negativo=${cfg.negativo})`);
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
        res.writeHead(200, { 'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream' });
        fs.createReadStream(arquivo).pipe(res);
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

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`ASCII Studio no ar: http://localhost:${PORTA}`);
  console.log(`binário: ${BINARIO}`);
});

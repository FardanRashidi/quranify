import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel, transcribe } from './asr.js';
import { locate, getSurah, listSurahs, warmUp } from './quran.js';
import { loadOrCreateCert, lanAddresses } from './tls.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_AUDIO_BYTES = 12 * 16000 * 2; // the page keeps 12 s of audio; this is that much 16 kHz s16le

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const tlsOptions = loadOrCreateCert();

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // Plain http only gets the microphone on localhost, so send everyone else to https.
  if (tlsOptions && !req.socket.encrypted && !isLoopback(req.socket.remoteAddress)) {
    res.writeHead(308, { Location: `https://${req.headers.host}${req.url}` });
    return res.end();
  }
  try {
    if (url.pathname === '/api/quran/warmup' && req.method === 'POST') {
      await Promise.all([loadModel(), warmUp()]);
      return sendJson(res, 200, { ready: true });
    }
    if (url.pathname === '/api/quran/recognize' && req.method === 'POST') {
      const audio = await readBody(req, MAX_AUDIO_BYTES);
      const transcript = await transcribe(audio);
      const near = url.searchParams.has('near') ? Number(url.searchParams.get('near')) : null;
      const surah = url.searchParams.has('surah') ? Number(url.searchParams.get('surah')) : null;
      if (surah !== null && !(Number.isInteger(surah) && surah >= 1 && surah <= 114)) return sendJson(res, 400, { error: 'No such surah' });
      return sendJson(res, 200, { match: await locate(transcript, near, surah), transcript });
    }
    if (url.pathname === '/api/quran/surahs' && req.method === 'GET') {
      return sendJson(res, 200, { surahs: await listSurahs() });
    }
    const surahRoute = url.pathname.match(/^\/api\/quran\/surah\/(\d+)$/);
    if (surahRoute && req.method === 'GET') {
      const surah = await getSurah(Number(surahRoute[1]), url.searchParams.get('translation') ?? 'en');
      return surah ? sendJson(res, 200, { surah }) : sendJson(res, 404, { error: 'No such surah' });
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(url.pathname, res);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(`${req.method} ${url.pathname}:`, err.message);
    if (!res.headersSent) sendJson(res, err.status ?? 502, { error: err.message });
  }
}

const httpServer = http.createServer(handle);
const httpsServer = tlsOptions && https.createServer(tlsOptions, handle);

// http and https share one port: peek at the first byte of each connection
// (0x16 starts a TLS handshake) and hand the socket to the matching server.
const server = net.createServer((socket) => {
  socket.on('error', () => socket.destroy());
  socket.once('readable', () => {
    const first = socket.read(1);
    if (!first) return socket.destroy();
    socket.unshift(first);
    (first[0] === 0x16 && httpsServer ? httpsServer : httpServer).emit('connection', socket);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Quran Whisperer running at http://localhost:${PORT}`);
  const scheme = tlsOptions ? 'https' : 'http';
  for (const ip of lanAddresses()) console.log(`  on your network:  ${scheme}://${ip}:${PORT}`);
  if (tlsOptions) console.log('  (self-signed certificate: accept the browser warning once per device)');
});

function isLoopback(address = '') {
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Audio clip too long'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(pathname, res) {
  const filePath = path.join(PUBLIC_DIR, path.normalize(decodeURIComponent(pathname)));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });

  const target = pathname.endsWith('/') ? path.join(filePath, 'index.html') : filePath;
  let data;
  try {
    data = await fs.readFile(target);
  } catch {
    return sendJson(res, 404, { error: 'Not found' });
  }
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(target)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

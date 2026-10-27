// Local stand-ins for the two live services, for the Playwright run:
//  - http://127.0.0.1:4173  the built site (dist/), with the same URL rules as vercel.json
//  - http://127.0.0.1:8787  a mock of the Apps Script web app that runs the real Core.js on an in-memory sheet.
//    Like Apps Script, it answers a POST with a 302 to another origin, which then returns the JSON.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { memoryDeps } from './memory-store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

// ---------- the site ----------
createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = url.pathname;
  const redirect = vercel.redirects.find((r) => r.source === path);
  if (redirect) {
    res.writeHead(307, { Location: redirect.destination });
    return res.end();
  }
  const rewrite = vercel.rewrites.find((r) => r.source === path);
  if (rewrite) path = rewrite.destination;
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(4173, '127.0.0.1');

// ---------- the API ----------
let env = memoryDeps({ now: Date.now() });
let failNext = 0;
const pending = new Map();
const log = [];

function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s));
  });
}

function json(res, status, obj, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extra });
  res.end(JSON.stringify(obj));
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/__control') {
    const c = JSON.parse((await body(req)) || '{}');
    if (c.op === 'reset') {
      env = memoryDeps({ now: Date.now(), props: c.props || {}, config: c.config || [] });
      failNext = 0;
      log.length = 0;
    }
    if (c.op === 'failNext') failNext = c.n;
    if (c.op === 'setCode') env.props.set('SCORER_CODE', c.code);
    if (c.op === 'config') env.setConfig(c.rows);
    const tables = {};
    for (const [name, t] of env.tabs) tables[name] = { header: t.header, rows: t.rows };
    const layouts = {};
    for (const [name, l] of env.layouts) layouts[name] = l.values;
    return json(res, 200, { ok: true, tables, layouts, log });
  }
  if (req.method === 'POST' && url.pathname === '/exec') {
    const raw = await body(req);
    let payload = null;
    try { payload = JSON.parse(raw); } catch { /* handled by Core */ }
    log.push({ action: payload && payload.action, contentType: req.headers['content-type'] || '' });
    if (failNext > 0) {
      failNext--;
      req.socket.destroy(); // a dropped connection, as on weak venue Wi-Fi
      return;
    }
    const out = raw.length > 20000 ? { ok: false, code: 'validation', error: 'too big' } : env.handle(payload);
    const id = randomUUID();
    pending.set(id, out);
    // Apps Script answers from another origin after a redirect
    const host = (req.headers.host || '').startsWith('127.0.0.1') ? 'localhost:8787' : '127.0.0.1:8787';
    res.writeHead(302, { Location: `http://${host}/echo/${id}`, 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }
  if (req.method === 'GET' && url.pathname.startsWith('/echo/')) {
    const id = url.pathname.slice(6);
    const out = pending.get(id);
    pending.delete(id);
    return out ? json(res, 200, out) : json(res, 404, { ok: false });
  }
  if (req.method === 'OPTIONS') {
    // Apps Script has no preflight handling, so a preflight here is a failure of the client
    log.push({ action: 'PREFLIGHT' });
    res.writeHead(405);
    return res.end();
  }
  res.writeHead(404);
  res.end();
}).listen(8787);

console.log('servers ready: site http://127.0.0.1:4173, api http://127.0.0.1:8787/exec');

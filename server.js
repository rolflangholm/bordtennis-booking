'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createStore, BookingError } = require('./lib/store');

const config = {
  port: Number(process.env.PORT) || 8040,
  host: process.env.HOST || '0.0.0.0',
  title: process.env.TITLE || 'Bordtennis booking',
  slotMinutes: Number(process.env.SLOT_MINUTES) || 20,
  openTime: process.env.OPEN_TIME || '08:00',
  closeTime: process.env.CLOSE_TIME || '18:00',
  daysAhead: Number(process.env.DAYS_AHEAD) || 14,
  maxActivePerPerson: Number(process.env.MAX_ACTIVE_PER_PERSON ?? 2),
  weekends: process.env.WEEKENDS === 'true',
  dataFile: process.env.DATA_FILE || path.join(__dirname, 'data', 'bookings.json'),
};

const store = createStore(config);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// Live-opdatering: alle åbne browsere får besked når noget ændres.
const listeners = new Set();
function broadcast(date) {
  const msg = `event: change\ndata: ${JSON.stringify({ date })}\n\n`;
  for (const res of listeners) res.write(msg);
}
setInterval(() => {
  for (const res of listeners) res.write(': ping\n\n');
}, 25_000).unref();

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) reject(new BookingError('For stor forespørgsel', 413));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new BookingError('Ugyldig JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbudt' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Ikke fundet' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/config') {
    const { title, slotMinutes, openTime, closeTime, daysAhead, maxActivePerPerson, weekends } = config;
    return sendJson(res, 200, { title, slotMinutes, openTime, closeTime, daysAhead, maxActivePerPerson, weekends });
  }

  if (method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }

  if (method === 'GET' && pathname === '/api/bookings') {
    const date = url.searchParams.get('date');
    return sendJson(res, 200, { date, now: new Date().toISOString(), slots: store.day(date) });
  }

  if (method === 'POST' && pathname === '/api/bookings') {
    const result = store.create(await readBody(req));
    broadcast(result.booking.date);
    return sendJson(res, 201, result);
  }

  const m = pathname.match(/^\/api\/bookings\/([\w-]+)\/(join|leave|cancel)$/);
  if (method === 'POST' && m) {
    const [, id, action] = m;
    const body = await readBody(req);
    const result = store[action](id, body);
    broadcast(body.date);
    return sendJson(res, 200, result);
  }

  sendJson(res, 404, { error: 'Ukendt endpoint' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Metode ikke tilladt' });
    serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (err) {
    if (err instanceof BookingError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    sendJson(res, 500, { error: 'Noget gik galt på serveren' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`🏓 ${config.title} kører på http://localhost:${config.port}`);
});

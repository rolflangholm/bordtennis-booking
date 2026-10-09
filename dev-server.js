'use strict';

// Lokal udviklingsserver.
//   npm start      → serverer public/ (bruger public/config.js og jeres rigtige Supabase)
//   npm run demo   → kører supabase/schema.sql i en lokal Postgres (PGlite) og efterligner
//                    de dele af Supabase-API'et som appen bruger. Ingen konto nødvendig.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 8040;
const DEMO = process.argv.includes('--demo');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const TABLES = new Set(['settings', 'bookings']);
const FUNCTIONS = new Set(['book_slot', 'join_seat', 'leave_seat', 'cancel_booking']);
let db;

async function startDemoDb() {
  const { PGlite } = require('@electric-sql/pglite');
  db = new PGlite(process.env.DEMO_DB || path.join(__dirname, 'data', 'demo-db'));
  await db.exec(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;`);
  await db.exec(fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8'));
  await db.exec('set role anon'); // samme rettigheder som en browser har hos Supabase
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

// Minimal PostgREST: GET /rest/v1/<tabel>?select=a,b&kolonne=eq.værdi og POST /rest/v1/rpc/<funktion>
async function handleRest(req, res, url) {
  try {
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc && req.method === 'POST' && FUNCTIONS.has(rpc[1])) {
      const args = await readJson(req);
      const keys = Object.keys(args).filter((k) => /^p_\w+$/.test(k));
      const sql = `select public.${rpc[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const { rows } = await db.query(sql, keys.map((k) => args[k]));
      return send(res, 200, rows[0].r);
    }

    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (table && req.method === 'GET' && TABLES.has(table[1])) {
      const select = (url.searchParams.get('select') || '*').replace(/\s/g, '');
      if (!/^(\*|\w+(,\w+)*)$/.test(select)) return send(res, 400, { message: 'Ugyldig select' });
      const where = [];
      const params = [];
      for (const [col, val] of url.searchParams) {
        if (col === 'select') continue;
        if (!/^\w+$/.test(col) || !val.startsWith('eq.')) return send(res, 400, { message: 'Ukendt filter' });
        params.push(val.slice(3));
        where.push(`${col} = $${params.length}`);
      }
      const sql = `select ${select} from public.${table[1]}${where.length ? ` where ${where.join(' and ')}` : ''}`;
      const { rows } = await db.query(sql, params);
      const single = (req.headers.accept || '').includes('vnd.pgrst.object');
      return send(res, 200, single ? rows[0] : rows);
    }

    send(res, 404, { message: 'Ikke understøttet i demo' });
  } catch (err) {
    send(res, 400, { code: err.code, message: err.message });
  }
}

function serveStatic(res, pathname) {
  if (DEMO && pathname === '/config.js') {
    return send(
      res,
      200,
      `window.BORDTENNIS_CONFIG = { supabaseUrl: 'http://localhost:${PORT}', supabaseKey: 'demo', realtime: false };`,
      MIME['.js'],
    );
  }
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { message: 'Forbudt' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, pathname === '/config.js' ? '' : { message: 'Ikke fundet' }, MIME['.js']);
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

async function main() {
  if (DEMO) await startDemoDb();
  http
    .createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (DEMO && url.pathname.startsWith('/rest/v1/')) return handleRest(req, res, url);
      serveStatic(res, decodeURIComponent(url.pathname));
    })
    .listen(PORT, () => {
      console.log(`🏓 http://localhost:${PORT}${DEMO ? '  (demo-database: data/demo-db)' : ''}`);
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

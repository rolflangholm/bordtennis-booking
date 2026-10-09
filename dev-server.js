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

const TABLES = new Set(['settings', 'bookings', 'results']);
const FUNCTIONS = new Set([
  'book_slot', 'join_seat', 'leave_seat', 'cancel_booking', 'save_result', 'set_result_paid', 'delete_result',
]);
let db;

async function startDemoDb() {
  const { PGlite } = require('@electric-sql/pglite');
  // Datoer sendes som "YYYY-MM-DD" ligesom hos Supabase (ikke som JS Date).
  db = new PGlite(process.env.DEMO_DB || path.join(__dirname, 'data', 'demo-db'), { parsers: { 1082: (v) => v } });
  await db.exec(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;`);
  await db.exec(fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8'));
  // DEMO_NOW="2026-10-09 10:05" lader databasen tro, at klokken er noget andet (til test).
  if (process.env.DEMO_NOW) {
    await db.query(
      `create or replace function public._bt_now() returns timestamp language sql stable as $$ select '${process.env.DEMO_NOW.replace(/'/g, '')}'::timestamp $$`,
    );
  }
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
      let order = '';
      let limit = '';
      const OPS = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' };
      for (const [col, val] of url.searchParams) {
        if (col === 'select') continue;
        if (col === 'order') {
          const parts = val.split(',').map((p) => p.split('.'));
          if (!parts.every(([c, dir]) => /^\w+$/.test(c) && (!dir || /^(asc|desc)$/.test(dir)))) {
            return send(res, 400, { message: 'Ugyldig order' });
          }
          order = ` order by ${parts.map(([c, dir]) => `${c} ${dir || 'asc'}`).join(', ')}`;
          continue;
        }
        if (col === 'limit') {
          limit = ` limit ${Math.min(Number(val) || 100, 1000)}`;
          continue;
        }
        const m = val.match(/^(eq|gte|lte|gt|lt|in)\.(.*)$/s);
        if (!/^\w+$/.test(col) || !m) return send(res, 400, { message: 'Ukendt filter' });
        if (m[1] === 'in') {
          const items = m[2].replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
          const marks = items.map((x) => (params.push(x), `$${params.length}`));
          where.push(`${col}::text in (${marks.join(', ')})`);
        } else {
          params.push(m[2]);
          where.push(`${col}::text ${OPS[m[1]]} $${params.length}`);
        }
      }
      const sql = `select ${select} from public.${table[1]}${where.length ? ` where ${where.join(' and ')}` : ''}${order}${limit}`;
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

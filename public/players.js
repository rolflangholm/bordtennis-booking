// Spillerlisten: faste navne, så den samme person ikke findes under flere navne.
import { $, esc, supabase, unwrap, rpc, toast } from './core.js?v=dev';

export const NEW = '__new__';
const players = { list: [], byLower: new Map() };

export async function loadPlayers() {
  const rows = unwrap(await supabase.from('players').select('name').eq('active', true).order('name'));
  players.list = rows.map((r) => r.name).sort((a, b) => a.localeCompare(b, 'da'));
  players.byLower = new Map(players.list.map((n) => [n.toLowerCase(), n]));
  return players.list;
}

export const isPlayer = (name) => Boolean(name && players.byLower.has(name.toLowerCase()));
export const canonical = (name) => (name && players.byLower.get(name.toLowerCase())) || name;
export const playerList = () => players.list;

// <option>'er til en spiller-dropdown. Et navn der ikke (længere) er på listen, vises stadig,
// så gamle kampe kan gemmes uden at skulle ændres.
export function playerOptions(selected, { empty = null } = {}) {
  const sel = (selected || '').toLowerCase();
  let html = empty != null ? `<option value=""${sel ? '' : ' selected'}>${esc(empty)}</option>` : '';
  if (sel && !players.byLower.has(sel)) {
    html += `<option value="${esc(selected)}" selected>${esc(selected)} (gammelt navn)</option>`;
  }
  html += players.list
    .map((n) => `<option value="${esc(n)}"${n.toLowerCase() === sel ? ' selected' : ''}>${esc(n)}</option>`)
    .join('');
  return `${html}<option value="${NEW}">+ Ny spiller…</option>`;
}

// ───── "Mente du …?" ─────

const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9æøå]/g, '');

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function similar(input) {
  const q = norm(input);
  if (q.length < 2) return [];
  return players.list
    .filter((n) => {
      const p = norm(n);
      const first = norm(n.split(/\s+/)[0]);
      return p.includes(q) || q.includes(p) || first === q || distance(p, q) <= Math.max(1, Math.floor(q.length / 4));
    })
    .slice(0, 6);
}

// Dialog til at oprette en ny spiller. Returnerer det valgte/oprettede navn eller null.
export function createPlayer(prefill = '') {
  return new Promise((resolve) => {
    const dlg = $('#playerDialog');
    const form = $('#playerForm');
    const hints = $('#playerHints');
    form.name.value = prefill;
    let done = false;
    const finish = (name) => {
      if (done) return;
      done = true;
      dlg.close();
      resolve(name);
    };
    const showHints = () => {
      const list = similar(form.name.value);
      hints.innerHTML = list.length
        ? `<p>Mente du en af dem? Så vælg den i stedet:</p>${list
            .map((n) => `<button type="button" class="chip-pick" data-pick="${esc(n)}">${esc(n)}</button>`)
            .join('')}`
        : '';
    };
    form.name.oninput = showHints;
    hints.onclick = (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) finish(b.dataset.pick);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const p = await rpc('add_player', { p_name: form.name.value });
        await loadPlayers();
        toast(`${p.name} er tilføjet til spillerlisten`);
        finish(p.name);
      } catch (err) {
        toast(err.message, true);
      }
    };
    dlg.onclose = () => finish(null);
    showHints();
    dlg.showModal();
    form.name.focus();
  });
}

// Når "+ Ny spiller…" vælges i en dropdown: opret spilleren og vælg den.
export function bindPlayerSelects(root, onChange = () => {}) {
  root.addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-player]');
    if (!sel) return;
    if (sel.value === NEW) {
      const previous = sel.dataset.prev || '';
      const name = await createPlayer();
      for (const s of root.querySelectorAll('select[data-player]')) {
        const keep = s === sel ? name || previous : s.value;
        s.innerHTML = playerOptions(keep, { empty: s.dataset.empty ?? null });
      }
    }
    sel.dataset.prev = sel.value;
    onChange(sel);
  });
}

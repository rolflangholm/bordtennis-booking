// Scoreboard: resultater, stillinger, køleskabsregnskab og fejring.
import {
  $, $$, esc, isoDate, parseDate, addDays, hhmm, toMinutes, isoWeek, mondayOf, fmt,
  supabase, unwrap, rpc, toast, tokens, teamName, teamText, reducedMotion,
} from './core.js?v=dev';
import { drinkSvg, drinkName, trophySvg } from './drinks.js?v=dev';
import { celebrate, stampPaid, stagger } from './celebrate.js?v=dev';

const sb = {
  mode: 'week', // 'day' | 'week' | 'all'
  anchor: new Date(),
  weekends: false,
  onChange: () => {},
};

const normalize = (r) => ({ ...r, start: hhmm(r.start) });

// ───── Data ─────

export async function resultsByBookingIds(ids) {
  if (!ids.length) return new Map();
  const rows = unwrap(await supabase.from('results').select('*').in('booking_id', ids));
  return new Map(rows.map((r) => [r.booking_id, normalize(r)]));
}

async function fetchRange(from, to) {
  let q = supabase.from('results').select('*').order('date', { ascending: false }).order('start', { ascending: false });
  if (from) q = q.gte('date', from);
  if (to) q = q.lte('date', to);
  return unwrap(await q.limit(1000)).map(normalize);
}

async function fetchUnpaid() {
  const rows = unwrap(
    await supabase
      .from('results')
      .select('*')
      .eq('paid', false)
      .order('date', { ascending: false })
      .order('start', { ascending: false })
      .limit(100),
  );
  return rows.map(normalize);
}

// ───── Små byggeklodser ─────

const winnersOf = (r) => (r.winner === 'A' ? r.team_a : r.team_b);
const losersOf = (r) => (r.winner === 'A' ? r.team_b : r.team_a);
const scoreText = (r) => (r.score_a == null ? '' : `${r.score_a}–${r.score_b}`);
const canEdit = (r) => Boolean(tokens.forResult(r));

function stakeChip(r) {
  return `<span class="stake-chip" title="${esc(drinkName(r.stake, r.stake_count))}">${drinkSvg(r.stake, { size: 30 })}<b>×${r.stake_count}</b></span>`;
}

// Linje under en booking i bookinglisten.
export function resultLine(r) {
  const s = scoreText(r);
  return `<div class="result-line">
    <span class="rl-trophy">🏆</span>
    <span><b>${teamName(winnersOf(r))}</b> vandt${s ? ` ${s}` : ''}</span>
    ${stakeChip(r)}
    <span class="paid-pill ${r.paid ? 'yes' : 'no'}">${r.paid ? 'Betalt' : 'Ikke betalt'}</span>
  </div>`;
}

// ───── Påmindelse: dine kampe uden resultat ─────

export async function renderPending(el) {
  const owned = Object.entries(tokens.bookings)
    .filter(([, t]) => t.owner)
    .map(([id]) => id);
  if (!owned.length) {
    el.hidden = true;
    return;
  }
  const since = isoDate(addDays(new Date(), -14));
  const bookings = unwrap(
    await supabase.from('bookings').select('id, date, start, seats').in('id', owned).gte('date', since),
  );
  // Glem nøgler til bookinger, der ikke findes længere (aflyst eller ryddet op).
  const alive = new Set(bookings.map((b) => b.id));
  let pruned = false;
  for (const id of owned) {
    if (!alive.has(id)) {
      delete tokens.bookings[id];
      pruned = true;
    }
  }
  if (pruned) tokens.save();

  const results = await resultsByBookingIds(bookings.map((b) => b.id));
  const now = new Date();
  const pending = bookings
    .map((b) => ({ ...b, start: hhmm(b.start) }))
    .filter((b) => {
      const startsAt = parseDate(b.date);
      startsAt.setMinutes(toMinutes(b.start));
      const started = startsAt <= now;
      const teams = b.seats.slice(0, 2).some(Boolean) && b.seats.slice(2).some(Boolean);
      return started && teams && !results.has(b.id);
    })
    .sort((a, b) => (a.date + a.start < b.date + b.start ? 1 : -1));

  if (!pending.length) {
    el.hidden = true;
    return;
  }
  const wasHidden = el.hidden;
  el.hidden = false;
  el.innerHTML = `
    <div class="pending-head">${trophySvg(34)}
      <div><b>Hvem vandt?</b><span>Du har ${pending.length === 1 ? 'én kamp' : `${pending.length} kampe`} uden resultat.</span></div>
    </div>
    <ul>${pending
      .map(
        (b) => `<li>
          <span class="p-when">${esc(fmt.short(parseDate(b.date)))} · ${b.start}</span>
          <span class="p-teams">${teamName(b.seats.slice(0, 2))} <i>vs</i> ${teamName(b.seats.slice(2))}</span>
          <button type="button" class="primary small" data-result-booking="${b.id}">Indtast</button>
        </li>`,
      )
      .join('')}</ul>`;
  el._pending = pending;
  if (wasHidden) stagger([el], { y: -10 });
}

// ───── Resultat-dialog ─────

let dlgCtx = null;

export function openResultDialog({ bookingId, date, start, teamA, teamB, result }) {
  const dlg = $('#resultDialog');
  const form = $('#resultForm');
  dlgCtx = {
    bookingId,
    result,
    teamA,
    teamB,
    winner: result?.winner ?? null,
    stake: result?.stake ?? 'monster',
    count: result?.stake_count ?? 2,
  };
  $('#resultWhen').textContent = `${fmt.full(parseDate(date))} kl. ${start}`;
  $('#pickA').innerHTML = `<span class="crown">👑</span><b>${teamName(teamA)}</b><small>Hold A</small>`;
  $('#pickB').innerHTML = `<span class="crown">👑</span><b>${teamName(teamB)}</b><small>Hold B</small>`;
  $('#stakeMonster .stake-art').innerHTML = drinkSvg('monster', { size: 92 });
  $('#stakeArla .stake-art').innerHTML = drinkSvg('arla', { size: 92 });
  form.sa.value = result?.score_a ?? '';
  form.sb.value = result?.score_b ?? '';
  $('#deleteResult').hidden = !result;
  $('#saveResult').textContent = result ? 'Gem ændringer' : 'Gem resultat';
  syncDialog();
  dlg.showModal();
}

function syncDialog() {
  const c = dlgCtx;
  $('#pickA').setAttribute('aria-pressed', c.winner === 'A');
  $('#pickB').setAttribute('aria-pressed', c.winner === 'B');
  $('#stakeMonster').setAttribute('aria-pressed', c.stake === 'monster');
  $('#stakeArla').setAttribute('aria-pressed', c.stake === 'arla');
  $('#stakeCount').textContent = c.count;
  const losers = c.winner ? (c.winner === 'A' ? c.teamB : c.teamA) : null;
  $('#stakeHint').textContent = losers
    ? `${teamText(losers)} giver ${drinkName(c.stake, c.count)}`
    : c.count === 2
      ? 'Én til hver vinder'
      : `${c.count} i alt`;
}

function bounce(el) {
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(.92)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
    { duration: 380, easing: 'cubic-bezier(.3,1.5,.5,1)' },
  );
}

async function saveResult(e) {
  e.preventDefault();
  const c = dlgCtx;
  const form = $('#resultForm');
  if (!c.winner) {
    toast('Vælg hvem der vandt', true);
    $$('.team-pick').forEach(bounce);
    return;
  }
  const sa = form.sa.value === '' ? null : Number(form.sa.value);
  const sbv = form.sb.value === '' ? null : Number(form.sb.value);
  const token = tokens.ownerOf(c.bookingId) || (c.result && tokens.forResult(c.result));
  try {
    const r = await rpc('save_result', {
      p_booking_id: c.bookingId,
      p_token: token,
      p_winner: c.winner,
      p_stake: c.stake,
      p_score_a: sa,
      p_score_b: sbv,
      p_stake_count: c.count,
    });
    tokens.results[r.id] = token;
    tokens.save();
    $('#resultDialog').close();
    const winners = winnersOf(r);
    const score = r.score_a == null ? null : [Math.max(r.score_a, r.score_b), Math.min(r.score_a, r.score_b)];
    sb.onChange();
    await celebrate({ winners, losers: losersOf(r), stake: r.stake, count: r.stake_count, score });
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteResult() {
  const r = dlgCtx?.result;
  if (!r || !confirm('Slet resultatet?')) return;
  try {
    await rpc('delete_result', { p_result_id: r.id, p_token: tokens.forResult(r) });
    delete tokens.results[r.id];
    tokens.save();
    $('#resultDialog').close();
    toast('Resultatet er slettet');
    sb.onChange();
  } catch (err) {
    toast(err.message, true);
  }
}

// ───── Scoreboard-visning ─────

function periodRange() {
  if (sb.mode === 'all') return { from: null, to: null, label: 'Hele tiden' };
  if (sb.mode === 'day') {
    const iso = isoDate(sb.anchor);
    const today = isoDate(new Date());
    const label = iso === today ? `I dag · ${fmt.dayMonth(sb.anchor)}` : fmt.full(sb.anchor);
    return { from: iso, to: iso, label };
  }
  const mon = mondayOf(sb.anchor);
  const sun = addDays(mon, 6);
  const thisWeek = isoDate(mondayOf(new Date())) === isoDate(mon);
  return {
    from: isoDate(mon),
    to: isoDate(sun),
    label: `${thisWeek ? 'Denne uge' : `Uge ${isoWeek(mon)}`} · ${fmt.dayMonth(mon)}–${fmt.dayMonth(sun)}`,
  };
}

function shiftPeriod(dir) {
  if (sb.mode === 'week') sb.anchor = addDays(sb.anchor, 7 * dir);
  if (sb.mode === 'day') {
    let d = addDays(sb.anchor, dir);
    while (!sb.weekends && (d.getDay() === 0 || d.getDay() === 6)) d = addDays(d, dir);
    sb.anchor = d;
  }
  loadScoreboard();
}

function standings(results) {
  const map = new Map();
  const get = (name) => {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, { name, games: 0, wins: 0, losses: 0, monster: 0, arla: 0, owes: 0 });
    return map.get(key);
  };
  for (const r of results) {
    const w = winnersOf(r);
    const l = losersOf(r);
    for (const n of w) {
      const p = get(n);
      p.games++;
      p.wins++;
      p[r.stake] += r.stake_count / w.length;
    }
    for (const n of l) {
      const p = get(n);
      p.games++;
      p.losses++;
      if (!r.paid) p.owes += r.stake_count / l.length;
    }
  }
  return [...map.values()].sort(
    (a, b) => b.wins - a.wins || b.wins / b.games - a.wins / a.games || b.games - a.games || a.name.localeCompare(b.name, 'da'),
  );
}

const num = (n) => (Number.isInteger(n) ? n : n.toFixed(1).replace('.', ','));
const initials = (name) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function renderPodium(rows) {
  const top = rows.filter((p) => p.wins > 0).slice(0, 3);
  if (!top.length) return '';
  const order = [top[1], top[0], top[2]];
  const place = [2, 1, 3];
  return `<div class="podium">${order
    .map((p, i) =>
      p
        ? `<div class="pod pod-${place[i]}">
            <div class="pod-avatar">${esc(initials(p.name))}${place[i] === 1 ? '<span class="pod-crown">👑</span>' : ''}</div>
            <div class="pod-name">${esc(p.name)}</div>
            <div class="pod-sub">${p.wins} ${p.wins === 1 ? 'sejr' : 'sejre'}</div>
            <div class="pod-block"><span>${place[i]}</span></div>
          </div>`
        : '<div class="pod pod-empty"></div>',
    )
    .join('')}</div>`;
}

function renderTable(rows) {
  if (!rows.length) return '';
  return `<div class="board-wrap"><table class="board">
    <thead><tr><th>#</th><th class="l">Spiller</th><th class="opt" title="Kampe">K</th><th title="Sejre">V</th><th title="Nederlag">T</th>
      <th class="opt" title="Sejrsprocent">%</th><th title="Hvide Monster vundet">${drinkSvg('monster', { size: 24 })}</th>
      <th title="Arla Protein vundet">${drinkSvg('arla', { size: 24 })}</th></tr></thead>
    <tbody>${rows
      .map(
        (p, i) => `<tr>
          <td class="rank">${i + 1}</td>
          <td class="l"><span class="avatar">${esc(initials(p.name))}</span>${esc(p.name)}${p.owes ? ` <span class="owes" title="Skylder stadig">skylder ${num(p.owes)}</span>` : ''}</td>
          <td class="opt">${p.games}</td><td class="w">${p.wins}</td><td>${p.losses}</td>
          <td class="opt">${Math.round((p.wins / p.games) * 100)}</td>
          <td>${p.monster ? num(p.monster) : '–'}</td><td>${p.arla ? num(p.arla) : '–'}</td>
        </tr>`,
      )
      .join('')}</tbody></table></div>`;
}

function resultItem(r, { withDate = false } = {}) {
  const edit = canEdit(r);
  const aWin = r.winner === 'A';
  const s = scoreText(r);
  const tip = edit ? '' : 'title="Kun den der bookede bordet kan krydse af"';
  return `<li class="res${r.paid ? ' is-paid' : ''}" data-id="${r.id}">
    <div class="res-time">${withDate ? `<small>${esc(fmt.tiny(parseDate(r.date)))}</small>` : ''}${r.start}</div>
    <div class="res-teams">
      <span class="t${aWin ? ' win' : ''}">${aWin ? '🏆 ' : ''}${teamName(r.team_a)}</span>
      <span class="res-score">${s || 'vs'}</span>
      <span class="t${aWin ? '' : ' win'}">${aWin ? '' : '🏆 '}${teamName(r.team_b)}</span>
    </div>
    <div class="res-side">
      ${stakeChip(r)}
      <label class="paid" ${tip}><input type="checkbox" data-paid="${r.id}" ${r.paid ? 'checked' : ''} ${edit ? '' : 'disabled'}>
        <span>Betalt</span></label>
      ${edit && r.booking_id ? `<button type="button" class="icon-btn" data-edit-result="${r.id}" title="Ret resultat">✎</button>` : ''}
    </div>
    ${r.paid ? '<span class="stamp">Betalt ✓</span>' : ''}
  </li>`;
}

function renderHistory(results) {
  if (!results.length) return '';
  const byDay = new Map();
  for (const r of results) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  let lastWeek = null;
  let html = '';
  for (const [date, list] of byDay) {
    const d = parseDate(date);
    const wk = isoWeek(d);
    if (sb.mode === 'all' && wk !== lastWeek) {
      html += `<h4 class="week-head">Uge ${wk}</h4>`;
      lastWeek = wk;
    }
    html += `<div class="day-group"><h5>${esc(fmt.full(d))} <span>uge ${wk}</span></h5>
      <ul class="res-list">${list.map((r) => resultItem(r)).join('')}</ul></div>`;
  }
  return html;
}

let lastResults = [];
let lastUnpaid = [];

export async function loadScoreboard() {
  const { from, to, label } = periodRange();
  $('#periodLabel').textContent = label;
  $('#periodNav').hidden = sb.mode === 'all';
  const today = isoDate(new Date());
  $('#periodNext').disabled = Boolean(to && to >= today);
  $$('#scoreTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === sb.mode));

  const [results, unpaid] = await Promise.all([fetchRange(from, to), fetchUnpaid()]);
  lastResults = results;
  lastUnpaid = unpaid;
  const rows = standings(results);
  const count = (stake) => results.filter((r) => r.stake === stake).reduce((s, r) => s + r.stake_count, 0);
  const owed = unpaid.reduce((s, r) => s + r.stake_count, 0);

  $('#scoreStats').innerHTML = [
    ['Kampe', results.length, '🏓'],
    ['Hvide Monster', count('monster'), drinkSvg('monster', { size: 34 })],
    ['Protein kakao', count('arla'), drinkSvg('arla', { size: 34 })],
    ['I køleskabet', owed, '🧊'],
  ]
    .map(([l, n, icon]) => `<div class="stat"><span class="stat-icon">${icon}</span><b data-n="${n}">${n}</b><span>${l}</span></div>`)
    .join('');

  $('#scoreBody').innerHTML = results.length
    ? `${renderPodium(rows)}${renderTable(rows)}`
    : `<div class="empty">${trophySvg(56)}<p><b>Ingen kampe ${sb.mode === 'day' ? 'denne dag' : sb.mode === 'week' ? 'denne uge' : 'endnu'}.</b>
       Når den der bookede indtaster resultatet, dukker det op her.</p></div>`;

  $('#fridge').innerHTML = unpaid.length
    ? `<ul class="res-list">${unpaid.map((r) => resultItem(r, { withDate: true })).join('')}</ul>`
    : `<p class="muted">Alt er betalt. Køleskabet er i balance 🧊</p>`;
  $('#fridgeCount').textContent = unpaid.length ? `${owed} ${owed === 1 ? 'drik' : 'drikke'} mangler` : '';

  $('#history').innerHTML = renderHistory(results) || '<p class="muted">Ingen kampe i perioden.</p>';
  $('#historyTitle').textContent = sb.mode === 'all' ? 'Alle kampe' : 'Kampe i perioden';

  animateBoard();
}

function animateBoard() {
  stagger($$('#scoreStats .stat'), { gap: 60 });
  $$('.pod').forEach((p, i) => {
    const block = p.querySelector('.pod-block');
    if (!block || reducedMotion()) return;
    const delay = [250, 0, 450][i];
    block.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
      duration: 700,
      delay,
      easing: 'cubic-bezier(.2,1.2,.4,1)',
      fill: 'backwards',
    });
    for (const el of p.querySelectorAll('.pod-avatar, .pod-name, .pod-sub')) {
      el.animate(
        [
          { opacity: 0, transform: 'translateY(16px) scale(.6)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 600, delay: delay + 350, easing: 'cubic-bezier(.2,1.4,.4,1)', fill: 'backwards' },
      );
    }
  });
  stagger($$('.board tbody tr'), { delay: 300, gap: 40 });
  stagger($$('#history .day-group, #history .week-head'), { delay: 200, gap: 50 });
}

async function togglePaid(input) {
  const id = input.dataset.paid;
  const r = [...lastResults, ...lastUnpaid].find((x) => x.id === id);
  if (!r) return;
  const paid = input.checked;
  try {
    await rpc('set_result_paid', { p_result_id: id, p_token: tokens.forResult(r), p_paid: paid });
    if (paid) {
      stampPaid(input.closest('.res'));
      toast(`${drinkName(r.stake, r.stake_count)} er taget fra køleskabet 🧊`);
      setTimeout(() => sb.onChange(), 1100);
    } else {
      sb.onChange();
    }
  } catch (err) {
    input.checked = !paid;
    toast(err.message, true);
  }
}

export function scoreboardEvents({ onChange, weekends }) {
  sb.onChange = onChange;
  sb.weekends = weekends;
  sb.mode = localStorage.getItem('bt-scoreMode') || 'week';

  $('#scoreTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    sb.mode = b.dataset.mode;
    sb.anchor = new Date();
    try {
      localStorage.setItem('bt-scoreMode', sb.mode);
    } catch {}
    loadScoreboard();
  });
  $('#periodPrev').addEventListener('click', () => shiftPeriod(-1));
  $('#periodNext').addEventListener('click', () => shiftPeriod(1));
  $('#periodLabel').addEventListener('click', () => {
    sb.anchor = new Date();
    loadScoreboard();
  });

  document.addEventListener('change', (e) => {
    if (e.target.matches('input[data-paid]')) togglePaid(e.target);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.editResult) {
      const r = [...lastResults, ...lastUnpaid].find((x) => x.id === b.dataset.editResult);
      if (r) {
        openResultDialog({ bookingId: r.booking_id, date: r.date, start: r.start, teamA: r.team_a, teamB: r.team_b, result: r });
      }
    }
  });

  // Dialogens knapper
  $('#pickA').addEventListener('click', (e) => {
    dlgCtx.winner = 'A';
    syncDialog();
    bounce(e.currentTarget);
  });
  $('#pickB').addEventListener('click', (e) => {
    dlgCtx.winner = 'B';
    syncDialog();
    bounce(e.currentTarget);
  });
  for (const [id, stake] of [
    ['#stakeMonster', 'monster'],
    ['#stakeArla', 'arla'],
  ]) {
    $(id).addEventListener('click', (e) => {
      dlgCtx.stake = stake;
      syncDialog();
      const art = e.currentTarget.querySelector('.drink');
      art?.animate(
        [
          { transform: 'translateY(0) rotate(0)' },
          { transform: 'translateY(-14px) rotate(-8deg)' },
          { transform: 'translateY(0) rotate(5deg)' },
          { transform: 'translateY(-4px) rotate(-2deg)' },
          { transform: 'none' },
        ],
        { duration: 600, easing: 'cubic-bezier(.3,1.4,.5,1)' },
      );
    });
  }
  $('#countMinus').addEventListener('click', () => {
    dlgCtx.count = Math.max(1, dlgCtx.count - 1);
    syncDialog();
  });
  $('#countPlus').addEventListener('click', () => {
    dlgCtx.count = Math.min(8, dlgCtx.count + 1);
    syncDialog();
  });
  $('#resultForm').addEventListener('submit', saveResult);
  $('#deleteResult').addEventListener('click', deleteResult);
}


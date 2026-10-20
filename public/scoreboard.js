// Scoreboard: resultater, gæld pr. person, stillinger, udestående drikke og fejring.
import {
  $, $$, esc, isoDate, parseDate, addDays, hhmm, toMinutes, isoWeek, mondayOf, fmt,
  supabase, unwrap, rpc, toast, tokens, teamName, reducedMotion, storage,
} from './core.js?v=dev';
import { DRINKS, drinkSvg, trophySvg } from './drinks.js?v=dev';
import { celebrate, stampPaid, stagger } from './celebrate.js?v=dev';
import { playerOptions, bindPlayerSelects } from './players.js?v=dev';

const sb = {
  mode: 'week', // 'day' | 'week' | 'month' | 'all'
  anchor: new Date(),
  weekends: false,
  myName: () => '',
  onChange: () => {},
};

// ───── Data ─────

async function attachDebts(rows) {
  const results = rows.map((r) => ({ ...r, start: hhmm(r.start), debts: [] }));
  if (!results.length) return results;
  const debts = unwrap(
    await supabase
      .from('result_debts')
      .select('*')
      .in('result_id', results.map((r) => r.id))
      .order('position'),
  );
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const d of debts) byId.get(d.result_id)?.debts.push(d);
  return results;
}

export async function resultsByBookingIds(ids) {
  if (!ids.length) return new Map();
  const rows = await attachDebts(unwrap(await supabase.from('results').select('*').in('booking_id', ids)));
  return new Map(rows.map((r) => [r.booking_id, r]));
}

async function fetchRange(from, to) {
  let q = supabase.from('results').select('*').order('date', { ascending: false }).order('start', { ascending: false });
  if (from) q = q.gte('date', from);
  if (to) q = q.lte('date', to);
  return attachDebts(unwrap(await q.limit(1000)));
}

// Al ubetalt gæld (uanset periode), med kampen den hører til.
async function fetchUnpaid() {
  const debts = unwrap(await supabase.from('result_debts').select('*').eq('paid', false).limit(300));
  if (!debts.length) return [];
  const ids = [...new Set(debts.map((d) => d.result_id))];
  const results = await attachDebts(unwrap(await supabase.from('results').select('*').in('id', ids)));
  return results.sort((a, b) => (a.date + a.start < b.date + b.start ? 1 : -1));
}

// ───── Små byggeklodser ─────

const winnersOf = (r) => (r.winner === 'A' ? r.team_a : r.team_b);
const losersOf = (r) => (r.winner === 'A' ? r.team_b : r.team_a);
const scoreText = (r) => (r.score_a == null ? '' : `${r.score_a}–${r.score_b}`);
const canEdit = (r) => Boolean(tokens.forResult(r));
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

let lastResults = [];
let lastUnpaid = [];

const allResults = () => [...lastResults, ...lastUnpaid];
function findDebt(id) {
  for (const r of allResults()) {
    const d = r.debts.find((x) => x.id === id);
    if (d) return { r, d };
  }
  return null;
}

function drinkChips(debts) {
  return debts
    .map(
      (d) =>
        `<span class="mini-drink${d.paid ? ' paid' : ''}" title="${esc(`${d.debtor} → ${d.creditor}: ${DRINKS[d.stake].name}${d.paid ? ' (betalt)' : ''}`)}">${drinkSvg(d.stake, { size: 26 })}</span>`,
    )
    .join('');
}

// Linje under en booking i bookinglisten.
export function resultLine(r) {
  const s = scoreText(r);
  const paid = r.debts.filter((d) => d.paid).length;
  return `<div class="result-line">
    <span class="rl-trophy">🏆</span>
    <span><b>${teamName(winnersOf(r))}</b> vandt${s ? ` ${s}` : ''}</span>
    ${
      r.debts.length
        ? `<span class="stake-chip">${drinkChips(r.debts)}</span>
           <span class="paid-pill ${paid === r.debts.length ? 'yes' : 'no'}">${paid}/${r.debts.length} betalt</span>`
        : '<span class="no-stake">Ingen drik</span>'
    }
  </div>`;
}

// ───── Påmindelse: dine kampe uden resultat ─────

export async function renderPending(el) {
  const mine = Object.keys(tokens.bookings).filter((id) => tokens.isPlayer(id));
  if (!mine.length) {
    el.hidden = true;
    return;
  }
  const since = isoDate(addDays(new Date(), -14));
  const bookings = unwrap(
    await supabase.from('bookings').select('id, date, start, seats').in('id', mine).gte('date', since),
  );
  // Glem nøgler til bookinger, der ikke findes længere (aflyst eller ryddet op).
  const alive = new Set(bookings.map((b) => b.id));
  const gone = mine.filter((id) => !alive.has(id));
  if (gone.length) {
    gone.forEach((id) => delete tokens.bookings[id]);
    tokens.save();
  }

  const results = await resultsByBookingIds(bookings.map((b) => b.id));
  const now = new Date();
  const pending = bookings
    .map((b) => ({ ...b, start: hhmm(b.start) }))
    .filter((b) => {
      const startsAt = parseDate(b.date);
      startsAt.setMinutes(toMinutes(b.start));
      const teams = b.seats.slice(0, 2).some(Boolean) && b.seats.slice(2).some(Boolean);
      return startsAt <= now && teams && !results.has(b.id);
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
      <div><b>Hvem vandt?</b><span>${pending.length === 1 ? 'Én kamp' : `${pending.length} kampe`} mangler resultat. Spillerne i kampen kan indtaste det.</span></div>
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

// Standard: taberne parres med vinderne (1→1, 2→2), alle om samme drik.
function defaultDebts(winners, losers, stake = 'monster') {
  const n = Math.max(winners.length, losers.length);
  return Array.from({ length: n }, (_, i) => ({
    debtor: losers[i % losers.length],
    creditor: winners[i % winners.length],
    stake,
  }));
}

export function openResultDialog({ bookingId, date, start, teamA, teamB, result }) {
  dlgCtx = {
    bookingId,
    result,
    teamA,
    teamB,
    winner: result?.winner ?? null,
    noDrink: result ? result.debts.length === 0 : false,
    debts: result ? result.debts.map(({ debtor, creditor, stake }) => ({ debtor, creditor, stake })) : [],
  };
  const form = $('#resultForm');
  $('#resultWhen').textContent = `${capitalize(fmt.full(parseDate(date)))} kl. ${start}`;
  // Holdene kan rettes, hvis der stod et forkert navn i bookingen.
  form.ta1.innerHTML = playerOptions(teamA[0]);
  form.ta2.innerHTML = playerOptions(teamA[1], { empty: '— Ingen —' });
  form.tb1.innerHTML = playerOptions(teamB[0]);
  form.tb2.innerHTML = playerOptions(teamB[1], { empty: '— Ingen —' });
  $('#teamEdit').open = false;
  renderTeamPicks();
  form.sa.value = result?.score_a ?? '';
  form.sb.value = result?.score_b ?? '';
  $('#deleteResult').hidden = !result;
  $('#saveResult').textContent = result ? 'Gem ændringer' : 'Gem resultat';
  syncDialog();
  $('#resultDialog').showModal();
}

function renderTeamPicks() {
  $('#pickA').innerHTML = `<span class="crown">👑</span><b>${teamName(dlgCtx.teamA)}</b><small>Hold A</small>`;
  $('#pickB').innerHTML = `<span class="crown">👑</span><b>${teamName(dlgCtx.teamB)}</b><small>Hold B</small>`;
}

// Når holdene rettes: opdatér knapperne og fjern gæld med navne, der ikke længere er med.
function teamsChanged() {
  const f = $('#resultForm');
  dlgCtx.teamA = [f.ta1.value, f.ta2.value].filter(Boolean);
  dlgCtx.teamB = [f.tb1.value, f.tb2.value].filter(Boolean);
  renderTeamPicks();
  if (dlgCtx.winner) {
    const has = (team, n) => team().some((x) => x.toLowerCase() === (n || '').toLowerCase());
    const ok = dlgCtx.debts.every((d) => has(loseTeam, d.debtor) && has(winTeam, d.creditor));
    if (!ok && !dlgCtx.noDrink) dlgCtx.debts = defaultDebts(winTeam(), loseTeam(), dlgCtx.debts[0]?.stake || 'monster');
  }
  syncDialog();
}

const winTeam = () => (dlgCtx.winner === 'A' ? dlgCtx.teamA : dlgCtx.teamB);
const loseTeam = () => (dlgCtx.winner === 'A' ? dlgCtx.teamB : dlgCtx.teamA);

function options(names, selected) {
  return names
    .map(
      (n) =>
        `<option value="${esc(n)}"${n.toLowerCase() === (selected || '').toLowerCase() ? ' selected' : ''}>${esc(n)}</option>`,
    )
    .join('');
}

function syncDialog() {
  const c = dlgCtx;
  $('#pickA').setAttribute('aria-pressed', c.winner === 'A');
  $('#pickB').setAttribute('aria-pressed', c.winner === 'B');
  $('#noDrink').setAttribute('aria-pressed', c.noDrink);
  const box = $('#debtRows');
  if (c.noDrink) {
    box.innerHTML = '<p class="no-drink-note">Spillet for æren – ingen drik denne gang 🏅</p>';
    $('#addDebt').hidden = true;
    $('#debtSummary').textContent = '';
    return;
  }
  if (!c.winner) {
    box.innerHTML = '<p class="muted debt-empty">Vælg først hvem der vandt.</p>';
    $('#addDebt').hidden = true;
    $('#debtSummary').textContent = '';
    return;
  }
  $('#addDebt').hidden = c.debts.length >= 8;
  box.innerHTML = c.debts
    .map(
      (d, i) => `<div class="debt-row" data-i="${i}">
        <label class="sel"><span>Giver</span><select data-field="debtor">${options(loseTeam(), d.debtor)}</select></label>
        <span class="arrow" aria-hidden="true">→</span>
        <label class="sel"><span>Til</span><select data-field="creditor">${options(winTeam(), d.creditor)}</select></label>
        <div class="stake-toggle" role="group" aria-label="Drik">
          ${['monster', 'arla']
            .map(
              (s) => `<button type="button" data-stake="${s}" aria-pressed="${d.stake === s}" title="${DRINKS[s].name}">
                ${drinkSvg(s, { size: 44 })}<small>${s === 'monster' ? 'Monster' : 'Protein'}</small></button>`,
            )
            .join('')}
        </div>
        <button type="button" class="icon-btn remove" data-remove="${i}" aria-label="Fjern drik" ${c.debts.length === 1 ? 'disabled' : ''}>×</button>
      </div>`,
    )
    .join('');
  $('#debtSummary').textContent = c.debts
    .map((d) => `${d.debtor} giver ${d.creditor} en ${d.stake === 'monster' ? 'hvid Monster' : 'Protein kakao'}`)
    .join(' · ');
}

function bounce(el) {
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(.92)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
    { duration: 380, easing: 'cubic-bezier(.3,1.5,.5,1)' },
  );
}

function pickWinner(team, el) {
  const changed = dlgCtx.winner !== team;
  dlgCtx.winner = team;
  if (changed && !dlgCtx.noDrink) dlgCtx.debts = defaultDebts(winTeam(), loseTeam(), dlgCtx.debts[0]?.stake || 'monster');
  syncDialog();
  bounce(el);
  if (changed) stagger($$('#debtRows .debt-row'), { gap: 70, y: 8 });
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
  const token = tokens.forMatch(c.bookingId) || (c.result && tokens.forResult(c.result));
  if (!token) {
    toast('Kun spillerne i kampen kan indtaste resultatet. Har du valgt dit navn under "Hvem er du?"?', true);
    return;
  }
  if (!c.teamA.length || !c.teamB.length) {
    toast('Begge hold skal have mindst én spiller', true);
    return;
  }
  const sa = form.sa.value === '' ? null : Number(form.sa.value);
  const sbv = form.sb.value === '' ? null : Number(form.sb.value);
  try {
    const r = await rpc('save_result', {
      p_booking_id: c.bookingId,
      p_token: token,
      p_winner: c.winner,
      p_debts: c.noDrink ? [] : c.debts,
      p_score_a: sa,
      p_score_b: sbv,
      p_team_a: c.teamA,
      p_team_b: c.teamB,
    });
    tokens.results[r.id] = token;
    tokens.save();
    $('#resultDialog').close();
    const score = r.score_a == null ? null : [Math.max(r.score_a, r.score_b), Math.min(r.score_a, r.score_b)];
    const me = (sb.myName() || '').toLowerCase();
    sb.onChange(); // en taber, der selv indtaster resultatet, får taber-animationen i stedet
    if (!losersOf(r).some((n) => n.toLowerCase() === me)) {
      await celebrate({ winners: winnersOf(r), debts: r.debts, score });
    }
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

// ───── Udestående drikke (pr. produkt) ─────

function renderOwed(unpaid) {
  $('#owed').innerHTML = ['monster', 'arla']
    .map((stake) => {
      const owed = unpaid.flatMap((r) => r.debts.filter((d) => !d.paid && d.stake === stake).map((d) => ({ r, d })));
      return `<section class="fridge-shelf shelf-${stake}">
        <div class="shelf-head">
          <div class="shelf-art">${drinkSvg(stake, { size: 78 })}</div>
          <div class="shelf-info">
            <h4>${esc(DRINKS[stake].name)}</h4>
            <div class="stock"><b>${owed.length}</b><span>mangler at blive givet</span></div>
          </div>
        </div>
        <div class="shelf-owed">
          ${
            owed.length
              ? `<ul class="debt-list">${owed.map(({ r, d }) => debtItem(r, d, { withDate: true })).join('')}</ul>`
              : '<p class="muted">Ingen skylder. 🎉</p>'
          }
        </div>
      </section>`;
    })
    .join('');
}

// ───── Scoreboard-visning ─────

function periodRange() {
  const today = new Date();
  if (sb.mode === 'all') return { from: null, to: null, label: 'Hele tiden' };
  if (sb.mode === 'day') {
    const iso = isoDate(sb.anchor);
    const label = iso === isoDate(today) ? `I dag · ${fmt.dayMonth(sb.anchor)}` : capitalize(fmt.full(sb.anchor));
    return { from: iso, to: iso, label };
  }
  if (sb.mode === 'month') {
    const first = new Date(sb.anchor.getFullYear(), sb.anchor.getMonth(), 1);
    const last = new Date(sb.anchor.getFullYear(), sb.anchor.getMonth() + 1, 0);
    const name = first.toLocaleDateString('da-DK', { month: 'long', year: 'numeric' });
    const thisMonth = first.getMonth() === today.getMonth() && first.getFullYear() === today.getFullYear();
    return { from: isoDate(first), to: isoDate(last), label: thisMonth ? `Denne måned · ${name}` : capitalize(name) };
  }
  const mon = mondayOf(sb.anchor);
  const sun = addDays(mon, 6);
  const thisWeek = isoDate(mondayOf(today)) === isoDate(mon);
  return {
    from: isoDate(mon),
    to: isoDate(sun),
    label: `${thisWeek ? 'Denne uge' : `Uge ${isoWeek(mon)}`} · ${fmt.dayMonth(mon)}–${fmt.dayMonth(sun)}`,
  };
}

function shiftPeriod(dir) {
  if (sb.mode === 'week') sb.anchor = addDays(sb.anchor, 7 * dir);
  if (sb.mode === 'month') sb.anchor = new Date(sb.anchor.getFullYear(), sb.anchor.getMonth() + dir, 1);
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
    for (const n of winnersOf(r)) {
      const p = get(n);
      p.games++;
      p.wins++;
    }
    for (const n of losersOf(r)) {
      const p = get(n);
      p.games++;
      p.losses++;
    }
    for (const d of r.debts) {
      get(d.creditor)[d.stake]++;
      if (!d.paid) get(d.debtor).owes++;
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.wins - a.wins || b.wins / b.games - a.wins / a.games || b.games - a.games || a.name.localeCompare(b.name, 'da'),
  );
}

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
          <td class="l"><span class="avatar">${esc(initials(p.name))}</span>${esc(p.name)}${p.owes ? ` <span class="owes" title="Skylder stadig">skylder ${p.owes}</span>` : ''}</td>
          <td class="opt">${p.games}</td><td class="w">${p.wins}</td><td>${p.losses}</td>
          <td class="opt">${Math.round((p.wins / p.games) * 100)}</td>
          <td>${p.monster || '–'}</td><td>${p.arla || '–'}</td>
        </tr>`,
      )
      .join('')}</tbody></table></div>`;
}

function debtItem(r, d, { withDate = false } = {}) {
  const edit = canEdit(r);
  const tip = edit ? '' : 'title="Kun spillerne i kampen kan krydse af"';
  return `<li class="debt${d.paid ? ' is-paid' : ''}">
    ${drinkSvg(d.stake, { size: 30 })}
    <span class="debt-who"><span><b>${esc(d.debtor)}</b> <i>→</i> ${esc(d.creditor)}</span>${withDate ? `<small>${esc(fmt.tiny(parseDate(r.date)))} · ${r.start}</small>` : ''}</span>
    <label class="paid" ${tip}><input type="checkbox" data-debt="${d.id}" ${d.paid ? 'checked' : ''} ${edit ? '' : 'disabled'}>
      <span>Betalt</span></label>
    ${d.paid ? '<span class="stamp">Betalt ✓</span>' : ''}
  </li>`;
}

function resultItem(r) {
  const edit = canEdit(r);
  const aWin = r.winner === 'A';
  const s = scoreText(r);
  return `<li class="res" data-id="${r.id}">
    <div class="res-top">
      <div class="res-time">${r.start}</div>
      <div class="res-teams">
        <span class="t${aWin ? ' win' : ''}">${aWin ? '🏆 ' : ''}${teamName(r.team_a)}</span>
        <span class="res-score">${s || 'vs'}</span>
        <span class="t${aWin ? '' : ' win'}">${aWin ? '' : '🏆 '}${teamName(r.team_b)}</span>
      </div>
      ${edit && r.booking_id ? `<button type="button" class="icon-btn" data-edit-result="${r.id}" title="Ret resultat">✎</button>` : ''}
    </div>
    ${
      r.debts.length
        ? `<ul class="debt-list">${r.debts.map((d) => debtItem(r, d)).join('')}</ul>`
        : '<p class="no-stake res-nostake">Ingen drik – spillet for æren</p>'
    }
  </li>`;
}

function renderHistory(results) {
  if (!results.length) return '';
  const byDay = new Map();
  for (const r of results) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  let lastGroup = null;
  let html = '';
  for (const [date, list] of byDay) {
    const d = parseDate(date);
    const wk = isoWeek(d);
    const group =
      sb.mode === 'all'
        ? capitalize(d.toLocaleDateString('da-DK', { month: 'long', year: 'numeric' }))
        : sb.mode === 'month'
          ? `Uge ${wk}`
          : null;
    if (group && group !== lastGroup) {
      html += `<h4 class="week-head">${esc(group)}</h4>`;
      lastGroup = group;
    }
    html += `<div class="day-group"><h5>${esc(capitalize(fmt.full(d)))} <span>uge ${wk}</span></h5>
      <ul class="res-list">${list.map((r) => resultItem(r)).join('')}</ul></div>`;
  }
  return html;
}

export async function loadScoreboard() {
  const { from, to, label } = periodRange();
  $('#periodLabel').textContent = label;
  $('#periodNav').hidden = sb.mode === 'all';
  $('#periodNext').disabled = Boolean(to && to >= isoDate(new Date()));
  $$('#scoreTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === sb.mode));

  const [results, unpaid] = await Promise.all([fetchRange(from, to), fetchUnpaid()]);
  lastResults = results;
  lastUnpaid = unpaid;
  const rows = standings(results);
  const allDebts = results.flatMap((r) => r.debts);
  const count = (stake) => allDebts.filter((d) => d.stake === stake).length;
  const owed = unpaid.flatMap((r) => r.debts.filter((d) => !d.paid)).length;

  $('#scoreStats').innerHTML = [
    ['Kampe', results.length, '🏓'],
    ['Hvide Monster', count('monster'), drinkSvg('monster', { size: 34 })],
    ['Protein kakao', count('arla'), drinkSvg('arla', { size: 34 })],
    ['Skyldes i alt', owed, '🧾'],
  ]
    .map(([l, n, icon]) => `<div class="stat"><span class="stat-icon">${icon}</span><b>${n}</b><span>${l}</span></div>`)
    .join('');

  const periodWord = { day: 'denne dag', week: 'denne uge', month: 'denne måned', all: 'endnu' }[sb.mode];
  $('#scoreBody').innerHTML = results.length
    ? `${renderPodium(rows)}${renderTable(rows)}`
    : `<div class="empty">${trophySvg(56)}<p><b>Ingen kampe ${periodWord}.</b>
       Når en af spillerne indtaster resultatet, dukker det op her.</p></div>`;

  renderOwed(unpaid);
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
  stagger($$('.fridge-shelf'), { delay: 150, gap: 120 });
  stagger($$('#history .day-group, #history .week-head'), { delay: 200, gap: 50 });
}

async function toggleDebt(input) {
  const hit = findDebt(input.dataset.debt);
  if (!hit) return;
  const { r, d } = hit;
  const paid = input.checked;
  try {
    await rpc('set_debt_paid', { p_debt_id: d.id, p_token: tokens.forResult(r), p_paid: paid });
    if (paid) {
      stampPaid(input.closest('.debt'));
      toast(`${d.debtor} → ${d.creditor}: ${DRINKS[d.stake].short} er betalt ✓`);
      setTimeout(() => sb.onChange(), 1100);
    } else {
      sb.onChange();
    }
  } catch (err) {
    input.checked = !paid;
    toast(err.message, true);
  }
}

export function scoreboardEvents({ onChange, weekends, myName }) {
  sb.onChange = onChange;
  sb.weekends = weekends;
  sb.myName = myName;
  sb.mode = storage.get('bt-scoreMode', 'week');

  $('#scoreTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    sb.mode = b.dataset.mode;
    sb.anchor = new Date();
    storage.set('bt-scoreMode', sb.mode);
    loadScoreboard();
  });
  $('#periodPrev').addEventListener('click', () => shiftPeriod(-1));
  $('#periodNext').addEventListener('click', () => shiftPeriod(1));
  $('#periodLabel').addEventListener('click', () => {
    sb.anchor = new Date();
    loadScoreboard();
  });

  document.addEventListener('change', (e) => {
    if (e.target.matches('input[data-debt]')) toggleDebt(e.target);
    const row = e.target.closest('#debtRows .debt-row');
    if (row && e.target.matches('select[data-field]')) {
      dlgCtx.debts[Number(row.dataset.i)][e.target.dataset.field] = e.target.value;
      syncDialog();
    }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.editResult) {
      const r = allResults().find((x) => x.id === b.dataset.editResult);
      if (r) {
        openResultDialog({ bookingId: r.booking_id, date: r.date, start: r.start, teamA: r.team_a, teamB: r.team_b, result: r });
      }
      return;
    }
    const row = b.closest('#debtRows .debt-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (b.dataset.stake) {
      dlgCtx.debts[i].stake = b.dataset.stake;
      syncDialog();
      $(`#debtRows .debt-row[data-i="${i}"] [data-stake="${b.dataset.stake}"] .drink`)?.animate(
        [
          { transform: 'translateY(0) rotate(0)' },
          { transform: 'translateY(-10px) rotate(-8deg)' },
          { transform: 'translateY(0) rotate(5deg)' },
          { transform: 'none' },
        ],
        { duration: 520, easing: 'cubic-bezier(.3,1.4,.5,1)' },
      );
    } else if (b.dataset.remove != null) {
      dlgCtx.debts.splice(i, 1);
      syncDialog();
    }
  });

  bindPlayerSelects($('#teamEdit'), teamsChanged);
  $('#noDrink').addEventListener('click', (e) => {
    dlgCtx.noDrink = !dlgCtx.noDrink;
    if (!dlgCtx.noDrink && dlgCtx.winner && !dlgCtx.debts.length) {
      dlgCtx.debts = defaultDebts(winTeam(), loseTeam());
    }
    syncDialog();
    bounce(e.currentTarget);
  });
  $('#pickA').addEventListener('click', (e) => pickWinner('A', e.currentTarget));
  $('#pickB').addEventListener('click', (e) => pickWinner('B', e.currentTarget));
  $('#addDebt').addEventListener('click', () => {
    const w = winTeam();
    const l = loseTeam();
    const i = dlgCtx.debts.length;
    dlgCtx.debts.push({ debtor: l[i % l.length], creditor: w[i % w.length], stake: dlgCtx.debts[i - 1]?.stake || 'monster' });
    syncDialog();
    stagger([$$('#debtRows .debt-row').at(-1)], { y: 8 });
  });
  $('#resultForm').addEventListener('submit', saveResult);
  $('#deleteResult').addEventListener('click', deleteResult);
}

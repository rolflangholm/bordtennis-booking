import {
  $, $$, esc, isoDate, nowHHMM, hhmm, toMinutes, fromMinutes, storage, tokens, appConfig,
  supabase, unwrap, rpc, toast,
} from './core.js?v=dev';
import { quoteOfTheDay } from './quotes.js?v=dev';
import {
  resultsByBookingIds, resultLine, renderPending, openResultDialog, loadScoreboard, scoreboardEvents,
} from './scoreboard.js?v=dev';
import { stagger } from './celebrate.js?v=dev';
import { showTaunt } from './taunt.js?v=dev';

const state = {
  config: null,
  today: null,
  days: [],
  date: null,
  slots: [],
  todaySlots: [],
  results: new Map(), // bookingId → resultat for den viste dag
  view: 'booking',
  name: storage.get('bt-name', ''),
};

// ───── Data ─────

async function loadSettings() {
  const s = unwrap(await supabase.from('settings').select('*').eq('id', 1).single());
  return {
    title: s.title,
    slotMinutes: s.slot_minutes,
    bufferMinutes: s.buffer_minutes ?? 5,
    openTime: hhmm(s.open_time),
    closeTime: hhmm(s.close_time),
    daysAhead: s.days_ahead,
    maxActivePerPerson: s.max_active_per_person,
    weekends: s.weekends,
    fridgeLowAt: s.fridge_low_at ?? 4,
  };
}

async function fetchDay(date) {
  const rows = unwrap(
    await supabase.from('bookings').select('id, date, start, created_by, seats').eq('date', date),
  );
  const byStart = new Map(rows.map((b) => [hhmm(b.start), b]));
  const { openTime, closeTime, slotMinutes } = state.config;
  const now = new Date();
  const [y, m, d] = date.split('-').map(Number);
  const slots = [];
  for (let t = toMinutes(openTime); t + slotMinutes <= toMinutes(closeTime); t += slotMinutes) {
    const start = fromMinutes(t);
    const b = byStart.get(start);
    slots.push({
      start,
      end: fromMinutes(t + slotMinutes),
      started: new Date(y, m - 1, d, 0, t) <= now,
      past: new Date(y, m - 1, d, 0, t + slotMinutes) <= now,
      booking: b ? { ...b, start: hhmm(b.start) } : null,
    });
  }
  return slots;
}

function saveTokens(id, patch) {
  const cur = tokens.bookings[id] || { seats: {} };
  tokens.bookings[id] = { ...cur, ...patch, seats: { ...cur.seats, ...(patch.seats || {}) } };
  tokens.save();
}

function forgetSeat(id, seat) {
  const t = tokens.bookings[id];
  if (!t) return;
  delete t.seats[seat];
  tokens.save();
}

// ───── Dage ─────

function buildDays() {
  const days = [];
  const d = new Date();
  for (let i = 0; i <= state.config.daysAhead; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    if (weekend && !state.config.weekends) continue;
    days.push(day);
  }
  return days;
}

function dayLabel(day) {
  const today = isoDate(new Date());
  const tomorrow = isoDate(new Date(Date.now() + 864e5));
  const iso = isoDate(day);
  if (iso === today) return 'I dag';
  if (iso === tomorrow) return 'I morgen';
  return day.toLocaleDateString('da-DK', { weekday: 'short' }).replace('.', '');
}

function renderDays() {
  $('#days').innerHTML = state.days
    .map((day) => {
      const iso = isoDate(day);
      return `<button type="button" data-date="${iso}" aria-pressed="${iso === state.date}">
        ${esc(dayLabel(day))}<small>${day.getDate()}/${day.getMonth() + 1}</small></button>`;
    })
    .join('');
}

// Den første bookbare dag efter i dag.
function nextOpenDay() {
  const today = isoDate(new Date());
  return state.days.find((d) => isoDate(d) > today) || null;
}

// ───── Tider ─────

const isMine = (booking, seat) => Boolean(tokens.bookings[booking.id]?.seats?.[seat]);
const isOwner = (booking) => Boolean(tokens.ownerOf(booking.id));

function seatHtml(booking, i, past) {
  const name = booking.seats[i];
  if (!name) {
    return past
      ? `<span class="seat empty">–</span>`
      : `<button type="button" class="seat empty" data-join="${booking.id}" data-seat="${i}">+ Tilmeld</button>`;
  }
  const mine = isMine(booking, i);
  const canRemove = !past && (mine || isOwner(booking));
  const x = canRemove
    ? `<button type="button" class="x" title="Fjern" data-leave="${booking.id}" data-seat="${i}">×</button>`
    : '';
  return `<span class="seat${mine ? ' mine' : ''}" title="${esc(name)}">${esc(name)}${x}</span>`;
}

function isNow(slot) {
  return state.date === isoDate(new Date()) && slot.start <= nowHHMM() && nowHHMM() < slot.end;
}

const hasTeams = (b) => b.seats.slice(0, 2).some(Boolean) && b.seats.slice(2).some(Boolean);

function renderSlots() {
  const hidePast = $('#hidePast').checked;
  const visible = state.slots.filter((s) => !(hidePast && s.past && !isNow(s)));
  const day = state.days.find((d) => isoDate(d) === state.date);
  $('#dayTitle').textContent = day
    ? day.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' })
    : state.date;

  if (!visible.length) {
    $('#slots').innerHTML = `<li class="slot"><span></span><span class="freetext">Ikke flere tider i dag – vælg en anden dag.</span></li>`;
    return;
  }

  $('#slots').innerHTML = visible
    .map((slot) => {
      const b = slot.booking;
      const now = isNow(slot);
      const cls = ['slot', now && 'now', slot.past && !now && 'past'].filter(Boolean).join(' ');
      const time = `<div class="time">${slot.start}<small>–${slot.end}</small></div>`;

      if (!b) {
        const action = slot.past
          ? ''
          : `<button type="button" class="primary" data-book="${slot.start}">Book</button>`;
        return `<li class="${cls}">${time}
          <div class="match"><span class="freetext">${slot.past ? 'Ikke booket' : 'Ledig'}</span></div>
          <div class="side">${now ? '<span class="tag nowtag">Nu</span>' : ''}${action}</div></li>`;
      }

      const result = state.results.get(b.id);
      const missing = b.seats.filter((s) => !s).length;
      const tag = now
        ? '<span class="tag nowtag">Spiller nu</span>'
        : missing && !slot.past
          ? `<span class="tag open">Mangler ${missing}</span>`
          : result
            ? '<span class="tag done">Spillet</span>'
            : '<span class="tag busy">Booket</span>';
      const owner = isOwner(b);
      const cancel = owner && !slot.started ? `<button type="button" class="link" data-cancel="${b.id}">Aflys</button>` : '';
      const resultBtn =
        tokens.isPlayer(b.id) && slot.started && hasTeams(b)
          ? `<button type="button" class="${result ? 'link' : 'primary small'}" data-result-slot="${slot.start}">${result ? 'Ret resultat' : '🏆 Resultat'}</button>`
          : '';
      return `<li class="${cls}">${time}
        <div class="match">
          <div class="team">${seatHtml(b, 0, slot.past)}${seatHtml(b, 1, slot.past)}</div>
          <span class="vs">VS</span>
          <div class="team">${seatHtml(b, 2, slot.past)}${seatHtml(b, 3, slot.past)}</div>
          ${result ? resultLine(result) : ''}
        </div>
        <div class="side">${tag}${resultBtn}${cancel}</div></li>`;
    })
    .join('');
}

function renderStatus() {
  const el = $('#status');
  const slots = state.todaySlots;
  const t = nowHHMM();
  const { openTime, closeTime } = state.config;
  const idx = slots.findIndex((s) => s.start <= t && t < s.end);
  const isTodayOpenDay = state.days.length && isoDate(state.days[0]) === isoDate(new Date());

  let html;
  let cls = 'status';
  const next = nextOpenDay();
  const nextName =
    next && (dayLabel(next) === 'I morgen' ? 'i morgen' : next.toLocaleDateString('da-DK', { weekday: 'long' }));
  const nextLabel = next ? `${nextName} kl. ${openTime}` : '';
  if (!isTodayOpenDay || !slots.length) {
    html = `<div><p class="big"><span class="dot"></span>Lukket i dag</p><p class="small">${next ? `Åbner igen ${nextLabel}.` : ''} Du kan allerede booke nu.</p></div>`;
  } else if (t < openTime) {
    html = `<div><p class="big"><span class="dot"></span>Åbner kl. ${openTime}</p><p class="small">Book din kamp allerede nu.</p></div>`;
  } else if (idx === -1) {
    html = `<div><p class="big"><span class="dot"></span>Lukket for i dag</p><p class="small">${next ? `Åbner igen ${nextLabel}. ` : ''}Bordet kan bookes ${openTime}–${closeTime}.</p></div>`;
  } else if (!slots[idx].booking) {
    cls += ' free';
    html = `<div><p class="big"><span class="dot"></span>Bordet er ledigt nu</p>
      <p class="small">Ledigt til kl. ${freeUntil(slots, idx)} – snup det!</p></div>
      <button type="button" class="primary" data-book-today="${slots[idx].start}">Book nu</button>`;
  } else {
    cls += ' busy';
    let j = idx;
    while (j < slots.length && slots[j].booking) j++;
    const players = slots[idx].booking.seats.filter(Boolean).map(esc).join(', ');
    const nextFree = slots[j];
    html = `<div><p class="big"><span class="dot"></span>Optaget${nextFree ? ` · ledigt kl. ${nextFree.start}` : ' resten af dagen'}</p>
      <p class="small">Spiller nu: ${players}</p></div>
      ${nextFree ? `<button type="button" class="primary" data-book-today="${nextFree.start}">Book ${nextFree.start}</button>` : ''}`;
  }
  el.className = cls;
  el.innerHTML = html;
}

function freeUntil(slots, idx) {
  let j = idx;
  while (j < slots.length && !slots[j].booking) j++;
  return j < slots.length ? slots[j].start : state.config.closeTime;
}

async function loadDay() {
  if (!state.date) return; // dagene er ikke klar endnu (fx under opstart)
  const today = isoDate(new Date());
  const [day, todaySlots] = await Promise.all([
    fetchDay(state.date),
    state.date === today ? null : fetchDay(today),
  ]);
  state.slots = day;
  state.todaySlots = todaySlots || day;
  // Resultater er "pænt at have": fejler de, virker bookingen stadig.
  state.results = await resultsByBookingIds(day.filter((s) => s.booking).map((s) => s.booking.id)).catch(
    () => new Map(),
  );
  renderSlots();
  renderStatus();
  renderPending($('#pending')).catch(() => {});
}

// ───── Navn, booking, tilmelding ─────

// "Det er mig": hent nøglerne til de pladser, hvor dit navn står, så du kan rette resultater, du har vundet.
async function claimSeats() {
  if (!state.name) return;
  try {
    const claimed = await rpc('claim_my_seats', { p_name: state.name });
    for (const c of claimed) saveTokens(c.booking_id, { seats: { [c.seat]: c.token } });
    if (claimed.length) refreshAll();
  } catch {}
}

function renderWho() {
  $('#who').textContent = state.name ? `👋 ${state.name}` : 'Hvem er du?';
}

function askName() {
  return new Promise((resolve) => {
    const dlg = $('#nameDialog');
    const form = $('#nameForm');
    form.name.value = state.name;
    dlg.showModal();
    form.onsubmit = (e) => {
      e.preventDefault();
      state.name = form.name.value.replace(/\s+/g, ' ').trim();
      storage.set('bt-name', state.name);
      renderWho();
      dlg.close();
      claimSeats();
      resolve(state.name);
    };
    dlg.onclose = () => resolve(state.name || null);
  });
}

function openBooking(date, start) {
  const dlg = $('#bookDialog');
  const form = $('#bookForm');
  const day = new Date(`${date}T00:00`);
  $('#bookWhen').textContent = `${dayLabel(day).toLowerCase()} kl. ${start}`;
  form.reset();
  form.p0.value = state.name;
  dlg.showModal();
  (state.name ? form.p1 : form.p0).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = form.p0.value.trim();
    try {
      const res = await rpc('book_slot', {
        p_date: date,
        p_start: start,
        p_name: name,
        p_players: [form.p1.value, form.p2.value, form.p3.value],
      });
      if (!state.name) {
        state.name = name;
        storage.set('bt-name', name);
        renderWho();
      }
      // Kun din egen plads markeres som "din"; bookertokenet kan fjerne de andre.
      saveTokens(res.booking.id, { owner: res.owner_token, seats: { 0: res.seat_tokens[0] } });
      dlg.close();
      toast(`Booket ${start} 🏓`);
      loadDay();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function join(id, seat) {
  const name = state.name || (await askName());
  if (!name) return;
  try {
    const res = await rpc('join_seat', { p_id: id, p_seat: seat, p_name: name });
    saveTokens(id, { seats: { [seat]: res.seat_token } });
    toast('Du er med! 🏓');
  } catch (err) {
    toast(err.message, true);
  }
  loadDay();
}

async function leave(id, seat) {
  const t = tokens.bookings[id] || {};
  try {
    await rpc('leave_seat', { p_id: id, p_seat: seat, p_token: t.seats?.[seat] || t.owner || null });
    forgetSeat(id, seat);
    toast('Fjernet fra kampen');
  } catch (err) {
    toast(err.message, true);
  }
  loadDay();
}

async function cancel(id) {
  if (!confirm('Aflys hele bookingen?')) return;
  try {
    await rpc('cancel_booking', { p_id: id, p_token: tokens.ownerOf(id) });
    delete tokens.bookings[id];
    tokens.save();
    toast('Bookingen er aflyst – bordet er ledigt igen');
  } catch (err) {
    toast(err.message, true);
  }
  loadDay();
}

function resultFor(booking) {
  openResultDialog({
    bookingId: booking.id,
    date: booking.date,
    start: booking.start,
    teamA: booking.seats.slice(0, 2).filter(Boolean),
    teamB: booking.seats.slice(2).filter(Boolean),
    result: state.results.get(booking.id) || null,
  });
}

// ───── Visninger ─────

function setView(view, { push = true } = {}) {
  state.view = view;
  $('#viewBooking').hidden = view !== 'booking';
  $('#viewScore').hidden = view !== 'score';
  $$('#viewTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === view));
  if (push) history.replaceState(null, '', view === 'score' ? '#scoreboard' : location.pathname + location.search);
  const panel = view === 'score' ? $('#viewScore') : $('#viewBooking');
  stagger([...panel.children].slice(0, 4), { gap: 50, y: 10 });
  if (view === 'score') loadScoreboard().catch((err) => toast(err.message, true));
}

function refreshAll() {
  loadDay().catch((err) => toast(err.message, true));
  if (state.view === 'score') loadScoreboard().catch((err) => toast(err.message, true));
  checkTaunts();
}

// Taber-animationen: står dit navn på taberholdet i et nyt resultat (seneste døgn),
// vises den én gang – med det samme, hvis siden er åben, ellers næste gang du kigger forbi.
let tauntBusy = false;
async function checkTaunts() {
  if (tauntBusy || !state.name || !supabase) return;
  tauntBusy = true;
  try {
    const me = state.name.toLowerCase();
    const since = new Date(Date.now() - 864e5).toISOString();
    const rows = unwrap(
      await supabase.from('results').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(30),
    );
    const seen = storage.get('bt-tauntSeen', []);
    const losersOf = (r) => (r.winner === 'A' ? r.team_b : r.team_a);
    const mine = rows.filter((r) => !seen.includes(r.id) && losersOf(r).some((n) => n.toLowerCase() === me));
    if (!mine.length) return;
    storage.set('bt-tauntSeen', [...seen, ...mine.map((r) => r.id)].slice(-200));
    const r = mine[0];
    const debts = unwrap(await supabase.from('result_debts').select('*').eq('result_id', r.id).order('position'));
    const score = r.score_a == null ? null : [Math.max(r.score_a, r.score_b), Math.min(r.score_a, r.score_b)];
    const rematch = await showTaunt({
      winners: r.winner === 'A' ? r.team_a : r.team_b,
      losers: losersOf(r),
      myName: state.name,
      myDebts: debts.filter((d) => d.debtor.toLowerCase() === me),
      score,
    });
    if (rematch) setView('booking');
  } catch {
    // Animationen er ren underholdning – fejler den, sker der ikke mere.
  } finally {
    tauntBusy = false;
  }
}

function bindEvents() {
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    if (d.date) {
      state.date = d.date;
      renderDays();
      loadDay();
    } else if (d.view) setView(d.view);
    else if (d.book) openBooking(state.date, d.book);
    else if (d.bookToday) openBooking(isoDate(new Date()), d.bookToday);
    else if (d.join) join(d.join, Number(d.seat));
    else if (d.leave) leave(d.leave, Number(d.seat));
    else if (d.cancel) cancel(d.cancel);
    else if (d.resultSlot) {
      const slot = state.slots.find((s) => s.start === d.resultSlot);
      if (slot?.booking) resultFor(slot.booking);
    } else if (d.resultBooking) {
      const b = $('#pending')._pending?.find((x) => x.id === d.resultBooking);
      if (b) resultFor(b);
    } else if ('rules' in d) $('#rulesDialog').showModal();
    else if ('close' in d) el.closest('dialog').close();
  });
  $('#who').addEventListener('click', askName);
  $('#rulesBtn').addEventListener('click', () => $('#rulesDialog').showModal());
  $('#hidePast').addEventListener('change', (e) => {
    storage.set('bt-hidePast', e.target.checked);
    renderSlots();
  });
  window.addEventListener('hashchange', () => setView(location.hash === '#scoreboard' ? 'score' : 'booking', { push: false }));
}

function connectLive() {
  if (appConfig.realtime === false) return;
  let timer;
  const later = () => {
    clearTimeout(timer); // saml flere ændringer i ét kald
    timer = setTimeout(refreshAll, 150);
  };
  supabase
    .channel('bordtennis')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, later)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'results' }, later)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'result_debts' }, later)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fridge' }, later)
    .subscribe();
}

// ───── Regler og dagens citat ─────

function renderRules() {
  const { slotMinutes, bufferMinutes, openTime, closeTime, daysAhead, maxActivePerPerson, weekends } = state.config;
  const playMinutes = Math.max(slotMinutes - bufferMinutes, 0);
  const limit = maxActivePerPerson
    ? `Du kan højst være med i <b>${maxActivePerPerson} kommende kampe</b> ad gangen, så alle får en tur.`
    : 'Der er ingen grænse for, hvor mange kampe du kan være med i.';
  const sections = [
    [
      'Booking',
      [
        bufferMinutes
          ? `Hver tid er ${slotMinutes} minutter: <b>${playMinutes} minutters kamp</b> og <b>${bufferMinutes} minutters buffer</b> til at spille færdig og komme til og fra din plads.`
          : `En kamp varer <b>${slotMinutes} minutter</b>.`,
        `Bordet kan bookes <b>${openTime}–${closeTime}</b> ${weekends ? 'alle dage' : 'på hverdage'}.`,
        `Du kan booke op til <b>${daysAhead} dage</b> frem.`,
        'Hver booking er en <b>double</b> med 4 pladser: Hold A mod Hold B.',
        limit,
        'Mangler I spillere, kan I booke med tomme pladser. Så kan kollegerne melde sig til med <b>+ Tilmeld</b>.',
      ],
    ],
    [
      'Navne',
      [
        'Brug dit rigtige fornavn, gerne med forbogstav i efternavnet (fx "Rolf L."), så alle kan se, hvem der spiller.',
        `Brug altid det <b>samme navn</b>.${maxActivePerPerson ? ` Grænsen på ${maxActivePerPerson} kampe tælles pr. navn.` : ''} Scoreboardet samler også dine sejre under dit navn. Det er ligegyldigt, om du skriver med store eller små bogstaver.`,
        'Den samme person kan ikke stå på to pladser i den samme kamp.',
        'Navne må højst være 40 tegn.',
      ],
    ],
    [
      'Scoreboard',
      [
        'Vi spiller om <b>hvid Monster</b> og <b>Arla Protein kakao</b>. Hver taber giver en drik til en vinder, fx Rolf → Henrik: Monster og Bo → Dennis: Protein kakao.',
        '<b>Bookeren og vinderne</b> kan indtaste, rette og slette resultatet, så snart kampen er gået i gang.',
        'Siden genkender dig på dit navn under <b>Hvem er du?</b>: står dit navn i en kamp, får din browser lov til at rette den. Brug derfor altid dit eget navn.',
        'Når en drik er betalt eller taget fra køleskabet, sætter en vinder kryds i <b>Betalt</b>. Så går den automatisk fra i køleskabet.',
        'Fylder du køleskabet op, så tryk <b>Ret antal</b> under Køleskabet, så alle kan se, hvad der er tilbage.',
      ],
    ],
    [
      'Aflysning',
      [
        'Kun den, der bookede, kan aflyse hele kampen, og kun fra den samme browser.',
        'Du kan altid fjerne dig selv fra en kamp med <b>×</b>.',
        'Kan I alligevel ikke spille? Så aflys hurtigst muligt, så andre kan få bordet.',
      ],
    ],
    [
      'God stil ved bordet',
      [
        'Mød op til tiden, og stop når tiden er gået. Det næste hold venter.',
        'Er et hold ikke mødt op 5 minutter inde i deres tid, må andre bruge bordet.',
        'Er bordet ledigt uden booking? Book det med <b>Book nu</b>, før I går i gang, så andre kan se, at det er optaget.',
      ],
    ],
  ];
  $('#rulesBody').innerHTML = sections
    .map(([title, items]) => `<h4>${title}</h4><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`)
    .join('');
  $('#rulesSummary').textContent =
    (bufferMinutes ? `${playMinutes} min kamp + ${bufferMinutes} min buffer` : `Kampe à ${slotMinutes} min`) +
    ` · ${openTime}–${closeTime}` +
    (maxActivePerPerson ? ` · max ${maxActivePerPerson} kommende kampe pr. person` : '');
}

function renderQuote() {
  const q = quoteOfTheDay();
  $('#quote').textContent = q.text;
  $('#quoteAuthor').textContent = `– ${q.author}`;
}

// Står siden åben natten over, skifter dag, dagsliste og dagens citat automatisk.
function tick() {
  const today = isoDate(new Date());
  if (state.today !== today) {
    state.today = today;
    state.days = buildDays();
    if (!state.date || state.date < today) {
      // Efter lukketid (eller på en lukket dag) åbner siden på næste dag med ledige tider.
      const todayOpen = state.days.length && isoDate(state.days[0]) === today && nowHHMM() < state.config.closeTime;
      const first = todayOpen ? state.days[0] : nextOpenDay() || state.days[0];
      state.date = isoDate(first || new Date());
    }
    renderDays();
    renderQuote();
  }
  loadDay().catch((err) => toast(err.message, true));
  checkTaunts(); // backup, hvis live-opdateringen har været afbrudt
}

function showSetupHelp() {
  $('#status').className = 'status';
  $('#status').innerHTML = `<div><p class="big"><span class="dot"></span>Mangler opsætning</p>
    <p class="small">Udfyld <code>public/config.js</code> med jeres Supabase-adresse og nøgle – se README.</p></div>`;
}

async function init() {
  renderQuote();
  if (!supabase) return showSetupHelp();
  state.config = await loadSettings();
  document.title = state.config.title;
  $('#title').textContent = state.config.title.replace(/\s*booking$/i, '');
  $('#hidePast').checked = storage.get('bt-hidePast', true);
  renderRules();
  renderWho();
  bindEvents();
  scoreboardEvents({
    onChange: refreshAll,
    weekends: state.config.weekends,
    lowAt: state.config.fridgeLowAt,
    myName: () => state.name,
  });
  await claimSeats();
  checkTaunts();
  tick();
  connectLive();
  setView(location.hash === '#scoreboard' ? 'score' : 'booking', { push: false });
  // Opdatér "nu"-markering og status hvert halve minut (og som backup for live-opdatering).
  setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', () => !document.hidden && tick());
  // Første besøg: vis reglerne én gang.
  if (!storage.get('bt-seenRules', false)) {
    storage.set('bt-seenRules', true);
    $('#rulesDialog').showModal();
  }
}

init().catch((err) => toast(err.message, true));


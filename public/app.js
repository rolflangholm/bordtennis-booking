import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { quoteOfTheDay } from './quotes.js?v=dev';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowHHMM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const storage = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const state = {
  config: null,
  today: null,
  days: [],
  date: null,
  slots: [],
  todaySlots: [],
  name: storage.get('bt-name', ''),
  tokens: storage.get('bt-tokens', {}), // { [bookingId]: { owner, seats: { [i]: token } } }
};

// ───── Data (Supabase) ─────
const appConfig = window.BORDTENNIS_CONFIG || {};
const supabase =
  appConfig.supabaseUrl && appConfig.supabaseKey ? createClient(appConfig.supabaseUrl, appConfig.supabaseKey) : null;

const hhmm = (t) => t.slice(0, 5);
const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Kunne ikke kontakte databasen');
  return data;
}

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
  };
}

async function fetchDay(date) {
  const rows = unwrap(
    await supabase.from('bookings').select('id, date, start, created_by, seats').eq('date', date),
  );
  const byStart = new Map(rows.map((b) => [hhmm(b.start), b]));
  const { openTime, closeTime, slotMinutes } = state.config;
  const now = new Date();
  const slots = [];
  for (let t = toMinutes(openTime); t + slotMinutes <= toMinutes(closeTime); t += slotMinutes) {
    const start = fromMinutes(t);
    const [y, m, d] = date.split('-').map(Number);
    const b = byStart.get(start);
    slots.push({
      start,
      end: fromMinutes(t + slotMinutes),
      past: new Date(y, m - 1, d, 0, t + slotMinutes) <= now,
      booking: b ? { ...b, start: hhmm(b.start) } : null,
    });
  }
  return slots;
}

const rpc = async (fn, args) => unwrap(await supabase.rpc(fn, args));

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = 'toast'), 3200);
}

function saveTokens(id, patch) {
  const cur = state.tokens[id] || { seats: {} };
  state.tokens[id] = { ...cur, ...patch, seats: { ...cur.seats, ...(patch.seats || {}) } };
  storage.set('bt-tokens', state.tokens);
}

function forgetSeat(id, seat) {
  const t = state.tokens[id];
  if (!t) return;
  delete t.seats[seat];
  storage.set('bt-tokens', state.tokens);
}

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

function isMine(booking, seat) {
  return Boolean(state.tokens[booking.id]?.seats?.[seat]);
}
const isOwner = (booking) => Boolean(state.tokens[booking.id]?.owner);

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

      const missing = b.seats.filter((s) => !s).length;
      const tag = now
        ? '<span class="tag nowtag">Spiller nu</span>'
        : missing && !slot.past
          ? `<span class="tag open">Mangler ${missing}</span>`
          : '<span class="tag busy">Booket</span>';
      const cancel =
        isOwner(b) && !slot.past ? `<button type="button" class="link" data-cancel="${b.id}">Aflys</button>` : '';
      return `<li class="${cls}">${time}
        <div class="match">
          <div class="team">${seatHtml(b, 0, slot.past)}${seatHtml(b, 1, slot.past)}</div>
          <span class="vs">VS</span>
          <div class="team">${seatHtml(b, 2, slot.past)}${seatHtml(b, 3, slot.past)}</div>
        </div>
        <div class="side">${tag}${cancel}</div></li>`;
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
  const nextName = next && (dayLabel(next) === 'I morgen' ? 'i morgen' : next.toLocaleDateString('da-DK', { weekday: 'long' }));
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
    const next = slots[j];
    html = `<div><p class="big"><span class="dot"></span>Optaget${next ? ` · ledigt kl. ${next.start}` : ' resten af dagen'}</p>
      <p class="small">Spiller nu: ${players}</p></div>
      ${next ? `<button type="button" class="primary" data-book-today="${next.start}">Book ${next.start}</button>` : ''}`;
  }
  el.className = cls;
  el.innerHTML = html;
}

// Den første bookbare dag efter i dag.
function nextOpenDay() {
  const today = isoDate(new Date());
  return state.days.find((d) => isoDate(d) > today) || null;
}

function freeUntil(slots, idx) {
  let j = idx;
  while (j < slots.length && !slots[j].booking) j++;
  return j < slots.length ? slots[j].start : state.config.closeTime;
}

async function loadDay() {
  const today = isoDate(new Date());
  const [day, todaySlots] = await Promise.all([
    fetchDay(state.date),
    state.date === today ? null : fetchDay(today),
  ]);
  state.slots = day;
  state.todaySlots = todaySlots || day;
  renderSlots();
  renderStatus();
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
  const t = state.tokens[id] || {};
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
    await rpc('cancel_booking', { p_id: id, p_token: state.tokens[id]?.owner || null });
    delete state.tokens[id];
    storage.set('bt-tokens', state.tokens);
    toast('Bookingen er aflyst – bordet er ledigt igen');
  } catch (err) {
    toast(err.message, true);
  }
  loadDay();
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    if (d.date) {
      state.date = d.date;
      renderDays();
      loadDay();
    } else if (d.book) openBooking(state.date, d.book);
    else if (d.bookToday) openBooking(isoDate(new Date()), d.bookToday);
    else if (d.join) join(d.join, Number(d.seat));
    else if (d.leave) leave(d.leave, Number(d.seat));
    else if (d.cancel) cancel(d.cancel);
    else if ('rules' in d) $('#rulesDialog').showModal();
    else if ('close' in d) el.closest('dialog').close();
  });
  $('#who').addEventListener('click', askName);
  $('#rulesBtn').addEventListener('click', () => $('#rulesDialog').showModal());
  $('#hidePast').addEventListener('change', (e) => {
    storage.set('bt-hidePast', e.target.checked);
    renderSlots();
  });
}

function connectLive() {
  if (appConfig.realtime === false) return;
  let timer;
  supabase
    .channel('bookings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
      clearTimeout(timer); // saml flere ændringer i ét kald
      timer = setTimeout(loadDay, 150);
    })
    .subscribe();
}

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
        `Brug altid det <b>samme navn</b>.${maxActivePerPerson ? ` Grænsen på ${maxActivePerPerson} kampe tælles pr. navn.` : ''} Det er ligegyldigt, om du skriver med store eller små bogstaver.`,
        'Den samme person kan ikke stå på to pladser i den samme kamp.',
        'Navne må højst være 40 tegn.',
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
  $('#title').textContent = state.config.title;
  $('#hidePast').checked = storage.get('bt-hidePast', true);
  renderRules();
  renderWho();
  bindEvents();
  tick();
  connectLive();
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

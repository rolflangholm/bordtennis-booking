'use strict';

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
  days: [],
  date: null,
  slots: [],
  todaySlots: [],
  name: storage.get('bt-name', ''),
  tokens: storage.get('bt-tokens', {}), // { [bookingId]: { owner, seats: { [i]: token } } }
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Noget gik galt');
  return data;
}

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
  if (!isTodayOpenDay || !slots.length) {
    html = `<div><p class="big"><span class="dot"></span>Lukket i dag</p><p class="small">Book til en af de kommende dage herunder.</p></div>`;
  } else if (t < openTime) {
    html = `<div><p class="big"><span class="dot"></span>Åbner kl. ${openTime}</p><p class="small">Book din kamp allerede nu.</p></div>`;
  } else if (idx === -1) {
    html = `<div><p class="big"><span class="dot"></span>Lukket for i dag</p><p class="small">Bordet kan bookes ${openTime}–${closeTime}.</p></div>`;
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

function freeUntil(slots, idx) {
  let j = idx;
  while (j < slots.length && !slots[j].booking) j++;
  return j < slots.length ? slots[j].start : state.config.closeTime;
}

async function loadDay() {
  const today = isoDate(new Date());
  const [day, todayData] = await Promise.all([
    api(`/api/bookings?date=${state.date}`),
    state.date === today ? null : api(`/api/bookings?date=${today}`),
  ]);
  state.slots = day.slots;
  state.todaySlots = todayData ? todayData.slots : day.slots;
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
      const res = await api('/api/bookings', {
        method: 'POST',
        body: { date, start, name, players: [form.p1.value, form.p2.value, form.p3.value] },
      });
      if (!state.name) {
        state.name = name;
        storage.set('bt-name', name);
        renderWho();
      }
      saveTokens(res.booking.id, { owner: res.ownerToken, seats: { 0: res.seatTokens[0] } });
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
    const res = await api(`/api/bookings/${id}/join`, { method: 'POST', body: { seat, name, date: state.date } });
    saveTokens(id, { seats: { [seat]: res.seatToken } });
    toast('Du er med! 🏓');
  } catch (err) {
    toast(err.message, true);
  }
  loadDay();
}

async function leave(id, seat) {
  const t = state.tokens[id] || {};
  try {
    await api(`/api/bookings/${id}/leave`, {
      method: 'POST',
      body: { seat, token: t.seats?.[seat] || t.owner, date: state.date },
    });
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
    await api(`/api/bookings/${id}/cancel`, {
      method: 'POST',
      body: { token: state.tokens[id]?.owner, date: state.date },
    });
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
    else if ('close' in d) el.closest('dialog').close();
  });
  $('#who').addEventListener('click', askName);
  $('#hidePast').addEventListener('change', (e) => {
    storage.set('bt-hidePast', e.target.checked);
    renderSlots();
  });
}

function connectLive() {
  const es = new EventSource('/api/events');
  es.addEventListener('change', () => loadDay());
  // EventSource genforbinder selv; hent frisk data når forbindelsen er tilbage.
  es.addEventListener('open', () => state.slots.length && loadDay());
}

async function init() {
  state.config = await api('/api/config');
  document.title = state.config.title;
  $('#title').textContent = state.config.title;
  $('#hidePast').checked = storage.get('bt-hidePast', true);
  $('#rules').textContent =
    `Kampe à ${state.config.slotMinutes} min · ${state.config.openTime}–${state.config.closeTime}` +
    (state.config.maxActivePerPerson ? ` · max ${state.config.maxActivePerPerson} kommende kampe pr. person` : '') +
    ' · Opdaterer live';
  state.days = buildDays();
  state.date = isoDate(state.days[0] || new Date());
  renderWho();
  renderDays();
  bindEvents();
  await loadDay();
  connectLive();
  // Opdatér "nu"-markering og status hvert halve minut.
  setInterval(loadDay, 30_000);
}

init().catch((err) => toast(err.message, true));

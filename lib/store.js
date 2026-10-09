'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SEATS = 4; // double: hold A = sæde 0+1, hold B = sæde 2+3
const MAX_NAME = 40;
const KEEP_DAYS = 60;

class BookingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
};
const slotEnd = (date, start, slotMinutes) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, toMinutes(start) + slotMinutes);
};
const token = () => crypto.randomBytes(16).toString('hex');
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function cleanName(raw, field = 'Navn') {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (name.length > MAX_NAME) throw new BookingError(`${field} må højst være ${MAX_NAME} tegn`);
  return name;
}

function createStore(config, { now = () => new Date() } = {}) {
  const { slotMinutes, openTime, closeTime, daysAhead, maxActivePerPerson, dataFile } = config;
  let bookings = load();

  function load() {
    if (!dataFile || !fs.existsSync(dataFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return Array.isArray(parsed.bookings) ? parsed.bookings : [];
  }

  function save() {
    const cutoff = addDays(localDate(now()), -KEEP_DAYS);
    bookings = bookings.filter((b) => b.date >= cutoff);
    if (!dataFile) return;
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const tmp = `${dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ bookings }, null, 2));
    fs.renameSync(tmp, dataFile);
  }

  function slotStarts() {
    const starts = [];
    for (let t = toMinutes(openTime); t + slotMinutes <= toMinutes(closeTime); t += slotMinutes) {
      starts.push(fromMinutes(t));
    }
    return starts;
  }

  function assertDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BookingError('Ugyldig dato');
    }
    const today = localDate(now());
    if (date < today) throw new BookingError('Datoen er passeret');
    if (date > addDays(today, daysAhead)) {
      throw new BookingError(`Du kan højst booke ${daysAhead} dage frem`);
    }
  }

  function assertBookableSlot(date, start) {
    assertDate(date);
    if (!slotStarts().includes(start)) throw new BookingError('Ugyldigt tidspunkt');
    if (slotEnd(date, start, slotMinutes) <= now()) throw new BookingError('Tidspunktet er passeret');
  }

  function isActive(b) {
    return slotEnd(b.date, b.start, slotMinutes) > now();
  }

  function assertUnderLimit(name) {
    if (!maxActivePerPerson) return;
    const count = bookings.filter(
      (b) => isActive(b) && b.seats.some((s) => s && sameName(s.name, name)),
    ).length;
    if (count >= maxActivePerPerson) {
      throw new BookingError(
        `${name} er allerede med i ${count} kommende kampe (max ${maxActivePerPerson}). Giv plads til de andre 🏓`,
        409,
      );
    }
  }

  function find(id) {
    const b = bookings.find((x) => x.id === id);
    if (!b) throw new BookingError('Bookingen findes ikke', 404);
    return b;
  }

  const toPublic = (b) => ({
    id: b.id,
    date: b.date,
    start: b.start,
    end: fromMinutes(toMinutes(b.start) + slotMinutes),
    createdBy: b.createdBy,
    seats: b.seats.map((s) => (s ? s.name : null)),
  });

  function day(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BookingError('Ugyldig dato');
    }
    const byStart = new Map(bookings.filter((b) => b.date === date).map((b) => [b.start, b]));
    return slotStarts().map((start) => {
      const b = byStart.get(start);
      return {
        start,
        end: fromMinutes(toMinutes(start) + slotMinutes),
        past: slotEnd(date, start, slotMinutes) <= now(),
        booking: b ? toPublic(b) : null,
      };
    });
  }

  function create({ date, start, name, players = [] }) {
    assertBookableSlot(date, start);
    const booker = cleanName(name);
    if (!booker) throw new BookingError('Skriv dit navn');
    if (bookings.some((b) => b.date === date && b.start === start)) {
      throw new BookingError('Tiden er lige blevet booket af en anden', 409);
    }

    const names = [booker];
    for (let i = 0; i < SEATS - 1; i++) names.push(cleanName(players[i], 'Spillernavn'));
    const filled = names.filter(Boolean);
    if (new Set(filled.map((n) => n.toLowerCase())).size !== filled.length) {
      throw new BookingError('Den samme spiller kan ikke stå to gange');
    }
    filled.forEach(assertUnderLimit);

    const ownerToken = token();
    const seatTokens = {};
    const seats = names.map((n, i) => {
      if (!n) return null;
      seatTokens[i] = token();
      return { name: n, token: seatTokens[i] };
    });
    const booking = {
      id: crypto.randomUUID(),
      date,
      start,
      createdBy: booker,
      createdAt: now().toISOString(),
      ownerToken,
      seats,
    };
    bookings.push(booking);
    save();
    return { booking: toPublic(booking), ownerToken, seatTokens };
  }

  function join(id, { seat, name }) {
    const b = find(id);
    if (!isActive(b)) throw new BookingError('Kampen er slut');
    if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) throw new BookingError('Ugyldig plads');
    if (b.seats[seat]) throw new BookingError('Pladsen er lige blevet taget', 409);
    const player = cleanName(name);
    if (!player) throw new BookingError('Skriv dit navn');
    if (b.seats.some((s) => s && sameName(s.name, player))) {
      throw new BookingError(`${player} er allerede med i kampen`);
    }
    assertUnderLimit(player);
    const seatToken = token();
    b.seats[seat] = { name: player, token: seatToken };
    save();
    return { booking: toPublic(b), seatToken };
  }

  function leave(id, { seat, token: t }) {
    const b = find(id);
    const s = b.seats[seat];
    if (!s) throw new BookingError('Pladsen er allerede tom');
    if (t !== s.token && t !== b.ownerToken) throw new BookingError('Du kan kun fjerne dig selv', 403);
    b.seats[seat] = null;
    if (b.seats.every((x) => !x)) {
      bookings = bookings.filter((x) => x !== b);
      save();
      return { booking: null };
    }
    save();
    return { booking: toPublic(b) };
  }

  function cancel(id, { token: t }) {
    const b = find(id);
    if (t !== b.ownerToken) throw new BookingError('Kun den der bookede kan aflyse', 403);
    bookings = bookings.filter((x) => x !== b);
    save();
    return { ok: true };
  }

  return { day, create, join, leave, cancel, slotStarts };
}

module.exports = { createStore, BookingError, localDate, addDays };

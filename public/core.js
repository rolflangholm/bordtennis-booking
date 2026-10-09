// Fælles hjælpere: DOM, datoer, lokal lagring, Supabase og "toasts".
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const nowHHMM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const hhmm = (t) => t.slice(0, 5);
export const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ISO-ugenummer (mandag er første dag, uge 1 indeholder årets første torsdag).
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
}
export const mondayOf = (date) => addDays(date, -((date.getDay() + 6) % 7));

export const fmt = {
  weekdayLong: (d) => d.toLocaleDateString('da-DK', { weekday: 'long' }),
  dayMonth: (d) => d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }).replaceAll('.', ''),
  full: (d) => d.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' }),
  tiny: (d) => `${d.toLocaleDateString('da-DK', { weekday: 'short' }).replace('.', '')} ${d.getDate()}/${d.getMonth() + 1}`,
  short: (d) => d.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' }).replaceAll('.', ''),
};

export const storage = {
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

// Nøgler der beviser, at det var dig der bookede / tog en plads. Gemmes kun i denne browser.
export const tokens = {
  bookings: storage.get('bt-tokens', {}), // { [bookingId]: { owner, seats: { [i]: token } } }
  results: storage.get('bt-resultTokens', {}), // { [resultId]: ownerToken }
  save() {
    storage.set('bt-tokens', this.bookings);
    storage.set('bt-resultTokens', this.results);
  },
  ownerOf(bookingId) {
    return this.bookings[bookingId]?.owner || null;
  },
  // Er jeg med i denne booking (som booker eller med en plads)?
  isPlayer(bookingId) {
    const t = this.bookings[bookingId];
    return Boolean(t && (t.owner || Object.values(t.seats || {}).some(Boolean)));
  },
  // Nøgle der må rette et resultat med det vinderhold: bookerens, ellers en vinders plads.
  forWinner(bookingId, winner) {
    const t = this.bookings[bookingId];
    if (!t) return null;
    if (t.owner) return t.owner;
    for (const i of winner === 'A' ? [0, 1] : [2, 3]) if (t.seats?.[i]) return t.seats[i];
    return null;
  },
  forResult(r) {
    return (r.booking_id && this.forWinner(r.booking_id, r.winner)) || this.results[r.id] || null;
  },
};

export const appConfig = window.BORDTENNIS_CONFIG || {};
export const supabase =
  appConfig.supabaseUrl && appConfig.supabaseKey ? createClient(appConfig.supabaseUrl, appConfig.supabaseKey) : null;

export function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Kunne ikke kontakte databasen');
  return data;
}
export const rpc = async (fn, args) => unwrap(await supabase.rpc(fn, args));

export function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = 'toast'), 3200);
}

// "Rolf & Gitte"
export const teamName = (names) => names.filter(Boolean).map(esc).join(' &amp; ');
export const teamText = (names) => names.filter(Boolean).join(' & ');

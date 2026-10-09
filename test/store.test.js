'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, BookingError } = require('../lib/store');

const config = {
  slotMinutes: 20,
  openTime: '08:00',
  closeTime: '18:00',
  daysAhead: 14,
  maxActivePerPerson: 2,
  dataFile: null,
};
// Fast "nu": torsdag 9. okt 2026 kl. 10:05
const fixedNow = () => new Date(2026, 9, 9, 10, 5);
const make = (overrides = {}) => createStore({ ...config, ...overrides }, { now: fixedNow });
const DAY = '2026-10-09';

test('dagen deles i 20-minutters tider', () => {
  const slots = make().day(DAY);
  assert.equal(slots.length, 30);
  assert.equal(slots[0].start, '08:00');
  assert.equal(slots[0].end, '08:20');
  assert.equal(slots.at(-1).end, '18:00');
  assert.equal(slots.find((s) => s.start === '09:40').past, true);
  assert.equal(slots.find((s) => s.start === '10:00').past, false); // i gang lige nu
});

test('kan booke en double med fire spillere', () => {
  const store = make();
  const res = store.create({ date: DAY, start: '10:20', name: 'Rolf', players: ['Anne', 'Bo', 'Cecilie'] });
  assert.deepEqual(res.booking.seats, ['Rolf', 'Anne', 'Bo', 'Cecilie']);
  assert.ok(res.ownerToken);
  assert.ok(!('ownerToken' in res.booking), 'token må ikke lække i offentlige data');
  assert.equal(store.day(DAY).find((s) => s.start === '10:20').booking.id, res.booking.id);
});

test('samme tid kan ikke dobbeltbookes', () => {
  const store = make();
  store.create({ date: DAY, start: '11:00', name: 'Rolf' });
  assert.throws(() => store.create({ date: DAY, start: '11:00', name: 'Anne' }), /lige blevet booket/);
});

test('afviser passerede og ugyldige tider', () => {
  const store = make();
  assert.throws(() => store.create({ date: DAY, start: '09:00', name: 'Rolf' }), /passeret/);
  assert.throws(() => store.create({ date: DAY, start: '10:10', name: 'Rolf' }), /Ugyldigt tidspunkt/);
  assert.throws(() => store.create({ date: '2026-12-01', start: '10:20', name: 'Rolf' }), /dage frem/);
  assert.throws(() => store.create({ date: DAY, start: '10:20', name: '  ' }), /navn/);
});

test('den igangværende tid kan stadig bookes', () => {
  const res = make().create({ date: DAY, start: '10:00', name: 'Rolf' });
  assert.equal(res.booking.start, '10:00');
});

test('andre kan tilmelde sig tomme pladser', () => {
  const store = make();
  const { booking } = store.create({ date: DAY, start: '12:00', name: 'Rolf', players: ['Anne'] });
  const joined = store.join(booking.id, { seat: 2, name: 'Bo' });
  assert.deepEqual(joined.booking.seats, ['Rolf', 'Anne', 'Bo', null]);
  assert.throws(() => store.join(booking.id, { seat: 2, name: 'Cecilie' }), /taget/);
  assert.throws(() => store.join(booking.id, { seat: 3, name: 'bo' }), /allerede med/);
});

test('man kan forlade sin plads, og tom booking forsvinder', () => {
  const store = make();
  const { booking, seatTokens } = store.create({ date: DAY, start: '13:00', name: 'Rolf' });
  const { seatToken } = store.join(booking.id, { seat: 1, name: 'Anne' });
  assert.throws(() => store.leave(booking.id, { seat: 0, token: seatToken }), BookingError);
  store.leave(booking.id, { seat: 1, token: seatToken });
  const res = store.leave(booking.id, { seat: 0, token: seatTokens[0] });
  assert.equal(res.booking, null);
  assert.equal(store.day(DAY).find((s) => s.start === '13:00').booking, null);
});

test('kun bookeren kan aflyse', () => {
  const store = make();
  const { booking, ownerToken } = store.create({ date: DAY, start: '14:00', name: 'Rolf' });
  assert.throws(() => store.cancel(booking.id, { token: 'forkert' }), /Kun den der bookede/);
  store.cancel(booking.id, { token: ownerToken });
  assert.equal(store.day(DAY).find((s) => s.start === '14:00').booking, null);
});

test('max kommende kampe pr. person', () => {
  const store = make();
  store.create({ date: DAY, start: '15:00', name: 'Rolf' });
  store.create({ date: DAY, start: '15:20', name: 'Anne', players: ['rolf'] });
  assert.throws(() => store.create({ date: DAY, start: '15:40', name: 'ROLF' }), /max 2/);
  assert.doesNotThrow(() => make({ maxActivePerPerson: 0 }).create({ date: DAY, start: '15:40', name: 'Rolf' }));
});

test('samme spiller kan ikke stå to gange i en booking', () => {
  assert.throws(
    () => make().create({ date: DAY, start: '16:00', name: 'Rolf', players: ['Anne', 'rolf'] }),
    /to gange/,
  );
});

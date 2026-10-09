'use strict';

// Kører supabase/schema.sql i en rigtig Postgres (PGlite) og tester reglerne.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
const DAY = '2026-10-09'; // torsdag

async function setup(settings = {}) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;`);
  await db.exec(schema);
  // Fast "nu": torsdag 9. okt 2026 kl. 10:05 lokal tid.
  await db.exec(`create or replace function public._bt_now() returns timestamp language sql stable
                 as $$ select timestamp '2026-10-09 10:05' $$;`);
  for (const [k, v] of Object.entries(settings)) {
    await db.query(`update settings set ${k} = $1`, [v]);
  }
  await db.exec('set role anon'); // test som en anonym browser
  const rpc = async (fn, args) => {
    const keys = Object.keys(args);
    const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    return (await db.query(sql, Object.values(args))).rows[0].r;
  };
  const book = (start, name, players = [], date = DAY) =>
    rpc('book_slot', { p_date: date, p_start: start, p_name: name, p_players: players });
  return { db, rpc, book };
}

test('kan booke en double med fire spillere', async () => {
  const { book, db } = await setup();
  const res = await book('10:20', 'Rolf', ['Anne', 'Bo', 'Cecilie']);
  assert.deepEqual(res.booking.seats, ['Rolf', 'Anne', 'Bo', 'Cecilie']);
  assert.equal(res.booking.start, '10:20');
  assert.ok(res.owner_token);
  assert.equal(res.seat_tokens.length, 4);
  const rows = (await db.query('select * from bookings')).rows;
  assert.equal(rows.length, 1);
});

test('samme tid kan ikke dobbeltbookes', async () => {
  const { book } = await setup();
  await book('11:00', 'Rolf');
  await assert.rejects(book('11:00', 'Anne'), /lige blevet booket/);
});

test('afviser passerede, skæve og for fjerne tider', async () => {
  const { book } = await setup();
  await assert.rejects(book('09:00', 'Rolf'), /passeret/);
  await assert.rejects(book('10:10', 'Rolf'), /Ugyldigt tidspunkt/);
  await assert.rejects(book('17:50', 'Rolf'), /Ugyldigt tidspunkt/);
  await assert.rejects(book('07:40', 'Rolf'), /Ugyldigt tidspunkt/);
  await assert.rejects(book('10:20', 'Rolf', [], '2026-10-08'), /Datoen er passeret/);
  await assert.rejects(book('10:20', 'Rolf', [], '2026-12-01'), /dage frem/);
  await assert.rejects(book('10:20', 'Rolf', [], '2026-10-10'), /weekenden/);
  await assert.rejects(book('10:20', '   '), /navn/);
  await assert.rejects(book('10:20', 'x'.repeat(41)), /40 tegn/);
});

test('den igangværende tid kan stadig bookes', async () => {
  const { book } = await setup();
  assert.equal((await book('10:00', 'Rolf')).booking.start, '10:00');
});

test('weekender kan slås til', async () => {
  const { book } = await setup({ weekends: true });
  assert.ok(await book('10:20', 'Rolf', [], '2026-10-10'));
});

test('andre kan tilmelde sig tomme pladser', async () => {
  const { book, rpc } = await setup();
  const { booking } = await book('12:00', 'Rolf', ['Anne']);
  const joined = await rpc('join_seat', { p_id: booking.id, p_seat: 2, p_name: 'Bo' });
  assert.deepEqual(joined.booking.seats, ['Rolf', 'Anne', 'Bo', null]);
  assert.ok(joined.seat_token);
  await assert.rejects(rpc('join_seat', { p_id: booking.id, p_seat: 2, p_name: 'Cecilie' }), /taget/);
  await assert.rejects(rpc('join_seat', { p_id: booking.id, p_seat: 3, p_name: 'bo' }), /allerede med/);
  await assert.rejects(rpc('join_seat', { p_id: booking.id, p_seat: 7, p_name: 'Dorte' }), /Ugyldig plads/);
});

test('man kan kun forlade sin egen plads, og tom booking forsvinder', async () => {
  const { book, rpc, db } = await setup();
  const { booking, seat_tokens } = await book('13:00', 'Rolf');
  const { seat_token } = await rpc('join_seat', { p_id: booking.id, p_seat: 1, p_name: 'Anne' });
  await assert.rejects(rpc('leave_seat', { p_id: booking.id, p_seat: 0, p_token: seat_token }), /kun fjerne dig selv/);
  await assert.rejects(rpc('leave_seat', { p_id: booking.id, p_seat: 0, p_token: null }), /kun fjerne dig selv/);
  await rpc('leave_seat', { p_id: booking.id, p_seat: 1, p_token: seat_token });
  const res = await rpc('leave_seat', { p_id: booking.id, p_seat: 0, p_token: seat_tokens[0] });
  assert.equal(res.booking, null);
  assert.equal((await db.query('select * from bookings')).rows.length, 0);
});

test('bookeren kan fjerne andre fra sin booking', async () => {
  const { book, rpc } = await setup();
  const { booking, owner_token } = await book('13:20', 'Rolf', ['Anne']);
  const res = await rpc('leave_seat', { p_id: booking.id, p_seat: 1, p_token: owner_token });
  assert.deepEqual(res.booking.seats, ['Rolf', null, null, null]);
});

test('kun bookeren kan aflyse', async () => {
  const { book, rpc, db } = await setup();
  const { booking, owner_token, seat_tokens } = await book('14:00', 'Rolf', ['Anne']);
  await assert.rejects(rpc('cancel_booking', { p_id: booking.id, p_token: seat_tokens[1] }), /Kun den der bookede/);
  await rpc('cancel_booking', { p_id: booking.id, p_token: owner_token });
  assert.equal((await db.query('select * from bookings')).rows.length, 0);
});

test('max kommende kampe pr. person', async () => {
  const { book } = await setup();
  await book('15:00', 'Rolf');
  await book('15:20', 'Anne', ['rolf']);
  await assert.rejects(book('15:40', 'ROLF'), /max 2/);
  const free = await setup({ max_active_per_person: 0 });
  await free.book('15:00', 'Rolf');
  await free.book('15:20', 'Rolf');
  assert.ok(await free.book('15:40', 'Rolf'));
});

test('samme spiller kan ikke stå to gange', async () => {
  const { book } = await setup();
  await assert.rejects(book('16:00', 'Rolf', ['Anne', 'rolf']), /to gange/);
});

test('en anonym browser kan læse bookinger, men ikke snyde', async () => {
  const { book, db } = await setup();
  await book('16:20', 'Rolf');
  assert.equal((await db.query('select * from bookings')).rows.length, 1);
  assert.equal((await db.query('select * from settings')).rows.length, 1);
  await assert.rejects(db.query('select * from booking_secrets'), /permission denied/);
  await assert.rejects(
    db.query(`insert into bookings (date, start, seats, created_by) values ('${DAY}', '16:40', '{a,b,c,d}', 'a')`),
    /permission denied/,
  );
  await assert.rejects(db.query(`update bookings set seats = '{x,y,z,w}'`), /permission denied/);
  await assert.rejects(db.query('delete from bookings'), /permission denied/);
  await assert.rejects(db.query('update settings set max_active_per_person = 99'), /permission denied/);
  await assert.rejects(db.query(`select _bt_assert_under_limit('Rolf')`), /permission denied/);
});

// ───── Scoreboard ─────

const result = (rpc, booking_id, token, extra = {}) =>
  rpc('save_result', { p_booking_id: booking_id, p_token: token, p_winner: 'A', p_stake: 'monster', ...extra });

test('bookeren kan gemme et resultat, når kampen er gået i gang', async () => {
  const { book, rpc } = await setup();
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo', 'Cecilie']);
  const r = await result(rpc, booking.id, owner_token, { p_score_a: 11, p_score_b: 7, p_stake: 'arla' });
  assert.deepEqual(r.team_a, ['Rolf', 'Anne']);
  assert.deepEqual(r.team_b, ['Bo', 'Cecilie']);
  assert.equal(r.winner, 'A');
  assert.equal(r.stake, 'arla');
  assert.equal(r.stake_count, 2);
  assert.equal(r.paid, false);
});

test('kun bookeren kan indtaste resultat, og først når kampen er startet', async () => {
  const { book, rpc } = await setup();
  const now = await book('10:00', 'Rolf', ['Anne', 'Bo']);
  await assert.rejects(result(rpc, now.booking.id, now.seat_tokens[1]), /Kun den der bookede/);
  await assert.rejects(result(rpc, now.booking.id, null), /Kun den der bookede/);
  const later = await book('11:00', 'Dorte', ['Emil', 'Frida']);
  await assert.rejects(result(rpc, later.booking.id, later.owner_token), /ikke gået i gang/);
});

test('resultatet valideres', async () => {
  const { book, rpc } = await setup();
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo']);
  await assert.rejects(result(rpc, booking.id, owner_token, { p_score_a: 5, p_score_b: 11 }), /passer ikke/);
  await assert.rejects(result(rpc, booking.id, owner_token, { p_score_a: 11 }), /begge scorer/);
  await assert.rejects(result(rpc, booking.id, owner_token, { p_stake: 'øl' }), /spillede om/);
  await assert.rejects(result(rpc, booking.id, owner_token, { p_winner: 'C' }), /hvem der vandt/);
  await assert.rejects(result(rpc, booking.id, owner_token, { p_stake_count: 9 }), /mellem 1 og 8/);
  const solo = await setup();
  const s = await solo.book('10:00', 'Rolf', ['Anne']);
  await assert.rejects(result(solo.rpc, s.booking.id, s.owner_token), /Begge hold/);
});

test('et resultat kan rettes, krydses af og slettes af bookeren', async () => {
  const { book, rpc, db } = await setup();
  const { booking, owner_token, seat_tokens } = await book('10:00', 'Rolf', ['Anne', 'Bo']);
  const first = await result(rpc, booking.id, owner_token);
  const again = await result(rpc, booking.id, owner_token, { p_winner: 'B', p_score_a: 9, p_score_b: 11 });
  assert.equal(again.id, first.id, 'samme booking giver samme resultat');
  assert.equal(again.winner, 'B');
  await assert.rejects(
    rpc('set_result_paid', { p_result_id: first.id, p_token: seat_tokens[1], p_paid: true }),
    /Kun den der bookede/,
  );
  const paid = await rpc('set_result_paid', { p_result_id: first.id, p_token: owner_token, p_paid: true });
  assert.equal(paid.paid, true);
  await assert.rejects(rpc('delete_result', { p_result_id: first.id, p_token: 'forkert' }), /Kun den der bookede/);
  await rpc('delete_result', { p_result_id: first.id, p_token: owner_token });
  assert.equal((await db.query('select * from results')).rows.length, 0);
});

test('resultatet overlever, at bookingen aflyses, og kan stadig krydses af', async () => {
  const { book, rpc, db } = await setup();
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo']);
  const r = await result(rpc, booking.id, owner_token);
  await rpc('cancel_booking', { p_id: booking.id, p_token: owner_token });
  const rows = (await db.query('select booking_id from results')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].booking_id, null);
  assert.equal((await rpc('set_result_paid', { p_result_id: r.id, p_token: owner_token, p_paid: true })).paid, true);
});

test('en anonym browser kan læse resultater, men ikke snyde i dem', async () => {
  const { book, rpc, db } = await setup();
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo']);
  await result(rpc, booking.id, owner_token);
  assert.equal((await db.query('select * from results')).rows.length, 1);
  await assert.rejects(db.query('select * from result_secrets'), /permission denied/);
  await assert.rejects(db.query(`update results set paid = true`), /permission denied/);
  await assert.rejects(db.query(`delete from results`), /permission denied/);
  await assert.rejects(
    db.query(`insert into results (date, start, team_a, team_b, winner, stake) values ('${DAY}', '10:00', '{a}', '{b}', 'A', 'arla')`),
    /permission denied/,
  );
});

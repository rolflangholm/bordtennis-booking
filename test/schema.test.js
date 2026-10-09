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

const debts = (...list) => JSON.stringify(list.map(([debtor, creditor, stake]) => ({ debtor, creditor, stake })));
const save = (rpc, booking_id, token, extra = {}) =>
  rpc('save_result', {
    p_booking_id: booking_id,
    p_token: token,
    p_winner: 'A',
    p_debts: debts(['Bo', 'Rolf', 'monster']),
    ...extra,
  });

test('et resultat kan have forskellige drikke til forskellige vindere', async () => {
  const { book, rpc } = await setup();
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo', 'Cecilie']);
  const r = await save(rpc, booking.id, owner_token, {
    p_score_a: 11,
    p_score_b: 7,
    p_debts: debts(['bo', 'Rolf', 'monster'], ['Cecilie', 'anne', 'arla']),
  });
  assert.deepEqual(r.team_a, ['Rolf', 'Anne']);
  assert.deepEqual(r.team_b, ['Bo', 'Cecilie']);
  assert.deepEqual(
    r.debts.map((d) => [d.debtor, d.creditor, d.stake, d.paid]),
    [
      ['Bo', 'Rolf', 'monster', false],
      ['Cecilie', 'Anne', 'arla', false],
    ],
    'navne rettes til holdets stavemåde',
  );
});

test('gæld skal gå fra taberholdet til vinderholdet', async () => {
  const { book, rpc } = await setup();
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo', 'Cecilie']);
  await assert.rejects(save(rpc, booking.id, owner_token, { p_debts: debts(['Anne', 'Rolf', 'arla']) }), /ikke på taberholdet/);
  await assert.rejects(save(rpc, booking.id, owner_token, { p_debts: debts(['Bo', 'Cecilie', 'arla']) }), /ikke på vinderholdet/);
  await assert.rejects(save(rpc, booking.id, owner_token, { p_debts: debts(['Bo', 'Rolf', 'øl']) }), /hvid Monster/);
  await assert.rejects(save(rpc, booking.id, owner_token, { p_debts: '[]' }), /mellem 1 og 8/);
});

test('bookeren og vinderne kan indtaste – taberne og andre kan ikke', async () => {
  const { book, rpc } = await setup();
  const { booking, seat_tokens } = await book('10:00', 'Rolf', ['Anne', 'Bo', 'Cecilie']);
  // Anne (vinder, hold A) må gerne
  assert.ok(await save(rpc, booking.id, seat_tokens[1]));
  // Bo (taber) må ikke ændre det
  await assert.rejects(save(rpc, booking.id, seat_tokens[2]), /Kun bookeren eller vinderne/);
  await assert.rejects(save(rpc, booking.id, 'gæt'), /Kun bookeren eller vinderne/);
  // …og Bo kan ikke bare erklære sit eget hold som vinder, når resultatet findes
  await assert.rejects(
    save(rpc, booking.id, seat_tokens[2], { p_winner: 'B', p_debts: debts(['Rolf', 'Bo', 'arla']) }),
    /Kun bookeren eller vinderne/,
  );
});

test('en vinder kan rette resultatet til det andet hold, hvis det blev tastet forkert', async () => {
  const { book, rpc } = await setup();
  const { booking, seat_tokens } = await book('10:00', 'Rolf', ['Anne', 'Bo', 'Cecilie']);
  await save(rpc, booking.id, seat_tokens[1]); // Anne taster "A vandt"
  const fixed = await save(rpc, booking.id, seat_tokens[1], {
    p_winner: 'B',
    p_debts: debts(['Anne', 'Cecilie', 'arla']),
  });
  assert.equal(fixed.winner, 'B');
});

test('resultat kan først indtastes, når kampen er gået i gang', async () => {
  const { book, rpc } = await setup();
  const later = await book('11:00', 'Rolf', ['Anne', 'Bo']);
  await assert.rejects(save(rpc, later.booking.id, later.owner_token), /ikke gået i gang/);
});

test('scoren og holdene valideres', async () => {
  const { book, rpc } = await setup();
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo']);
  await assert.rejects(save(rpc, booking.id, owner_token, { p_score_a: 5, p_score_b: 11 }), /passer ikke/);
  await assert.rejects(save(rpc, booking.id, owner_token, { p_score_a: 11 }), /begge scorer/);
  await assert.rejects(save(rpc, booking.id, owner_token, { p_winner: 'C' }), /hvem der vandt/);
  const solo = await setup();
  const s = await solo.book('10:00', 'Rolf', ['Anne']);
  await assert.rejects(save(solo.rpc, s.booking.id, s.owner_token, { p_debts: debts(['Anne', 'Rolf', 'arla']) }), /Begge hold/);
});

test('hver drik har sit eget betalt-kryds, som vinderne kan sætte', async () => {
  const { book, rpc } = await setup();
  const { booking, owner_token, seat_tokens } = await book('10:00', 'Rolf', ['Anne', 'Bo', 'Cecilie']);
  const r = await save(rpc, booking.id, owner_token, { p_debts: debts(['Bo', 'Rolf', 'monster'], ['Cecilie', 'Anne', 'arla']) });
  const [d1, d2] = r.debts;
  await assert.rejects(rpc('set_debt_paid', { p_debt_id: d1.id, p_token: seat_tokens[2], p_paid: true }), /Kun bookeren eller vinderne/);
  const after = await rpc('set_debt_paid', { p_debt_id: d2.id, p_token: seat_tokens[1], p_paid: true }); // Anne
  assert.deepEqual(after.debts.map((d) => d.paid), [false, true]);
  // Rettes resultatet uden at ændre den drik, bevares "betalt"
  const edited = await save(rpc, booking.id, owner_token, {
    p_score_a: 11,
    p_score_b: 3,
    p_debts: debts(['Bo', 'Rolf', 'arla'], ['Cecilie', 'Anne', 'arla']),
  });
  assert.deepEqual(edited.debts.map((d) => [d.stake, d.paid]), [['arla', false], ['arla', true]]);
});

test('resultatet overlever, at bookingen aflyses, og vinderne kan stadig krydse af', async () => {
  const { book, rpc, db } = await setup();
  const { booking, owner_token, seat_tokens } = await book('10:00', 'Rolf', ['Anne', 'Bo']);
  const r = await save(rpc, booking.id, owner_token);
  await rpc('cancel_booking', { p_id: booking.id, p_token: owner_token });
  assert.equal((await db.query('select booking_id from results')).rows[0].booking_id, null);
  const paid = await rpc('set_debt_paid', { p_debt_id: r.debts[0].id, p_token: seat_tokens[1], p_paid: true });
  assert.equal(paid.debts[0].paid, true);
  await assert.rejects(rpc('delete_result', { p_result_id: r.id, p_token: seat_tokens[2] }), /Kun bookeren eller vinderne/);
  await rpc('delete_result', { p_result_id: r.id, p_token: seat_tokens[1] });
  assert.equal((await db.query('select * from result_debts')).rows.length, 0);
});

test('"det er mig": en browser kan hente nøglen til sin plads én gang', async () => {
  const { book, rpc } = await setup();
  const { booking, seat_tokens } = await book('10:00', 'Rolf', ['Henrik', 'Bo']);
  const claimed = await rpc('claim_my_seats', { p_name: 'henrik' });
  assert.deepEqual(claimed, [{ booking_id: booking.id, seat: 1, token: seat_tokens[1] }]);
  assert.deepEqual(await rpc('claim_my_seats', { p_name: 'Henrik' }), [], 'kun første browser får nøglen');
  assert.deepEqual(await rpc('claim_my_seats', { p_name: 'Rolf' }), [], 'bookerens plads er allerede taget');
  // Med nøglen kan Henrik (vinder) indtaste resultatet
  assert.ok(await save(rpc, booking.id, claimed[0].token, { p_debts: debts(['Bo', 'Henrik', 'arla']) }));
});

test('selvtilmeldte har allerede nøglen og kan ikke "claimes" af andre', async () => {
  const { book, rpc } = await setup();
  const { booking } = await book('10:00', 'Rolf', [null, 'Bo']);
  await rpc('join_seat', { p_id: booking.id, p_seat: 1, p_name: 'Dorte' });
  assert.deepEqual(await rpc('claim_my_seats', { p_name: 'Dorte' }), []);
});

test('en anonym browser kan læse resultater, men ikke snyde i dem', async () => {
  const { book, rpc, db } = await setup();
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo']);
  await save(rpc, booking.id, owner_token);
  assert.equal((await db.query('select * from results')).rows.length, 1);
  assert.equal((await db.query('select * from result_debts')).rows.length, 1);
  await assert.rejects(db.query('select * from result_secrets'), /permission denied/);
  await assert.rejects(db.query('select * from booking_secrets'), /permission denied/);
  await assert.rejects(db.query(`update result_debts set paid = true`), /permission denied/);
  await assert.rejects(db.query(`delete from results`), /permission denied/);
  await assert.rejects(db.query(`select _bt_editor_tokens(id, 'A') from bookings`), /permission denied/);
});

// ───── Køleskabet ─────

const fridge = async (db) =>
  Object.fromEntries((await db.query('select stake, count from fridge')).rows.map((r) => [r.stake, r.count]));

test('alle kan rette antallet i køleskabet, og det logges med navn', async () => {
  const { rpc, db } = await setup();
  assert.deepEqual(await fridge(db), { monster: 0, arla: 0 });
  assert.deepEqual(await rpc('set_fridge_stock', { p_name: 'Festudvalget', p_monster: 12, p_arla: 8 }), { monster: 12, arla: 8 });
  await rpc('set_fridge_stock', { p_name: 'Rolf', p_monster: 10, p_arla: null });
  assert.deepEqual(await fridge(db), { monster: 10, arla: 8 });
  const log = (await db.query('select stake, delta, reason, by_name from fridge_log order by id')).rows;
  assert.deepEqual(log.map((l) => [l.stake, l.delta, l.reason, l.by_name]), [
    ['monster', 12, 'Fyldt op', 'Festudvalget'],
    ['arla', 8, 'Fyldt op', 'Festudvalget'],
    ['monster', -2, 'Optalt', 'Rolf'],
  ]);
  await assert.rejects(rpc('set_fridge_stock', { p_name: '', p_monster: 1, p_arla: 1 }), /navn/);
  await assert.rejects(rpc('set_fridge_stock', { p_name: 'X', p_monster: -1, p_arla: 1 }), /mellem 0 og 999/);
  await assert.rejects(db.query('update fridge set count = 99'), /permission denied/);
});

test('når en drik krydses af som betalt, går den fra i køleskabet – og tilbage hvis det fortrydes', async () => {
  const { book, rpc, db } = await setup();
  await rpc('set_fridge_stock', { p_name: 'Festudvalget', p_monster: 5, p_arla: 5 });
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo', 'Cecilie']);
  const r = await save(rpc, booking.id, owner_token, { p_debts: debts(['Bo', 'Rolf', 'monster'], ['Cecilie', 'Anne', 'arla']) });
  await rpc('set_debt_paid', { p_debt_id: r.debts[0].id, p_token: owner_token, p_paid: true });
  await rpc('set_debt_paid', { p_debt_id: r.debts[0].id, p_token: owner_token, p_paid: true }); // dobbeltklik tæller ikke to gange
  assert.deepEqual(await fridge(db), { monster: 4, arla: 5 });
  await rpc('set_debt_paid', { p_debt_id: r.debts[0].id, p_token: owner_token, p_paid: false });
  assert.deepEqual(await fridge(db), { monster: 5, arla: 5 });
  const last = (await db.query('select reason, by_name from fridge_log order by id desc limit 2')).rows;
  assert.deepEqual(last.map((l) => l.reason), ['Fortrudt: Bo → Rolf', 'Bo → Rolf']);
});

test('køleskabet går ikke under nul', async () => {
  const { book, rpc, db } = await setup();
  const { booking, owner_token } = await book('10:00', 'Rolf', ['Anne', 'Bo']);
  const r = await save(rpc, booking.id, owner_token);
  await rpc('set_debt_paid', { p_debt_id: r.debts[0].id, p_token: owner_token, p_paid: true });
  assert.deepEqual(await fridge(db), { monster: 0, arla: 0 });
});

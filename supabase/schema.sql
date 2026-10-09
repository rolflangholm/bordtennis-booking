-- Bordtennis booking: database til Supabase.
-- Kør hele filen i Supabase → SQL Editor. Den kan køres igen uden at slette bookinger.
--
-- Sikkerhedsmodel: alle må læse bookinger, men ingen må skrive direkte i tabellerne.
-- Al booking sker gennem funktionerne nederst, som håndhæver reglerne.
-- Tokens til "aflys" og "fjern mig" ligger i en tabel, som browseren ikke kan læse.

-- ───────────────────────────── Tabeller ─────────────────────────────

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  title text not null default 'Bordtennis booking',
  slot_minutes int not null default 20 check (slot_minutes between 5 and 120),
  buffer_minutes int not null default 5 check (buffer_minutes >= 0), -- del af hver tid til at spille færdig og skifte
  open_time time not null default '08:00',
  close_time time not null default '18:00',
  days_ahead int not null default 14 check (days_ahead between 0 and 90),
  max_active_per_person int not null default 2 check (max_active_per_person >= 0), -- 0 = ingen grænse
  weekends boolean not null default false,
  timezone text not null default 'Europe/Copenhagen'
);
-- Tilføjet senere; kan køres på en eksisterende database.
alter table public.settings add column if not exists buffer_minutes int not null default 5 check (buffer_minutes >= 0);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  start time not null,
  seats text[] not null check (cardinality(seats) = 4), -- hold A = 1+2, hold B = 3+4
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (date, start)
);

create table if not exists public.booking_secrets (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  owner_token text not null,
  seat_tokens text[] not null
);
-- Tilføjet senere: hvilke pladser en browser allerede har hentet nøglen til.
alter table public.booking_secrets add column if not exists claimed boolean[] not null default '{t,f,f,f}';

alter table public.settings enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_secrets enable row level security;

drop policy if exists "alle kan læse indstillinger" on public.settings;
create policy "alle kan læse indstillinger" on public.settings for select using (true);
drop policy if exists "alle kan læse bookinger" on public.bookings;
create policy "alle kan læse bookinger" on public.bookings for select using (true);
-- booking_secrets har ingen policies: ingen adgang udefra.

-- ───────────────────────────── Hjælpere ─────────────────────────────

-- "Nu" i kontorets tidszone. Testene erstatter denne funktion for at styre tiden.
create or replace function public._bt_now()
returns timestamp language sql stable
set search_path = public
as $$
  select now() at time zone (select timezone from settings where id = 1)
$$;

create or replace function public._bt_slot_end(p_date date, p_start time)
returns timestamp language sql stable
set search_path = public
as $$
  select p_date + p_start + make_interval(mins => (select slot_minutes from settings where id = 1))
$$;

create or replace function public._bt_clean_name(p_raw text, p_field text default 'Navn')
returns text language plpgsql immutable
as $$
declare
  v text := btrim(regexp_replace(coalesce(p_raw, ''), '\s+', ' ', 'g'));
begin
  if v = '' then return null; end if;
  if char_length(v) > 40 then
    raise exception '% må højst være 40 tegn', p_field;
  end if;
  return v;
end $$;

create or replace function public._bt_assert_under_limit(p_name text)
returns void language plpgsql
set search_path = public
as $$
declare
  v_max int := (select max_active_per_person from settings where id = 1);
  v_count int;
begin
  if v_max = 0 then return; end if;
  select count(*) into v_count
  from bookings b
  where _bt_slot_end(b.date, b.start) > _bt_now()
    and exists (select 1 from unnest(b.seats) s where lower(s) = lower(p_name));
  if v_count >= v_max then
    raise exception '% er allerede med i % kommende kampe (max %). Giv plads til de andre 🏓',
      p_name, v_count, v_max;
  end if;
end $$;

create or replace function public._bt_public(b public.bookings)
returns json language sql stable
as $$
  select json_build_object(
    'id', b.id, 'date', b.date, 'start', to_char(b.start, 'HH24:MI'),
    'created_by', b.created_by, 'seats', to_json(b.seats)
  )
$$;

-- ───────────────────────────── Funktioner (API) ─────────────────────────────

-- Book en tid. p_players er [makker, modstander, modstander]; tomme pladser må gerne være null.
create or replace function public.book_slot(p_date date, p_start time, p_name text, p_players text[] default '{}')
returns json language plpgsql security definer
set search_path = public
as $$
declare
  s settings := (select x from settings x where id = 1);
  v_today date := _bt_now()::date;
  v_booker text := _bt_clean_name(p_name);
  v_seats text[] := array[v_booker, null, null, null];
  v_tokens text[] := array[null, null, null, null]::text[];
  v_owner text := gen_random_uuid()::text;
  v_filled text[];
  b bookings;
  i int;
begin
  perform pg_advisory_xact_lock(hashtext('bordtennis-booking'));

  if v_booker is null then raise exception 'Skriv dit navn'; end if;
  if p_date is null or p_start is null then raise exception 'Vælg en tid'; end if;
  if p_date < v_today then raise exception 'Datoen er passeret'; end if;
  if p_date > v_today + s.days_ahead then
    raise exception 'Du kan højst booke % dage frem', s.days_ahead;
  end if;
  if not s.weekends and extract(isodow from p_date) > 5 then
    raise exception 'Der kan ikke bookes i weekenden';
  end if;
  if p_start < s.open_time
     or p_start + make_interval(mins => s.slot_minutes) > s.close_time
     or (extract(epoch from p_start - s.open_time) / 60)::int % s.slot_minutes <> 0
     or extract(second from p_start) <> 0 then
    raise exception 'Ugyldigt tidspunkt';
  end if;
  if _bt_slot_end(p_date, p_start) <= _bt_now() then raise exception 'Tidspunktet er passeret'; end if;
  if exists (select 1 from bookings where date = p_date and start = p_start) then
    raise exception 'Tiden er lige blevet booket af en anden';
  end if;

  for i in 1..3 loop
    v_seats[i + 1] := _bt_clean_name(p_players[i], 'Spillernavn');
  end loop;
  v_filled := array(select x from unnest(v_seats) x where x is not null);
  if (select count(distinct lower(x)) from unnest(v_filled) x) <> cardinality(v_filled) then
    raise exception 'Den samme spiller kan ikke stå to gange';
  end if;
  for i in 1..cardinality(v_filled) loop
    perform _bt_assert_under_limit(v_filled[i]);
  end loop;

  for i in 1..4 loop
    if v_seats[i] is not null then v_tokens[i] := gen_random_uuid()::text; end if;
  end loop;

  -- Ryd gamle bookinger op, så tabellen ikke vokser for evigt.
  delete from bookings where date < v_today - 60;

  insert into bookings (date, start, seats, created_by)
  values (p_date, p_start, v_seats, v_booker)
  returning * into b;
  insert into booking_secrets (booking_id, owner_token, seat_tokens, claimed)
  values (b.id, v_owner, v_tokens, array[true, false, false, false]);

  return json_build_object('booking', _bt_public(b), 'owner_token', v_owner, 'seat_tokens', to_json(v_tokens));
end $$;

-- Tilmeld dig en tom plads. p_seat er 0-3.
create or replace function public.join_seat(p_id uuid, p_seat int, p_name text)
returns json language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := _bt_clean_name(p_name);
  v_token text := gen_random_uuid()::text;
  b bookings;
begin
  perform pg_advisory_xact_lock(hashtext('bordtennis-booking'));
  select * into b from bookings where id = p_id;
  if not found then raise exception 'Bookingen findes ikke'; end if;
  if _bt_slot_end(b.date, b.start) <= _bt_now() then raise exception 'Kampen er slut'; end if;
  if p_seat is null or p_seat not between 0 and 3 then raise exception 'Ugyldig plads'; end if;
  if b.seats[p_seat + 1] is not null then raise exception 'Pladsen er lige blevet taget'; end if;
  if v_name is null then raise exception 'Skriv dit navn'; end if;
  if exists (select 1 from unnest(b.seats) x where lower(x) = lower(v_name)) then
    raise exception '% er allerede med i kampen', v_name;
  end if;
  perform _bt_assert_under_limit(v_name);

  update bookings set seats[p_seat + 1] = v_name where id = p_id returning * into b;
  update booking_secrets set seat_tokens[p_seat + 1] = v_token, claimed[p_seat + 1] = true where booking_id = p_id;
  return json_build_object('booking', _bt_public(b), 'seat_token', v_token);
end $$;

-- Forlad en plads. Kræver pladsens token eller bookerens token.
-- Bliver alle pladser tomme, slettes bookingen.
create or replace function public.leave_seat(p_id uuid, p_seat int, p_token text)
returns json language plpgsql security definer
set search_path = public
as $$
declare
  b bookings;
  sec booking_secrets;
begin
  perform pg_advisory_xact_lock(hashtext('bordtennis-booking'));
  select * into b from bookings where id = p_id;
  if not found then raise exception 'Bookingen findes ikke'; end if;
  if p_seat is null or p_seat not between 0 and 3 or b.seats[p_seat + 1] is null then
    raise exception 'Pladsen er allerede tom';
  end if;
  select * into sec from booking_secrets where booking_id = p_id;
  if p_token is null or (p_token is distinct from sec.seat_tokens[p_seat + 1] and p_token <> sec.owner_token) then
    raise exception 'Du kan kun fjerne dig selv';
  end if;

  update bookings set seats[p_seat + 1] = null where id = p_id returning * into b;
  update booking_secrets set seat_tokens[p_seat + 1] = null, claimed[p_seat + 1] = false where booking_id = p_id;
  if (select bool_and(x is null) from unnest(b.seats) x) then
    delete from bookings where id = p_id;
    return json_build_object('booking', null);
  end if;
  return json_build_object('booking', _bt_public(b));
end $$;

-- Aflys hele bookingen. Kun bookeren.
create or replace function public.cancel_booking(p_id uuid, p_token text)
returns json language plpgsql security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('bordtennis-booking'));
  if not exists (select 1 from bookings where id = p_id) then
    raise exception 'Bookingen findes ikke';
  end if;
  if not exists (select 1 from booking_secrets where booking_id = p_id and owner_token = p_token) then
    raise exception 'Kun den der bookede kan aflyse';
  end if;
  delete from bookings where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ───────────────────────────── Scoreboard ─────────────────────────────
-- Et resultat har en liste af "gæld": hvem på taberholdet giver hvad til hvem på vinderholdet,
-- hver med sit eget "betalt"-kryds. Resultater gemmes med en kopi af holdene, så de overlever,
-- at bookingen senere ryddes op. Bookeren og vinderne kan rette i dem.

drop function if exists public.save_result(uuid, text, text, text, int, int, int);
drop function if exists public.set_result_paid(uuid, text, boolean);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings (id) on delete set null,
  date date not null,
  start time not null,
  team_a text[] not null,
  team_b text[] not null,
  winner text not null check (winner in ('A', 'B')),
  score_a int check (score_a between 0 and 99),
  score_b int check (score_b between 0 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists results_date_idx on public.results (date);

create table if not exists public.result_debts (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.results (id) on delete cascade,
  position int not null,
  debtor text not null,   -- taberen der giver
  creditor text not null, -- vinderen der får
  stake text not null check (stake in ('monster', 'arla')), -- hvid Monster eller Arla Protein kakao
  paid boolean not null default false -- betalt / taget fra køleskabet
);
create index if not exists result_debts_result_idx on public.result_debts (result_id);

create table if not exists public.result_secrets (
  result_id uuid primary key references public.results (id) on delete cascade,
  editor_tokens text[] not null -- bookeren + vindernes pladser; bruges hvis bookingen er væk
);

alter table public.results enable row level security;
alter table public.result_debts enable row level security;
alter table public.result_secrets enable row level security;
drop policy if exists "alle kan læse resultater" on public.results;
create policy "alle kan læse resultater" on public.results for select using (true);
drop policy if exists "alle kan læse gæld" on public.result_debts;
create policy "alle kan læse gæld" on public.result_debts for select using (true);

create or replace function public._bt_result_public(r public.results)
returns json language sql stable
set search_path = public
as $$
  select json_build_object(
    'id', r.id, 'booking_id', r.booking_id, 'date', r.date, 'start', to_char(r.start, 'HH24:MI'),
    'team_a', to_json(r.team_a), 'team_b', to_json(r.team_b), 'winner', r.winner,
    'score_a', r.score_a, 'score_b', r.score_b,
    'debts', (
      select coalesce(json_agg(json_build_object(
        'id', d.id, 'debtor', d.debtor, 'creditor', d.creditor, 'stake', d.stake, 'paid', d.paid
      ) order by d.position), '[]')
      from result_debts d where d.result_id = r.id
    )
  )
$$;

-- Nøgler der må rette: bookerens + nøglerne til vinderholdets pladser.
create or replace function public._bt_editor_tokens(p_booking_id uuid, p_winner text)
returns text[] language sql stable
set search_path = public
as $$
  select array_remove(
    array[s.owner_token] || case when p_winner = 'A' then s.seat_tokens[1:2] else s.seat_tokens[3:4] end,
    null)
  from booking_secrets s where s.booking_id = p_booking_id
$$;

create or replace function public._bt_can_edit(r public.results, p_token text)
returns boolean language sql stable
set search_path = public
as $$
  select p_token is not null and coalesce(
    case
      when exists (select 1 from booking_secrets where booking_id = r.booking_id)
        then p_token = any (_bt_editor_tokens(r.booking_id, r.winner))
      else exists (select 1 from result_secrets where result_id = r.id and p_token = any (editor_tokens))
    end, false)
$$;

-- Gem eller ret resultatet. p_debts: [{"debtor": "Rolf", "creditor": "Henrik", "stake": "monster"}, …]
create or replace function public.save_result(
  p_booking_id uuid, p_token text, p_winner text, p_debts jsonb,
  p_score_a int default null, p_score_b int default null
)
returns json language plpgsql security definer
set search_path = public
as $$
declare
  b bookings;
  r results;
  old_r results;
  v_a text[];
  v_b text[];
  v_win text[];
  v_lose text[];
  v_old jsonb;
  v_debtor text;
  v_creditor text;
  v_allowed boolean;
  rec record;
begin
  perform pg_advisory_xact_lock(hashtext('bordtennis-booking'));
  select * into b from bookings where id = p_booking_id;
  if not found then raise exception 'Bookingen findes ikke'; end if;
  if p_winner is null or p_winner not in ('A', 'B') then raise exception 'Vælg hvem der vandt'; end if;

  select * into old_r from results where booking_id = b.id;
  -- Nyt resultat: bookeren eller det hold, der skrives som vinder.
  -- Findes resultatet allerede: kun bookeren eller de nuværende vindere (så taberne ikke kan vende det).
  if old_r.id is not null then
    v_allowed := _bt_can_edit(old_r, p_token);
  else
    v_allowed := coalesce(p_token = any (_bt_editor_tokens(b.id, p_winner)), false);
  end if;
  if not v_allowed then
    raise exception 'Kun bookeren eller vinderne kan indtaste resultatet';
  end if;
  if b.date + b.start > _bt_now() then raise exception 'Kampen er ikke gået i gang endnu'; end if;

  v_a := array_remove(b.seats[1:2], null);
  v_b := array_remove(b.seats[3:4], null);
  if cardinality(v_a) = 0 or cardinality(v_b) = 0 then
    raise exception 'Begge hold skal have mindst én spiller';
  end if;
  v_win := case when p_winner = 'A' then v_a else v_b end;
  v_lose := case when p_winner = 'A' then v_b else v_a end;

  if (p_score_a is null) <> (p_score_b is null) then raise exception 'Udfyld begge scorer eller ingen'; end if;
  if p_score_a is not null and (p_score_a not between 0 and 99 or p_score_b not between 0 and 99) then
    raise exception 'Scoren skal være mellem 0 og 99';
  end if;
  if p_score_a is not null and (
       (p_winner = 'A' and p_score_a <= p_score_b) or (p_winner = 'B' and p_score_b <= p_score_a)) then
    raise exception 'Scoren passer ikke med vinderen';
  end if;
  if p_debts is null or jsonb_typeof(p_debts) <> 'array' or jsonb_array_length(p_debts) not between 1 and 8 then
    raise exception 'Angiv mellem 1 og 8 drikke';
  end if;

  insert into results (booking_id, date, start, team_a, team_b, winner, score_a, score_b)
  values (b.id, b.date, b.start, v_a, v_b, p_winner, p_score_a, p_score_b)
  on conflict (booking_id) do update set
    team_a = excluded.team_a, team_b = excluded.team_b, winner = excluded.winner,
    score_a = excluded.score_a, score_b = excluded.score_b, updated_at = now()
  returning * into r;

  -- Behold "betalt" på gæld, der er uændret.
  select jsonb_agg(jsonb_build_object('p', position, 'd', lower(debtor), 'c', lower(creditor), 's', stake))
    into v_old from result_debts where result_id = r.id and paid;
  delete from result_debts where result_id = r.id;

  for rec in select value as d, ordinality as i from jsonb_array_elements(p_debts) with ordinality loop
    v_debtor := (select x from unnest(v_lose) x where lower(x) = lower(btrim(rec.d ->> 'debtor')) limit 1);
    v_creditor := (select x from unnest(v_win) x where lower(x) = lower(btrim(rec.d ->> 'creditor')) limit 1);
    if v_debtor is null then raise exception '% er ikke på taberholdet', coalesce(rec.d ->> 'debtor', '?'); end if;
    if v_creditor is null then raise exception '% er ikke på vinderholdet', coalesce(rec.d ->> 'creditor', '?'); end if;
    if (rec.d ->> 'stake') is null or (rec.d ->> 'stake') not in ('monster', 'arla') then
      raise exception 'Vælg hvid Monster eller Arla Protein kakao';
    end if;
    insert into result_debts (result_id, position, debtor, creditor, stake, paid)
    values (r.id, rec.i, v_debtor, v_creditor, rec.d ->> 'stake', coalesce(v_old @> jsonb_build_array(
      jsonb_build_object('p', rec.i, 'd', lower(v_debtor), 'c', lower(v_creditor), 's', rec.d ->> 'stake')), false));
  end loop;

  insert into result_secrets (result_id, editor_tokens) values (r.id, _bt_editor_tokens(b.id, p_winner))
  on conflict (result_id) do update set editor_tokens = excluded.editor_tokens;
  return _bt_result_public(r);
end $$;

-- Sæt kryds ved "betalt / taget fra køleskabet" for én drik. Bookeren eller vinderne.
create or replace function public.set_debt_paid(p_debt_id uuid, p_token text, p_paid boolean)
returns json language plpgsql security definer
set search_path = public
as $$
declare
  r results;
  d result_debts;
begin
  perform pg_advisory_xact_lock(hashtext('bordtennis-booking'));
  select res.* into r from results res join result_debts x on x.result_id = res.id where x.id = p_debt_id;
  if not found then raise exception 'Findes ikke længere'; end if;
  if not _bt_can_edit(r, p_token) then raise exception 'Kun bookeren eller vinderne kan krydse af'; end if;
  select * into d from result_debts where id = p_debt_id;
  if d.paid is distinct from coalesce(p_paid, false) then
    update result_debts set paid = coalesce(p_paid, false) where id = p_debt_id;
    perform _bt_fridge_change(d.stake, case when p_paid then -1 else 1 end,
      case when p_paid then format('%s → %s', d.debtor, d.creditor) else format('Fortrudt: %s → %s', d.debtor, d.creditor) end,
      d.creditor);
  end if;
  update results set updated_at = now() where id = r.id returning * into r;
  return _bt_result_public(r);
end $$;

-- Slet et resultat. Bookeren eller vinderne.
create or replace function public.delete_result(p_result_id uuid, p_token text)
returns json language plpgsql security definer
set search_path = public
as $$
declare
  r results;
begin
  select * into r from results where id = p_result_id;
  if not found then raise exception 'Findes ikke længere'; end if;
  if not _bt_can_edit(r, p_token) then raise exception 'Kun bookeren eller vinderne kan slette resultatet'; end if;
  delete from results where id = p_result_id;
  return json_build_object('ok', true);
end $$;

-- "Det er mig": giv denne browser nøglen til de pladser (de sidste 14 dage og frem), hvor
-- navnet står, og som ingen anden browser har hentet endnu. Bygger på tillid, ligesom navnene.
create or replace function public.claim_my_seats(p_name text)
returns json language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := _bt_clean_name(p_name);
  v_out json;
begin
  if v_name is null then return '[]'::json; end if;
  perform pg_advisory_xact_lock(hashtext('bordtennis-booking'));
  with hits as (
    select b.id, i as seat, s.seat_tokens[i] as token
    from bookings b
    join booking_secrets s on s.booking_id = b.id
    cross join generate_subscripts(b.seats, 1) i
    where b.date >= _bt_now()::date - 14
      and lower(b.seats[i]) = lower(v_name)
      and not coalesce(s.claimed[i], false)
      and s.seat_tokens[i] is not null
  ), upd as (
    update booking_secrets s set claimed[h.seat] = true from hits h where s.booking_id = h.id returning 1
  )
  select coalesce(json_agg(json_build_object('booking_id', h.id, 'seat', h.seat - 1, 'token', h.token)), '[]')
    into v_out from hits h;
  return v_out;
end $$;

-- ───────────────────────────── Køleskabet ─────────────────────────────
-- Lager af drikke. Går automatisk ned, når en drik krydses af som "betalt / taget",
-- og kan rettes af alle (fx festudvalget efter påfyldning). Alt logges.

alter table public.settings add column if not exists fridge_low_at int not null default 4
  check (fridge_low_at >= 0); -- "snart tomt" når der er så få tilbage (til påmindelser)

create table if not exists public.fridge (
  stake text primary key check (stake in ('monster', 'arla')),
  count int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.fridge (stake) values ('monster'), ('arla') on conflict (stake) do nothing;

create table if not exists public.fridge_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  stake text not null,
  delta int not null,
  count_after int not null,
  reason text not null,
  by_name text
);
create index if not exists fridge_log_at_idx on public.fridge_log (at desc);

alter table public.fridge enable row level security;
alter table public.fridge_log enable row level security;
drop policy if exists "alle kan læse køleskabet" on public.fridge;
create policy "alle kan læse køleskabet" on public.fridge for select using (true);
drop policy if exists "alle kan læse køleskabsloggen" on public.fridge_log;
create policy "alle kan læse køleskabsloggen" on public.fridge_log for select using (true);

create or replace function public._bt_fridge_change(p_stake text, p_delta int, p_reason text, p_by text)
returns void language plpgsql
set search_path = public
as $$
declare
  v_after int;
begin
  if p_delta = 0 then return; end if;
  update fridge set count = greatest(count + p_delta, 0), updated_at = now(), updated_by = p_by
    where stake = p_stake returning count into v_after;
  insert into fridge_log (stake, delta, count_after, reason, by_name) values (p_stake, p_delta, v_after, p_reason, p_by);
end $$;

-- Ret antallet i køleskabet (optælling eller påfyldning). Alle må, men navnet logges.
create or replace function public.set_fridge_stock(p_name text, p_monster int, p_arla int)
returns json language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := _bt_clean_name(p_name);
  v_old int;
  v_new int;
  v_stake text;
begin
  if v_name is null then raise exception 'Skriv dit navn'; end if;
  perform pg_advisory_xact_lock(hashtext('bordtennis-booking'));
  foreach v_stake in array array['monster', 'arla'] loop
    v_new := case v_stake when 'monster' then p_monster else p_arla end;
    if v_new is null then continue; end if;
    if v_new not between 0 and 999 then raise exception 'Antal skal være mellem 0 og 999'; end if;
    select count into v_old from fridge where stake = v_stake;
    perform _bt_fridge_change(v_stake, v_new - v_old,
      case when v_new > v_old then 'Fyldt op' else 'Optalt' end, v_name);
  end loop;
  return (select json_object_agg(stake, count) from fridge);
end $$;

-- ───────────────────────────── Rettigheder ─────────────────────────────

revoke all on public.booking_secrets, public.result_secrets from public;
revoke insert, update, delete on public.bookings, public.settings, public.results, public.result_debts, public.fridge, public.fridge_log from public;
revoke execute on all functions in schema public from public;
grant execute on function
  public.book_slot(date, time, text, text[]),
  public.join_seat(uuid, int, text),
  public.leave_seat(uuid, int, text),
  public.cancel_booking(uuid, text),
  public.save_result(uuid, text, text, jsonb, int, int),
  public.set_debt_paid(uuid, text, boolean),
  public.delete_result(uuid, text),
  public.claim_my_seats(text),
  public.set_fridge_stock(text, int, int)
to public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.booking_secrets, public.result_secrets from anon, authenticated;
    revoke insert, update, delete, truncate on public.bookings, public.settings, public.results, public.result_debts, public.fridge, public.fridge_log from anon, authenticated;
    grant select on public.bookings, public.settings, public.results, public.result_debts, public.fridge, public.fridge_log to anon, authenticated;
    revoke execute on all functions in schema public from anon, authenticated;
    grant execute on function
      public.book_slot(date, time, text, text[]),
      public.join_seat(uuid, int, text),
      public.leave_seat(uuid, int, text),
      public.cancel_booking(uuid, text),
      public.save_result(uuid, text, text, jsonb, int, int),
      public.set_debt_paid(uuid, text, boolean),
      public.delete_result(uuid, text),
      public.claim_my_seats(text),
      public.set_fridge_stock(text, int, int)
    to anon, authenticated;
  end if;
end $$;

-- ───────────────────────────── Live-opdatering ─────────────────────────────

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['bookings', 'results', 'result_debts', 'fridge'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

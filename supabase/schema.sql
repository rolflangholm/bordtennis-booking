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
  open_time time not null default '08:00',
  close_time time not null default '18:00',
  days_ahead int not null default 14 check (days_ahead between 0 and 90),
  max_active_per_person int not null default 2 check (max_active_per_person >= 0), -- 0 = ingen grænse
  weekends boolean not null default false,
  timezone text not null default 'Europe/Copenhagen'
);
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
  insert into booking_secrets values (b.id, v_owner, v_tokens);

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
  update booking_secrets set seat_tokens[p_seat + 1] = v_token where booking_id = p_id;
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
  update booking_secrets set seat_tokens[p_seat + 1] = null where booking_id = p_id;
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

-- ───────────────────────────── Rettigheder ─────────────────────────────

revoke all on public.booking_secrets from public;
revoke insert, update, delete on public.bookings, public.settings from public;
revoke execute on all functions in schema public from public;
grant execute on function
  public.book_slot(date, time, text, text[]),
  public.join_seat(uuid, int, text),
  public.leave_seat(uuid, int, text),
  public.cancel_booking(uuid, text)
to public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.booking_secrets from anon, authenticated;
    revoke insert, update, delete, truncate on public.bookings, public.settings from anon, authenticated;
    grant select on public.bookings, public.settings to anon, authenticated;
    revoke execute on all functions in schema public from anon, authenticated;
    grant execute on function
      public.book_slot(date, time, text, text[]),
      public.join_seat(uuid, int, text),
      public.leave_seat(uuid, int, text),
      public.cancel_booking(uuid, text)
    to anon, authenticated;
  end if;
end $$;

-- ───────────────────────────── Live-opdatering ─────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
     ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;

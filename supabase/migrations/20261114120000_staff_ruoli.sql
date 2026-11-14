-- Accessi riservati allo staff vero.
-- Prima: qualunque utente autenticato di Supabase era "staff" (policy `using (true)`) e l'admin era
-- un'email scritta nel codice. Ora lo staff è l'elenco della tabella `staff`, con un ruolo:
--   staff  = uso normale del gestionale
--   admin  = in più: log attività, report, impostazioni (is_log_admin)
-- Chi è autenticato ma non è in `staff` non legge e non scrive niente.
--
-- Nessuno resta chiuso fuori: tutti gli utenti che esistono ADESSO diventano staff, e
-- loriscuba@gmail.com diventa admin. I NUOVI utenti invece vanno aggiunti a mano:
--   insert into staff (user_id) select id from auth.users where email = 'nuovo@esempio.it';
--   update staff set ruolo = 'admin' where user_id = (select id from auth.users where email = '...');
-- Si può rieseguire senza problemi.

create table if not exists staff (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  ruolo     text not null default 'staff' check (ruolo in ('staff', 'admin')),
  creato_il timestamptz not null default now()
);
alter table staff enable row level security;

insert into staff (user_id, ruolo)
select id, case when lower(email) = 'loriscuba@gmail.com' then 'admin' else 'staff' end from auth.users
on conflict (user_id) do nothing;

-- security definer: leggono `staff` senza passare dalle sue policy (che a loro volta le usano)
create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid())
$$;

create or replace function is_log_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid() and ruolo = 'admin')
$$;

-- per le funzioni: blocca chi non è staff
create or replace function richiedi_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'Accesso riservato allo staff' using errcode = '42501';
  end if;
end $$;

revoke execute on function is_staff(), is_log_admin(), richiedi_staff() from public, anon;
grant execute on function is_staff(), is_log_admin(), richiedi_staff() to authenticated;

drop policy if exists staff_read_staff on staff;
create policy staff_read_staff on staff for select to authenticated
  using (user_id = (select auth.uid()) or (select is_log_admin()));
drop policy if exists admin_write_staff on staff;
create policy admin_write_staff on staff for all to authenticated
  using ((select is_log_admin())) with check ((select is_log_admin()));

-- 1. Tabelle: ogni policy "tutti gli autenticati" (true) diventa "solo lo staff".
do $$
declare r record;
begin
  for r in
    select tablename, policyname, qual, with_check from pg_policies
    where schemaname = current_schema() and roles = '{authenticated}' and (qual = 'true' or with_check = 'true')
  loop
    execute format('alter policy %I on %I %s %s', r.policyname, r.tablename,
      case when r.qual = 'true' then 'using ((select is_staff()))' else '' end,
      case when r.with_check = 'true' then 'with check ((select is_staff()))' else '' end);
  end loop;
end $$;

-- 2. Funzioni staff_*: girano con i permessi del proprietario (security definer) e quindi saltano le
--    policy. Si aggiunge in testa al corpo esistente il controllo richiedi_staff(), senza toccare il resto.
do $$
declare
  f record;
  nuovo text;
begin
  for f in
    select p.oid, p.proname, p.prosrc, l.lanname
    from pg_proc p join pg_language l on l.oid = p.prolang
    where p.pronamespace = current_schema()::regnamespace and p.prosecdef
      and p.proname like 'staff\_%' and p.prosrc not like '%richiedi_staff()%'
  loop
    if f.lanname = 'sql' then
      nuovo := E'\n  select richiedi_staff();' || f.prosrc;
    elsif f.lanname = 'plpgsql' then
      nuovo := regexp_replace(f.prosrc, '\mbegin\M', E'begin\n  perform richiedi_staff();', 'i');
    end if;
    if nuovo is null or nuovo = f.prosrc then
      raise exception 'Controllo staff non inserito in %', f.proname;
    end if;
    execute replace(pg_get_functiondef(f.oid), f.prosrc, nuovo);
  end loop;
end $$;

-- 3. Funzioni di servizio usate solo da altre funzioni: non servono all'app, quindi non si espongono.
--    (si saltano quelle che in questo schema non esistono: lo schema di test non le ha tutte)
do $$
declare f text;
begin
  foreach f in array array['terminale_impostazioni()', 'accessi_qr_attivo()', 'report_ora()', 'audit_socio_nome(uuid)'] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

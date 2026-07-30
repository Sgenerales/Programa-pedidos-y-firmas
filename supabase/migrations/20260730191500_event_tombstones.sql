-- Una baja definitiva no puede ser revertida por la caché de un dispositivo
-- antiguo. El tombstone sobrevive al evento y bloquea su reinserción.

create table if not exists public.acta_event_tombstones (
  event_id      text primary key,
  eliminado_en timestamptz not null default now(),
  eliminado_por uuid default auth.uid()
);

alter table public.acta_event_tombstones enable row level security;

drop policy if exists acta_event_tombstones_member_select
  on public.acta_event_tombstones;
create policy acta_event_tombstones_member_select
  on public.acta_event_tombstones
  for select
  to authenticated
  using (public.acta_is_member());

drop policy if exists acta_event_tombstones_admin_insert
  on public.acta_event_tombstones;
create policy acta_event_tombstones_admin_insert
  on public.acta_event_tombstones
  for insert
  to authenticated
  with check (public.acta_is_admin());

drop policy if exists acta_event_tombstones_admin_update
  on public.acta_event_tombstones;
create policy acta_event_tombstones_admin_update
  on public.acta_event_tombstones
  for update
  to authenticated
  using (public.acta_is_admin())
  with check (public.acta_is_admin());

revoke all on public.acta_event_tombstones from anon, authenticated;
grant select, insert, update on public.acta_event_tombstones to authenticated;

create or replace function public.acta_prevent_event_resurrection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.acta_event_tombstones
    where event_id = new.id
  ) then
    raise exception 'El evento fue eliminado definitivamente y no puede restaurarse'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function public.acta_prevent_event_resurrection()
  from public, anon, authenticated;

drop trigger if exists acta_events_prevent_resurrection on public.acta_events;
create trigger acta_events_prevent_resurrection
before insert or update on public.acta_events
for each row execute function public.acta_prevent_event_resurrection();

-- Limpieza de los dos eventos controlados usados durante la auditoría. Se
-- aborta la transacción si alguno adquirió entregas o cambió de identidad.
do $$
declare
  temporary_event_id constant text := 'ev_e515d6da-1da8-4996-bde4-3a62907ea235';
  test_event_id constant text := 'ev_1f90098f-44e4-438b-a179-0b507c4d81fc';
  temporary_matches integer;
  test_matches integer;
  temporary_deliveries integer;
  test_deliveries integer;
begin
  select count(*)
  into temporary_matches
  from public.acta_events
  where id = temporary_event_id
    and nombre = 'Outlet SCZ'
    and coalesce(lugar, '') = '';

  select count(*)
  into test_matches
  from public.acta_events
  where id = test_event_id
    and nombre = 'PRUEBA SINCRONIZACION MULTIDISPOSITIVO';

  select count(*)
  into temporary_deliveries
  from public.acta_deliveries
  where event_id = temporary_event_id;

  select count(*)
  into test_deliveries
  from public.acta_deliveries
  where event_id = test_event_id;

  if temporary_matches > 1
    or (temporary_matches = 1 and temporary_deliveries <> 0)
    or test_matches > 1
    or (test_matches = 1 and test_deliveries <> 0)
  then
    raise exception 'Controlled sync-test events no longer match the audited cleanup state';
  end if;

  insert into public.acta_event_tombstones (event_id)
  select id
  from public.acta_events
  where id in (temporary_event_id, test_event_id)
  on conflict (event_id) do nothing;

  delete from public.acta_events
  where id in (temporary_event_id, test_event_id);

  if exists (
    select 1
    from public.acta_events
    where id in (temporary_event_id, test_event_id)
  ) then
    raise exception 'Controlled sync-test cleanup verification failed';
  end if;
end
$$;

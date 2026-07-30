-- Supabase es la fuente compartida de eventos y estructuras.
-- Los operadores pueden mantener la estructura, pero solo un administrador
-- puede borrar el evento completo o entregas firmadas.

drop policy if exists acta_days_admin_delete on public.acta_days;
drop policy if exists acta_days_operator_delete on public.acta_days;
create policy acta_days_operator_delete
  on public.acta_days
  for delete
  to authenticated
  using (public.acta_can_write());

drop policy if exists acta_services_admin_delete on public.acta_services;
drop policy if exists acta_services_operator_delete on public.acta_services;
create policy acta_services_operator_delete
  on public.acta_services
  for delete
  to authenticated
  using (public.acta_can_write());

drop policy if exists acta_slots_admin_delete on public.acta_slots;
drop policy if exists acta_slots_operator_delete on public.acta_slots;
create policy acta_slots_operator_delete
  on public.acta_slots
  for delete
  to authenticated
  using (public.acta_can_write());

drop policy if exists acta_people_admin_delete on public.acta_people;
drop policy if exists acta_people_operator_delete on public.acta_people;
create policy acta_people_operator_delete
  on public.acta_people
  for delete
  to authenticated
  using (public.acta_can_write());

create or replace function public.acta_touch_event_from_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_id text;
begin
  if tg_op = 'DELETE' then
    target_event_id := old.event_id;
  else
    target_event_id := new.event_id;
  end if;

  update public.acta_events
  set actualizado_en = now()
  where id = target_event_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function public.acta_touch_event_from_structure() from public, anon, authenticated;

drop trigger if exists acta_days_touch_event on public.acta_days;
create trigger acta_days_touch_event
after insert or update or delete on public.acta_days
for each row execute function public.acta_touch_event_from_structure();

drop trigger if exists acta_services_touch_event on public.acta_services;
create trigger acta_services_touch_event
after insert or update or delete on public.acta_services
for each row execute function public.acta_touch_event_from_structure();

drop trigger if exists acta_slots_touch_event on public.acta_slots;
create trigger acta_slots_touch_event
after insert or update or delete on public.acta_slots
for each row execute function public.acta_touch_event_from_structure();

drop trigger if exists acta_people_touch_event on public.acta_people;
create trigger acta_people_touch_event
after insert or update or delete on public.acta_people
for each row execute function public.acta_touch_event_from_structure();

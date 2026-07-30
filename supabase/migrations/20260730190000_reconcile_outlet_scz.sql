-- Corrección puntual, transaccional e idempotente del evento Outlet SCZ.
-- Se aborta completa si el estado no coincide con la auditoría previa.

do $$
declare
  temporary_event_id constant text := 'ev_e515d6da-1da8-4996-bde4-3a62907ea235';
  outlet_event_id constant text := 'ev_851ed7da-ed15-492d-bf4a-2df9be3da2cf';
  temporary_matches integer;
  temporary_deliveries integer;
  outlet_matches integer;
  outlet_rows integer;
  outlet_unique_people integer;
  outlet_deliveries integer;
begin
  select count(*)
  into temporary_matches
  from public.acta_events
  where id = temporary_event_id
    and nombre = 'Outlet SCZ'
    and coalesce(lugar, '') = '';

  select count(*)
  into temporary_deliveries
  from public.acta_deliveries
  where event_id = temporary_event_id;

  select count(*)
  into outlet_matches
  from public.acta_events
  where id = outlet_event_id
    and nombre = 'OUTLET SCZ'
    and lugar = 'Salon Guarayos';

  select count(*)
  into outlet_rows
  from public.acta_people
  where event_id = outlet_event_id;

  select count(*)
  into outlet_unique_people
  from (
    select
      lower(trim(nombre)),
      lower(trim(empresa)),
      lower(trim(grupo))
    from public.acta_people
    where event_id = outlet_event_id
    group by 1, 2, 3
  ) as identities;

  select count(*)
  into outlet_deliveries
  from public.acta_deliveries
  where event_id = outlet_event_id;

  if temporary_matches > 1 or (temporary_matches = 1 and temporary_deliveries <> 0) then
    raise exception
      'Temporary Outlet event no longer matches the audited safe-delete state';
  end if;

  if outlet_matches > 1 or (
    outlet_matches = 1
    and (outlet_rows <> 332 or outlet_unique_people <> 166 or outlet_deliveries <> 0)
  ) then
    raise exception
      'OUTLET SCZ roster no longer matches the audited 332/166/0 state';
  end if;

  if temporary_matches = 1 then
    delete from public.acta_events
    where id = temporary_event_id;
  end if;

  if outlet_matches = 1 then
    delete from public.acta_people
    where id in (
      select id
      from (
        select
          id,
          row_number() over (
            partition by
              event_id,
              lower(trim(nombre)),
              lower(trim(empresa)),
              lower(trim(grupo))
            order by creado_en, id
          ) as duplicate_order
        from public.acta_people
        where event_id = outlet_event_id
      ) as ranked
      where duplicate_order > 1
    );

    if (select count(*) from public.acta_people where event_id = outlet_event_id) <> 166 then
      raise exception 'OUTLET SCZ roster verification failed after deduplication';
    end if;

    if (
      select count(*)
      from (
        select
          lower(trim(nombre)),
          lower(trim(empresa)),
          lower(trim(grupo))
        from public.acta_people
        where event_id = outlet_event_id
        group by 1, 2, 3
      ) as identities
    ) <> 166 then
      raise exception 'OUTLET SCZ unique identity verification failed';
    end if;
  end if;
end
$$;

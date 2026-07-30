-- Anulación segura de entregas firmadas.
-- La evidencia nunca se borra: únicamente un administrador puede marcarla
-- como anulada, indicando un motivo que queda en el acta.

create or replace function public.acta_protect_delivery_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Los reintentos de un UPSERT pueden ejecutar un UPDATE idéntico.
  -- Se permiten para conservar la sincronización idempotente de operadores.
  if new is not distinct from old then
    return new;
  end if;

  if public.acta_is_admin() then
    return new;
  end if;

  raise exception 'Solo un administrador puede modificar una entrega ya registrada.'
    using errcode = '42501';
end
$$;

revoke all on function public.acta_protect_delivery_update() from public, anon, authenticated;

drop trigger if exists acta_deliveries_protect_update on public.acta_deliveries;
create trigger acta_deliveries_protect_update
before update on public.acta_deliveries
for each row execute function public.acta_protect_delivery_update();

create or replace function public.acta_anular_entrega(
  p_delivery_id text,
  p_motivo text
)
returns table (
  fecha timestamptz,
  responsable text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha timestamptz;
  v_responsable text;
begin
  if not public.acta_is_admin() then
    raise exception 'Solo una cuenta administradora puede anular una firma.'
      using errcode = '42501';
  end if;

  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'El motivo de la anulación debe tener al menos 3 caracteres.'
      using errcode = '22023';
  end if;

  select coalesce(nullif(trim(m.nombre), ''), nullif(trim(m.email), ''), 'Administrador')
  into v_responsable
  from public.acta_members m
  where m.user_id = auth.uid()
    and m.activo
    and m.role = 'admin';

  if v_responsable is null then
    raise exception 'La cuenta administradora no está activa.'
      using errcode = '42501';
  end if;

  update public.acta_deliveries d
  set
    estado = 'anulado',
    anulado_en = now(),
    anulado_por = v_responsable,
    motivo_anulacion = trim(p_motivo)
  where d.id = p_delivery_id
    and d.estado = 'entregado'
  returning d.anulado_en into v_fecha;

  if v_fecha is null then
    raise exception 'La entrega no existe o ya fue anulada.'
      using errcode = 'P0002';
  end if;

  return query select v_fecha, v_responsable;
end
$$;

revoke all on function public.acta_anular_entrega(text, text) from public, anon;
grant execute on function public.acta_anular_entrega(text, text) to authenticated;

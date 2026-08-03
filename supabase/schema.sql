-- ACTA · Esquema seguro de sincronización
-- Ejecutar con un rol administrador desde Supabase SQL Editor o mediante migraciones.
-- La aplicación usa la clave publicable + Supabase Auth. No usa service_role.

create extension if not exists "pgcrypto";

-- Miembros autorizados -------------------------------------------------------

create table if not exists public.acta_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  -- Nombre que va impreso en el acta junto a cada firma. Si queda vacío,
  -- la aplicación lo deriva de la parte local del correo.
  nombre     text not null default '',
  role       text not null default 'operator'
             check (role in ('admin', 'operator', 'auditor')),
  activo     boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Idempotente para instalaciones anteriores a la columna `nombre`.
alter table public.acta_members add column if not exists nombre text not null default '';

create unique index if not exists acta_members_email_idx
  on public.acta_members (lower(email));

alter table public.acta_members enable row level security;

-- Estas funciones son SECURITY DEFINER para poder comprobar la membresía sin
-- abrir la tabla de miembros. No reciben parámetros controlados por el cliente.
create or replace function public.acta_member_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.acta_members
  where user_id = auth.uid() and activo
  limit 1
$$;

create or replace function public.acta_is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.acta_member_role() is not null
$$;

create or replace function public.acta_can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.acta_member_role() in ('admin', 'operator'), false)
$$;

create or replace function public.acta_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.acta_member_role() = 'admin', false)
$$;

revoke all on function public.acta_member_role() from public, anon;
revoke all on function public.acta_is_member() from public, anon;
revoke all on function public.acta_can_write() from public, anon;
revoke all on function public.acta_is_admin() from public, anon;
grant execute on function public.acta_member_role() to authenticated;
grant execute on function public.acta_is_member() to authenticated;
grant execute on function public.acta_can_write() to authenticated;
grant execute on function public.acta_is_admin() to authenticated;

drop policy if exists acta_members_self_read on public.acta_members;
create policy acta_members_self_read
  on public.acta_members
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.acta_members from anon;
revoke all on public.acta_members from authenticated;
grant select on public.acta_members to authenticated;

-- Datos operativos -----------------------------------------------------------

create table if not exists public.acta_events (
  id                 text primary key,
  nombre             text not null,
  organizador        text not null default '',
  lugar              text not null default '',
  fecha_inicio       date,
  fecha_fin          date,
  estado             text not null default 'borrador'
                     check (estado in ('borrador', 'activo', 'cerrado')),
  requiere_documento boolean not null default false,
  permite_walk_in    boolean not null default true,
  notas              text not null default '',
  actualizado_en     timestamptz not null default now()
);

create table if not exists public.acta_days (
  id       text primary key,
  event_id text not null references public.acta_events(id) on delete cascade,
  fecha    date not null,
  etiqueta text not null,
  orden    integer not null default 0
);
create index if not exists acta_days_event_idx on public.acta_days(event_id);

create table if not exists public.acta_services (
  id             text primary key,
  event_id       text not null references public.acta_events(id) on delete cascade,
  nombre         text not null,
  icono          text not null default 'caja',
  color          text not null default '#8FA8B8',
  requiere_firma boolean not null default true,
  orden          integer not null default 0
);
create index if not exists acta_services_event_idx on public.acta_services(event_id);

create table if not exists public.acta_slots (
  id                 text primary key,
  event_id           text not null references public.acta_events(id) on delete cascade,
  day_id             text not null references public.acta_days(id) on delete cascade,
  service_id         text not null references public.acta_services(id) on delete cascade,
  hora_desde         text,
  hora_hasta         text,
  grupos_habilitados text[] not null default '{}',
  constraint acta_slots_dia_servicio_unico unique (day_id, service_id)
);
create index if not exists acta_slots_event_idx on public.acta_slots(event_id);

create table if not exists public.acta_people (
  id         text primary key,
  event_id   text not null references public.acta_events(id) on delete cascade,
  nombre     text not null,
  documento  text not null default '',
  empresa    text not null default '',
  grupo      text not null default '',
  referencia text not null default '',
  telefono   text not null default '',
  activo     boolean not null default true,
  origen     text not null default 'importado',
  -- Jornadas en las que asiste esta persona. null = asiste a todas, que
  -- es el comportamiento de los padrones sin columnas de fecha.
  dias_habilitados text[],
  creado_en  timestamptz not null default now()
);
create index if not exists acta_people_event_idx on public.acta_people(event_id);

-- Idempotente para instalaciones anteriores a la asistencia por jornada.
alter table public.acta_people add column if not exists dias_habilitados text[];

-- Idempotente: instalaciones anteriores exigían el PNG en el check.
do $$
begin
  alter table public.acta_deliveries drop constraint if exists acta_deliveries_firma_valida;
  alter table public.acta_deliveries
    add constraint acta_deliveries_firma_valida check (
      not con_firma
      or (
        firma_trazos is not null
        and jsonb_array_length(firma_trazos) > 0
        and coalesce(firma_ancho, 0) > 0
        and coalesce(firma_alto, 0) > 0
      )
    );
end $$;

create table if not exists public.acta_deliveries (
  id                 text primary key,
  event_id           text not null references public.acta_events(id) on delete cascade,
  slot_id            text not null references public.acta_slots(id),
  person_id          text not null references public.acta_people(id),
  estado             text not null default 'entregado'
                     check (estado in ('entregado', 'anulado')),
  nombre_firmante    text not null,
  documento_firmante text not null default '',
  con_firma          boolean not null default false,
  firma_png          text,
  firma_trazos       jsonb,
  firma_ancho        integer,
  firma_alto         integer,
  firmado_en         timestamptz not null default now(),
  operador           text not null default '',
  dispositivo        text not null default '',
  sello              text not null default '',
  observacion        text not null default '',
  anulado_en         timestamptz,
  anulado_por        text,
  motivo_anulacion   text,
  constraint acta_deliveries_turno_persona_unico unique (slot_id, person_id),
  -- La firma son los trazos, no la imagen. Un PNG pesa ~21 KB y sirve a
  -- una sola resolución; los mismos trazos ocupan ~1 KB y se redibujan
  -- nítidos a cualquier tamaño. En un evento de 2.000 personas con 9
  -- servicios esa diferencia son cientos de megabytes.
  constraint acta_deliveries_firma_valida check (
    not con_firma
    or (
      firma_trazos is not null
      and jsonb_array_length(firma_trazos) > 0
      and coalesce(firma_ancho, 0) > 0
      and coalesce(firma_alto, 0) > 0
    )
  )
);
create index if not exists acta_deliveries_event_idx on public.acta_deliveries(event_id);
create index if not exists acta_deliveries_slot_idx on public.acta_deliveries(slot_id);

-- Compatibilidad idempotente con una instalación anterior.
alter table public.acta_deliveries add column if not exists firma_ancho integer;
alter table public.acta_deliveries add column if not exists firma_alto integer;

-- Una instalación previa aceptaba 'abierto' donde la aplicación escribe
-- 'activo'. Sin esto, publicar un evento en curso falla con 23514.
do $$
begin
  alter table public.acta_events drop constraint if exists acta_events_estado_check;
  update public.acta_events set estado = 'activo' where estado = 'abierto';
  alter table public.acta_events
    add constraint acta_events_estado_check
    check (estado in ('borrador', 'activo', 'cerrado'));
end $$;

-- ── Sincronización incremental ─────────────────────────────────────
-- Sin esto cada dispositivo descarga el evento entero en cada ciclo:
-- con 18.000 entregas y tres tablets son decenas de GB de egress por
-- día. Con la marca de agua, un ciclo sin novedades no devuelve filas.
alter table public.acta_deliveries
  add column if not exists actualizado_en timestamptz not null default now();

create index if not exists acta_deliveries_sync_idx
  on public.acta_deliveries (event_id, actualizado_en);

create or replace function public.acta_touch_delivery()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.actualizado_en := now();
  elsif new is distinct from old then
    new.actualizado_en := now();
  else
    -- Upsert idéntico: no movemos la marca, así los demás dispositivos
    -- no vuelven a descargar una fila que en realidad no cambió.
    new.actualizado_en := old.actualizado_en;
  end if;
  return new;
end
$$;

-- El prefijo zz no es decorativo: los triggers BEFORE se disparan en
-- orden alfabético y éste TIENE que correr después de
-- acta_deliveries_protect_update, que autoriza comparando new con old.
-- Si tocáramos la fila antes, todo upsert idempotente sería rechazado.
drop trigger if exists zz_acta_deliveries_touch on public.acta_deliveries;
create trigger zz_acta_deliveries_touch
  before insert or update on public.acta_deliveries
  for each row execute function public.acta_touch_delivery();

-- Realtime -------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'acta_deliveries'
  ) then
    alter publication supabase_realtime add table public.acta_deliveries;
  end if;
end $$;

alter table public.acta_deliveries replica identity full;

-- RLS: anónimo no tiene acceso. Los miembros leen, operadores escriben y
-- únicamente los administradores eliminan registros.

alter table public.acta_events enable row level security;
alter table public.acta_days enable row level security;
alter table public.acta_services enable row level security;
alter table public.acta_slots enable row level security;
alter table public.acta_people enable row level security;
alter table public.acta_deliveries enable row level security;

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'acta_events',
    'acta_days',
    'acta_services',
    'acta_slots',
    'acta_people',
    'acta_deliveries'
  ] loop
    -- Elimina la política permisiva del esquema anterior, si existiera.
    execute format(
      'drop policy if exists %I on public.%I',
      table_name || '_anon_all',
      table_name
    );

    foreach policy_name in array array[
      table_name || '_member_select',
      table_name || '_operator_insert',
      table_name || '_operator_update',
      table_name || '_admin_delete'
    ] loop
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.acta_is_member())',
      table_name || '_member_select',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.acta_can_write())',
      table_name || '_operator_insert',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.acta_can_write()) with check (public.acta_can_write())',
      table_name || '_operator_update',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.acta_is_admin())',
      table_name || '_admin_delete',
      table_name
    );

    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end $$;

-- Vista de auditoría: SECURITY INVOKER conserva RLS de las tablas subyacentes.

-- La estructura puede ser mantenida por operadores; borrar el evento completo
-- o entregas firmadas continúa reservado a administradores.
drop policy if exists acta_days_admin_delete on public.acta_days;
drop policy if exists acta_days_operator_delete on public.acta_days;
create policy acta_days_operator_delete
  on public.acta_days for delete to authenticated
  using (public.acta_can_write());

drop policy if exists acta_services_admin_delete on public.acta_services;
drop policy if exists acta_services_operator_delete on public.acta_services;
create policy acta_services_operator_delete
  on public.acta_services for delete to authenticated
  using (public.acta_can_write());

drop policy if exists acta_slots_admin_delete on public.acta_slots;
drop policy if exists acta_slots_operator_delete on public.acta_slots;
create policy acta_slots_operator_delete
  on public.acta_slots for delete to authenticated
  using (public.acta_can_write());

drop policy if exists acta_people_admin_delete on public.acta_people;
drop policy if exists acta_people_operator_delete on public.acta_people;
create policy acta_people_operator_delete
  on public.acta_people for delete to authenticated
  using (public.acta_can_write());

-- Una entrega firmada es evidencia: los operadores pueden crearla y repetir
-- un UPSERT idéntico, pero sólo un administrador puede cambiarla o anularla.
create or replace function public.acta_protect_delivery_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create table if not exists public.acta_event_tombstones (
  event_id       text primary key,
  eliminado_en  timestamptz not null default now(),
  eliminado_por uuid default auth.uid()
);

alter table public.acta_event_tombstones enable row level security;

drop policy if exists acta_event_tombstones_member_select
  on public.acta_event_tombstones;
create policy acta_event_tombstones_member_select
  on public.acta_event_tombstones for select to authenticated
  using (public.acta_is_member());

drop policy if exists acta_event_tombstones_admin_insert
  on public.acta_event_tombstones;
create policy acta_event_tombstones_admin_insert
  on public.acta_event_tombstones for insert to authenticated
  with check (public.acta_is_admin());

drop policy if exists acta_event_tombstones_admin_update
  on public.acta_event_tombstones;
create policy acta_event_tombstones_admin_update
  on public.acta_event_tombstones for update to authenticated
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

create or replace view public.acta_entregas_legibles
with (security_invoker = true)
as
select
  d.id,
  e.nombre as evento,
  dy.etiqueta as jornada,
  dy.fecha,
  s.nombre as servicio,
  d.nombre_firmante,
  d.documento_firmante,
  d.estado,
  d.con_firma,
  d.firmado_en,
  d.operador,
  d.dispositivo,
  d.sello,
  d.observacion,
  d.motivo_anulacion
from public.acta_deliveries d
join public.acta_events e on e.id = d.event_id
join public.acta_slots sl on sl.id = d.slot_id
join public.acta_days dy on dy.id = sl.day_id
join public.acta_services s on s.id = sl.service_id;

revoke all on public.acta_entregas_legibles from public, anon;
grant select on public.acta_entregas_legibles to authenticated;

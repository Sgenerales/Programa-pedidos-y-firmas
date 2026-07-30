-- ═══════════════════════════════════════════════════════════════════
-- ACTA · Control de entregas — esquema de sincronización (opcional)
-- ───────────────────────────────────────────────────────────────────
-- La app funciona sin esto. Ejecutá este script solo si vas a operar
-- con dos o más tablets y querés que se vean entre sí en tiempo real.
-- Idempotente: se puede correr varias veces.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Eventos ────────────────────────────────────────────────────────
create table if not exists public.acta_events (
  id                 text primary key,
  nombre             text not null,
  organizador        text default '',
  lugar              text default '',
  fecha_inicio       date,
  fecha_fin          date,
  estado             text default 'borrador',
  requiere_documento boolean default false,
  permite_walk_in    boolean default true,
  notas              text default '',
  actualizado_en     timestamptz default now()
);

-- ── Jornadas ───────────────────────────────────────────────────────
create table if not exists public.acta_days (
  id       text primary key,
  event_id text not null references public.acta_events(id) on delete cascade,
  fecha    date not null,
  etiqueta text not null,
  orden    int  default 0
);
create index if not exists acta_days_event_idx on public.acta_days(event_id);

-- ── Servicios ──────────────────────────────────────────────────────
create table if not exists public.acta_services (
  id              text primary key,
  event_id        text not null references public.acta_events(id) on delete cascade,
  nombre          text not null,
  icono           text default 'caja',
  color           text default '#8FA8B8',
  requiere_firma  boolean default true,
  orden           int default 0
);
create index if not exists acta_services_event_idx on public.acta_services(event_id);

-- ── Turnos (día × servicio) ────────────────────────────────────────
create table if not exists public.acta_slots (
  id                 text primary key,
  event_id           text not null references public.acta_events(id) on delete cascade,
  day_id             text not null references public.acta_days(id) on delete cascade,
  service_id         text not null references public.acta_services(id) on delete cascade,
  hora_desde         text,
  hora_hasta         text,
  grupos_habilitados text[] default '{}',
  constraint acta_slots_dia_servicio_unico unique (day_id, service_id)
);
create index if not exists acta_slots_event_idx on public.acta_slots(event_id);

-- ── Padrón ─────────────────────────────────────────────────────────
create table if not exists public.acta_people (
  id          text primary key,
  event_id    text not null references public.acta_events(id) on delete cascade,
  nombre      text not null,
  documento   text default '',
  empresa     text default '',
  grupo       text default '',
  referencia  text default '',
  telefono    text default '',
  activo      boolean default true,
  origen      text default 'importado',
  creado_en   timestamptz default now()
);
create index if not exists acta_people_event_idx on public.acta_people(event_id);

-- ── Entregas ───────────────────────────────────────────────────────
-- La restricción única (slot_id, person_id) es el mecanismo real que
-- impide el doble check-in entre puestos distintos. El cliente que
-- pierde la carrera recibe 23505 y conserva el registro remoto.
create table if not exists public.acta_deliveries (
  id                  text primary key,
  event_id            text not null references public.acta_events(id) on delete cascade,
  slot_id             text not null,
  person_id           text not null,
  estado              text not null default 'entregado',
  nombre_firmante     text not null,
  documento_firmante  text default '',
  con_firma           boolean default false,
  firma_png           text,
  firma_trazos        jsonb,
  firmado_en          timestamptz not null default now(),
  operador            text default '',
  dispositivo         text default '',
  sello               text default '',
  observacion         text default '',
  anulado_en          timestamptz,
  anulado_por         text,
  motivo_anulacion    text,
  constraint acta_deliveries_turno_persona_unico unique (slot_id, person_id)
);
create index if not exists acta_deliveries_event_idx on public.acta_deliveries(event_id);
create index if not exists acta_deliveries_slot_idx  on public.acta_deliveries(slot_id);

-- ── Realtime ───────────────────────────────────────────────────────
-- Necesario para que un puesto vea al instante lo que registra otro.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'acta_deliveries'
  ) then
    alter publication supabase_realtime add table public.acta_deliveries;
  end if;
end $$;

alter table public.acta_deliveries replica identity full;

-- ── RLS ────────────────────────────────────────────────────────────
-- Las tablets operan con la anon key. Las políticas de abajo son
-- permisivas a propósito: asumen una red controlada durante el evento.
-- Si el proyecto es compartido, reemplazalas por políticas basadas en
-- auth.uid() y hacé que las tablets entren con un usuario de servicio.
alter table public.acta_events     enable row level security;
alter table public.acta_days       enable row level security;
alter table public.acta_services   enable row level security;
alter table public.acta_slots      enable row level security;
alter table public.acta_people     enable row level security;
alter table public.acta_deliveries enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'acta_events','acta_days','acta_services',
    'acta_slots','acta_people','acta_deliveries'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_anon_all', t
    );
  end loop;
end $$;

-- ── Vista de auditoría ─────────────────────────────────────────────
create or replace view public.acta_entregas_legibles as
select
  d.id,
  e.nombre                         as evento,
  dy.etiqueta                      as jornada,
  dy.fecha,
  s.nombre                         as servicio,
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
join public.acta_events   e  on e.id  = d.event_id
join public.acta_slots    sl on sl.id = d.slot_id
join public.acta_days     dy on dy.id = sl.day_id
join public.acta_services s  on s.id  = sl.service_id;

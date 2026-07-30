-- ACTA · Verificación del estado de la base
-- ---------------------------------------------------------------------------
-- Solo lee. Devuelve una fila por chequeo con OK o FALLA, para saber de un
-- vistazo si la plataforma está lista para operar.
--
--   node scripts/aplicar-sql.mjs supabase/verificar.sql
-- ---------------------------------------------------------------------------

with
tablas_esperadas(nombre) as (
  values ('acta_members'), ('acta_events'), ('acta_days'),
         ('acta_services'), ('acta_slots'), ('acta_deliveries'), ('acta_people')
),
columnas_criticas(tabla, columna) as (
  values ('acta_members', 'nombre'),
         ('acta_deliveries', 'firma_png'),
         ('acta_deliveries', 'firma_trazos'),
         ('acta_deliveries', 'firma_ancho'),
         ('acta_deliveries', 'firma_alto'),
         ('acta_deliveries', 'sello'),
         ('acta_deliveries', 'operador')
),

-- 1. Tablas
c1 as (
  select
    1 as orden,
    'Tablas' as chequeo,
    case when count(*) filter (where t.tablename is null) = 0 then 'OK' else 'FALLA' end as estado,
    case when count(*) filter (where t.tablename is null) = 0
         then count(*)::text || ' tablas presentes'
         else 'faltan: ' || string_agg(e.nombre, ', ') filter (where t.tablename is null)
    end as detalle
  from tablas_esperadas e
  left join pg_tables t on t.schemaname = 'public' and t.tablename = e.nombre
),

-- 2. Columnas que la aplicación necesita sí o sí
c2 as (
  select
    2, 'Columnas críticas',
    case when count(*) filter (where c.column_name is null) = 0 then 'OK' else 'FALLA' end,
    coalesce(
      'faltan: ' || string_agg(k.tabla || '.' || k.columna, ', ') filter (where c.column_name is null),
      count(*)::text || ' columnas presentes'
    )
  from columnas_criticas k
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = k.tabla and c.column_name = k.columna
),

-- 3. RLS activo en todas
c3 as (
  select
    3, 'RLS habilitado',
    case when count(*) filter (where not c.relrowsecurity) = 0 then 'OK' else 'FALLA' end,
    coalesce(
      'sin RLS: ' || string_agg(e.nombre, ', ') filter (where not c.relrowsecurity),
      'las ' || count(*)::text || ' tablas protegidas'
    )
  from tablas_esperadas e
  join pg_class c on c.relname = e.nombre
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
),

-- 4. Anónimo sin ningún permiso: es la garantía de que sin sesión no se lee nada
c4 as (
  select
    4, 'Acceso anonimo bloqueado',
    case when count(*) = 0 then 'OK' else 'FALLA' end,
    case when count(*) = 0 then 'anon no tiene privilegios sobre ninguna tabla'
         else 'anon puede acceder a: ' || string_agg(distinct table_name, ', ') end
  from information_schema.role_table_grants
  where grantee = 'anon'
    and table_schema = 'public'
    and table_name in (select nombre from tablas_esperadas)
),

-- 5. Politicas por tabla
c5 as (
  select
    5, 'Politicas RLS',
    case when count(*) >= 24 then 'OK' else 'REVISAR' end,
    count(*)::text || ' politicas sobre ' || count(distinct tablename)::text || ' tablas'
  from pg_policies
  where schemaname = 'public' and tablename in (select nombre from tablas_esperadas)
),

-- 6. La restriccion que impide el doble check-in entre tablets
c6 as (
  select
    6, 'Anti doble check-in',
    case when count(*) = 1 then 'OK' else 'FALLA' end,
    case when count(*) = 1 then 'unique (slot_id, person_id) activa'
         else 'FALTA: dos puestos podrian registrar a la misma persona' end
  from pg_constraint
  where conname = 'acta_deliveries_turno_persona_unico'
),

-- 7. El check de estado tiene que aceptar 'activo', que es lo que escribe la app
c7 as (
  select
    7, 'Estados de evento',
    case when count(*) = 1 then 'OK' else 'FALLA' end,
    coalesce(max(pg_get_constraintdef(oid)), 'no encontrado')
  from pg_constraint
  -- to_regclass devuelve null en vez de fallar si la tabla no existe todavía.
  where conrelid = to_regclass('public.acta_events')
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%activo%'
),

-- 8. Realtime, para que dos tablets se vean al instante
c8 as (
  select
    8, 'Realtime',
    case when count(*) = 1 then 'OK' else 'REVISAR' end,
    case when count(*) = 1 then 'acta_deliveries publicada'
         else 'acta_deliveries no esta en supabase_realtime' end
  from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'acta_deliveries'
),

-- 9. Miembros autorizados
c9 as (
  select
    9, 'Miembros activos',
    case when count(*) filter (where activo) > 0 then 'OK' else 'FALLA' end,
    coalesce(
      string_agg(email || ' (' || role || case when nombre = '' then ', SIN NOMBRE' else ', ' || nombre end || ')', ' · ')
        filter (where activo),
      'ninguno: nadie puede entrar a la aplicacion'
    )
  from public.acta_members
),

-- 10. Datos ya cargados
c10 as (
  select
    10, 'Datos en la nube',
    'INFO',
    (select count(*) from public.acta_events)::text || ' eventos · ' ||
    (select count(*) from public.acta_people)::text || ' personas · ' ||
    (select count(*) from public.acta_deliveries)::text || ' entregas · ' ||
    (select count(*) from public.acta_deliveries where con_firma)::text || ' con firma'
)

select chequeo, estado, detalle
from (
  select * from c1 union all select * from c2 union all select * from c3
  union all select * from c4 union all select * from c5 union all select * from c6
  union all select * from c7 union all select * from c8 union all select * from c9
  union all select * from c10
) t(orden, chequeo, estado, detalle)
order by orden;

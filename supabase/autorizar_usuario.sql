-- ACTA · Autorizar un usuario para operar
-- ---------------------------------------------------------------------------
-- Requisito previo: el usuario ya debe existir en Authentication → Users.
-- Este script NO crea cuentas: solo le da permiso a una que ya existe.
--
-- 1. Cambiá el correo y el rol en el bloque de abajo.
-- 2. Pegá todo en Supabase → SQL Editor → Run.
--
-- Roles disponibles:
--   admin     lee, registra entregas y puede eliminar datos
--   operator  lee y registra entregas (lo normal para una tablet en piso)
--   auditor   solo lectura, para quien mira reportes sin tocar nada
-- ---------------------------------------------------------------------------

begin;

with objetivo as (
  select
    -- ⬇⬇⬇  EDITÁ ESTAS DOS LÍNEAS  ⬇⬇⬇
    'tablet@tu-organizacion.com'::text as correo,
    'operator'::text                   as rol
)
insert into public.acta_members (user_id, email, role)
select u.id, u.email, o.rol
from auth.users u
cross join objetivo o
where lower(u.email) = lower(o.correo)
on conflict (user_id) do update
  set email  = excluded.email,
      role   = excluded.role,
      activo = true;

commit;

-- Verificación: tiene que devolver exactamente una fila con activo = true.
-- Si vuelve vacía, el correo no existe en Authentication → Users
-- (revisá mayúsculas, espacios, o si el usuario quedó sin confirmar).
select m.user_id, m.email, m.role, m.activo, u.last_sign_in_at
from public.acta_members m
join auth.users u on u.id = m.user_id
order by m.creado_en desc;

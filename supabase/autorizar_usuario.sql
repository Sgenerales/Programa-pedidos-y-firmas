-- ACTA · Autorizar un usuario para operar
-- ---------------------------------------------------------------------------
-- Requisito previo: el usuario ya debe existir en Authentication → Users.
-- Este script NO crea cuentas: solo le da permiso a una que ya existe.
--
-- 1. Cambiá las tres líneas marcadas.
-- 2. Pegá todo en Supabase → SQL Editor → Run.
--
-- Roles disponibles:
--   admin     lee, registra entregas y puede eliminar datos
--   operator  lee y registra entregas (lo normal para una tablet en piso)
--   auditor   solo lectura, para quien mira reportes sin tocar nada
--
-- El nombre es el que queda impreso en el acta junto a cada firma que
-- registre esta persona. Poné el nombre real, no un alias.
-- ---------------------------------------------------------------------------

begin;

with objetivo as (
  select
    -- ⬇⬇⬇  EDITÁ ESTAS TRES LÍNEAS  ⬇⬇⬇
    'tablet@tu-organizacion.com'::text as correo,
    'Nombre Apellido'::text            as nombre,
    'operator'::text                   as rol
)
insert into public.acta_members (user_id, email, nombre, role)
select u.id, u.email, o.nombre, o.rol
from auth.users u
cross join objetivo o
where lower(u.email) = lower(o.correo)
on conflict (user_id) do update
  set email  = excluded.email,
      nombre = excluded.nombre,
      role   = excluded.role,
      activo = true;

commit;

-- Verificación: tiene que devolver una fila por cada usuario autorizado,
-- con activo = true. Si el que acabás de cargar no aparece, el correo no
-- existe en Authentication → Users (revisá mayúsculas o espacios).
select m.email, m.nombre, m.role, m.activo, u.last_sign_in_at
from public.acta_members m
join auth.users u on u.id = m.user_id
order by m.creado_en desc;

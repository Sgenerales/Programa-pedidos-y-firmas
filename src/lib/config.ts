/* Conexión de la aplicación.
   ───────────────────────────────────────────────────────────────────
   La URL y la clave publicable se hornean en el build (.env.local o las
   variables de entorno del hosting). No se piden por dispositivo: una
   tablet nueva se abre, se ingresa correo y contraseña, y ya opera. */

const SUPABASE_URL_PUBLICA = 'https://bwixtywrrmbwgfavlzil.supabase.co';
const SUPABASE_KEY_PUBLICA = 'sb_publishable_WOxOqsP0YrqV1Tzn_BmDMQ_f3U8s5cl';

// Estas credenciales son públicas por diseño y quedan limitadas por RLS.
// Una variable del hosting puede reemplazarlas; service_role nunca va al cliente.
export const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL_PUBLICA
).trim();
export const SUPABASE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_KEY_PUBLICA
).trim();

/** Si falta la configuración, la app corre en modo local sin nube. */
export const HAY_NUBE = Boolean(SUPABASE_URL && SUPABASE_KEY);

/** Referencia del proyecto, para mostrarla en Ajustes. */
export const PROYECTO = HAY_NUBE ? SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0] : '';

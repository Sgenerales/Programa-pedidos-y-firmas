import type { SupabaseClient } from '@supabase/supabase-js';
import * as db from './idb';
import { HAY_NUBE, SUPABASE_KEY, SUPABASE_URL } from './config';
import type {
  Delivery,
  EventDay,
  EventRecord,
  Miembro,
  Person,
  Service,
  SignatureRecord,
  Slot,
} from '../types';

/* ═══════════════════════════════════════════════════════════════════
   Nube: sesión y sincronización
   ───────────────────────────────────────────────────────────────────
   La app sigue siendo local-first: toda entrega se escribe primero en
   IndexedDB y recién después viaja. Pero ninguna entrega firmada puede
   quedarse en la tablet: el motor de sincronización reintenta hasta
   confirmarla en Postgres, que es la fuente del reporte.
   ═══════════════════════════════════════════════════════════════════ */

let cliente: SupabaseClient | null = null;

/** El SDK se descarga la primera vez que hace falta, no en el arranque. */
export async function obtenerCliente(): Promise<SupabaseClient | null> {
  if (!HAY_NUBE) return null;
  if (cliente) return cliente;
  const { createClient } = await import('@supabase/supabase-js');
  cliente = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'acta.sesion',
    },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return cliente;
}

/* ─── Sesión ─────────────────────────────────────────────────────── */

export interface Sesion {
  userId: string;
  email: string;
  nombre: string;
  rol: Miembro['rol'];
}

export type ResultadoLogin =
  | { ok: true; sesion: Sesion }
  | { ok: false; mensaje: string; campo?: 'email' | 'password' };

/**
 * Sesión guardada en el dispositivo. Devuelve datos aunque no haya red:
 * es lo que permite seguir operando con el wifi caído tras entrar una vez.
 */
export async function sesionGuardada(): Promise<Sesion | null> {
  const c = await obtenerCliente();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  const u = data.session?.user;
  if (!u) return null;
  return {
    userId: u.id,
    email: u.email ?? '',
    nombre: nombreDesde(u.user_metadata, u.email ?? ''),
    rol: (u.user_metadata?.acta_rol as Miembro['rol']) ?? 'operator',
  };
}

export async function iniciarSesion(email: string, password: string): Promise<ResultadoLogin> {
  const c = await obtenerCliente();
  if (!c) return { ok: false, mensaje: 'Esta instalación no tiene configurada la conexión a la nube.' };

  const { data, error } = await c.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) return { ok: false, ...traducirErrorAuth(error.message) };
  const u = data.user;
  if (!u) return { ok: false, mensaje: 'Supabase no devolvió el usuario.' };

  // Estar autenticado no alcanza: hay que estar autorizado en ACTA.
  const { data: miembro, error: errorMiembro } = await c
    .from('acta_members')
    .select('user_id, email, nombre, role, activo')
    .eq('user_id', u.id)
    .maybeSingle();

  if (errorMiembro && errorMiembro.code !== 'PGRST116') {
    await c.auth.signOut();
    const falta =
      errorMiembro.code === 'PGRST205' || errorMiembro.code === '42P01'
        ? 'La base de datos todavía no tiene las tablas de ACTA.'
        : errorMiembro.code === '42703' || errorMiembro.code === 'PGRST204'
          ? 'La tabla acta_members está desactualizada: le falta la columna «nombre».'
          : null;
    return {
      ok: false,
      mensaje: falta ? `${falta} Ejecutá la migración de supabase/.` : errorMiembro.message,
    };
  }

  if (!miembro || !miembro.activo) {
    await c.auth.signOut();
    return {
      ok: false,
      mensaje: miembro
        ? 'Esta cuenta está desactivada. Pedí que la reactiven.'
        : 'Esta cuenta existe pero no está autorizada para ACTA.',
      campo: 'email',
    };
  }

  const sesion: Sesion = {
    userId: u.id,
    email: u.email ?? email,
    nombre: (miembro.nombre as string)?.trim() || nombreDesde(u.user_metadata, u.email ?? email),
    rol: (miembro.role as Miembro['rol']) ?? 'operator',
  };

  // Guardamos rol y nombre en el usuario para reconocerlos sin red.
  await c.auth.updateUser({
    data: { acta_rol: sesion.rol, acta_nombre: sesion.nombre },
  });

  return { ok: true, sesion };
}

export async function cerrarSesion(): Promise<void> {
  const c = await obtenerCliente();
  await c?.auth.signOut();
}

export type ResultadoAutorizacion =
  | { ok: true }
  | { ok: false; mensaje: string };

/**
 * Revalida la contraseña de la cuenta activa y confirma su rol directamente
 * en la base. La clave nunca se guarda ni sale de Supabase Auth.
 */
export async function verificarClaveAdministrador(
  password: string,
): Promise<ResultadoAutorizacion> {
  const c = await obtenerCliente();
  if (!c) return { ok: false, mensaje: 'La anulación segura necesita conexión con Supabase.' };
  if (!password) return { ok: false, mensaje: 'Ingresá la contraseña administradora.' };

  const { data: usuarioActual, error: errorUsuario } = await c.auth.getUser();
  const usuario = usuarioActual.user;
  if (errorUsuario || !usuario?.email) {
    return { ok: false, mensaje: 'La sesión venció. Volvé a iniciar sesión antes de anular.' };
  }

  const { data: miembro, error: errorMiembro } = await c
    .from('acta_members')
    .select('user_id, role, activo')
    .eq('user_id', usuario.id)
    .maybeSingle();

  if (errorMiembro) return { ok: false, mensaje: traducirErrorDatos(errorMiembro) };
  if (!miembro?.activo || miembro.role !== 'admin') {
    return { ok: false, mensaje: 'Esta acción requiere una cuenta administradora activa.' };
  }

  const { data, error } = await c.auth.signInWithPassword({
    email: usuario.email,
    password,
  });
  if (error) {
    const traducido = traducirErrorAuth(error.message);
    return {
      ok: false,
      mensaje:
        traducido.campo === 'password'
          ? 'La contraseña administradora no es correcta.'
          : traducido.mensaje,
    };
  }
  if (data.user?.id !== usuario.id) {
    return { ok: false, mensaje: 'La contraseña no corresponde a la cuenta administradora activa.' };
  }

  return { ok: true };
}

export type ResultadoAnulacion =
  | { ok: true; fecha: string; responsable: string }
  | { ok: false; mensaje: string };

/** Anula en Postgres primero; la evidencia de firma permanece intacta. */
export async function anularEntregaEnNube(
  deliveryId: string,
  motivo: string,
): Promise<ResultadoAnulacion> {
  const c = await obtenerCliente();
  if (!c) return { ok: false, mensaje: 'La anulación segura necesita conexión con Supabase.' };

  const { data, error } = await c.rpc('acta_anular_entrega', {
    p_delivery_id: deliveryId,
    p_motivo: motivo.trim(),
  });

  if (error) {
    return {
      ok: false,
      mensaje:
        error.code === '42501'
          ? 'Supabase rechazó la anulación: se requiere una cuenta administradora activa.'
          : traducirErrorDatos(error),
    };
  }
  const fila = Array.isArray(data) ? data[0] : null;
  if (!fila?.fecha || !fila?.responsable) {
    return { ok: false, mensaje: 'Supabase no confirmó la anulación.' };
  }

  return {
    ok: true,
    fecha: String(fila.fecha),
    responsable: String(fila.responsable),
  };
}

function nombreDesde(metadata: Record<string, unknown> | undefined, email: string): string {
  const guardado = (metadata?.acta_nombre ?? metadata?.full_name ?? metadata?.name) as
    | string
    | undefined;
  if (guardado?.trim()) return guardado.trim();
  const local = email.split('@')[0] ?? '';
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) || email;
}

function traducirErrorAuth(mensaje: string): { mensaje: string; campo?: 'email' | 'password' } {
  const m = mensaje.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return { mensaje: 'Correo o contraseña incorrectos.', campo: 'password' };
  }
  if (m.includes('email not confirmed')) {
    return { mensaje: 'La cuenta existe pero el correo no fue confirmado.', campo: 'email' };
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return { mensaje: 'Sin conexión. Conectate a la red para entrar la primera vez.' };
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return { mensaje: 'Demasiados intentos. Esperá un minuto y probá de nuevo.' };
  }
  return { mensaje };
}

/* ─── Estructura del evento ──────────────────────────────────────── */

export interface ResultadoNube {
  ok: boolean;
  mensaje?: string;
}

export interface DatosEvento {
  evento: EventRecord;
  dias: EventDay[];
  servicios: Service[];
  slots: Slot[];
  personas: Person[];
}

export interface EstructuraRemota {
  eventos: EventRecord[];
  dias: EventDay[];
  servicios: Service[];
  slots: Slot[];
  personas: Person[];
  eliminados: string[];
}

/** Descarga la estructura compartida completa. IndexedDB es solo su caché offline. */
export async function bajarEstructuras(): Promise<EstructuraRemota> {
  const c = await obtenerCliente();
  if (!c) {
    return { eventos: [], dias: [], servicios: [], slots: [], personas: [], eliminados: [] };
  }

  const resultados = await Promise.all([
    c.from('acta_events').select('*'),
    c.from('acta_days').select('*'),
    c.from('acta_services').select('*'),
    c.from('acta_slots').select('*'),
    c.from('acta_people').select('*'),
    c.from('acta_event_tombstones').select('event_id'),
  ]);
  const tablas = [
    'acta_events',
    'acta_days',
    'acta_services',
    'acta_slots',
    'acta_people',
    'acta_event_tombstones',
  ];
  for (let i = 0; i < resultados.length; i++) {
    const error = resultados[i].error;
    if (error) throw new Error(`${tablas[i]}: ${traducirErrorDatos(error)}`);
  }

  const eventos = (resultados[0].data ?? [])
    .map((fila) => aEvento(fila as Record<string, unknown>))
    .sort((a, b) => b.actualizadoEn.localeCompare(a.actualizadoEn));

  return {
    eventos,
    dias: (resultados[1].data ?? []).map((fila) => aDia(fila as Record<string, unknown>)),
    servicios: (resultados[2].data ?? []).map((fila) =>
      aServicio(fila as Record<string, unknown>),
    ),
    slots: (resultados[3].data ?? []).map((fila) => aSlot(fila as Record<string, unknown>)),
    personas: (resultados[4].data ?? []).map((fila) =>
      aPersona(fila as Record<string, unknown>),
    ),
    eliminados: (resultados[5].data ?? []).map((fila) => String(fila.event_id)),
  };
}

/** Elimina el evento remoto y verifica que RLS haya autorizado el borrado. */
export async function eliminarEstructura(eventId: string): Promise<ResultadoNube> {
  const c = await obtenerCliente();
  if (!c) return { ok: false, mensaje: 'Sin conexión configurada.' };

  const { error: errorMarca } = await c
    .from('acta_event_tombstones')
    .upsert({ event_id: eventId }, { onConflict: 'event_id' });
  if (errorMarca) {
    return {
      ok: false,
      mensaje: `acta_event_tombstones: ${traducirErrorDatos(errorMarca)}`,
    };
  }

  const { data: existente, error: errorLectura } = await c
    .from('acta_events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle();
  if (errorLectura) {
    return { ok: false, mensaje: `acta_events: ${traducirErrorDatos(errorLectura)}` };
  }
  if (!existente) return { ok: true };

  const { data: eliminados, error: errorBorrado } = await c
    .from('acta_events')
    .delete()
    .eq('id', eventId)
    .select('id');
  if (errorBorrado) {
    return { ok: false, mensaje: `acta_events: ${traducirErrorDatos(errorBorrado)}` };
  }
  if (!eliminados?.some((fila) => fila.id === eventId)) {
    return { ok: false, mensaje: 'Supabase no autorizó la eliminación del evento.' };
  }

  const { data: verificacion, error: errorVerificacion } = await c
    .from('acta_events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle();
  if (errorVerificacion) {
    return { ok: false, mensaje: `acta_events: ${traducirErrorDatos(errorVerificacion)}` };
  }
  if (verificacion) {
    return { ok: false, mensaje: 'El evento todavía existe en Supabase.' };
  }
  return { ok: true };
}

/**
 * Replica la estructura del evento antes de subir entregas para garantizar
 * que existan sus claves foráneas en la nube.
 */
export async function publicarEstructura(datos: DatosEvento): Promise<ResultadoNube> {
  const c = await obtenerCliente();
  if (!c) return { ok: false, mensaje: 'Sin conexión configurada.' };

  const evento = await c
    .from('acta_events')
    .upsert([aFilaEvento(datos.evento)], { onConflict: 'id' });
  if (evento.error) {
    return { ok: false, mensaje: `acta_events: ${traducirErrorDatos(evento.error)}` };
  }

  // Un turno recreado puede conservar la misma combinación día/servicio con
  // otro id. Eliminamos primero solo esos ids obsoletos para no chocar con la
  // restricción única; el resto se elimina después de guardar lo deseado.
  const errorSlotsPrevio = await eliminarAusentes(
    c,
    'acta_slots',
    datos.evento.id,
    new Set(datos.slots.map((fila) => fila.id)),
  );
  if (errorSlotsPrevio) return { ok: false, mensaje: errorSlotsPrevio };

  const pasos: [string, Record<string, unknown>[]][] = [
    ['acta_days', datos.dias.map(aFilaSimple)],
    ['acta_services', datos.servicios.map(aFilaSimple)],
    ['acta_slots', datos.slots.map(aFilaSlot)],
    ['acta_people', datos.personas.map(aFilaSimple)],
  ];
  for (const [tabla, filas] of pasos) {
    if (!filas.length) continue;
    const { error } = await c.from(tabla).upsert(filas, { onConflict: 'id' });
    if (error) return { ok: false, mensaje: `${tabla}: ${traducirErrorDatos(error)}` };
  }

  const limpiezas: [string, Set<string>][] = [
    ['acta_services', new Set(datos.servicios.map((fila) => fila.id))],
    ['acta_days', new Set(datos.dias.map((fila) => fila.id))],
    ['acta_people', new Set(datos.personas.map((fila) => fila.id))],
  ];
  for (const [tabla, ids] of limpiezas) {
    const error = await eliminarAusentes(c, tabla, datos.evento.id, ids);
    if (error) return { ok: false, mensaje: error };
  }
  return { ok: true };
}

async function eliminarAusentes(
  c: SupabaseClient,
  tabla: string,
  eventId: string,
  idsDeseados: Set<string>,
): Promise<string | null> {
  const { data: existentes, error: errorLectura } = await c
    .from(tabla)
    .select('id')
    .eq('event_id', eventId);
  if (errorLectura) return `${tabla}: ${traducirErrorDatos(errorLectura)}`;

  const sobrantes = (existentes ?? [])
    .map((fila) => String(fila.id))
    .filter((id) => !idsDeseados.has(id));
  if (!sobrantes.length) return null;

  const { data: eliminados, error: errorBorrado } = await c
    .from(tabla)
    .delete()
    .in('id', sobrantes)
    .select('id');
  if (errorBorrado) return `${tabla}: ${traducirErrorDatos(errorBorrado)}`;
  const confirmados = new Set((eliminados ?? []).map((fila) => String(fila.id)));
  if (sobrantes.some((id) => !confirmados.has(id))) {
    return `${tabla}: Supabase no autorizó eliminar registros obsoletos.`;
  }
  return null;
}

/* ─── Entregas ───────────────────────────────────────────────────── */

export interface ResultadoSubida {
  subidas: number;
  conflictos: Delivery[];
  mensaje?: string;
}

/** Cuántas entregas viajan por request. Cada una carga su PNG, así que
    lotes grandes harían cuerpos de varios MB. */
const LOTE = 20;

/**
 * Sube las entregas pendientes con su firma. Solo marca una como
 * sincronizada cuando Postgres la confirmó.
 *
 * Va por lotes para que un rezago de cientos de firmas —una jornada
 * entera sin wifi— no se convierta en cientos de requests en serie. Si un
 * lote falla por una fila puntual, reintenta ese lote de a una: una sola
 * entrega problemática no puede bloquear a todas las que vienen detrás.
 */
export async function subirEntregas(eventId: string): Promise<ResultadoSubida> {
  const c = await obtenerCliente();
  if (!c) return { subidas: 0, conflictos: [] };

  const todas = await db.getByIndex<Delivery>('deliveries', 'eventId', eventId);
  const pendientes = todas.filter((e) => e.sync === 'pendiente');
  if (!pendientes.length) return { subidas: 0, conflictos: [] };

  const conflictos: Delivery[] = [];
  let subidas = 0;
  let mensaje: string | undefined;

  for (let i = 0; i < pendientes.length; i += LOTE) {
    const lote = pendientes.slice(i, i + LOTE);
    const filas = await Promise.all(lote.map(aFilaEntrega));

    const { error } = await c.from('acta_deliveries').upsert(filas, { onConflict: 'id' });

    if (!error) {
      await db.putMany(
        'deliveries',
        lote.map((e) => ({ ...e, sync: 'sincronizado' as const })),
      );
      subidas += lote.length;
      continue;
    }

    // Errores que afectan a todo: no tiene sentido seguir intentando.
    if (esErrorGlobal(error)) return { subidas, conflictos, mensaje: traducirErrorDatos(error) };

    // El lote cayó por alguna fila concreta: la aislamos.
    for (const entrega of lote) {
      const fila = await aFilaEntrega(entrega);
      const { error: individual } = await c
        .from('acta_deliveries')
        .upsert([fila], { onConflict: 'id' });

      if (!individual) {
        await db.put('deliveries', { ...entrega, sync: 'sincronizado' });
        subidas++;
        continue;
      }
      if (esErrorGlobal(individual)) {
        return { subidas, conflictos, mensaje: traducirErrorDatos(individual) };
      }
      // 23505 = otro puesto ya la registró. No se reintenta más.
      if (individual.code === '23505') {
        conflictos.push(entrega);
        await db.put('deliveries', { ...entrega, sync: 'conflicto' });
        continue;
      }
      // Cualquier otra: queda pendiente y se reintenta en el próximo
      // ciclo, pero no frena a las demás.
      mensaje ??= traducirErrorDatos(individual);
    }
  }

  return { subidas, conflictos, mensaje };
}

/** Errores de red, sesión, permisos o esquema: afectan a toda la cola. */
function esErrorGlobal(error: { code?: string; message: string }): boolean {
  if (error.code && ['42501', 'PGRST301', 'PGRST205', '42P01', '23503'].includes(error.code)) {
    return true;
  }
  return /failed to fetch|networkerror|jwt|token is expired/i.test(error.message);
}

async function aFilaEntrega(entrega: Delivery): Promise<Record<string, unknown>> {
  const firma = entrega.conFirma
    ? await db.get<SignatureRecord>('signatures', entrega.id)
    : undefined;

  // Una entrega que dice tener firma pero perdió el trazo no puede subirse
  // como firmada: el acta afirmaría algo que no puede mostrar.
  const conFirmaReal = Boolean(entrega.conFirma && firma?.trazos?.some((t) => t.length > 0));

  return {
    id: entrega.id,
    event_id: entrega.eventId,
    slot_id: entrega.slotId,
    person_id: entrega.personId,
    estado: entrega.estado,
    nombre_firmante: entrega.nombreFirmante,
    documento_firmante: entrega.documentoFirmante,
    con_firma: conFirmaReal,
    // El PNG ya no viaja: la firma son los trazos y el reporte la
    // redibuja. Enviarlo multiplicaba por 20 el peso de cada entrega.
    firma_png: null,
    firma_trazos: firma?.trazos ?? null,
    firma_ancho: firma?.ancho ?? null,
    firma_alto: firma?.alto ?? null,
    firmado_en: entrega.firmadoEn,
    operador: entrega.operador,
    dispositivo: entrega.dispositivo,
    sello: entrega.sello,
    observacion: entrega.observacion,
    anulado_en: entrega.anuladoEn ?? null,
    anulado_por: entrega.anuladoPor ?? null,
    motivo_anulacion: entrega.motivoAnulacion ?? null,
  };
}

/* Columnas de una entrega SIN su firma. La sincronización periódica solo
   necesita saber quién recibió qué: arrastrar los trazos en cada ciclo
   convertía 35 MB de datos en gigabytes de transferencia. */
const COLUMNAS_ENTREGA =
  'id,event_id,slot_id,person_id,estado,nombre_firmante,documento_firmante,' +
  'con_firma,firma_ancho,firma_alto,firmado_en,operador,dispositivo,sello,' +
  'observacion,anulado_en,anulado_por,motivo_anulacion';

/** Trae entregas registradas por otros puestos y las fusiona localmente. */
export async function bajarEntregas(eventId: string): Promise<{ bajadas: number; mensaje?: string }> {
  const c = await obtenerCliente();
  if (!c) return { bajadas: 0 };

  const { data, error } = await c
    .from('acta_deliveries')
    .select(COLUMNAS_ENTREGA)
    .eq('event_id', eventId);
  if (error) return { bajadas: 0, mensaje: traducirErrorDatos(error) };
  if (!data?.length) return { bajadas: 0 };

  const locales = await db.getByIndex<Delivery>('deliveries', 'eventId', eventId);
  const porId = new Map(locales.map((e) => [e.id, e]));
  const porSlotPersona = new Map(locales.map((e) => [`${e.slotId}|${e.personId}`, e]));

  const nuevas: Delivery[] = [];
  for (const fila of data as unknown as Record<string, unknown>[]) {
    const entrega = aEntrega(fila);
    const local = porId.get(entrega.id);
    // Nunca pisamos una entrega local distinta para el mismo turno.
    if (!local && porSlotPersona.has(`${entrega.slotId}|${entrega.personId}`)) continue;
    if (local && local.estado === entrega.estado && local.sync === 'sincronizado') continue;
    nuevas.push(entrega);
  }

  if (nuevas.length) await db.putMany('deliveries', nuevas);
  return { bajadas: nuevas.length };
}

/**
 * Descarga los trazos de firmas puntuales. Se llama solo al abrir un acta
 * o el detalle de una entrega, y únicamente para las que este dispositivo
 * todavía no tiene guardadas.
 */
export async function bajarFirmas(
  eventId: string,
  ids: string[],
): Promise<{ bajadas: number; mensaje?: string }> {
  const c = await obtenerCliente();
  if (!c || !ids.length) return { bajadas: 0 };

  const LOTE = 100;
  let bajadas = 0;

  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await c
      .from('acta_deliveries')
      .select('id,firma_png,firma_trazos,firma_ancho,firma_alto')
      .in('id', ids.slice(i, i + LOTE));
    if (error) return { bajadas, mensaje: traducirErrorDatos(error) };

    const firmas: SignatureRecord[] = [];
    for (const fila of (data ?? []) as unknown as Record<string, unknown>[]) {
      const trazos = (fila.firma_trazos as SignatureRecord['trazos']) ?? [];
      const png = (fila.firma_png as string | null) ?? undefined;
      if (!trazos.length && !png) continue;
      firmas.push({
        id: String(fila.id),
        eventId,
        png,
        trazos,
        ancho: Number(fila.firma_ancho) || 600,
        alto: Number(fila.firma_alto) || 240,
      });
    }
    if (firmas.length) await db.putMany('signatures', firmas);
    bajadas += firmas.length;
  }

  return { bajadas };
}

/** Suscripción realtime a las entregas del evento. Devuelve el cierre. */
export function suscribirEntregas(eventId: string, onCambio: () => void): () => void {
  let cerrar = () => {};
  let cancelado = false;

  void (async () => {
    const c = await obtenerCliente();
    if (!c || cancelado) return;
    const canal = c
      .channel(`acta:${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'acta_deliveries', filter: `event_id=eq.${eventId}` },
        onCambio,
      )
      .subscribe();
    cerrar = () => {
      void c.removeChannel(canal);
    };
  })();

  return () => {
    cancelado = true;
    cerrar();
  };
}

/** Cuántas entregas de este evento existen ya en la nube. */
export async function contarEnNube(eventId: string): Promise<number | null> {
  const c = await obtenerCliente();
  if (!c) return null;
  const { count, error } = await c
    .from('acta_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);
  return error ? null : (count ?? 0);
}

/* ─── Traducción de errores ──────────────────────────────────────── */

/** Marca los errores que solo se resuelven volviendo a iniciar sesión. */
export const SESION_VENCIDA = 'SESION_VENCIDA';

function traducirErrorDatos(error: { code?: string; message: string }): string {
  // PGRST301 es token vencido o inválido, no falta de permisos: mezclarlos
  // manda al operador a pedir permisos que ya tiene.
  if (error.code === 'PGRST301' || /jwt|token is expired|invalid claim/i.test(error.message)) {
    return `${SESION_VENCIDA}: la sesión de este dispositivo venció. Volvé a iniciar sesión; las entregas siguen guardadas acá.`;
  }
  switch (error.code) {
    case '23503':
      return 'El evento todavía no está publicado en la nube. Se reintenta solo.';
    case '42501':
      return 'Esta cuenta no tiene permiso para escribir (rol «auditor» o inactiva).';
    case 'PGRST205':
    case '42P01':
      return 'Faltan las tablas de ACTA en la base. Ejecutá la migración.';
    case '23514':
      return `Un valor no pasó la validación de la base: ${error.message}`;
    default:
      if (/failed to fetch|networkerror/i.test(error.message)) return 'Sin conexión.';
      return error.message;
  }
}

/* ─── Mapeo camelCase ↔ snake_case ───────────────────────────────── */

function aFilaEvento(e: EventRecord): Record<string, unknown> {
  return {
    id: e.id,
    nombre: e.nombre,
    organizador: e.organizador,
    lugar: e.lugar,
    fecha_inicio: e.fechaInicio,
    fecha_fin: e.fechaFin,
    estado: e.estado,
    requiere_documento: e.requiereDocumento,
    permite_walk_in: e.permiteWalkIn,
    notas: e.notas,
  };
}

function aEvento(f: Record<string, unknown>): EventRecord {
  const actualizadoEn = String(f.actualizado_en ?? new Date().toISOString());
  return {
    id: String(f.id),
    nombre: String(f.nombre ?? ''),
    organizador: String(f.organizador ?? ''),
    lugar: String(f.lugar ?? ''),
    fechaInicio: String(f.fecha_inicio ?? ''),
    fechaFin: String(f.fecha_fin ?? ''),
    estado: (f.estado as EventRecord['estado']) ?? 'borrador',
    requiereDocumento: Boolean(f.requiere_documento),
    permiteWalkIn: Boolean(f.permite_walk_in),
    notas: String(f.notas ?? ''),
    creadoEn: actualizadoEn,
    actualizadoEn,
  };
}

function aDia(f: Record<string, unknown>): EventDay {
  return {
    id: String(f.id),
    eventId: String(f.event_id),
    fecha: String(f.fecha ?? ''),
    etiqueta: String(f.etiqueta ?? ''),
    orden: Number(f.orden ?? 0),
  };
}

function aServicio(f: Record<string, unknown>): Service {
  return {
    id: String(f.id),
    eventId: String(f.event_id),
    nombre: String(f.nombre ?? ''),
    icono: String(f.icono ?? 'caja'),
    color: String(f.color ?? '#8FA8B8'),
    requiereFirma: Boolean(f.requiere_firma),
    orden: Number(f.orden ?? 0),
  };
}

function aSlot(f: Record<string, unknown>): Slot {
  return {
    id: String(f.id),
    eventId: String(f.event_id),
    dayId: String(f.day_id),
    serviceId: String(f.service_id),
    horaDesde: String(f.hora_desde ?? ''),
    horaHasta: String(f.hora_hasta ?? ''),
    gruposHabilitados: Array.isArray(f.grupos_habilitados)
      ? f.grupos_habilitados.map(String)
      : [],
  };
}

function aPersona(f: Record<string, unknown>): Person {
  return {
    id: String(f.id),
    eventId: String(f.event_id),
    nombre: String(f.nombre ?? ''),
    documento: String(f.documento ?? ''),
    empresa: String(f.empresa ?? ''),
    grupo: String(f.grupo ?? ''),
    referencia: String(f.referencia ?? ''),
    telefono: String(f.telefono ?? ''),
    diasHabilitados: Array.isArray(f.dias_habilitados)
      ? f.dias_habilitados.map(String)
      : null,
    activo: f.activo !== false,
    origen: f.origen === 'manual' ? 'manual' : 'importado',
    creadoEn: String(f.creado_en ?? new Date().toISOString()),
  };
}

function aFilaSimple(r: EventDay | Service | Person): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) out[aSnake(k)] = v;
  return out;
}

function aFilaSlot(s: Slot): Record<string, unknown> {
  return {
    id: s.id,
    event_id: s.eventId,
    day_id: s.dayId,
    service_id: s.serviceId,
    hora_desde: s.horaDesde || null,
    hora_hasta: s.horaHasta || null,
    grupos_habilitados: s.gruposHabilitados,
  };
}

function aSnake(k: string): string {
  return k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function aEntrega(f: Record<string, unknown>): Delivery {
  return {
    id: String(f.id),
    eventId: String(f.event_id),
    slotId: String(f.slot_id),
    personId: String(f.person_id),
    estado: (f.estado as Delivery['estado']) ?? 'entregado',
    nombreFirmante: String(f.nombre_firmante ?? ''),
    documentoFirmante: String(f.documento_firmante ?? ''),
    conFirma: Boolean(f.con_firma),
    firmadoEn: String(f.firmado_en ?? new Date().toISOString()),
    operador: String(f.operador ?? ''),
    dispositivo: String(f.dispositivo ?? ''),
    sello: String(f.sello ?? ''),
    observacion: String(f.observacion ?? ''),
    anuladoEn: (f.anulado_en as string) ?? undefined,
    anuladoPor: (f.anulado_por as string) ?? undefined,
    motivoAnulacion: (f.motivo_anulacion as string) ?? undefined,
    sync: 'sincronizado',
  };
}

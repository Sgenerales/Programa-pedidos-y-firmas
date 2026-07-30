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
}

/**
 * Descarga únicamente eventos que todavía no existen en este dispositivo.
 * Nunca pisa una estructura local, porque podría contener cambios sin red.
 */
export async function bajarEstructurasFaltantes(
  idsLocales: string[],
): Promise<EstructuraRemota> {
  const c = await obtenerCliente();
  if (!c) return { eventos: [], dias: [], servicios: [], slots: [], personas: [] };

  const resultados = await Promise.all([
    c.from('acta_events').select('*'),
    c.from('acta_days').select('*'),
    c.from('acta_services').select('*'),
    c.from('acta_slots').select('*'),
    c.from('acta_people').select('*'),
  ]);
  const tablas = ['acta_events', 'acta_days', 'acta_services', 'acta_slots', 'acta_people'];
  for (let i = 0; i < resultados.length; i++) {
    const error = resultados[i].error;
    if (error) throw new Error(`${tablas[i]}: ${traducirErrorDatos(error)}`);
  }

  const existentes = new Set(idsLocales);
  const eventos = (resultados[0].data ?? [])
    .map((fila) => aEvento(fila as Record<string, unknown>))
    .filter((evento) => !existentes.has(evento.id))
    .sort((a, b) => b.actualizadoEn.localeCompare(a.actualizadoEn));
  const idsNuevos = new Set(eventos.map((evento) => evento.id));

  return {
    eventos,
    dias: (resultados[1].data ?? [])
      .map((fila) => aDia(fila as Record<string, unknown>))
      .filter((fila) => idsNuevos.has(fila.eventId)),
    servicios: (resultados[2].data ?? [])
      .map((fila) => aServicio(fila as Record<string, unknown>))
      .filter((fila) => idsNuevos.has(fila.eventId)),
    slots: (resultados[3].data ?? [])
      .map((fila) => aSlot(fila as Record<string, unknown>))
      .filter((fila) => idsNuevos.has(fila.eventId)),
    personas: (resultados[4].data ?? [])
      .map((fila) => aPersona(fila as Record<string, unknown>))
      .filter((fila) => idsNuevos.has(fila.eventId)),
  };
}

/** Elimina el evento remoto y verifica que RLS haya autorizado el borrado. */
export async function eliminarEstructura(eventId: string): Promise<ResultadoNube> {
  const c = await obtenerCliente();
  if (!c) return { ok: false, mensaje: 'Sin conexión configurada.' };

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

  const pasos: [string, Record<string, unknown>[]][] = [
    ['acta_events', [aFilaEvento(datos.evento)]],
    ['acta_days', datos.dias.map(aFilaSimple)],
    ['acta_services', datos.servicios.map(aFilaSimple)],
    ['acta_slots', datos.slots.map(aFilaSlot)],
    ['acta_people', datos.personas.map(aFilaSimple)],
  ];

  for (const [tabla, filas] of pasos) {
    if (!filas.length) continue;
    // upsert nunca lanza: hay que revisar `error` explícitamente.
    const { error } = await c.from(tabla).upsert(filas, { onConflict: 'id' });
    if (error) return { ok: false, mensaje: `${tabla}: ${traducirErrorDatos(error)}` };
  }
  return { ok: true };
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
  const conFirmaReal = Boolean(entrega.conFirma && firma?.png);

  return {
    id: entrega.id,
    event_id: entrega.eventId,
    slot_id: entrega.slotId,
    person_id: entrega.personId,
    estado: entrega.estado,
    nombre_firmante: entrega.nombreFirmante,
    documento_firmante: entrega.documentoFirmante,
    con_firma: conFirmaReal,
    firma_png: firma?.png ?? null,
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

/** Trae entregas registradas por otros puestos y las fusiona localmente. */
export async function bajarEntregas(eventId: string): Promise<{ bajadas: number; mensaje?: string }> {
  const c = await obtenerCliente();
  if (!c) return { bajadas: 0 };

  const { data, error } = await c.from('acta_deliveries').select('*').eq('event_id', eventId);
  if (error) return { bajadas: 0, mensaje: traducirErrorDatos(error) };
  if (!data?.length) return { bajadas: 0 };

  const locales = await db.getByIndex<Delivery>('deliveries', 'eventId', eventId);
  const porId = new Map(locales.map((e) => [e.id, e]));
  const porSlotPersona = new Map(locales.map((e) => [`${e.slotId}|${e.personId}`, e]));

  const nuevas: Delivery[] = [];
  const firmas: SignatureRecord[] = [];

  for (const fila of data as Record<string, unknown>[]) {
    const entrega = aEntrega(fila);
    const local = porId.get(entrega.id);
    // Nunca pisamos una entrega local distinta para el mismo turno.
    if (!local && porSlotPersona.has(`${entrega.slotId}|${entrega.personId}`)) continue;
    if (local && local.estado === entrega.estado && local.sync === 'sincronizado') continue;

    nuevas.push(entrega);
    const png = fila['firma_png'] as string | null;
    if (png) {
      firmas.push({
        id: entrega.id,
        eventId,
        png,
        trazos: (fila['firma_trazos'] as SignatureRecord['trazos']) ?? [],
        ancho: Number(fila['firma_ancho']) || 600,
        alto: Number(fila['firma_alto']) || 240,
      });
    }
  }

  if (nuevas.length) await db.putMany('deliveries', nuevas);
  if (firmas.length) await db.putMany('signatures', firmas);
  return { bajadas: nuevas.length };
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

import type { SupabaseClient } from '@supabase/supabase-js';
import * as db from './idb';
import type {
  Delivery,
  DeviceSettings,
  EventDay,
  EventRecord,
  Person,
  Service,
  SignatureRecord,
  Slot,
} from '../types';

/* ═══════════════════════════════════════════════════════════════════
   Sincronización opcional
   ───────────────────────────────────────────────────────────────────
   La app es local-first: nada de esto es necesario para operar. Si hay
   credenciales cargadas, se replica el evento y las entregas para que
   varios puestos se vean entre sí y quede respaldo en la nube.
   ═══════════════════════════════════════════════════════════════════ */

let cliente: SupabaseClient | null = null;
let clienteCredencial = '';

/** El SDK solo se descarga si la sincronización está realmente activa. */
export async function obtenerCliente(s: DeviceSettings): Promise<SupabaseClient | null> {
  if (!s.syncHabilitado || !s.supabaseUrl || !s.supabaseAnonKey) return null;
  const credencial = `${s.supabaseUrl.trim()}|${s.supabaseAnonKey.trim()}`;
  if (cliente && clienteCredencial === credencial) return cliente;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    cliente = createClient(s.supabaseUrl.trim(), s.supabaseAnonKey.trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 5 } },
    });
    clienteCredencial = credencial;
    return cliente;
  } catch {
    return null;
  }
}

export function reiniciarCliente(): void {
  cliente = null;
  clienteCredencial = '';
}

export interface EstadoSesion {
  autenticado: boolean;
  email?: string;
  mensaje?: string;
}

/** Devuelve la sesión persistida del dispositivo sin solicitar credenciales otra vez. */
export async function obtenerEstadoSesion(s: DeviceSettings): Promise<EstadoSesion> {
  const c = await obtenerCliente({ ...s, syncHabilitado: true });
  if (!c) return { autenticado: false, mensaje: 'Faltan la URL o la clave publicable.' };
  const { data, error } = await c.auth.getSession();
  if (error) return { autenticado: false, mensaje: error.message };
  return {
    autenticado: Boolean(data.session),
    email: data.session?.user.email ?? undefined,
  };
}

/** Inicia Supabase Auth sin persistir la contraseña en la configuración local. */
export async function iniciarSesion(
  s: DeviceSettings,
  email: string,
  password: string,
): Promise<EstadoSesion> {
  const c = await obtenerCliente({ ...s, syncHabilitado: true });
  if (!c) return { autenticado: false, mensaje: 'Faltan la URL o la clave publicable.' };
  const { data, error } = await c.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) return { autenticado: false, mensaje: error.message };
  return {
    autenticado: Boolean(data.session),
    email: data.user?.email ?? email.trim(),
  };
}

export async function cerrarSesion(s: DeviceSettings): Promise<{ ok: boolean; mensaje?: string }> {
  const c = await obtenerCliente({ ...s, syncHabilitado: true });
  if (!c) return { ok: false, mensaje: 'Faltan la URL o la clave publicable.' };
  const { error } = await c.auth.signOut();
  if (error) return { ok: false, mensaje: error.message };
  return { ok: true };
}

export interface ResultadoSync {
  ok: boolean;
  subidas: number;
  bajadas: number;
  mensaje?: string;
}

/** Verifica credenciales y presencia de las tablas requeridas. */
export async function probarConexion(s: DeviceSettings): Promise<{ ok: boolean; mensaje: string }> {
  const c = await obtenerCliente({ ...s, syncHabilitado: true });
  if (!c) return { ok: false, mensaje: 'Faltan la URL o la clave publicable.' };
  const { data: sesion, error: errorSesion } = await c.auth.getSession();
  if (errorSesion) return { ok: false, mensaje: errorSesion.message };
  if (!sesion.session) {
    return { ok: false, mensaje: 'La conexión responde, pero este puesto aún no inició sesión.' };
  }
  const { data: membresia, error: errorMembresia } = await c
    .from('acta_members')
    .select('user_id, role, activo')
    .eq('user_id', sesion.session.user.id)
    .maybeSingle();
  if (errorMembresia) {
    return {
      ok: false,
      mensaje:
        errorMembresia.code === '42P01' || errorMembresia.code === 'PGRST205'
          ? 'Conectó, pero faltan las tablas. Ejecutá la migración segura de Supabase.'
          : errorMembresia.message,
    };
  }
  if (!membresia?.activo) {
    return { ok: false, mensaje: 'El usuario inició sesión, pero no está autorizado para ACTA.' };
  }
  const { error } = await c.from('acta_deliveries').select('id').limit(1);
  if (error) {
    return {
      ok: false,
      mensaje:
        error.code === '42P01' || error.code === 'PGRST205'
          ? 'Conectó, pero faltan las tablas. Ejecutá la migración segura de Supabase.'
          : error.message,
    };
  }
  return {
    ok: true,
    mensaje: `Conexión segura verificada como ${sesion.session.user.email ?? 'usuario autorizado'}.`,
  };
}

/* ─── Subida ─────────────────────────────────────────────────────── */

/** Replica la estructura del evento. Idempotente: upsert por id. */
export async function subirEstructura(
  s: DeviceSettings,
  datos: {
    evento: EventRecord;
    dias: EventDay[];
    servicios: Service[];
    slots: Slot[];
    personas: Person[];
  },
): Promise<{ ok: boolean; mensaje?: string }> {
  const c = await obtenerCliente(s);
  if (!c) return { ok: false, mensaje: 'Sincronización desactivada.' };

  const pasos: [string, Record<string, unknown>[]][] = [
    ['acta_events', [aFilaEvento(datos.evento)]],
    ['acta_days', datos.dias.map(aFilaSimple)],
    ['acta_services', datos.servicios.map(aFilaSimple)],
    ['acta_slots', datos.slots.map(aFilaSlot)],
    ['acta_people', datos.personas.map(aFilaSimple)],
  ];

  for (const [tabla, filas] of pasos) {
    if (!filas.length) continue;
    // upsert nunca lanza: siempre hay que revisar `error` explícitamente.
    const { error } = await c.from(tabla).upsert(filas, { onConflict: 'id' });
    if (error) return { ok: false, mensaje: `${tabla}: ${error.message}` };
  }
  return { ok: true };
}

/**
 * Sube las entregas pendientes. La unicidad (slot_id, person_id) vive en
 * la base: si otro puesto ya registró a esa persona, el insert choca y
 * conservamos el registro remoto en vez de pisarlo.
 */
export async function subirEntregas(
  s: DeviceSettings,
  eventId: string,
): Promise<{ subidas: number; conflictos: Delivery[]; mensaje?: string }> {
  const c = await obtenerCliente(s);
  if (!c) return { subidas: 0, conflictos: [] };

  const todas = await db.getByIndex<Delivery>('deliveries', 'eventId', eventId);
  const pendientes = todas.filter((e) => e.sync === 'pendiente');
  if (!pendientes.length) return { subidas: 0, conflictos: [] };

  const conflictos: Delivery[] = [];
  let subidas = 0;

  for (const entrega of pendientes) {
    const firma = entrega.conFirma
      ? await db.get<SignatureRecord>('signatures', entrega.id)
      : undefined;

    const { error } = await c.from('acta_deliveries').upsert(
      [
        {
          id: entrega.id,
          event_id: entrega.eventId,
          slot_id: entrega.slotId,
          person_id: entrega.personId,
          estado: entrega.estado,
          nombre_firmante: entrega.nombreFirmante,
          documento_firmante: entrega.documentoFirmante,
          con_firma: entrega.conFirma,
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
        },
      ],
      { onConflict: 'id' },
    );

    if (error) {
      // 23505 = violación de unicidad (slot_id, person_id) desde otro puesto.
      if (error.code === '23505') {
        conflictos.push(entrega);
        continue;
      }
      // 23503 = el turno o la persona todavía no existen en la nube: el
      // evento nunca se publicó. Es el error más probable al empezar, y
      // el mensaje crudo de Postgres no le dice nada al operador.
      if (error.code === '23503') {
        return {
          subidas,
          conflictos,
          mensaje:
            'Este evento todavía no está publicado en la nube. Andá a Ajustes → «Publicar evento actual» y volvé a intentar.',
        };
      }
      // 42501 / PGRST301 = el usuario entró pero no tiene permiso de escritura.
      if (error.code === '42501' || error.code === 'PGRST301') {
        return {
          subidas,
          conflictos,
          mensaje: 'Este usuario no tiene permiso para registrar entregas (rol «auditor» o inactivo).',
        };
      }
      return { subidas, conflictos, mensaje: error.message };
    }

    await db.put('deliveries', { ...entrega, sync: 'sincronizado' });
    subidas++;
  }

  return { subidas, conflictos };
}

/* ─── Bajada ─────────────────────────────────────────────────────── */

/** Trae entregas registradas por otros puestos y las fusiona localmente. */
export async function bajarEntregas(
  s: DeviceSettings,
  eventId: string,
): Promise<{ bajadas: number; mensaje?: string }> {
  const c = await obtenerCliente(s);
  if (!c) return { bajadas: 0 };

  const { data, error } = await c.from('acta_deliveries').select('*').eq('event_id', eventId);
  if (error) return { bajadas: 0, mensaje: error.message };
  if (!data?.length) return { bajadas: 0 };

  const locales = await db.getByIndex<Delivery>('deliveries', 'eventId', eventId);
  const porId = new Map(locales.map((e) => [e.id, e]));
  const porSlotPersona = new Map(locales.map((e) => [`${e.slotId}|${e.personId}`, e]));

  const nuevas: Delivery[] = [];
  const firmas: SignatureRecord[] = [];

  for (const fila of data as Record<string, never>[]) {
    const entrega = aEntrega(fila);
    const local = porId.get(entrega.id);
    // Nunca sobreescribimos una entrega local ya sincronizada con otra
    // identidad de firmante para el mismo turno: la primera manda.
    if (!local && porSlotPersona.has(`${entrega.slotId}|${entrega.personId}`)) continue;
    if (local && local.estado === entrega.estado && local.sync === 'sincronizado') continue;

    nuevas.push(entrega);
    const png = fila['firma_png'] as unknown as string | null;
    if (png) {
      firmas.push({
        id: entrega.id,
        eventId,
        png,
        trazos: (fila['firma_trazos'] as never) ?? [],
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
export function suscribirEntregas(
  s: DeviceSettings,
  eventId: string,
  onCambio: () => void,
): () => void {
  // El cliente se resuelve de forma asíncrona (el SDK se carga bajo
  // demanda), pero el efecto de React necesita su función de limpieza
  // de inmediato: la devolvemos ya y la completamos cuando conecta.
  let cerrar = () => {};
  let cancelado = false;

  void (async () => {
    const c = await obtenerCliente(s);
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

import { create } from 'zustand';
import * as db from '../lib/idb';
import {
  describirDispositivo,
  hoyISO,
  rangoFechas,
  sellar,
  tituloNombre,
  uid,
} from '../lib/util';
import { compararServiciosOperativos, PLANTILLAS_SERVICIO } from '../lib/catalogo';
import { compararPersonas } from './selectors';
import { HAY_NUBE } from '../lib/config';
import {
  anularEntregaEnNube,
  bajarEstructuras,
  bajarEntregas,
  cerrarSesion as cerrarSesionNube,
  eliminarEstructura,
  iniciarSesion as iniciarSesionNube,
  publicarEstructura,
  sesionGuardada,
  subirEntregas,
  SESION_VENCIDA,
  type DatosEvento,
} from '../lib/supabase';
import type {
  Delivery,
  DeviceSettings,
  EstadoSync,
  EventDay,
  EventRecord,
  Miembro,
  Person,
  Service,
  SignatureRecord,
  Slot,
  Stroke,
} from '../types';

const SETTINGS_KEY = 'acta.settings';

const SETTINGS_DEFAULT: DeviceSettings = {
  operador: '',
  puesto: 'Puesto 1',
  eventoActivoId: null,
  slotActivoId: null,
};

function leerSettings(): DeviceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...SETTINGS_DEFAULT };
    return { ...SETTINGS_DEFAULT, ...(JSON.parse(raw) as Partial<DeviceSettings>) };
  } catch {
    return { ...SETTINGS_DEFAULT };
  }
}

const SYNC_DEFAULT: EstadoSync = {
  pendientes: 0,
  conflictos: 0,
  sincronizando: false,
  ultimaOk: null,
  ultimoError: null,
  enLinea: typeof navigator === 'undefined' ? true : navigator.onLine,
};

function guardarSettings(s: DeviceSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* modo privado sin almacenamiento: la sesión sigue en memoria */
  }
}

async function asegurarDiasSinEntregas(eventId: string, dayIds: Set<string>): Promise<void> {
  if (!dayIds.size) return;
  const [slots, entregas] = await Promise.all([
    db.getByIndex<Slot>('slots', 'eventId', eventId),
    db.getByIndex<Delivery>('deliveries', 'eventId', eventId),
  ]);
  const slotIds = new Set(slots.filter((s) => dayIds.has(s.dayId)).map((s) => s.id));
  if (entregas.some((e) => slotIds.has(e.slotId))) {
    throw new Error(
      'No se puede acortar el rango: una de las jornadas eliminadas tiene entregas registradas.',
    );
  }
}

/* ─── Sincronización de un evento ────────────────────────────────── */

/** Huella de la estructura ya publicada, por evento. Evita reenviar el
    padrón entero en cada firma: con 170 personas y 1.500 entregas eso
    serían cientos de miles de filas y un límite de tasa asegurado. */
const HUELLAS_KEY = 'acta.estructuraPublicada';
/* Hasta dónde bajó ya cada evento. Sin esto, cada ciclo de
   sincronización volvería a descargar el evento completo. */
const MARCAS_KEY = 'acta.marcaSync';
/* La estructura de un evento cambia rara vez —al armarlo o al importar
   el padrón—, mientras que las entregas cambian todo el tiempo. No tiene
   sentido preguntar por ella en cada ciclo de 30 segundos. */
const INTERVALO_ESTRUCTURA_MS = 5 * 60_000;
let ultimaConsultaEstructura = 0;

function leerHuellas(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(HUELLAS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function leerMarcas(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MARCAS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Qué versión de cada evento tiene realmente este dispositivo.
 *
 * Se deriva de IndexedDB, no de una clave paralela en localStorage: si
 * las dos fuentes se separan —caché borrada, almacenamiento lleno— el
 * dispositivo podría declarar que está al día sin tener el padrón, y la
 * reconciliación lo sobreescribiría con listas vacías.
 *
 * Un evento sin jornadas o sin personas no cuenta como conocido: se pide
 * su detalle de nuevo.
 */
async function versionesLocales(eventos: EventRecord[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const evento of eventos) {
    const [dias, personas] = await Promise.all([
      db.getByIndex<EventDay>('days', 'eventId', evento.id),
      db.getByIndex<Person>('people', 'eventId', evento.id),
    ]);
    if (dias.length || personas.length) out[evento.id] = evento.actualizadoEn;
  }
  return out;
}

function guardarMarca(eventId: string, marca: string): void {
  try {
    const todas = leerMarcas();
    todas[eventId] = marca;
    localStorage.setItem(MARCAS_KEY, JSON.stringify(todas));
  } catch {
    /* sin almacenamiento: se rebaja a sincronización completa */
  }
}

function guardarHuella(eventId: string, huella: string): void {
  try {
    const todas = leerHuellas();
    todas[eventId] = huella;
    localStorage.setItem(HUELLAS_KEY, JSON.stringify(todas));
  } catch {
    /* sin almacenamiento: se republica la estructura, que es idempotente */
  }
}

/** Hash barato y estable de la estructura completa del evento. */
function huellaEstructura(datos: DatosEvento): string {
  const texto = JSON.stringify([
    datos.evento,
    datos.dias,
    datos.servicios,
    datos.slots,
    datos.personas,
  ]);
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + ':' + texto.length.toString(36);
}

interface ResultadoEvento {
  cambios: number;
  conflictos: number;
  mensaje?: string;
}

/**
 * Sube lo pendiente de un evento y, si es el abierto, baja lo de los
 * otros puestos. `enMemoria` evita releer de IndexedDB el evento activo.
 */
async function sincronizarEvento(
  eventId: string,
  enMemoria: { eventos: EventRecord[]; dias: EventDay[]; servicios: Service[]; slots: Slot[]; personas: Person[] } | null,
): Promise<ResultadoEvento> {
  const datos = enMemoria
    ? {
        evento: enMemoria.eventos.find((e) => e.id === eventId)!,
        dias: enMemoria.dias,
        servicios: enMemoria.servicios,
        slots: enMemoria.slots,
        personas: enMemoria.personas,
      }
    : await leerEstructuraDeDisco(eventId);

  if (!datos?.evento) return { cambios: 0, conflictos: 0 };

  const huella = huellaEstructura(datos);
  const yaPublicada = leerHuellas()[eventId] === huella;

  // Publicamos la estructura solo si cambió. Si aun así una entrega
  // rebota por clave foránea, forzamos la publicación y reintentamos:
  // así el caso raro se resuelve solo y el caso común no paga el costo.
  if (!yaPublicada) {
    const est = await publicarEstructura(datos);
    if (!est.ok) return { cambios: 0, conflictos: 0, mensaje: est.mensaje };
    guardarHuella(eventId, huella);
  }

  let subida = await subirEntregas(eventId);
  if (subida.mensaje?.includes('todavía no está publicado') && yaPublicada) {
    const est = await publicarEstructura(datos);
    if (est.ok) {
      guardarHuella(eventId, huella);
      subida = await subirEntregas(eventId);
    }
  }

  let bajada: { bajadas: number; mensaje?: string } = { bajadas: 0 };
  if (enMemoria) {
    const previa = leerMarcas()[eventId] ?? null;
    const r = await bajarEntregas(eventId, previa);
    bajada = { bajadas: r.bajadas, mensaje: r.mensaje };
    // Solo avanzamos la marca si la bajada no falló a medias.
    if (!r.mensaje && r.marca && r.marca !== previa) guardarMarca(eventId, r.marca);
  }

  return {
    cambios: subida.subidas + bajada.bajadas + subida.conflictos.length,
    conflictos: subida.conflictos.length,
    mensaje: subida.mensaje ?? bajada.mensaje,
  };
}

async function leerEstructuraDeDisco(eventId: string): Promise<DatosEvento | null> {
  const evento = await db.get<EventRecord>('events', eventId);
  if (!evento) return null;
  const [dias, servicios, slots, personas] = await Promise.all([
    db.getByIndex<EventDay>('days', 'eventId', eventId),
    db.getByIndex<Service>('services', 'eventId', eventId),
    db.getByIndex<Slot>('slots', 'eventId', eventId),
    db.getByIndex<Person>('people', 'eventId', eventId),
  ]);
  return { evento, dias, servicios, slots, personas };
}

async function reemplazarColeccionLocal<T extends { id: string; eventId: string }>(
  store: 'days' | 'services' | 'slots' | 'people',
  eventId: string,
  filas: T[],
): Promise<void> {
  const actuales = await db.getByIndex<T>(store, 'eventId', eventId);
  const remotos = new Set(filas.map((fila) => fila.id));
  await db.removeMany(
    store,
    actuales.filter((fila) => !remotos.has(fila.id)).map((fila) => fila.id),
  );
  await db.putMany(store, filas);
}

/**
 * Supabase es la fuente compartida; IndexedDB funciona como caché offline.
 * Si ambos lados cambiaron, gana la estructura con `actualizadoEn` más nuevo.
 */
async function reconciliarEstructurasRemotas(
  eventosLocales: EventRecord[],
): Promise<EventRecord[]> {
  const remota = await bajarEstructuras(await versionesLocales(eventosLocales));
  // Los eventos que no vinieron con detalle no cambiaron: su caché local
  // se conserva. Pisarla con arreglos vacíos borraría el padrón entero.
  const conDetalle = remota.detallados ? new Set(remota.detallados) : null;
  const locales = new Map(eventosLocales.map((evento) => [evento.id, evento]));
  const eliminados = new Set(remota.eliminados);
  const huellas = leerHuellas();
  const resultado: EventRecord[] = [];

  for (const eventId of eliminados) {
    if (locales.has(eventId)) await db.purgeEvent(eventId);
    locales.delete(eventId);
  }

  for (const eventoRemoto of remota.eventos) {
    if (eliminados.has(eventoRemoto.id)) continue;
    const local = locales.get(eventoRemoto.id);

    if (conDetalle && !conDetalle.has(eventoRemoto.id)) {
      // Sin novedades: conservamos la caché local intacta. Y si no hay
      // copia local, tampoco escribimos: un evento vacío sería peor.
      if (local) resultado.push(local);
      locales.delete(eventoRemoto.id);
      continue;
    }

    const datosRemotos: DatosEvento = {
      evento: eventoRemoto,
      dias: remota.dias.filter((fila) => fila.eventId === eventoRemoto.id),
      servicios: remota.servicios.filter((fila) => fila.eventId === eventoRemoto.id),
      slots: remota.slots.filter((fila) => fila.eventId === eventoRemoto.id),
      personas: remota.personas.filter((fila) => fila.eventId === eventoRemoto.id),
    };

    let conservarRemoto = !local;
    if (local) {
      const datosLocales = await leerEstructuraDeDisco(local.id);
      const huellaLocal = datosLocales ? huellaEstructura(datosLocales) : '';
      const localCambio = huellas[local.id] !== huellaLocal;
      conservarRemoto =
        eventoRemoto.actualizadoEn > local.actualizadoEn ||
        (!localCambio && huellaEstructura(datosRemotos) !== huellaLocal);
    }

    if (conservarRemoto) {
      await db.put('events', eventoRemoto);
      await reemplazarColeccionLocal('days', eventoRemoto.id, datosRemotos.dias);
      await reemplazarColeccionLocal('services', eventoRemoto.id, datosRemotos.servicios);
      await reemplazarColeccionLocal('slots', eventoRemoto.id, datosRemotos.slots);
      await reemplazarColeccionLocal('people', eventoRemoto.id, datosRemotos.personas);
      guardarHuella(eventoRemoto.id, huellaEstructura(datosRemotos));
      resultado.push(eventoRemoto);
    } else {
      resultado.push(local!);
    }
    locales.delete(eventoRemoto.id);
  }

  // La ausencia no equivale a borrado: podría ser una caché creada sin red o
  // una lectura limitada por permisos. Solo un tombstone autoriza purgarla.
  for (const eventoLocal of locales.values()) {
    resultado.push(eventoLocal);
  }

  return resultado.sort((a, b) => b.actualizadoEn.localeCompare(a.actualizadoEn));
}

async function marcarEventoActualizado(
  eventId: string,
  eventos: EventRecord[],
): Promise<EventRecord[]> {
  const actual = eventos.find((evento) => evento.id === eventId);
  if (!actual) return eventos;
  const actualizado = { ...actual, actualizadoEn: new Date().toISOString() };
  await db.put('events', actualizado);
  return eventos.map((evento) => (evento.id === eventId ? actualizado : evento));
}

export interface Toast {
  id: string;
  tipo: 'ok' | 'error' | 'info';
  titulo: string;
  detalle?: string;
}

export type ResultadoEntrega =
  | { ok: true; delivery: Delivery }
  | { ok: false; motivo: 'duplicado'; existente: Delivery }
  | { ok: false; motivo: 'error'; mensaje: string };

interface State {
  listo: boolean;
  eventos: EventRecord[];

  /* Datos del evento cargado en memoria */
  eventoId: string | null;
  dias: EventDay[];
  servicios: Service[];
  slots: Slot[];
  personas: Person[];
  entregas: Delivery[];

  settings: DeviceSettings;
  toasts: Toast[];

  /* ─ sesión ─ */
  sesion: Miembro | null;
  sesionVerificada: boolean;
  sync: EstadoSync;

  /* ─ ciclo de vida ─ */
  init: () => Promise<void>;
  cargarEvento: (id: string | null) => Promise<void>;
  entrar: (email: string, password: string) => Promise<{ ok: boolean; mensaje?: string }>;
  salir: () => Promise<void>;
  /** Sube lo pendiente y baja lo de otros puestos. Seguro de llamar seguido. */
  sincronizar: (opciones?: { silencioso?: boolean; forzarEstructura?: boolean }) => Promise<void>;
  refrescarPendientes: () => Promise<void>;
  setEnLinea: (v: boolean) => void;

  /* ─ eventos ─ */
  crearEvento: (parcial: Partial<EventRecord>) => Promise<EventRecord>;
  actualizarEvento: (id: string, cambios: Partial<EventRecord>) => Promise<void>;
  duplicarEvento: (id: string, nombre: string) => Promise<string>;
  eliminarEvento: (id: string) => Promise<void>;

  /* ─ estructura ─ */
  sincronizarDias: (eventId: string, desde: string, hasta: string) => Promise<void>;
  renombrarDia: (dayId: string, etiqueta: string) => Promise<void>;
  agregarServicio: (eventId: string, base: Partial<Service>) => Promise<Service>;
  actualizarServicio: (id: string, cambios: Partial<Service>) => Promise<void>;
  eliminarServicio: (id: string) => Promise<void>;
  alternarTurno: (eventId: string, dayId: string, serviceId: string) => Promise<void>;
  actualizarTurno: (id: string, cambios: Partial<Slot>) => Promise<void>;
  aplicarServicioATodosLosDias: (eventId: string, serviceId: string, activar: boolean) => Promise<void>;

  /* ─ padrón ─ */
  importarPersonas: (eventId: string, filas: Omit<Person, 'id' | 'eventId' | 'creadoEn' | 'origen' | 'activo'>[]) => Promise<number>;
  agregarPersona: (eventId: string, base: Partial<Person>) => Promise<Person>;
  actualizarPersona: (id: string, cambios: Partial<Person>) => Promise<void>;
  eliminarPersona: (id: string) => Promise<void>;
  vaciarPadron: (eventId: string) => Promise<void>;

  /* ─ operación ─ */
  registrarEntrega: (args: {
    personId: string;
    slotId: string;
    trazos: Stroke[];
    ancho: number;
    alto: number;
    observacion?: string;
  }) => Promise<ResultadoEntrega>;
  anularEntrega: (deliveryId: string, motivo: string) => Promise<void>;
  obtenerFirma: (deliveryId: string) => Promise<SignatureRecord | undefined>;

  /* ─ dispositivo ─ */
  setSettings: (cambios: Partial<DeviceSettings>) => void;

  /* ─ UI ─ */
  toast: (t: Omit<Toast, 'id'>) => void;
  cerrarToast: (id: string) => void;
}

export const useStore = create<State>((set, get) => ({
  listo: false,
  eventos: [],
  eventoId: null,
  dias: [],
  servicios: [],
  slots: [],
  personas: [],
  entregas: [],
  settings: leerSettings(),
  toasts: [],
  sesion: null,
  sesionVerificada: !HAY_NUBE,
  sync: { ...SYNC_DEFAULT },

  async init() {
    let eventos = await db.getAll<EventRecord>('events');
    eventos.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
    const s = get().settings;
    set({ eventos, listo: true });

    if (HAY_NUBE) {
      // La sesión vive en el dispositivo: si ya entró alguna vez, se sigue
      // operando aunque ahora no haya red.
      const sesion = await sesionGuardada().catch(() => null);
      set({
        sesion,
        sesionVerificada: true,
        settings: sesion?.nombre
          ? { ...get().settings, operador: sesion.nombre }
          : get().settings,
      });
      if (sesion) {
        try {
          eventos = await reconciliarEstructurasRemotas(eventos);
          set({ eventos });
        } catch (err) {
          set({
            sync: {
              ...get().sync,
              ultimoError:
                err instanceof Error ? err.message : 'No se pudieron descargar los eventos.',
            },
          });
        }
      }
    }

    if (s.eventoActivoId && eventos.some((e) => e.id === s.eventoActivoId)) {
      await get().cargarEvento(s.eventoActivoId);
    }
    await get().refrescarPendientes();
  },

  /* ═══ Sesión ════════════════════════════════════════════════════ */

  async entrar(email, password) {
    const res = await iniciarSesionNube(email, password);
    if (!res.ok) return { ok: false, mensaje: res.mensaje };
    // El operador que firma el acta es la persona que inició sesión.
    const next = { ...get().settings, operador: res.sesion.nombre };
    guardarSettings(next);
    set({ sesion: res.sesion, settings: next, sesionVerificada: true });
    try {
      const eventos = await reconciliarEstructurasRemotas(get().eventos);
      set({ eventos });
    } catch (err) {
      set({
        sync: {
          ...get().sync,
          ultimoError:
            err instanceof Error ? err.message : 'No se pudieron descargar los eventos.',
        },
      });
    }
    void get().sincronizar({ silencioso: true });
    return { ok: true };
  },

  async salir() {
    const { sync } = get();
    if (sync.pendientes > 0) {
      // Cerrar sesión con firmas sin subir las dejaría varadas en esta
      // tablet, fuera del reporte. Intentamos vaciar la cola primero.
      await get().sincronizar({ silencioso: true });
    }
    await cerrarSesionNube().catch(() => {});
    set({ sesion: null });
  },

  /* ═══ Sincronización ════════════════════════════════════════════ */

  setEnLinea(v) {
    set({ sync: { ...get().sync, enLinea: v } });
    if (v) void get().sincronizar({ silencioso: true });
  },

  async refrescarPendientes() {
    // Cuenta sobre TODOS los eventos, no solo el activo: una firma de un
    // evento anterior que quedó sin subir tiene que seguir siendo visible.
    const todas = await db.getAll<Delivery>('deliveries');
    set({
      sync: {
        ...get().sync,
        pendientes: todas.filter((e) => e.sync === 'pendiente').length,
        conflictos: todas.filter((e) => e.sync === 'conflicto').length,
      },
    });
  },

  async sincronizar(opciones) {
    const { sesion, sync, eventoId, eventos } = get();
    if (!HAY_NUBE || !sesion || sync.sincronizando) return;

    // Un evento cerrado ya no recibe entregas ni cambios de estructura:
    // consultarlo solo gastaría transferencia. Dejamos salir lo que
    // todavía no subió —una firma no puede quedarse afuera del reporte—
    // y después el dispositivo queda en silencio aunque siga abierto.
    const activo = eventos.find((e) => e.id === eventoId) ?? null;
    const cerrado = activo?.estado === 'cerrado';
    if (cerrado && sync.pendientes === 0 && !opciones?.forzarEstructura) {
      set({ sync: { ...get().sync, sincronizando: false, ultimoError: null } });
      return;
    }

    set({ sync: { ...get().sync, sincronizando: true, ultimoError: null } });

    try {
      // Barremos todos los eventos con entregas pendientes, no solo el
      // que está abierto. Cambiar de evento no puede dejar firmas
      // varadas fuera del reporte.
      const ahora = Date.now();
      const tocaEstructura =
        opciones?.forzarEstructura === true ||
        (!cerrado && ahora - ultimaConsultaEstructura > INTERVALO_ESTRUCTURA_MS);
      let eventos = get().eventos;
      if (tocaEstructura) {
        ultimaConsultaEstructura = ahora;
        eventos = await reconciliarEstructurasRemotas(eventos);
        set({ eventos });
      }
      if (eventoId && eventos.some((evento) => evento.id === eventoId)) {
        await get().cargarEvento(eventoId);
      } else if (eventoId) {
        await get().cargarEvento(null);
      }

      const todas = await db.getAll<Delivery>('deliveries');
      const objetivos = new Set(eventos.map((evento) => evento.id));
      for (const entrega of todas.filter((fila) => fila.sync === 'pendiente')) {
        objetivos.add(entrega.eventId);
      }
      // El evento abierto entra siempre, aunque no deba nada: es el que
      // necesita bajar lo que registraron los otros puestos.
      if (get().eventoId) objetivos.add(get().eventoId!);

      let error: string | null = null;
      let conflictos = 0;
      let cambios = 0;

      for (const id of objetivos) {
        const r = await sincronizarEvento(id, id === get().eventoId ? get() : null);
        conflictos += r.conflictos;
        cambios += r.cambios;
        if (r.mensaje && !error) error = r.mensaje;
      }

      if (cambios && get().eventoId) await get().cargarEvento(get().eventoId);
      await get().refrescarPendientes();

      // Una sesión vencida no se arregla reintentando: hay que volver a
      // entrar. Soltamos la sesión para que aparezca el login, sin tocar
      // las entregas locales, que siguen en cola.
      const vencida = Boolean(error?.startsWith(SESION_VENCIDA));
      if (vencida) set({ sesion: null });

      set({
        sync: {
          ...get().sync,
          sincronizando: false,
          ultimoError: vencida ? error!.slice(SESION_VENCIDA.length + 2) : error,
          ultimaOk: error ? get().sync.ultimaOk : new Date().toISOString(),
        },
      });

      if (conflictos && !opciones?.silencioso) {
        get().toast({
          tipo: 'error',
          titulo: `${conflictos} entrega(s) en conflicto`,
          detalle: 'Otro puesto ya había registrado a esa persona en ese turno.',
        });
      }
      if (error && !opciones?.silencioso) {
        get().toast({ tipo: 'error', titulo: 'No se pudo sincronizar', detalle: error });
      }
    } catch (err) {
      set({
        sync: {
          ...get().sync,
          sincronizando: false,
          ultimoError: err instanceof Error ? err.message : 'Error de red',
        },
      });
    }
  },

  async cargarEvento(id) {
    if (!id) {
      set({ eventoId: null, dias: [], servicios: [], slots: [], personas: [], entregas: [] });
      get().setSettings({ eventoActivoId: null, slotActivoId: null });
      return;
    }
    const [dias, servicios, slots, personas, entregas] = await Promise.all([
      db.getByIndex<EventDay>('days', 'eventId', id),
      db.getByIndex<Service>('services', 'eventId', id),
      db.getByIndex<Slot>('slots', 'eventId', id),
      db.getByIndex<Person>('people', 'eventId', id),
      db.getByIndex<Delivery>('deliveries', 'eventId', id),
    ]);
    dias.sort((a, b) => a.orden - b.orden);
    servicios.sort(compararServiciosOperativos);
    personas.sort(compararPersonas);
    set({ eventoId: id, dias, servicios, slots, personas, entregas });
    get().setSettings({ eventoActivoId: id });
  },

  /* ═══ Eventos ═══════════════════════════════════════════════════ */

  async crearEvento(parcial) {
    const ahora = new Date().toISOString();
    const inicio = parcial.fechaInicio || hoyISO();
    const evento: EventRecord = {
      id: uid('ev'),
      nombre: parcial.nombre?.trim() || 'Evento sin título',
      organizador: parcial.organizador ?? '',
      lugar: parcial.lugar ?? '',
      fechaInicio: inicio,
      fechaFin: parcial.fechaFin || inicio,
      estado: 'borrador',
      requiereDocumento: parcial.requiereDocumento ?? false,
      permiteWalkIn: parcial.permiteWalkIn ?? true,
      notas: parcial.notas ?? '',
      creadoEn: ahora,
      actualizadoEn: ahora,
    };
    await db.put('events', evento);
    set({ eventos: [evento, ...get().eventos] });
    await get().sincronizarDias(evento.id, evento.fechaInicio, evento.fechaFin);
    await get().sincronizar({ silencioso: true });
    return evento;
  },

  async actualizarEvento(id, cambios) {
    const actual = get().eventos.find((e) => e.id === id);
    if (!actual) return;
    const actualizado: EventRecord = {
      ...actual,
      ...cambios,
      actualizadoEn: new Date().toISOString(),
    };
    if (cambios.fechaInicio || cambios.fechaFin) {
      const diasActuales = await db.getByIndex<EventDay>('days', 'eventId', id);
      const fechasNuevas = new Set(rangoFechas(actualizado.fechaInicio, actualizado.fechaFin));
      const diasFueraDeRango = new Set(
        diasActuales.filter((d) => !fechasNuevas.has(d.fecha)).map((d) => d.id),
      );
      await asegurarDiasSinEntregas(id, diasFueraDeRango);
    }
    await db.put('events', actualizado);
    set({ eventos: get().eventos.map((e) => (e.id === id ? actualizado : e)) });
    if (cambios.fechaInicio || cambios.fechaFin) {
      await get().sincronizarDias(id, actualizado.fechaInicio, actualizado.fechaFin);
    }
    void get().sincronizar({ silencioso: true });
  },

  async duplicarEvento(id, nombre) {
    const origen = get().eventos.find((e) => e.id === id);
    if (!origen) throw new Error('El evento no existe');

    const [dias, servicios, slots] = await Promise.all([
      db.getByIndex<EventDay>('days', 'eventId', id),
      db.getByIndex<Service>('services', 'eventId', id),
      db.getByIndex<Slot>('slots', 'eventId', id),
    ]);

    const ahora = new Date().toISOString();
    const nuevo: EventRecord = {
      ...origen,
      id: uid('ev'),
      nombre,
      estado: 'borrador',
      creadoEn: ahora,
      actualizadoEn: ahora,
    };
    await db.put('events', nuevo);

    const mapaDias = new Map<string, string>();
    const mapaServicios = new Map<string, string>();
    const nuevosDias = dias.map((d) => {
      const nid = uid('dia');
      mapaDias.set(d.id, nid);
      return { ...d, id: nid, eventId: nuevo.id };
    });
    const nuevosServicios = servicios.map((s) => {
      const nid = uid('srv');
      mapaServicios.set(s.id, nid);
      return { ...s, id: nid, eventId: nuevo.id };
    });
    const nuevosSlots = slots.map((s) => ({
      ...s,
      id: uid('slot'),
      eventId: nuevo.id,
      dayId: mapaDias.get(s.dayId) ?? s.dayId,
      serviceId: mapaServicios.get(s.serviceId) ?? s.serviceId,
    }));

    await db.putMany('days', nuevosDias);
    await db.putMany('services', nuevosServicios);
    await db.putMany('slots', nuevosSlots);
    set({ eventos: [nuevo, ...get().eventos] });
    await get().sincronizar({ silencioso: true });
    return nuevo.id;
  },

  async eliminarEvento(id) {
    if (HAY_NUBE) {
      const resultado = await eliminarEstructura(id);
      if (!resultado.ok) {
        throw new Error(resultado.mensaje ?? 'No se pudo eliminar el evento en Supabase.');
      }
    }
    await db.purgeEvent(id);
    set({ eventos: get().eventos.filter((e) => e.id !== id) });
    if (get().eventoId === id) await get().cargarEvento(null);
  },

  /* ═══ Estructura: días, servicios, turnos ═══════════════════════ */

  async sincronizarDias(eventId, desde, hasta) {
    const existentes = await db.getByIndex<EventDay>('days', 'eventId', eventId);
    const fechas = rangoFechas(desde, hasta);
    const porFecha = new Map(existentes.map((d) => [d.fecha, d]));

    const conservados: EventDay[] = [];
    fechas.forEach((fecha, i) => {
      const previo = porFecha.get(fecha);
      conservados.push(
        previo
          ? { ...previo, orden: i, etiqueta: previo.etiqueta || `Día ${i + 1}` }
          : { id: uid('dia'), eventId, fecha, etiqueta: `Día ${i + 1}`, orden: i },
      );
      porFecha.delete(fecha);
    });

    // Los días que quedaron fuera del rango se eliminan junto a sus turnos.
    const sobrantes = [...porFecha.values()];
    if (sobrantes.length) {
      const ids = new Set(sobrantes.map((d) => d.id));
      await asegurarDiasSinEntregas(eventId, ids);
      const slots = await db.getByIndex<Slot>('slots', 'eventId', eventId);
      await db.removeMany('slots', slots.filter((s) => ids.has(s.dayId)).map((s) => s.id));
      await db.removeMany('days', [...ids]);
    }

    await db.putMany('days', conservados);
    if (get().eventoId === eventId) {
      const slots = await db.getByIndex<Slot>('slots', 'eventId', eventId);
      set({ dias: conservados.sort((a, b) => a.orden - b.orden), slots });
    }
  },

  async renombrarDia(dayId, etiqueta) {
    const dia = get().dias.find((d) => d.id === dayId);
    if (!dia) return;
    const actualizado = { ...dia, etiqueta };
    await db.put('days', actualizado);
    set({
      dias: get().dias.map((d) => (d.id === dayId ? actualizado : d)),
      eventos: await marcarEventoActualizado(dia.eventId, get().eventos),
    });
    void get().sincronizar({ silencioso: true });
  },

  async agregarServicio(eventId, base) {
    const servicios = get().servicios;
    const plantilla = PLANTILLAS_SERVICIO[servicios.length % PLANTILLAS_SERVICIO.length];
    const servicio: Service = {
      id: uid('srv'),
      eventId,
      nombre: base.nombre?.trim() || plantilla.nombre,
      icono: base.icono ?? plantilla.icono,
      color: base.color ?? plantilla.color,
      requiereFirma: base.requiereFirma ?? true,
      orden: servicios.length,
    };
    await db.put('services', servicio);
    const eventos = await marcarEventoActualizado(eventId, get().eventos);
    if (get().eventoId === eventId) {
      set({ servicios: [...servicios, servicio].sort(compararServiciosOperativos), eventos });
    }
    else set({ eventos });
    void get().sincronizar({ silencioso: true });
    return servicio;
  },

  async actualizarServicio(id, cambios) {
    const actual = get().servicios.find((s) => s.id === id);
    if (!actual) return;
    const actualizado = { ...actual, ...cambios };
    await db.put('services', actualizado);
    set({
      servicios: get()
        .servicios.map((s) => (s.id === id ? actualizado : s))
        .sort(compararServiciosOperativos),
      eventos: await marcarEventoActualizado(actual.eventId, get().eventos),
    });
    void get().sincronizar({ silencioso: true });
  },

  async eliminarServicio(id) {
    const actual = get().servicios.find((servicio) => servicio.id === id);
    if (!actual) return;
    const slots = get().slots.filter((s) => s.serviceId === id);
    const entregas = get().entregas.filter((e) => slots.some((s) => s.id === e.slotId));
    if (entregas.length) {
      throw new Error(
        `No se puede eliminar: hay ${entregas.length} entrega(s) firmada(s) en este servicio.`,
      );
    }
    await db.removeMany('slots', slots.map((s) => s.id));
    await db.remove('services', id);
    set({
      servicios: get().servicios.filter((s) => s.id !== id),
      slots: get().slots.filter((s) => s.serviceId !== id),
      eventos: await marcarEventoActualizado(actual.eventId, get().eventos),
    });
    void get().sincronizar({ silencioso: true });
  },

  async alternarTurno(eventId, dayId, serviceId) {
    const existente = get().slots.find((s) => s.dayId === dayId && s.serviceId === serviceId);
    if (existente) {
      const conEntregas = get().entregas.some((e) => e.slotId === existente.id);
      if (conEntregas) {
        throw new Error('Este turno ya tiene entregas registradas y no puede desactivarse.');
      }
      await db.remove('slots', existente.id);
      set({ slots: get().slots.filter((s) => s.id !== existente.id) });
      if (get().settings.slotActivoId === existente.id) {
        get().setSettings({ slotActivoId: null });
      }
      set({ eventos: await marcarEventoActualizado(eventId, get().eventos) });
      void get().sincronizar({ silencioso: true });
      return;
    }
    const plantilla = PLANTILLAS_SERVICIO.find(
      (p) => p.nombre === get().servicios.find((s) => s.id === serviceId)?.nombre,
    );
    const slot: Slot = {
      id: uid('slot'),
      eventId,
      dayId,
      serviceId,
      horaDesde: plantilla?.horaDesde ?? '',
      horaHasta: plantilla?.horaHasta ?? '',
      gruposHabilitados: [],
    };
    await db.put('slots', slot);
    set({
      slots: [...get().slots, slot],
      eventos: await marcarEventoActualizado(eventId, get().eventos),
    });
    void get().sincronizar({ silencioso: true });
  },

  async actualizarTurno(id, cambios) {
    const actual = get().slots.find((s) => s.id === id);
    if (!actual) return;
    const actualizado = { ...actual, ...cambios };
    await db.put('slots', actualizado);
    set({
      slots: get().slots.map((s) => (s.id === id ? actualizado : s)),
      eventos: await marcarEventoActualizado(actual.eventId, get().eventos),
    });
    void get().sincronizar({ silencioso: true });
  },

  async aplicarServicioATodosLosDias(eventId, serviceId, activar) {
    const { dias, slots, entregas } = get();
    if (activar) {
      const faltantes = dias.filter(
        (d) => !slots.some((s) => s.dayId === d.id && s.serviceId === serviceId),
      );
      const plantilla = PLANTILLAS_SERVICIO.find(
        (p) => p.nombre === get().servicios.find((s) => s.id === serviceId)?.nombre,
      );
      const nuevos: Slot[] = faltantes.map((d) => ({
        id: uid('slot'),
        eventId,
        dayId: d.id,
        serviceId,
        horaDesde: plantilla?.horaDesde ?? '',
        horaHasta: plantilla?.horaHasta ?? '',
        gruposHabilitados: [],
      }));
      await db.putMany('slots', nuevos);
      set({ slots: [...slots, ...nuevos] });
    } else {
      const objetivo = slots.filter((s) => s.serviceId === serviceId);
      const bloqueados = objetivo.filter((s) => entregas.some((e) => e.slotId === s.id));
      if (bloqueados.length) {
        throw new Error('Hay turnos con entregas firmadas; no se pueden desactivar en bloque.');
      }
      await db.removeMany('slots', objetivo.map((s) => s.id));
      set({ slots: slots.filter((s) => s.serviceId !== serviceId) });
    }
    set({ eventos: await marcarEventoActualizado(eventId, get().eventos) });
    void get().sincronizar({ silencioso: true });
  },

  /* ═══ Padrón ════════════════════════════════════════════════════ */

  async importarPersonas(eventId, filas) {
    const ahora = new Date().toISOString();
    const nuevas: Person[] = filas.map((f) => ({
      id: uid('per'),
      eventId,
      nombre: tituloNombre(f.nombre),
      documento: f.documento?.trim() ?? '',
      empresa: f.empresa?.trim() ?? '',
      grupo: f.grupo?.trim() ?? '',
      referencia: f.referencia?.trim() ?? '',
      telefono: f.telefono?.trim() ?? '',
      diasHabilitados: f.diasHabilitados ?? null,
      activo: true,
      origen: 'importado',
      creadoEn: ahora,
    }));
    await db.putMany('people', nuevas);
    const eventos = await marcarEventoActualizado(eventId, get().eventos);
    if (get().eventoId === eventId) {
      const todas = [...get().personas, ...nuevas].sort(compararPersonas);
      set({ personas: todas, eventos });
    } else {
      set({ eventos });
    }
    await get().sincronizar({ silencioso: true });
    return nuevas.length;
  },

  async agregarPersona(eventId, base) {
    const persona: Person = {
      id: uid('per'),
      eventId,
      nombre: tituloNombre(base.nombre ?? ''),
      documento: base.documento ?? '',
      empresa: base.empresa ?? '',
      grupo: base.grupo ?? '',
      referencia: base.referencia ?? '',
      telefono: base.telefono ?? '',
      diasHabilitados: base.diasHabilitados ?? null,
      activo: true,
      origen: base.origen ?? 'manual',
      creadoEn: new Date().toISOString(),
    };
    if (!persona.nombre) throw new Error('El nombre es obligatorio.');
    await db.put('people', persona);
    const eventos = await marcarEventoActualizado(eventId, get().eventos);
    if (get().eventoId === eventId) {
      set({
        personas: [...get().personas, persona].sort(compararPersonas),
        eventos,
      });
    } else {
      set({ eventos });
    }
    void get().sincronizar({ silencioso: true });
    return persona;
  },

  async actualizarPersona(id, cambios) {
    const actual = get().personas.find((p) => p.id === id);
    if (!actual) return;
    const actualizado = { ...actual, ...cambios };
    await db.put('people', actualizado);
    set({
      personas: get()
        .personas.map((p) => (p.id === id ? actualizado : p))
        .sort(compararPersonas),
      eventos: await marcarEventoActualizado(actual.eventId, get().eventos),
    });
    void get().sincronizar({ silencioso: true });
  },

  async eliminarPersona(id) {
    const conEntregas = get().entregas.some((e) => e.personId === id);
    if (conEntregas) {
      throw new Error('Esta persona tiene entregas firmadas. Desactivala en vez de eliminarla.');
    }
    await db.remove('people', id);
    const persona = get().personas.find((fila) => fila.id === id);
    set({
      personas: get().personas.filter((p) => p.id !== id),
      eventos: persona
        ? await marcarEventoActualizado(persona.eventId, get().eventos)
        : get().eventos,
    });
    void get().sincronizar({ silencioso: true });
  },

  async vaciarPadron(eventId) {
    if (get().entregas.length) {
      throw new Error('El evento ya tiene entregas registradas: el padrón no puede vaciarse.');
    }
    const personas = await db.getByIndex<Person>('people', 'eventId', eventId);
    await db.removeMany('people', personas.map((p) => p.id));
    const eventos = await marcarEventoActualizado(eventId, get().eventos);
    if (get().eventoId === eventId) set({ personas: [], eventos });
    else set({ eventos });
    void get().sincronizar({ silencioso: true });
  },

  /* ═══ Operación ═════════════════════════════════════════════════ */

  async registrarEntrega({ personId, slotId, trazos, ancho, alto, observacion }) {
    const { personas, slots, eventoId, settings } = get();
    const persona = personas.find((p) => p.id === personId);
    const slot = slots.find((s) => s.id === slotId);
    if (
      !persona ||
      !slot ||
      !eventoId ||
      persona.eventId !== eventoId ||
      slot.eventId !== eventoId
    ) {
      return { ok: false, motivo: 'error', mensaje: 'Turno o persona inválidos.' };
    }

    // Un evento cerrado esta finalizado: su acta ya no admite entregas.
    if (get().eventos.find((e) => e.id === eventoId)?.estado === 'cerrado') {
      return {
        ok: false,
        motivo: 'error',
        mensaje: 'Este evento está cerrado. Reabrilo desde Eventos si necesitás registrar más entregas.',
      };
    }

    const servicio = get().servicios.find((s) => s.id === slot.serviceId);
    if (!servicio || servicio.eventId !== eventoId) {
      return { ok: false, motivo: 'error', mensaje: 'El servicio del turno no existe.' };
    }
    if (!persona.activo) {
      return { ok: false, motivo: 'error', mensaje: 'La persona está desactivada en el padrón.' };
    }
    if (
      Array.isArray(persona.diasHabilitados) &&
      !persona.diasHabilitados.includes(slot.dayId)
    ) {
      return {
        ok: false,
        motivo: 'error',
        mensaje: 'La persona no figura como asistente para esta jornada.',
      };
    }
    if (
      slot.gruposHabilitados.length &&
      !slot.gruposHabilitados.includes(persona.grupo)
    ) {
      return { ok: false, motivo: 'error', mensaje: 'La persona no está habilitada para este turno.' };
    }

    // La firma válida se mide sobre la geometría, no sobre la imagen: un
    // trazo con puntos suficientes y un lienzo con dimensiones reales.
    const puntos = trazos.reduce((n, trazo) => n + trazo.length, 0);
    if (servicio.requiereFirma && (puntos < 2 || ancho <= 0 || alto <= 0)) {
      return {
        ok: false,
        motivo: 'error',
        mensaje: 'Este servicio exige una firma válida antes de registrar la entrega.',
      };
    }

    const conFirma = servicio.requiereFirma;
    const firmadoEn = new Date().toISOString();
    const id = uid('ent');

    const sello = await sellar([
      id,
      eventoId,
      slotId,
      personId,
      persona.nombre,
      persona.documento,
      firmadoEn,
      // El sello cubre la geometría de la firma, no su imagen.
      trazos.reduce((n, t) => n + t.length, 0),
    ]);

    const delivery: Delivery = {
      id,
      eventId: eventoId,
      slotId,
      personId,
      estado: 'entregado',
      nombreFirmante: persona.nombre,
      documentoFirmante: persona.documento,
      conFirma,
      firmadoEn,
      operador: settings.operador.trim() || 'Sin identificar',
      dispositivo: `${settings.puesto || 'Puesto'} · ${describirDispositivo()}`,
      sello,
      observacion: observacion?.trim() ?? '',
      sync: 'pendiente',
    };

    const firma: SignatureRecord | null = conFirma
      ? { id, eventId: eventoId, trazos, ancho, alto }
      : null;

    try {
      const res = await db.insertDeliveryUnique(delivery, firma);
      if (!res.ok) {
        // Otro puesto ganó la carrera: refrescamos para reflejar su registro.
        const entregas = await db.getByIndex<Delivery>('deliveries', 'eventId', eventoId);
        set({ entregas });
        return { ok: false, motivo: 'duplicado', existente: res.existente as Delivery };
      }
    } catch (err) {
      return {
        ok: false,
        motivo: 'error',
        mensaje: err instanceof Error ? err.message : 'No se pudo guardar la entrega.',
      };
    }

    set({ entregas: [...get().entregas, delivery] });
    void get().refrescarPendientes();
    // La firma sale hacia la nube apenas se confirma. No bloqueamos al
    // operador: si falla, queda pendiente y el motor la reintenta.
    void get().sincronizar({ silencioso: true });
    return { ok: true, delivery };
  },

  async anularEntrega(deliveryId, motivo) {
    const entrega = get().entregas.find((e) => e.id === deliveryId);
    if (!entrega) return;
    const resultado = await anularEntregaEnNube(deliveryId, motivo);
    if (!resultado.ok) throw new Error(resultado.mensaje);

    const anulada: Delivery = {
      ...entrega,
      estado: 'anulado',
      anuladoEn: resultado.fecha,
      anuladoPor: resultado.responsable,
      motivoAnulacion: motivo,
      sync: 'sincronizado',
    };
    await db.put('deliveries', anulada);
    set({ entregas: get().entregas.map((e) => (e.id === deliveryId ? anulada : e)) });
    void get().refrescarPendientes();
  },

  obtenerFirma(deliveryId) {
    return db.get<SignatureRecord>('signatures', deliveryId);
  },

  /* ═══ Dispositivo y UI ══════════════════════════════════════════ */

  setSettings(cambios) {
    const next = { ...get().settings, ...cambios };
    guardarSettings(next);
    set({ settings: next });
  },

  toast(t) {
    const id = uid('t');
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().cerrarToast(id), t.tipo === 'error' ? 6000 : 3200);
  },

  cerrarToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

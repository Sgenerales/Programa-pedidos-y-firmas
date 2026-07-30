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
import { PLANTILLAS_SERVICIO } from '../lib/catalogo';
import { HAY_NUBE } from '../lib/config';
import {
  bajarEntregas,
  cerrarSesion as cerrarSesionNube,
  iniciarSesion as iniciarSesionNube,
  publicarEstructura,
  sesionGuardada,
  subirEntregas,
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
  sincronizar: (opciones?: { silencioso?: boolean }) => Promise<void>;
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
    png: string;
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
    const eventos = await db.getAll<EventRecord>('events');
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
    const { eventoId } = get();
    if (!eventoId) return;
    const entregas = await db.getByIndex<Delivery>('deliveries', 'eventId', eventoId);
    set({
      sync: {
        ...get().sync,
        pendientes: entregas.filter((e) => e.sync === 'pendiente').length,
        conflictos: entregas.filter((e) => e.sync === 'conflicto').length,
      },
    });
  },

  async sincronizar(opciones) {
    const { eventoId, eventos, dias, servicios, slots, personas, sesion, sync } = get();
    if (!HAY_NUBE || !eventoId || !sesion || sync.sincronizando) return;

    const evento = eventos.find((e) => e.id === eventoId);
    if (!evento) return;

    set({ sync: { ...get().sync, sincronizando: true, ultimoError: null } });

    try {
      // La estructura viaja siempre primero: sin turnos ni personas en la
      // nube, las entregas rebotarían por clave foránea y las firmas se
      // quedarían acá. Es idempotente, así que repetirla no cuesta nada.
      const estructura = await publicarEstructura({ evento, dias, servicios, slots, personas });
      if (!estructura.ok) {
        set({
          sync: { ...get().sync, sincronizando: false, ultimoError: estructura.mensaje ?? null },
        });
        if (!opciones?.silencioso) {
          get().toast({ tipo: 'error', titulo: 'No se pudo publicar el evento', detalle: estructura.mensaje });
        }
        return;
      }

      const subida = await subirEntregas(eventoId);
      const bajada = await bajarEntregas(eventoId);
      const error = subida.mensaje ?? bajada.mensaje ?? null;

      if (subida.subidas || bajada.bajadas || subida.conflictos.length) {
        await get().cargarEvento(eventoId);
      }
      await get().refrescarPendientes();

      set({
        sync: {
          ...get().sync,
          sincronizando: false,
          ultimoError: error,
          ultimaOk: error ? get().sync.ultimaOk : new Date().toISOString(),
        },
      });

      if (subida.conflictos.length && !opciones?.silencioso) {
        get().toast({
          tipo: 'error',
          titulo: `${subida.conflictos.length} entrega(s) en conflicto`,
          detalle: 'Otro puesto ya había registrado a esa persona en ese turno.',
        });
      }
      if (error && !opciones?.silencioso) {
        get().toast({ tipo: 'error', titulo: 'No se pudo sincronizar', detalle: error });
      }
    } catch (err) {
      set({
        sync: { ...get().sync, sincronizando: false, ultimoError: err instanceof Error ? err.message : 'Error de red' },
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
    servicios.sort((a, b) => a.orden - b.orden);
    personas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
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
    return nuevo.id;
  },

  async eliminarEvento(id) {
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
    set({ dias: get().dias.map((d) => (d.id === dayId ? actualizado : d)) });
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
    if (get().eventoId === eventId) set({ servicios: [...servicios, servicio] });
    return servicio;
  },

  async actualizarServicio(id, cambios) {
    const actual = get().servicios.find((s) => s.id === id);
    if (!actual) return;
    const actualizado = { ...actual, ...cambios };
    await db.put('services', actualizado);
    set({ servicios: get().servicios.map((s) => (s.id === id ? actualizado : s)) });
  },

  async eliminarServicio(id) {
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
    });
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
    set({ slots: [...get().slots, slot] });
  },

  async actualizarTurno(id, cambios) {
    const actual = get().slots.find((s) => s.id === id);
    if (!actual) return;
    const actualizado = { ...actual, ...cambios };
    await db.put('slots', actualizado);
    set({ slots: get().slots.map((s) => (s.id === id ? actualizado : s)) });
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
      activo: true,
      origen: 'importado',
      creadoEn: ahora,
    }));
    await db.putMany('people', nuevas);
    if (get().eventoId === eventId) {
      const todas = [...get().personas, ...nuevas].sort((a, b) =>
        a.nombre.localeCompare(b.nombre, 'es'),
      );
      set({ personas: todas });
    }
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
      activo: true,
      origen: base.origen ?? 'manual',
      creadoEn: new Date().toISOString(),
    };
    if (!persona.nombre) throw new Error('El nombre es obligatorio.');
    await db.put('people', persona);
    if (get().eventoId === eventId) {
      set({
        personas: [...get().personas, persona].sort((a, b) =>
          a.nombre.localeCompare(b.nombre, 'es'),
        ),
      });
    }
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
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    });
  },

  async eliminarPersona(id) {
    const conEntregas = get().entregas.some((e) => e.personId === id);
    if (conEntregas) {
      throw new Error('Esta persona tiene entregas firmadas. Desactivala en vez de eliminarla.');
    }
    await db.remove('people', id);
    set({ personas: get().personas.filter((p) => p.id !== id) });
  },

  async vaciarPadron(eventId) {
    if (get().entregas.length) {
      throw new Error('El evento ya tiene entregas registradas: el padrón no puede vaciarse.');
    }
    const personas = await db.getByIndex<Person>('people', 'eventId', eventId);
    await db.removeMany('people', personas.map((p) => p.id));
    if (get().eventoId === eventId) set({ personas: [] });
  },

  /* ═══ Operación ═════════════════════════════════════════════════ */

  async registrarEntrega({ personId, slotId, trazos, png, ancho, alto, observacion }) {
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

    const servicio = get().servicios.find((s) => s.id === slot.serviceId);
    if (!servicio || servicio.eventId !== eventoId) {
      return { ok: false, motivo: 'error', mensaje: 'El servicio del turno no existe.' };
    }
    if (!persona.activo) {
      return { ok: false, motivo: 'error', mensaje: 'La persona está desactivada en el padrón.' };
    }
    if (
      slot.gruposHabilitados.length &&
      !slot.gruposHabilitados.includes(persona.grupo)
    ) {
      return { ok: false, motivo: 'error', mensaje: 'La persona no está habilitada para este turno.' };
    }

    const tieneTrazo = trazos.some((trazo) => trazo.length > 0);
    if (
      servicio.requiereFirma &&
      (!tieneTrazo ||
        !png.startsWith('data:image/png') ||
        png.length < 100 ||
        ancho <= 0 ||
        alto <= 0)
    ) {
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
      png.length,
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
      ? { id, eventId: eventoId, png, trazos, ancho, alto }
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
    const anulada: Delivery = {
      ...entrega,
      estado: 'anulado',
      anuladoEn: new Date().toISOString(),
      anuladoPor: get().settings.operador.trim() || 'Sin identificar',
      motivoAnulacion: motivo,
      sync: 'pendiente',
    };
    await db.put('deliveries', anulada);
    set({ entregas: get().entregas.map((e) => (e.id === deliveryId ? anulada : e)) });
    void get().refrescarPendientes();
    void get().sincronizar({ silencioso: true });
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

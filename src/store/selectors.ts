import { hora, matchTerms, norm } from '../lib/util';
import type {
  Delivery,
  EventDay,
  JornadaMark,
  Person,
  PersonRow,
  Service,
  Slot,
} from '../types';

/** Índice de búsqueda precalculado por persona. */
export interface IndicePersona {
  person: Person;
  buscable: string;
}

export function construirIndice(personas: Person[]): IndicePersona[] {
  return personas.map((p) => ({
    person: p,
    buscable: norm([p.nombre, p.documento, p.empresa, p.grupo, p.referencia].join(' ')),
  }));
}

export function buscar(indice: IndicePersona[], consulta: string): Person[] {
  const terms = norm(consulta).split(' ').filter(Boolean);
  if (!terms.length) return indice.map((i) => i.person);
  return indice.filter((i) => matchTerms(i.buscable, terms)).map((i) => i.person);
}

/** Orden operativo del padrón: procedencia → rol → nombre. */
export function compararPersonas(a: Person, b: Person): number {
  return (
    a.empresa.localeCompare(b.empresa, 'es', { sensitivity: 'base' }) ||
    a.grupo.localeCompare(b.grupo, 'es', { sensitivity: 'base' }) ||
    a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
  );
}

/** Registros anteriores y altas manuales sin restricción asisten todos los días. */
export function asisteEnDia(persona: Person, dayId: string): boolean {
  return !Array.isArray(persona.diasHabilitados) || persona.diasHabilitados.includes(dayId);
}

/** ¿Esta persona está habilitada para este turno según asistencia y grupo? */
export function habilitadaEnTurno(persona: Person, slot: Slot): boolean {
  if (!persona.activo) return false;
  if (!asisteEnDia(persona, slot.dayId)) return false;
  if (!slot.gruposHabilitados.length) return true;
  return slot.gruposHabilitados.includes(persona.grupo);
}

/**
 * Arma las filas del kiosko: estado frente al turno activo + la tira de
 * la jornada (qué otros servicios de ese día ya recibió la persona).
 */
export function filasKiosko(args: {
  personas: Person[];
  entregas: Delivery[];
  slots: Slot[];
  servicios: Service[];
  slotActivo: Slot;
}): PersonRow[] {
  const { personas, entregas, slots, servicios, slotActivo } = args;

  const porSlotPersona = new Map<string, Delivery>();
  for (const e of entregas) {
    if (e.estado === 'anulado') continue;
    porSlotPersona.set(`${e.slotId}|${e.personId}`, e);
  }

  const servicioPorId = new Map(servicios.map((s) => [s.id, s]));
  const slotsDelDia = slots
    .filter((s) => s.dayId === slotActivo.dayId)
    .sort(
      (a, b) =>
        (servicioPorId.get(a.serviceId)?.orden ?? 0) - (servicioPorId.get(b.serviceId)?.orden ?? 0),
    );

  return personas.map((person) => {
    const entrega = porSlotPersona.get(`${slotActivo.id}|${person.id}`) ?? null;
    const jornada: JornadaMark[] = slotsDelDia.map((s) => {
      const srv = servicioPorId.get(s.serviceId);
      const d = porSlotPersona.get(`${s.id}|${person.id}`) ?? null;
      return {
        slotId: s.id,
        serviceNombre: srv?.nombre ?? '—',
        serviceIcono: srv?.icono ?? 'caja',
        serviceColor: srv?.color ?? '#8FA8B8',
        entregado: Boolean(d),
        hora: d ? hora(d.firmadoEn) : null,
      };
    });
    return { person, entrega, habilitada: habilitadaEnTurno(person, slotActivo), jornada };
  });
}

export interface ResumenTurno {
  total: number;
  entregados: number;
  pendientes: number;
}

export function resumenTurno(
  personas: Person[],
  entregas: Delivery[],
  slot: Slot,
): ResumenTurno {
  const habilitadas = personas.filter((p) => habilitadaEnTurno(p, slot));
  const entregados = entregas.filter(
    (e) => e.slotId === slot.id && e.estado === 'entregado',
  ).length;
  return {
    total: habilitadas.length,
    entregados,
    pendientes: Math.max(0, habilitadas.length - entregados),
  };
}

export interface CeldaMatriz {
  slot: Slot | null;
  entregados: number;
  total: number;
}

/** Matriz día × servicio con cobertura, para la vista de reportes. */
export function matrizCobertura(args: {
  dias: EventDay[];
  servicios: Service[];
  slots: Slot[];
  personas: Person[];
  entregas: Delivery[];
}): CeldaMatriz[][] {
  const { dias, servicios, slots, personas, entregas } = args;
  const activas = entregas.filter((e) => e.estado === 'entregado');
  return dias.map((d) =>
    servicios.map((srv) => {
      const slot = slots.find((s) => s.dayId === d.id && s.serviceId === srv.id) ?? null;
      if (!slot) return { slot: null, entregados: 0, total: 0 };
      return {
        slot,
        entregados: activas.filter((e) => e.slotId === slot.id).length,
        total: personas.filter((p) => habilitadaEnTurno(p, slot)).length,
      };
    }),
  );
}

/** Grupos únicos presentes en el padrón, ordenados. */
export function gruposDelPadron(personas: Person[]): string[] {
  return [...new Set(personas.map((p) => p.grupo).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  );
}

export function etiquetaTurno(
  slot: Slot,
  dias: EventDay[],
  servicios: Service[],
): { dia: string; servicio: string; fecha: string; color: string; icono: string } {
  const d = dias.find((x) => x.id === slot.dayId);
  const s = servicios.find((x) => x.id === slot.serviceId);
  return {
    dia: d?.etiqueta ?? 'Día',
    fecha: d?.fecha ?? '',
    servicio: s?.nombre ?? 'Servicio',
    color: s?.color ?? '#8FA8B8',
    icono: s?.icono ?? 'caja',
  };
}

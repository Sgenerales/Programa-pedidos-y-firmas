import type { EventDay, EventRecord, Slot } from '../types';

/* ═══════════════════════════════════════════════════════════════════
   Ventana de actividad
   ───────────────────────────────────────────────────────────────────
   Un evento no se opera las 24 horas, pero la aplicación consultaba el
   servidor igual. Acá se decide cuándo tiene sentido sincronizar.

   La regla va de lo específico a lo general:
     1. Evento cerrado          → dormido siempre.
     2. Hoy no es día de evento → dormido.
     3. Hay horarios de turno   → despierto en esa franja, con margen.
     4. Sin horarios definidos  → jornada por defecto (07:00 a 23:59).

   Nada de esto retiene una firma: si quedan entregas sin subir, el motor
   sincroniza igual. Dormir solo evita *preguntar*, nunca guardar.
   ═══════════════════════════════════════════════════════════════════ */

/** Franja por defecto cuando el evento no define horarios de servicio. */
export const JORNADA_POR_DEFECTO = { desde: 7 * 60, hasta: 23 * 60 + 59 };

/**
 * Holgura alrededor de cada servicio. El personal llega antes de que
 * empiece el almuerzo y termina de registrar después de la hora de
 * cierre; sin margen, la app dormiría justo cuando se la necesita.
 */
export const MARGEN_MINUTOS = 45;

export type MotivoInactividad =
  | 'activo'
  | 'evento-cerrado'
  | 'fuera-de-fechas'
  | 'fuera-de-horario';

export interface EstadoActividad {
  activo: boolean;
  motivo: MotivoInactividad;
  /** Franja de hoy en formato "HH:MM", si hoy es día de evento. */
  ventana: { desde: string; hasta: string } | null;
  /** Cuándo vuelve a despertar. Null si no hay próxima apertura. */
  proximaApertura: Date | null;
}

export function estadoActividad(args: {
  evento: EventRecord | null;
  dias: EventDay[];
  slots: Slot[];
  ahora?: Date;
}): EstadoActividad {
  const { evento, dias, slots } = args;
  const ahora = args.ahora ?? new Date();

  if (!evento) {
    return { activo: false, motivo: 'fuera-de-fechas', ventana: null, proximaApertura: null };
  }
  if (evento.estado === 'cerrado') {
    return { activo: false, motivo: 'evento-cerrado', ventana: null, proximaApertura: null };
  }

  const hoy = fechaLocal(ahora);
  const diaDeHoy = dias.find((d) => d.fecha === hoy);

  if (!diaDeHoy) {
    return {
      activo: false,
      motivo: 'fuera-de-fechas',
      ventana: null,
      proximaApertura: proximaAperturaDesde(ahora, dias, slots),
    };
  }

  const ventana = ventanaDelDia(diaDeHoy, slots);
  const minutos = ahora.getHours() * 60 + ahora.getMinutes();
  const activo = minutos >= ventana.desde && minutos <= ventana.hasta;

  return {
    activo,
    motivo: activo ? 'activo' : 'fuera-de-horario',
    ventana: { desde: aHHMM(ventana.desde), hasta: aHHMM(ventana.hasta) },
    proximaApertura: activo ? null : proximaAperturaDesde(ahora, dias, slots),
  };
}

/**
 * Franja operativa de una jornada: desde el primer servicio hasta el
 * último, con margen. Si algún turno del día no tiene horario cargado no
 * se puede acotar nada, así que se usa la jornada por defecto.
 */
export function ventanaDelDia(dia: EventDay, slots: Slot[]): { desde: number; hasta: number } {
  const delDia = slots.filter((s) => s.dayId === dia.id);
  if (!delDia.length) return { ...JORNADA_POR_DEFECTO };

  let desde = Infinity;
  let hasta = -Infinity;

  for (const slot of delDia) {
    const inicio = aMinutos(slot.horaDesde);
    const fin = aMinutos(slot.horaHasta);
    // Un turno sin horario podría ocurrir en cualquier momento.
    if (inicio === null || fin === null) return { ...JORNADA_POR_DEFECTO };
    desde = Math.min(desde, inicio);
    hasta = Math.max(hasta, fin);
  }

  return {
    desde: Math.max(0, desde - MARGEN_MINUTOS),
    // Nunca más allá del final del día: el corte nocturno manda.
    hasta: Math.min(23 * 60 + 59, hasta + MARGEN_MINUTOS),
  };
}

/** Próxima jornada en la que el evento vuelve a estar activo. */
function proximaAperturaDesde(ahora: Date, dias: EventDay[], slots: Slot[]): Date | null {
  const hoy = fechaLocal(ahora);
  const minutos = ahora.getHours() * 60 + ahora.getMinutes();

  const futuros = [...dias]
    .filter((d) => d.fecha >= hoy)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  for (const dia of futuros) {
    const ventana = ventanaDelDia(dia, slots);
    if (dia.fecha === hoy && minutos >= ventana.desde) continue;
    return fechaConMinutos(dia.fecha, ventana.desde);
  }
  return null;
}

/* ─── Auxiliares ─────────────────────────────────────────────────── */

function aMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function aHHMM(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Fecha local en ISO corto, sin corrimiento por zona horaria. */
function fechaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function fechaConMinutos(fechaISO: string, minutos: number): Date {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minutos / 60), minutos % 60, 0, 0);
}

/** Texto para la interfaz: por qué está dormido y hasta cuándo. */
export function describirActividad(estado: EstadoActividad): string {
  if (estado.activo) return 'Sincronizando';
  const cuando = estado.proximaApertura;
  const reanuda = cuando
    ? ` Se reanuda ${formatoReanudacion(cuando)}.`
    : '';
  switch (estado.motivo) {
    case 'evento-cerrado':
      return 'El evento está cerrado: no se envían ni reciben cambios.';
    case 'fuera-de-fechas':
      return `Hoy no hay jornada de este evento.${reanuda}`;
    default:
      return `Fuera del horario de servicio.${reanuda}`;
  }
}

function formatoReanudacion(d: Date): string {
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const hoy = fechaLocal(new Date());
  if (fechaLocal(d) === hoy) return `hoy a las ${hora}`;
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  if (fechaLocal(d) === fechaLocal(manana)) return `mañana a las ${hora}`;
  return `el ${d.getDate()}/${d.getMonth() + 1} a las ${hora}`;
}

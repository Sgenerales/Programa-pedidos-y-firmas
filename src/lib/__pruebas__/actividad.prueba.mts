/* Ventana de actividad: reglas horarias del sueño automático.
   Ejecutar con:  npx tsx src/lib/__pruebas__/actividad.prueba.mts
 */
import { estadoActividad, ventanaDelDia } from '../actividad.ts';
import type { EventDay, EventRecord, Slot } from '../../types.ts';

const evento = (estado: string): EventRecord =>
  ({ id: 'ev', nombre: 'E', organizador: '', lugar: '', fechaInicio: '2026-08-10',
     fechaFin: '2026-08-12', estado, requiereDocumento: false, permiteWalkIn: true,
     notas: '', creadoEn: '', actualizadoEn: '' }) as EventRecord;

const dias: EventDay[] = [
  { id: 'd1', eventId: 'ev', fecha: '2026-08-10', etiqueta: 'Día 1', orden: 0 },
  { id: 'd2', eventId: 'ev', fecha: '2026-08-11', etiqueta: 'Día 2', orden: 1 },
];
const slot = (id: string, dayId: string, desde: string, hasta: string): Slot =>
  ({ id, eventId: 'ev', dayId, serviceId: 's', horaDesde: desde, horaHasta: hasta,
     gruposHabilitados: [] }) as Slot;

const conHorarios = [
  slot('a', 'd1', '08:00', '10:00'),   // desayuno
  slot('b', 'd1', '12:00', '14:00'),   // almuerzo
  slot('c', 'd2', '08:00', '10:00'),
];
const sinHorarios = [slot('a', 'd1', '', ''), slot('b', 'd1', '12:00', '14:00')];

const en = (f: string, h: number, m = 0) => {
  const [y, mo, d] = f.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m);
};

let fallos = 0;
const chequear = (nombre: string, real: unknown, esperado: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FALLA'}  ${nombre}${ok ? '' : `  -> ${JSON.stringify(real)} != ${JSON.stringify(esperado)}`}`);
};

// Ventana derivada de los servicios: 08:00-14:00 con 45 min de margen
chequear('ventana con horarios = 07:15 a 14:45',
  ventanaDelDia(dias[0], conHorarios), { desde: 7 * 60 + 15, hasta: 14 * 60 + 45 });

// Un turno sin horario impide acotar: jornada por defecto
chequear('un turno sin hora -> jornada por defecto',
  ventanaDelDia(dias[0], sinHorarios), { desde: 7 * 60, hasta: 23 * 60 + 59 });

const act = (ahora: Date, e = evento('activo'), slots = conHorarios) =>
  estadoActividad({ evento: e, dias, slots, ahora });

chequear('03:00 madrugada -> dormido', act(en('2026-08-10', 3)).activo, false);
chequear('07:00 antes del margen -> dormido', act(en('2026-08-10', 7, 0)).activo, false);
chequear('07:20 dentro del margen -> despierto', act(en('2026-08-10', 7, 20)).activo, true);
chequear('09:00 en pleno desayuno -> despierto', act(en('2026-08-10', 9)).activo, true);
chequear('11:00 entre servicios -> despierto', act(en('2026-08-10', 11)).activo, true);
chequear('14:44 margen final -> despierto', act(en('2026-08-10', 14, 44)).activo, true);
chequear('15:00 pasado el margen -> dormido', act(en('2026-08-10', 15)).activo, false);
chequear('23:59 -> dormido', act(en('2026-08-10', 23, 59)).activo, false);

// Sin horarios cargados rige la regla nocturna pedida: 07:00 a 23:59
chequear('sin horarios, 06:59 -> dormido', act(en('2026-08-10', 6, 59), evento('activo'), sinHorarios).activo, false);
chequear('sin horarios, 07:00 -> despierto', act(en('2026-08-10', 7, 0), evento('activo'), sinHorarios).activo, true);
chequear('sin horarios, 23:59 -> despierto', act(en('2026-08-10', 23, 59), evento('activo'), sinHorarios).activo, true);
chequear('sin horarios, 00:30 -> dormido', act(en('2026-08-10', 0, 30), evento('activo'), sinHorarios).activo, false);

// Reglas de mayor jerarquia
chequear('evento cerrado -> dormido en pleno almuerzo',
  act(en('2026-08-10', 13), evento('cerrado')).activo, false);
chequear('dia sin jornada -> dormido', act(en('2026-08-15', 13)).activo, false);
chequear('motivo fuera de fechas', act(en('2026-08-15', 13)).motivo, 'fuera-de-fechas');

// Cuando vuelve a despertar
const nocturno = act(en('2026-08-10', 23, 0));
chequear('a las 23:00 reanuda 2026-08-11 07:15',
  nocturno.proximaApertura?.toISOString().slice(0, 10) + ' ' +
  String(nocturno.proximaApertura?.getHours()).padStart(2, '0') + ':' +
  String(nocturno.proximaApertura?.getMinutes()).padStart(2, '0'),
  '2026-08-11 07:15');

console.log(fallos ? `\n${fallos} FALLAS` : '\nTodas las pruebas pasaron');
process.exit(fallos ? 1 : 0);

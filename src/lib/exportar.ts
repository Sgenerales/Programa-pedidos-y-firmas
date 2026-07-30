import { fechaCorta, hora, slugArchivo } from './util';
import type { Delivery, EventDay, EventRecord, Person, Service, Slot } from '../types';

/* SheetJS se carga bajo demanda: ver nota en lib/importar.ts.
   El import de tipos se borra en compilación, no arrastra el módulo. */
import type { WorkBook, WorkSheet } from 'xlsx';
type XLSXMod = typeof import('xlsx');
const cargarXLSX = () => import('xlsx');

interface Datos {
  evento: EventRecord;
  dias: EventDay[];
  servicios: Service[];
  slots: Slot[];
  personas: Person[];
  entregas: Delivery[];
}

const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function libroABlob(X: XLSXMod, wb: WorkBook): Blob {
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: MIME_XLSX });
}

function anchos(ws: WorkSheet, widths: number[]): void {
  ws['!cols'] = widths.map((wch) => ({ wch }));
}

/**
 * Reporte completo en un solo archivo con cuatro hojas:
 * Resumen · Matriz por persona · Detalle de entregas · Faltantes.
 */
export async function reporteCompleto(d: Datos): Promise<{ blob: Blob; nombre: string }> {
  const X = await cargarXLSX();
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, hojaResumen(X, d), 'Resumen');
  X.utils.book_append_sheet(wb, hojaMatriz(X, d), 'Matriz por persona');
  X.utils.book_append_sheet(wb, hojaDetalle(X, d), 'Detalle de entregas');
  X.utils.book_append_sheet(wb, hojaFaltantes(X, d), 'Pendientes');
  return {
    blob: libroABlob(X, wb),
    nombre: `acta-${slugArchivo(d.evento.nombre)}-${new Date().toISOString().slice(0, 10)}.xlsx`,
  };
}

function ordenarSlots(d: Datos): Slot[] {
  const orden = new Map(d.dias.map((x, i) => [x.id, i]));
  const ordenSrv = new Map(d.servicios.map((x, i) => [x.id, i]));
  return [...d.slots].sort(
    (a, b) =>
      (orden.get(a.dayId) ?? 0) - (orden.get(b.dayId) ?? 0) ||
      (ordenSrv.get(a.serviceId) ?? 0) - (ordenSrv.get(b.serviceId) ?? 0),
  );
}

function tituloSlot(d: Datos, slot: Slot): string {
  const dia = d.dias.find((x) => x.id === slot.dayId);
  const srv = d.servicios.find((x) => x.id === slot.serviceId);
  return `${dia ? fechaCorta(dia.fecha) : '—'} · ${srv?.nombre ?? '—'}`;
}

function hojaResumen(X: XLSXMod, d: Datos): WorkSheet {
  const activas = d.entregas.filter((e) => e.estado === 'entregado');
  const filas: (string | number)[][] = [
    ['ACTA · CONTROL DE ENTREGAS'],
    [],
    ['Evento', d.evento.nombre],
    ['Organizador', d.evento.organizador || '—'],
    ['Lugar', d.evento.lugar || '—'],
    ['Período', `${fechaCorta(d.evento.fechaInicio)} — ${fechaCorta(d.evento.fechaFin)}`],
    ['Personas en padrón', d.personas.filter((p) => p.activo).length],
    ['Turnos configurados', d.slots.length],
    ['Entregas registradas', activas.length],
    ['Entregas anuladas', d.entregas.length - activas.length],
    ['Reporte generado', new Date().toLocaleString('es')],
    [],
    ['TURNO', 'HABILITADOS', 'ENTREGADOS', 'PENDIENTES', '% COBERTURA'],
  ];

  for (const slot of ordenarSlots(d)) {
    const habilitados = d.personas.filter(
      (p) =>
        p.activo &&
        (!slot.gruposHabilitados.length || slot.gruposHabilitados.includes(p.grupo)),
    ).length;
    const entregados = activas.filter((e) => e.slotId === slot.id).length;
    filas.push([
      tituloSlot(d, slot),
      habilitados,
      entregados,
      Math.max(0, habilitados - entregados),
      habilitados ? Math.round((entregados / habilitados) * 100) / 100 : 0,
    ]);
  }

  const ws = X.utils.aoa_to_sheet(filas);
  anchos(ws, [34, 14, 13, 13, 14]);
  return ws;
}

/** Una fila por persona, una columna por turno con la hora de entrega. */
function hojaMatriz(X: XLSXMod, d: Datos): WorkSheet {
  const slots = ordenarSlots(d);
  const activas = d.entregas.filter((e) => e.estado === 'entregado');
  const idx = new Map(activas.map((e) => [`${e.slotId}|${e.personId}`, e]));

  const cabecera = ['Nombre', 'Documento', 'Empresa', 'Grupo', 'Referencia'];
  for (const s of slots) cabecera.push(tituloSlot(d, s));
  cabecera.push('Total recibidas');

  const filas: (string | number)[][] = [cabecera];
  for (const p of d.personas) {
    const fila: (string | number)[] = [
      p.nombre,
      p.documento,
      p.empresa,
      p.grupo,
      p.referencia,
    ];
    let total = 0;
    for (const s of slots) {
      const e = idx.get(`${s.id}|${p.id}`);
      if (e) total++;
      fila.push(e ? hora(e.firmadoEn) : '—');
    }
    fila.push(total);
    filas.push(fila);
  }

  const ws = X.utils.aoa_to_sheet(filas);
  anchos(ws, [30, 14, 22, 16, 20, ...slots.map(() => 16), 15]);
  ws['!freeze'] = { xSplit: 1, ySplit: 1 };
  return ws;
}

/** Una fila por entrega firmada: es el respaldo auditable. */
function hojaDetalle(X: XLSXMod, d: Datos): WorkSheet {
  const filas: (string | number)[][] = [
    [
      'Fecha',
      'Hora',
      'Día',
      'Servicio',
      'Nombre firmante',
      'Documento',
      'Empresa',
      'Grupo',
      'Estado',
      'Firma',
      'Operador',
      'Dispositivo',
      'Sello',
      'Observación',
      'Motivo anulación',
    ],
  ];

  const porFecha = [...d.entregas].sort((a, b) => a.firmadoEn.localeCompare(b.firmadoEn));
  for (const e of porFecha) {
    const slot = d.slots.find((s) => s.id === e.slotId);
    const dia = slot ? d.dias.find((x) => x.id === slot.dayId) : undefined;
    const srv = slot ? d.servicios.find((x) => x.id === slot.serviceId) : undefined;
    const p = d.personas.find((x) => x.id === e.personId);
    const f = new Date(e.firmadoEn);
    filas.push([
      f.toLocaleDateString('es'),
      hora(e.firmadoEn),
      dia?.etiqueta ?? '—',
      srv?.nombre ?? '—',
      e.nombreFirmante,
      e.documentoFirmante,
      p?.empresa ?? '',
      p?.grupo ?? '',
      e.estado === 'entregado' ? 'Entregado' : 'ANULADO',
      e.conFirma ? 'Sí' : 'No requerida',
      e.operador,
      e.dispositivo,
      e.sello,
      e.observacion,
      e.motivoAnulacion ?? '',
    ]);
  }

  const ws = X.utils.aoa_to_sheet(filas);
  anchos(ws, [12, 8, 14, 16, 30, 14, 22, 16, 12, 13, 18, 28, 16, 28, 24]);
  return ws;
}

/** Quién quedó sin recibir, turno por turno. */
function hojaFaltantes(X: XLSXMod, d: Datos): WorkSheet {
  const activas = d.entregas.filter((e) => e.estado === 'entregado');
  const idx = new Set(activas.map((e) => `${e.slotId}|${e.personId}`));
  const filas: string[][] = [['Turno', 'Nombre', 'Documento', 'Empresa', 'Grupo', 'Referencia']];

  for (const slot of ordenarSlots(d)) {
    for (const p of d.personas) {
      if (!p.activo) continue;
      if (slot.gruposHabilitados.length && !slot.gruposHabilitados.includes(p.grupo)) continue;
      if (idx.has(`${slot.id}|${p.id}`)) continue;
      filas.push([tituloSlot(d, slot), p.nombre, p.documento, p.empresa, p.grupo, p.referencia]);
    }
  }

  const ws = X.utils.aoa_to_sheet(filas);
  anchos(ws, [28, 30, 14, 22, 16, 20]);
  return ws;
}

/** Export del padrón tal como está cargado. */
export async function exportarPadron(
  evento: EventRecord,
  personas: Person[],
  dias: EventDay[] = [],
): Promise<{ blob: Blob; nombre: string }> {
  const X = await cargarXLSX();

  // Una columna por jornada con la asistencia declarada. `null` significa
  // que la persona asiste a todas, que es el caso de los padrones sin
  // columnas de fecha y de las altas manuales en piso.
  const cabecera = [
    'Nombre completo',
    'Documento',
    'Empresa',
    'Grupo',
    'Referencia',
    'Teléfono',
    'Estado',
    'Origen',
    ...dias.map((d) => `${d.etiqueta} · ${fechaCorta(d.fecha)}`),
  ];

  const filas: string[][] = [
    cabecera,
    ...personas.map((p) => [
      p.nombre,
      p.documento,
      p.empresa,
      p.grupo,
      p.referencia,
      p.telefono,
      p.activo ? 'Activo' : 'Inactivo',
      p.origen === 'manual' ? 'Alta manual' : 'Importado',
      ...dias.map((d) =>
        !Array.isArray(p.diasHabilitados) || p.diasHabilitados.includes(d.id) ? 'Sí' : '—',
      ),
    ]),
  ];
  const ws = X.utils.aoa_to_sheet(filas);
  anchos(ws, [30, 14, 22, 16, 20, 16, 10, 13, ...dias.map(() => 14)]);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Padrón');
  return { blob: libroABlob(X, wb), nombre: `padron-${slugArchivo(evento.nombre)}.xlsx` };
}

/** Copia de seguridad completa del evento, firmas incluidas. */
export function respaldoJSON(d: Datos, firmas: unknown[]): { blob: Blob; nombre: string } {
  const payload = {
    formato: 'acta-entregas/v1',
    exportadoEn: new Date().toISOString(),
    ...d,
    firmas,
  };
  return {
    blob: new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    nombre: `respaldo-${slugArchivo(d.evento.nombre)}-${new Date().toISOString().slice(0, 10)}.json`,
  };
}

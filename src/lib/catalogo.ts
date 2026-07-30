/* Catálogo de servicios sugeridos al armar un evento.
   Son plantillas: el usuario puede editarlas o crear las propias. */

import type { Service } from '../types';

export interface PlantillaServicio {
  nombre: string;
  icono: string;
  color: string;
  horaDesde: string;
  horaHasta: string;
  requiereFirma: boolean;
}

export const PLANTILLAS_SERVICIO: PlantillaServicio[] = [
  { nombre: 'Desayuno', icono: 'cafe', color: '#E0A458', horaDesde: '07:00', horaHasta: '09:30', requiereFirma: true },
  { nombre: 'Coffee break', icono: 'taza', color: '#C98F6B', horaDesde: '10:30', horaHasta: '11:00', requiereFirma: false },
  { nombre: 'Almuerzo', icono: 'plato', color: '#5FB98B', horaDesde: '12:00', horaHasta: '14:30', requiereFirma: true },
  { nombre: 'Merienda', icono: 'taza', color: '#7FA9E8', horaDesde: '16:00', horaHasta: '17:00', requiereFirma: false },
  { nombre: 'Cena', icono: 'luna', color: '#A78BE8', horaDesde: '19:30', horaHasta: '22:00', requiereFirma: true },
  { nombre: 'Vianda', icono: 'caja', color: '#68B0C4', horaDesde: '', horaHasta: '', requiereFirma: true },
  { nombre: 'Kit / Amenities', icono: 'caja', color: '#D98E8E', horaDesde: '', horaHasta: '', requiereFirma: true },
  { nombre: 'Credencial', icono: 'credencial', color: '#B8B0A0', horaDesde: '', horaHasta: '', requiereFirma: true },
  { nombre: 'Transporte', icono: 'transporte', color: '#8FA8B8', horaDesde: '', horaHasta: '', requiereFirma: true },
  { nombre: 'Material de trabajo', icono: 'carpeta', color: '#C4A86A', horaDesde: '', horaHasta: '', requiereFirma: true },
];

const claveServicio = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es');

const ORDEN_OPERATIVO = new Map(
  PLANTILLAS_SERVICIO.map((servicio, indice) => [claveServicio(servicio.nombre), indice]),
);

/**
 * Orden cronológico estable para toda la operación.
 * Los servicios estándar no dependen del orden en que fueron creados o descargados;
 * los personalizados conservan su orden configurado después del catálogo.
 */
export function compararServiciosOperativos(
  a: Pick<Service, 'id' | 'nombre' | 'orden'>,
  b: Pick<Service, 'id' | 'nombre' | 'orden'>,
): number {
  const ordenA = ORDEN_OPERATIVO.get(claveServicio(a.nombre));
  const ordenB = ORDEN_OPERATIVO.get(claveServicio(b.nombre));
  const prioridadA = ordenA ?? PLANTILLAS_SERVICIO.length + a.orden;
  const prioridadB = ordenB ?? PLANTILLAS_SERVICIO.length + b.orden;

  return (
    prioridadA - prioridadB ||
    a.orden - b.orden ||
    a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  );
}

/** Paleta de acentos disponible para servicios propios. */
export const COLORES_SERVICIO = [
  '#E0A458',
  '#5FB98B',
  '#A78BE8',
  '#7FA9E8',
  '#D98E8E',
  '#68B0C4',
  '#C98F6B',
  '#B8B0A0',
  '#C4A86A',
  '#8FA8B8',
];

export const ICONOS_SERVICIO = [
  'cafe',
  'taza',
  'plato',
  'luna',
  'caja',
  'credencial',
  'transporte',
  'carpeta',
  'bolsa',
  'copa',
];

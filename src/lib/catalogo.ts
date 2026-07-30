/* Catálogo de servicios sugeridos al armar un evento.
   Son plantillas: el usuario puede editarlas o crear las propias. */

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

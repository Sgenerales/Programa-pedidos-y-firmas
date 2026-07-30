/* ═══════════════════════════════════════════════════════════════════
   ACTA · Modelo de dominio
   ───────────────────────────────────────────────────────────────────
   Evento → Días × Servicios = Turnos.  Persona × Turno = Entrega.
   Una Entrega es el hecho jurídico: quién recibió qué, cuándo, con
   qué firma y bajo qué operador. Es inmutable salvo anulación.
   ═══════════════════════════════════════════════════════════════════ */

/** Estado de vida de un evento. */
export type EventStatus = 'borrador' | 'activo' | 'cerrado';

export interface EventRecord {
  id: string;
  nombre: string;
  /** Cliente / organizador. Aparece en el encabezado del acta. */
  organizador: string;
  lugar: string;
  /** ISO date (YYYY-MM-DD) */
  fechaInicio: string;
  fechaFin: string;
  estado: EventStatus;
  /** Exigir documento coincidente antes de habilitar la firma. */
  requiereDocumento: boolean;
  /** Permitir dar de alta personas no listadas durante la operación. */
  permiteWalkIn: boolean;
  notas: string;
  creadoEn: string;
  actualizadoEn: string;
}

/** Una jornada del evento. Se autogenera del rango pero es editable. */
export interface EventDay {
  id: string;
  eventId: string;
  /** ISO date YYYY-MM-DD */
  fecha: string;
  /** "Día 1", "Jornada de apertura", etc. */
  etiqueta: string;
  orden: number;
}

/** Un tipo de entregable del evento: Desayuno, Almuerzo, Kit, Credencial… */
export interface Service {
  id: string;
  eventId: string;
  nombre: string;
  /** Clave del set de íconos (ver components/Icon.tsx) */
  icono: string;
  /** Color de acento del servicio, en formato hex. */
  color: string;
  /** Si false, la entrega se confirma con un toque, sin firma. */
  requiereFirma: boolean;
  orden: number;
}

/**
 * Turno = intersección Día × Servicio que efectivamente ocurre.
 * Si no existe el Slot, ese servicio no se presta ese día.
 * Esto es lo que hace al sistema adaptable por evento.
 */
export interface Slot {
  id: string;
  eventId: string;
  dayId: string;
  serviceId: string;
  /** "07:30" — informativo, para el encabezado del kiosko. */
  horaDesde: string;
  horaHasta: string;
  /** Vacío = habilitado para todos los grupos. */
  gruposHabilitados: string[];
}

export interface Person {
  id: string;
  eventId: string;
  /** Nombre tal como debe figurar en el acta. Fuente de verdad. */
  nombre: string;
  documento: string;
  empresa: string;
  /** Segmento: "Staff", "Invitado", "Prensa", "Torre A"… */
  grupo: string;
  referencia: string;
  telefono: string;
  activo: boolean;
  /** Origen: importado de planilla o alta manual en piso. */
  origen: 'importado' | 'manual';
  creadoEn: string;
}

export type DeliveryStatus = 'entregado' | 'anulado';

export interface Delivery {
  id: string;
  eventId: string;
  slotId: string;
  personId: string;
  estado: DeliveryStatus;

  /* — Identidad congelada al momento de firmar — */
  nombreFirmante: string;
  documentoFirmante: string;

  /* — Evidencia — */
  /** true si el servicio exigía firma y se capturó trazo. */
  conFirma: boolean;
  firmadoEn: string;
  operador: string;
  dispositivo: string;
  /** SHA-256 de los campos probatorios. Sello de verificación. */
  sello: string;

  observacion: string;
  anuladoEn?: string;
  anuladoPor?: string;
  motivoAnulacion?: string;

  /** Estado frente a la nube. 'conflicto' = otro puesto la registró antes. */
  sync: 'pendiente' | 'sincronizado' | 'conflicto';
}

/** Firma guardada aparte para no inflar los listados de entregas. */
export interface SignatureRecord {
  /** Mismo id que la Delivery. */
  id: string;
  eventId: string;
  /** PNG en dataURL, fondo transparente. */
  png: string;
  /** Trazos vectoriales para re-render nítido en reportes impresos. */
  trazos: Stroke[];
  /** Dimensiones del lienzo original (px CSS). */
  ancho: number;
  alto: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  /** Ancho del trazo en ese punto, derivado de la velocidad. */
  w: number;
}

export type Stroke = StrokePoint[];

/* ─── Configuración local del dispositivo ────────────────────────── */

export interface DeviceSettings {
  /** Nombre del operador que atiende el puesto. Va en cada acta. */
  operador: string;
  /** Etiqueta del puesto: "Puesto 1 · Lobby". */
  puesto: string;
  eventoActivoId: string | null;
  slotActivoId: string | null;
}

/** Usuario autorizado a operar ACTA. */
export interface Miembro {
  userId: string;
  email: string;
  nombre: string;
  rol: 'admin' | 'operator' | 'auditor';
}

/** Estado del motor de sincronización, para mostrarlo en la interfaz. */
export interface EstadoSync {
  /** Entregas firmadas que todavía no están confirmadas en la nube. */
  pendientes: number;
  /** Entregas que otro puesto ya había registrado. Requieren revisión. */
  conflictos: number;
  sincronizando: boolean;
  /** ISO de la última sincronización exitosa. */
  ultimaOk: string | null;
  ultimoError: string | null;
  enLinea: boolean;
}

/* ─── Tipos derivados para la UI ─────────────────────────────────── */

/** Estado de una persona frente a un turno concreto. */
export interface PersonRow {
  person: Person;
  /** Entrega del turno activo, si ya existe. */
  entrega: Delivery | null;
  /** Habilitada para el turno activo según su grupo. */
  habilitada: boolean;
  /** Historial del día: un punto por cada servicio del día activo. */
  jornada: JornadaMark[];
}

export interface JornadaMark {
  slotId: string;
  serviceNombre: string;
  serviceIcono: string;
  serviceColor: string;
  entregado: boolean;
  hora: string | null;
}

export interface ImportColumnMap {
  nombre: string;
  documento: string;
  empresa: string;
  grupo: string;
  referencia: string;
  telefono: string;
}

export interface ImportPreviewRow {
  raw: Record<string, string>;
  nombre: string;
  documento: string;
  empresa: string;
  grupo: string;
  referencia: string;
  telefono: string;
  /** 'nuevo' | 'duplicado-archivo' | 'duplicado-padron' | 'sin-nombre' */
  estado: 'nuevo' | 'duplicado-archivo' | 'duplicado-padron' | 'sin-nombre';
}

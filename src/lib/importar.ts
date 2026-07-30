import { norm, tituloNombre } from './util';
import type {
  EventDay,
  ImportColumnMap,
  ImportDateColumn,
  ImportPreviewRow,
  Person,
} from '../types';

/* SheetJS pesa ~700 KB y solo hace falta al importar o exportar. Cargarlo
   bajo demanda mantiene liviano el arranque del kiosko, que es la ruta
   que tiene que funcionar sin red. */
const cargarXLSX = () => import('xlsx');

export interface HojaLeida {
  hojas: string[];
  hoja: string;
  columnas: string[];
  filas: Record<string, string>[];
}

/** Lee la primera fila con contenido como encabezado. */
export async function leerArchivo(file: File, hojaPreferida?: string): Promise<HojaLeida> {
  const XLSX = await cargarXLSX();
  const buffer = await file.arrayBuffer();

  // Un .xlsx es un zip con XML UTF-8: se lee en binario sin problemas.
  // Un .csv son bytes sueltos y SheetJS asume codepage 1252, lo que
  // convierte "María" en "MarÃ­a". Decodificamos nosotros antes.
  const esTexto =
    /\.(csv|txt|tsv)$/i.test(file.name) || file.type === 'text/csv' || file.type === 'text/plain';

  const wb = esTexto
    ? XLSX.read(decodificarTexto(buffer), { type: 'string', raw: false })
    : XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
  const hojas = wb.SheetNames;
  if (!hojas.length) throw new Error('El archivo no tiene hojas legibles.');
  const hoja = hojaPreferida && hojas.includes(hojaPreferida) ? hojaPreferida : hojas[0];

  const matriz = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[hoja], {
    header: 1,
    blankrows: false,
    defval: '',
    raw: false,
  });
  if (!matriz.length) throw new Error(`La hoja "${hoja}" está vacía.`);

  // Encabezado = primera fila con al menos dos celdas no vacías.
  let iCab = matriz.findIndex((f) => f.filter((c) => String(c).trim()).length >= 2);
  if (iCab < 0) iCab = 0;

  const crudas = matriz[iCab].map((c, i) => String(c ?? '').trim() || `Columna ${i + 1}`);
  const columnas = desduplicar(crudas);

  const filas: Record<string, string>[] = [];
  for (let i = iCab + 1; i < matriz.length; i++) {
    const fila = matriz[i];
    if (!fila || !fila.some((c) => String(c ?? '').trim())) continue;
    const obj: Record<string, string> = {};
    columnas.forEach((col, j) => {
      obj[col] = String(fila[j] ?? '').trim();
    });
    filas.push(obj);
  }

  return { hojas, hoja, columnas, filas };
}

/**
 * Decodifica un CSV respetando su codificación real.
 * Orden: BOM explícito → UTF-8 estricto → windows-1252 (lo que exporta
 * Excel en español). Sin esto, los acentos y las eñes llegan rotos al
 * padrón, y el nombre del acta es justamente lo que no puede fallar.
 */
function decodificarTexto(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }

  try {
    // `fatal` hace que una secuencia inválida lance en vez de ensuciar
    // el texto con U+FFFD: así distinguimos UTF-8 real de Latin-1.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function desduplicar(nombres: string[]): string[] {
  const vistos = new Map<string, number>();
  return nombres.map((n) => {
    const veces = vistos.get(n) ?? 0;
    vistos.set(n, veces + 1);
    return veces ? `${n} (${veces + 1})` : n;
  });
}

/* ─── Detección automática de columnas ───────────────────────────── */

const PISTAS: Record<keyof ImportColumnMap, string[]> = {
  nombre: [
    'nombre y apellido',
    'apellido y nombre',
    'nombre completo',
    'nombres y apellidos',
    'invitado',
    'participante',
    'pasajero',
    'huesped',
    'persona',
    'nombre',
    'apellido',
    'name',
    'full name',
  ],
  documento: ['documento', 'ci', 'cedula', 'dni', 'rut', 'nro documento', 'n documento', 'identificacion', 'id', 'pasaporte'],
  empresa: [
    'empresa',
    'tipo',
    'procedencia',
    'origen',
    'organizacion',
    'compania',
    'institucion',
    'cliente',
    'proveedor',
    'company',
  ],
  grupo: ['rol', 'grupo', 'categoria', 'segmento', 'perfil', 'area', 'sector', 'equipo'],
  referencia: ['unidad', 'referencia', 'oficina', 'torre', 'habitacion', 'mesa', 'ubicacion', 'sede', 'piso', 'cargo'],
  telefono: ['telefono', 'celular', 'movil', 'whatsapp', 'contacto', 'phone'],
};

/** Sugiere un mapeo columna→campo a partir de los encabezados. */
export function detectarMapeo(columnas: string[]): ImportColumnMap {
  const mapa: ImportColumnMap = {
    nombre: '',
    documento: '',
    empresa: '',
    grupo: '',
    referencia: '',
    telefono: '',
  };
  const usadas = new Set<string>();
  const normalizadas = columnas.map((c) => ({ col: c, n: norm(c) }));

  // Formato operativo de OUTLET: TIPO indica procedencia y ROL la función.
  // Se resuelve antes del detector genérico para que ambas columnas no
  // compitan por el mismo campo.
  const tipo = normalizadas.find((c) => c.n === 'tipo');
  const rol = normalizadas.find((c) => c.n === 'rol');
  if (tipo && rol) {
    mapa.empresa = tipo.col;
    mapa.grupo = rol.col;
    usadas.add(tipo.col);
    usadas.add(rol.col);
  }

  for (const campo of Object.keys(PISTAS) as (keyof ImportColumnMap)[]) {
    if (mapa[campo]) continue;
    for (const pista of PISTAS[campo]) {
      const exacta = normalizadas.find((c) => !usadas.has(c.col) && c.n === pista);
      if (exacta) {
        mapa[campo] = exacta.col;
        usadas.add(exacta.col);
        break;
      }
    }
    if (mapa[campo]) continue;
    for (const pista of PISTAS[campo]) {
      const parcial = normalizadas.find((c) => !usadas.has(c.col) && c.n.includes(pista));
      if (parcial) {
        mapa[campo] = parcial.col;
        usadas.add(parcial.col);
        break;
      }
    }
  }

  // Sin encabezado reconocible: la primera columna suele ser el nombre.
  if (!mapa.nombre && columnas.length) {
    const libre = columnas.find((c) => !usadas.has(c));
    if (libre) mapa.nombre = libre;
  }
  return mapa;
}

/** Detecta encabezados de fecha y los vincula con las jornadas del evento. */
export function detectarColumnasFecha(
  columnas: string[],
  dias: EventDay[],
): ImportDateColumn[] {
  const dayIdPorFecha = new Map(dias.map((dia) => [dia.fecha, dia.id]));
  return columnas.flatMap((columna) => {
    const fecha = fechaISODesdeEncabezado(columna);
    return fecha
      ? [{ columna, fecha, dayId: dayIdPorFecha.get(fecha) ?? '' }]
      : [];
  });
}

function fechaISODesdeEncabezado(encabezado: string): string {
  const limpia = encabezado.trim();
  const iso = limpia.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const local = limpia.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!local) return '';
  const year = Number(local[3]) < 100 ? 2000 + Number(local[3]) : Number(local[3]);
  return fechaValida(year, Number(local[2]), Number(local[1]));
}

function fechaValida(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return '';
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Convierte las marcas habituales de una planilla a una decisión explícita. */
export function interpretarAsistencia(valorCrudo: string): 'si' | 'no' | 'invalido' {
  const valor = norm(valorCrudo);
  if (['si', 's', 'yes', 'y', 'x', '1', 'true'].includes(valor)) return 'si';
  if (['no', 'n', '0', 'false'].includes(valor)) return 'no';
  return 'invalido';
}

/**
 * Caso frecuente: apellido y nombre vienen en columnas separadas.
 * Devuelve la columna de apellido si detecta el par.
 */
export function detectarColumnaApellido(columnas: string[], colNombre: string): string {
  const nNombre = norm(colNombre);
  if (!nNombre.startsWith('nombre')) return '';
  const cand = columnas.find((c) => c !== colNombre && norm(c).startsWith('apellido'));
  return cand ?? '';
}

/* ─── Vista previa ───────────────────────────────────────────────── */

export function construirPreview(args: {
  filas: Record<string, string>[];
  mapa: ImportColumnMap;
  colApellido?: string;
  /** 'nombre apellido' | 'apellido nombre' */
  ordenNombre?: 'nombre-apellido' | 'apellido-nombre';
  padronActual: Person[];
  columnasFecha?: ImportDateColumn[];
}): ImportPreviewRow[] {
  const {
    filas,
    mapa,
    colApellido,
    ordenNombre = 'nombre-apellido',
    padronActual,
    columnasFecha = [],
  } = args;

  const clavesPadron = new Set(
    padronActual.map((p) => clavePersona(p.nombre, p.documento, p.empresa, p.grupo)),
  );
  const clavesArchivo = new Set<string>();

  const preview = filas.map((raw) => {
    const base = mapa.nombre ? (raw[mapa.nombre] ?? '') : '';
    const apellido = colApellido ? (raw[colApellido] ?? '') : '';
    const compuesto = apellido
      ? ordenNombre === 'apellido-nombre'
        ? `${apellido} ${base}`
        : `${base} ${apellido}`
      : base;

    const nombre = tituloNombre(compuesto);
    const documento = valor(raw, mapa.documento);
    const empresa = valor(raw, mapa.empresa);
    const grupo = valor(raw, mapa.grupo);
    const clave = clavePersona(nombre, documento, empresa, grupo);
    const asistencia = columnasFecha.map((columna) => ({
      ...columna,
      valor: interpretarAsistencia(raw[columna.columna] ?? ''),
    }));
    const diasHabilitados = columnasFecha.length
      ? asistencia
          .filter((marca) => marca.valor === 'si' && marca.dayId)
          .map((marca) => marca.dayId)
      : null;

    let estado: ImportPreviewRow['estado'] = 'nuevo';
    if (!nombre) estado = 'sin-nombre';
    else if (clavesPadron.has(clave)) estado = 'duplicado-padron';
    else if (clavesArchivo.has(clave)) estado = 'duplicado-archivo';
    else clavesArchivo.add(clave);

    return {
      raw,
      nombre,
      documento,
      empresa,
      grupo,
      referencia: valor(raw, mapa.referencia),
      telefono: valor(raw, mapa.telefono),
      diasHabilitados,
      asistencia,
      estado,
    };
  });
  return preview.sort(
    (a, b) =>
      a.empresa.localeCompare(b.empresa, 'es', { sensitivity: 'base' }) ||
      a.grupo.localeCompare(b.grupo, 'es', { sensitivity: 'base' }) ||
      a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
  );
}

function valor(raw: Record<string, string>, col: string): string {
  return col ? (raw[col] ?? '').trim() : '';
}

/** Identidad de una persona: documento si existe, si no el nombre normalizado. */
export function clavePersona(
  nombre: string,
  documento: string,
  empresa = '',
  grupo = '',
): string {
  const doc = documento.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
  return doc ? `d:${doc}` : `n:${norm(nombre)}|e:${norm(empresa)}|g:${norm(grupo)}`;
}

/** Planilla modelo para que el usuario tenga el formato esperado. */
export async function plantillaPadron(dias: EventDay[] = []): Promise<Blob> {
  const XLSX = await cargarXLSX();
  const fechas = dias.map((dia) => {
    const [year, month, day] = dia.fecha.split('-').map(Number);
    return year && month && day ? `${day}/${month}/${year}` : dia.fecha;
  });
  const filas = [
    ['TIPO', 'ROL', 'NOMBRE', ...fechas, 'DOCUMENTO', 'REFERENCIA', 'TELEFONO'],
    ['INTERNO', 'BOA', 'María Fernanda Acosta', ...fechas.map(() => 'SI'), '4.512.880', 'Torre A · Piso 3', '0981 123 456'],
    ['STAFF', 'LOGÍSTICA', 'Juan Ignacio Ramírez', ...fechas.map((_, i) => (i === fechas.length - 1 ? 'NO' : 'SI')), '3.998.145', 'Cocina', ''],
    ['EXTERNO', 'PROVEEDOR', 'Ana Lucía Benítez', ...fechas.map(() => 'SI'), '5.204.771', 'Mesa 12', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 22 },
    { wch: 30 },
    ...fechas.map(() => ({ wch: 12 })),
    { wch: 14 },
    { wch: 22 },
    { wch: 16 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Padrón');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

import { norm, tituloNombre } from './util';
import type { ImportColumnMap, ImportPreviewRow, Person } from '../types';

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
  empresa: ['empresa', 'organizacion', 'compania', 'institucion', 'cliente', 'proveedor', 'company'],
  grupo: ['grupo', 'categoria', 'tipo', 'segmento', 'rol', 'perfil', 'area', 'sector', 'equipo'],
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

  for (const campo of Object.keys(PISTAS) as (keyof ImportColumnMap)[]) {
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
}): ImportPreviewRow[] {
  const { filas, mapa, colApellido, ordenNombre = 'nombre-apellido', padronActual } = args;

  const clavesPadron = new Set(padronActual.map((p) => clavePersona(p.nombre, p.documento)));
  const clavesArchivo = new Set<string>();

  return filas.map((raw) => {
    const base = mapa.nombre ? (raw[mapa.nombre] ?? '') : '';
    const apellido = colApellido ? (raw[colApellido] ?? '') : '';
    const compuesto = apellido
      ? ordenNombre === 'apellido-nombre'
        ? `${apellido} ${base}`
        : `${base} ${apellido}`
      : base;

    const nombre = tituloNombre(compuesto);
    const documento = valor(raw, mapa.documento);
    const clave = clavePersona(nombre, documento);

    let estado: ImportPreviewRow['estado'] = 'nuevo';
    if (!nombre) estado = 'sin-nombre';
    else if (clavesPadron.has(clave)) estado = 'duplicado-padron';
    else if (clavesArchivo.has(clave)) estado = 'duplicado-archivo';
    else clavesArchivo.add(clave);

    return {
      raw,
      nombre,
      documento,
      empresa: valor(raw, mapa.empresa),
      grupo: valor(raw, mapa.grupo),
      referencia: valor(raw, mapa.referencia),
      telefono: valor(raw, mapa.telefono),
      estado,
    };
  });
}

function valor(raw: Record<string, string>, col: string): string {
  return col ? (raw[col] ?? '').trim() : '';
}

/** Identidad de una persona: documento si existe, si no el nombre normalizado. */
export function clavePersona(nombre: string, documento: string): string {
  const doc = documento.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
  return doc ? `d:${doc}` : `n:${norm(nombre)}`;
}

/** Planilla modelo para que el usuario tenga el formato esperado. */
export async function plantillaPadron(): Promise<Blob> {
  const XLSX = await cargarXLSX();
  const filas = [
    ['Nombre completo', 'Documento', 'Empresa', 'Grupo', 'Referencia', 'Teléfono'],
    ['María Fernanda Acosta', '4.512.880', 'Tropical Tower', 'Staff', 'Torre A · Piso 3', '0981 123 456'],
    ['Juan Ignacio Ramírez', '3.998.145', 'Proveedor Gastro', 'Proveedor', 'Cocina', ''],
    ['Ana Lucía Benítez', '5.204.771', '', 'Invitado', 'Mesa 12', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 22 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Padrón');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

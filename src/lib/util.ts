/* Utilidades transversales: ids, texto, fechas, formato. */

export function uid(prefix = ''): string {
  const raw =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}

/**
 * Normaliza para búsqueda: sin acentos, sin puntuación, minúsculas.
 * "José Ángel Muñóz-Pérez" → "jose angel munoz perez"
 */
export function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coincide si TODOS los términos de la consulta aparecen como prefijo de
 * alguna palabra del texto. "per jua" encuentra "Juan Pérez".
 */
export function matchTerms(haystack: string, terms: string[]): boolean {
  if (!terms.length) return true;
  const words = haystack.split(' ');
  return terms.every((t) => words.some((w) => w.startsWith(t)));
}

/** Limpia y capitaliza un nombre importado sin destruir partículas. */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'do', 'dos', 'van', 'von']);

export function tituloNombre(value: string): string {
  const limpio = value.replace(/\s+/g, ' ').trim();
  if (!limpio) return '';
  // Si viene en mayúsculas o minúsculas totales, lo recomponemos.
  const mismoCaso = limpio === limpio.toUpperCase() || limpio === limpio.toLowerCase();
  if (!mismoCaso) return limpio;
  return limpio
    .toLocaleLowerCase('es')
    .split(' ')
    .map((w, i) =>
      i > 0 && PARTICULAS.has(w) ? w : w.charAt(0).toLocaleUpperCase('es') + w.slice(1),
    )
    .join(' ');
}

export function iniciales(nombre: string): string {
  const partes = nombre
    .trim()
    .split(/\s+/)
    .filter((p) => !PARTICULAS.has(p.toLowerCase()));
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/* ─── Fechas ─────────────────────────────────────────────────────── */

/** ISO date (YYYY-MM-DD) del día local, sin corrimiento por zona horaria. */
export function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Rango inclusivo de fechas ISO. */
export function rangoFechas(desde: string, hasta: string): string[] {
  if (!desde || !hasta) return desde ? [desde] : [];
  const out: string[] = [];
  const d = parseISO(desde);
  const end = parseISO(hasta);
  if (!d || !end || end < d) return [desde];
  let guard = 0;
  while (d <= end && guard++ < 366) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** "lun 14 jul" */
export function fechaCorta(iso: string): string {
  const d = parseISO(iso);
  if (!d) return iso;
  return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** "lunes 14 de julio de 2026" */
export function fechaLarga(iso: string): string {
  const d = parseISO(iso);
  if (!d) return iso;
  const mesesLargos = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${mesesLargos[d.getMonth()]} de ${d.getFullYear()}`;
}

/** "14 jul · 12:38" a partir de un timestamp ISO completo. */
export function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MESES[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "12:38" */
export function hora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function rangoLegible(desde: string, hasta: string): string {
  if (!desde) return 'Sin fechas';
  if (!hasta || desde === hasta) return fechaCorta(desde);
  return `${fechaCorta(desde)} — ${fechaCorta(hasta)}`;
}

/* ─── Formato ────────────────────────────────────────────────────── */

export function pct(parte: number, total: number): number {
  if (!total) return 0;
  return Math.round((parte / total) * 100);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/** Etiqueta legible del dispositivo, para trazabilidad del acta. */
export function describirDispositivo(): string {
  const ua = navigator.userAgent;
  const plataforma = /iPad|Tablet/i.test(ua)
    ? 'Tablet'
    : /Mobile|Android/i.test(ua)
      ? 'Móvil'
      : 'Escritorio';
  const nav = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Safari\//.test(ua)
        ? 'Safari'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : 'Navegador';
  const so = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [plataforma, nav, so].filter(Boolean).join(' · ');
}

/**
 * Sello de verificación: SHA-256 de los campos probatorios de la entrega.
 * Permite detectar después si un registro exportado fue alterado.
 */
export async function sellar(campos: (string | number | boolean)[]): Promise<string> {
  const texto = campos.join('|');
  if (!crypto?.subtle) return 'sin-sello';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function descargar(nombre: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slugArchivo(value: string): string {
  return norm(value).replace(/\s+/g, '-').slice(0, 60) || 'evento';
}

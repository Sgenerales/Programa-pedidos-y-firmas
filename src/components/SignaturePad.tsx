import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { Stroke, StrokePoint } from '../types';

/* ═══════════════════════════════════════════════════════════════════
   Pad de firma
   ───────────────────────────────────────────────────────────────────
   El ancho del trazo se deriva de la velocidad del puntero: rápido =
   fino, lento = grueso. Es lo que separa una firma de una línea plana.
   Guardamos vectores además del PNG para poder reimprimir el acta
   nítida a cualquier tamaño.
   ═══════════════════════════════════════════════════════════════════ */

const TINTA = '#171512';
const W_MAX = 3.3;
const W_MIN = 0.95;
/** px/ms a partir de los cuales el trazo llega a su grosor mínimo. */
const VEL_TOPE = 2.1;

export interface SignaturePadHandle {
  limpiar: () => void;
  estaVacio: () => boolean;
  /** PNG recortado al trazo, fondo transparente, 2× para impresión. */
  exportar: () => { png: string; trazos: Stroke[]; ancho: number; alto: number } | null;
}

interface Props {
  ref?: Ref<SignaturePadHandle>;
  /** Se dispara al pasar de vacío a con trazo y viceversa. */
  onCambio?: (tieneTrazo: boolean) => void;
  deshabilitado?: boolean;
  leyenda?: string;
}

export function SignaturePad({ ref, onCambio, deshabilitado, leyenda }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trazosRef = useRef<Stroke[]>([]);
  const actualRef = useRef<Stroke | null>(null);
  const ultimoRef = useRef<{ x: number; y: number; t: number; w: number } | null>(null);
  const dprRef = useRef(1);
  const tieneTrazoRef = useRef(false);
  const [tieneTrazo, setTieneTrazo] = useState(false);

  /* — Lienzo: tamaño físico según DPR para que el trazo no se pixele — */
  const ajustarLienzo = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { width, height } = wrap.getBoundingClientRect();
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    dprRef.current = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = TINTA;
    redibujar();
  }, []);

  const redibujar = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = dprRef.current;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (const trazo of trazosRef.current) pintarTrazo(ctx, trazo);
  }, []);

  useEffect(() => {
    ajustarLienzo();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => ajustarLienzo());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [ajustarLienzo]);

  // El espejo en ref permite detectar el cambio sin meter el aviso al
  // padre dentro del updater de setState, que tiene que ser puro.
  const marcar = useCallback(
    (valor: boolean) => {
      if (tieneTrazoRef.current === valor) return;
      tieneTrazoRef.current = valor;
      setTieneTrazo(valor);
      onCambio?.(valor);
    },
    [onCambio],
  );

  /* — Captura de puntero — */

  function coords(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (deshabilitado) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = coords(e);
    const w = anchoDesdePresion(e, W_MAX * 0.82);
    const punto: StrokePoint = { x, y, w };
    actualRef.current = [punto];
    trazosRef.current.push(actualRef.current);
    ultimoRef.current = { x, y, t: performance.now(), w };

    // Un toque seco también deja marca: punto redondo.
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.fillStyle = TINTA;
      ctx.arc(x, y, w / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    marcar(true);
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const trazo = actualRef.current;
    const previo = ultimoRef.current;
    const ctx = canvasRef.current?.getContext('2d');
    if (!trazo || !previo || !ctx || deshabilitado) return;

    // Coalescencia: en tablets el navegador agrupa varios movimientos en
    // un solo evento, y recuperarlos da un trazo mucho más fiel. Si la
    // lista viene vacía (eventos sintéticos, o navegadores que no la
    // implementan), usamos el evento tal cual: nunca perdemos el punto.
    const coalescidos =
      typeof e.nativeEvent.getCoalescedEvents === 'function'
        ? e.nativeEvent.getCoalescedEvents()
        : [];
    const eventos = coalescidos.length ? coalescidos : [e.nativeEvent];
    const rect = e.currentTarget.getBoundingClientRect();

    for (const ev of eventos) {
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const ahora = performance.now();
      const ref = ultimoRef.current!;
      const dx = x - ref.x;
      const dy = y - ref.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.6) continue;

      const dt = Math.max(ahora - ref.t, 1);
      const vel = dist / dt;
      const objetivo =
        (ev as PointerEvent).pressure > 0 && (ev as PointerEvent).pointerType === 'pen'
          ? W_MIN + (W_MAX - W_MIN) * (ev as PointerEvent).pressure
          : W_MAX - (W_MAX - W_MIN) * Math.min(vel / VEL_TOPE, 1);
      // Suavizado: evita que el grosor salte entre muestras.
      const w = ref.w * 0.62 + objetivo * 0.38;

      const mx = (ref.x + x) / 2;
      const my = (ref.y + y) / 2;
      ctx.beginPath();
      ctx.lineWidth = w;
      ctx.strokeStyle = TINTA;
      ctx.moveTo(ref.x, ref.y);
      ctx.quadraticCurveTo(ref.x, ref.y, mx, my);
      ctx.lineTo(x, y);
      ctx.stroke();

      trazo.push({ x, y, w });
      ultimoRef.current = { x, y, t: ahora, w };
    }
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    actualRef.current = null;
    ultimoRef.current = null;
  }

  /* — API imperativa — */

  useImperativeHandle(
    ref,
    () => ({
      limpiar() {
        trazosRef.current = [];
        actualRef.current = null;
        ultimoRef.current = null;
        redibujar();
        marcar(false);
      },
      estaVacio() {
        return trazosRef.current.every((t) => t.length === 0) || trazosRef.current.length === 0;
      },
      exportar() {
        const trazos = trazosRef.current.filter((t) => t.length > 0);
        if (!trazos.length) return null;
        const wrap = wrapRef.current;
        const ancho = wrap?.clientWidth ?? 600;
        const alto = wrap?.clientHeight ?? 240;
        const png = renderizarPNG(trazos, ancho, alto);
        return { png, trazos, ancho, alto };
      },
    }),
    [marcar, redibujar],
  );

  return (
    <div ref={wrapRef} className={`pad${tieneTrazo ? ' pad--drawn' : ''}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
        aria-label="Panel de firma"
        role="img"
      />
      <div className="pad__baseline" />
      <div className="pad__hint">Firme aquí con el dedo o el lápiz</div>
      {leyenda ? <div className="pad__legal">{leyenda}</div> : null}
    </div>
  );
}

/* ─── Dibujo ─────────────────────────────────────────────────────── */

function anchoDesdePresion(e: React.PointerEvent, fallback: number): number {
  if (e.pointerType === 'pen' && e.pressure > 0) {
    return W_MIN + (W_MAX - W_MIN) * e.pressure;
  }
  return fallback;
}

function pintarTrazo(
  ctx: CanvasRenderingContext2D,
  trazo: Stroke,
  offsetX = 0,
  offsetY = 0,
  escala = 1,
): void {
  if (!trazo.length) return;
  ctx.strokeStyle = TINTA;
  ctx.fillStyle = TINTA;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (trazo.length === 1) {
    const p = trazo[0];
    ctx.beginPath();
    ctx.arc((p.x - offsetX) * escala, (p.y - offsetY) * escala, (p.w / 2) * escala, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  for (let i = 1; i < trazo.length; i++) {
    const a = trazo[i - 1];
    const b = trazo[i];
    const ax = (a.x - offsetX) * escala;
    const ay = (a.y - offsetY) * escala;
    const bx = (b.x - offsetX) * escala;
    const by = (b.y - offsetY) * escala;
    ctx.beginPath();
    ctx.lineWidth = b.w * escala;
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
}

/**
 * Renderiza los trazos recortados a su caja envolvente, con margen.
 * Recortar evita guardar lienzos casi vacíos y hace que la firma se vea
 * bien tanto en una fila de tabla como a página completa.
 */
function renderizarPNG(trazos: Stroke[], anchoLienzo: number, altoLienzo: number): string {
  const MARGEN = 10;
  const ESCALA = 2;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of trazos) {
    for (const p of t) {
      minX = Math.min(minX, p.x - p.w);
      minY = Math.min(minY, p.y - p.w);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.w);
    }
  }
  if (!Number.isFinite(minX)) return '';

  minX = Math.max(0, minX - MARGEN);
  minY = Math.max(0, minY - MARGEN);
  maxX = Math.min(anchoLienzo, maxX + MARGEN);
  maxY = Math.min(altoLienzo, maxY + MARGEN);

  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  const out = document.createElement('canvas');
  out.width = Math.round(w * ESCALA);
  out.height = Math.round(h * ESCALA);
  const ctx = out.getContext('2d');
  if (!ctx) return '';
  for (const t of trazos) pintarTrazo(ctx, t, minX, minY, ESCALA);
  return out.toDataURL('image/png');
}

/** Re-render de una firma guardada, para reportes y actas. */
export function firmaADataURL(trazos: Stroke[], ancho: number, alto: number): string {
  return renderizarPNG(trazos, ancho, alto);
}

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useStore } from '../store/useStore';

/* ─── Modal ──────────────────────────────────────────────────────── */

interface ModalProps {
  abierto: boolean;
  onCerrar: () => void;
  titulo?: string;
  descripcion?: string;
  ancho?: 'normal' | 'wide' | 'sign';
  /** Bloquea el cierre por Escape / clic afuera (durante un guardado). */
  bloqueado?: boolean;
  cabecera?: ReactNode;
  pie?: ReactNode;
  children: ReactNode;
}

export function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  ancho = 'normal',
  bloqueado,
  cabecera,
  pie,
  children,
}: ModalProps) {
  const cajaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !bloqueado) onCerrar();
      if (e.key !== 'Tab') return;
      // Trampa de foco: el modal es modal de verdad.
      const foco = cajaRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!foco?.length) return;
      const primero = foco[0];
      const ultimo = foco[foco.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previo;
    };
  }, [abierto, bloqueado, onCerrar]);

  if (!abierto) return null;

  const clase = ancho === 'wide' ? 'modal modal--wide' : ancho === 'sign' ? 'modal modal--sign' : 'modal';

  return createPortal(
    <div
      className="modalRoot"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !bloqueado) onCerrar();
      }}
    >
      <div
        ref={cajaRef}
        className={clase}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {cabecera ?? (
          <div className="modal__head">
            <div style={{ minWidth: 0 }}>
              {titulo ? <h2 className="modal__title">{titulo}</h2> : null}
              {descripcion ? <p className="modal__desc">{descripcion}</p> : null}
            </div>
            <button
              className="modal__close no-print"
              onClick={onCerrar}
              disabled={bloqueado}
              aria-label="Cerrar"
            >
              <Icon name="x" size={17} />
            </button>
          </div>
        )}
        <div className="modal__body">{children}</div>
        {pie ? <div className="modal__foot">{pie}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ─── Confirmación ───────────────────────────────────────────────── */

interface ConfirmProps {
  abierto: boolean;
  titulo: string;
  mensaje: ReactNode;
  etiquetaOk?: string;
  peligroso?: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}

export function Confirmar({
  abierto,
  titulo,
  mensaje,
  etiquetaOk = 'Confirmar',
  peligroso,
  onCancelar,
  onConfirmar,
}: ConfirmProps) {
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCancelar}
      titulo={titulo}
      pie={
        <>
          <div className="spacer" />
          <button className="btn btn--ghost" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            className={peligroso ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={onConfirmar}
          >
            {etiquetaOk}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>{mensaje}</div>
    </Modal>
  );
}

/* ─── Avisos flotantes ───────────────────────────────────────────── */

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  const cerrar = useStore((s) => s.cerrarToast);
  if (!toasts.length) return null;
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tipo}`} role="status">
          <span className="toast__icon">
            <Icon name={t.tipo === 'ok' ? 'sello' : t.tipo === 'error' ? 'alerta' : 'info'} size={17} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="toast__title">{t.titulo}</div>
            {t.detalle ? <div className="toast__detalle">{t.detalle}</div> : null}
          </div>
          <button className="btn btn--quiet btn--icon btn--sm" onClick={() => cerrar(t.id)} aria-label="Cerrar aviso">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ─── Estado vacío ───────────────────────────────────────────────── */

export function Vacio({
  icono = 'archivo',
  titulo,
  descripcion,
  accion,
}: {
  icono?: string;
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icono} size={24} />
      </div>
      <div className="empty__title">{titulo}</div>
      {descripcion ? <p className="empty__desc">{descripcion}</p> : null}
      {accion}
    </div>
  );
}

/* ─── Campo de formulario ────────────────────────────────────────── */

export function Campo({
  etiqueta,
  ayuda,
  error,
  children,
}: {
  etiqueta?: string;
  ayuda?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {etiqueta ? <span className="field__label">{etiqueta}</span> : null}
      {children}
      {error ? <span className="field__error">{error}</span> : ayuda ? <span className="field__hint">{ayuda}</span> : null}
    </label>
  );
}

export function Interruptor({
  valor,
  onCambio,
  etiqueta,
  deshabilitado,
}: {
  valor: boolean;
  onCambio: (v: boolean) => void;
  etiqueta: string;
  deshabilitado?: boolean;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={valor}
        disabled={deshabilitado}
        onChange={(e) => onCambio(e.target.checked)}
      />
      <span className="switch__track" />
      <span className="switch__label">{etiqueta}</span>
    </label>
  );
}

/* ─── Barra de progreso con etiqueta ─────────────────────────────── */

export function Progreso({ parte, total, completo }: { parte: number; total: number; completo?: boolean }) {
  const p = total ? Math.round((parte / total) * 100) : 0;
  return (
    <div className="bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className={`bar__fill${completo || p === 100 ? ' bar__fill--ok' : ''}`} style={{ width: `${p}%` }} />
    </div>
  );
}

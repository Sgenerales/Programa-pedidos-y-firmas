import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Campo } from '../components/ui';
import { SyncPill } from '../components/SyncPill';
import { useStore } from '../store/useStore';
import { contarEnNube } from '../lib/supabase';
import { HAY_NUBE, PROYECTO } from '../lib/config';
import { bytes, describirDispositivo, hora, iniciales } from '../lib/util';
import * as db from '../lib/idb';

export function AjustesPage() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  const [uso, setUso] = useState<{ usado: number; cuota: number } | null>(null);

  useEffect(() => {
    void db.estimateUsage().then(setUso);
  }, []);

  return (
    <main className="page">
      <div className="page__inner">
        {/* ── Puesto ── */}
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Este puesto</h2>
              <p className="section__desc">
                El nombre del operador y del puesto quedan grabados en cada entrega. Es lo que
                permite saber después quién registró qué.
              </p>
            </div>
          </div>
          <div className="card card--pad">
            <div className="grid grid--2">
              <Campo etiqueta="Operador a cargo" ayuda="Figura en el acta junto a cada firma.">
                <input
                  className="input"
                  value={settings.operador}
                  placeholder="Nombre y apellido"
                  onChange={(e) => setSettings({ operador: e.target.value })}
                />
              </Campo>
              <Campo etiqueta="Identificación del puesto" ayuda="Útil cuando hay varias tablets.">
                <input
                  className="input"
                  value={settings.puesto}
                  placeholder="Puesto 1 · Lobby"
                  onChange={(e) => setSettings({ puesto: e.target.value })}
                />
              </Campo>
            </div>
            {!settings.operador.trim() ? (
              <div className="notice notice--warn" style={{ marginTop: 16 }}>
                <span className="notice__icon">
                  <Icon name="alerta" size={16} />
                </span>
                <span>
                  Sin operador cargado, las entregas se firman como «Sin identificar». Completalo
                  antes de abrir el kiosko.
                </span>
              </div>
            ) : null}
            <div className="row" style={{ marginTop: 16, fontSize: 12.5, color: 'var(--fg-3)' }}>
              <Icon name="kiosko" size={14} />
              Dispositivo detectado: <strong style={{ color: 'var(--fg-2)' }}>{describirDispositivo()}</strong>
            </div>
          </div>
        </section>

        {/* ── Almacenamiento ── */}
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Almacenamiento local</h2>
              <p className="section__desc">
                Todo vive en esta tablet. La app funciona completa sin conexión; la nube es opcional.
              </p>
            </div>
          </div>
          <div className="card card--pad">
            {uso ? (
              <>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 7 }}>
                  <span style={{ fontSize: 13.5 }}>
                    {bytes(uso.usado)} usados{uso.cuota ? ` de ${bytes(uso.cuota)} disponibles` : ''}
                  </span>
                  <span className="badge badge--ok">
                    <span className="badge__dot" />
                    Base local operativa
                  </span>
                </div>
                <div className="bar">
                  <div
                    className="bar__fill"
                    style={{ width: `${uso.cuota ? Math.min(100, (uso.usado / uso.cuota) * 100) : 2}%` }}
                  />
                </div>
              </>
            ) : (
              <span className="muted" style={{ fontSize: 13.5 }}>
                El navegador no reporta el uso de almacenamiento.
              </span>
            )}
            <p className="field__hint" style={{ marginTop: 12 }}>
              Una firma pesa entre 4 y 20 KB. Un evento de 200 personas con 9 servicios ronda los
              20 MB: muy por debajo del límite de cualquier tablet.
            </p>
          </div>
        </section>

        {/* ── Sesión y nube ── */}
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Cuenta y respaldo en la nube</h2>
              <p className="section__desc">
                Cada entrega y cada firma se suben acá. Es lo que alimenta los reportes y lo que
                permite que dos tablets se vean entre sí.
              </p>
            </div>
          </div>
          <SeccionNube />
        </section>
      </div>
    </main>
  );
}

/* ═══ Sesión y estado de la cola ═══════════════════════════════════ */

function SeccionNube() {
  const sesion = useStore((s) => s.sesion);
  const sync = useStore((s) => s.sync);
  const salir = useStore((s) => s.salir);
  const sincronizar = useStore((s) => s.sincronizar);
  const eventoId = useStore((s) => s.eventoId);
  const entregas = useStore((s) => s.entregas);
  const toast = useStore((s) => s.toast);

  const [enNube, setEnNube] = useState<number | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [saliendo, setSaliendo] = useState(false);

  const localesActivas = entregas.filter((e) => e.estado === 'entregado').length;

  if (!HAY_NUBE) {
    return (
      <div className="card card--pad">
        <div className="notice notice--warn">
          <span className="notice__icon">
            <Icon name="nubeOff" size={16} />
          </span>
          <span>
            Esta instalación no tiene configurada la conexión a la nube. Todo funciona, pero las
            entregas viven solo en esta tablet. Definí <code className="mono">VITE_SUPABASE_URL</code>{' '}
            y <code className="mono">VITE_SUPABASE_PUBLISHABLE_KEY</code> y volvé a compilar.
          </span>
        </div>
      </div>
    );
  }

  const ROLES: Record<string, string> = {
    admin: 'Administrador · puede eliminar datos',
    operator: 'Operador · registra entregas',
    auditor: 'Auditor · solo lectura',
  };

  return (
    <div className="card card--pad">
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <span className="sign__avatar" style={{ width: 44, height: 44, fontSize: 15, borderRadius: 12 }}>
          {sesion ? iniciales(sesion.nombre) : '—'}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15.5 }}>{sesion?.nombre ?? 'Sin sesión'}</div>
          <div className="truncate" style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
            {sesion?.email}
          </div>
          <div className="row" style={{ gap: 7, marginTop: 7 }}>
            <span className="badge badge--brass">{ROLES[sesion?.rol ?? ''] ?? sesion?.rol}</span>
            <span className="badge">
              <Icon name="nube" size={11} />
              {PROYECTO}
            </span>
          </div>
        </div>
        <SyncPill />
      </div>

      {/* Estado de la cola: la pregunta que importa en un evento */}
      <div className="grid grid--3" style={{ marginTop: 20 }}>
        <div className="stat">
          <div className="stat__label">Entregas en esta tablet</div>
          <div className="stat__value">{localesActivas}</div>
          <div className="stat__foot">registradas localmente</div>
        </div>
        <div className="stat">
          <div className="stat__label">Sin subir</div>
          <div
            className="stat__value"
            style={{ color: sync.pendientes ? 'var(--warn)' : 'var(--ok)' }}
          >
            {sync.pendientes}
          </div>
          <div className="stat__foot">
            {sync.pendientes ? 'se reintenta solo' : 'todo confirmado en la nube'}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Confirmadas en la nube</div>
          <div className="stat__value">{enNube ?? '—'}</div>
          <div className="stat__foot">
            {enNube === null ? 'tocá «Verificar»' : 'contadas en Postgres'}
          </div>
        </div>
      </div>

      {sync.conflictos ? (
        <div className="notice notice--warn" style={{ marginTop: 16 }}>
          <span className="notice__icon">
            <Icon name="alerta" size={16} />
          </span>
          <span>
            <strong>{sync.conflictos} entrega(s) en conflicto.</strong> Otro puesto ya había
            registrado a esas personas en el mismo turno. La primera firma es la que vale; revisalas
            en Reportes.
          </span>
        </div>
      ) : null}

      {sync.ultimoError ? (
        <div className="notice notice--danger" style={{ marginTop: 16 }}>
          <span className="notice__icon">
            <Icon name="alerta" size={16} />
          </span>
          <span>{sync.ultimoError}</span>
        </div>
      ) : sync.ultimaOk ? (
        <div className="notice" style={{ marginTop: 16 }}>
          <span className="notice__icon">
            <Icon name="sello" size={16} />
          </span>
          <span>Última sincronización a las {hora(sync.ultimaOk)}.</span>
        </div>
      ) : null}

      <div className="row row--wrap" style={{ marginTop: 18, gap: 9 }}>
        <button
          className="btn btn--primary"
          disabled={sync.sincronizando || !eventoId}
          onClick={() => void sincronizar()}
        >
          <Icon name="subir" size={15} />
          {sync.sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>

        <button
          className="btn btn--ghost"
          disabled={verificando || !eventoId}
          onClick={async () => {
            if (!eventoId) return;
            setVerificando(true);
            const n = await contarEnNube(eventoId);
            setEnNube(n);
            setVerificando(false);
            toast(
              n === null
                ? { tipo: 'error', titulo: 'No se pudo consultar la nube' }
                : {
                    tipo: n >= localesActivas ? 'ok' : 'info',
                    titulo: `${n} entregas confirmadas en la nube`,
                    detalle:
                      n >= localesActivas
                        ? 'Todo lo de esta tablet está respaldado.'
                        : `Faltan ${localesActivas - n} por subir desde este u otro puesto.`,
                  },
            );
          }}
        >
          <Icon name="sello" size={15} />
          {verificando ? 'Verificando…' : 'Verificar respaldo'}
        </button>

        <div className="spacer" />

        <button
          className="btn btn--danger"
          disabled={saliendo}
          onClick={async () => {
            setSaliendo(true);
            await salir();
            setSaliendo(false);
          }}
        >
          <Icon name="candado" size={15} />
          {saliendo ? 'Cerrando…' : 'Cerrar sesión'}
        </button>
      </div>

      {sync.pendientes ? (
        <p className="field__hint" style={{ marginTop: 12 }}>
          Al cerrar sesión se intenta subir lo pendiente primero, para no dejar firmas varadas fuera
          del reporte.
        </p>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Icon, Marca } from './components/Icon';
import { Toaster } from './components/ui';
import { useStore } from './store/useStore';
import { iniciales, rangoLegible } from './lib/util';
import { SyncPill } from './components/SyncPill';
import { HAY_NUBE } from './lib/config';
import { LoginPage } from './pages/LoginPage';
import { EventosPage } from './pages/EventosPage';
import { ConfiguracionPage } from './pages/ConfiguracionPage';
import { PadronPage } from './pages/PadronPage';
import { KioskoPage } from './pages/KioskoPage';
import { ReportesPage } from './pages/ReportesPage';
import { AjustesPage } from './pages/AjustesPage';

export type Vista = 'eventos' | 'configuracion' | 'padron' | 'kiosko' | 'reportes' | 'ajustes';

const NAV: { vista: Vista; icono: string; label: string; requiereEvento: boolean }[] = [
  { vista: 'eventos', icono: 'calendario', label: 'Eventos', requiereEvento: false },
  { vista: 'configuracion', icono: 'matriz', label: 'Configuración', requiereEvento: true },
  { vista: 'padron', icono: 'personas', label: 'Padrón', requiereEvento: true },
  { vista: 'kiosko', icono: 'kiosko', label: 'Kiosko', requiereEvento: true },
  { vista: 'reportes', icono: 'reporte', label: 'Reportes', requiereEvento: true },
];

const TITULOS: Record<Vista, { titulo: string; sub: string }> = {
  eventos: { titulo: 'Eventos', sub: 'Cada evento tiene su propio padrón, sus turnos y su acta.' },
  configuracion: { titulo: 'Configuración del evento', sub: 'Definí qué se entrega y en qué jornada.' },
  padron: { titulo: 'Padrón', sub: 'Las personas habilitadas a recibir en este evento.' },
  kiosko: { titulo: 'Kiosko', sub: 'Vista de operación en piso.' },
  reportes: { titulo: 'Reportes', sub: 'Cobertura, pendientes y acta de entregas.' },
  ajustes: { titulo: 'Ajustes', sub: 'Operador, puesto y sincronización.' },
};

export default function App() {
  const listo = useStore((s) => s.listo);
  const init = useStore((s) => s.init);
  const eventos = useStore((s) => s.eventos);
  const eventoId = useStore((s) => s.eventoId);
  const personas = useStore((s) => s.personas);
  const slots = useStore((s) => s.slots);
  const settings = useStore((s) => s.settings);
  const sesion = useStore((s) => s.sesion);
  const sesionVerificada = useStore((s) => s.sesionVerificada);
  const sincronizar = useStore((s) => s.sincronizar);
  const setEnLinea = useStore((s) => s.setEnLinea);

  const [vista, setVista] = useState<Vista>('eventos');

  useEffect(() => {
    void init();
  }, [init]);

  // Motor de sincronización a nivel de aplicación: corre en cualquier
  // pantalla, no solo en el kiosko. Ninguna firma puede quedarse en la
  // tablet por haber salido de la vista de operación.
  useEffect(() => {
    if (!HAY_NUBE || !sesion) return;

    const alVolverLaRed = () => setEnLinea(true);
    const alPerderLaRed = () => setEnLinea(false);
    // Volver a mirar la pantalla es una acción del usuario: ahí sí vale
    // consultar aunque estemos fuera de la ventana operativa.
    const alVolverAlFrente = () => {
      if (document.visibilityState === 'visible') {
        void sincronizar({ silencioso: true, forzar: true });
      }
    };

    window.addEventListener('online', alVolverLaRed);
    window.addEventListener('offline', alPerderLaRed);
    document.addEventListener('visibilitychange', alVolverAlFrente);

    // Una pestaña olvidada en segundo plano no tiene a nadie mirando, pero
    // seguía consultando el servidor cada 30 segundos. Con la app abierta
    // y sin evento en curso, eso solo gastaba transferencia.
    const reloj = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void sincronizar({ silencioso: true });
    }, 30_000);

    void sincronizar({ silencioso: true });

    return () => {
      window.removeEventListener('online', alVolverLaRed);
      window.removeEventListener('offline', alPerderLaRed);
      document.removeEventListener('visibilitychange', alVolverAlFrente);
      window.clearInterval(reloj);
    };
  }, [sesion, sincronizar, setEnLinea]);

  const evento = useMemo(() => eventos.find((e) => e.id === eventoId) ?? null, [eventos, eventoId]);

  // Al perder el evento activo, no dejamos al usuario en una vista muerta.
  useEffect(() => {
    if (!eventoId && vista !== 'eventos' && vista !== 'ajustes') setVista('eventos');
  }, [eventoId, vista]);

  if (!listo) return <Cargando texto="Abriendo base local" />;

  // Puerta de sesión. Una vez cruzada, la sesión queda guardada en el
  // dispositivo y la app sigue operando aunque después se caiga la red.
  if (HAY_NUBE && !sesion) {
    return sesionVerificada ? <LoginPage /> : <Cargando texto="Verificando sesión" />;
  }

  // El kiosko toma la pantalla completa: en piso no hay lugar para menús.
  if (vista === 'kiosko' && evento) {
    return (
      <div className="app app--kiosk">
        <KioskoPage onSalir={() => setVista('reportes')} />
        <Toaster />
      </div>
    );
  }

  const conteos: Partial<Record<Vista, string>> = {
    padron: personas.length ? String(personas.length) : undefined,
    configuracion: slots.length ? String(slots.length) : undefined,
  };

  return (
    <div className="app">
      {!HAY_NUBE ? <AvisoSinNube /> : null}
      <a className="skipLink" href="#contenido-principal">
        Saltar al contenido
      </a>
      <aside className="rail">
        <div className="brand">
          <div className="brand__mark">
            <Marca size={19} />
          </div>
          <div className="brand__text">
            <div className="brand__name">ACTA</div>
            <div className="brand__sub">Control de entregas</div>
          </div>
        </div>

        {evento ? (
          <div className="rail__event">
            <button className="rail__eventCard" onClick={() => setVista('eventos')}>
              <div className="rail__eventName">{evento.nombre}</div>
              <div className="rail__eventMeta">
                <Icon name="calendario" size={12} />
                {rangoLegible(evento.fechaInicio, evento.fechaFin)}
              </div>
            </button>
          </div>
        ) : null}

        <nav className="nav">
          {NAV.map((item) => {
            const bloqueado = item.requiereEvento && !evento;
            return (
              <button
                key={item.vista}
                className={`navItem${vista === item.vista ? ' navItem--on' : ''}`}
                onClick={() => setVista(item.vista)}
                disabled={bloqueado}
                aria-label={item.label}
                aria-current={vista === item.vista ? 'page' : undefined}
                title={bloqueado ? 'Seleccioná un evento primero' : item.label}
              >
                <Icon name={item.icono} size={18} />
                <span>{item.label}</span>
                {conteos[item.vista] && !bloqueado ? (
                  <span className="navItem__badge">{conteos[item.vista]}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="rail__foot">
          <button
            className="operatorChip"
            onClick={() => setVista('ajustes')}
            aria-label="Abrir ajustes del puesto"
          >
            <span className="operatorChip__avatar">
              {settings.operador ? iniciales(settings.operador) : '—'}
            </span>
            <span className="operatorChip__text" style={{ minWidth: 0 }}>
              <span className="truncate" style={{ display: 'block', fontWeight: 600 }}>
                {settings.operador || 'Sin operador'}
              </span>
              <span className="truncate" style={{ display: 'block', color: 'var(--fg-3)', fontSize: 11.5 }}>
                {settings.puesto}
              </span>
            </span>
          </button>
          <button
            className={`navItem${vista === 'ajustes' ? ' navItem--on' : ''}`}
            onClick={() => setVista('ajustes')}
            aria-label="Ajustes"
            aria-current={vista === 'ajustes' ? 'page' : undefined}
          >
            <Icon name="ajustes" size={18} />
            <span>Ajustes</span>
          </button>
        </div>
      </aside>

      <div className="main" id="contenido-principal">
        <header className="topbar">
          <div style={{ minWidth: 0 }}>
            <div className="topbar__title">{TITULOS[vista].titulo}</div>
            <div className="topbar__sub truncate">{TITULOS[vista].sub}</div>
          </div>
          <div className="topbar__spacer" />
          <SyncPill />
          {evento ? (
            <button className="btn btn--primary" onClick={() => setVista('kiosko')}>
              <Icon name="kiosko" size={16} />
              Abrir kiosko
            </button>
          ) : null}
        </header>

        {vista === 'eventos' ? (
          <EventosPage onAbrirConfiguracion={() => setVista('configuracion')} onAbrirPadron={() => setVista('padron')} />
        ) : null}
        {vista === 'configuracion' ? <ConfiguracionPage onIrAPadron={() => setVista('padron')} /> : null}
        {vista === 'padron' ? <PadronPage onIrAKiosko={() => setVista('kiosko')} /> : null}
        {vista === 'reportes' ? <ReportesPage /> : null}
        {vista === 'ajustes' ? <AjustesPage /> : null}
      </div>

      <Toaster />
    </div>
  );
}

/** Si faltan las variables de entorno, nada se respalda. No puede pasar
    inadvertido: es la diferencia entre tener el reporte y no tenerlo. */
function AvisoSinNube() {
  return (
    <div className="bandaSinNube">
      <Icon name="alerta" size={15} />
      <span>
        <strong>Modo local sin respaldo.</strong> Las entregas y firmas se guardan solo en este
        dispositivo. Falta configurar <code className="mono">VITE_SUPABASE_URL</code> y{' '}
        <code className="mono">VITE_SUPABASE_PUBLISHABLE_KEY</code> en el hosting.
      </span>
    </div>
  );
}

function Cargando({ texto }: { texto: string }) {
  return (
    <div className="app app--kiosk">
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
          <div style={{ color: 'var(--brass)', marginBottom: 12 }}>
            <Marca size={34} />
          </div>
          <div className="eyebrow">{texto}</div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Icon, Marca } from './components/Icon';
import { Toaster } from './components/ui';
import { useStore } from './store/useStore';
import { iniciales, rangoLegible } from './lib/util';
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

  const [vista, setVista] = useState<Vista>('eventos');

  useEffect(() => {
    void init();
  }, [init]);

  const evento = useMemo(() => eventos.find((e) => e.id === eventoId) ?? null, [eventos, eventoId]);

  // Al perder el evento activo, no dejamos al usuario en una vista muerta.
  useEffect(() => {
    if (!eventoId && vista !== 'eventos' && vista !== 'ajustes') setVista('eventos');
  }, [eventoId, vista]);

  if (!listo) {
    return (
      <div className="app app--kiosk">
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <div style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
            <div style={{ color: 'var(--brass)', marginBottom: 12 }}>
              <Marca size={34} />
            </div>
            <div className="eyebrow">Abriendo base local</div>
          </div>
        </div>
      </div>
    );
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

import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Campo, Interruptor } from '../components/ui';
import { useStore } from '../store/useStore';
import { probarConexion, reiniciarCliente, subirEstructura, subirEntregas } from '../lib/supabase';
import { bytes, describirDispositivo } from '../lib/util';
import * as db from '../lib/idb';

export function AjustesPage() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const eventos = useStore((s) => s.eventos);
  const eventoId = useStore((s) => s.eventoId);
  const dias = useStore((s) => s.dias);
  const servicios = useStore((s) => s.servicios);
  const slots = useStore((s) => s.slots);
  const personas = useStore((s) => s.personas);
  const toast = useStore((s) => s.toast);

  const [uso, setUso] = useState<{ usado: number; cuota: number } | null>(null);
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => {
    void db.estimateUsage().then(setUso);
  }, []);

  const evento = eventos.find((e) => e.id === eventoId) ?? null;

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

        {/* ── Sincronización ── */}
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Sincronización entre puestos</h2>
              <p className="section__desc">
                Opcional. Sirve cuando hay dos o más tablets atendiendo el mismo turno y necesitás
                que se vean entre sí en tiempo real.
              </p>
            </div>
          </div>
          <div className="card card--pad">
            <Interruptor
              valor={settings.syncHabilitado}
              etiqueta="Activar sincronización con Supabase"
              onCambio={(v) => {
                reiniciarCliente();
                setSettings({ syncHabilitado: v });
                setResultado(null);
              }}
            />

            {settings.syncHabilitado ? (
              <>
                <div className="grid grid--2" style={{ marginTop: 18 }}>
                  <Campo etiqueta="URL del proyecto">
                    <input
                      className="input"
                      value={settings.supabaseUrl}
                      placeholder="https://xxxx.supabase.co"
                      onChange={(e) => {
                        reiniciarCliente();
                        setSettings({ supabaseUrl: e.target.value });
                      }}
                    />
                  </Campo>
                  <Campo etiqueta="Clave anónima (anon key)" ayuda="Nunca uses la service_role acá.">
                    <input
                      className="input"
                      type="password"
                      value={settings.supabaseAnonKey}
                      placeholder="eyJhbGciOi…"
                      onChange={(e) => {
                        reiniciarCliente();
                        setSettings({ supabaseAnonKey: e.target.value });
                      }}
                    />
                  </Campo>
                </div>

                <div className="row" style={{ marginTop: 16, gap: 9 }}>
                  <button
                    className="btn btn--ghost"
                    disabled={probando}
                    onClick={async () => {
                      setProbando(true);
                      setResultado(await probarConexion(settings));
                      setProbando(false);
                    }}
                  >
                    <Icon name="nube" size={15} />
                    {probando ? 'Probando…' : 'Probar conexión'}
                  </button>

                  <button
                    className="btn btn--ghost"
                    disabled={!evento || subiendo}
                    onClick={async () => {
                      if (!evento) return;
                      setSubiendo(true);
                      const est = await subirEstructura(settings, {
                        evento,
                        dias,
                        servicios,
                        slots,
                        personas,
                      });
                      if (!est.ok) {
                        toast({ tipo: 'error', titulo: 'No se pudo subir la estructura', detalle: est.mensaje });
                        setSubiendo(false);
                        return;
                      }
                      const ent = await subirEntregas(settings, evento.id);
                      toast({
                        tipo: 'ok',
                        titulo: 'Evento publicado',
                        detalle: `Estructura y padrón sincronizados. ${ent.subidas} entrega(s) subidas.`,
                      });
                      setSubiendo(false);
                    }}
                  >
                    <Icon name="subir" size={15} />
                    {subiendo ? 'Publicando…' : 'Publicar evento actual'}
                  </button>
                </div>

                {resultado ? (
                  <div
                    className={`notice ${resultado.ok ? 'notice--info' : 'notice--danger'}`}
                    style={{ marginTop: 14 }}
                  >
                    <span className="notice__icon">
                      <Icon name={resultado.ok ? 'sello' : 'alerta'} size={16} />
                    </span>
                    <span>{resultado.mensaje}</span>
                  </div>
                ) : null}

                <div className="notice" style={{ marginTop: 14 }}>
                  <span className="notice__icon">
                    <Icon name="info" size={16} />
                  </span>
                  <span>
                    Ejecutá <code className="mono">supabase/schema.sql</code> en tu proyecto antes de
                    publicar. La restricción única <code className="mono">(slot_id, person_id)</code>{' '}
                    es la que evita que dos puestos registren a la misma persona en el mismo turno.
                  </span>
                </div>
              </>
            ) : (
              <div className="notice" style={{ marginTop: 16 }}>
                <span className="notice__icon">
                  <Icon name="nubeOff" size={16} />
                </span>
                <span>
                  Trabajando solo en local. Es el modo recomendado si operás con una sola tablet:
                  no depende de la red del salón.
                </span>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

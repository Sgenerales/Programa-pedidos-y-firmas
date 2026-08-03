import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Campo, Confirmar, Modal, Vacio } from '../components/ui';
import { useStore } from '../store/useStore';
import { imagenDeFirma } from '../components/SignaturePad';
import { habilitadaEnTurno, matrizCobertura, resumenTurno } from '../store/selectors';
import { reporteCompleto, respaldoJSON } from '../lib/exportar';
import * as db from '../lib/idb';
import { verificarClaveAdministrador } from '../lib/supabase';
import { descargar, fechaCorta, fechaLarga, hora, iniciales, pct } from '../lib/util';
import type { Delivery, SignatureRecord, Slot } from '../types';

export function ReportesPage() {
  const eventos = useStore((s) => s.eventos);
  const eventoId = useStore((s) => s.eventoId);
  const dias = useStore((s) => s.dias);
  const servicios = useStore((s) => s.servicios);
  const slots = useStore((s) => s.slots);
  const personas = useStore((s) => s.personas);
  const entregas = useStore((s) => s.entregas);
  const anularEntrega = useStore((s) => s.anularEntrega);
  const sesion = useStore((s) => s.sesion);
  const toast = useStore((s) => s.toast);

  const [actaSlot, setActaSlot] = useState<Slot | 'todos' | null>(null);
  const [aAnular, setAAnular] = useState<Delivery | null>(null);
  const [motivo, setMotivo] = useState('');
  const [claveAdmin, setClaveAdmin] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [errorAnulacion, setErrorAnulacion] = useState('');
  const [anulando, setAnulando] = useState(false);
  const [exportando, setExportando] = useState(false);

  const evento = eventos.find((e) => e.id === eventoId);
  const puedeAnular = sesion?.rol === 'admin';

  function cerrarAnulacion() {
    if (anulando) return;
    setAAnular(null);
    setMotivo('');
    setClaveAdmin('');
    setVerClave(false);
    setErrorAnulacion('');
  }

  function solicitarAnulacion(entrega: Delivery) {
    if (!puedeAnular) {
      toast({
        tipo: 'error',
        titulo: 'Acción reservada',
        detalle: 'Sólo una cuenta administradora puede anular firmas.',
      });
      return;
    }
    setAAnular(entrega);
    setMotivo('');
    setClaveAdmin('');
    setVerClave(false);
    setErrorAnulacion('');
  }

  const activas = useMemo(() => entregas.filter((e) => e.estado === 'entregado'), [entregas]);
  const activos = useMemo(() => personas.filter((p) => p.activo), [personas]);

  const matriz = useMemo(
    () => matrizCobertura({ dias, servicios, slots, personas, entregas }),
    [dias, servicios, slots, personas, entregas],
  );

  const posibles = useMemo(
    () => slots.reduce((acc, s) => acc + resumenTurno(personas, entregas, s).total, 0),
    [slots, personas, entregas],
  );

  const ordenSlots = useMemo(() => {
    const d = new Map(dias.map((x, i) => [x.id, i]));
    const s = new Map(servicios.map((x, i) => [x.id, i]));
    return [...slots].sort(
      (a, b) => (d.get(a.dayId) ?? 0) - (d.get(b.dayId) ?? 0) || (s.get(a.serviceId) ?? 0) - (s.get(b.serviceId) ?? 0),
    );
  }, [slots, dias, servicios]);

  const porPersona = useMemo(() => {
    const m = new Map<string, Map<string, Delivery>>();
    for (const e of activas) {
      if (!m.has(e.personId)) m.set(e.personId, new Map());
      m.get(e.personId)!.set(e.slotId, e);
    }
    return m;
  }, [activas]);

  if (!evento) return null;

  if (!slots.length) {
    return (
      <main className="page">
        <div className="page__inner">
          <div className="card">
            <Vacio
              icono="reporte"
              titulo="Todavía no hay nada que reportar"
              descripcion="Configurá la grilla de turnos y registrá al menos una entrega."
            />
          </div>
        </div>
      </main>
    );
  }

  async function exportar() {
    setExportando(true);
    try {
      const { blob, nombre } = await reporteCompleto({
        evento: evento!,
        dias,
        servicios,
        slots,
        personas,
        entregas,
      });
      descargar(nombre, blob);
      toast({ tipo: 'ok', titulo: 'Reporte generado', detalle: '4 hojas: resumen, matriz, detalle y pendientes.' });
    } catch (err) {
      toast({ tipo: 'error', titulo: 'No se pudo exportar', detalle: msg(err) });
    } finally {
      setExportando(false);
    }
  }

  async function respaldar() {
    const firmas = await db.getByIndex<SignatureRecord>('signatures', 'eventId', evento!.id);
    const { blob, nombre } = respaldoJSON(
      { evento: evento!, dias, servicios, slots, personas, entregas },
      firmas,
    );
    descargar(nombre, blob);
    toast({ tipo: 'ok', titulo: 'Respaldo descargado', detalle: 'Incluye las firmas en formato vectorial y PNG.' });
  }

  return (
    <main className="page">
      <div className="page__wide">
        {/* ── Métricas ── */}
        <div className="grid grid--4" style={{ marginBottom: 26 }}>
          <div className="stat">
            <div className="stat__label">Cobertura global</div>
            <div className="stat__value">{pct(activas.length, posibles)}%</div>
            <div className="stat__foot">
              {activas.length.toLocaleString('es')} de {posibles.toLocaleString('es')} entregas posibles
            </div>
          </div>
          <div className="stat">
            <div className="stat__label">Entregas firmadas</div>
            <div className="stat__value">{activas.filter((e) => e.conFirma).length}</div>
            <div className="stat__foot">
              {activas.length - activas.filter((e) => e.conFirma).length} confirmadas sin firma
            </div>
          </div>
          <div className="stat">
            <div className="stat__label">Personas registradas</div>
            <div className="stat__value">{activos.length}</div>
            <div className="stat__foot">
              los totales diarios respetan la asistencia SI/NO
            </div>
          </div>
          <div className="stat">
            <div className="stat__label">Anuladas</div>
            <div className="stat__value" style={{ color: entregas.length - activas.length ? 'var(--danger)' : undefined }}>
              {entregas.length - activas.length}
            </div>
            <div className="stat__foot">quedan registradas con su motivo</div>
          </div>
        </div>

        <div className="row row--wrap" style={{ marginBottom: 26, gap: 9 }}>
          <button className="btn btn--primary" onClick={exportar} disabled={exportando}>
            <Icon name="bajar" size={16} />
            {exportando ? 'Generando…' : 'Exportar reporte Excel'}
          </button>
          <button className="btn btn--ghost" onClick={() => setActaSlot('todos')}>
            <Icon name="acta" size={16} />
            Generar acta con firmas
          </button>
          <div className="spacer" />
          <button className="btn btn--quiet" onClick={respaldar}>
            <Icon name="archivo" size={16} />
            Respaldo completo (JSON)
          </button>
        </div>

        {/* ── Cobertura por turno ── */}
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Cobertura por turno</h2>
              <p className="section__desc">
                Tocá una celda para ver el acta de ese turno con las firmas.
              </p>
            </div>
          </div>

          <div className="matrix">
            <table>
              <thead>
                <tr>
                  <th className="matrix__corner matrix__dayCell">
                    <div className="eyebrow">Jornada</div>
                  </th>
                  {servicios.map((srv) => (
                    <th key={srv.id}>
                      <div className="matrix__srvHead">
                        <div
                          className="matrix__srvIcon"
                          style={{ background: `${srv.color}22`, color: srv.color, border: `1px solid ${srv.color}44` }}
                        >
                          <Icon name={srv.icono} size={16} />
                        </div>
                        <div className="matrix__srvName">{srv.nombre}</div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dias.map((dia, i) => (
                  <tr key={dia.id}>
                    <td className="matrix__dayCell">
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{dia.etiqueta}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{fechaCorta(dia.fecha)}</div>
                    </td>
                    {servicios.map((srv, j) => {
                      const celda = matriz[i][j];
                      if (!celda.slot) {
                        return (
                          <td key={srv.id} className="matrix__cell">
                            <div style={{ color: 'var(--fg-4)', fontSize: 12, padding: '18px 0' }}>—</div>
                          </td>
                        );
                      }
                      const p = pct(celda.entregados, celda.total);
                      return (
                        <td key={srv.id} className="matrix__cell">
                          <button
                            className="slotToggle slotToggle--on"
                            style={{ background: p === 100 ? 'var(--ok-dim)' : `${srv.color}14` }}
                            onClick={() => setActaSlot(celda.slot!)}
                          >
                            <span className="slotToggle__cov" style={{ fontSize: 16 }}>
                              {celda.entregados}
                              <span style={{ color: 'var(--fg-3)', fontSize: 12 }}> / {celda.total}</span>
                            </span>
                            <span
                              className="bar"
                              style={{ width: '78%', height: 4, marginTop: 3 }}
                            >
                              <span
                                className={`bar__fill${p === 100 ? ' bar__fill--ok' : ''}`}
                                style={{ width: `${p}%`, display: 'block', height: '100%' }}
                              />
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Flujo por persona ── */}
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Flujo por persona</h2>
              <p className="section__desc">
                Cada fila es el recorrido completo de una persona por el evento: qué recibió, cuándo
                y qué le falta.
              </p>
            </div>
          </div>

          <div className="tableWrap" style={{ maxHeight: 560 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, zIndex: 3, minWidth: 230 }}>Persona</th>
                  {ordenSlots.map((s) => {
                    const srv = servicios.find((x) => x.id === s.serviceId);
                    const dia = dias.find((x) => x.id === s.dayId);
                    return (
                      <th key={s.id} style={{ textAlign: 'center', minWidth: 92 }}>
                        <div style={{ color: srv?.color }}>{srv?.nombre}</div>
                        <div style={{ fontWeight: 500, letterSpacing: 0, textTransform: 'none', opacity: 0.7 }}>
                          {dia?.etiqueta}
                        </div>
                      </th>
                    );
                  })}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {activos.map((p) => {
                  const suyas = porPersona.get(p.id);
                  const total = suyas?.size ?? 0;
                  return (
                    <tr key={p.id}>
                      <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>
                        <div className="row" style={{ gap: 9 }}>
                          <span
                            className="pRow__avatar"
                            style={{ width: 30, height: 30, fontSize: 11, borderRadius: 9 }}
                          >
                            {iniciales(p.nombre)}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span className="truncate" style={{ display: 'block', fontWeight: 600 }}>
                              {p.nombre}
                            </span>
                            {p.grupo ? (
                              <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{p.grupo}</span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      {ordenSlots.map((s) => {
                        const e = suyas?.get(s.id);
                        const habilitada = habilitadaEnTurno(p, s);
                        return (
                          <td key={s.id} style={{ textAlign: 'center' }}>
                            {e ? (
                              puedeAnular ? (
                                <button
                                  className="badge badge--ok"
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => solicitarAnulacion(e)}
                                  title={`${e.operador} · sello ${e.sello}. Abrir anulación segura.`}
                                >
                                  {hora(e.firmadoEn)}
                                </button>
                              ) : (
                                <span
                                  className="badge badge--ok"
                                  title={`${e.operador} · sello ${e.sello}`}
                                >
                                  {hora(e.firmadoEn)}
                                </span>
                              )
                            ) : habilitada ? (
                              <span style={{ color: 'var(--fg-4)' }}>·</span>
                            ) : (
                              <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>n/a</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="num tabular" style={{ fontWeight: 600 }}>
                        {total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {actaSlot ? (
        <ActaModal
          slot={actaSlot === 'todos' ? null : actaSlot}
          puedeAnular={puedeAnular}
          onAnular={solicitarAnulacion}
          onCerrar={() => setActaSlot(null)}
        />
      ) : null}

      <Confirmar
        abierto={Boolean(aAnular)}
        titulo="Anular firma"
        peligroso
        etiquetaOk="Anular firma"
        procesando={anulando}
        deshabilitado={motivo.trim().length < 3 || !claveAdmin}
        mensaje={
          <>
            <p style={{ marginBottom: 14 }}>
              Se anulará la entrega de <strong>{aAnular?.nombreFirmante}</strong> registrada a las{' '}
              <strong>{aAnular ? hora(aAnular.firmadoEn) : ''}</strong>. El registro y la firma se
              conservan: quedan marcados como anulados con el motivo.
            </p>
            <div className="notice notice--warn" style={{ marginBottom: 16 }}>
              <span className="notice__icon">
                <Icon name="candado" size={17} />
              </span>
              <span>
                Esta acción requiere conexión y la contraseña de la cuenta administradora activa.
              </span>
            </div>
            <Campo etiqueta="Motivo de la anulación" ayuda="Escribí al menos 3 caracteres.">
              <input
                className="input"
                value={motivo}
                autoFocus
                disabled={anulando}
                placeholder="Ej: se registró a la persona equivocada"
                onChange={(e) => {
                  setMotivo(e.target.value);
                  setErrorAnulacion('');
                }}
              />
            </Campo>
            <Campo
              etiqueta={`Contraseña administradora${sesion?.email ? ` · ${sesion.email}` : ''}`}
              error={errorAnulacion}
            >
              <div className="secureInput">
                <input
                  className="input"
                  type={verClave ? 'text' : 'password'}
                  value={claveAdmin}
                  disabled={anulando}
                  autoComplete="current-password"
                  placeholder="Ingresá tu contraseña"
                  onChange={(e) => {
                    setClaveAdmin(e.target.value);
                    setErrorAnulacion('');
                  }}
                />
                <button
                  type="button"
                  className="btn btn--quiet btn--sm secureInput__toggle"
                  onClick={() => setVerClave((valor) => !valor)}
                  disabled={anulando}
                  aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {verClave ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </Campo>
          </>
        }
        onCancelar={cerrarAnulacion}
        onConfirmar={async () => {
          if (!aAnular || motivo.trim().length < 3 || !claveAdmin) return;
          setAnulando(true);
          setErrorAnulacion('');
          try {
            const autorizacion = await verificarClaveAdministrador(claveAdmin);
            if (!autorizacion.ok) {
              setErrorAnulacion(autorizacion.mensaje);
              return;
            }
            await anularEntrega(aAnular.id, motivo.trim());
            toast({
              tipo: 'info',
              titulo: 'Firma anulada',
              detalle: 'La evidencia quedó en el historial y la persona vuelve a figurar como pendiente.',
            });
            setAAnular(null);
            setMotivo('');
            setClaveAdmin('');
            setVerClave(false);
          } catch (err) {
            setErrorAnulacion(msg(err));
          } finally {
            setAnulando(false);
          }
        }}
      />
    </main>
  );
}

/* ═══ Acta imprimible ══════════════════════════════════════════════ */

function ActaModal({
  slot,
  puedeAnular,
  onAnular,
  onCerrar,
}: {
  slot: Slot | null;
  puedeAnular: boolean;
  onAnular: (entrega: Delivery) => void;
  onCerrar: () => void;
}) {
  const eventos = useStore((s) => s.eventos);
  const eventoId = useStore((s) => s.eventoId);
  const dias = useStore((s) => s.dias);
  const servicios = useStore((s) => s.servicios);
  const slots = useStore((s) => s.slots);
  const personas = useStore((s) => s.personas);
  const entregas = useStore((s) => s.entregas);

  const [firmas, setFirmas] = useState<Map<string, string>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [errorFirmas, setErrorFirmas] = useState('');

  const evento = eventos.find((e) => e.id === eventoId)!;
  const objetivo = slot ? [slot] : slots;

  const filas = useMemo(() => {
    const ids = new Set(objetivo.map((s) => s.id));
    return entregas
      .filter((e) => ids.has(e.slotId))
      .sort((a, b) => a.firmadoEn.localeCompare(b.firmadoEn));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entregas, slot]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setErrorFirmas('');
    void (async () => {
      try {
        const todas = await db.getByIndex<SignatureRecord>('signatures', 'eventId', evento.id);
        if (!vivo) return;
        // Redibujamos de los trazos: pesan una fracción del PNG y salen
      // nítidos a cualquier tamaño de impresión.
      setFirmas(new Map(todas.flatMap((f) => {
        const img = imagenDeFirma(f);
        return img ? [[f.id, img] as [string, string]] : [];
      })));
      } catch (err) {
        if (vivo) setErrorFirmas(msg(err));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [evento.id]);

  const titulo = slot
    ? `${servicios.find((s) => s.id === slot.serviceId)?.nombre} · ${
        dias.find((d) => d.id === slot.dayId)?.etiqueta
      }`
    : 'Acta general del evento';
  const personasEnPadron = slot
    ? personas.filter((persona) => habilitadaEnTurno(persona, slot)).length
    : personas.filter((persona) => persona.activo).length;

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="wide"
      titulo="Acta de entregas"
      descripcion={`${filas.length} registro(s) · ${titulo}`}
      pie={
        <>
          <div className="spacer" />
          <button className="btn btn--ghost" onClick={onCerrar}>
            Cerrar
          </button>
          <button
            className="btn btn--primary"
            onClick={() => window.print()}
            disabled={cargando || Boolean(errorFirmas)}
          >
            <Icon name="imprimir" size={16} />
            Imprimir / Guardar PDF
          </button>
        </>
      }
    >
      {cargando ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : errorFirmas ? (
        <div className="notice notice--danger">
          <span className="notice__icon">
            <Icon name="alerta" size={17} />
          </span>
          <span>No se pudieron recuperar las firmas para el acta. {errorFirmas}</span>
        </div>
      ) : !filas.length ? (
        <Vacio icono="acta" titulo="Sin entregas registradas" descripcion="Este turno todavía no tiene firmas." />
      ) : (
        <div className="acta">
          <header className="acta__head">
            <div style={{ flex: 1 }}>
              <div className="acta__kicker">Acta de entrega · Constancia de recepción</div>
              <h1 className="acta__title">{evento.nombre}</h1>
              <div className="acta__meta">
                {[evento.organizador, evento.lugar].filter(Boolean).join(' · ')}
                {evento.organizador || evento.lugar ? ' — ' : ''}
                {titulo}
                {slot ? ` — ${fechaLarga(dias.find((d) => d.id === slot.dayId)?.fecha ?? '')}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontFamily: 'var(--font-ui)', fontSize: 11, color: '#6b6455' }}>
              <div>Emitida {new Date().toLocaleString('es')}</div>
              <div>{filas.length} registros</div>
            </div>
          </header>

          <table>
            <thead>
              <tr>
                <th style={{ width: 26 }}>#</th>
                <th>Nombre y apellido</th>
                <th style={{ width: 84 }}>Documento</th>
                {!slot ? <th style={{ width: 130 }}>Servicio</th> : null}
                <th style={{ width: 54 }}>Hora</th>
                <th style={{ width: 160 }}>Firma</th>
                <th style={{ width: 92 }}>Sello</th>
                <th className="no-print" style={{ width: 110 }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((e, i) => {
                const s = slots.find((x) => x.id === e.slotId);
                const srv = servicios.find((x) => x.id === s?.serviceId);
                const dia = dias.find((x) => x.id === s?.dayId);
                const png = firmas.get(e.id);
                return (
                  <tr key={e.id} style={e.estado === 'anulado' ? { opacity: 0.5 } : undefined}>
                    <td style={{ color: '#8c8474' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>
                      {e.nombreFirmante}
                      {e.estado === 'anulado' ? (
                        <div style={{ fontSize: 9.5, color: '#a03a3a' }}>
                          ANULADA — {e.motivoAnulacion}
                        </div>
                      ) : null}
                      {e.observacion ? (
                        <div style={{ fontSize: 9.5, color: '#6b6455' }}>{e.observacion}</div>
                      ) : null}
                    </td>
                    <td>{e.documentoFirmante || '—'}</td>
                    {!slot ? (
                      <td style={{ fontSize: 10.5 }}>
                        {srv?.nombre}
                        <div style={{ color: '#6b6455' }}>{dia?.etiqueta}</div>
                      </td>
                    ) : null}
                    <td>{hora(e.firmadoEn)}</td>
                    <td>
                      {png ? (
                        <img className="acta__sig" src={png} alt={`Firma de ${e.nombreFirmante}`} />
                      ) : e.conFirma ? (
                        // El acta no puede afirmar algo que no puede mostrar.
                        <span style={{ fontSize: 10, color: '#a03a3a' }}>Firma no recuperable</span>
                      ) : (
                        <span style={{ fontSize: 10, color: '#8c8474' }}>Confirmado sin firma</span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#6b6455' }}>
                      {e.sello}
                      <div>{e.operador}</div>
                    </td>
                    <td className="no-print">
                      {e.estado === 'anulado' ? (
                        <span className="badge badge--danger">Anulada</span>
                      ) : (
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => onAnular(e)}
                          disabled={!puedeAnular}
                          title={
                            puedeAnular
                              ? 'Anular con contraseña administradora'
                              : 'Sólo una cuenta administradora puede anular'
                          }
                        >
                          <Icon name="candado" size={14} />
                          Anular
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <footer className="acta__foot">
            <span>
              Registro generado por ACTA · Control de entregas. Cada sello es un hash de los datos
              de la entrega y permite verificar que el registro no fue alterado.
            </span>
            <span>
              Personas en padrón: {personasEnPadron}
            </span>
          </footer>
        </div>
      )}
    </Modal>
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : 'Error inesperado';
}

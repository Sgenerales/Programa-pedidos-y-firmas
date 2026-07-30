import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Campo, Confirmar, Interruptor, Modal, Vacio } from '../components/ui';
import { useStore } from '../store/useStore';
import { gruposDelPadron } from '../store/selectors';
import { COLORES_SERVICIO, ICONOS_SERVICIO, PLANTILLAS_SERVICIO } from '../lib/catalogo';
import { fechaCorta, fechaLarga } from '../lib/util';
import type { Service, Slot } from '../types';

export function ConfiguracionPage({ onIrAPadron }: { onIrAPadron: () => void }) {
  const eventos = useStore((s) => s.eventos);
  const eventoId = useStore((s) => s.eventoId);
  const dias = useStore((s) => s.dias);
  const servicios = useStore((s) => s.servicios);
  const slots = useStore((s) => s.slots);
  const personas = useStore((s) => s.personas);
  const entregas = useStore((s) => s.entregas);
  const actualizarEvento = useStore((s) => s.actualizarEvento);
  const agregarServicio = useStore((s) => s.agregarServicio);
  const actualizarServicio = useStore((s) => s.actualizarServicio);
  const eliminarServicio = useStore((s) => s.eliminarServicio);
  const alternarTurno = useStore((s) => s.alternarTurno);
  const aplicarATodos = useStore((s) => s.aplicarServicioATodosLosDias);
  const renombrarDia = useStore((s) => s.renombrarDia);
  const toast = useStore((s) => s.toast);

  const evento = eventos.find((e) => e.id === eventoId);
  const [catalogoAbierto, setCatalogoAbierto] = useState(false);
  const [servicioEnEdicion, setServicioEnEdicion] = useState<Service | null>(null);
  const [servicioAEliminar, setServicioAEliminar] = useState<Service | null>(null);
  const [slotEnEdicion, setSlotEnEdicion] = useState<Slot | null>(null);

  const grupos = useMemo(() => gruposDelPadron(personas), [personas]);
  const slotConEntregas = useMemo(
    () => new Set(entregas.filter((e) => e.estado === 'entregado').map((e) => e.slotId)),
    [entregas],
  );

  if (!evento) return null;

  const totalTurnos = slots.length;
  const entregasPosibles = totalTurnos * personas.filter((p) => p.activo).length;

  async function alternar(dayId: string, serviceId: string) {
    try {
      await alternarTurno(evento!.id, dayId, serviceId);
    } catch (err) {
      toast({ tipo: 'error', titulo: 'No se pudo cambiar el turno', detalle: msg(err) });
    }
  }

  return (
    <main className="page">
      <div className="page__wide">
        {/* ── Datos del evento ── */}
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Datos del evento</h2>
              <p className="section__desc">Encabezan el acta y los reportes exportados.</p>
            </div>
          </div>
          <div className="card card--pad">
            <div className="grid grid--2" style={{ marginBottom: 15 }}>
              <Campo etiqueta="Nombre">
                <input
                  className="input"
                  value={evento.nombre}
                  onChange={(e) => actualizarEvento(evento.id, { nombre: e.target.value })}
                />
              </Campo>
              <Campo etiqueta="Organizador">
                <input
                  className="input"
                  value={evento.organizador}
                  placeholder="Tropical Tower S.A."
                  onChange={(e) => actualizarEvento(evento.id, { organizador: e.target.value })}
                />
              </Campo>
              <Campo etiqueta="Lugar">
                <input
                  className="input"
                  value={evento.lugar}
                  placeholder="Salón Principal"
                  onChange={(e) => actualizarEvento(evento.id, { lugar: e.target.value })}
                />
              </Campo>
              <div className="grid grid--2">
                <Campo etiqueta="Primer día">
                  <input
                    className="input"
                    type="date"
                    value={evento.fechaInicio}
                    onInput={(e) =>
                      actualizarEvento(evento.id, { fechaInicio: e.currentTarget.value })
                    }
                  />
                </Campo>
                <Campo etiqueta="Último día">
                  <input
                    className="input"
                    type="date"
                    min={evento.fechaInicio}
                    value={evento.fechaFin}
                    onInput={(e) =>
                      actualizarEvento(evento.id, { fechaFin: e.currentTarget.value })
                    }
                  />
                </Campo>
              </div>
            </div>
            <div className="row row--wrap" style={{ gap: 24 }}>
              <Interruptor
                valor={evento.requiereDocumento}
                etiqueta="Pedir verificación de documento antes de firmar"
                onCambio={(v) => actualizarEvento(evento.id, { requiereDocumento: v })}
              />
              <Interruptor
                valor={evento.permiteWalkIn}
                etiqueta="Permitir altas en el kiosko para quien no esté en lista"
                onCambio={(v) => actualizarEvento(evento.id, { permiteWalkIn: v })}
              />
            </div>
          </div>
        </section>

        {/* ── Servicios ── */}
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Servicios</h2>
              <p className="section__desc">
                Qué se entrega en este evento. Después definís en qué jornadas se presta cada uno.
              </p>
            </div>
            <div className="section__actions">
              <button className="btn btn--ghost" onClick={() => setCatalogoAbierto(true)}>
                <Icon name="mas" size={16} />
                Agregar servicio
              </button>
            </div>
          </div>

          {!servicios.length ? (
            <div className="card">
              <Vacio
                icono="plato"
                titulo="Sin servicios definidos"
                descripcion="Agregá desayuno, almuerzo, cena o lo que corresponda. Podés partir del catálogo o crear el tuyo."
                accion={
                  <button className="btn btn--primary" onClick={() => setCatalogoAbierto(true)}>
                    <Icon name="mas" size={16} />
                    Agregar servicio
                  </button>
                }
              />
            </div>
          ) : (
            <div className="grid grid--3">
              {servicios.map((srv) => {
                const enUso = slots.filter((s) => s.serviceId === srv.id).length;
                return (
                  <div key={srv.id} className="card card--pad">
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <div
                        className="matrix__srvIcon"
                        style={{ background: `${srv.color}22`, color: srv.color, border: `1px solid ${srv.color}44` }}
                      >
                        <Icon name={srv.icono} size={17} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{srv.nombre}</div>
                        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
                          {enUso ? `${enUso} de ${dias.length} jornadas` : 'Sin jornadas asignadas'}
                        </div>
                      </div>
                      <button
                        className="btn btn--quiet btn--icon btn--sm"
                        onClick={() => setServicioEnEdicion(srv)}
                        title="Editar"
                      >
                        <Icon name="lapiz" size={14} />
                      </button>
                      <button
                        className="btn btn--quiet btn--icon btn--sm"
                        onClick={() => setServicioAEliminar(srv)}
                        title="Eliminar"
                      >
                        <Icon name="papelera" size={14} />
                      </button>
                    </div>
                    <div className="row" style={{ marginTop: 12, gap: 8 }}>
                      <span className={srv.requiereFirma ? 'badge badge--brass' : 'badge'}>
                        <Icon name={srv.requiereFirma ? 'firma' : 'check'} size={12} />
                        {srv.requiereFirma ? 'Requiere firma' : 'Confirmación por toque'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Matriz ── */}
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Grilla de turnos</h2>
              <p className="section__desc">
                Tocá una celda para activar o desactivar ese servicio en esa jornada. Los turnos que
                queden apagados no existen para el kiosko ni para los reportes.
              </p>
            </div>
            <div className="section__actions">
              <span className="badge">
                {totalTurnos} turnos · {entregasPosibles.toLocaleString('es')} entregas posibles
              </span>
            </div>
          </div>

          {!servicios.length || !dias.length ? (
            <div className="card">
              <Vacio
                icono="matriz"
                titulo="La grilla necesita días y servicios"
                descripcion="Definí el rango de fechas del evento y agregá al menos un servicio."
              />
            </div>
          ) : (
            <div className="matrix">
              <table>
                <thead>
                  <tr>
                    <th className="matrix__corner matrix__dayCell">
                      <div className="eyebrow">Jornada</div>
                    </th>
                    {servicios.map((srv) => {
                      const activos = slots.filter((s) => s.serviceId === srv.id).length;
                      const todos = activos === dias.length;
                      return (
                        <th key={srv.id}>
                          <div className="matrix__srvHead">
                            <div
                              className="matrix__srvIcon"
                              style={{
                                background: `${srv.color}22`,
                                color: srv.color,
                                border: `1px solid ${srv.color}44`,
                              }}
                            >
                              <Icon name={srv.icono} size={16} />
                            </div>
                            <div className="matrix__srvName">{srv.nombre}</div>
                            <button
                              className="btn btn--quiet btn--sm"
                              style={{ height: 24, fontSize: 11 }}
                              onClick={async () => {
                                try {
                                  await aplicarATodos(evento.id, srv.id, !todos);
                                } catch (err) {
                                  toast({ tipo: 'error', titulo: 'No se pudo aplicar', detalle: msg(err) });
                                }
                              }}
                            >
                              {todos ? 'Quitar de todos' : 'Todos los días'}
                            </button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {dias.map((dia) => (
                    <tr key={dia.id}>
                      <td className="matrix__dayCell">
                        <input
                          className="input"
                          style={{
                            height: 30,
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontWeight: 600,
                            padding: '0 6px',
                          }}
                          value={dia.etiqueta}
                          onChange={(e) => renombrarDia(dia.id, e.target.value)}
                          title={fechaLarga(dia.fecha)}
                        />
                        <div style={{ fontSize: 11.5, color: 'var(--fg-3)', padding: '2px 7px 0' }}>
                          {fechaCorta(dia.fecha)}
                        </div>
                      </td>
                      {servicios.map((srv) => {
                        const slot = slots.find((s) => s.dayId === dia.id && s.serviceId === srv.id);
                        const bloqueado = slot ? slotConEntregas.has(slot.id) : false;
                        return (
                          <td key={srv.id} className="matrix__cell">
                            <button
                              className={`slotToggle${slot ? ' slotToggle--on' : ''}`}
                              style={
                                slot
                                  ? { background: `${srv.color}1c`, boxShadow: `inset 0 0 0 1px ${srv.color}3d` }
                                  : undefined
                              }
                              onClick={() => (slot ? setSlotEnEdicion(slot) : alternar(dia.id, srv.id))}
                              title={
                                slot
                                  ? bloqueado
                                    ? 'Turno con entregas registradas'
                                    : 'Editar horario y grupos'
                                  : 'Activar este servicio en esta jornada'
                              }
                            >
                              {slot ? (
                                <>
                                  <Icon name={bloqueado ? 'candado' : 'check'} size={15} style={{ color: srv.color }} />
                                  <span className="slotToggle__hours">
                                    {slot.horaDesde && slot.horaHasta
                                      ? `${slot.horaDesde}–${slot.horaHasta}`
                                      : 'sin horario'}
                                  </span>
                                  {slot.gruposHabilitados.length ? (
                                    <span className="slotToggle__cov" style={{ color: 'var(--fg-3)' }}>
                                      {slot.gruposHabilitados.length} grupo(s)
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <Icon name="mas" size={15} />
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalTurnos && !personas.length ? (
            <div className="notice notice--info" style={{ marginTop: 16 }}>
              <span className="notice__icon">
                <Icon name="info" size={16} />
              </span>
              <div>
                La grilla está lista pero el padrón está vacío.{' '}
                <button
                  className="btn btn--quiet btn--sm"
                  style={{ height: 22, padding: '0 6px', color: 'var(--brass-2)' }}
                  onClick={onIrAPadron}
                >
                  Importar personas desde Excel →
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <CatalogoModal
        abierto={catalogoAbierto}
        yaUsados={servicios.map((s) => s.nombre)}
        onCerrar={() => setCatalogoAbierto(false)}
        onElegir={async (nombre, icono, color, requiereFirma) => {
          await agregarServicio(evento.id, { nombre, icono, color, requiereFirma });
          setCatalogoAbierto(false);
        }}
      />

      <ServicioModal
        servicio={servicioEnEdicion}
        onCerrar={() => setServicioEnEdicion(null)}
        onGuardar={async (cambios) => {
          if (!servicioEnEdicion) return;
          await actualizarServicio(servicioEnEdicion.id, cambios);
          setServicioEnEdicion(null);
        }}
      />

      <SlotModal
        slot={slotEnEdicion}
        servicio={servicios.find((s) => s.id === slotEnEdicion?.serviceId) ?? null}
        dia={dias.find((d) => d.id === slotEnEdicion?.dayId)?.etiqueta ?? ''}
        grupos={grupos}
        bloqueado={slotEnEdicion ? slotConEntregas.has(slotEnEdicion.id) : false}
        onCerrar={() => setSlotEnEdicion(null)}
        onDesactivar={async () => {
          if (!slotEnEdicion) return;
          try {
            await alternarTurno(evento.id, slotEnEdicion.dayId, slotEnEdicion.serviceId);
            setSlotEnEdicion(null);
          } catch (err) {
            toast({ tipo: 'error', titulo: 'No se pudo desactivar', detalle: msg(err) });
          }
        }}
      />

      <Confirmar
        abierto={Boolean(servicioAEliminar)}
        titulo="Eliminar servicio"
        peligroso
        etiquetaOk="Eliminar"
        mensaje={
          <>
            Se quitará <strong>{servicioAEliminar?.nombre}</strong> de todas las jornadas del evento.
          </>
        }
        onCancelar={() => setServicioAEliminar(null)}
        onConfirmar={async () => {
          if (!servicioAEliminar) return;
          try {
            await eliminarServicio(servicioAEliminar.id);
            setServicioAEliminar(null);
          } catch (err) {
            toast({ tipo: 'error', titulo: 'No se pudo eliminar', detalle: msg(err) });
            setServicioAEliminar(null);
          }
        }}
      />
    </main>
  );
}

/* ─── Catálogo de servicios ──────────────────────────────────────── */

function CatalogoModal({
  abierto,
  yaUsados,
  onCerrar,
  onElegir,
}: {
  abierto: boolean;
  yaUsados: string[];
  onCerrar: () => void;
  onElegir: (nombre: string, icono: string, color: string, requiereFirma: boolean) => void;
}) {
  const [personalizado, setPersonalizado] = useState('');

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Agregar servicio"
      descripcion="Elegí del catálogo o creá uno con el nombre que uses internamente."
      ancho="wide"
    >
      <div className="grid grid--3" style={{ marginBottom: 22 }}>
        {PLANTILLAS_SERVICIO.map((p) => {
          const usado = yaUsados.includes(p.nombre);
          return (
            <button
              key={p.nombre}
              className="card card--pad"
              style={{
                textAlign: 'left',
                opacity: usado ? 0.4 : 1,
                cursor: usado ? 'not-allowed' : 'pointer',
              }}
              disabled={usado}
              onClick={() => onElegir(p.nombre, p.icono, p.color, p.requiereFirma)}
            >
              <div className="row">
                <div
                  className="matrix__srvIcon"
                  style={{ background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}44` }}
                >
                  <Icon name={p.icono} size={16} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.nombre}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                    {usado ? 'Ya agregado' : p.horaDesde ? `${p.horaDesde}–${p.horaHasta}` : 'Sin horario fijo'}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="card card--pad">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Servicio propio
        </div>
        <div className="row">
          <input
            className="input"
            placeholder="Ej: Refrigerio nocturno, Kit de bienvenida…"
            value={personalizado}
            onChange={(e) => setPersonalizado(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && personalizado.trim()) {
                onElegir(personalizado.trim(), 'caja', COLORES_SERVICIO[0], true);
                setPersonalizado('');
              }
            }}
          />
          <button
            className="btn btn--primary"
            disabled={!personalizado.trim()}
            onClick={() => {
              onElegir(personalizado.trim(), 'caja', COLORES_SERVICIO[0], true);
              setPersonalizado('');
            }}
          >
            Agregar
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Edición de servicio ────────────────────────────────────────── */

function ServicioModal({
  servicio,
  onCerrar,
  onGuardar,
}: {
  servicio: Service | null;
  onCerrar: () => void;
  onGuardar: (cambios: Partial<Service>) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [icono, setIcono] = useState('caja');
  const [color, setColor] = useState(COLORES_SERVICIO[0]);
  const [firma, setFirma] = useState(true);
  const [idCargado, setIdCargado] = useState<string | null>(null);

  if (servicio && servicio.id !== idCargado) {
    setIdCargado(servicio.id);
    setNombre(servicio.nombre);
    setIcono(servicio.icono);
    setColor(servicio.color);
    setFirma(servicio.requiereFirma);
  }

  return (
    <Modal
      abierto={Boolean(servicio)}
      onCerrar={onCerrar}
      titulo="Editar servicio"
      pie={
        <>
          <div className="spacer" />
          <button className="btn btn--ghost" onClick={onCerrar}>
            Cancelar
          </button>
          <button
            className="btn btn--primary"
            onClick={() => onGuardar({ nombre: nombre.trim() || 'Servicio', icono, color, requiereFirma: firma })}
          >
            Guardar
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 18 }}>
        <Campo etiqueta="Nombre">
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Campo>

        <div className="field">
          <span className="field__label">Ícono</span>
          <div className="row row--wrap" style={{ gap: 7 }}>
            {ICONOS_SERVICIO.map((i) => (
              <button
                key={i}
                className="matrix__srvIcon"
                style={{
                  width: 38,
                  height: 38,
                  background: icono === i ? `${color}26` : 'var(--surface-2)',
                  color: icono === i ? color : 'var(--fg-3)',
                  border: `1px solid ${icono === i ? `${color}55` : 'var(--line)'}`,
                }}
                onClick={() => setIcono(i)}
              >
                <Icon name={i} size={18} />
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Color</span>
          <div className="row row--wrap" style={{ gap: 7 }}>
            {COLORES_SERVICIO.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: c,
                  border: color === c ? '2px solid var(--fg)' : '1px solid var(--line-2)',
                }}
              />
            ))}
          </div>
        </div>

        <Interruptor
          valor={firma}
          etiqueta="Requiere firma del receptor"
          onCambio={setFirma}
        />
        <p className="field__hint" style={{ marginTop: -8 }}>
          Si lo desactivás, la entrega se confirma con un toque y queda registrada igual con hora,
          operador y sello, pero sin trazo de firma.
        </p>
      </div>
    </Modal>
  );
}

/* ─── Edición de turno ───────────────────────────────────────────── */

function SlotModal({
  slot,
  servicio,
  dia,
  grupos,
  bloqueado,
  onCerrar,
  onDesactivar,
}: {
  slot: Slot | null;
  servicio: Service | null;
  dia: string;
  grupos: string[];
  bloqueado: boolean;
  onCerrar: () => void;
  onDesactivar: () => void;
}) {
  const actualizarTurno = useStore((s) => s.actualizarTurno);
  if (!slot || !servicio) return null;

  const seleccionados = new Set(slot.gruposHabilitados);

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`${servicio.nombre} · ${dia}`}
      descripcion="Horario informativo y control de qué grupos pueden recibir en este turno."
      pie={
        <>
          <button className="btn btn--danger" onClick={onDesactivar} disabled={bloqueado}>
            <Icon name="menos" size={15} />
            Desactivar turno
          </button>
          <div className="spacer" />
          <button className="btn btn--primary" onClick={onCerrar}>
            Listo
          </button>
        </>
      }
    >
      {bloqueado ? (
        <div className="notice notice--warn" style={{ marginBottom: 18 }}>
          <span className="notice__icon">
            <Icon name="candado" size={16} />
          </span>
          <span>
            Este turno ya tiene entregas firmadas. Podés ajustar el horario, pero no desactivarlo:
            el acta quedaría sin respaldo.
          </span>
        </div>
      ) : null}

      <div className="grid grid--2" style={{ marginBottom: 20 }}>
        <Campo etiqueta="Desde">
          <input
            className="input"
            type="time"
            value={slot.horaDesde}
            onChange={(e) => actualizarTurno(slot.id, { horaDesde: e.target.value })}
          />
        </Campo>
        <Campo etiqueta="Hasta">
          <input
            className="input"
            type="time"
            value={slot.horaHasta}
            onChange={(e) => actualizarTurno(slot.id, { horaHasta: e.target.value })}
          />
        </Campo>
      </div>

      <div className="field">
        <span className="field__label">Grupos habilitados</span>
        <p className="field__hint" style={{ marginBottom: 8 }}>
          Sin selección, todo el padrón puede recibir. Útil cuando, por ejemplo, la cena es solo
          para staff.
        </p>
        {!grupos.length ? (
          <div className="notice">
            <span className="notice__icon">
              <Icon name="info" size={16} />
            </span>
            <span>El padrón todavía no tiene grupos cargados.</span>
          </div>
        ) : (
          <div className="row row--wrap" style={{ gap: 7 }}>
            <button
              className={`chip${!seleccionados.size ? ' chip--on' : ''}`}
              onClick={() => actualizarTurno(slot.id, { gruposHabilitados: [] })}
            >
              Todos
            </button>
            {grupos.map((g) => (
              <button
                key={g}
                className={`chip${seleccionados.has(g) ? ' chip--on' : ''}`}
                onClick={() => {
                  const next = new Set(seleccionados);
                  if (next.has(g)) next.delete(g);
                  else next.add(g);
                  actualizarTurno(slot.id, { gruposHabilitados: [...next] });
                }}
              >
                {seleccionados.has(g) ? <Icon name="check" size={13} /> : null}
                {g}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : 'Error inesperado';
}

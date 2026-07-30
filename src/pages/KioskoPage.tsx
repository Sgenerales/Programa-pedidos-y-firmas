import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal, Vacio } from '../components/ui';
import { PersonaModal } from './PadronPage';
import { SignaturePad, type SignaturePadHandle } from '../components/SignaturePad';
import { useStore } from '../store/useStore';
import {
  buscar,
  construirIndice,
  etiquetaTurno,
  filasKiosko,
  gruposDelPadron,
  asisteEnDia,
  resumenTurno,
} from '../store/selectors';
import { suscribirEntregas } from '../lib/supabase';
import { HAY_NUBE } from '../lib/config';
import { SyncPill } from '../components/SyncPill';
import { fechaCorta, hora, hoyISO, iniciales, norm, pct } from '../lib/util';
import type { Delivery, PersonRow, Slot } from '../types';

type Filtro = 'pendientes' | 'entregados' | 'todos';

export function KioskoPage({ onSalir }: { onSalir: () => void }) {
  const eventos = useStore((s) => s.eventos);
  const eventoId = useStore((s) => s.eventoId);
  const dias = useStore((s) => s.dias);
  const servicios = useStore((s) => s.servicios);
  const slots = useStore((s) => s.slots);
  const personas = useStore((s) => s.personas);
  const entregas = useStore((s) => s.entregas);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const sincronizar = useStore((s) => s.sincronizar);
  const sesion = useStore((s) => s.sesion);
  const agregarPersona = useStore((s) => s.agregarPersona);
  const toast = useStore((s) => s.toast);

  const [consulta, setConsulta] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [selector, setSelector] = useState(false);
  const [enFirma, setEnFirma] = useState<PersonRow | null>(null);
  const [detalle, setDetalle] = useState<PersonRow | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [sello, setSello] = useState<{ nombre: string; hora: string; codigo: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const evento = eventos.find((e) => e.id === eventoId) ?? null;

  /* — Turno activo: si no hay uno elegido, proponemos el de ahora — */
  const slotActivo = useMemo<Slot | null>(() => {
    const guardado = slots.find((s) => s.id === settings.slotActivoId);
    if (guardado) return guardado;
    return slotSugerido(slots, dias, servicios);
  }, [slots, dias, servicios, settings.slotActivoId]);

  useEffect(() => {
    if (slotActivo && settings.slotActivoId !== slotActivo.id) {
      setSettings({ slotActivoId: slotActivo.id });
    }
  }, [slotActivo, settings.slotActivoId, setSettings]);

  /* — Tiempo real con los otros puestos —
     La subida periódica la maneja el motor global de App: acá solo
     escuchamos para reflejar al instante lo que registra otra tablet. */
  useEffect(() => {
    if (!HAY_NUBE || !eventoId || !sesion) return;
    return suscribirEntregas(eventoId, () => void sincronizar({ silencioso: true }));
  }, [eventoId, sesion, sincronizar]);

  /* — Datos derivados — */
  const indice = useMemo(() => construirIndice(personas), [personas]);

  const filas = useMemo(() => {
    if (!slotActivo) return [];
    const encontradas = buscar(indice, consulta);
    return filasKiosko({ personas: encontradas, entregas, slots, servicios, slotActivo });
  }, [indice, consulta, entregas, slots, servicios, slotActivo]);

  const visibles = useMemo(() => {
    const base = filas.filter((f) => f.habilitada || f.entrega);
    if (filtro === 'pendientes') return base.filter((f) => !f.entrega);
    if (filtro === 'entregados') return base.filter((f) => f.entrega);
    return base;
  }, [filas, filtro]);

  const resumen = useMemo(
    () => (slotActivo ? resumenTurno(personas, entregas, slotActivo) : { total: 0, entregados: 0, pendientes: 0 }),
    [personas, entregas, slotActivo],
  );

  const bloqueadas = useMemo(
    () => filas.filter((f) => !f.habilitada && !f.entrega).length,
    [filas],
  );

  const terminos = useMemo(() => norm(consulta).split(' ').filter(Boolean), [consulta]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [slotActivo?.id]);

  if (!evento) return null;

  if (!slots.length) {
    return (
      <div className="kiosk">
        <BarraMinima onSalir={onSalir} titulo={evento.nombre} />
        <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <Vacio
            icono="matriz"
            titulo="Este evento no tiene turnos activos"
            descripcion="Andá a Configuración y activá al menos un servicio en una jornada de la grilla."
            accion={
              <button className="btn btn--primary" onClick={onSalir}>
                Volver
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (!personas.length) {
    return (
      <div className="kiosk">
        <BarraMinima onSalir={onSalir} titulo={evento.nombre} />
        <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <Vacio
            icono="personas"
            titulo="El padrón está vacío"
            descripcion="Importá la lista de personas antes de abrir el kiosko."
            accion={
              <button className="btn btn--primary" onClick={onSalir}>
                Volver
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const et = slotActivo ? etiquetaTurno(slotActivo, dias, servicios) : null;
  const servicioActivo = servicios.find((s) => s.id === slotActivo?.serviceId) ?? null;

  return (
    <div className="kiosk">
      {/* ── Barra de turno ── */}
      <header className="kioskBar">
        <button
          className="btn btn--quiet btn--icon"
          onClick={onSalir}
          title="Salir del kiosko"
          aria-label="Salir del kiosko"
        >
          <Icon name="flechaIzq" size={18} />
        </button>

        <button className="kioskBar__slot" onClick={() => setSelector(true)}>
          {et ? (
            <>
              <span
                className="kioskBar__slotIcon"
                style={{ background: `${et.color}22`, color: et.color, border: `1px solid ${et.color}44` }}
              >
                <Icon name={et.icono} size={19} />
              </span>
              <span style={{ textAlign: 'left' }}>
                <span className="kioskBar__slotName" style={{ display: 'block' }}>
                  {et.servicio}
                </span>
                <span className="kioskBar__slotDay">
                  {et.dia} · {fechaCorta(et.fecha)}
                  {slotActivo?.horaDesde ? ` · ${slotActivo.horaDesde}–${slotActivo.horaHasta}` : ''}
                </span>
              </span>
              <Icon name="chevronAbajo" size={15} style={{ color: 'var(--fg-3)', marginLeft: 4 }} />
            </>
          ) : (
            'Elegir turno'
          )}
        </button>

        <div className="spacer" />

        <SyncPill compacto />

        <div style={{ width: 150 }}>
          <div className="bar" style={{ marginBottom: 5 }}>
            <div
              className={`bar__fill${resumen.pendientes === 0 ? ' bar__fill--ok' : ''}`}
              style={{ width: `${pct(resumen.entregados, resumen.total)}%` }}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', textAlign: 'right' }}>
            {pct(resumen.entregados, resumen.total)}% del turno
          </div>
        </div>

        <div className="kioskBar__counter">
          <div className="kioskBar__counterNum">
            {resumen.entregados}
            <span> / {resumen.total}</span>
          </div>
          <div className="kioskBar__counterLabel">entregados</div>
        </div>
      </header>

      {/* ── Buscador ── */}
      <div className="kioskSearch">
        <div className="kioskSearch__box">
          <span className="kioskSearch__icon">
            <Icon name="buscar" size={22} />
          </span>
          <input
            ref={inputRef}
            className="kioskSearch__input"
            value={consulta}
            placeholder="Buscar por nombre o documento…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setConsulta('');
              // Enter con un único resultado pendiente abre la firma directo.
              if (e.key === 'Enter') {
                const unicos = visibles.filter((f) => !f.entrega && f.habilitada);
                if (unicos.length === 1) setEnFirma(unicos[0]);
              }
            }}
          />
          {consulta ? (
            <button className="kioskSearch__clear" onClick={() => setConsulta('')} aria-label="Limpiar">
              <Icon name="x" size={17} />
            </button>
          ) : null}
        </div>

        <div className="kioskSearch__meta">
          <div className="btnGroup">
            <button aria-pressed={filtro === 'pendientes'} onClick={() => setFiltro('pendientes')}>
              Pendientes {resumen.pendientes}
            </button>
            <button aria-pressed={filtro === 'entregados'} onClick={() => setFiltro('entregados')}>
              Entregados {resumen.entregados}
            </button>
            <button aria-pressed={filtro === 'todos'} onClick={() => setFiltro('todos')}>
              Todos
            </button>
          </div>
          <div className="spacer" />
          {bloqueadas ? (
            <span className="muted" title="Personas que no asisten esta jornada o cuyo rol no está habilitado">
              {bloqueadas} fuera de este turno
            </span>
          ) : null}
          {evento.permiteWalkIn ? (
            <button className="btn btn--ghost btn--sm" onClick={() => setWalkIn(true)}>
              <Icon name="mas" size={14} />
              No está en lista
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Resultados ── */}
      <div className="kioskList">
        <div className="kioskList__inner">
          {visibles.slice(0, 120).map((fila, i) => (
            <FilaPersona
              key={fila.person.id}
              fila={fila}
              indice={i}
              terminos={terminos}
              slotActivoId={slotActivo?.id ?? ''}
              dayId={slotActivo?.dayId ?? ''}
              onFirmar={() => setEnFirma(fila)}
              onVerDetalle={() => setDetalle(fila)}
            />
          ))}

          {!visibles.length ? (
            <Vacio
              icono={consulta ? 'buscar' : 'sello'}
              titulo={
                consulta
                  ? 'Nadie coincide con esa búsqueda'
                  : filtro === 'pendientes'
                    ? 'Turno completo'
                    : 'Sin registros todavía'
              }
              descripcion={
                consulta
                  ? 'Probá con el apellido, o con el número de documento.'
                  : filtro === 'pendientes'
                    ? `Las ${resumen.total} personas habilitadas ya recibieron ${servicioActivo?.nombre.toLowerCase() ?? 'este servicio'}.`
                    : 'Cuando alguien firme, va a aparecer acá.'
              }
              accion={
                consulta && evento.permiteWalkIn ? (
                  <button className="btn btn--ghost" onClick={() => setWalkIn(true)}>
                    <Icon name="mas" size={15} />
                    Agregar a «{consulta}»
                  </button>
                ) : undefined
              }
            />
          ) : null}

          {visibles.length > 120 ? (
            <p className="muted" style={{ textAlign: 'center', fontSize: 12.5, padding: '10px 0' }}>
              Mostrando 120 de {visibles.length}. Escribí para acotar la búsqueda.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Modales ── */}
      <SelectorTurno
        abierto={selector}
        onCerrar={() => setSelector(false)}
        onElegir={(id) => {
          setSettings({ slotActivoId: id });
          setSelector(false);
          setConsulta('');
        }}
      />

      {enFirma && slotActivo ? (
        <ModalFirma
          fila={enFirma}
          slot={slotActivo}
          onCerrar={() => setEnFirma(null)}
          onListo={(d) => {
            setEnFirma(null);
            setConsulta('');
            setSello({
              nombre: d.nombreFirmante,
              hora: hora(d.firmadoEn),
              codigo: d.sello,
            });
            inputRef.current?.focus();
            void sincronizar({ silencioso: true });
          }}
        />
      ) : null}

      {detalle?.entrega ? (
        <DetalleEntrega fila={detalle} onCerrar={() => setDetalle(null)} />
      ) : null}

      <PersonaModal
        persona={
          walkIn
            ? {
                id: '',
                eventId: evento.id,
                nombre: consulta.trim(),
                documento: '',
                empresa: '',
                grupo: '',
                referencia: '',
                telefono: '',
                activo: true,
                origen: 'manual',
                // null = asiste a todas las jornadas. Quien aparece sin
                // estar en lista no tiene asistencia declarada, y negarle
                // el resto del evento sería peor que habilitarlo.
                diasHabilitados: null,
                creadoEn: new Date().toISOString(),
              }
            : null
        }
        grupos={gruposDelPadron(personas)}
        onCerrar={() => setWalkIn(false)}
        onGuardar={async (datos) => {
          try {
            const p = await agregarPersona(evento.id, datos);
            setWalkIn(false);
            setConsulta(p.nombre);
            toast({ tipo: 'ok', titulo: 'Persona agregada al padrón', detalle: p.nombre });
          } catch (err) {
            toast({ tipo: 'error', titulo: 'No se pudo agregar', detalle: msg(err) });
          }
        }}
      />

      {sello ? <SelloExito datos={sello} onFin={() => setSello(null)} /> : null}
    </div>
  );
}

/* ═══ Fila ═════════════════════════════════════════════════════════ */

function FilaPersona({
  fila,
  indice,
  terminos,
  slotActivoId,
  dayId,
  onFirmar,
  onVerDetalle,
}: {
  fila: PersonRow;
  indice: number;
  terminos: string[];
  slotActivoId: string;
  dayId: string;
  onFirmar: () => void;
  onVerDetalle: () => void;
}) {
  const { person, entrega, habilitada, jornada } = fila;
  const clickeable = !entrega && habilitada;
  const asiste = asisteEnDia(person, dayId);

  const meta = [person.documento, person.empresa, person.referencia].filter(Boolean);

  return (
    <button
      className={`pRow${clickeable ? ' pRow--tappable' : ''}${entrega ? ' pRow--done' : ''}${
        !habilitada && !entrega ? ' pRow--blocked' : ''
      }`}
      style={{ animationDelay: `${Math.min(indice, 12) * 16}ms` }}
      onClick={clickeable ? onFirmar : entrega ? onVerDetalle : undefined}
      disabled={!clickeable && !entrega}
      title={
        entrega
          ? `Registrado a las ${hora(entrega.firmadoEn)} por ${entrega.operador}`
          : habilitada
            ? 'Registrar entrega'
            : asiste
              ? `El rol «${person.grupo}» no está habilitado en este turno`
              : 'La lista indica que esta persona no asiste en esta jornada'
      }
    >
      <span className="pRow__avatar">{iniciales(person.nombre)}</span>

      <span className="pRow__main">
        <span className="pRow__name">{resaltar(person.nombre, terminos)}</span>
        {meta.length || person.grupo ? (
          <span className="pRow__meta">
            {person.grupo ? <span className="badge">{person.grupo}</span> : null}
            {meta.map((m, i) => (
              <span key={i} style={{ display: 'contents' }}>
                {i > 0 || person.grupo ? <span className="pRow__sep" /> : null}
                <span className="truncate">{m}</span>
              </span>
            ))}
          </span>
        ) : null}
      </span>

      <span className="pRow__right">
        {jornada.length > 1 ? (
          <span className="journey" title="Servicios de esta jornada">
            {jornada.map((j) => (
              <span
                key={j.slotId}
                className={`journey__dot${j.entregado ? ' journey__dot--done' : ''}${
                  j.slotId === slotActivoId ? ' journey__dot--current' : ''
                }`}
                style={j.entregado ? { background: j.serviceColor, borderColor: j.serviceColor } : undefined}
                title={`${j.serviceNombre}: ${j.entregado ? `entregado ${j.hora}` : 'pendiente'}`}
              >
                <Icon name={j.serviceIcono} size={13} />
              </span>
            ))}
          </span>
        ) : null}

        {entrega ? (
          <span className="pRow__status">
            <span className="pRow__statusTime">{hora(entrega.firmadoEn)}</span>
            <span className="pRow__statusLabel">{entrega.conFirma ? 'firmado' : 'confirmado'}</span>
          </span>
        ) : habilitada ? (
          <span className="pRow__cta">
            <Icon name="firma" size={19} />
          </span>
        ) : (
          <span className="badge">{asiste ? 'Rol no habilitado' : 'No asiste hoy'}</span>
        )}
      </span>
    </button>
  );
}

function resaltar(texto: string, terminos: string[]) {
  if (!terminos.length) return texto;
  const palabras = texto.split(/(\s+)/);
  return palabras.map((palabra, i) => {
    const n = norm(palabra);
    const t = terminos.find((x) => n.startsWith(x));
    if (!t) return palabra;
    return (
      <span key={i}>
        <mark>{palabra.slice(0, t.length)}</mark>
        {palabra.slice(t.length)}
      </span>
    );
  });
}

/* ═══ Modal de firma ═══════════════════════════════════════════════ */

function ModalFirma({
  fila,
  slot,
  onCerrar,
  onListo,
}: {
  fila: PersonRow;
  slot: Slot;
  onCerrar: () => void;
  onListo: (d: Delivery) => void;
}) {
  const eventos = useStore((s) => s.eventos);
  const eventoId = useStore((s) => s.eventoId);
  const servicios = useStore((s) => s.servicios);
  const dias = useStore((s) => s.dias);
  const registrarEntrega = useStore((s) => s.registrarEntrega);

  const evento = eventos.find((e) => e.id === eventoId)!;
  const servicio = servicios.find((s) => s.id === slot.serviceId)!;
  const dia = dias.find((d) => d.id === slot.dayId);

  const padRef = useRef<SignaturePadHandle>(null);
  const [tieneTrazo, setTieneTrazo] = useState(false);
  const [docVerificado, setDocVerificado] = useState(!evento.requiereDocumento);
  const [observacion, setObservacion] = useState('');
  const [notaAbierta, setNotaAbierta] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [duplicado, setDuplicado] = useState<Delivery | null>(null);

  const requiereFirma = servicio.requiereFirma;
  const puedeConfirmar = docVerificado && (!requiereFirma || tieneTrazo) && !guardando;

  async function confirmar() {
    setError('');
    setGuardando(true);
    try {
      const exportado = requiereFirma ? padRef.current?.exportar() : null;
      if (requiereFirma && !exportado) {
        setError('No se pudo leer el trazo. Volvé a firmar.');
        setGuardando(false);
        return;
      }
      const res = await registrarEntrega({
        personId: fila.person.id,
        slotId: slot.id,
        trazos: exportado?.trazos ?? [],
        png: exportado?.png ?? '',
        ancho: exportado?.ancho ?? 0,
        alto: exportado?.alto ?? 0,
        observacion,
      });

      if (res.ok) {
        onListo(res.delivery);
        return;
      }
      if (res.motivo === 'duplicado') {
        setDuplicado(res.existente);
        return;
      }
      // El trazo sigue en el canvas: reintentar no obliga a firmar de nuevo.
      setError(res.mensaje);
    } catch (err) {
      setError(msg(err));
    } finally {
      setGuardando(false);
    }
  }

  if (duplicado) {
    return (
      <Modal
        abierto
        onCerrar={onCerrar}
        titulo="Ya estaba registrado"
        pie={
          <>
            <div className="spacer" />
            <button className="btn btn--primary" onClick={onCerrar}>
              Entendido
            </button>
          </>
        }
      >
        <div className="notice notice--warn" style={{ marginBottom: 18 }}>
          <span className="notice__icon">
            <Icon name="alerta" size={17} />
          </span>
          <div>
            <strong>{duplicado.nombreFirmante}</strong> ya recibió{' '}
            <strong>{servicio.nombre.toLowerCase()}</strong> de {dia?.etiqueta.toLowerCase()} a las{' '}
            <strong>{hora(duplicado.firmadoEn)}</strong>.
            <div style={{ marginTop: 6, color: 'var(--fg-3)', fontSize: 12.5 }}>
              Registrado por {duplicado.operador} · {duplicado.dispositivo}
            </div>
          </div>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--fg-3)' }}>
          No se sobreescribió nada: la primera firma es la que vale. Si hubo un error, anulá la
          entrega desde Reportes dejando constancia del motivo.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="sign"
      bloqueado={guardando}
      cabecera={
        <div className="sign__identity">
          <span className="sign__avatar">{iniciales(fila.person.nombre)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="sign__name">{fila.person.nombre}</div>
            <div className="sign__meta">
              {fila.person.documento ? (
                <span className="badge badge--info">
                  <Icon name="credencial" size={12} />
                  {fila.person.documento}
                </span>
              ) : null}
              {fila.person.grupo ? <span className="badge">{fila.person.grupo}</span> : null}
              {fila.person.empresa ? <span className="muted">{fila.person.empresa}</span> : null}
              {fila.person.referencia ? <span className="muted">· {fila.person.referencia}</span> : null}
            </div>
          </div>
          <div className="sign__service">
            <div
              className="matrix__srvIcon"
              style={{
                marginLeft: 'auto',
                background: `${servicio.color}22`,
                color: servicio.color,
                border: `1px solid ${servicio.color}44`,
              }}
            >
              <Icon name={servicio.icono} size={17} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 5 }}>{servicio.nombre}</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{dia?.etiqueta}</div>
          </div>
        </div>
      }
      pie={
        <>
          {requiereFirma ? (
            <button
              className="btn btn--ghost"
              onClick={() => {
                padRef.current?.limpiar();
                setError('');
              }}
              disabled={!tieneTrazo || guardando}
            >
              <Icon name="refrescar" size={15} />
              Borrar trazo
            </button>
          ) : null}
          <button className="btn btn--quiet btn--sm" onClick={() => setNotaAbierta((v) => !v)}>
            <Icon name="lapiz" size={14} />
            {observacion ? 'Nota agregada' : 'Agregar nota'}
          </button>
          <div className="spacer" />
          <button className="btn btn--ghost" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button className="btn btn--ok btn--lg" disabled={!puedeConfirmar} onClick={confirmar}>
            {guardando ? (
              'Registrando…'
            ) : (
              <>
                <Icon name="sello" size={18} />
                Confirmar entrega
              </>
            )}
          </button>
        </>
      }
    >
      {evento.requiereDocumento ? (
        <label
          className="notice notice--warn"
          style={{ marginBottom: 14, cursor: 'pointer', alignItems: 'center' }}
        >
          <input
            type="checkbox"
            checked={docVerificado}
            onChange={(e) => setDocVerificado(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: 'var(--brass)' }}
          />
          <span>
            Verifiqué el documento de identidad y coincide con el nombre de arriba.
          </span>
        </label>
      ) : null}

      {notaAbierta ? (
        <div className="field" style={{ marginBottom: 14 }}>
          <span className="field__label">Observación (queda en el acta)</span>
          <input
            className="input"
            autoFocus
            value={observacion}
            placeholder="Ej: retira por un tercero, menú especial…"
            onChange={(e) => setObservacion(e.target.value)}
          />
        </div>
      ) : null}

      {requiereFirma ? (
        <div className="padWrap" style={{ padding: 0 }}>
          <SignaturePad
            ref={padRef}
            onCambio={(v) => {
              setTieneTrazo(v);
              if (v) setError('');
            }}
            deshabilitado={guardando}
            leyenda={`Confirmo la recepción de ${servicio.nombre.toLowerCase()} · ${dia?.etiqueta ?? ''}`}
          />
        </div>
      ) : (
        <div className="notice notice--info">
          <span className="notice__icon">
            <Icon name="info" size={16} />
          </span>
          <span>
            <strong>{servicio.nombre}</strong> no requiere firma. La entrega se registra igual con
            hora, operador, dispositivo y sello de verificación.
          </span>
        </div>
      )}

      {error ? (
        <div className="sign__error" style={{ margin: '14px 0 0' }}>
          <Icon name="alerta" size={17} />
          <div>
            <strong>No se pudo guardar.</strong> {error}
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              El trazo sigue dibujado: tocá «Confirmar entrega» de nuevo para reintentar.
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/* ═══ Detalle de entrega ═══════════════════════════════════════════ */

function DetalleEntrega({ fila, onCerrar }: { fila: PersonRow; onCerrar: () => void }) {
  const obtenerFirma = useStore((s) => s.obtenerFirma);
  const [png, setPng] = useState<string | null>(null);
  const [cargandoFirma, setCargandoFirma] = useState(true);
  const entrega = fila.entrega!;

  useEffect(() => {
    let vivo = true;
    setCargandoFirma(true);
    void obtenerFirma(entrega.id)
      .then((f) => {
        if (vivo) setPng(f?.png || null);
      })
      .catch(() => {
        if (vivo) setPng(null);
      })
      .finally(() => {
        if (vivo) setCargandoFirma(false);
      });
    return () => {
      vivo = false;
    };
  }, [entrega.id, obtenerFirma]);

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={entrega.nombreFirmante}
      descripcion={`Registrado a las ${hora(entrega.firmadoEn)}`}
      pie={
        <>
          <div className="spacer" />
          <button className="btn btn--primary" onClick={onCerrar}>
            Cerrar
          </button>
        </>
      }
    >
      {cargandoFirma && entrega.conFirma ? (
        <div className="skeleton" style={{ height: 96, marginBottom: 16 }} />
      ) : png ? (
        <div className="sigPreview" style={{ marginBottom: 16 }}>
          <img src={png} alt={`Firma de ${entrega.nombreFirmante}`} />
        </div>
      ) : entrega.conFirma ? (
        <div className="notice notice--danger" style={{ marginBottom: 16 }}>
          <span className="notice__icon">
            <Icon name="alerta" size={16} />
          </span>
          <span>La entrega indica que fue firmada, pero la firma no está disponible en este dispositivo.</span>
        </div>
      ) : (
        <div className="notice" style={{ marginBottom: 16 }}>
          <span className="notice__icon">
            <Icon name="info" size={16} />
          </span>
          <span>Este servicio se confirma por toque, sin firma.</span>
        </div>
      )}

      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '9px 18px', fontSize: 13.5 }}>
        <Dato k="Documento" v={entrega.documentoFirmante || '—'} />
        <Dato k="Operador" v={entrega.operador} />
        <Dato k="Dispositivo" v={entrega.dispositivo} />
        <Dato k="Sello" v={<span className="mono">{entrega.sello}</span>} />
        {entrega.observacion ? <Dato k="Observación" v={entrega.observacion} /> : null}
      </dl>
    </Modal>
  );
}

function Dato({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt style={{ color: 'var(--fg-3)' }}>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

/* ═══ Selector de turno ════════════════════════════════════════════ */

function SelectorTurno({
  abierto,
  onCerrar,
  onElegir,
}: {
  abierto: boolean;
  onCerrar: () => void;
  onElegir: (slotId: string) => void;
}) {
  const dias = useStore((s) => s.dias);
  const servicios = useStore((s) => s.servicios);
  const slots = useStore((s) => s.slots);
  const personas = useStore((s) => s.personas);
  const entregas = useStore((s) => s.entregas);
  const activo = useStore((s) => s.settings.slotActivoId);
  const hoy = hoyISO();

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      ancho="wide"
      titulo="Cambiar de turno"
      descripcion="Cada turno tiene su propio registro de entregas."
    >
      <div className="col" style={{ gap: 20 }}>
        {dias.map((dia) => {
          const delDia = slots.filter((s) => s.dayId === dia.id);
          if (!delDia.length) return null;
          return (
            <div key={dia.id}>
              <div className="row" style={{ marginBottom: 9 }}>
                <span className="eyebrow">{dia.etiqueta}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {fechaCorta(dia.fecha)}
                </span>
                {dia.fecha === hoy ? <span className="badge badge--brass">Hoy</span> : null}
              </div>
              <div className="grid grid--3">
                {delDia.map((slot) => {
                  const srv = servicios.find((s) => s.id === slot.serviceId);
                  if (!srv) return null;
                  const r = resumenTurno(personas, entregas, slot);
                  const esActivo = slot.id === activo;
                  return (
                    <button
                      key={slot.id}
                      className="card card--pad"
                      style={{
                        textAlign: 'left',
                        borderColor: esActivo ? 'var(--brass-line)' : undefined,
                        background: esActivo ? 'var(--brass-dim)' : undefined,
                      }}
                      onClick={() => onElegir(slot.id)}
                    >
                      <div className="row">
                        <span
                          className="matrix__srvIcon"
                          style={{ background: `${srv.color}22`, color: srv.color, border: `1px solid ${srv.color}44` }}
                        >
                          <Icon name={srv.icono} size={16} />
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14.5 }}>{srv.nombre}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                            {slot.horaDesde ? `${slot.horaDesde}–${slot.horaHasta}` : 'sin horario'}
                          </div>
                        </div>
                        {esActivo ? <Icon name="check" size={16} style={{ color: 'var(--brass)' }} /> : null}
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
                          <span className="muted">
                            {r.entregados} de {r.total}
                          </span>
                          <span className="tabular" style={{ fontWeight: 600 }}>
                            {pct(r.entregados, r.total)}%
                          </span>
                        </div>
                        <div className="bar">
                          <div
                            className={`bar__fill${r.pendientes === 0 && r.total ? ' bar__fill--ok' : ''}`}
                            style={{ width: `${pct(r.entregados, r.total)}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* ═══ Sello de éxito ═══════════════════════════════════════════════ */

function SelloExito({
  datos,
  onFin,
}: {
  datos: { nombre: string; hora: string; codigo: string };
  onFin: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onFin, 1600);
    return () => clearTimeout(t);
  }, [onFin]);

  return (
    <div className="stamp" onClick={onFin} role="status" aria-live="polite">
      <div className="stamp__inner">
        <div className="stamp__seal">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
            <path
              d="m4.5 12.5 5 5 10-11"
              stroke="var(--ok)"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="stamp__name">{datos.nombre}</div>
        <div className="stamp__meta">Entrega registrada a las {datos.hora}</div>
        <div className="stamp__code">SELLO {datos.codigo}</div>
      </div>
    </div>
  );
}

/* ═══ Auxiliares ═══════════════════════════════════════════════════ */

function BarraMinima({ onSalir, titulo }: { onSalir: () => void; titulo: string }) {
  return (
    <header className="kioskBar">
      <button className="btn btn--quiet btn--icon" onClick={onSalir} aria-label="Salir del kiosko">
        <Icon name="flechaIzq" size={18} />
      </button>
      <span className="kioskBar__slotName">{titulo}</span>
    </header>
  );
}

/** Propone el turno más plausible: mismo día y franja horaria en curso. */
function slotSugerido(
  slots: Slot[],
  dias: { id: string; fecha: string }[],
  servicios: { id: string; orden: number }[],
): Slot | null {
  if (!slots.length) return null;
  const hoy = hoyISO();
  const diaHoy = dias.find((d) => d.fecha === hoy);
  const orden = new Map(servicios.map((s) => [s.id, s.orden]));
  const candidatos = diaHoy ? slots.filter((s) => s.dayId === diaHoy.id) : [];

  if (candidatos.length) {
    const ahora = new Date();
    const minutos = ahora.getHours() * 60 + ahora.getMinutes();
    const enFranja = candidatos.find((s) => {
      if (!s.horaDesde || !s.horaHasta) return false;
      return minutos >= aMinutos(s.horaDesde) - 45 && minutos <= aMinutos(s.horaHasta) + 45;
    });
    if (enFranja) return enFranja;
    const proximo = candidatos
      .filter((s) => s.horaDesde && aMinutos(s.horaDesde) >= minutos)
      .sort((a, b) => aMinutos(a.horaDesde) - aMinutos(b.horaDesde))[0];
    if (proximo) return proximo;
    return [...candidatos].sort((a, b) => (orden.get(a.serviceId) ?? 0) - (orden.get(b.serviceId) ?? 0))[0];
  }

  const porDia = new Map(dias.map((d, i) => [d.id, i]));
  return [...slots].sort(
    (a, b) =>
      (porDia.get(a.dayId) ?? 0) - (porDia.get(b.dayId) ?? 0) ||
      (orden.get(a.serviceId) ?? 0) - (orden.get(b.serviceId) ?? 0),
  )[0];
}

function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : 'Error inesperado';
}

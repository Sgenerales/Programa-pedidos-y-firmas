import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Campo, Confirmar, Modal, Progreso, Vacio } from '../components/ui';
import { useStore } from '../store/useStore';
import * as db from '../lib/idb';
import { hoyISO, rangoLegible } from '../lib/util';
import type { Delivery, EventRecord, Person } from '../types';

interface Props {
  onAbrirConfiguracion: () => void;
  onAbrirPadron: () => void;
}

interface Conteo {
  personas: number;
  entregas: number;
}

export function EventosPage({ onAbrirConfiguracion, onAbrirPadron }: Props) {
  const eventos = useStore((s) => s.eventos);
  const eventoId = useStore((s) => s.eventoId);
  const cargarEvento = useStore((s) => s.cargarEvento);
  const crearEvento = useStore((s) => s.crearEvento);
  const duplicarEvento = useStore((s) => s.duplicarEvento);
  const eliminarEvento = useStore((s) => s.eliminarEvento);
  const actualizarEvento = useStore((s) => s.actualizarEvento);
  const toast = useStore((s) => s.toast);

  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [aEliminar, setAEliminar] = useState<EventRecord | null>(null);
  const [conteos, setConteos] = useState<Record<string, Conteo>>({});

  // Resumen liviano de todos los eventos, sin cargarlos en memoria.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [personas, entregas] = await Promise.all([
        db.getAll<Person>('people'),
        db.getAll<Delivery>('deliveries'),
      ]);
      if (!vivo) return;
      const acc: Record<string, Conteo> = {};
      for (const p of personas) {
        acc[p.eventId] ??= { personas: 0, entregas: 0 };
        if (p.activo) acc[p.eventId].personas++;
      }
      for (const e of entregas) {
        acc[e.eventId] ??= { personas: 0, entregas: 0 };
        if (e.estado === 'entregado') acc[e.eventId].entregas++;
      }
      setConteos(acc);
    })();
    return () => {
      vivo = false;
    };
  }, [eventos.length]);

  const activos = useMemo(
    () => eventos.filter((e) => e.estado !== 'cerrado'),
    [eventos],
  );
  const cerrados = useMemo(() => eventos.filter((e) => e.estado === 'cerrado'), [eventos]);

  async function abrir(id: string) {
    await cargarEvento(id);
    onAbrirConfiguracion();
  }

  async function duplicar(e: EventRecord) {
    try {
      const id = await duplicarEvento(e.id, `${e.nombre} (copia)`);
      await cargarEvento(id);
      toast({
        tipo: 'ok',
        titulo: 'Evento duplicado',
        detalle: 'Se copiaron días, servicios y turnos. El padrón arranca vacío.',
      });
      onAbrirPadron();
    } catch (err) {
      toast({ tipo: 'error', titulo: 'No se pudo duplicar', detalle: mensaje(err) });
    }
  }

  return (
    <main className="page">
      <div className="page__inner">
        <div className="section__head">
          <div>
            <h2 className="section__title">Tus eventos</h2>
            <p className="section__desc">
              Un evento agrupa un padrón, una grilla de jornadas y servicios, y todas las entregas
              firmadas que se hagan contra esa grilla.
            </p>
          </div>
          <div className="section__actions">
            <button className="btn btn--primary" onClick={() => setNuevoAbierto(true)}>
              <Icon name="mas" size={16} />
              Nuevo evento
            </button>
          </div>
        </div>

        {!eventos.length ? (
          <div className="card">
            <Vacio
              icono="calendario"
              titulo="Todavía no hay eventos"
              descripcion="Creá el primero: definís las fechas, después cargás el padrón desde Excel y armás la grilla de servicios por jornada."
              accion={
                <button className="btn btn--primary" onClick={() => setNuevoAbierto(true)}>
                  <Icon name="mas" size={16} />
                  Crear evento
                </button>
              }
            />
          </div>
        ) : (
          <>
            <div className="grid grid--2">
              {activos.map((e) => (
                <TarjetaEvento
                  key={e.id}
                  evento={e}
                  activo={e.id === eventoId}
                  conteo={conteos[e.id]}
                  onAbrir={() => abrir(e.id)}
                  onDuplicar={() => duplicar(e)}
                  onEliminar={() => setAEliminar(e)}
                  onCerrar={() =>
                    actualizarEvento(e.id, { estado: e.estado === 'activo' ? 'cerrado' : 'activo' })
                  }
                />
              ))}
            </div>

            {cerrados.length ? (
              <section className="section" style={{ marginTop: 30 }}>
                <div className="section__head">
                  <div>
                    <h2 className="section__title">Cerrados</h2>
                    <p className="section__desc">
                      Quedan disponibles solo para consulta y reportes.
                    </p>
                  </div>
                </div>
                <div className="grid grid--2">
                  {cerrados.map((e) => (
                    <TarjetaEvento
                      key={e.id}
                      evento={e}
                      activo={e.id === eventoId}
                      conteo={conteos[e.id]}
                      onAbrir={() => abrir(e.id)}
                      onDuplicar={() => duplicar(e)}
                      onEliminar={() => setAEliminar(e)}
                      onCerrar={() => actualizarEvento(e.id, { estado: 'activo' })}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>

      <NuevoEventoModal
        abierto={nuevoAbierto}
        onCerrar={() => setNuevoAbierto(false)}
        onCrear={async (datos) => {
          const ev = await crearEvento(datos);
          await cargarEvento(ev.id);
          setNuevoAbierto(false);
          toast({ tipo: 'ok', titulo: 'Evento creado', detalle: 'Ahora definí los servicios de cada jornada.' });
          onAbrirConfiguracion();
        }}
      />

      <Confirmar
        abierto={Boolean(aEliminar)}
        titulo="Eliminar evento"
        peligroso
        etiquetaOk="Eliminar definitivamente"
        mensaje={
          <>
            Se borrarán el padrón, los turnos y <strong>todas las entregas firmadas</strong> de{' '}
            <strong>{aEliminar?.nombre}</strong>. Esta acción no se puede deshacer.
            {conteos[aEliminar?.id ?? '']?.entregas ? (
              <div className="notice notice--danger" style={{ marginTop: 14 }}>
                <span className="notice__icon">
                  <Icon name="alerta" size={16} />
                </span>
                <span>
                  Este evento tiene{' '}
                  <strong>{conteos[aEliminar!.id].entregas} entregas firmadas</strong>. Exportá el
                  reporte antes de eliminarlo.
                </span>
              </div>
            ) : null}
          </>
        }
        onCancelar={() => setAEliminar(null)}
        onConfirmar={async () => {
          if (!aEliminar) return;
          try {
            await eliminarEvento(aEliminar.id);
            setAEliminar(null);
            toast({ tipo: 'info', titulo: 'Evento eliminado' });
          } catch (err) {
            toast({ tipo: 'error', titulo: 'No se pudo eliminar', detalle: mensaje(err) });
          }
        }}
      />
    </main>
  );
}

/* ─── Tarjeta ────────────────────────────────────────────────────── */

function TarjetaEvento({
  evento,
  activo,
  conteo,
  onAbrir,
  onDuplicar,
  onEliminar,
  onCerrar,
}: {
  evento: EventRecord;
  activo: boolean;
  conteo?: Conteo;
  onAbrir: () => void;
  onDuplicar: () => void;
  onEliminar: () => void;
  onCerrar: () => void;
}) {
  const badge =
    evento.estado === 'activo'
      ? { clase: 'badge badge--ok', texto: 'En curso' }
      : evento.estado === 'cerrado'
        ? { clase: 'badge', texto: 'Cerrado' }
        : { clase: 'badge badge--warn', texto: 'Borrador' };

  return (
    <article className="card" style={activo ? { borderColor: 'var(--brass-line)' } : undefined}>
      <div className="card__body">
        <div className="row" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ gap: 8, marginBottom: 5 }}>
              <span className={badge.clase}>
                <span className="badge__dot" />
                {badge.texto}
              </span>
              {activo ? <span className="badge badge--brass">Abierto</span> : null}
            </div>
            <h3 className="doc-title" style={{ fontSize: 19 }}>
              {evento.nombre}
            </h3>
            <div className="row" style={{ gap: 7, marginTop: 5, color: 'var(--fg-3)', fontSize: 12.5 }}>
              <Icon name="calendario" size={13} />
              {rangoLegible(evento.fechaInicio, evento.fechaFin)}
              {evento.lugar ? (
                <>
                  <span className="pRow__sep" />
                  <span className="truncate">{evento.lugar}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 20, margin: '14px 0 6px' }}>
          <Metrica valor={conteo?.personas ?? 0} etiqueta="en padrón" />
          <Metrica valor={conteo?.entregas ?? 0} etiqueta="entregas firmadas" />
        </div>
        <Progreso parte={conteo?.entregas ?? 0} total={Math.max(conteo?.personas ?? 0, 1)} />
      </div>

      <div className="card__foot">
        <button className="btn btn--primary btn--sm" onClick={onAbrir}>
          Abrir
          <Icon name="flechaDer" size={14} />
        </button>
        <div className="spacer" />
        <button className="btn btn--quiet btn--sm" onClick={onCerrar}>
          <Icon name={evento.estado === 'cerrado' ? 'refrescar' : 'candado'} size={14} />
          {evento.estado === 'cerrado' ? 'Reabrir' : 'Cerrar'}
        </button>
        <button className="btn btn--quiet btn--icon btn--sm" onClick={onDuplicar} title="Duplicar estructura">
          <Icon name="copiar" size={14} />
        </button>
        <button className="btn btn--quiet btn--icon btn--sm" onClick={onEliminar} title="Eliminar">
          <Icon name="papelera" size={14} />
        </button>
      </div>
    </article>
  );
}

function Metrica({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div>
      <div className="doc-title tabular" style={{ fontSize: 24 }}>
        {valor}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{etiqueta}</div>
    </div>
  );
}

/* ─── Alta ───────────────────────────────────────────────────────── */

function NuevoEventoModal({
  abierto,
  onCerrar,
  onCrear,
}: {
  abierto: boolean;
  onCerrar: () => void;
  onCrear: (datos: Partial<EventRecord>) => Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [organizador, setOrganizador] = useState('');
  const [lugar, setLugar] = useState('');
  const [inicio, setInicio] = useState(hoyISO());
  const [fin, setFin] = useState(hoyISO());
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setNombre('');
    setOrganizador('');
    setLugar('');
    setInicio(hoyISO());
    setFin(hoyISO());
  }, [abierto]);

  // Fin nunca puede quedar antes que inicio.
  useEffect(() => {
    if (fin < inicio) setFin(inicio);
  }, [inicio, fin]);

  const valido = nombre.trim().length >= 2;

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Nuevo evento"
      descripcion="Los días se generan solos a partir del rango de fechas."
      pie={
        <>
          <div className="spacer" />
          <button className="btn btn--ghost" onClick={onCerrar}>
            Cancelar
          </button>
          <button
            className="btn btn--primary"
            disabled={!valido || guardando}
            onClick={async () => {
              setGuardando(true);
              try {
                await onCrear({ nombre, organizador, lugar, fechaInicio: inicio, fechaFin: fin });
              } finally {
                setGuardando(false);
              }
            }}
          >
            {guardando ? 'Creando…' : 'Crear evento'}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 15 }}>
        <Campo etiqueta="Nombre del evento">
          <input
            className="input"
            value={nombre}
            autoFocus
            placeholder="Convención Anual Tropical Tower"
            onChange={(e) => setNombre(e.target.value)}
          />
        </Campo>
        <div className="grid grid--2">
          <Campo etiqueta="Organizador" ayuda="Aparece en el encabezado del acta.">
            <input
              className="input"
              value={organizador}
              placeholder="Tropical Tower S.A."
              onChange={(e) => setOrganizador(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Lugar">
            <input
              className="input"
              value={lugar}
              placeholder="Salón Principal · Torre A"
              onChange={(e) => setLugar(e.target.value)}
            />
          </Campo>
        </div>
        <div className="grid grid--2">
          <Campo etiqueta="Primer día">
            <input
              className="input"
              type="date"
              value={inicio}
              onInput={(e) => setInicio(e.currentTarget.value)}
            />
          </Campo>
          <Campo etiqueta="Último día">
            <input
              className="input"
              type="date"
              min={inicio}
              value={fin}
              onInput={(e) => setFin(e.currentTarget.value)}
            />
          </Campo>
        </div>
      </div>
    </Modal>
  );
}

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : 'Error inesperado';
}

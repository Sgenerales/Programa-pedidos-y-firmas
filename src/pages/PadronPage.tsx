import { useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Campo, Confirmar, Modal, Vacio } from '../components/ui';
import { useStore } from '../store/useStore';
import { asisteEnDia, construirIndice, buscar, gruposDelPadron } from '../store/selectors';
import {
  construirPreview,
  detectarColumnaApellido,
  detectarColumnasFecha,
  detectarMapeo,
  leerArchivo,
  plantillaPadron,
  type HojaLeida,
} from '../lib/importar';
import { exportarPadron } from '../lib/exportar';
import { descargar, fechaCorta } from '../lib/util';
import type { EventDay, ImportColumnMap, ImportPreviewRow, Person } from '../types';

export function PadronPage({ onIrAKiosko }: { onIrAKiosko: () => void }) {
  const eventos = useStore((s) => s.eventos);
  const eventoId = useStore((s) => s.eventoId);
  const dias = useStore((s) => s.dias);
  const personas = useStore((s) => s.personas);
  const entregas = useStore((s) => s.entregas);
  const actualizarPersona = useStore((s) => s.actualizarPersona);
  const eliminarPersona = useStore((s) => s.eliminarPersona);
  const vaciarPadron = useStore((s) => s.vaciarPadron);
  const toast = useStore((s) => s.toast);

  const [importAbierto, setImportAbierto] = useState(false);
  const [consulta, setConsulta] = useState('');
  const [grupoFiltro, setGrupoFiltro] = useState('');
  const [enEdicion, setEnEdicion] = useState<Person | null>(null);
  const [aEliminar, setAEliminar] = useState<Person | null>(null);
  const [vaciarAbierto, setVaciarAbierto] = useState(false);

  const evento = eventos.find((e) => e.id === eventoId);
  const indice = useMemo(() => construirIndice(personas), [personas]);
  const grupos = useMemo(() => gruposDelPadron(personas), [personas]);

  const visibles = useMemo(() => {
    let out = buscar(indice, consulta);
    if (grupoFiltro) out = out.filter((p) => p.grupo === grupoFiltro);
    return out;
  }, [indice, consulta, grupoFiltro]);

  const entregasPorPersona = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entregas) {
      if (e.estado !== 'entregado') continue;
      m.set(e.personId, (m.get(e.personId) ?? 0) + 1);
    }
    return m;
  }, [entregas]);

  if (!evento) return null;

  return (
    <main className="page">
      <div className="page__wide">
        <div className="section__head">
          <div>
            <h2 className="section__title">
              {personas.length ? `${personas.length} personas en el padrón` : 'Padrón vacío'}
            </h2>
            <p className="section__desc">
              El buscador del kiosko trabaja sobre esta lista, en memoria. Cargarla completa es lo
              que hace que buscar sea instantáneo aunque se corte la red.
            </p>
          </div>
          <div className="section__actions">
            {personas.length ? (
              <button
                className="btn btn--ghost"
                onClick={async () => {
                  const { blob, nombre } = await exportarPadron(evento, personas, dias);
                  descargar(nombre, blob);
                }}
              >
                <Icon name="bajar" size={16} />
                Exportar
              </button>
            ) : null}
            <button className="btn btn--primary" onClick={() => setImportAbierto(true)}>
              <Icon name="subir" size={16} />
              Importar desde Excel
            </button>
          </div>
        </div>

        {!personas.length ? (
          <div className="card">
            <Vacio
              icono="personas"
              titulo="Cargá la base de personas"
              descripcion="Subí el .xlsx o .csv con la lista de invitados o personal. Te muestro las columnas detectadas y confirmás antes de que se guarde nada."
              accion={
                <div className="row" style={{ gap: 9 }}>
                  <button className="btn btn--primary" onClick={() => setImportAbierto(true)}>
                    <Icon name="subir" size={16} />
                    Importar archivo
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={async () => descargar('plantilla-padron.xlsx', await plantillaPadron(dias))}
                  >
                    <Icon name="hoja" size={16} />
                    Descargar plantilla
                  </button>
                </div>
              }
            />
          </div>
        ) : (
          <>
            <div className="row row--wrap" style={{ marginBottom: 14, gap: 10 }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 420 }}>
                <Icon
                  name="buscar"
                  size={16}
                  style={{ position: 'absolute', left: 12, top: 11, color: 'var(--fg-3)' }}
                />
                <input
                  className="input"
                  style={{ paddingLeft: 36 }}
                  placeholder="Buscar por nombre, documento, empresa…"
                  value={consulta}
                  onChange={(e) => setConsulta(e.target.value)}
                />
              </div>
              {grupos.length ? (
                <div className="row row--wrap" style={{ gap: 6 }}>
                  <button
                    className={`chip${!grupoFiltro ? ' chip--on' : ''}`}
                    onClick={() => setGrupoFiltro('')}
                  >
                    Todos
                  </button>
                  {grupos.map((g) => (
                    <button
                      key={g}
                      className={`chip${grupoFiltro === g ? ' chip--on' : ''}`}
                      onClick={() => setGrupoFiltro(grupoFiltro === g ? '' : g)}
                    >
                      {g}
                      <span className="muted">{personas.filter((p) => p.grupo === g).length}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="spacer" />
              <button className="btn btn--ghost btn--sm" onClick={() => setEnEdicion(nuevaPersona(evento.id))}>
                <Icon name="mas" size={14} />
                Agregar persona
              </button>
              <button className="btn btn--quiet btn--sm" onClick={() => setVaciarAbierto(true)}>
                <Icon name="papelera" size={14} />
                Vaciar
              </button>
            </div>

            {dias.length ? (
              <div className="row row--wrap" style={{ marginBottom: 14, gap: 7 }}>
                <span className="eyebrow">Asistencia por jornada</span>
                {dias.map((dia) => (
                  <span className="badge badge--info" key={dia.id}>
                    {fechaCorta(dia.fecha)} ·{' '}
                    {personas.filter((p) => p.activo && asisteEnDia(p, dia.id)).length}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="tableWrap" style={{ maxHeight: 'calc(100dvh - 300px)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Rol</th>
                    <th style={{ minWidth: 240 }}>Nombre</th>
                    <th>Documento</th>
                    <th>Asistencia</th>
                    <th>Referencia</th>
                    <th className="num">Recibió</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((p) => (
                    <tr key={p.id} className={p.activo ? undefined : 'dimmed'}>
                      <td>{p.empresa || '—'}</td>
                      <td>{p.grupo ? <span className="badge">{p.grupo}</span> : '—'}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                        {!p.activo ? <span className="badge">Inactivo</span> : null}
                      </td>
                      <td className="mono">{p.documento || '—'}</td>
                      <td>{textoAsistencia(p, dias)}</td>
                      <td className="muted">{p.referencia || '—'}</td>
                      <td className="num tabular">{entregasPorPersona.get(p.id) ?? 0}</td>
                      <td>
                        <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn--quiet btn--icon btn--sm"
                            onClick={() => setEnEdicion(p)}
                            title="Editar"
                          >
                            <Icon name="lapiz" size={14} />
                          </button>
                          <button
                            className="btn btn--quiet btn--icon btn--sm"
                            onClick={() => setAEliminar(p)}
                            title="Eliminar"
                          >
                            <Icon name="papelera" size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!visibles.length ? (
                    <tr>
                      <td colSpan={8}>
                        <Vacio titulo="Sin coincidencias" descripcion="Probá con otro término o quitá el filtro de grupo." />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Mostrando {visibles.length} de {personas.length}
              </span>
              <div className="spacer" />
              <button className="btn btn--primary" onClick={onIrAKiosko}>
                <Icon name="kiosko" size={16} />
                Ir al kiosko
              </button>
            </div>
          </>
        )}
      </div>

      <ImportarModal abierto={importAbierto} onCerrar={() => setImportAbierto(false)} />

      <PersonaModal
        persona={enEdicion}
        grupos={grupos}
        onCerrar={() => setEnEdicion(null)}
        onGuardar={async (datos) => {
          try {
            if (enEdicion?.id) await actualizarPersona(enEdicion.id, datos);
            else await useStore.getState().agregarPersona(evento.id, datos);
            setEnEdicion(null);
          } catch (err) {
            toast({ tipo: 'error', titulo: 'No se pudo guardar', detalle: msg(err) });
          }
        }}
      />

      <Confirmar
        abierto={Boolean(aEliminar)}
        titulo="Eliminar persona"
        peligroso
        etiquetaOk="Eliminar"
        mensaje={<>Se quitará <strong>{aEliminar?.nombre}</strong> del padrón de este evento.</>}
        onCancelar={() => setAEliminar(null)}
        onConfirmar={async () => {
          if (!aEliminar) return;
          try {
            await eliminarPersona(aEliminar.id);
          } catch (err) {
            toast({ tipo: 'error', titulo: 'No se pudo eliminar', detalle: msg(err) });
          }
          setAEliminar(null);
        }}
      />

      <Confirmar
        abierto={vaciarAbierto}
        titulo="Vaciar el padrón"
        peligroso
        etiquetaOk="Vaciar padrón"
        mensaje={<>Se eliminarán las {personas.length} personas cargadas en este evento.</>}
        onCancelar={() => setVaciarAbierto(false)}
        onConfirmar={async () => {
          try {
            await vaciarPadron(evento.id);
            toast({ tipo: 'info', titulo: 'Padrón vaciado' });
          } catch (err) {
            toast({ tipo: 'error', titulo: 'No se pudo vaciar', detalle: msg(err) });
          }
          setVaciarAbierto(false);
        }}
      />
    </main>
  );
}

/* ═══ Importador ═══════════════════════════════════════════════════ */

type Paso = 'archivo' | 'mapeo' | 'revision';

function ImportarModal({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const eventoId = useStore((s) => s.eventoId);
  const dias = useStore((s) => s.dias);
  const personas = useStore((s) => s.personas);
  const importarPersonas = useStore((s) => s.importarPersonas);
  const toast = useStore((s) => s.toast);

  const [paso, setPaso] = useState<Paso>('archivo');
  const [hoja, setHoja] = useState<HojaLeida | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [mapa, setMapa] = useState<ImportColumnMap | null>(null);
  const [colApellido, setColApellido] = useState('');
  const [ordenNombre, setOrdenNombre] = useState<'nombre-apellido' | 'apellido-nombre'>('nombre-apellido');
  const [omitirYaExistentes, setOmitirYaExistentes] = useState(true);
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reiniciar() {
    setPaso('archivo');
    setHoja(null);
    setArchivo(null);
    setMapa(null);
    setColApellido('');
    setOmitirYaExistentes(true);
    setError('');
  }

  async function tomarArchivo(file: File, nombreHoja?: string) {
    setError('');
    try {
      const leida = await leerArchivo(file, nombreHoja);
      if (!leida.filas.length) {
        setError('La hoja no tiene filas de datos debajo del encabezado.');
        return;
      }
      const detectado = detectarMapeo(leida.columnas);
      setArchivo(file);
      setHoja(leida);
      setMapa(detectado);
      setColApellido(detectarColumnaApellido(leida.columnas, detectado.nombre));
      setPaso('mapeo');
    } catch (err) {
      setError(msg(err));
    }
  }

  const preview: ImportPreviewRow[] = useMemo(() => {
    if (!hoja || !mapa) return [];
    return construirPreview({
      filas: hoja.filas,
      mapa,
      colApellido,
      ordenNombre,
      padronActual: personas,
      columnasFecha: detectarColumnasFecha(hoja.columnas, dias),
    });
  }, [hoja, mapa, colApellido, ordenNombre, personas, dias]);

  const columnasFecha = useMemo(
    () => (hoja ? detectarColumnasFecha(hoja.columnas, dias) : []),
    [hoja, dias],
  );
  const fechasFueraDelEvento = columnasFecha.filter((columna) => !columna.dayId);
  const marcasInvalidas = preview.reduce(
    (total, fila) => total + fila.asistencia.filter((marca) => marca.valor === 'invalido').length,
    0,
  );
  const dupArchivo = preview.filter((r) => r.estado === 'duplicado-archivo');
  const dupPadron = preview.filter((r) => r.estado === 'duplicado-padron');
  const sinNombre = preview.filter((r) => r.estado === 'sin-nombre');
  // Las coincidencias dentro del propio Excel representan filas reales de
  // la lista y se conservan. Sólo se omiten por defecto las personas que
  // ya estaban cargadas antes de abrir el archivo.
  const aImportar = preview.filter(
    (r) =>
      r.estado !== 'sin-nombre' &&
      (!omitirYaExistentes || r.estado !== 'duplicado-padron'),
  );

  return (
    <Modal
      abierto={abierto}
      onCerrar={() => {
        reiniciar();
        onCerrar();
      }}
      ancho="wide"
      titulo="Importar padrón"
      descripcion="Nada se guarda hasta el último paso."
      bloqueado={guardando}
      pie={
        paso === 'archivo' ? (
          <>
            <button
              className="btn btn--quiet"
              onClick={async () => descargar('plantilla-padron.xlsx', await plantillaPadron(dias))}
            >
              <Icon name="hoja" size={15} />
              Descargar plantilla
            </button>
            <div className="spacer" />
          </>
        ) : (
          <>
            <button className="btn btn--ghost" onClick={() => (paso === 'revision' ? setPaso('mapeo') : reiniciar())}>
              <Icon name="flechaIzq" size={15} />
              Atrás
            </button>
            <div className="spacer" />
            {paso === 'mapeo' ? (
              <button
                className="btn btn--primary"
                disabled={!mapa?.nombre || Boolean(fechasFueraDelEvento.length) || marcasInvalidas > 0}
                onClick={() => setPaso('revision')}
              >
                Revisar {preview.length} filas
                <Icon name="flechaDer" size={15} />
              </button>
            ) : (
              <button
                className="btn btn--primary"
                disabled={!aImportar.length || guardando}
                onClick={async () => {
                  if (!eventoId) return;
                  setGuardando(true);
                  try {
                    const n = await importarPersonas(
                      eventoId,
                      aImportar.map((r) => ({
                        nombre: r.nombre,
                        documento: r.documento,
                        empresa: r.empresa,
                        grupo: r.grupo,
                        referencia: r.referencia,
                        telefono: r.telefono,
                        diasHabilitados: r.diasHabilitados,
                      })),
                    );
                    toast({
                      tipo: 'ok',
                      titulo: `${n} personas importadas`,
                      detalle: 'Ya podés operar el kiosko con este padrón.',
                    });
                    reiniciar();
                    onCerrar();
                  } catch (err) {
                    toast({ tipo: 'error', titulo: 'Falló la importación', detalle: msg(err) });
                  } finally {
                    setGuardando(false);
                  }
                }}
              >
                {guardando ? 'Importando…' : `Importar ${aImportar.length} personas`}
              </button>
            )}
          </>
        )
      }
    >
      <div className="stepper">
        <Paso1 activo={paso === 'archivo'} hecho={paso !== 'archivo'} n={1} texto="Archivo" />
        <span className="step__line" />
        <Paso1 activo={paso === 'mapeo'} hecho={paso === 'revision'} n={2} texto="Columnas" />
        <span className="step__line" />
        <Paso1 activo={paso === 'revision'} hecho={false} n={3} texto="Revisión" />
      </div>

      {paso === 'archivo' ? (
        <>
          <div
            className={`drop${arrastrando ? ' drop--over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrando(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void tomarArchivo(f);
            }}
          >
            <div className="drop__icon">
              <Icon name="subir" size={30} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Arrastrá el archivo acá</div>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              .xlsx, .xls o .csv — leo la primera hoja y detecto solo el encabezado
            </p>
            <button className="btn btn--ghost" style={{ marginTop: 14 }} onClick={() => inputRef.current?.click()}>
              Elegir archivo
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void tomarArchivo(f);
                e.target.value = '';
              }}
            />
          </div>
          {error ? (
            <div className="notice notice--danger" style={{ marginTop: 14 }}>
              <span className="notice__icon">
                <Icon name="alerta" size={16} />
              </span>
              <span>{error}</span>
            </div>
          ) : null}
        </>
      ) : null}

      {paso === 'mapeo' && hoja && mapa ? (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <span className="badge badge--info">
              <Icon name="hoja" size={12} />
              {archivo?.name}
            </span>
            <span className="badge">{hoja.filas.length} filas</span>
            {hoja.hojas.length > 1 ? (
              <select
                className="select"
                style={{ width: 'auto', height: 30 }}
                value={hoja.hoja}
                onChange={(e) => archivo && void tomarArchivo(archivo, e.target.value)}
              >
                {hoja.hojas.map((h) => (
                  <option key={h} value={h}>
                    Hoja: {h}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="card card--pad">
            {(
              [
                ['nombre', 'Nombre completo', true],
                ['documento', 'Documento / CI', false],
                ['empresa', 'Tipo / procedencia', false],
                ['grupo', 'Rol / función', false],
                ['referencia', 'Referencia', false],
                ['telefono', 'Teléfono', false],
              ] as [keyof ImportColumnMap, string, boolean][]
            ).map(([campo, etiqueta, requerido]) => (
              <div key={campo} className="mapRow">
                <div className="mapRow__label">
                  {etiqueta}
                  {requerido ? <span className="mapRow__req">*</span> : null}
                </div>
                <select
                  className="select"
                  value={mapa[campo]}
                  onChange={(e) => setMapa({ ...mapa, [campo]: e.target.value })}
                >
                  <option value="">— sin asignar —</option>
                  {hoja.columnas.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div
            className={`notice ${fechasFueraDelEvento.length || marcasInvalidas ? 'notice--danger' : 'notice--info'}`}
            style={{ marginTop: 14 }}
          >
            <span className="notice__icon">
              <Icon name={fechasFueraDelEvento.length || marcasInvalidas ? 'alerta' : 'calendario'} size={16} />
            </span>
            <span>
              {columnasFecha.length ? (
                <>
                  Se detectaron {columnasFecha.length} columnas de asistencia:{' '}
                  {columnasFecha.map((columna, index) => (
                    <span key={columna.columna}>
                      {index ? ' · ' : ''}
                      <strong>{fechaCorta(columna.fecha)}</strong>
                      {!columna.dayId ? ' (fuera del evento)' : ''}
                    </span>
                  ))}
                  . Cada <strong>SI</strong> suma a la persona en esa jornada y cada{' '}
                  <strong>NO</strong> la excluye del total diario.
                </>
              ) : (
                <>No se detectaron columnas de fecha; estas personas quedarán habilitadas todos los días.</>
              )}
              {marcasInvalidas
                ? ` Hay ${marcasInvalidas} marca(s) distintas de SI/NO que deben corregirse en el archivo.`
                : ''}
            </span>
          </div>

          <div className="card card--pad" style={{ marginTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Nombre en dos columnas
            </div>
            <div className="mapRow" style={{ borderBottom: 'none' }}>
              <div className="mapRow__label">Columna de apellido</div>
              <select className="select" value={colApellido} onChange={(e) => setColApellido(e.target.value)}>
                <option value="">— el nombre viene completo en una sola columna —</option>
                {hoja.columnas
                  .filter((c) => c !== mapa.nombre)
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
            </div>
            {colApellido ? (
              <div className="row" style={{ marginTop: 10 }}>
                <span className="field__label">Orden</span>
                <div className="btnGroup">
                  <button
                    aria-pressed={ordenNombre === 'nombre-apellido'}
                    onClick={() => setOrdenNombre('nombre-apellido')}
                  >
                    Nombre Apellido
                  </button>
                  <button
                    aria-pressed={ordenNombre === 'apellido-nombre'}
                    onClick={() => setOrdenNombre('apellido-nombre')}
                  >
                    Apellido Nombre
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {mapa.nombre ? (
            <div className="notice notice--info" style={{ marginTop: 14 }}>
              <span className="notice__icon">
                <Icon name="info" size={16} />
              </span>
              <span>
                Ejemplo de la primera fila:{' '}
                <strong>{preview[0]?.nombre || '(vacío)'}</strong>
                {preview[0]?.documento ? ` · doc ${preview[0].documento}` : ''}
              </span>
            </div>
          ) : (
            <div className="notice notice--warn" style={{ marginTop: 14 }}>
              <span className="notice__icon">
                <Icon name="alerta" size={16} />
              </span>
              <span>Asigná la columna de nombre: es lo único obligatorio.</span>
            </div>
          )}
        </>
      ) : null}

      {paso === 'revision' ? (
        <>
          <div className="grid grid--4" style={{ marginBottom: 16 }}>
            <ResumenImport valor={preview.length - sinNombre.length} etiqueta="filas válidas" tono="ok" />
            <ResumenImport valor={dupPadron.length} etiqueta="ya en el padrón" tono="warn" />
            <ResumenImport valor={dupArchivo.length} etiqueta="coincidencias internas" tono="warn" />
            <ResumenImport valor={sinNombre.length} etiqueta="sin nombre (se omiten)" tono="danger" />
          </div>

          {dupArchivo.length ? (
            <div className="notice notice--warn" style={{ marginBottom: 14 }}>
              <span className="notice__icon">
                <Icon name="alerta" size={16} />
              </span>
              <span>
                Hay {dupArchivo.length} fila(s) que coinciden dentro del Excel. Se conservarán para
                respetar las {preview.length - sinNombre.length} personas de la lista original.
              </span>
            </div>
          ) : null}

          {columnasFecha.length ? (
            <div className="row row--wrap" style={{ marginBottom: 14, gap: 7 }}>
              <span className="eyebrow">Padrón por jornada</span>
              {columnasFecha.map((columna) => (
                <span className="badge badge--info" key={columna.columna}>
                  {fechaCorta(columna.fecha)} ·{' '}
                  {
                    aImportar.filter((fila) =>
                      fila.asistencia.some(
                        (marca) => marca.dayId === columna.dayId && marca.valor === 'si',
                      ),
                    ).length
                  }
                </span>
              ))}
            </div>
          ) : null}

          {dupPadron.length > 0 ? (
            <label className="switch" style={{ marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={omitirYaExistentes}
                onChange={(e) => setOmitirYaExistentes(e.target.checked)}
              />
              <span className="switch__track" />
              <span className="switch__label">
                Omitir personas que ya existen en el padrón (recomendado).
              </span>
            </label>
          ) : null}

          <div className="tableWrap" style={{ maxHeight: 330 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Rol</th>
                  <th>Nombre</th>
                  <th>Asistencia</th>
                  <th>Referencia</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 200).map((r, i) => (
                  <tr key={i} className={r.estado === 'nuevo' ? undefined : 'dimmed'}>
                    <td>{r.empresa || '—'}</td>
                    <td>{r.grupo || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{r.nombre || <em className="muted">sin nombre</em>}</td>
                    <td>
                      {r.asistencia.length
                        ? `${r.asistencia.filter((marca) => marca.valor === 'si').length}/${r.asistencia.length} días`
                        : 'Todos los días'}
                    </td>
                    <td className="muted">{r.referencia || '—'}</td>
                    <td>
                      <EstadoFila estado={r.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 200 ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Vista previa limitada a 200 filas. Se importarán las {aImportar.length} que
              correspondan.
            </p>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}

function Paso1({ activo, hecho, n, texto }: { activo: boolean; hecho: boolean; n: number; texto: string }) {
  return (
    <span className={`step${activo ? ' step--on' : hecho ? ' step--done' : ''}`}>
      <span className="step__num">{hecho ? <Icon name="check" size={12} /> : n}</span>
      {texto}
    </span>
  );
}

function ResumenImport({ valor, etiqueta, tono }: { valor: number; etiqueta: string; tono: string }) {
  const color = tono === 'ok' ? 'var(--ok)' : tono === 'warn' ? 'var(--warn)' : 'var(--danger)';
  return (
    <div className="stat">
      <div className="stat__value" style={{ color: valor ? color : 'var(--fg-4)' }}>
        {valor}
      </div>
      <div className="stat__foot">{etiqueta}</div>
    </div>
  );
}

function EstadoFila({ estado }: { estado: ImportPreviewRow['estado'] }) {
  if (estado === 'nuevo') return <span className="badge badge--ok">Nueva</span>;
  if (estado === 'duplicado-padron') return <span className="badge badge--warn">Ya existe</span>;
  if (estado === 'duplicado-archivo') return <span className="badge badge--warn">Repetida</span>;
  return <span className="badge badge--danger">Sin nombre</span>;
}

/* ═══ Alta / edición de persona ════════════════════════════════════ */

function nuevaPersona(eventId: string): Person {
  return {
    id: '',
    eventId,
    nombre: '',
    documento: '',
    empresa: '',
    grupo: '',
    referencia: '',
    telefono: '',
    diasHabilitados: null,
    activo: true,
    origen: 'manual',
    creadoEn: new Date().toISOString(),
  };
}

export function PersonaModal({
  persona,
  grupos,
  onCerrar,
  onGuardar,
}: {
  persona: Person | null;
  grupos: string[];
  onCerrar: () => void;
  onGuardar: (datos: Partial<Person>) => void;
}) {
  const [datos, setDatos] = useState<Person | null>(null);
  const [refCargada, setRefCargada] = useState<Person | null>(null);

  if (persona !== refCargada) {
    setRefCargada(persona);
    setDatos(persona ? { ...persona } : null);
  }

  if (!datos) return null;
  const valido = datos.nombre.trim().length >= 2;

  function set<K extends keyof Person>(k: K, v: Person[K]) {
    setDatos((d) => (d ? { ...d, [k]: v } : d));
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={persona?.id ? 'Editar persona' : 'Agregar persona'}
      descripcion="El nombre es el que quedará impreso en el acta junto a la firma."
      pie={
        <>
          {persona?.id ? (
            <label className="switch">
              <input
                type="checkbox"
                checked={datos.activo}
                onChange={(e) => set('activo', e.target.checked)}
              />
              <span className="switch__track" />
              <span className="switch__label">Activa</span>
            </label>
          ) : null}
          <div className="spacer" />
          <button className="btn btn--ghost" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="btn btn--primary" disabled={!valido} onClick={() => onGuardar(datos!)}>
            Guardar
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 15 }}>
        <Campo etiqueta="Nombre completo">
          <input
            className="input"
            autoFocus
            value={datos.nombre}
            placeholder="María Fernanda Acosta"
            onChange={(e) => set('nombre', e.target.value)}
          />
        </Campo>
        <div className="grid grid--2">
          <Campo etiqueta="Documento" ayuda="Sirve para desambiguar homónimos.">
            <input className="input" value={datos.documento} onChange={(e) => set('documento', e.target.value)} />
          </Campo>
          <Campo etiqueta="Teléfono">
            <input className="input" value={datos.telefono} onChange={(e) => set('telefono', e.target.value)} />
          </Campo>
          <Campo etiqueta="Empresa">
            <input className="input" value={datos.empresa} onChange={(e) => set('empresa', e.target.value)} />
          </Campo>
          <Campo etiqueta="Referencia" ayuda="Torre, mesa, habitación, cargo…">
            <input className="input" value={datos.referencia} onChange={(e) => set('referencia', e.target.value)} />
          </Campo>
        </div>
        <Campo etiqueta="Grupo" ayuda="Permite restringir turnos: por ejemplo, cena solo para staff.">
          <input
            className="input"
            list="grupos-existentes"
            value={datos.grupo}
            onChange={(e) => set('grupo', e.target.value)}
          />
        </Campo>
        <datalist id="grupos-existentes">
          {grupos.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </div>
    </Modal>
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : 'Error inesperado';
}

function textoAsistencia(persona: Person, dias: EventDay[]): string {
  if (!Array.isArray(persona.diasHabilitados)) return 'Todos los días';
  const presentes = dias.filter((dia) => persona.diasHabilitados?.includes(dia.id)).length;
  if (!presentes) return 'No asiste';
  return `${presentes}/${dias.length} días`;
}

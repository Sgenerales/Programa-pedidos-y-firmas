import { Icon } from './Icon';
import { useStore } from '../store/useStore';
import { HAY_NUBE } from '../lib/config';
import { hora } from '../lib/util';
import { describirActividad, estadoActividad } from '../lib/actividad';

/**
 * Estado de la cola hacia la nube. Está siempre a la vista porque la
 * pregunta que importa durante un evento es una sola: ¿ya quedó
 * guardada esa firma para el reporte?
 */
export function SyncPill({ compacto }: { compacto?: boolean }) {
  const sync = useStore((s) => s.sync);
  const sesion = useStore((s) => s.sesion);
  const sincronizar = useStore((s) => s.sincronizar);
  const eventoId = useStore((s) => s.eventoId);
  const eventos = useStore((s) => s.eventos);
  const dias = useStore((s) => s.dias);
  const slots = useStore((s) => s.slots);

  // Sin nube configurada nada se respalda. Es un fallo silencioso —una
  // variable de entorno olvidada en el hosting— y tiene que verse.
  if (!HAY_NUBE) {
    return (
      <span className="syncPill syncPill--off" title="Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY">
        <Icon name="nubeOff" size={13} />
        Sin respaldo
      </span>
    );
  }
  if (!sesion) return null;

  const { pendientes, conflictos, sincronizando, enLinea, ultimaOk, ultimoError } = sync;

  // Fuera de la ventana operativa no se consulta nada. Decirlo, y decir
  // hasta cuándo, evita que alguien crea que la sincronización se rompió.
  const actividad = estadoActividad({
    evento: eventos.find((e) => e.id === eventoId) ?? null,
    dias,
    slots,
  });
  if (!actividad.activo && !pendientes && !sincronizando) {
    return (
      <button
        className="syncPill"
        title={`${describirActividad(actividad)} Tocá para sincronizar igual.`}
        onClick={() => void sincronizar({ forzar: true })}
      >
        <Icon name={actividad.motivo === 'evento-cerrado' ? 'candado' : 'reloj'} size={13} />
        {actividad.motivo === 'evento-cerrado'
          ? 'Evento cerrado'
          : compacto
            ? 'En pausa'
            : `En pausa${actividad.ventana ? ` · reanuda ${actividad.ventana.desde}` : ''}`}
      </button>
    );
  }

  const clase = !enLinea
    ? 'syncPill syncPill--off'
    : pendientes || conflictos || ultimoError
      ? 'syncPill syncPill--pend'
      : 'syncPill syncPill--ok';

  const texto = sincronizando
    ? 'Guardando…'
    : !enLinea
      ? pendientes
        ? `Sin red · ${pendientes} en espera`
        : 'Sin red'
      : conflictos
        ? `${conflictos} en conflicto`
        : pendientes
          ? `${pendientes} sin subir`
          : compacto
            ? 'Al día'
            : 'Todo guardado';

  const titulo = ultimoError
    ? `Último error: ${ultimoError}`
    : ultimaOk
      ? `Última sincronización ${hora(ultimaOk)}`
      : 'Sin sincronizar todavía';

  return (
    <button
      className={clase}
      title={titulo}
      onClick={() => void sincronizar()}
      disabled={sincronizando}
    >
      {sincronizando ? (
        <span className="syncPill__spin" />
      ) : (
        <Icon
          name={!enLinea ? 'nubeOff' : pendientes || conflictos || ultimoError ? 'nube' : 'sello'}
          size={13}
        />
      )}
      {texto}
    </button>
  );
}

import { Icon } from './Icon';
import { useStore } from '../store/useStore';
import { HAY_NUBE } from '../lib/config';
import { hora } from '../lib/util';

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
  const cerrado = eventos.find((e) => e.id === eventoId)?.estado === 'cerrado';

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

  // Un evento cerrado no consulta nada. Decirlo evita que alguien crea
  // que la sincronización se rompió.
  if (cerrado && !pendientes) {
    return (
      <span className="syncPill" title="El evento está cerrado: no se envían ni reciben cambios">
        <Icon name="candado" size={13} />
        Evento cerrado
      </span>
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

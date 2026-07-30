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

  if (!HAY_NUBE || !sesion) return null;

  const { pendientes, conflictos, sincronizando, enLinea, ultimaOk, ultimoError } = sync;

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

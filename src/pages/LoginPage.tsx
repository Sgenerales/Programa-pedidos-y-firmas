import { useEffect, useState } from 'react';
import { Icon, Marca } from '../components/Icon';
import { Campo } from '../components/ui';
import { useStore } from '../store/useStore';
import { PROYECTO } from '../lib/config';

/* Puerta de entrada. Se cruza una sola vez por dispositivo: después la
   sesión queda guardada y el kiosko opera aunque se caiga el wifi. */

export function LoginPage() {
  const entrar = useStore((s) => s.entrar);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState('');
  const [enLinea, setEnLinea] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setEnLinea(true);
    const off = () => setEnLinea(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const valido = /.+@.+\..+/.test(email.trim()) && password.length > 0;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || entrando) return;
    setEntrando(true);
    setError('');
    const res = await entrar(email, password);
    if (!res.ok) {
      setError(res.mensaje ?? 'No se pudo iniciar sesión.');
      setPassword('');
    }
    setEntrando(false);
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={enviar}>
        <div className="login__brand">
          <span className="brand__mark">
            <Marca size={22} />
          </span>
          <div>
            <div className="login__name">ACTA</div>
            <div className="brand__sub">Control de entregas</div>
          </div>
        </div>

        <h1 className="login__title">Ingresá a tu cuenta</h1>
        <p className="login__desc">
          Una sola vez por dispositivo. Después la tablet queda lista para operar, con red o sin ella.
        </p>

        <div className="col" style={{ gap: 14, marginTop: 22 }}>
          <Campo etiqueta="Correo">
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={email}
              placeholder="nombre@organizacion.com"
              onChange={(e) => setEmail(e.target.value)}
              disabled={entrando}
            />
          </Campo>
          <Campo etiqueta="Contraseña">
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
              disabled={entrando}
            />
          </Campo>
        </div>

        {error ? (
          <div className="notice notice--danger" style={{ marginTop: 16 }} role="alert">
            <span className="notice__icon">
              <Icon name="alerta" size={16} />
            </span>
            <span>{error}</span>
          </div>
        ) : null}

        {!enLinea ? (
          <div className="notice notice--warn" style={{ marginTop: 16 }}>
            <span className="notice__icon">
              <Icon name="nubeOff" size={16} />
            </span>
            <span>
              Sin conexión. El primer ingreso de cada dispositivo necesita red; después ya no.
            </span>
          </div>
        ) : null}

        <button
          className="btn btn--primary btn--lg btn--block"
          style={{ marginTop: 20 }}
          type="submit"
          disabled={!valido || entrando}
        >
          {entrando ? (
            'Verificando…'
          ) : (
            <>
              <Icon name="candado" size={17} />
              Entrar
            </>
          )}
        </button>

        <p className="login__pie">
          {PROYECTO ? (
            <>
              Conectado a <span className="mono">{PROYECTO}</span>. Cada entrega y cada firma
              quedan guardadas ahí para los reportes.
            </>
          ) : (
            'Sin conexión a la nube configurada en esta instalación.'
          )}
        </p>
      </form>
    </div>
  );
}

import type { JSX, SVGProps } from 'react';

/* Set de íconos propio: trazo 1.6, esquinas redondeadas, caja 24.
   Los de servicio (cafe, plato, luna…) están dibujados para leerse
   bien a 26 px dentro de la tira de jornada del kiosko. */

const P: Record<string, JSX.Element> = {
  /* — Navegación y acciones — */
  buscar: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  mas: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  flechaDer: <path d="M5 12h13m-5-6 6 6-6 6" />,
  flechaIzq: <path d="M19 12H6m5-6-6 6 6 6" />,
  chevronDer: <path d="m9 5 7 7-7 7" />,
  chevronAbajo: <path d="m5 9 7 7 7-7" />,
  lapiz: (
    <>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  papelera: (
    <>
      <path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.5 7" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </>
  ),
  copiar: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.2" />
      <path d="M15 5.8A1.8 1.8 0 0 0 13.2 4H5.8A1.8 1.8 0 0 0 4 5.8v7.4A1.8 1.8 0 0 0 5.8 15" />
    </>
  ),
  subir: (
    <>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  bajar: (
    <>
      <path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  imprimir: (
    <>
      <path d="M7 9V4h10v5" />
      <path d="M7 18H5.5A1.5 1.5 0 0 1 4 16.5v-5A1.5 1.5 0 0 1 5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17" />
      <rect x="7" y="14" width="10" height="6.5" rx="1.2" />
    </>
  ),
  refrescar: (
    <>
      <path d="M20 11a8 8 0 1 0-.8 4.5" />
      <path d="M20 5v6h-6" />
    </>
  ),
  filtro: <path d="M4 6h16l-6.2 7.2v5.3l-3.6 1.9v-7.2L4 6Z" />,
  masMenu: (
    <>
      <circle cx="12" cy="5.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),

  /* — Dominio — */
  acta: (
    <>
      <path d="M6 3.5h8.5L19 8v12.5H6z" />
      <path d="M14 3.5V8h5" />
      <path d="M9 16.5c1.6-2.6 2.4-4.2 3-4.2s.6 3.3 1.4 3.3 1-1.4 2-1.4" />
    </>
  ),
  firma: (
    <>
      <path d="M3.5 17.5c2.8 0 3.6-9.5 5.6-9.5 1.7 0 .3 8 2.2 8 1.4 0 1.6-4.2 3-4.2 1.1 0 1.1 2.4 2.2 2.4.8 0 1.2-1 1.7-1" />
      <path d="M4 21h16" />
    </>
  ),
  calendario: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
    </>
  ),
  personas: (
    <>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c0-3.1 2.7-5 6-5s6 1.9 6 5" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.1M17.5 14.9c1.9.6 3 2.2 3 4.6" />
    </>
  ),
  matriz: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.2" />
      <path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" />
    </>
  ),
  kiosko: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 20.5h8M12 17v3.5" />
      <path d="M8.5 10.5h7" />
    </>
  ),
  reporte: (
    <>
      <path d="M4 20h16" />
      <rect x="5.5" y="12" width="3.4" height="5.5" rx="1" />
      <rect x="10.8" y="7.5" width="3.4" height="10" rx="1" />
      <rect x="16.1" y="10" width="3.4" height="7.5" rx="1" />
    </>
  ),
  ajustes: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    </>
  ),
  sello: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.2 2.6 2.6 5-5.6" />
    </>
  ),
  reloj: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  alerta: (
    <>
      <path d="M12 4.5 21 19.5H3L12 4.5Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.2v5" />
      <circle cx="12" cy="7.9" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  candado: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  nube: (
    <>
      <path d="M7 18.5a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 17.4 10a3.8 3.8 0 0 1 .1 8.5H7Z" />
    </>
  ),
  nubeOff: (
    <>
      <path d="M7 18.5a4 4 0 0 1-.3-8 5.4 5.4 0 0 1 1.5-2.6M11.4 6.6A5.5 5.5 0 0 1 17.4 10a3.8 3.8 0 0 1 2.2 6.6" />
      <path d="M3.5 3.5 20.5 20.5" />
    </>
  ),
  archivo: (
    <>
      <path d="M6 3.5h8.5L19 8v12.5H6z" />
      <path d="M14 3.5V8h5M9 13h6M9 16.5h4" />
    </>
  ),
  hoja: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M4 9h16M4 14.5h16M9.5 9v11.5M14.5 9v11.5" />
    </>
  ),

  /* — Servicios — */
  cafe: (
    <>
      <path d="M4.5 8.5h12v6a4.5 4.5 0 0 1-4.5 4.5H9a4.5 4.5 0 0 1-4.5-4.5v-6Z" />
      <path d="M16.5 10.5h1.8a2.6 2.6 0 0 1 0 5.2h-1.8" />
      <path d="M8 3.2c-.7 1 .5 1.6-.2 2.6M12 3.2c-.7 1 .5 1.6-.2 2.6" />
    </>
  ),
  taza: (
    <>
      <path d="M5 9h11v5.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z" />
      <path d="M16 10.8h1.5a2.2 2.2 0 0 1 0 4.4H16" />
      <path d="M4 21.5h14" />
    </>
  ),
  plato: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.4" />
    </>
  ),
  luna: <path d="M20 14.2A8.5 8.5 0 0 1 9.3 3.6a8.5 8.5 0 1 0 10.7 10.6Z" />,
  caja: (
    <>
      <path d="M3.5 7.6 12 3.5l8.5 4.1v8.8L12 20.5 3.5 16.4V7.6Z" />
      <path d="M3.5 7.6 12 11.8l8.5-4.2M12 11.8v8.7" />
    </>
  ),
  credencial: (
    <>
      <rect x="3.5" y="6.5" width="17" height="13" rx="2.2" />
      <circle cx="9" cy="12" r="2.2" />
      <path d="M5.6 17c.5-1.6 1.8-2.4 3.4-2.4s2.9.8 3.4 2.4M14.8 10.5h3.6M14.8 13.5h2.4" />
    </>
  ),
  transporte: (
    <>
      <rect x="4" y="4.5" width="16" height="12.5" rx="2.4" />
      <path d="M4 11h16" />
      <circle cx="8" cy="14.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="14.2" r="1" fill="currentColor" stroke="none" />
      <path d="M7 17v2.5M17 17v2.5" />
    </>
  ),
  carpeta: (
    <>
      <path d="M3.5 6.6A1.6 1.6 0 0 1 5.1 5h4l2 2.4h7.8a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6V6.6Z" />
    </>
  ),
  bolsa: (
    <>
      <path d="M5.5 8h13l-1 11.2a1.6 1.6 0 0 1-1.6 1.3H8.1a1.6 1.6 0 0 1-1.6-1.3L5.5 8Z" />
      <path d="M9 10V6.8a3 3 0 0 1 6 0V10" />
    </>
  ),
  copa: (
    <>
      <path d="M6 4h12l-1.2 5.2A5 5 0 0 1 12 13a5 5 0 0 1-4.8-3.8L6 4Z" />
      <path d="M12 13v6M8.5 19.5h7" />
    </>
  ),
};

export type IconName = keyof typeof P | string;

interface Props extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: Props) {
  const path = P[name] ?? P.caja;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {path}
    </svg>
  );
}

/** Marca de la aplicación: pluma sobre documento sellado. */
export function Marca({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.5 3.2h8.2L18.5 8v12.8H5.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path d="M13.7 3.2V8h4.8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity="0.55" />
      <path
        d="M8 15.9c1.9-3.4 2.8-5.4 3.5-5.4.8 0 .6 4.2 1.7 4.2s1.1-1.8 2.3-1.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

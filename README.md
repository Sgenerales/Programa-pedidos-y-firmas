# ACTA · Control de entregas

Kiosko en tablet para controlar entregas firmadas durante un evento: el operador
busca a la persona por nombre, ésta firma en pantalla, y queda un registro
auditable por persona y por turno.

Pensado para el caso real: un evento de varios días donde hay que entregar
desayuno, almuerzo y cena en mano, persona por persona, y después rendir cuentas
de quién recibió qué.

---

## El modelo

Todo el sistema se apoya en una sola idea:

```
Evento → Días × Servicios = Turnos
Persona × Turno = Entrega firmada
```

Los **días** se generan del rango de fechas del evento. Los **servicios** son lo
que se entrega (Desayuno, Almuerzo, Cena, Kit, Credencial, lo que definas). La
**grilla de turnos** es la matriz donde marcás qué servicio se presta en qué
jornada — y ahí está toda la adaptabilidad:

- Un evento con solo almuerzo → activás una sola columna.
- Un evento con almuerzo y cena → dos columnas.
- Un evento de 3 días donde el último no hay cena → apagás esa celda.

Un turno que no existe en la grilla no existe para el kiosko ni para los
reportes. No hay estados intermedios.

Cada **entrega** congela el nombre y el documento tal como estaban al momento de
firmar, junto con la hora, el operador, el dispositivo y un **sello de
verificación** (SHA-256 de los campos probatorios). Si después alguien edita el
padrón, el acta ya emitida no cambia.

---

## Cómo se usa

1. **Eventos** — creás el evento con nombre, organizador, lugar y rango de fechas.
2. **Configuración** — agregás servicios y marcás la grilla de días × servicios.
   Por servicio decidís si exige firma o se confirma con un toque. Por turno
   podés restringir qué grupos pueden recibir (ej: cena solo para staff).
3. **Padrón** — importás el `.xlsx` o `.csv`. Detecta las columnas solo, maneja
   el caso de nombre y apellido separados, y te muestra qué filas son nuevas,
   cuáles están repetidas y cuáles no tienen nombre **antes** de guardar nada.
4. **Kiosko** — pantalla completa. Elegís el turno (se propone solo según la
   hora), buscás, la persona firma, confirma. Vuelve al buscador limpio.
5. **Reportes** — cobertura por turno, flujo completo por persona, acta
   imprimible con las firmas, y export a Excel de 4 hojas.

---

## Decisiones que vale la pena conocer

**Local-first.** Todo se guarda en IndexedDB en la tablet. La app funciona
completa sin conexión — que es exactamente lo que hace falta en el salón de un
hotel con wifi saturado. La nube es opcional y aditiva.

**El padrón se carga entero en memoria.** Con ~170 personas el filtrado es
instantáneo y no depende de la red. La búsqueda ignora acentos, mayúsculas y
orden: escribir `munoz jose` encuentra a *José Ángel Muñoz Peña*.

**Doble check-in imposible por construcción.** El índice único
`(slotId, personId)` vive en IndexedDB y, si sincronizás, también en Postgres. El
segundo operador que intente registrar a la misma persona en el mismo turno ve
*"ya recibió almuerzo de Día 1 a las 12:53, registrado por Marcelo"* — nunca
sobreescribe la firma del primero.

**El trazo sobrevive a los errores.** Si falla el guardado, se muestra el error
y el canvas queda intacto: se reintenta sin pedirle a la persona que vuelva a
firmar.

**La firma se guarda dos veces.** Como PNG recortado a su caja envolvente (para
mostrar) y como trazos vectoriales (para reimprimir nítido a cualquier tamaño).
El ancho del trazo varía con la velocidad del puntero, así que se ve como tinta
y no como una línea plana.

**CSV con acentos.** SheetJS asume codepage 1252 al leer CSV en binario, lo que
convierte `María` en `MarÃ­a`. El importador decodifica por su cuenta: BOM →
UTF-8 estricto → windows-1252 como último recurso.

**Nada se borra en silencio.** No se puede desactivar un turno que ya tiene
entregas, ni eliminar una persona que firmó. Las entregas se anulan con motivo
y quedan en el acta tachadas, nunca se borran.

---

## La nube

La app viene conectada: la URL y la clave publicable se hornean en el build
(`.env.local` en desarrollo, variables de entorno en el hosting). Una tablet nueva
se abre, ingresa correo y contraseña, y ya opera. No se configura nada por
dispositivo.

**Se entra una sola vez.** La sesión queda guardada y se renueva sola. Después el
kiosko funciona sin red y sincroniza cuando vuelve — que es lo que hace falta en
el salón de un hotel con wifi saturado.

**Ninguna firma se queda en la tablet.** Cada entrega se escribe primero en
IndexedDB y sale hacia la nube apenas se confirma. Si falla, queda en cola y el
motor reintenta: al volver la red, al volver la app al frente, cada 30 segundos, y
antes de cerrar sesión. La estructura del evento se publica automáticamente antes
de cada subida, así que nunca hay entregas rebotando por clave foránea. El
indicador de la barra superior dice en todo momento cuántas quedan sin subir, y en
Ajustes hay un botón que cuenta las confirmadas directamente en Postgres.

### Puesta en marcha

1. Ejecutá `supabase/migrations/` en el SQL Editor (o `schema.sql`, son idénticos).
2. Creá cada usuario en **Authentication → Users** con *Auto Confirm* activado.
3. Autorizalo con `supabase/autorizar_usuario.sql`, indicando correo, nombre y rol.

Los roles son `admin` (puede eliminar), `operator` (registra entregas) y `auditor`
(solo lectura). El nombre cargado ahí es el que queda impreso en el acta junto a
cada firma que registre esa persona.

Las políticas RLS bloquean por completo a `anon`: sin sesión no se lee ni se
escribe nada. La contraseña nunca se guarda en la configuración de ACTA.

Si las variables de entorno faltan, la app arranca igual en modo local y lo avisa
en Ajustes: se puede operar y exportar, pero sin respaldo en la nube.

## Desarrollo

```bash
npm install
npm run dev
npm run build
```

Stack: React 19 · Vite 8 · TypeScript · Zustand · IndexedDB · SheetJS ·
Supabase (opcional).

### Estructura

```
src/
  types.ts               Modelo de dominio
  lib/
    idb.ts               Persistencia local e inserción única de entregas
    util.ts              Normalización de texto, fechas, sello SHA-256
    importar.ts          Lectura de Excel/CSV, detección de columnas
    exportar.ts          Reporte Excel de 4 hojas y respaldo JSON
    config.ts            URL y clave publicable horneadas en el build
    supabase.ts          Sesión, subida de entregas y tiempo real
    catalogo.ts          Plantillas de servicios
  store/
    useStore.ts          Estado y reglas de negocio
    selectors.ts         Datos derivados para la UI
  components/
    SignaturePad.tsx     Captura de firma con ancho variable
    SyncPill.tsx         Estado de la cola hacia la nube
    Icon.tsx             Set de íconos propio
    ui.tsx               Modal, avisos, campos
  pages/                 Login · Eventos · Configuración · Padrón · Kiosko
                         Reportes · Ajustes
supabase/
  schema.sql             Esquema completo (idempotente)
  migrations/            El mismo esquema, versionado
  autorizar_usuario.sql  Alta de miembros
scripts/aplicar-sql.mjs  Ejecuta SQL via Management API
```

### Nota sobre SheetJS

`xlsx` se instala desde el CDN oficial de SheetJS, no desde npm: la versión
publicada en npm (0.18.5) está congelada y arrastra dos advisories sin
corrección. La del CDN (0.20.3) los resuelve.

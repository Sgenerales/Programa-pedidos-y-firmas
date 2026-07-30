/* ═══════════════════════════════════════════════════════════════════
   Capa de persistencia local (IndexedDB)
   ───────────────────────────────────────────────────────────────────
   Sin dependencias. La app es local-first: todo se escribe acá primero
   y recién después, si hay Supabase configurado, se replica.
   ═══════════════════════════════════════════════════════════════════ */

export const DB_NAME = 'acta-entregas';
export const DB_VERSION = 1;

export type StoreName =
  | 'events'
  | 'days'
  | 'services'
  | 'slots'
  | 'people'
  | 'deliveries'
  | 'signatures'
  | 'meta';

interface StoreDef {
  name: StoreName;
  indexes: { name: string; keyPath: string | string[]; unique?: boolean }[];
}

const STORES: StoreDef[] = [
  { name: 'events', indexes: [] },
  { name: 'days', indexes: [{ name: 'eventId', keyPath: 'eventId' }] },
  { name: 'services', indexes: [{ name: 'eventId', keyPath: 'eventId' }] },
  {
    name: 'slots',
    indexes: [
      { name: 'eventId', keyPath: 'eventId' },
      { name: 'dayService', keyPath: ['dayId', 'serviceId'], unique: true },
    ],
  },
  { name: 'people', indexes: [{ name: 'eventId', keyPath: 'eventId' }] },
  {
    name: 'deliveries',
    indexes: [
      { name: 'eventId', keyPath: 'eventId' },
      { name: 'slotPerson', keyPath: ['slotId', 'personId'], unique: true },
      { name: 'sync', keyPath: 'sync' },
    ],
  },
  { name: 'signatures', indexes: [{ name: 'eventId', keyPath: 'eventId' }] },
  { name: 'meta', indexes: [] },
];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const def of STORES) {
        const store = db.objectStoreNames.contains(def.name)
          ? req.transaction!.objectStore(def.name)
          : db.createObjectStore(def.name, { keyPath: 'id' });
        for (const idx of def.indexes) {
          if (!store.indexNames.contains(idx.name)) {
            store.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir la base local'));
    req.onblocked = () =>
      reject(new Error('La base local está bloqueada por otra pestaña. Cerrala y reintentá.'));
  });
  return dbPromise;
}

function tx(db: IDBDatabase, stores: StoreName[], mode: IDBTransactionMode) {
  return db.transaction(stores, mode);
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('Fallo la transacción local'));
    t.onabort = () => reject(t.error ?? new Error('Transacción local abortada'));
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Fallo la operación local'));
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return wrap(tx(db, [store], 'readonly').objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function getByIndex<T>(
  store: StoreName,
  index: string,
  value: IDBValidKey,
): Promise<T[]> {
  const db = await openDb();
  return wrap(
    tx(db, [store], 'readonly').objectStore(store).index(index).getAll(value) as IDBRequest<T[]>,
  );
}

export async function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await openDb();
  return wrap(tx(db, [store], 'readonly').objectStore(store).get(id) as IDBRequest<T | undefined>);
}

export async function put<T extends { id: string }>(store: StoreName, value: T): Promise<T> {
  const db = await openDb();
  const t = tx(db, [store], 'readwrite');
  t.objectStore(store).put(value);
  await done(t);
  return value;
}

export async function putMany<T extends { id: string }>(
  store: StoreName,
  values: T[],
): Promise<void> {
  if (!values.length) return;
  const db = await openDb();
  const t = tx(db, [store], 'readwrite');
  const os = t.objectStore(store);
  for (const v of values) os.put(v);
  await done(t);
}

export async function remove(store: StoreName, id: string): Promise<void> {
  const db = await openDb();
  const t = tx(db, [store], 'readwrite');
  t.objectStore(store).delete(id);
  await done(t);
}

export async function removeMany(store: StoreName, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const t = tx(db, [store], 'readwrite');
  const os = t.objectStore(store);
  for (const id of ids) os.delete(id);
  await done(t);
}

/**
 * Inserta una entrega respetando el índice único (slotId, personId).
 * Devuelve la entrega existente si ya había una: así el segundo operador
 * ve "ya entregado a las hh:mm" en vez de pisar la firma del primero.
 */
export async function insertDeliveryUnique<T extends { id: string; slotId: string; personId: string }>(
  delivery: T,
  signature: { id: string } | null,
): Promise<{ ok: true } | { ok: false; existente: T }> {
  const previa = await getDeliveryBySlotPerson<T>(delivery.slotId, delivery.personId);
  if (previa) return { ok: false, existente: previa };

  const db = await openDb();
  const stores: StoreName[] = signature ? ['deliveries', 'signatures'] : ['deliveries'];
  const t = tx(db, stores, 'readwrite');
  // `add` (no `put`) + índice único: si otra pestaña ganó la carrera entre
  // la lectura previa y esta escritura, la transacción aborta por
  // ConstraintError en vez de sobreescribir la firma que ya estaba.
  t.objectStore('deliveries').add(delivery);
  if (signature) t.objectStore('signatures').put(signature);

  try {
    await done(t);
  } catch (err) {
    const existente = await getDeliveryBySlotPerson<T>(delivery.slotId, delivery.personId);
    if (existente) return { ok: false, existente };
    throw err;
  }
  return { ok: true };
}

export async function getDeliveryBySlotPerson<T>(
  slotId: string,
  personId: string,
): Promise<T | undefined> {
  const db = await openDb();
  return wrap(
    tx(db, ['deliveries'], 'readonly')
      .objectStore('deliveries')
      .index('slotPerson')
      .get([slotId, personId]) as IDBRequest<T | undefined>,
  );
}

/** Borra en cascada todo lo asociado a un evento. */
export async function purgeEvent(eventId: string): Promise<void> {
  const scoped: StoreName[] = ['days', 'services', 'slots', 'people', 'deliveries', 'signatures'];
  for (const store of scoped) {
    const rows = await getByIndex<{ id: string }>(store, 'eventId', eventId);
    await removeMany(store, rows.map((r) => r.id));
  }
  await remove('events', eventId);
}

/** Tamaño aproximado ocupado, para mostrarlo en Ajustes. */
export async function estimateUsage(): Promise<{ usado: number; cuota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usado: est.usage ?? 0, cuota: est.quota ?? 0 };
}

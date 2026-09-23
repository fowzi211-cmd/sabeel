"use client";

// Storage for the driver app so a delivery can be finished with no signal: a small key-value cache
// (the job data as last seen) and an outbox of actions waiting to be sent, in the order they happened.
// Photos are kept as Blobs in the outbox. If IndexedDB is unavailable (some private modes) everything
// falls back to memory, so the app still works online — it just cannot survive a reload while offline.

export type OutboxType = "START" | "ARRIVED" | "PHOTO" | "CONFIRM" | "FAIL" | "PIN";

export interface OutboxItem {
  id?: number;
  createdAt: number;
  jobId: string;
  orderNo: string;
  type: OutboxType;
  payload: Record<string, unknown>;
  blob?: Blob;
  tries: number;
}

export interface FailedItem {
  at: number;
  orderNo: string;
  type: OutboxType;
  ar: string;
  en: string;
}

const DB_NAME = "sabeel-driver";
const memory = { kv: new Map<string, unknown>(), outbox: [] as OutboxItem[], seq: 1 };
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("kv");
        req.result.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory.kv.get(key) as T | undefined;
  return (await tx<T | undefined>(db, "kv", "readonly", (s) => s.get(key))) ?? undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    memory.kv.set(key, value);
    return;
  }
  await tx(db, "kv", "readwrite", (s) => s.put(value, key));
}

export async function outboxAdd(item: Omit<OutboxItem, "id" | "createdAt" | "tries">): Promise<OutboxItem> {
  const full: OutboxItem = { ...item, createdAt: Date.now(), tries: 0 };
  const db = await open();
  if (!db) {
    full.id = memory.seq++;
    memory.outbox.push(full);
    return full;
  }
  full.id = Number(await tx(db, "outbox", "readwrite", (s) => s.add(full)));
  return full;
}

export async function outboxList(): Promise<OutboxItem[]> {
  const db = await open();
  if (!db) return [...memory.outbox];
  const all = await tx<OutboxItem[]>(db, "outbox", "readonly", (s) => s.getAll());
  return all.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function outboxRemove(id: number): Promise<void> {
  const db = await open();
  if (!db) {
    memory.outbox = memory.outbox.filter((i) => i.id !== id);
    return;
  }
  await tx(db, "outbox", "readwrite", (s) => s.delete(id));
}

export async function outboxTouch(item: OutboxItem): Promise<void> {
  const db = await open();
  if (!db) {
    memory.outbox = memory.outbox.map((i) => (i.id === item.id ? item : i));
    return;
  }
  await tx(db, "outbox", "readwrite", (s) => s.put(item));
}

/** Everything the app keeps on this phone. Called on sign-out so a shared phone never leaks the last driver's jobs. */
export async function clearDriverData(): Promise<void> {
  memory.kv.clear();
  memory.outbox = [];
  const db = await open();
  if (db) {
    await tx(db, "kv", "readwrite", (s) => s.clear()).catch(() => undefined);
    await tx(db, "outbox", "readwrite", (s) => s.clear()).catch(() => undefined);
  }
  if (typeof caches !== "undefined") {
    const keys = await caches.keys().catch(() => [] as string[]);
    await Promise.all(keys.filter((k) => k.startsWith("sabeel-driver")).map((k) => caches.delete(k)));
  }
}

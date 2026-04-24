// Persistência local de PDFs uploaded durante uma sessão de expedição.
// Os PDFs ficam no IndexedDB, associados ao sessaoId. Ao encerrar sessão ou
// trocar de sessão, os arquivos são descartados.
//
// Fora de sessão, não é usado — PDFs são mantidos só em memória.

const DB_NAME = "expedicao_session";
const DB_VERSION = 1;
const STORE = "pdfs";

type StoredPdf = {
  key: string; // `${sessaoId}::${order}::${name}`
  sessaoId: string;
  order: number;
  name: string;
  blob: Blob;
  storedAt: number;
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("sessaoId", "sessaoId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const p = Promise.resolve(fn(store));
    tx.oncomplete = () => p.then(resolve, reject);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveSessionFiles(
  sessaoId: string,
  files: File[],
): Promise<void> {
  if (!isBrowser()) return;
  // Substitui completamente o set do sessaoId pelo novo
  await deleteSessionFiles(sessaoId);
  await withStore("readwrite", async (store) => {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const record: StoredPdf = {
        key: `${sessaoId}::${String(i).padStart(6, "0")}::${f.name}`,
        sessaoId,
        order: i,
        name: f.name,
        // File herda de Blob — guardamos como Blob sem perda
        blob: f,
        storedAt: Date.now(),
      };
      store.put(record);
    }
  });
}

export async function loadSessionFiles(sessaoId: string): Promise<File[]> {
  if (!isBrowser()) return [];
  const records: StoredPdf[] = await withStore("readonly", (store) => {
    return new Promise<StoredPdf[]>((resolve, reject) => {
      const idx = store.index("sessaoId");
      const req = idx.getAll(IDBKeyRange.only(sessaoId));
      req.onsuccess = () => resolve((req.result as StoredPdf[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  });
  records.sort((a, b) => a.order - b.order);
  return records.map(
    (r) =>
      new File([r.blob], r.name, {
        type: r.blob.type || "application/pdf",
      }),
  );
}

export async function deleteSessionFiles(sessaoId: string): Promise<void> {
  if (!isBrowser()) return;
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const idx = store.index("sessaoId");
      const req = idx.openKeyCursor(IDBKeyRange.only(sessaoId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

// Limpa tudo que não pertença a nenhuma das sessões ativas informadas
// (usado como housekeeping ao montar a página).
export async function purgeOtherSessions(
  keepSessaoIds: string[],
): Promise<void> {
  if (!isBrowser()) return;
  const keep = new Set(keepSessaoIds);
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const value = cursor.value as StoredPdf;
          if (!keep.has(value.sessaoId)) cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

// Persistência local de PDFs uploaded na expedição diária. Os arquivos
// ficam no IndexedDB associados ao userId do operador — sobrevivem a
// reload, troca de aba e até a logout/login do mesmo usuário. O usuário
// pode limpar manualmente via "Limpar Fila".

const DB_NAME = "expedicao_session";
const DB_VERSION = 2;
const STORE = "pdfs";

type StoredPdf = {
  key: string; // `${userId}::${order}::${name}`
  bucketId: string; // userId (chave lógica de agrupamento)
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
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const oldVersion = e.oldVersion ?? 0;
      // Em versões antigas o store usava o nome de índice "sessaoId" —
      // recria pra alinhar com o novo nome `bucketId`.
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("bucketId", "bucketId", { unique: false });
      } else if (oldVersion < 2) {
        // Drop e recria com índice novo. Os dados antigos (chaveados por
        // sessaoId) ficam órfãos e são ignorados — usuário precisa
        // re-upload, mas sem erro.
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("bucketId", "bucketId", { unique: false });
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

export async function saveUserFiles(
  userId: string,
  files: File[],
): Promise<void> {
  if (!isBrowser() || !userId) return;
  await deleteUserFiles(userId);
  await withStore("readwrite", async (store) => {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const record: StoredPdf = {
        key: `${userId}::${String(i).padStart(6, "0")}::${f.name}`,
        bucketId: userId,
        order: i,
        name: f.name,
        blob: f,
        storedAt: Date.now(),
      };
      store.put(record);
    }
  });
}

export async function loadUserFiles(userId: string): Promise<File[]> {
  if (!isBrowser() || !userId) return [];
  const records: StoredPdf[] = await withStore("readonly", (store) => {
    return new Promise<StoredPdf[]>((resolve, reject) => {
      const idx = store.index("bucketId");
      const req = idx.getAll(IDBKeyRange.only(userId));
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

export async function deleteUserFiles(userId: string): Promise<void> {
  if (!isBrowser() || !userId) return;
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const idx = store.index("bucketId");
      const req = idx.openKeyCursor(IDBKeyRange.only(userId));
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

// Limpa qualquer bucket que não pertença ao userId atual — usado como
// housekeeping ao montar a página, evita misturar PDFs de operadores
// diferentes que tenham logado no mesmo navegador.
export async function purgeOtherUsers(currentUserId: string): Promise<void> {
  if (!isBrowser() || !currentUserId) return;
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const value = cursor.value as StoredPdf;
          if (value.bucketId !== currentUserId) cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

const DATABASE = "gridsplit-studio-audio", STORE = "audio-blobs", VERSION = 1;
interface StoredAudio { key: string; blob: Blob; savedAt: string }
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser does not support local audio storage. Use a current desktop browser."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local audio storage."));
    request.onblocked = () => reject(new Error("Local audio storage is blocked by another open GridSplit tab."));
  });
}
function storageKey(projectId: string, segmentId: string): string { return `${projectId}::${segmentId}`; }
export async function saveGeneratedAudio(projectId: string, segmentId: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key: storageKey(projectId, segmentId), blob, savedAt: new Date().toISOString() } satisfies StoredAudio);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error ?? new Error("Could not save generated audio locally."));
    tx.onabort = () => reject(tx.error ?? new Error("Local audio save was cancelled."));
  }).finally(() => db.close());
}
export async function readGeneratedAudio(projectId: string, segmentId: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly"), req = tx.objectStore(STORE).get(storageKey(projectId, segmentId));
    let result: Blob | null = null;
    req.onsuccess = () => { const value = req.result as StoredAudio | undefined; result = value?.blob instanceof Blob ? value.blob : null; };
    tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error ?? new Error("Could not load the saved audio preview."));
  }).finally(() => db.close());
}
export async function deleteGeneratedAudio(projectId: string, segmentId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(storageKey(projectId, segmentId));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error ?? new Error("Could not remove the old audio segment."));
  }).finally(() => db.close());
}

/** Remove every generated WAV object belonging to a deleted project. */
export async function deleteProjectAudio(projectId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const range = IDBKeyRange.bound(`${projectId}::`, `${projectId}::\uffff`);
    transaction.objectStore(STORE).delete(range);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clean up deleted project audio."));
  }).finally(() => db.close());
}

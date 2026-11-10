const DATABASE = "gridsplit-studio-images";
const STORE = "image-blobs";
const VERSION = 1;

interface StoredImage {
  key: string;
  blob: Blob;
  savedAt: string;
}

function keyFor(projectId: string, assetId: string): string {
  return projectId + "::" + assetId;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser does not support local image storage."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local image storage."));
    request.onblocked = () => reject(new Error("Local image storage is blocked by another open GridSplit tab."));
  });
}

export async function saveImageBlob(projectId: string, assetId: string, blob: Blob): Promise<void> {
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error("Choose a non-empty image file.");
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        key: keyFor(projectId, assetId),
        blob,
        savedAt: new Date().toISOString(),
      } satisfies StoredImage);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save the image locally."));
      tx.onabort = () => reject(tx.error ?? new Error("Local image save was cancelled."));
    });
  } finally {
    db.close();
  }
}

export async function readImageBlob(projectId: string, assetId: string): Promise<Blob | null> {
  const db = await openDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(keyFor(projectId, assetId));
      let blob: Blob | null = null;
      request.onsuccess = () => {
        const value = request.result as StoredImage | undefined;
        blob = value?.blob instanceof Blob ? value.blob : null;
      };
      tx.oncomplete = () => resolve(blob);
      tx.onerror = () => reject(tx.error ?? new Error("Could not read the saved image."));
    });
  } finally {
    db.close();
  }
}

export async function deleteImageBlob(projectId: string, assetId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(keyFor(projectId, assetId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not remove the saved image."));
    });
  } finally {
    db.close();
  }
}

export async function deleteProjectImages(projectId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(IDBKeyRange.bound(
        projectId + "::",
        projectId + "::\uffff",
      ));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not clean up the project's images."));
    });
  } finally {
    db.close();
  }
}

export async function cloneProjectImageBlobs(
  sourceProjectId: string,
  targetProjectId: string,
  assetIds: string[],
): Promise<void> {
  for (const assetId of assetIds) {
    const blob = await readImageBlob(sourceProjectId, assetId);
    if (blob) await saveImageBlob(targetProjectId, assetId, blob);
  }
}

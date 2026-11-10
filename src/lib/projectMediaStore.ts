const DATABASE = "gridsplit-studio-project-media";
const STORE = "media-blobs";
const VERSION = 1;

interface StoredProjectMedia {
  key: string;
  projectId: string;
  assetId: string;
  blob: Blob;
  savedAt: string;
}

function mediaKey(projectId: string, assetId: string): string {
  return projectId + "::" + assetId;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser does not support local project media storage."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local project media storage."));
    request.onblocked = () => reject(new Error("Project media storage is blocked by another open GridSplit tab."));
  });
}

export async function saveProjectMedia(projectId: string, assetId: string, blob: Blob): Promise<void> {
  if (!projectId.trim() || !assetId.trim() || !(blob instanceof Blob) || blob.size <= 0) {
    throw new Error("A valid project, asset ID, and non-empty media file are required.");
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({
      key: mediaKey(projectId, assetId),
      projectId,
      assetId,
      blob,
      savedAt: new Date().toISOString(),
    } satisfies StoredProjectMedia);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save this media file."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving this media file was cancelled."));
  }).finally(() => db.close());
}

export async function readProjectMedia(projectId: string, assetId: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise<Blob | null>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(mediaKey(projectId, assetId));
    let blob: Blob | null = null;
    request.onsuccess = () => {
      const value = request.result as StoredProjectMedia | undefined;
      blob = value?.blob instanceof Blob ? value.blob : null;
    };
    transaction.oncomplete = () => resolve(blob);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not read this media file."));
  }).finally(() => db.close());
}

export async function deleteProjectMedia(projectId: string, assetId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(mediaKey(projectId, assetId));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove this media file."));
  }).finally(() => db.close());
}

export async function deleteAllProjectMedia(projectId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(IDBKeyRange.bound(projectId + "::", projectId + "::\uffff"));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clean up project media."));
  }).finally(() => db.close());
}

/** IndexedDB helpers intentionally match the existing M22 image store contract. */
const IMAGE_DATABASE = "gridsplit-studio-images";
const IMAGE_STORE = "image-blobs";

function openImageDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser does not support local image storage."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_STORE)) {
        request.result.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local image storage."));
    request.onblocked = () => reject(new Error("Local image storage is blocked by another open GridSplit tab."));
  });
}

export async function readProjectImageBlob(assetId: string): Promise<Blob | null> {
  const db = await openImageDatabase();
  return new Promise<Blob | null>((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE, "readonly");
    const request = transaction.objectStore(IMAGE_STORE).get(assetId);
    let blob: Blob | null = null;
    request.onsuccess = () => {
      const value = request.result as { id?: string; blob?: Blob } | undefined;
      blob = value?.blob instanceof Blob ? value.blob : null;
    };
    transaction.oncomplete = () => resolve(blob);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not read this image asset."));
  }).finally(() => db.close());
}

export async function saveProjectImageBlob(assetId: string, blob: Blob): Promise<void> {
  if (!assetId.trim() || !(blob instanceof Blob) || blob.size <= 0) {
    throw new Error("A valid image asset ID and non-empty image are required.");
  }
  const db = await openImageDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE, "readwrite");
    transaction.objectStore(IMAGE_STORE).put({ id: assetId, blob });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not restore this image asset."));
  }).finally(() => db.close());
}

export async function deleteProjectImageBlob(assetId: string): Promise<void> {
  const db = await openImageDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE, "readwrite");
    transaction.objectStore(IMAGE_STORE).delete(assetId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove this image asset."));
  }).finally(() => db.close());
}

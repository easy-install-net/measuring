const DB_NAME = "measuring_offline_vault_v1";
const DB_VERSION = 1;
const STORE_PROJECTS = "projects";
const STORE_MEDIA = "media";
const STORE_KV = "kv";
const STORE_QUEUE = "sync_queue";

let dbPromise = null;

function openOfflineDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_MEDIA)) db.createObjectStore(STORE_MEDIA, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: "queueId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbSaveProject(proj) {
  if (!proj || !proj.id) return;
  const db = await openOfflineDB();
  const slim = {
    ...proj,
    pages: (proj.pages || []).map(pg => ({ ...pg, sitePhotoUrl: "" }))
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    tx.objectStore(STORE_PROJECTS).put(slim);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGetAllProjects() {
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_PROJECTS, "readonly");
    const req = tx.objectStore(STORE_PROJECTS).getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => resolve([]);
  });
}

export async function idbDeleteProject(id) {
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    tx.objectStore(STORE_PROJECTS).delete(String(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function idbSaveMedia(mediaId, imageData, meta = {}) {
  if (!mediaId || !imageData) return;
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_MEDIA, "readwrite");
    tx.objectStore(STORE_MEDIA).put({
      id: String(mediaId),
      imageData,
      ...meta,
      updatedAt: Date.now()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function idbGetMedia(mediaId) {
  if (!mediaId) return "";
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_MEDIA, "readonly");
    const req = tx.objectStore(STORE_MEDIA).get(String(mediaId));
    req.onsuccess = () => resolve(req.result?.imageData || "");
    req.onerror = () => resolve("");
  });
}

export async function idbSetKV(key, value) {
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_KV, "readwrite");
    tx.objectStore(STORE_KV).put({ key, value, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function idbGetKV(key) {
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_KV, "readonly");
    const req = tx.objectStore(STORE_KV).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => resolve(null);
  });
}

export async function idbEnqueueSync(task) {
  const db = await openOfflineDB();
  const queueId = task.queueId || `${task.type}_${task.targetId}`;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).put({ ...task, queueId, queuedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function idbGetSyncQueue() {
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_QUEUE, "readonly");
    const req = tx.objectStore(STORE_QUEUE).getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => resolve([]);
  });
}

export async function idbRemoveSyncTask(queueId) {
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).delete(queueId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

const FS_SUPPORTED = typeof window.showDirectoryPicker === "function";

const IDB_NAME = "kit-tracker-storage";
const IDB_STORE = "handles";
const IDB_DIR_KEY = "dataDir";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(IDB_STORE, "readonly")
      .objectStore(IDB_STORE)
      .get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let cachedDirHandle = null;

async function hasPermission(handle, mode) {
  return (await handle.queryPermission({ mode })) === "granted";
}

async function requestPermission(handle, mode) {
  if (await hasPermission(handle, mode)) return true;
  return (await handle.requestPermission({ mode })) === "granted";
}

// Reuses a previously-granted folder handle without prompting the user.
// Returns null if none is remembered or permission is no longer granted.
async function getSavedDirectoryHandle() {
  if (!FS_SUPPORTED) return null;
  if (cachedDirHandle && (await hasPermission(cachedDirHandle, "readwrite"))) {
    return cachedDirHandle;
  }
  try {
    const saved = await idbGet(IDB_DIR_KEY);
    if (saved && (await hasPermission(saved, "readwrite"))) {
      cachedDirHandle = saved;
      return cachedDirHandle;
    }
  } catch (err) {
    console.error(err);
  }
  return null;
}

// Must be called from a click handler: prompts the user to choose the
// "data" folder and remembers it for future visits.
async function chooseDirectoryHandle() {
  const handle = await window.showDirectoryPicker({
    id: "kit-tracker-data",
    mode: "readwrite",
  });
  if (!(await requestPermission(handle, "readwrite"))) {
    throw new Error("Permission to read/write that folder was denied.");
  }
  cachedDirHandle = handle;
  await idbSet(IDB_DIR_KEY, handle);
  return handle;
}

async function readJsonFromDir(dir, name, fallback) {
  try {
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text.trim() ? JSON.parse(text) : fallback;
  } catch (err) {
    if (err.name === "NotFoundError") return fallback;
    throw err;
  }
}

async function writeJsonToDir(dir, name, data) {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

// ---------- localStorage fallback ----------
const LS_MATCHES_KEY = "kit-tracker-matches";
const LS_BRACKET_KEY = "kit-tracker-bracket";

function readLocalStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error(err);
    return fallback;
  }
}

function writeLocalStorageJson(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// ---------- Public API used by app.js ----------
const DataStore = {
  isFileSystemSupported: FS_SUPPORTED,

  async isConnected() {
    return (await getSavedDirectoryHandle()) !== null;
  },

  chooseDirectoryHandle,

  async loadMatches() {
    const dir = await getSavedDirectoryHandle();
    if (dir) return readJsonFromDir(dir, "matches.json", []);
    return readLocalStorageJson(LS_MATCHES_KEY, []);
  },

  async saveMatches(matches) {
    const dir = await getSavedDirectoryHandle();
    if (dir) return writeJsonToDir(dir, "matches.json", matches);
    writeLocalStorageJson(LS_MATCHES_KEY, matches);
  },

  async loadBracket() {
    const dir = await getSavedDirectoryHandle();
    if (dir) return readJsonFromDir(dir, "bracket.json", {});
    return readLocalStorageJson(LS_BRACKET_KEY, {});
  },

  async saveBracket(assignments) {
    const dir = await getSavedDirectoryHandle();
    if (dir) return writeJsonToDir(dir, "bracket.json", assignments);
    writeLocalStorageJson(LS_BRACKET_KEY, assignments);
  },
};

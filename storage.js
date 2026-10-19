// ---------- Local, no-server storage ----------
// This app is opened directly as a file (no "npm start" / server needed).
// Data is read from and written directly to a matches.json file using the
// browser's File System Access API (Chrome/Edge): the first time you use
// the app, click "Connect matches.json" and choose this project's
// "matches.json" file (it sits alongside index.html). That file handle is
// then remembered (via IndexedDB) so you won't be asked again on future
// visits.
//
// Browsers without that API (Firefox, Safari) instead keep data in this
// browser's local storage. Use the Export/Import buttons to keep that in
// sync with matches.json, e.g. when moving to another machine.
//
// There is no separate bracket data file — the Bracket tab is derived
// entirely from each match's "event" and "round" fields at render time.

const FS_SUPPORTED = typeof window.showOpenFilePicker === "function";

const IDB_NAME = "kit-tracker-storage";
const IDB_STORE = "handles";
const IDB_FILE_KEY = "matchesFile";

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

let cachedFileHandle = null;

async function hasPermission(handle, mode) {
  return (await handle.queryPermission({ mode })) === "granted";
}

async function requestPermission(handle, mode) {
  if (await hasPermission(handle, mode)) return true;
  return (await handle.requestPermission({ mode })) === "granted";
}

// Reuses a previously-granted file handle without prompting the user.
// Returns null if none is remembered or permission is no longer granted.
async function getSavedFileHandle() {
  if (!FS_SUPPORTED) return null;
  if (
    cachedFileHandle &&
    (await hasPermission(cachedFileHandle, "readwrite"))
  ) {
    return cachedFileHandle;
  }
  try {
    const saved = await idbGet(IDB_FILE_KEY);
    if (saved && (await hasPermission(saved, "readwrite"))) {
      cachedFileHandle = saved;
      return cachedFileHandle;
    }
  } catch (err) {
    console.error(err);
  }
  return null;
}

// Must be called from a click handler: prompts the user to choose the
// matches.json file and remembers it for future visits.
async function chooseMatchesFile() {
  const [handle] = await window.showOpenFilePicker({
    id: "kit-tracker-matches-file",
    types: [
      {
        description: "JSON file",
        accept: { "application/json": [".json"] },
      },
    ],
    excludeAcceptAllOption: false,
    multiple: false,
  });
  if (!(await requestPermission(handle, "readwrite"))) {
    throw new Error("Permission to read/write that file was denied.");
  }
  cachedFileHandle = handle;
  await idbSet(IDB_FILE_KEY, handle);
  return handle;
}

async function readJsonFromFile(fileHandle, fallback) {
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text.trim() ? JSON.parse(text) : fallback;
  } catch (err) {
    if (err.name === "NotFoundError") return fallback;
    throw err;
  }
}

async function writeJsonToFile(fileHandle, data) {
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

// ---------- localStorage fallback ----------
const LS_MATCHES_KEY = "kit-tracker-matches";

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
    return (await getSavedFileHandle()) !== null;
  },

  chooseMatchesFile,

  async loadMatches() {
    const fileHandle = await getSavedFileHandle();
    if (fileHandle) return readJsonFromFile(fileHandle, []);
    return readLocalStorageJson(LS_MATCHES_KEY, []);
  },

  async saveMatches(matches) {
    const fileHandle = await getSavedFileHandle();
    if (fileHandle) return writeJsonToFile(fileHandle, matches);
    writeLocalStorageJson(LS_MATCHES_KEY, matches);
  },
};

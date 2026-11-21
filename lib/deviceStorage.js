// lib/deviceStorage.js
// On-Device Client Storage Engine using the Origin Private File System (OPFS)
// with IndexedDB flash storage fallback for HTTP LAN environments (e.g. Android Phone / Tablet)
// Creates real, physical persistent storage on the client device
// under the requested hierarchy: <Device_name> / <Disk Name>

export function isOPFSSupported() {
  return typeof window !== "undefined" && Boolean(navigator.storage?.getDirectory);
}

function openDeviceDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB not supported"));
    }
    const request = indexedDB.open("MyOwnCloud_Device_Storage", 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("device_files")) {
        db.createObjectStore("device_files", { keyPath: "storage_path" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Access or create the on-device folder for a specific device and disk via OPFS
 * Hierarchy: <Device_name> / <Disk Name>
 */
export async function getDeviceDiskHandle(deviceName = "Android", diskName = "Internal Storage") {
  if (!isOPFSSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const safeDev = String(deviceName || "Device").replace(/[<>:"/\\|?*]/g, "_");
    const safeDisk = String(diskName || "Internal Storage").replace(/[<>:"/\\|?*]/g, "_");

    const deviceHandle = await root.getDirectoryHandle(safeDev, { create: true });
    const diskHandle = await deviceHandle.getDirectoryHandle(safeDisk, { create: true });
    return diskHandle;
  } catch (err) {
    console.warn("OPFS getDeviceDiskHandle error:", err);
    return null;
  }
}

/**
 * Initialize on-device storage on this client (phone/tablet/browser),
 * creating <Device_name>/<Disk Name> and querying real available flash storage.
 */
export async function initOnDeviceStorage(deviceName = "Android", diskName = "Internal Storage") {
  let freeBytes = 0;
  let totalBytes = 0;
  let freeStr = "On-Device Storage";

  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      totalBytes = Number(estimate.quota || 0);
      const used = Number(estimate.usage || 0);
      freeBytes = Math.max(0, totalBytes - used);
      if (freeBytes > 0) {
        const gb = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
        freeStr = `${gb} GB free`;
      }
    } catch {
      // Ignored
    }
  }

  if (isOPFSSupported()) {
    try {
      const diskHandle = await getDeviceDiskHandle(deviceName, diskName);
      return {
        supported: true,
        deviceName,
        diskName,
        folderPath: `${deviceName}/${diskName}`,
        freeBytes,
        totalBytes,
        freeStr: freeStr !== "On-Device Storage" ? freeStr : "Internal Storage",
        storageType: "client_opfs",
        diskHandle,
      };
    } catch {
      // Fall through to IndexedDB
    }
  }

  // Fallback to IndexedDB persistent storage on the phone
  try {
    const db = await openDeviceDB();
    db.close();
    return {
      supported: true,
      deviceName,
      diskName,
      folderPath: `${deviceName}/${diskName}`,
      freeBytes,
      totalBytes,
      freeStr: freeStr !== "On-Device Storage" ? freeStr : "Internal Storage",
      storageType: "client_indexeddb",
    };
  } catch {
    return {
      supported: false,
      deviceName,
      diskName,
      folderPath: `${deviceName}/${diskName}`,
      freeBytes,
      totalBytes,
      freeStr: "On-Device Storage",
      storageType: "client_storage",
    };
  }
}

/**
 * Write a file directly into the on-device physical storage folder: <Device_name>/<Disk Name>/<fileName>
 */
export async function writeOnDeviceFile(deviceName, diskName, fileName, fileBlobOrBuffer) {
  const safeDev = String(deviceName || "Device").trim();
  const safeDisk = String(diskName || "Internal Storage").trim();
  const storagePath = `${safeDev}/${safeDisk}/${fileName}`;

  // 1. Try OPFS first
  if (isOPFSSupported()) {
    try {
      const diskHandle = await getDeviceDiskHandle(safeDev, safeDisk);
      if (diskHandle) {
        const fileHandle = await diskHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(fileBlobOrBuffer);
        await writable.close();
        return true;
      }
    } catch (err) {
      console.warn("OPFS write error, using IndexedDB fallback:", err);
    }
  }

  // 2. Fallback to IndexedDB flash memory on the client device
  try {
    const db = await openDeviceDB();
    return new Promise((resolve) => {
      const tx = db.transaction("device_files", "readwrite");
      const store = tx.objectStore("device_files");
      store.put({
        storage_path: storagePath,
        device_name: safeDev,
        disk_name: safeDisk,
        file_name: fileName,
        data: fileBlobOrBuffer,
        saved_at: Date.now(),
      });
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch (err) {
    console.warn("writeOnDeviceFile error:", err);
    return false;
  }
}

/**
 * Read a file directly from the on-device physical storage folder
 */
export async function readOnDeviceFile(deviceName, diskName, fileName) {
  const safeDev = String(deviceName || "Device").trim();
  const safeDisk = String(diskName || "Internal Storage").trim();
  const storagePath = `${safeDev}/${safeDisk}/${fileName}`;

  // 1. Try OPFS first
  if (isOPFSSupported()) {
    try {
      const diskHandle = await getDeviceDiskHandle(safeDev, safeDisk);
      if (diskHandle) {
        const fileHandle = await diskHandle.getFileHandle(fileName);
        return await fileHandle.getFile();
      }
    } catch {
      // Fall through to IndexedDB
    }
  }

  // 2. Read from IndexedDB fallback
  try {
    const db = await openDeviceDB();
    return new Promise((resolve) => {
      const tx = db.transaction("device_files", "readonly");
      const store = tx.objectStore("device_files");
      const getReq = store.get(storagePath);
      getReq.onsuccess = () => {
        db.close();
        if (getReq.result && getReq.result.data) {
          resolve(getReq.result.data);
        } else {
          resolve(null);
        }
      };
      getReq.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DATABASE_PATH, DATA_DIRECTORY, IS_VERCEL, STORAGE_DIRECTORY, getUserDriveRoot, sanitizeStorageName } from "./config.js";
import { getAvailableDrives } from "./drives.js";

let databaseInstance;

function createDirectoryForFile(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}

function migrateFoldersTable(database) {
  const indexes = database.prepare("PRAGMA index_list('folders')").all();
  const hasSingleFolderConstraint = indexes.some((index) => {
    if (!index.unique) {
      return false;
    }

    const columns = database.prepare(`PRAGMA index_info('${index.name}')`).all();
    return columns.length === 1 && columns[0].name === "user_id";
  });

  if (!hasSingleFolderConstraint) {
    return;
  }

  database.exec(`
    BEGIN;

    CREATE TABLE folders_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      device_name TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, path)
    );

    INSERT INTO folders_v2 (id, user_id, path, device_name)
    SELECT id, user_id, path, device_name
    FROM folders;

    DROP TABLE folders;
    ALTER TABLE folders_v2 RENAME TO folders;

    COMMIT;
  `);
}

function ensureFolderNameColumn(database) {
  const columns = database.prepare("PRAGMA table_info('folders')").all();
  const hasNameColumn = columns.some((column) => column.name === "name");

  if (!hasNameColumn) {
    database.exec("ALTER TABLE folders ADD COLUMN name TEXT");
  }
}

function ensureUserColumns(database) {
  const columns = database.prepare("PRAGMA table_info('users')").all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("name")) {
    database.exec("ALTER TABLE users ADD COLUMN name TEXT");
  }
  if (!columnNames.has("firebase_uid")) {
    database.exec("ALTER TABLE users ADD COLUMN firebase_uid TEXT");
  }
  if (!columnNames.has("storage_path")) {
    database.exec("ALTER TABLE users ADD COLUMN storage_path TEXT");
  }
}

function ensureDeviceColumns(database) {
  const columns = database.prepare("PRAGMA table_info('devices')").all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("device_token")) {
    database.exec("ALTER TABLE devices ADD COLUMN device_token TEXT");
  }
  if (!columnNames.has("status")) {
    database.exec("ALTER TABLE devices ADD COLUMN status TEXT DEFAULT 'active'");
  }
  if (!columnNames.has("created_at")) {
    database.exec("ALTER TABLE devices ADD COLUMN created_at INTEGER DEFAULT 0");
  }
  if (!columnNames.has("storage_info")) {
    database.exec("ALTER TABLE devices ADD COLUMN storage_info TEXT");
  }
  if (!columnNames.has("client_ip")) {
    database.exec("ALTER TABLE devices ADD COLUMN client_ip TEXT");
  }
}

function ensureDriveItemColumns(database) {
  const columns = database.prepare("PRAGMA table_info('drive_items')").all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("storage_target")) {
    database.exec("ALTER TABLE drive_items ADD COLUMN storage_target TEXT DEFAULT 'pc'");
  }
}

function createSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      firebase_uid TEXT
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_name TEXT NOT NULL,
      last_seen INTEGER NOT NULL,
      device_token TEXT,
      status TEXT DEFAULT 'active',
      created_at INTEGER DEFAULT 0,
      storage_info TEXT,
      client_ip TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, device_name)
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      name TEXT,
      device_name TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, path)
    );

    CREATE TABLE IF NOT EXISTS drive_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_name TEXT NOT NULL,
      device_token TEXT,
      type TEXT NOT NULL, -- 'folder' | 'file'
      name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      parent_path TEXT NOT NULL DEFAULT '',
      size INTEGER DEFAULT 0,
      mime_type TEXT,
      storage_target TEXT DEFAULT 'pc',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_drive_items_user_parent ON drive_items(user_id, parent_path);
    CREATE INDEX IF NOT EXISTS idx_drive_items_user_path ON drive_items(user_id, relative_path);
  `);

  ensureUserColumns(database);
  ensureDeviceColumns(database);
  migrateFoldersTable(database);
  ensureFolderNameColumn(database);
  ensureDriveItemColumns(database);
}

export function getDb() {
  if (!databaseInstance) {
    createDirectoryForFile(DATABASE_PATH);
    databaseInstance = new Database(DATABASE_PATH);
    databaseInstance.pragma("journal_mode = WAL");
    createSchema(databaseInstance);
  }

  return databaseInstance;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function getUserById(id) {
  const db = getDb();
  return db.prepare("SELECT id, email, name, firebase_uid, storage_path FROM users WHERE id = ?").get(Number(id));
}

export function ensureUser(email, name = "", firebaseUid = "", explicitId = null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  const trimmedName = String(name || "").trim();
  const trimmedUid = String(firebaseUid || "").trim();

  const db = getDb();
  const existingUser = db.prepare("SELECT id, email, name, firebase_uid, storage_path FROM users WHERE email = ?").get(normalizedEmail);
  if (existingUser) {
    if ((trimmedName && existingUser.name !== trimmedName) || (trimmedUid && existingUser.firebase_uid !== trimmedUid)) {
      db.prepare(`
        UPDATE users
        SET name = COALESCE(NULLIF(?, ''), name),
            firebase_uid = COALESCE(NULLIF(?, ''), firebase_uid)
        WHERE id = ?
      `).run(trimmedName, trimmedUid, existingUser.id);
    }

    return {
      id: existingUser.id,
      email: normalizedEmail,
      name: trimmedName || existingUser.name || "",
      firebase_uid: trimmedUid || existingUser.firebase_uid || "",
      storage_path: existingUser.storage_path || "",
    };
  }

  if (explicitId && Number(explicitId) > 0) {
    db.prepare("INSERT OR REPLACE INTO users (id, email, name, firebase_uid) VALUES (?, ?, ?, ?)").run(
      Number(explicitId),
      normalizedEmail,
      trimmedName,
      trimmedUid,
    );
    return {
      id: Number(explicitId),
      email: normalizedEmail,
      name: trimmedName,
      firebase_uid: trimmedUid,
      storage_path: "",
    };
  }

  const insertResult = db.prepare("INSERT INTO users (email, name, firebase_uid) VALUES (?, ?, ?)").run(
    normalizedEmail,
    trimmedName,
    trimmedUid,
  );

  const newUserId = Number(insertResult.lastInsertRowid);

  return {
    id: newUserId,
    email: normalizedEmail,
    name: trimmedName,
    firebase_uid: trimmedUid,
    storage_path: "",
  };
}

export function ensureUserRow(userId, email = "", name = "") {
  const numericUserId = Number(userId);
  if (!numericUserId || isNaN(numericUserId)) return null;

  const db = getDb();
  const existing = db.prepare("SELECT id, email, name, firebase_uid, storage_path FROM users WHERE id = ?").get(numericUserId);
  if (existing) {
    if (email && existing.email !== normalizeEmail(email)) {
      db.prepare("UPDATE users SET email = ? WHERE id = ?").run(normalizeEmail(email), numericUserId);
      existing.email = normalizeEmail(email);
    }
    return existing;
  }

  const userEmail = normalizeEmail(email) || `user_${numericUserId}@local.cloud`;
  db.prepare("INSERT OR REPLACE INTO users (id, email, name) VALUES (?, ?, ?)").run(
    numericUserId,
    userEmail,
    name || "User",
  );

  return db.prepare("SELECT id, email, name, firebase_uid, storage_path FROM users WHERE id = ?").get(numericUserId);
}

export function setUserStoragePath(userId, chosenRootPath) {
  const db = getDb();
  ensureUserRow(userId);
  const user = getUserById(userId);
  if (!user) throw new Error("User not found.");

  const sanitizedEmail = sanitizeStorageName(user.email || `user_${userId}`);
  const folderName = `MyOwnCloud - ${sanitizedEmail}`;
  const fullStoragePath = path.join(chosenRootPath, folderName);

  fs.mkdirSync(fullStoragePath, { recursive: true });

  db.prepare("UPDATE users SET storage_path = ? WHERE id = ?").run(fullStoragePath, Number(userId));
  return fullStoragePath;
}

// User Physical Drive Directory on Host
export function getUserStorageDirectory(userId, userEmail = "") {
  const user = getUserById(userId);
  if (user && user.storage_path && fs.existsSync(user.storage_path)) {
    return user.storage_path;
  }

  const email = userEmail || user?.email || `user_${userId}`;
  const sanitizedEmail = sanitizeStorageName(email);
  const folderName = `MyOwnCloud - ${sanitizedEmail}`;

  let defaultDriveRoot = "";
  if (IS_VERCEL) {
    fs.mkdirSync(STORAGE_DIRECTORY, { recursive: true });
    defaultDriveRoot = STORAGE_DIRECTORY;
  } else {
    const drives = getAvailableDrives();
    if (drives.length > 0 && drives[0].root_path && drives[0].root_path !== "/") {
      defaultDriveRoot = drives[0].root_path;
    } else {
      defaultDriveRoot = process.platform === "win32" ? "C:\\" : STORAGE_DIRECTORY;
    }
  }

  const defaultPath = path.join(defaultDriveRoot, folderName);
  fs.mkdirSync(defaultPath, { recursive: true });

  if (user) {
    getDb().prepare("UPDATE users SET storage_path = ? WHERE id = ?").run(defaultPath, Number(userId));
  }

  return defaultPath;
}

export function getStorageDirectoryForTarget(userId, target = "pc", userEmail = "") {
  const user = getUserById(userId);
  const email = userEmail || user?.email || `user_${userId}`;
  const sanitizedEmail = sanitizeStorageName(email);
  const folderName = `MyOwnCloud - ${sanitizedEmail}`;
  const cleanTarget = String(target || "pc").trim();

  // If target is a drive letter (e.g. "C", "D", "E")
  if (/^[A-Za-z]$/.test(cleanTarget)) {
    const letter = cleanTarget.toUpperCase();
    const driveRoot = `${letter}:\\`;
    if (fs.existsSync(driveRoot)) {
      const diskPath = path.join(driveRoot, folderName);
      fs.mkdirSync(diskPath, { recursive: true });
      return diskPath;
    }
  }

  const baseDir = getUserStorageDirectory(userId, email);

  // If target is a client device storage (e.g. "Android", "Internal Storage", etc.)
  // The files live physically on the client device itself via OPFS.
  // Any server staging is kept strictly in data/device_sync without polluting PC drives.
  if (cleanTarget && cleanTarget !== "pc" && cleanTarget !== "all") {
    const safeTargetName = cleanTarget.replace(/[<>:"/\\|?*]/g, "_");
    const stagingDir = path.join(DATA_DIRECTORY, "device_sync", sanitizedEmail, safeTargetName);
    fs.mkdirSync(stagingDir, { recursive: true });
    return stagingDir;
  }

  return baseDir;
}

export function getItemPhysicalPath(userId, item) {
  if (!item) return null;
  const targetDir = getStorageDirectoryForTarget(userId, item.storage_target || "pc");
  const targetPath = path.join(targetDir, item.relative_path);
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }
  // Check if item was stored on device staging directory matching device_name
  if (item.device_name && item.device_name !== "Windows PC") {
    const devDir = getStorageDirectoryForTarget(userId, item.device_name);
    const devPath = path.join(devDir, item.relative_path);
    if (fs.existsSync(devPath)) {
      return devPath;
    }
  }
  // Fallback to base user directory
  const baseDir = getUserStorageDirectory(userId);
  const basePath = path.join(baseDir, item.relative_path);
  if (fs.existsSync(basePath)) {
    return basePath;
  }
  return targetPath;
}

// Device Management
export function findDeviceByToken(userId, deviceToken) {
  const trimmedToken = String(deviceToken || "").trim();
  if (!trimmedToken) {
    return null;
  }

  return getDb()
    .prepare("SELECT id, user_id, device_name, device_token, status, last_seen FROM devices WHERE user_id = ? AND device_token = ? LIMIT 1")
    .get(Number(userId), trimmedToken);
}

export function isDeviceRevoked(userId, deviceToken) {
  const trimmedToken = String(deviceToken || "").trim();
  if (!trimmedToken) {
    return false;
  }

  const row = getDb()
    .prepare("SELECT status FROM devices WHERE user_id = ? AND device_token = ? LIMIT 1")
    .get(Number(userId), trimmedToken);

  return row ? row.status === "removed" : false;
}

export function areIpsInSameNetwork(ip1, ip2) {
  if (!ip1 || !ip2) return true;
  const clean1 = String(ip1).replace(/^::ffff:/, "").trim();
  const clean2 = String(ip2).replace(/^::ffff:/, "").trim();

  // Same public IP or identical IP
  if (clean1 === clean2) return true;

  const isLoopback = (ip) =>
    ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || ip === "0.0.0.0";
  const isPrivateV4 = (ip) =>
    /^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(ip);

  // Both loopback
  if (isLoopback(clean1) && isLoopback(clean2)) {
    return true;
  }

  // Local dev server: one is localhost (the PC host) and the other is a LAN IP (phone/tablet on Wi-Fi)
  if ((isLoopback(clean1) && isPrivateV4(clean2)) || (isLoopback(clean2) && isPrivateV4(clean1))) {
    return true;
  }

  // Both are LAN IPs on local private subnets
  if (isPrivateV4(clean1) && isPrivateV4(clean2)) {
    return true;
  }

  return false;
}

export function upsertDevice(userId, deviceName, lastSeen, deviceToken = "", disks = null, clientIp = "", email = "", name = "") {
  const numericUserId = Number(userId);
  if (!numericUserId) {
    throw new Error("Valid user_id is required.");
  }
  ensureUserRow(numericUserId, email, name);

  const normalizedDeviceName = String(deviceName || "").trim() || "LAN Device";
  const normalizedToken = String(deviceToken || "").trim();
  const normalizedIp = String(clientIp || "").trim();
  const db = getDb();
  const now = Number(lastSeen) || Date.now();
  const storageInfoJson = disks ? JSON.stringify(disks) : null;

  if (normalizedToken) {
    const existingByToken = db
      .prepare("SELECT id, status FROM devices WHERE user_id = ? AND device_token = ? LIMIT 1")
      .get(Number(userId), normalizedToken);

    if (existingByToken) {
      if (existingByToken.status === "removed") {
        // Device is revoked! Do not update or revive it!
        return;
      }
      if (storageInfoJson) {
        db.prepare(
          "UPDATE devices SET device_name = ?, last_seen = ?, status = 'active', storage_info = ?, client_ip = COALESCE(NULLIF(?, ''), client_ip) WHERE id = ?"
        ).run(
          normalizedDeviceName,
          now,
          storageInfoJson,
          normalizedIp,
          existingByToken.id,
        );
      } else {
        db.prepare(
          "UPDATE devices SET device_name = ?, last_seen = ?, status = 'active', client_ip = COALESCE(NULLIF(?, ''), client_ip) WHERE id = ?"
        ).run(
          normalizedDeviceName,
          now,
          normalizedIp,
          existingByToken.id,
        );
      }
      return;
    }
  }

  // Check if device name was previously marked as removed
  const existingByName = db
    .prepare("SELECT id, status FROM devices WHERE user_id = ? AND device_name = ? LIMIT 1")
    .get(Number(userId), normalizedDeviceName);

  if (existingByName && existingByName.status === "removed") {
    return;
  }

  db.prepare(
    `
      INSERT INTO devices (user_id, device_name, last_seen, device_token, status, storage_info, client_ip, created_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(user_id, device_name) DO UPDATE SET
        last_seen = excluded.last_seen,
        device_token = COALESCE(excluded.device_token, devices.device_token),
        status = 'active',
        storage_info = COALESCE(excluded.storage_info, devices.storage_info),
        client_ip = COALESCE(excluded.client_ip, devices.client_ip)
      WHERE devices.status != 'removed'
    `,
  ).run(Number(userId), normalizedDeviceName, now, normalizedToken || null, storageInfoJson, normalizedIp || null, now);
}

export function listUserDevices(userId, currentToken = "") {
  const now = Date.now();
  const rows = getDb()
    .prepare(
      `
        SELECT
          d.id,
          d.user_id,
          d.device_name,
          d.last_seen,
          d.device_token,
          d.status,
          d.storage_info,
          d.client_ip,
          d.created_at,
          (
            SELECT COUNT(*) FROM drive_items
            WHERE user_id = d.user_id AND device_token = d.device_token AND type = 'file'
          ) as files_count
        FROM devices d
        WHERE d.user_id = ? AND d.status != 'removed'
        ORDER BY d.last_seen DESC
      `,
    )
    .all(Number(userId));

  return rows.map((row) => {
    let disks = null;
    if (row.storage_info) {
      try {
        disks = JSON.parse(row.storage_info);
      } catch {
        disks = null;
      }
    }
    return {
      ...row,
      client_ip: row.client_ip || "",
      disks,
      is_current: Boolean(currentToken && row.device_token === currentToken),
      is_online: now - Number(row.last_seen) <= 60_000,
    };
  });
}

export function getUserNetworkStatus(userId) {
  const devices = listUserDevices(userId);
  const onlineDevices = devices.filter((d) => d.is_online);

  // In local dev server (!IS_VERCEL), identify non-host client devices
  const clientDevices = [];
  let hasHostDevice = false;

  for (const d of onlineDevices) {
    const lowerName = (d.device_name || "").toLowerCase();
    const isHost =
      !IS_VERCEL &&
      (d.client_ip === "127.0.0.1" ||
        d.client_ip === "::1" ||
        !d.client_ip ||
        lowerName === "windows pc" ||
        lowerName.startsWith("windows pc") ||
        lowerName.startsWith("host pc") ||
        lowerName === "lan device");
    if (isHost) {
      hasHostDevice = true;
    } else {
      clientDevices.push(d);
    }
  }

  // On local server (!IS_VERCEL), the host PC counts as 1 device, plus any connected client devices
  const activeCount = !IS_VERCEL ? 1 + clientDevices.length : onlineDevices.length;

  if (activeCount < 2) {
    return {
      active_count: activeCount,
      same_network: true,
      network_mismatch: false,
      message: null,
      online_devices: onlineDevices.map((d) => ({ id: d.id, name: d.device_name, ip: d.client_ip })),
    };
  }

  // Check network mismatch across active devices
  const ipsToCheck = clientDevices.map((d) => d.client_ip).filter(Boolean);
  if (!IS_VERCEL) {
    ipsToCheck.push("127.0.0.1");
  }

  let mismatch = false;
  if (ipsToCheck.length >= 2) {
    const firstIp = ipsToCheck[0];
    for (let i = 1; i < ipsToCheck.length; i++) {
      if (!areIpsInSameNetwork(firstIp, ipsToCheck[i])) {
        mismatch = true;
        break;
      }
    }
  }

  return {
    active_count: activeCount,
    same_network: !mismatch,
    network_mismatch: mismatch,
    message: mismatch
      ? "Your devices are logged in on different networks. Please connect all devices to the same Wi-Fi network to transfer files directly."
      : null,
    online_devices: onlineDevices.map((d) => ({ id: d.id, name: d.device_name, ip: d.client_ip })),
  };
}

export function removeUserDevice(userId, deviceId) {
  const db = getDb();
  const targetDevice = db
    .prepare("SELECT id, device_name, device_token FROM devices WHERE id = ? AND user_id = ?")
    .get(Number(deviceId), Number(userId));

  if (!targetDevice) {
    throw new Error("Device not found.");
  }

  // Mark as removed
  db.prepare("UPDATE devices SET status = 'removed' WHERE id = ? AND user_id = ?").run(
    Number(deviceId),
    Number(userId),
  );

  return targetDevice;
}

// Drive Items (Files & Folders)
export function listDriveItems(userId, parentPath = "", storageTarget = "") {
  const db = getDb();
  const normalizedParent = String(parentPath || "").trim();

  // Exclude items whose device has been removed by the user
  let query = `
    SELECT * FROM drive_items
    WHERE user_id = ?
      AND parent_path = ?
      AND (
        device_token IS NULL
        OR device_token = ''
        OR device_token NOT IN (
          SELECT device_token FROM devices
          WHERE user_id = ? AND status = 'removed' AND device_token IS NOT NULL
        )
      )
  `;

  const params = [Number(userId), normalizedParent, Number(userId)];

  if (storageTarget && storageTarget !== "all") {
    const user = getUserById(userId);
    const primaryDriveMatch = user?.storage_path ? user.storage_path.match(/^([A-Za-z]):/i) : null;
    const primaryDriveLetter = primaryDriveMatch ? primaryDriveMatch[1].toUpperCase() : "";

    if (/^[A-Za-z]$/.test(storageTarget)) {
      const targetLetter = storageTarget.toUpperCase();
      if (targetLetter === primaryDriveLetter) {
        query += " AND (storage_target = ? OR storage_target = 'pc' OR storage_target IS NULL)";
        params.push(targetLetter);
      } else {
        query += " AND storage_target = ?";
        params.push(targetLetter);
      }
    } else if (storageTarget === "pc") {
      query += " AND (storage_target = 'pc' OR storage_target = ? OR storage_target IS NULL)";
      params.push(primaryDriveLetter || "pc");
    } else if (storageTarget.includes(":")) {
      const parts = storageTarget.split(":");
      const devName = parts[0].trim();
      const diskPart = parts.slice(1).join(":").trim();
      query += " AND ((device_name = ? AND storage_target = ?) OR storage_target = ? OR (device_name = ? AND storage_target = 'Internal Storage') OR (device_name = ? AND (storage_target = 'pc' OR storage_target IS NULL)))";
      params.push(devName, diskPart, storageTarget, devName, devName);
    } else {
      query += " AND (storage_target = ? OR device_name = ? OR (storage_target = 'phone' AND LOWER(?) LIKE '%android%') OR (LOWER(storage_target) = LOWER(?)) OR (device_name = ? AND (storage_target = 'pc' OR storage_target IS NULL)))";
      params.push(storageTarget, storageTarget, storageTarget, storageTarget, storageTarget);
    }
  }

  query += " ORDER BY type DESC, name COLLATE NOCASE ASC";

  return db.prepare(query).all(...params);
}

export function getAllDriveFolders(userId, storageTarget = "") {
  const db = getDb();
  let query = `
    SELECT id, name, relative_path, parent_path, storage_target FROM drive_items
    WHERE user_id = ?
      AND type = 'folder'
      AND (
        device_token IS NULL
        OR device_token = ''
        OR device_token NOT IN (
          SELECT device_token FROM devices
          WHERE user_id = ? AND status = 'removed' AND device_token IS NOT NULL
        )
      )
  `;
  const params = [Number(userId), Number(userId)];

  if (storageTarget && storageTarget !== "all") {
    if (/^[A-Za-z]$/.test(storageTarget)) {
      query += " AND (storage_target = ? OR storage_target = 'pc' OR storage_target IS NULL)";
      params.push(storageTarget.toUpperCase());
    } else if (storageTarget.includes(":")) {
      const parts = storageTarget.split(":");
      const devName = parts[0].trim();
      const diskPart = parts.slice(1).join(":").trim();
      query += " AND (storage_target = ? OR (device_name = ? AND storage_target = ?) OR storage_target = ?)";
      params.push(storageTarget, devName, diskPart, diskPart);
    } else {
      query += " AND (storage_target = ? OR LOWER(storage_target) = LOWER(?))";
      params.push(storageTarget, storageTarget);
    }
  }

  query += " ORDER BY relative_path COLLATE NOCASE ASC";
  return db.prepare(query).all(...params);
}

export function getDriveItemById(userId, itemId) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM drive_items WHERE id = ? AND user_id = ?")
    .get(Number(itemId), Number(userId));
}

export function createDriveFolder(userId, name, parentPath = "", deviceName = "LAN Device", deviceToken = "", storageTarget = "pc") {
  ensureUserRow(userId);
  const cleanName = String(name || "").trim().replace(/[<>:"/\\|?*]/g, "_");
  if (!cleanName) {
    throw new Error("Folder name is required.");
  }

  const cleanParent = String(parentPath || "").trim();
  const relativePath = cleanParent ? `${cleanParent}/${cleanName}` : cleanName;

  const userRoot = getUserStorageDirectory(userId);
  const fullDirPath = path.join(userRoot, relativePath);
  fs.mkdirSync(fullDirPath, { recursive: true });

  const db = getDb();
  const now = Date.now();

  const existing = db
    .prepare("SELECT * FROM drive_items WHERE user_id = ? AND relative_path = ?")
    .get(Number(userId), relativePath);

  if (existing) {
    return existing;
  }

  const result = db.prepare(`
    INSERT INTO drive_items (user_id, device_name, device_token, type, name, relative_path, parent_path, size, mime_type, storage_target, created_at, updated_at)
    VALUES (?, ?, ?, 'folder', ?, ?, ?, 0, 'directory', ?, ?, ?)
  `).run(Number(userId), deviceName, deviceToken, cleanName, relativePath, cleanParent, storageTarget || "pc", now, now);

  return {
    id: Number(result.lastInsertRowid),
    user_id: Number(userId),
    device_name: deviceName,
    device_token: deviceToken,
    type: "folder",
    name: cleanName,
    relative_path: relativePath,
    parent_path: cleanParent,
    size: 0,
    mime_type: "directory",
    storage_target: storageTarget || "pc",
    created_at: now,
    updated_at: now,
  };
}

export function saveDriveFile(userId, name, parentPath = "", size = 0, mimeType = "", deviceName = "LAN Device", deviceToken = "", storageTarget = "pc") {
  ensureUserRow(userId);
  const cleanName = String(name || "").trim().replace(/[<>:"/\\|?*]/g, "_");
  if (!cleanName) {
    throw new Error("File name is required.");
  }

  const cleanParent = String(parentPath || "").trim();
  const relativePath = cleanParent ? `${cleanParent}/${cleanName}` : cleanName;
  const db = getDb();
  const now = Date.now();

  const existing = db
    .prepare("SELECT id FROM drive_items WHERE user_id = ? AND relative_path = ?")
    .get(Number(userId), relativePath);

  if (existing) {
    db.prepare(`
      UPDATE drive_items
      SET size = ?, mime_type = ?, device_name = ?, device_token = ?, storage_target = ?, updated_at = ?
      WHERE id = ?
    `).run(Number(size), mimeType || "application/octet-stream", deviceName, deviceToken, storageTarget || "pc", now, existing.id);

    return getDriveItemById(userId, existing.id);
  }

  const result = db.prepare(`
    INSERT INTO drive_items (user_id, device_name, device_token, type, name, relative_path, parent_path, size, mime_type, storage_target, created_at, updated_at)
    VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Number(userId), deviceName, deviceToken, cleanName, relativePath, cleanParent, Number(size), mimeType || "application/octet-stream", storageTarget || "pc", now, now);

  return getDriveItemById(userId, Number(result.lastInsertRowid));
}

export function moveDriveItem(userId, itemId, newParentPath, newStorageTarget = "") {
  const item = getDriveItemById(userId, itemId);
  if (!item) {
    throw new Error("Item not found.");
  }

  const cleanNewParent = String(newParentPath || "").trim();
  const currentTarget = item.storage_target || "pc";
  const finalStorageTarget = newStorageTarget ? String(newStorageTarget).trim() : currentTarget;
  const newRelativePath = cleanNewParent ? `${cleanNewParent}/${item.name}` : item.name;

  if (item.relative_path === newRelativePath && currentTarget === finalStorageTarget) {
    return item; // Same location, nothing to move
  }

  const oldFullPath = getItemPhysicalPath(userId, item);
  const targetDir = getStorageDirectoryForTarget(userId, finalStorageTarget);
  const newFullPath = path.join(targetDir, newRelativePath);

  // Ensure target parent directory exists on physical disk
  const newParentFullPath = cleanNewParent ? path.join(targetDir, cleanNewParent) : targetDir;
  fs.mkdirSync(newParentFullPath, { recursive: true });

  if (oldFullPath && fs.existsSync(oldFullPath) && oldFullPath !== newFullPath) {
    try {
      fs.renameSync(oldFullPath, newFullPath);
    } catch (err) {
      if (err.code === "EXDEV" || err.code === "EPERM") {
        if (item.type === "folder") {
          fs.cpSync(oldFullPath, newFullPath, { recursive: true });
          fs.rmSync(oldFullPath, { recursive: true, force: true });
        } else {
          fs.copyFileSync(oldFullPath, newFullPath);
          fs.unlinkSync(oldFullPath);
        }
      } else {
        throw err;
      }
    }
  }

  const db = getDb();
  const now = Date.now();

  db.prepare(`
    UPDATE drive_items
    SET storage_target = ?, parent_path = ?, relative_path = ?, updated_at = ?
    WHERE id = ?
  `).run(finalStorageTarget, cleanNewParent, newRelativePath, now, item.id);

  // If moving a folder, update all child relative_path, parent_path, and storage_target values
  if (item.type === "folder") {
    const oldPrefix = item.relative_path + "/";
    const newPrefix = newRelativePath + "/";

    const descendants = db
      .prepare("SELECT id, relative_path, parent_path FROM drive_items WHERE user_id = ? AND relative_path LIKE ?")
      .all(Number(userId), `${item.relative_path}/%`);

    const updateDescendant = db.prepare(`
      UPDATE drive_items
      SET storage_target = ?, relative_path = ?, parent_path = ?
      WHERE id = ?
    `);
    for (const d of descendants) {
      const updatedRel = newPrefix + d.relative_path.slice(oldPrefix.length);
      const updatedParent = path.dirname(updatedRel) === "." ? "" : path.dirname(updatedRel).replace(/\\/g, "/");
      updateDescendant.run(finalStorageTarget, updatedRel, updatedParent, d.id);
    }
  }

  return getDriveItemById(userId, itemId);
}

export function renameDriveItem(userId, itemId, newName) {
  const item = getDriveItemById(userId, itemId);
  if (!item) {
    throw new Error("Item not found.");
  }

  const cleanNewName = String(newName || "").trim().replace(/[<>:"/\\|?*]/g, "_");
  if (!cleanNewName) {
    throw new Error("Name cannot be empty.");
  }

  if (item.name === cleanNewName) {
    return item;
  }

  const newRelativePath = item.parent_path ? `${item.parent_path}/${cleanNewName}` : cleanNewName;
  const oldFullPath = getItemPhysicalPath(userId, item);
  const targetDir = getStorageDirectoryForTarget(userId, item.storage_target || "pc");
  const newFullPath = path.join(targetDir, newRelativePath);

  if (oldFullPath && fs.existsSync(oldFullPath)) {
    fs.renameSync(oldFullPath, newFullPath);
  }

  const db = getDb();
  const now = Date.now();

  db.prepare(`
    UPDATE drive_items
    SET name = ?, relative_path = ?, updated_at = ?
    WHERE id = ?
  `).run(cleanNewName, newRelativePath, now, item.id);

  // If renaming a folder, update descendant paths
  if (item.type === "folder") {
    const oldPrefix = item.relative_path + "/";
    const newPrefix = newRelativePath + "/";

    const descendants = db
      .prepare("SELECT id, relative_path, parent_path FROM drive_items WHERE user_id = ? AND relative_path LIKE ?")
      .all(Number(userId), `${item.relative_path}/%`);

    const updateDescendant = db.prepare("UPDATE drive_items SET relative_path = ?, parent_path = ? WHERE id = ?");
    for (const d of descendants) {
      const updatedRel = newPrefix + d.relative_path.slice(oldPrefix.length);
      const updatedParent = path.dirname(updatedRel) === "." ? "" : path.dirname(updatedRel).replace(/\\/g, "/");
      updateDescendant.run(updatedRel, updatedParent, d.id);
    }
  }

  return getDriveItemById(userId, itemId);
}

export function deleteDriveItem(userId, itemId) {
  const item = getDriveItemById(userId, itemId);
  if (!item) {
    return null;
  }

  const fullPath = getItemPhysicalPath(userId, item);

  // Delete from physical disk
  if (fullPath && fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }

  const db = getDb();
  if (item.type === "folder") {
    db.prepare("DELETE FROM drive_items WHERE user_id = ? AND (id = ? OR relative_path LIKE ?)").run(
      Number(userId),
      item.id,
      `${item.relative_path}/%`,
    );
  } else {
    db.prepare("DELETE FROM drive_items WHERE id = ? AND user_id = ?").run(item.id, Number(userId));
  }

  return item;
}

export function getItemsWithDescendants(userId, itemIds = []) {
  const db = getDb();
  const validIds = (Array.isArray(itemIds) ? itemIds : [itemIds])
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
  if (validIds.length === 0) return { selectedItems: [], folders: [], files: [] };

  const placeholders = validIds.map(() => "?").join(",");
  const selectedItems = db
    .prepare(`SELECT * FROM drive_items WHERE user_id = ? AND id IN (${placeholders})`)
    .all(Number(userId), ...validIds);

  const allFiles = [];
  const folders = [];

  for (const item of selectedItems) {
    if (item.type === "file") {
      allFiles.push({
        ...item,
        archive_path: item.name,
      });
    } else if (item.type === "folder") {
      folders.push(item);
      const descendants = db
        .prepare(`
          SELECT * FROM drive_items
          WHERE user_id = ? AND type = 'file' AND relative_path LIKE ?
        `)
        .all(Number(userId), `${item.relative_path}/%`);

      for (const d of descendants) {
        const sub = d.relative_path.slice(item.relative_path.length + 1);
        allFiles.push({
          ...d,
          archive_path: `${item.name}/${sub}`,
        });
      }
    }
  }

  // Deduplicate files by id
  const seen = new Set();
  const uniqueFiles = [];
  for (const file of allFiles) {
    if (!seen.has(file.id)) {
      seen.add(file.id);
      uniqueFiles.push(file);
    }
  }

  return { selectedItems, folders, files: uniqueFiles };
}

export function batchDeleteDriveItems(userId, itemIds = []) {
  const validIds = (Array.isArray(itemIds) ? itemIds : [itemIds])
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);

  const deleted = [];
  for (const id of validIds) {
    const item = deleteDriveItem(userId, id);
    if (item) deleted.push(item);
  }
  return deleted;
}

export function getUserDriveStats(userId, storageTarget = "") {
  const db = getDb();
  let query = `
    SELECT
      COUNT(CASE WHEN type = 'file' THEN 1 END) as total_files,
      COUNT(CASE WHEN type = 'folder' THEN 1 END) as total_folders,
      COALESCE(SUM(CASE WHEN type = 'file' THEN size ELSE 0 END), 0) as total_bytes
    FROM drive_items
    WHERE user_id = ?
      AND (
        device_token IS NULL
        OR device_token = ''
        OR device_token NOT IN (
          SELECT device_token FROM devices
          WHERE user_id = ? AND status = 'removed' AND device_token IS NOT NULL
        )
      )
  `;

  const params = [Number(userId), Number(userId)];

  if (storageTarget && storageTarget !== "all") {
    const user = getUserById(userId);
    const primaryDriveMatch = user?.storage_path ? user.storage_path.match(/^([A-Za-z]):/i) : null;
    const primaryDriveLetter = primaryDriveMatch ? primaryDriveMatch[1].toUpperCase() : "";

    if (/^[A-Za-z]$/.test(storageTarget)) {
      const targetLetter = storageTarget.toUpperCase();
      if (targetLetter === primaryDriveLetter) {
        query += " AND (storage_target = ? OR storage_target = 'pc' OR storage_target IS NULL)";
        params.push(targetLetter);
      } else {
        query += " AND storage_target = ?";
        params.push(targetLetter);
      }
    } else if (storageTarget === "pc") {
      query += " AND (storage_target = 'pc' OR storage_target = ? OR storage_target IS NULL)";
      params.push(primaryDriveLetter || "pc");
    } else if (storageTarget.includes(":")) {
      const parts = storageTarget.split(":");
      const devName = parts[0].trim();
      const diskPart = parts.slice(1).join(":").trim();
      query += " AND ((device_name = ? AND storage_target = ?) OR storage_target = ? OR (device_name = ? AND storage_target = 'Internal Storage') OR (device_name = ? AND (storage_target = 'pc' OR storage_target IS NULL)))";
      params.push(devName, diskPart, storageTarget, devName, devName);
    } else {
      query += " AND (storage_target = ? OR device_name = ? OR (storage_target = 'phone' AND LOWER(?) LIKE '%android%') OR (LOWER(storage_target) = LOWER(?)) OR (device_name = ? AND (storage_target = 'pc' OR storage_target IS NULL)))";
      params.push(storageTarget, storageTarget, storageTarget, storageTarget, storageTarget);
    }
  }

  const row = db.prepare(query).get(...params);
  return {
    total_files: Number(row?.total_files || 0),
    total_folders: Number(row?.total_folders || 0),
    total_bytes: Number(row?.total_bytes || 0),
  };
}

// Backward compatibility for legacy folders API
export function createFolder(userId, folderPath, deviceName, folderName) {
  ensureUserRow(userId);
  const normalizedPath = String(folderPath || "").trim();
  const normalizedDeviceName = String(deviceName || "").trim() || "LAN Device";
  const normalizedFolderName = String(folderName || "").trim() || path.basename(normalizedPath) || normalizedPath;

  if (!normalizedPath) {
    throw new Error("Folder path is required.");
  }

  const db = getDb();
  const result = db.prepare(
    `
      INSERT INTO folders (user_id, path, device_name, name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, path) DO UPDATE SET
        device_name = excluded.device_name,
        name = excluded.name
    `,
  ).run(Number(userId), normalizedPath, normalizedDeviceName, normalizedFolderName);

  if (!result.lastInsertRowid) {
    return db.prepare("SELECT id, user_id, path, name, device_name FROM folders WHERE user_id = ? AND path = ?").get(Number(userId), normalizedPath);
  }

  return {
    id: Number(result.lastInsertRowid),
    user_id: Number(userId),
    path: normalizedPath,
    name: normalizedFolderName,
    device_name: normalizedDeviceName,
  };
}

export function listFoldersByUserId(userId) {
  return getDb().prepare(
    `
      SELECT id, user_id, path, device_name, COALESCE(NULLIF(name, ''), path) AS name
      FROM folders
      WHERE user_id = ?
      ORDER BY id DESC
    `,
  ).all(Number(userId));
}

export function getFolderById(folderId) {
  return getDb().prepare(
    `
      SELECT id, user_id, path, device_name, COALESCE(NULLIF(name, ''), path) AS name
      FROM folders
      WHERE id = ?
      LIMIT 1
    `,
  ).get(Number(folderId));
}

export function removeFolder(folderId) {
  const db = getDb();
  const folder = getFolderById(folderId);
  if (!folder) {
    return null;
  }
  db.prepare("DELETE FROM folders WHERE id = ?").run(Number(folderId));
  return folder;
}

export function listDevices() {
  const now = Date.now();
  const rows = getDb().prepare(
    `
      SELECT
        devices.id,
        devices.user_id,
        devices.device_name,
        devices.last_seen,
        devices.status,
        users.email,
        users.name,
        COALESCE(NULLIF(users.name, ''), users.email) AS display_name
      FROM devices
      INNER JOIN users ON users.id = devices.user_id
      WHERE devices.status != 'removed'
      ORDER BY devices.last_seen DESC, devices.device_name ASC
    `,
  ).all();

  return rows.map((row) => ({
    ...row,
    status: now - Number(row.last_seen) <= 15_000 ? "online" : "offline",
  }));
}

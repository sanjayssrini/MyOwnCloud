import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATABASE_PATH } from "./config.js";

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

function createSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_name TEXT NOT NULL,
      last_seen INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, device_name)
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      device_name TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, path)
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      otp_token TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  migrateFoldersTable(database);
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

export function ensureUser(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  const db = getDb();
  const existingUser = db.prepare("SELECT id, email FROM users WHERE email = ?").get(normalizedEmail);
  if (existingUser) {
    return existingUser;
  }

  const insertResult = db.prepare("INSERT INTO users (email) VALUES (?)").run(normalizedEmail);
  return { id: Number(insertResult.lastInsertRowid), email: normalizedEmail };
}

export function createOtpCode(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  const otpCode = String(Math.floor(100000 + Math.random() * 900000));
  const otpToken = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  const db = getDb();
  db.prepare("DELETE FROM otp_codes WHERE email = ?").run(normalizedEmail);
  db.prepare(
    `
      INSERT INTO otp_codes (email, otp_token, otp_code, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(normalizedEmail, otpToken, otpCode, expiresAt, Date.now());

  return {
    otpCode,
    otpToken,
    expiresAt,
  };
}

export function verifyOtpCode(email, otpToken, otpCode) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedOtp = String(otpCode || "").trim();
  const normalizedToken = String(otpToken || "").trim();

  if (!normalizedEmail || !normalizedOtp || !normalizedToken) {
    throw new Error("Email, OTP and token are required.");
  }

  const db = getDb();
  const row = db.prepare(
    `
      SELECT id, expires_at
      FROM otp_codes
      WHERE email = ?
        AND otp_token = ?
        AND otp_code = ?
      LIMIT 1
    `,
  ).get(normalizedEmail, normalizedToken, normalizedOtp);

  if (!row) {
    throw new Error("Invalid OTP.");
  }

  if (Number(row.expires_at) < Date.now()) {
    db.prepare("DELETE FROM otp_codes WHERE email = ?").run(normalizedEmail);
    throw new Error("OTP expired. Request a new one.");
  }

  db.prepare("DELETE FROM otp_codes WHERE email = ?").run(normalizedEmail);
  return true;
}

export function createFolder(userId, folderPath, deviceName) {
  const normalizedPath = String(folderPath || "").trim();
  const normalizedDeviceName = String(deviceName || "").trim() || "LAN Device";

  if (!normalizedPath) {
    throw new Error("Folder path is required.");
  }

  const db = getDb();
  const result = db.prepare(
    `
      INSERT INTO folders (user_id, path, device_name)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, path) DO UPDATE SET
        device_name = excluded.device_name
    `,
  ).run(Number(userId), normalizedPath, normalizedDeviceName);

  if (!result.lastInsertRowid) {
    return db.prepare("SELECT id, user_id, path, device_name FROM folders WHERE user_id = ? AND path = ?").get(Number(userId), normalizedPath);
  }

  return {
    id: Number(result.lastInsertRowid),
    user_id: Number(userId),
    path: normalizedPath,
    device_name: normalizedDeviceName,
  };
}

export function listFoldersByUserId(userId) {
  return getDb().prepare(
    `
      SELECT id, user_id, path, device_name
      FROM folders
      WHERE user_id = ?
      ORDER BY id DESC
    `,
  ).all(Number(userId));
}

export function getFolderById(folderId) {
  return getDb().prepare(
    `
      SELECT id, user_id, path, device_name
      FROM folders
      WHERE id = ?
      LIMIT 1
    `,
  ).get(Number(folderId));
}

export function upsertDevice(userId, deviceName, lastSeen) {
  const normalizedDeviceName = String(deviceName || "").trim() || "LAN Device";

  const db = getDb();
  db.prepare(
    `
      INSERT INTO devices (user_id, device_name, last_seen)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, device_name) DO UPDATE SET
        last_seen = excluded.last_seen
    `,
  ).run(Number(userId), normalizedDeviceName, Number(lastSeen));
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
        users.email
      FROM devices
      INNER JOIN users ON users.id = devices.user_id
      ORDER BY devices.last_seen DESC, devices.device_name ASC
    `,
  ).all();

  return rows.map((row) => ({
    ...row,
    status: now - Number(row.last_seen) <= 10_000 ? "online" : "offline",
  }));
}

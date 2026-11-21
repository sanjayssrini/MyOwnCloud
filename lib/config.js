import path from "node:path";

export const IS_VERCEL = Boolean(process.env.VERCEL);

const defaultDataDirectory = IS_VERCEL ? "/tmp/myowncloud" : path.resolve(process.cwd(), "data");

export const DATA_DIRECTORY = process.env.MYOWNCLOUD_DATA_DIR || defaultDataDirectory;
export const FOLDER_STORAGE_DIRECTORY = path.join(DATA_DIRECTORY, "folders");
export const STORAGE_DIRECTORY = path.join(DATA_DIRECTORY, "storage");
export const DATABASE_PATH = path.join(DATA_DIRECTORY, "myowncloud.sqlite");

export function sanitizeStorageName(input) {
  return String(input || "")
    .trim()
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

export function getUserDriveRoot(userId, email = "") {
  const safeEmail = sanitizeStorageName(email || `user_${userId}`);
  // Folder on device: e.g. "MyOwnCloud - alex@example.com"
  const folderName = `MyOwnCloud - ${safeEmail}`;
  return path.join(STORAGE_DIRECTORY, folderName);
}

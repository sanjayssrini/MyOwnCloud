import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STORAGE_DIRECTORY } from "./config.js";

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function getAvailableDrives() {
  const drives = [];
  const platform = os.platform();

  if (process.env.VERCEL) {
    try {
      fs.mkdirSync(STORAGE_DIRECTORY, { recursive: true });
    } catch {}
    return [
      {
        id: "C",
        name: "Local Disk (C:)",
        root_path: STORAGE_DIRECTORY,
        free: "Host Disk",
        total: "Available",
        free_bytes: 500 * 1024 * 1024 * 1024,
        total_bytes: 500 * 1024 * 1024 * 1024,
      },
    ];
  }

  if (platform === "win32") {
    // Windows drives C through Z
    const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    for (const letter of letters) {
      const rootPath = `${letter}:\\`;
      try {
        if (fs.existsSync(rootPath)) {
          let freeStr = "";
          let totalStr = "";
          let freeBytes = 0;
          let totalBytes = 0;

          if (typeof fs.statfsSync === "function") {
            try {
              const stats = fs.statfsSync(rootPath);
              totalBytes = Number(stats.bsize) * Number(stats.blocks);
              freeBytes = Number(stats.bsize) * Number(stats.bfree);
              freeStr = formatBytes(freeBytes);
              totalStr = formatBytes(totalBytes);
            } catch {
              // Ignore stats failure
            }
          }

          drives.push({
            id: letter,
            name: `Local Disk (${letter}:)`,
            root_path: rootPath,
            free: freeStr,
            total: totalStr,
            free_bytes: freeBytes,
            total_bytes: totalBytes,
          });
        }
      } catch {
        // Drive unreadable or not mounted
      }
    }
  } else {
    // Linux / Android / macOS storage locations
    const candidates = [
      { id: "internal", name: "Internal Storage", path: "/storage/emulated/0" },
      { id: "sdcard", name: "SD Card", path: "/sdcard" },
      { id: "home", name: "User Home Directory", path: os.homedir() },
      { id: "data", name: "Storage Directory", path: STORAGE_DIRECTORY },
    ];

    for (const cand of candidates) {
      try {
        if (fs.existsSync(cand.path)) {
          let freeStr = "";
          let totalStr = "";
          let freeBytes = 0;
          let totalBytes = 0;

          if (typeof fs.statfsSync === "function") {
            try {
              const stats = fs.statfsSync(cand.path);
              totalBytes = Number(stats.bsize) * Number(stats.blocks);
              freeBytes = Number(stats.bsize) * Number(stats.bfree);
              freeStr = formatBytes(freeBytes);
              totalStr = formatBytes(totalBytes);
            } catch {
              // Ignore
            }
          }

          drives.push({
            id: cand.id,
            name: cand.name,
            root_path: cand.path,
            free: freeStr,
            total: totalStr,
            free_bytes: freeBytes,
            total_bytes: totalBytes,
          });
        }
      } catch {
        // Ignore
      }
    }
  }

  return drives;
}

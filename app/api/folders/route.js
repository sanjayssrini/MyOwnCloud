import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { createFolder, listFoldersByUserId } from "../../../lib/db.js";
import { FOLDER_STORAGE_DIRECTORY } from "../../../lib/config.js";
import { encodeStoredFolderFileName } from "../../../lib/folder-files.js";

export const runtime = "nodejs";

function normalizeDeviceName(deviceName) {
  const trimmedDeviceName = String(deviceName || "").trim();
  return trimmedDeviceName || "LAN Device";
}

function normalizeFolderName(folderName, fallbackName) {
  const trimmedFolderName = String(folderName || "").trim();
  return trimmedFolderName || String(fallbackName || "").trim() || "Imported folder";
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = Number(searchParams.get("user_id"));

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    const folders = listFoldersByUserId(userId).map((folder) => ({
      ...folder,
      name: String(folder.name || "").trim() || path.basename(folder.path) || folder.path,
    }));

    return NextResponse.json({ folders });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load folders.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const userId = Number(formData.get("user_id"));
      const deviceName = normalizeDeviceName(formData.get("device_name"));
      const folderName = normalizeFolderName(formData.get("folder_name"));
      const files = formData.getAll("files");
      const relativePaths = formData.getAll("paths").map((value) => String(value || ""));

      if (!userId) {
        return NextResponse.json({ error: "user_id is required." }, { status: 400 });
      }

      if (files.length === 0) {
        return NextResponse.json({ error: "Please choose at least one file or folder." }, { status: 400 });
      }

      await fs.mkdir(FOLDER_STORAGE_DIRECTORY, { recursive: true });
      const folderStoragePath = path.join(FOLDER_STORAGE_DIRECTORY, crypto.randomUUID());
      await fs.mkdir(folderStoragePath, { recursive: true });

      const folder = createFolder(userId, folderStoragePath, deviceName, folderName);

      await Promise.all(
        files.map(async (file, index) => {
          if (!file || typeof file.arrayBuffer !== "function") {
            return;
          }

          const relativePath = String(relativePaths[index] || file.name || "").trim();
          if (!relativePath) {
            return;
          }

          const storedName = encodeStoredFolderFileName(relativePath);
          const storedPath = path.join(folderStoragePath, storedName);
          const fileBuffer = Buffer.from(await file.arrayBuffer());
          await fs.writeFile(storedPath, fileBuffer);
        }),
      );

      return NextResponse.json({
        folder: {
          ...folder,
          name: String(folder.name || "").trim() || folderName,
        },
      });
    }

    const body = await request.json();
    const userId = Number(body?.user_id);
    const folderPath = String(body?.path || "").trim();
    const deviceName = normalizeDeviceName(body?.device_name);
    const folderName = normalizeFolderName(body?.folder_name, path.basename(folderPath) || folderPath);

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    if (!folderPath) {
      return NextResponse.json({ error: "path is required." }, { status: 400 });
    }

    if (!path.isAbsolute(folderPath)) {
      return NextResponse.json({ error: "Folder path must be absolute." }, { status: 400 });
    }

    const stats = await fs.stat(folderPath);
    if (!stats.isDirectory()) {
      return NextResponse.json({ error: "Path must point to a folder." }, { status: 400 });
    }

    const folder = createFolder(userId, folderPath, deviceName, folderName);
    return NextResponse.json({
      folder: {
        ...folder,
        name: String(folder.name || "").trim() || path.basename(folder.path) || folder.path,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to add folder.",
      },
      { status: 400 },
    );
  }
}

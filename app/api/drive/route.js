import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import {
  batchDeleteDriveItems,
  createDriveFolder,
  deleteDriveItem,
  getAllDriveFolders,
  getDriveItemById,
  getItemsWithDescendants,
  getStorageDirectoryForTarget,
  getUserDriveStats,
  getUserStorageDirectory,
  isDeviceRevoked,
  listDriveItems,
  moveDriveItem,
  renameDriveItem,
  saveDriveFile,
} from "../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = Number(searchParams.get("user_id"));
    const parentPath = String(searchParams.get("parent_path") || "").trim();
    const deviceToken = String(searchParams.get("device_token") || "").trim();
    const storageTarget = String(searchParams.get("storage_target") || "").trim();

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    if (deviceToken && isDeviceRevoked(userId, deviceToken)) {
      return NextResponse.json(
        { revoked: true, error: "This device has been removed from your account." },
        { status: 401 },
      );
    }

    // Ensure physical drive folder exists on device
    getUserStorageDirectory(userId);

    const items = listDriveItems(userId, parentPath, storageTarget);
    const stats = getUserDriveStats(userId, storageTarget);

    return NextResponse.json({
      items,
      stats,
      parent_path: parentPath,
      storage_target: storageTarget,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load drive items." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // File or Folder Upload (Multipart Form Data)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const userId = Number(formData.get("user_id"));
      const deviceName = String(formData.get("device_name") || "LAN Device").trim();
      const deviceToken = String(formData.get("device_token") || "").trim();
      const parentPath = String(formData.get("parent_path") || "").trim();
      const storageTarget = String(formData.get("storage_target") || "pc").trim();

      if (!userId) {
        return NextResponse.json({ error: "user_id is required." }, { status: 400 });
      }

      if (deviceToken && isDeviceRevoked(userId, deviceToken)) {
        return NextResponse.json(
          { revoked: true, error: "This device has been removed from your account." },
          { status: 401 },
        );
      }

      const files = formData.getAll("files");
      const paths = formData.getAll("paths").map((v) => String(v || ""));

      if (files.length === 0) {
        return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
      }

      const userRoot = getStorageDirectoryForTarget(userId, storageTarget);
      const uploadedItems = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;

        // Relative path can be "myFolder/subFolder/file.txt" or just "file.txt"
        const rawRelative = paths[i] || file.name || "file";
        const cleanParts = rawRelative
          .split(/[\/\\]/)
          .filter(Boolean)
          .map((part) => part.trim().replace(/[<>:"/\\|?*]/g, "_"));

        const fileName = cleanParts.pop();
        if (!fileName) continue;

        // Subdirectories under current parentPath
        let currentParent = parentPath;
        for (const subDir of cleanParts) {
          createDriveFolder(userId, subDir, currentParent, deviceName, deviceToken, storageTarget);
          currentParent = currentParent ? `${currentParent}/${subDir}` : subDir;
        }

        // Target directory on disk
        const targetDirFullPath = currentParent ? path.join(userRoot, currentParent) : userRoot;
        await fs.mkdir(targetDirFullPath, { recursive: true });

        const fileFullPath = path.join(targetDirFullPath, fileName);

        // Stream large file to disk with constant memory footprint
        let fileSize = Number(file.size || 0);
        if (typeof file.stream === "function") {
          const fileStream = Readable.fromWeb(file.stream());
          const writeStream = fsSync.createWriteStream(fileFullPath);
          await pipeline(fileStream, writeStream);
          const stat = fsSync.statSync(fileFullPath);
          fileSize = stat.size;
        } else if (typeof file.arrayBuffer === "function") {
          const fileBuffer = Buffer.from(await file.arrayBuffer());
          await fs.writeFile(fileFullPath, fileBuffer);
          fileSize = fileBuffer.length;
        }

        const savedItem = saveDriveFile(
          userId,
          fileName,
          currentParent,
          fileSize,
          file.type || "application/octet-stream",
          deviceName,
          deviceToken,
          storageTarget,
        );
        uploadedItems.push(savedItem);
      }

      return NextResponse.json({ success: true, count: uploadedItems.length, items: uploadedItems });
    }

    // JSON Action (create_folder, rename, move, delete, list_folders)
    const body = await request.json();
    const userId = Number(body?.user_id);
    const action = String(body?.action || "").trim();
    const deviceToken = String(body?.device_token || "").trim();

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    if (deviceToken && isDeviceRevoked(userId, deviceToken)) {
      return NextResponse.json(
        { revoked: true, error: "This device has been removed from your account." },
        { status: 401 },
      );
    }

    if (action === "create_folder") {
      const name = String(body?.name || "").trim();
      const parentPath = String(body?.parent_path || "").trim();
      const deviceName = String(body?.device_name || "LAN Device").trim();
      const storageTarget = String(body?.storage_target || "pc").trim();

      const folder = createDriveFolder(userId, name, parentPath, deviceName, deviceToken, storageTarget);
      return NextResponse.json({ success: true, folder });
    }

    if (action === "rename") {
      const itemId = Number(body?.item_id);
      const newName = String(body?.new_name || "").trim();

      const updated = renameDriveItem(userId, itemId, newName);
      return NextResponse.json({ success: true, item: updated });
    }

    if (action === "move") {
      const itemId = Number(body?.item_id);
      const newParentPath = String(body?.new_parent_path || "").trim();
      const newStorageTarget = String(body?.new_storage_target || "").trim();

      const updated = moveDriveItem(userId, itemId, newParentPath, newStorageTarget);
      return NextResponse.json({ success: true, item: updated });
    }

    if (action === "delete") {
      const itemId = Number(body?.item_id);
      const deleted = deleteDriveItem(userId, itemId);
      return NextResponse.json({ success: true, item: deleted });
    }

    if (action === "batch_delete") {
      const itemIds = Array.isArray(body?.item_ids) ? body.item_ids : [];
      const deleted = batchDeleteDriveItems(userId, itemIds);
      return NextResponse.json({ success: true, deleted, count: deleted.length });
    }

    if (action === "get_download_tree") {
      const itemIds = Array.isArray(body?.item_ids) ? body.item_ids : [];
      const { selectedItems, folders, files } = getItemsWithDescendants(userId, itemIds);
      return NextResponse.json({
        success: true,
        selected_count: selectedItems.length,
        folders_count: folders.length,
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          relative_path: f.relative_path,
          archive_path: f.archive_path,
          size: f.size,
          mime_type: f.mime_type,
        })),
      });
    }

    if (action === "list_folders") {
      const targetStorage = String(body?.storage_target || "").trim();
      const folders = getAllDriveFolders(userId, targetStorage);
      return NextResponse.json({ success: true, folders });
    }

    if (action === "sync_items") {
      const itemsToSync = Array.isArray(body?.items) ? body.items : [];
      const restored = [];
      for (const item of itemsToSync) {
        if (!item || !item.name) continue;
        if (item.type === "folder") {
          const f = createDriveFolder(
            userId,
            item.name,
            item.parent_path || "",
            item.device_name || "LAN Device",
            item.device_token || "",
            item.storage_target || "pc",
          );
          restored.push(f);
        } else {
          const f = saveDriveFile(
            userId,
            item.name,
            item.parent_path || "",
            item.size || 0,
            item.mime_type || "",
            item.device_name || "LAN Device",
            item.device_token || "",
            item.storage_target || "pc",
          );
          restored.push(f);
        }
      }
      return NextResponse.json({ success: true, count: restored.length, items: restored });
    }

    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Operation failed." },
      { status: 400 },
    );
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { listFoldersByUserId } from "../../../lib/db.js";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    const folders = listFoldersByUserId(Number(userId));
    if (folders.length === 0) {
      return NextResponse.json({ folders: [], files: [] });
    }

    const folderSummaries = [];
    const filesByFolder = await Promise.all(
      folders.map(async (folder) => {
        try {
          const stats = await fs.stat(folder.path);
          if (!stats.isDirectory()) {
            throw new Error("Folder path is not a directory.");
          }

          const entries = await fs.readdir(folder.path, { withFileTypes: true });
          const folderFiles = await Promise.all(
            entries
              .filter((entry) => entry.isFile())
              .map(async (entry) => {
                const absolutePath = path.join(folder.path, entry.name);
                const fileStats = await fs.stat(absolutePath);

                return {
                  name: entry.name,
                  size: fileStats.size,
                  modifiedAt: fileStats.mtime.toISOString(),
                  folderId: folder.id,
                  folderPath: folder.path,
                  folderName: path.basename(folder.path) || folder.path,
                  downloadUrl: `/api/download/${encodeURIComponent(entry.name)}?folder_id=${folder.id}`,
                };
              }),
          );

          folderSummaries.push({
            id: folder.id,
            path: folder.path,
            name: path.basename(folder.path) || folder.path,
            device_name: folder.device_name,
            status: "ready",
          });

          return folderFiles;
        } catch {
          folderSummaries.push({
            id: folder.id,
            path: folder.path,
            name: path.basename(folder.path) || folder.path,
            device_name: folder.device_name,
            status: "unavailable",
          });

          return [];
        }
      }),
    );

    const files = filesByFolder.flat();

    files.sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime());
    folderSummaries.sort((left, right) => right.id - left.id);

    return NextResponse.json({
      folders: folderSummaries,
      files,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to list files.",
      },
      { status: 500 },
    );
  }
}

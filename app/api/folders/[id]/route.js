import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { FOLDER_STORAGE_DIRECTORY } from "../../../../lib/config.js";
import { removeFolder } from "../../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  try {
    const resolvedParams = await params;
    const folderId = Number(resolvedParams?.id);
    if (!folderId) {
      return NextResponse.json({ error: "folder id is required." }, { status: 400 });
    }

    const folder = removeFolder(folderId);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    }

    const storageRoot = path.resolve(FOLDER_STORAGE_DIRECTORY);
    const folderPath = path.resolve(folder.path);
    const storagePrefix = `${storageRoot}${path.sep}`;

    if (folderPath === storageRoot || folderPath.startsWith(storagePrefix)) {
      await fs.rm(folderPath, { recursive: true, force: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to remove folder.",
      },
      { status: 400 },
    );
  }
}
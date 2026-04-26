import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getFolderById } from "../../../../lib/db.js";

export const runtime = "nodejs";

function safeResolveFile(baseFolderPath, name) {
  const fileName = path.basename(decodeURIComponent(name));
  const folderRoot = path.resolve(baseFolderPath);
  const absolutePath = path.resolve(folderRoot, fileName);
  const rootPath = `${folderRoot}${path.sep}`;

  if (!absolutePath.startsWith(rootPath)) {
    throw new Error("Invalid file path.");
  }

  return { absolutePath, fileName };
}

export async function GET(request, { params }) {
  try {
    const { searchParams } = new URL(request.url);
    const folderId = Number(searchParams.get("folder_id"));

    if (!folderId) {
      return NextResponse.json({ error: "folder_id is required." }, { status: 400 });
    }

    const folder = getFolderById(folderId);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    }

    const { absolutePath, fileName } = safeResolveFile(folder.path, params.name);
    const fileBuffer = await fs.readFile(absolutePath);
    const stats = await fs.stat(absolutePath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(stats.size),
        "Content-Disposition": `attachment; filename="${fileName.replaceAll('"', "'")}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to download file.",
      },
      { status: 404 },
    );
  }
}

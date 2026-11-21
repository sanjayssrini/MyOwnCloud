import fsSync from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { getItemPhysicalPath, getItemsWithDescendants } from "../../../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = Number(searchParams.get("user_id"));
    const folderId = searchParams.get("folder_id");
    const itemIdsParam = searchParams.get("item_ids");
    let zipName = String(searchParams.get("name") || "").trim();

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    let ids = [];
    if (folderId) {
      ids = [Number(folderId)];
    } else if (itemIdsParam) {
      ids = itemIdsParam.split(",").map(Number).filter(Boolean);
    }

    if (ids.length === 0) {
      return NextResponse.json({ error: "item_ids or folder_id is required." }, { status: 400 });
    }

    const { selectedItems, folders, files } = getItemsWithDescendants(userId, ids);

    if (selectedItems.length === 0) {
      return NextResponse.json({ error: "No items found." }, { status: 404 });
    }

    if (!zipName) {
      if (selectedItems.length === 1) {
        zipName = `${selectedItems[0].name}.zip`;
      } else {
        zipName = "MyOwnCloud_Archive.zip";
      }
    }
    if (!zipName.toLowerCase().endsWith(".zip")) {
      zipName += ".zip";
    }

    const zip = new ZipArchive({ zlib: { level: 6 } });

    // Handle empty folders
    if (files.length === 0 && folders.length > 0) {
      for (const f of folders) {
        zip.append("", { name: `${f.name}/.empty` });
      }
    }

    // Append each file stream
    for (const file of files) {
      const fullPath = getItemPhysicalPath(userId, file);
      if (fullPath && fsSync.existsSync(fullPath)) {
        zip.append(fsSync.createReadStream(fullPath), { name: file.archive_path });
      }
    }

    // Finalize the archive stream
    zip.finalize();

    const webStream = Readable.toWeb(zip);

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(zipName)}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Zip generation failed." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const userId = Number(body?.user_id);
    const itemIds = Array.isArray(body?.item_ids) ? body.item_ids : [];
    let zipName = String(body?.name || "").trim();

    if (!userId || itemIds.length === 0) {
      return NextResponse.json({ error: "user_id and item_ids are required." }, { status: 400 });
    }

    const { selectedItems, folders, files } = getItemsWithDescendants(userId, itemIds);

    if (selectedItems.length === 0) {
      return NextResponse.json({ error: "No items found." }, { status: 404 });
    }

    if (!zipName) {
      zipName = selectedItems.length === 1 ? `${selectedItems[0].name}.zip` : "MyOwnCloud_Archive.zip";
    }
    if (!zipName.toLowerCase().endsWith(".zip")) {
      zipName += ".zip";
    }

    const zip = new ZipArchive({ zlib: { level: 6 } });

    if (files.length === 0 && folders.length > 0) {
      for (const f of folders) {
        zip.append("", { name: `${f.name}/.empty` });
      }
    }

    for (const file of files) {
      const fullPath = getItemPhysicalPath(userId, file);
      if (fullPath && fsSync.existsSync(fullPath)) {
        zip.append(fsSync.createReadStream(fullPath), { name: file.archive_path });
      }
    }

    zip.finalize();

    const webStream = Readable.toWeb(zip);

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(zipName)}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Zip generation failed." },
      { status: 500 },
    );
  }
}

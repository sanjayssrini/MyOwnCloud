import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createFolder, listFoldersByUserId } from "../../../lib/db.js";

export const runtime = "nodejs";

function normalizeDeviceName(deviceName) {
  const trimmedDeviceName = String(deviceName || "").trim();
  return trimmedDeviceName || "LAN Device";
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
      name: path.basename(folder.path) || folder.path,
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
    const body = await request.json();
    const userId = Number(body?.user_id);
    const folderPath = String(body?.path || "").trim();
    const deviceName = normalizeDeviceName(body?.device_name);

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

    const folder = createFolder(userId, folderPath, deviceName);
    return NextResponse.json({
      folder: {
        ...folder,
        name: path.basename(folder.path) || folder.path,
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

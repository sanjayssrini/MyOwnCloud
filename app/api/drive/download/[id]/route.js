import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getDriveItemById, getItemPhysicalPath } from "../../../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const { searchParams } = new URL(request.url);
    const userId = Number(searchParams.get("user_id"));
    const itemId = Number(resolvedParams?.id);

    if (!userId || !itemId) {
      return NextResponse.json({ error: "user_id and item_id are required." }, { status: 400 });
    }

    const item = getDriveItemById(userId, itemId);
    if (!item) {
      return NextResponse.json({ error: "Item not found." }, { status: 404 });
    }

    if (item.type !== "file") {
      return NextResponse.json({ error: "Only files can be directly downloaded." }, { status: 400 });
    }

    const fullPath = getItemPhysicalPath(userId, item);
    if (!fullPath) {
      return NextResponse.json({ error: "Physical file path not found." }, { status: 404 });
    }

    const fileBuffer = await fs.readFile(fullPath);
    const stats = await fs.stat(fullPath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": item.mime_type || "application/octet-stream",
        "Content-Length": String(stats.size),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(item.name)}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "File download failed." },
      { status: 404 },
    );
  }
}

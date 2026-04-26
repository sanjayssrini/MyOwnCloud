import { NextResponse } from "next/server";
import { listDevices, upsertDevice } from "../../../lib/db.js";

export const runtime = "nodejs";

function normalizeDeviceName(deviceName) {
  const trimmedDeviceName = String(deviceName || "").trim();
  return trimmedDeviceName || "LAN Device";
}

export async function POST(request) {
  try {
    const body = await request.json();
    const userId = Number(body?.user_id);
    const deviceName = normalizeDeviceName(body?.device_name);

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    upsertDevice(userId, deviceName, Date.now());

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save device heartbeat.",
      },
      { status: 400 },
    );
  }
}

export async function GET() {
  try {
    return NextResponse.json({ devices: listDevices() });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load devices.",
      },
      { status: 500 },
    );
  }
}

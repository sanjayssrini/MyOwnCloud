import { NextResponse } from "next/server";
import { isDeviceRevoked, listUserDevices, listDevices, removeUserDevice, upsertDevice } from "../../../lib/db.js";

export const runtime = "nodejs";

function normalizeDeviceName(deviceName) {
  const trimmedDeviceName = String(deviceName || "").trim();
  return trimmedDeviceName || "LAN Device";
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = String(body?.action || "").trim();
    const userId = Number(body?.user_id);
    const deviceId = Number(body?.device_id);

    // Support action: "remove" via POST
    if (action === "remove") {
      if (!userId || !deviceId) {
        return NextResponse.json({ error: "user_id and device_id are required." }, { status: 400 });
      }
      const removed = removeUserDevice(userId, deviceId);
      return NextResponse.json({ success: true, device: removed });
    }

    const deviceName = normalizeDeviceName(body?.device_name);
    const deviceToken = String(body?.device_token || "").trim();
    const disks = Array.isArray(body?.disks) ? body.disks : null;

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    // Check if device has been revoked/removed by the account owner
    if (deviceToken && isDeviceRevoked(userId, deviceToken)) {
      return NextResponse.json(
        {
          revoked: true,
          error: "This device has been removed from your account. Please sign in again.",
        },
        { status: 401 },
      );
    }

    upsertDevice(userId, deviceName, Date.now(), deviceToken, disks);

    return NextResponse.json({ success: true, device_name: deviceName });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to process device request.",
      },
      { status: 400 },
    );
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = Number(searchParams.get("user_id"));
    const deviceToken = String(searchParams.get("device_token") || "").trim();

    if (userId) {
      // Check if current requesting device is revoked
      if (deviceToken && isDeviceRevoked(userId, deviceToken)) {
        return NextResponse.json(
          {
            revoked: true,
            error: "This device has been removed from your account.",
          },
          { status: 401 },
        );
      }

      return NextResponse.json({ devices: listUserDevices(userId, deviceToken) });
    }

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

export async function DELETE(request) {
  try {
    const body = await request.json();
    const userId = Number(body?.user_id);
    const deviceId = Number(body?.device_id);

    if (!userId || !deviceId) {
      return NextResponse.json({ error: "user_id and device_id are required." }, { status: 400 });
    }

    const removed = removeUserDevice(userId, deviceId);
    return NextResponse.json({ success: true, device: removed });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to remove device.",
      },
      { status: 400 },
    );
  }
}

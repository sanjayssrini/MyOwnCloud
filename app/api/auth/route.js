import { NextResponse } from "next/server";
import { ensureUser, findDeviceByToken, upsertDevice } from "../../../lib/db.js";

export const runtime = "nodejs";

function normalizeDeviceName(deviceName) {
  const trimmedDeviceName = String(deviceName || "").trim();
  return trimmedDeviceName || "";
}

export async function POST(request) {
  try {
    const body = await request.json();
    const email = String(body?.email || "").trim();
    const name = String(body?.name || "").trim();
    const uid = String(body?.uid || "").trim();
    const deviceToken = String(body?.device_token || "").trim();
    const deviceName = normalizeDeviceName(body?.device_name);

    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const user = ensureUser(email, name, uid);

    // Check if device details match an active known device for this user
    let existingDevice = null;
    if (deviceToken) {
      existingDevice = findDeviceByToken(user.id, deviceToken);
    }

    if (existingDevice && existingDevice.status !== "removed") {
      // Known active device: update heartbeat and reuse registered device name
      upsertDevice(user.id, existingDevice.device_name, Date.now(), deviceToken);
      return NextResponse.json({
        user_id: user.id,
        email: user.email,
        name: user.name || name || "",
        device_name: existingDevice.device_name,
        is_new_device: false,
      });
    }

    // New device (or previously removed device signing in again) with name already provided
    if (deviceName) {
      upsertDevice(user.id, deviceName, Date.now(), deviceToken);
      return NextResponse.json({
        user_id: user.id,
        email: user.email,
        name: user.name || name || "",
        device_name: deviceName,
        is_new_device: false,
      });
    }

    // New device (or removed device needing new registration): prompt for device name
    return NextResponse.json({
      user_id: user.id,
      email: user.email,
      name: user.name || name || "",
      device_name: "",
      is_new_device: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to authenticate.",
      },
      { status: 400 },
    );
  }
}

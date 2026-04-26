import { NextResponse } from "next/server";
import { createOtpCode, ensureUser, upsertDevice, verifyOtpCode } from "../../../lib/db.js";

export const runtime = "nodejs";

function normalizeDeviceName(deviceName) {
  const trimmedDeviceName = String(deviceName || "").trim();
  return trimmedDeviceName || "LAN Device";
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = String(body?.action || "").trim();

    if (action === "request_otp") {
      const otp = createOtpCode(body?.email);
      return NextResponse.json({
        message: "OTP generated.",
        otp_token: otp.otpToken,
        expires_at: otp.expiresAt,
        // Local-network MVP: OTP is returned directly because no email provider is configured.
        otp_code: otp.otpCode,
      });
    }

    if (action === "verify_otp") {
      const email = body?.email;
      const deviceName = normalizeDeviceName(body?.device_name);

      verifyOtpCode(email, body?.otp_token, body?.otp_code);
      const user = ensureUser(email);
      upsertDevice(user.id, deviceName, Date.now());

      return NextResponse.json({
        user_id: user.id,
        email: user.email,
        device_name: deviceName,
      });
    }

    return NextResponse.json({ error: "Invalid auth action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to authenticate.",
      },
      { status: 400 },
    );
  }
}

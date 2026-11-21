import { NextResponse } from "next/server";
import { getLanIp } from "../../../../lib/network.js";

export const runtime = "nodejs";

export async function GET(request) {
  const host = request?.headers?.get("x-forwarded-host") || request?.headers?.get("host");
  const proto = request?.headers?.get("x-forwarded-proto") || "https";

  if (process.env.VERCEL || (host && host.includes("vercel.app"))) {
    const publicUrl = `${proto}://${host || "my-own-cloud.vercel.app"}`;
    return NextResponse.json({
      local_url: publicUrl,
      network_url: publicUrl,
      lan_url: publicUrl,
      ip: host || "my-own-cloud.vercel.app",
    });
  }

  const lanIp = getLanIp();
  const port = process.env.PORT || "3000";
  const lanUrl = `http://${lanIp}:${port}`;

  return NextResponse.json({
    local_url: `http://localhost:${port}`,
    network_url: lanUrl,
    lan_url: lanUrl,
    ip: lanIp,
    port,
  });
}

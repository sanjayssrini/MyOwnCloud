import { NextResponse } from "next/server";
import { getLanIp } from "../../../../lib/network.js";

export const runtime = "nodejs";

export async function GET() {
  const lanIp = getLanIp();
  const port = process.env.PORT || "3000";

  return NextResponse.json({
    local_url: `http://localhost:${port}`,
    network_url: `http://${lanIp}:${port}`,
    ip: lanIp,
    port,
  });
}

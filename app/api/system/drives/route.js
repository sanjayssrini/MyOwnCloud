import { NextResponse } from "next/server";
import {
  getStorageDirectoryForTarget,
  getUserById,
  listUserDevices,
  setUserStoragePath,
} from "../../../../lib/db.js";
import { getAvailableDrives } from "../../../../lib/drives.js";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = Number(searchParams.get("user_id"));

    const hostDisks = getAvailableDrives();
    let userStoragePath = "";
    let isConfigured = false;

    if (userId) {
      const user = getUserById(userId);
      if (user?.storage_path) {
        userStoragePath = user.storage_path;
        isConfigured = true;
      }
    }

    const isVercel = Boolean(process.env.VERCEL);
    const hostDeviceName = isVercel
      ? "Cloud Storage"
      : process.platform === "win32"
      ? "Windows PC"
      : "Host Device";

    // 1. Host Device / Cloud Storage with detected physical disks
    const hostDisksList = hostDisks.map((d) => ({
      id: d.id, // e.g. "C" or "cloud"
      device_name: hostDeviceName,
      disk_name: d.name, // e.g. "Local Disk (C:)" or "Cloud Storage"
      name: isVercel ? d.name : `${hostDeviceName} - ${d.name}`,
      root_path: d.root_path,
      free: d.free ? `${d.free} free` : isVercel ? "Cloud Storage" : "Host Disk",
      total: d.total,
      is_device: false,
      is_online: true,
      storage_type: isVercel ? "cloud" : "host_disk",
    }));

    const devices = [
      {
        device_name: hostDeviceName,
        is_host: true,
        is_online: true,
        disks: hostDisksList,
      },
    ];

    const flatDrives = [...hostDisksList];

    // 2. Connected client devices (e.g. Android phone)
    if (userId) {
      const userDevices = listUserDevices(userId);
      for (const dev of userDevices) {
        const lowerName = (dev.device_name || "").toLowerCase();
        // Ignore host PC or Cloud Storage from devices table so host is represented cleanly
        if (
          dev.status !== "removed" &&
          !lowerName.includes("windows pc") &&
          !lowerName.includes("host pc") &&
          !lowerName.includes("cloud storage")
        ) {
          // Check if device reported its own disks via OPFS
          let clientDisks = [];
          if (Array.isArray(dev.disks) && dev.disks.length > 0) {
            clientDisks = dev.disks.map((cd) => {
              const diskId = `${dev.device_name}:${cd.disk_name}`;
              return {
                id: diskId,
                device_name: dev.device_name,
                disk_name: cd.disk_name,
                name: `${dev.device_name} - ${cd.disk_name}`,
                folder_name: `${dev.device_name}/${cd.disk_name}`,
                free: cd.free || (dev.is_online ? "On-Device Storage (Online)" : "On-Device Storage"),
                is_device: true,
                is_online: dev.is_online,
                device_token: dev.device_token,
                storage_type: "client_opfs",
              };
            });
          } else {
            // Default on-device disk for connected device
            const diskId = `${dev.device_name}:Internal Storage`;
            clientDisks = [
              {
                id: diskId,
                device_name: dev.device_name,
                disk_name: "Internal Storage",
                name: `${dev.device_name} - Internal Storage`,
                folder_name: `${dev.device_name}/Internal Storage`,
                free: dev.is_online ? "On-Device Storage (Online)" : "On-Device Storage",
                is_device: true,
                is_online: dev.is_online,
                device_token: dev.device_token,
                storage_type: "client_opfs",
              },
            ];
          }

          devices.push({
            device_name: dev.device_name,
            device_token: dev.device_token,
            is_host: false,
            is_online: dev.is_online,
            disks: clientDisks,
          });

          flatDrives.push(...clientDisks);
        }
      }
    }

    return NextResponse.json({
      devices, // Full hierarchical tree: <Device_name> -> <Disk Name>
      drives: flatDrives, // Flattened list of disks
      storage_path: userStoragePath,
      is_configured: isConfigured,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to detect drives." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const userId = Number(body?.user_id);
    const driveRoot = String(body?.drive_root || "").trim();

    if (!userId || !driveRoot) {
      return NextResponse.json(
        { error: "user_id and drive_root are required." },
        { status: 400 },
      );
    }

    const storagePath = setUserStoragePath(userId, driveRoot);
    return NextResponse.json({ success: true, storage_path: storagePath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set storage drive." },
      { status: 400 },
    );
  }
}

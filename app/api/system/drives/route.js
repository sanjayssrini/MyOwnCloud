import { NextResponse } from "next/server";
import { IS_VERCEL } from "../../../../lib/config.js";
import {
  getStorageDirectoryForTarget,
  getUserById,
  getUserNetworkStatus,
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

    const hostDeviceName = "Windows PC";

    // 1. Host Device (Windows PC) with its detected physical disks (C, D, E)
    const hostDisksList = hostDisks.map((d) => ({
      id: d.id, // e.g. "C"
      device_name: hostDeviceName,
      disk_name: d.name, // e.g. "Local Disk (C:)"
      name: `${hostDeviceName} - ${d.name}`,
      root_path: d.root_path,
      free: d.free ? `${d.free} free` : "Host Disk",
      total: d.total,
      is_device: false,
      is_online: true,
      storage_type: "host_disk",
    }));

    const devices = [];
    const flatDrives = [];

    // On local machine (!IS_VERCEL), include the physical host disks (C, D, E)
    if (!IS_VERCEL) {
      devices.push({
        device_name: hostDeviceName,
        is_host: true,
        is_online: true,
        disks: hostDisksList,
      });
      flatDrives.push(...hostDisksList);
    }

    // 2. Connected client devices (e.g. Android phone, other PCs)
    if (userId) {
      const userDevices = listUserDevices(userId);
      for (const dev of userDevices) {
        if (dev.status === "removed") continue;

        const lowerName = (dev.device_name || "").toLowerCase();
        // On local Windows PC, avoid duplicating the host PC
        if (!IS_VERCEL && (lowerName.includes("windows pc") || lowerName.includes("host pc"))) {
          continue;
        }

        // Check if device reported its own disks
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
              storage_type: cd.storage_type || "client_storage",
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
              storage_type: "client_storage",
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

    // Fallback if no devices are registered yet
    if (devices.length === 0) {
      devices.push({
        device_name: hostDeviceName,
        is_host: true,
        is_online: true,
        disks: hostDisksList,
      });
      flatDrives.push(...hostDisksList);
    }

    const networkStatus = userId
      ? getUserNetworkStatus(userId)
      : { active_count: 1, same_network: true, network_mismatch: false, message: null };

    return NextResponse.json({
      devices, // Full hierarchical tree: <Device_name> -> <Disk Name>
      drives: flatDrives, // Flattened list of disks
      storage_path: userStoragePath,
      is_configured: isConfigured,
      ...networkStatus,
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

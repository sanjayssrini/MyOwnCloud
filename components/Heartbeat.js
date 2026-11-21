"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { initOnDeviceStorage } from "../lib/deviceStorage.js";

const USER_ID_KEY = "myowncloud_user_id";
const DEVICE_NAME_KEY = "myowncloud_device_name";
const DEVICE_TOKEN_KEY = "myowncloud_device_token";
const USER_NAME_KEY = "myowncloud_user_name";
const EMAIL_KEY = "myowncloud_email";

function detectFriendlyDeviceName() {
  if (typeof navigator === "undefined") return "Device";
  const ua = navigator.userAgent || "";
  const p = navigator.userAgentData?.platform || navigator.platform || "";
  let base = "Device";

  if (/Android/i.test(ua) || /Android/i.test(p)) {
    base = "Android Phone";
  } else if (/iPhone/i.test(ua)) {
    base = "iPhone";
  } else if (/iPad/i.test(ua)) {
    base = "iPad";
  } else if (/Windows/i.test(ua) || /Win/i.test(p)) {
    base = "Windows PC";
  } else if (/Macintosh|Mac OS/i.test(ua) || /Mac/i.test(p)) {
    base = "MacBook";
  } else if (/Linux/i.test(ua)) {
    base = "Linux PC";
  }

  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base} ${suffix}`;
}

function ensureDeviceName() {
  const existingName = window.localStorage.getItem(DEVICE_NAME_KEY);
  if (
    existingName &&
    !existingName.startsWith("Win32") &&
    !existingName.startsWith("Linux arm") &&
    !existingName.startsWith("Linux aarch") &&
    !existingName.startsWith("LAN Device")
  ) {
    return existingName;
  }

  const generatedName = detectFriendlyDeviceName();
  window.localStorage.setItem(DEVICE_NAME_KEY, generatedName);
  return generatedName;
}

function ensureDeviceToken() {
  let token = window.localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = "dev-" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
}

export default function Heartbeat() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let active = true;
    let timerId;

    const tick = async () => {
      if (!active) {
        return;
      }

      const userId = window.localStorage.getItem(USER_ID_KEY);
      if (!userId) {
        return;
      }

      const deviceName = ensureDeviceName();
      const deviceToken = ensureDeviceToken();

      // Initialize on-device folder (<Device_name>/<Disk Name>) and query storage capacity
      let deviceDiskInfo = {
        disk_name: "Internal Storage",
        free: "On-Device Storage",
        free_bytes: 0,
        total_bytes: 0,
        storage_type: "client_storage",
      };
      try {
        const onDev = await initOnDeviceStorage(deviceName, "Internal Storage");
        if (onDev) {
          deviceDiskInfo = {
            disk_name: "Internal Storage",
            free: onDev.freeStr || "On-Device Storage",
            free_bytes: onDev.freeBytes || 0,
            total_bytes: onDev.totalBytes || 0,
            storage_type: onDev.storageType || "client_storage",
          };
        }
      } catch {
        // Ignore storage query error
      }

      try {
        const response = await fetch("/api/device", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: Number(userId),
            email: window.localStorage.getItem(EMAIL_KEY) || "",
            device_name: deviceName,
            device_token: deviceToken,
            disks: [deviceDiskInfo],
          }),
        });

        if (response.status === 401) {
          const payload = await response.json();
          if (payload?.revoked) {
            // Device was removed from the account! Clear local session and log out
            window.localStorage.removeItem(USER_ID_KEY);
            window.localStorage.removeItem(USER_NAME_KEY);
            window.localStorage.removeItem(EMAIL_KEY);
            // Notice: keep device_name and device_token so when they sign in again,
            // they can be registered as a new device smoothly.
            alert("This device has been removed from your account. Please sign in again.");
            router.replace("/");
            return;
          }
        }
      } catch {
        // Network dropouts are ignored
      }
    };

    tick();
    timerId = window.setInterval(tick, 5000);

    return () => {
      active = false;
      if (timerId) {
        window.clearInterval(timerId);
      }
    };
  }, [router]);

  return null;
}

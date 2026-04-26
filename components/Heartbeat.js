"use client";

import { useEffect } from "react";

const USER_ID_KEY = "myowncloud_user_id";
const DEVICE_NAME_KEY = "myowncloud_device_name";

function ensureDeviceName() {
  const existingName = window.localStorage.getItem(DEVICE_NAME_KEY);
  if (existingName) {
    return existingName;
  }

  const platform = navigator.userAgentData?.platform || navigator.platform || "LAN Device";
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const generatedName = `${platform} ${suffix}`.replace(/\s+/g, " ").trim();
  window.localStorage.setItem(DEVICE_NAME_KEY, generatedName);
  return generatedName;
}

async function sendHeartbeat() {
  const userId = window.localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    return;
  }

  const deviceName = ensureDeviceName();
  await fetch("/api/device", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: Number(userId),
      device_name: deviceName,
    }),
  });
}

export default function Heartbeat() {
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

      try {
        await sendHeartbeat();
      } catch {
        // Heartbeat failures are intentionally ignored so the UI keeps working offline.
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
  }, []);

  return null;
}

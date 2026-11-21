export function getOrCreateDeviceToken() {
  if (typeof window === "undefined") {
    return "";
  }
  const key = "myowncloud_device_token";
  let token = window.localStorage.getItem(key);
  if (!token) {
    token =
      "dev-" +
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36));
    window.localStorage.setItem(key, token);
  }
  return token;
}

export async function getSuggestedDeviceName() {
  if (typeof navigator === "undefined") {
    return "LAN Device";
  }

  const platformHint = String(navigator.userAgentData?.platform || navigator.platform || "Device").trim();
  let modelHint = "";
  let browserHint = "";

  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const highEntropyValues = await navigator.userAgentData.getHighEntropyValues([
        "architecture",
        "model",
        "platform",
        "platformVersion",
        "uaFullVersion",
      ]);

      modelHint = String(highEntropyValues.model || "").trim();
      browserHint = String(highEntropyValues.uaFullVersion || "").trim();
    }
  } catch {
    browserHint = "";
  }

  const readablePlatform = /win/i.test(platformHint)
    ? "Windows PC"
    : /mac/i.test(platformHint)
      ? "MacBook"
      : /iphone/i.test(platformHint) || /ipad/i.test(platformHint)
        ? "iOS Device"
        : /android/i.test(navigator.userAgent || platformHint)
          ? "Android Device"
          : /linux/i.test(platformHint)
            ? "Linux Device"
            : platformHint;

  const parts = [readablePlatform, modelHint, browserHint ? `v${browserHint.split(".")[0]}` : ""];
  const label = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  return label || "LAN Device";
}

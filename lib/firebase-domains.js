import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROJECT_ID = "myowncloud-fff61";

export async function ensureCurrentHostAuthorized(currentIp) {
  if (!currentIp || currentIp === "127.0.0.1" || currentIp === "localhost") {
    return;
  }

  try {
    const configPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
    if (!fs.existsSync(configPath)) {
      return;
    }

    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const token = cfg.tokens?.access_token;
    if (!token) {
      return;
    }

    // Fetch existing authorized domains
    const getRes = await fetch(
      `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/config`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!getRes.ok) return;

    const data = await getRes.json();
    const existing = Array.isArray(data.authorizedDomains) ? data.authorizedDomains : [];

    if (!existing.includes(currentIp)) {
      const updatedDomains = [...existing, currentIp];
      await fetch(
        `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/config?updateMask=authorizedDomains`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ authorizedDomains: updatedDomains }),
        },
      );
    }
  } catch {
    // Non-blocking background enhancement
  }
}

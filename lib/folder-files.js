import crypto from "node:crypto";

export function encodeStoredFolderFileName(relativePath) {
  const normalizedRelativePath = String(relativePath || "").trim() || "file";
  return `f-${crypto.randomUUID()}__${Buffer.from(normalizedRelativePath, "utf8").toString("base64url")}`;
}

export function decodeStoredFolderFileName(storedName) {
  const normalizedStoredName = String(storedName || "").trim();
  const encodedRelativePath = normalizedStoredName.split("__").slice(1).join("__");

  if (!encodedRelativePath) {
    return normalizedStoredName;
  }

  try {
    return Buffer.from(encodedRelativePath, "base64url").toString("utf8");
  } catch {
    return normalizedStoredName;
  }
}

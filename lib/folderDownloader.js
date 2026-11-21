// lib/folderDownloader.js
// Client-side engine for "Download as Folder" (via File System Access API)
// and "Download as ZIP" with automatic fallback.

export function isDirectoryPickerSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/**
 * Trigger download of selected items as a single ZIP archive.
 */
export function downloadAsZip(userId, itemIds = [], zipName = "") {
  if (!userId || itemIds.length === 0) return;
  const idsStr = Array.isArray(itemIds) ? itemIds.join(",") : String(itemIds);
  const nameParam = zipName ? `&name=${encodeURIComponent(zipName)}` : "";
  const url = `/api/drive/download/zip?user_id=${encodeURIComponent(userId)}&item_ids=${encodeURIComponent(idsStr)}${nameParam}`;

  const a = document.createElement("a");
  a.href = url;
  a.download = zipName || "archive.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Downloads a folder or set of items directly into a local folder on the user's computer.
 * Recreates the complete directory hierarchy and writes files directly to disk.
 * If showDirectoryPicker is not supported, automatically falls back to ZIP.
 */
export async function downloadAsFolder(userId, itemIds = [], defaultFolderName = "MyOwnCloud_Folder", onProgress = null) {
  const ids = (Array.isArray(itemIds) ? itemIds : [itemIds]).map(Number).filter(Boolean);
  if (!userId || ids.length === 0) {
    throw new Error("No items selected for download.");
  }

  // 1. Check browser support for Native Directory Picker
  if (!isDirectoryPickerSupported()) {
    // Graceful fallback to ZIP
    downloadAsZip(userId, ids, `${defaultFolderName}.zip`);
    return {
      success: true,
      fallback: true,
      message: "Direct folder saving is not supported in this browser. Downloaded as ZIP archive instead.",
    };
  }

  // 2. Fetch manifest of files to write
  const res = await fetch("/api/drive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "get_download_tree",
      user_id: Number(userId),
      item_ids: ids,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.files) {
    throw new Error(data?.error || "Failed to retrieve folder contents.");
  }

  if (data.files.length === 0) {
    // Empty folder: inform user
    return {
      success: true,
      count: 0,
      message: "Folder is empty. No files to write.",
    };
  }

  // 3. Prompt user to choose destination folder on their PC/device
  let rootHandle;
  try {
    rootHandle = await window.showDirectoryPicker({
      id: "myowncloud_download",
      mode: "readwrite",
      startIn: "downloads",
    });
  } catch (err) {
    if (err.name === "AbortError") {
      return { success: false, aborted: true };
    }
    throw err;
  }

  // Helper to create and walk subdirectories
  async function resolveDirectory(baseHandle, dirPathSegments) {
    let current = baseHandle;
    for (const segment of dirPathSegments) {
      if (!segment) continue;
      const cleanSeg = segment.replace(/[<>:"/\\|?*]/g, "_");
      current = await current.getDirectoryHandle(cleanSeg, { create: true });
    }
    return current;
  }

  const total = data.files.length;
  let saved = 0;

  // 4. Download and stream each file into the local directory
  for (let i = 0; i < total; i++) {
    const file = data.files[i];
    if (onProgress) {
      onProgress({
        current: i + 1,
        total,
        fileName: file.name,
        percent: Math.round(((i) / total) * 100),
      });
    }

    try {
      const parts = (file.archive_path || file.name).split("/");
      const fileName = parts.pop();
      const targetDir = await resolveDirectory(rootHandle, parts);

      const fileRes = await fetch(`/api/drive/download/${file.id}?user_id=${userId}`);
      if (!fileRes.ok) {
        console.warn(`Failed to fetch file ID ${file.id}`);
        continue;
      }

      const blob = await fileRes.blob();
      const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      saved++;
      if (onProgress) {
        onProgress({
          current: saved,
          total,
          fileName: file.name,
          percent: Math.round((saved / total) * 100),
        });
      }
    } catch (err) {
      console.warn(`Error writing file ${file.name}:`, err);
    }
  }

  return {
    success: true,
    count: saved,
    total,
    fallback: false,
    message: `Successfully saved ${saved} of ${total} files to your selected folder.`,
  };
}

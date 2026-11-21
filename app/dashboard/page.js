"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Heartbeat from "../../components/Heartbeat.js";
import ProfileDropdown from "../../components/ProfileDropdown.js";
import Logo from "../../components/Logo.js";
import { writeOnDeviceFile } from "../../lib/deviceStorage.js";
import { downloadAsFolder, downloadAsZip } from "../../lib/folderDownloader.js";

const USER_ID_KEY = "myowncloud_user_id";
const DEVICE_NAME_KEY = "myowncloud_device_name";
const DEVICE_TOKEN_KEY = "myowncloud_device_token";

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function getFileIcon(fileName) {
  const ext = (fileName || "").split(".").pop().toLowerCase();
  switch (ext) {
    case "pdf":
      return { label: "PDF", color: "#ef4444" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return { label: "IMG", color: "#3b82f6" };
    case "mp4":
    case "mov":
    case "mkv":
    case "webm":
      return { label: "VID", color: "#8b5cf6" };
    case "mp3":
    case "wav":
    case "flac":
      return { label: "AUD", color: "#ec4899" };
    case "zip":
    case "tar":
    case "gz":
    case "rar":
    case "7z":
      return { label: "ZIP", color: "#f59e0b" };
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "py":
    case "html":
    case "css":
    case "json":
      return { label: "CODE", color: "#10b981" };
    case "doc":
    case "docx":
    case "txt":
    case "md":
      return { label: "DOC", color: "#2563eb" };
    default:
      return { label: "FILE", color: "#64748b" };
  }
}

function formatStorageBadge(file) {
  if (!file) return "";
  const devName = file.device_name || "Windows PC";
  const target = file.storage_target || "pc";
  if (/^[A-Za-z]$/.test(target)) {
    return `${devName} • Local Disk (${target.toUpperCase()}:)`;
  }
  if (target === "pc") {
    return `${devName} • Local Disk`;
  }
  return `${devName} • ${target}`;
}

async function safeFetchJson(url, options = {}) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data = {};
    if (text && text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text.slice(0, 150) };
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: { error: err instanceof Error ? err.message : "Connection failed." },
    };
  }
}

export default function DashboardPage() {
  const router = useRouter();

  // Hidden file inputs
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const newMenuRef = useRef(null);
  const currentUploadXhr = useRef(null);

  // App Navigation: "drive" | "devices"
  const [activeSection, setActiveSection] = useState("drive");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Storage Location: "all" | "pc" | "phone"
  const [storageLocation, setStorageLocation] = useState("all");

  // Core Drive State
  const [currentPath, setCurrentPath] = useState("");
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ total_files: 0, total_folders: 0, total_bytes: 0 });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "list"
  const [sortBy, setSortBy] = useState("name"); // "name" | "date" | "size"

  // Dropdown states
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState(null);

  // Real-time Upload Progress State
  const [uploadProgress, setUploadProgress] = useState({
    active: false,
    percent: 0,
    loaded: 0,
    total: 0,
    fileName: "",
    fileCount: 1,
    status: "idle", // 'uploading' | 'done' | 'error'
    error: "",
  });

  // Multi-select & Folder Download States
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [folderDownloadProgress, setFolderDownloadProgress] = useState({
    active: false,
    current: 0,
    total: 0,
    fileName: "",
    percent: 0,
    status: "idle",
    message: "",
  });

  // System drives & storage selection
  const [systemDevices, setSystemDevices] = useState([]);
  const [systemDrives, setSystemDrives] = useState([]);
  const [storagePath, setStoragePath] = useState("");
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [selectedDriveRoot, setSelectedDriveRoot] = useState("");
  const [savingDrive, setSavingDrive] = useState(false);
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const [networkMessage, setNetworkMessage] = useState("");
  const [activeDeviceCount, setActiveDeviceCount] = useState(0);

  // Modals
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveItem, setMoveItem] = useState(null);
  const [moveTargetDisk, setMoveTargetDisk] = useState("");
  const [availableFolders, setAvailableFolders] = useState([]);
  const [selectedDestination, setSelectedDestination] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadDestinationPrompt, setUploadDestinationPrompt] = useState(null);

  // Manage Devices State (Integrated in Dashboard)
  const [devicesList, setDevicesList] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState("");
  const [deviceSuccess, setDeviceSuccess] = useState("");
  const [editingDeviceName, setEditingDeviceName] = useState("");
  const [savingDeviceName, setSavingDeviceName] = useState(false);
  const [confirmRemoveDevice, setConfirmRemoveDevice] = useState(null);
  const [removingDeviceId, setRemovingDeviceId] = useState(null);

  // Local storage credentials
  const userId = typeof window !== "undefined" ? window.localStorage.getItem(USER_ID_KEY) : null;
  const deviceName = typeof window !== "undefined" ? window.localStorage.getItem(DEVICE_NAME_KEY) || "LAN Device" : "LAN Device";
  const deviceToken = typeof window !== "undefined" ? window.localStorage.getItem(DEVICE_TOKEN_KEY) || "" : "";

  // Check URL query parameters for section=devices
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("section") === "devices") {
        setActiveSection("devices");
      }
    }
  }, []);

  // Close menus on outside click with ref check
  useEffect(() => {
    function handleClickOutside(event) {
      if (newMenuRef.current && !newMenuRef.current.contains(event.target)) {
        setShowNewMenu(false);
      }
      if (!event.target.closest(".item-menu-container")) {
        setActiveMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch drive items for current directory & storage location
  const loadDrive = useCallback(async () => {
    if (!userId) {
      router.replace("/");
      return;
    }

    try {
      const { ok, status, data } = await safeFetchJson(
        `/api/drive?user_id=${encodeURIComponent(userId)}&parent_path=${encodeURIComponent(currentPath)}&device_token=${encodeURIComponent(deviceToken)}&storage_target=${encodeURIComponent(storageLocation)}`,
      );

      if (status === 401 && data?.revoked) {
        window.localStorage.removeItem(USER_ID_KEY);
        alert("This device has been removed from your account. Please sign in again.");
        router.replace("/");
        return;
      }

      if (!ok) {
        throw new Error(data?.error || "Failed to load drive items.");
      }

      setItems(data.items || []);
      if (data.stats) setStats(data.stats);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drive.");
    } finally {
      setLoading(false);
    }
  }, [userId, currentPath, deviceToken, storageLocation, router]);

  useEffect(() => {
    if (activeSection === "drive") {
      loadDrive();
    }
  }, [loadDrive, activeSection]);

  // Fetch Devices for integrated device manager
  const loadDevices = useCallback(async () => {
    if (!userId) return;
    setDevicesLoading(true);
    try {
      const { ok, data } = await safeFetchJson(
        `/api/device?user_id=${encodeURIComponent(userId)}&device_token=${encodeURIComponent(deviceToken)}`,
      );
      if (ok) {
        setDevicesList(data.devices || []);
        setDevicesError("");
      } else {
        setDevicesError(data?.error || "Unable to load devices.");
      }
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : "Unable to load devices.");
    } finally {
      setDevicesLoading(false);
    }
  }, [userId, deviceToken]);

  useEffect(() => {
    if (activeSection === "devices") {
      loadDevices();
    }
  }, [activeSection, loadDevices]);

  // Real-time multi-device sync and auto-discovery (every 5 seconds)
  useEffect(() => {
    if (!userId) return;

    let isMounted = true;
    const syncDevicesAndDrives = async () => {
      try {
        const { ok, data } = await safeFetchJson(
          `/api/system/drives?user_id=${encodeURIComponent(userId)}&device_token=${encodeURIComponent(deviceToken)}`,
        );
        if (ok && isMounted && data) {
          if (Array.isArray(data.devices)) setSystemDevices(data.devices);
          if (Array.isArray(data.drives)) setSystemDrives(data.drives);
          if (data.storage_path) setStoragePath(data.storage_path);
          if (data.network_mismatch !== undefined) setNetworkMismatch(Boolean(data.network_mismatch));
          if (data.message !== undefined) setNetworkMessage(data.message || "");
          if (data.active_count !== undefined) setActiveDeviceCount(Number(data.active_count || 0));
          if (data?.prompt_drive_selection && data.drives?.length > 1) {
            setSelectedDriveRoot(data.drives[0]?.root_path || "");
            setShowDrivePicker(true);
          }
        }
      } catch {
        // Ignored
      }
    };

    syncDevicesAndDrives();
    const intervalId = setInterval(syncDevicesAndDrives, 5000);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [userId, deviceToken]);

  // When activeSection is devices, also refresh device list periodically
  useEffect(() => {
    if (activeSection === "devices" && userId) {
      const intervalId = setInterval(loadDevices, 5000);
      return () => clearInterval(intervalId);
    }
  }, [activeSection, userId, loadDevices]);

  // Save selected disk drive
  async function handleSelectDrive() {
    if (!selectedDriveRoot || !userId) return;
    setSavingDrive(true);
    try {
      const res = await fetch("/api/system/drives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: Number(userId), drive_root: selectedDriveRoot }),
      });
      const data = await res.json();
      if (res.ok && data?.storage_path) {
        setStoragePath(data.storage_path);
        setShowDrivePicker(false);
        loadDrive();
      }
    } catch {
      // Ignored
    } finally {
      setSavingDrive(false);
    }
  }

  // Navigation handlers
  function navigateTo(pathStr) {
    setCurrentPath(pathStr);
    setSearchQuery("");
  }

  function navigateUp() {
    if (!currentPath) return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join("/"));
  }

  // Filter & Sort Items
  const filteredItems = useMemo(() => {
    let result = [...items];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((item) => item.name.toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      // Folders always first
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }

      if (sortBy === "name") {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      if (sortBy === "date") {
        return Number(b.updated_at || b.created_at) - Number(a.updated_at || a.created_at);
      }
      if (sortBy === "size") {
        return Number(b.size) - Number(a.size);
      }
      return 0;
    });

    return result;
  }, [items, searchQuery, sortBy]);

  const folders = useMemo(() => filteredItems.filter((i) => i.type === "folder"), [filteredItems]);
  const files = useMemo(() => filteredItems.filter((i) => i.type === "file"), [filteredItems]);

  // Clear selection on navigation or disk switch
  useEffect(() => {
    setSelectedIds(new Set());
  }, [currentPath, storageLocation]);

  // Selection helpers
  function toggleSelectItem(id, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    const allVisibleIds = filteredItems.map((i) => i.id);
    if (selectedIds.size === allVisibleIds.length && allVisibleIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisibleIds));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Batch action: Download as ZIP
  function handleBatchDownloadZip() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const folderName = currentPath ? currentPath.split("/").pop() : "MyOwnCloud_Selection";
    downloadAsZip(userId, ids, `${folderName}.zip`);
  }

  // Batch action: Download as Folder
  async function handleBatchDownloadFolder() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const folderName = currentPath ? currentPath.split("/").pop() : "MyOwnCloud_Selection";
    await handleDownloadFolderDirect(ids, folderName);
  }

  // Download folder direct (for 1 folder or multiple selected items)
  async function handleDownloadFolderDirect(ids, folderName) {
    setFolderDownloadProgress({
      active: true,
      current: 0,
      total: 1,
      fileName: "Preparing folder...",
      percent: 0,
      status: "downloading",
      message: "Please choose a destination folder...",
    });

    try {
      const res = await downloadAsFolder(userId, ids, folderName, (prog) => {
        setFolderDownloadProgress({
          active: true,
          current: prog.current,
          total: prog.total,
          fileName: prog.fileName,
          percent: prog.percent,
          status: "downloading",
          message: `Saving file ${prog.current} of ${prog.total}...`,
        });
      });

      if (res.aborted) {
        setFolderDownloadProgress((p) => ({ ...p, active: false }));
        return;
      }

      setFolderDownloadProgress((p) => ({
        ...p,
        percent: 100,
        status: "done",
        fileName: res.fallback ? "Downloaded as ZIP" : "Folder Saved",
        message: res.message,
      }));

      setTimeout(() => {
        setFolderDownloadProgress((p) => ({ ...p, active: false }));
      }, 3500);
    } catch (err) {
      setFolderDownloadProgress((p) => ({
        ...p,
        status: "error",
        fileName: "Download failed",
        message: err instanceof Error ? err.message : "Folder download failed",
      }));
    }
  }

  // Batch action: Delete selected
  async function handleBatchDelete() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Are you sure you want to permanently delete ${count} selected item${count === 1 ? "" : "s"}?`)) {
      return;
    }

    try {
      const response = await fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_delete",
          user_id: Number(userId),
          item_ids: Array.from(selectedIds),
          device_token: deviceToken,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Batch delete failed.");

      clearSelection();
      loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete selected items.");
    }
  }

  // Upload Handlers with Destination Selection & Streaming XMLHttpRequest
  function handleFileUpload(filesList, relativePaths = [], overrideTarget = null) {
    if (!filesList || filesList.length === 0) return;

    // When in Unified pool ("all"), ask the user which disk to store files in
    if (storageLocation === "all" && !overrideTarget && systemDrives.length > 0) {
      setUploadDestinationPrompt({ files: filesList, paths: relativePaths });
      return;
    }

    const targetToUse = overrideTarget || (storageLocation === "all" ? (systemDrives[0]?.id || "pc") : storageLocation);
    executeUpload(filesList, relativePaths, targetToUse);
  }

  function executeUpload(filesList, relativePaths = [], target) {
    const filesArray = Array.from(filesList);
    const totalBytes = filesArray.reduce((acc, f) => acc + (f.size || 0), 0);
    const firstName = filesArray[0]?.name || "file";
    const displayName = filesArray.length === 1 ? firstName : `${firstName} + ${filesArray.length - 1} more`;

    setUploading(true);
    setError("");
    setUploadProgress({
      active: true,
      percent: 0,
      loaded: 0,
      total: totalBytes,
      fileName: displayName,
      fileCount: filesArray.length,
      status: "uploading",
      error: "",
    });

    const formData = new FormData();
    formData.append("user_id", String(userId));
    formData.append("device_name", deviceName);
    formData.append("device_token", deviceToken);
    formData.append("parent_path", currentPath);
    formData.append("storage_target", target);

    filesArray.forEach((file, index) => {
      formData.append("files", file, file.name);
      formData.append("paths", relativePaths[index] || file.webkitRelativePath || file.name);
      // Ensure file is physically written to the device's local OPFS storage folder (<Device_name>/<Disk Name>)
      try {
        writeOnDeviceFile(deviceName, "Internal Storage", file.name, file);
      } catch {
        // OPFS local write ignored if not supported
      }
    });

    const xhr = new XMLHttpRequest();
    currentUploadXhr.current = xhr;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
        setUploadProgress((prev) => ({
          ...prev,
          percent,
          loaded: event.loaded,
          total: event.total,
          status: "uploading",
        }));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadProgress((prev) => ({
          ...prev,
          percent: 100,
          status: "done",
        }));
        setTimeout(() => {
          setUploadProgress((prev) => ({ ...prev, active: false }));
          setUploading(false);
        }, 2200);
        loadDrive();
      } else {
        let msg = `Upload failed (Status ${xhr.status})`;
        try {
          const errData = JSON.parse(xhr.responseText);
          msg = errData?.error || msg;
        } catch {
          msg = xhr.responseText?.slice(0, 150) || msg;
        }
        setUploadProgress((prev) => ({
          ...prev,
          status: "error",
          error: msg,
        }));
        setError(msg);
        setUploading(false);
      }
    };

    xhr.onerror = () => {
      const msg = "Network error during upload. Please check your connection.";
      setUploadProgress((prev) => ({
        ...prev,
        status: "error",
        error: msg,
      }));
      setError(msg);
      setUploading(false);
    };

    xhr.onabort = () => {
      setUploadProgress((prev) => ({
        ...prev,
        status: "error",
        error: "Upload canceled.",
      }));
      setUploading(false);
    };

    xhr.open("POST", "/api/drive");
    xhr.send(formData);

    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  // Create Folder
  async function handleCreateFolder(e) {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;

    try {
      const response = await fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_folder",
          user_id: Number(userId),
          name: trimmed,
          parent_path: currentPath,
          device_name: deviceName,
          device_token: deviceToken,
          storage_target: storageLocation === "all" ? "pc" : storageLocation,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Failed to create folder.");

      setCreateFolderOpen(false);
      setNewFolderName("");
      loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder.");
    }
  }

  // Rename Item
  async function handleRename(e) {
    e.preventDefault();
    if (!renameItem || !renameValue.trim()) return;

    try {
      const response = await fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          user_id: Number(userId),
          item_id: renameItem.id,
          new_name: renameValue.trim(),
          device_token: deviceToken,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Failed to rename.");

      setRenameItem(null);
      setRenameValue("");
      loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename.");
    }
  }

  // Fetch Folders for a specific storage target
  async function fetchFoldersForDisk(diskId, itemToMove) {
    const targetItem = itemToMove || moveItem;
    try {
      const { ok, data } = await safeFetchJson("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list_folders",
          user_id: Number(userId),
          storage_target: diskId,
          device_token: deviceToken,
        }),
      });
      if (ok && data?.folders) {
        const validFolders = data.folders.filter((f) => {
          if (targetItem && targetItem.type === "folder") {
            const currentItemTarget = targetItem.storage_target || "pc";
            if (diskId === currentItemTarget || (diskId === "C" && currentItemTarget === "pc")) {
              return f.id !== targetItem.id && !f.relative_path.startsWith(`${targetItem.relative_path}/`);
            }
          }
          return true;
        });
        setAvailableFolders(validFolders);
      } else {
        setAvailableFolders([]);
      }
    } catch {
      setAvailableFolders([]);
    }
  }

  // Open Move Dialog
  async function openMoveDialog(item) {
    setMoveItem(item);
    setSelectedDestination("");

    // Dynamic refresh to guarantee all connected devices & host disks are available
    let latestDrives = systemDrives;
    try {
      const { ok, data } = await safeFetchJson(`/api/system/drives?user_id=${userId}`);
      if (ok && data) {
        if (data.devices) setSystemDevices(data.devices);
        if (data.drives && data.drives.length > 0) {
          setSystemDrives(data.drives);
          latestDrives = data.drives;
        }
      }
    } catch {
      // Fallback to existing state
    }

    const initialDisk =
      item.storage_target && item.storage_target !== "pc"
        ? item.storage_target
        : storageLocation !== "all"
        ? storageLocation
        : latestDrives[0]?.id || "C";

    setMoveTargetDisk(initialDisk);
    await fetchFoldersForDisk(initialDisk, item);
  }

  async function handleMoveDiskChange(diskId) {
    setMoveTargetDisk(diskId);
    setSelectedDestination("");
    await fetchFoldersForDisk(diskId, moveItem);
  }

  // Move Item
  async function handleMove() {
    if (!moveItem) return;

    try {
      const { ok, data } = await safeFetchJson("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move",
          user_id: Number(userId),
          item_id: moveItem.id,
          new_storage_target: moveTargetDisk,
          new_parent_path: selectedDestination,
          device_token: deviceToken,
        }),
      });

      if (!ok) throw new Error(data?.error || "Failed to move item.");

      setMoveItem(null);
      setSelectedDestination("");
      loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move.");
    }
  }

  // Delete Item
  async function handleDelete(item) {
    if (!confirm(`Are you sure you want to delete "${item.name}"?`)) return;

    try {
      const response = await fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          user_id: Number(userId),
          item_id: item.id,
          device_token: deviceToken,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Failed to delete item.");

      loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    }
  }

  // Device Management Actions (Embedded in Dashboard)
  async function handleSaveDeviceName(e) {
    e.preventDefault();
    const trimmed = (editingDeviceName || deviceName).trim();
    if (!trimmed) return;

    setSavingDeviceName(true);
    setDevicesError("");
    setDeviceSuccess("");
    try {
      const res = await fetch("/api/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(userId),
          device_name: trimmed,
          device_token: deviceToken,
        }),
      });
      const payload = await res.json();
      if (res.ok) {
        window.localStorage.setItem(DEVICE_NAME_KEY, trimmed);
        setDeviceSuccess("Device name updated successfully!");
        loadDevices();
        setTimeout(() => setDeviceSuccess(""), 3000);
      } else {
        setDevicesError(payload?.error || "Failed to update device name.");
      }
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : "Failed to update device name.");
    } finally {
      setSavingDeviceName(false);
    }
  }

  async function handleConfirmRemoveDevice() {
    if (!confirmRemoveDevice) return;
    setRemovingDeviceId(confirmRemoveDevice.id);
    setDevicesError("");
    try {
      const res = await fetch("/api/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          user_id: Number(userId),
          device_id: confirmRemoveDevice.id,
          device_token: deviceToken,
        }),
      });
      const payload = await res.json();
      if (res.ok) {
        if (confirmRemoveDevice.device_token === deviceToken) {
          window.localStorage.removeItem(USER_ID_KEY);
          alert("This device has been removed from your account.");
          router.replace("/");
          return;
        }
        setConfirmRemoveDevice(null);
        await loadDevices();
        await loadDrive();
        fetch(`/api/system/drives?user_id=${userId}`)
          .then((r) => r.json())
          .then((data) => {
            if (data?.devices) setSystemDevices(data.devices);
            if (data?.drives) setSystemDrives(data.drives);
          })
          .catch(() => {});
      } else {
        setDevicesError(payload?.error || "Failed to remove device.");
      }
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : "Failed to remove device.");
    } finally {
      setRemovingDeviceId(null);
    }
  }

  // Drag and drop handlers
  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  }

  return (
    <div
      className="drive-viewport"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Heartbeat />

      {/* Hidden file & folder inputs */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
      />
      <input
        type="file"
        ref={folderInputRef}
        style={{ display: "none" }}
        webkitdirectory=""
        directory=""
        multiple
        onChange={(e) => {
          const files = e.target.files;
          const paths = Array.from(files).map((f) => f.webkitRelativePath || f.name);
          handleFileUpload(files, paths);
        }}
      />

      {/* DRAG & DROP OVERLAY */}
      {isDragging && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="M12 12v9" />
              <path d="m8 17 4 4 4-4" />
            </svg>
            <h3>Drop files here</h3>
            <p>Upload directly to {currentPath ? `/${currentPath}` : "My Drive"}</p>
          </div>
        </div>
      )}

      {/* TOPBAR */}
      <header className="drive-header-v2">
        <div className="header-left">
          {/* Mobile hamburger menu toggle */}
          <button
            className="mobile-menu-toggle-btn"
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {/* Unified Brand Logo */}
          <Logo size={24} showTag={false} href="/dashboard" />
        </div>

        <div className="header-center">
          <div className="drive-search-box">
            <svg className="search-svg-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              placeholder="Search in Drive..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input-field"
            />
            {searchQuery && (
              <button className="clear-search-btn" type="button" onClick={() => setSearchQuery("")}>
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="header-right">
          <ProfileDropdown
            onOpenDevices={() => {
              setActiveSection("devices");
              setMobileMenuOpen(false);
            }}
          />
        </div>
      </header>

      {/* MOBILE SIDEBAR BACKDROP */}
      {mobileMenuOpen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* BODY (SIDEBAR + MAIN CONTENT) */}
      <div className="drive-layout-body">
        {/* SIDEBAR */}
        <aside className={`drive-sidebar-v2 ${mobileMenuOpen ? "mobile-open" : ""}`}>
          {/* Mobile Sidebar Close Header */}
          <div className="mobile-sidebar-header">
            <Logo size={22} showTag={false} href="/dashboard" />
            <button
              type="button"
              className="btn-close-mobile-sidebar"
              onClick={() => setMobileMenuOpen(false)}
            >
              ✕
            </button>
          </div>

          {/* "+ New" Action Button */}
          <div className="new-btn-container" ref={newMenuRef}>
            <button
              className="btn-new-drive"
              type="button"
              onClick={() => setShowNewMenu((prev) => !prev)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New</span>
            </button>

            {/* "+ New" Dropdown Menu */}
            {showNewMenu && (
              <div className="new-menu-dropdown">
                <button
                  type="button"
                  className="new-menu-item"
                  onClick={() => {
                    setShowNewMenu(false);
                    setCreateFolderOpen(true);
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                  <span>New folder</span>
                </button>

                <div className="new-menu-divider" />

                <button
                  type="button"
                  className="new-menu-item"
                  onClick={() => {
                    setShowNewMenu(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="12" x2="12" y2="18" />
                    <line x1="9" y1="15" x2="15" y2="15" />
                  </svg>
                  <span>Upload file</span>
                </button>

                <button
                  type="button"
                  className="new-menu-item"
                  onClick={() => {
                    setShowNewMenu(false);
                    folderInputRef.current?.click();
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                    <polyline points="12 11 12 17 9 14" />
                    <line x1="12" y1="17" x2="15" y2="14" />
                  </svg>
                  <span>Upload folder</span>
                </button>
              </div>
            )}
          </div>

          {/* Navigation Links (In-Dashboard Section Switching) */}
          <nav className="sidebar-nav-v2">
            <button
              type="button"
              className={`nav-tab-item ${activeSection === "drive" ? "active" : ""}`}
              onClick={() => {
                setActiveSection("drive");
                setMobileMenuOpen(false);
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span>My Drive</span>
            </button>

            <button
              type="button"
              className={`nav-tab-item ${activeSection === "devices" ? "active" : ""}`}
              onClick={() => {
                setActiveSection("devices");
                setMobileMenuOpen(false);
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
              <span>Manage Devices</span>
            </button>
          </nav>

          {/* Storage Locations / Available Disks */}
          <div className="sidebar-locations-section">
            <span className="sidebar-section-title">Storage Locations</span>
            <div className="location-chips-list">
              <button
                type="button"
                className={`location-chip-btn ${storageLocation === "all" ? "active" : ""}`}
                onClick={() => {
                  setStorageLocation("all");
                  navigateTo("");
                  if (activeSection !== "drive") setActiveSection("drive");
                  setMobileMenuOpen(false);
                }}
              >
                <span className="loc-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                  </svg>
                </span>
                <div className="loc-info">
                  <span className="loc-title">All Storage</span>
                  <span className="loc-desc">Unified Cloud Pool</span>
                </div>
              </button>

              {/* Hierarchical Storage Locations: <Device_name> -> <Disk Name> */}
              {systemDevices.map((dev) => (
                <div key={dev.device_name} className="sidebar-device-group">
                  <div className="sidebar-device-header">
                    <span className="sidebar-device-icon">
                      {dev.is_host ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect width="20" height="14" x="2" y="3" rx="2" />
                          <line x1="8" x2="16" y1="21" y2="21" />
                          <line x1="12" x2="12" y1="17" y2="21" />
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                          <line x1="12" x2="12.01" y1="18" y2="18" />
                        </svg>
                      )}
                    </span>
                    <span className="sidebar-device-name">{dev.device_name}</span>
                    <span className={`sidebar-device-tag ${dev.is_online ? "online" : "offline"}`}>
                      {dev.is_online ? "Online" : "Offline"}
                    </span>
                  </div>

                  <div className="sidebar-device-disks">
                    {(dev.disks || []).map((disk) => {
                      const isActive = storageLocation === disk.id;
                      return (
                        <button
                          key={disk.id}
                          type="button"
                          className={`location-chip-btn nested-disk-btn ${isActive ? "active" : ""}`}
                          onClick={() => {
                            setStorageLocation(disk.id);
                            navigateTo("");
                            if (activeSection !== "drive") setActiveSection("drive");
                            setMobileMenuOpen(false);
                          }}
                        >
                          <span className="loc-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="22" y1="12" x2="2" y2="12" />
                              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                              <line x1="6" y1="16" x2="6.01" y2="16" />
                              <line x1="10" y1="16" x2="10.01" y2="16" />
                            </svg>
                          </span>
                          <div className="loc-info">
                            <span className="loc-title">{disk.disk_name}</span>
                            <span className="loc-desc">{disk.free || "Available"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Storage Meter */}
          <div className="sidebar-storage-card">
            <div className="storage-info-row">
              <span className="storage-label">
                {storageLocation === "all"
                  ? "Total Storage"
                  : systemDrives.find((d) => d.id === storageLocation)?.name || `Disk (${storageLocation}:)`}
              </span>
              <span className="storage-usage">{formatBytes(stats.total_bytes)}</span>
            </div>
            <div className="storage-track">
              <div
                className="storage-fill"
                style={{
                  width: `${Math.min(100, Math.max(8, (stats.total_bytes / (1024 * 1024 * 1024)) * 100))}%`,
                }}
              />
            </div>
            <p className="storage-caption">
              {stats.total_files} file{stats.total_files === 1 ? "" : "s"} &bull; {stats.total_folders} folder{stats.total_folders === 1 ? "" : "s"}
            </p>
          </div>
        </aside>

        {/* MAIN DASHBOARD CONTENT */}
        <main className="drive-main-v2">
          {/* Network Mismatch / Same Wi-Fi Notification Banner */}
          {networkMismatch && (
            <div className="network-alert-banner">
              <div className="network-alert-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="network-alert-content">
                <strong className="network-alert-title">Different Local Networks Detected</strong>
                <p className="network-alert-desc">
                  {networkMessage ||
                    "Your logged-in devices are not connected to the same Wi-Fi network. Please connect all devices to the same local Wi-Fi to transfer files directly between them."}
                </p>
              </div>
            </div>
          )}


          {/* SECTION 1: MANAGE DEVICES (INTEGRATED IN DASHBOARD) */}
          {activeSection === "devices" ? (
            <div className="devices-embedded-view">
              <div className="devices-header-row">
                <div className="devices-heading-group">
                  <h2>Manage Devices</h2>
                  <p>Devices connected to your personal cloud. Removing a device immediately revokes its session.</p>
                </div>
                <button
                  type="button"
                  className="btn-back-drive"
                  onClick={() => setActiveSection("drive")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  <span>Back to Drive</span>
                </button>
              </div>

              {devicesError && <div className="notice-banner error">{devicesError}</div>}
              {deviceSuccess && <div className="notice-banner success">{deviceSuccess}</div>}

              {/* Current Device Rename Box */}
              <div className="device-rename-box">
                <div>
                  <div className="device-rename-label">This Device Name</div>
                  <div className="device-rename-sub">How this device appears on your personal cloud network</div>
                </div>
                <form onSubmit={handleSaveDeviceName} className="device-rename-form">
                  <input
                    type="text"
                    value={editingDeviceName || deviceName}
                    onChange={(e) => setEditingDeviceName(e.target.value)}
                    className="device-rename-input"
                    placeholder="e.g. My Phone, Office PC"
                    required
                  />
                  <button type="submit" className="btn-save-device-name" disabled={savingDeviceName}>
                    {savingDeviceName ? "Saving..." : "Save"}
                  </button>
                </form>
              </div>

              {/* Devices Grid Layout */}
              <div className="devices-grid-layout">
                {devicesList.map((dev) => {
                  const isCurrent = dev.device_token && dev.device_token === deviceToken;
                  const isOnline = Date.now() - Number(dev.last_seen || 0) < 60000;
                  const isMobile = /phone|android|iphone|mobile|tablet/i.test(dev.device_name || "");

                  return (
                    <div
                      key={dev.id}
                      className={`device-card-box ${isCurrent ? "is-current" : ""}`}
                    >
                      <div className="device-top-info">
                        <div className="device-icon-badge">
                          {isMobile ? (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                              <line x1="12" x2="12.01" y1="18" y2="18" />
                            </svg>
                          ) : (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect width="20" height="14" x="2" y="3" rx="2" />
                              <line x1="8" x2="16" y1="21" y2="21" />
                              <line x1="12" x2="12" y1="17" y2="21" />
                            </svg>
                          )}
                        </div>

                        <div className="device-meta-content">
                          <h4 className="device-name-title">
                            <span>{dev.device_name}</span>
                            {isCurrent && <span className="this-device-tag">This Device</span>}
                          </h4>

                          <div className="device-status-indicator">
                            <span className={`status-dot ${isOnline ? "online" : ""}`} />
                            <span>{isOnline ? "Online now" : `Last seen ${formatDate(dev.last_seen)}`}</span>
                          </div>
                        </div>
                      </div>

                      <div className="device-footer-row">
                        <span className="device-last-seen">
                          {dev.files_count || 0} file{dev.files_count === 1 ? "" : "s"} stored
                        </span>

                        <button
                          type="button"
                          className="btn-remove-device-trigger"
                          onClick={() => setConfirmRemoveDevice(dev)}
                        >
                          Remove Device
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* SECTION 2: MY DRIVE VIEW */
            <>
              {/* Storage Locations Pill Bar */}
              <div className="storage-pills-bar">
                <span className="pills-bar-label">Storage:</span>
                <button
                  type="button"
                  className={`storage-pill-btn ${storageLocation === "all" ? "active" : ""}`}
                  onClick={() => {
                    setStorageLocation("all");
                    navigateTo("");
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                  </svg>
                  <span>All Storage (Unified)</span>
                </button>
                {systemDevices.flatMap((dev) =>
                  (dev.disks || []).map((disk) => {
                    const isActive = storageLocation === disk.id;
                    return (
                      <button
                        key={disk.id}
                        type="button"
                        className={`storage-pill-btn ${isActive ? "active" : ""}`}
                        onClick={() => {
                          setStorageLocation(disk.id);
                          navigateTo("");
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="22" y1="12" x2="2" y2="12" />
                          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                          <line x1="6" y1="16" x2="6.01" y2="16" />
                          <line x1="10" y1="16" x2="10.01" y2="16" />
                        </svg>
                        <span className="pill-dev-badge">{dev.device_name}:</span>
                        <span>{disk.disk_name}</span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Action Bar & Breadcrumbs */}
              <div className="drive-action-bar">
                <div className="breadcrumbs-trail">
                  {currentPath && (
                    <button
                      type="button"
                      className="btn-back-crumb"
                      onClick={navigateUp}
                      title="Go up one folder"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                  )}

                  <button
                    type="button"
                    className={`crumb-node ${!currentPath ? "active" : ""}`}
                    onClick={() => navigateTo("")}
                  >
                    <span>
                      {storageLocation === "all"
                        ? "All Storage (Unified)"
                        : (() => {
                            const found = systemDrives.find((d) => d.id === storageLocation);
                            return found ? `${found.device_name} • ${found.disk_name}` : `Storage (${storageLocation})`;
                          })()}
                    </span>
                  </button>

                  {currentPath.split("/").filter(Boolean).map((part, index, arr) => {
                    const subPath = arr.slice(0, index + 1).join("/");
                    const isLast = index === arr.length - 1;
                    return (
                      <span key={subPath} className="crumb-segment">
                        <span className="crumb-separator">/</span>
                        <button
                          type="button"
                          className={`crumb-node ${isLast ? "active" : ""}`}
                          onClick={() => navigateTo(subPath)}
                        >
                          {part}
                        </button>
                      </span>
                    );
                  })}
                </div>

                {/* Quick Action Buttons (Upload & Folder) */}
                <div className="action-buttons-group">
                  <button
                    type="button"
                    className="btn-drive-action action-primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Upload File</span>
                  </button>

                  <button
                    type="button"
                    className="btn-drive-action"
                    onClick={() => folderInputRef.current?.click()}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                    </svg>
                    <span>Upload Folder</span>
                  </button>

                  <button
                    type="button"
                    className="btn-drive-action"
                    onClick={() => setCreateFolderOpen(true)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span>+ Folder</span>
                  </button>

                  {/* Select All Toggle Button */}
                  {filteredItems.length > 0 && (
                    <button
                      type="button"
                      className={`btn-select-toggle ${selectedIds.size > 0 ? "active" : ""}`}
                      onClick={handleSelectAll}
                      title={selectedIds.size === filteredItems.length ? "Deselect All" : "Select All"}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        {selectedIds.size === filteredItems.length ? (
                          <polyline points="9 11 12 14 20 6" strokeWidth="2.5" />
                        ) : selectedIds.size > 0 ? (
                          <line x1="7" y1="12" x2="17" y2="12" strokeWidth="2.5" />
                        ) : null}
                      </svg>
                      <span>{selectedIds.size === filteredItems.length ? "Deselect All" : "Select All"}</span>
                    </button>
                  )}

                  {/* Sort By Dropdown */}
                  <select
                    className="drive-select-sort"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="name">Sort by Name</option>
                    <option value="date">Sort by Date</option>
                    <option value="size">Sort by Size</option>
                  </select>

                  {/* View Mode Toggle */}
                  <div className="view-toggle-group">
                    <button
                      type="button"
                      className={`btn-view-toggle ${viewMode === "grid" ? "active" : ""}`}
                      onClick={() => setViewMode("grid")}
                      title="Grid View"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect width="7" height="7" x="3" y="3" rx="1" />
                        <rect width="7" height="7" x="14" y="3" rx="1" />
                        <rect width="7" height="7" x="14" y="14" rx="1" />
                        <rect width="7" height="7" x="3" y="14" rx="1" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`btn-view-toggle ${viewMode === "list" ? "active" : ""}`}
                      onClick={() => setViewMode("list")}
                      title="List View"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Notices & Errors */}
              {error && <div className="notice-banner error">{error}</div>}

              {/* Content Area */}
              {loading ? (
                <div className="drive-loading-state">
                  <div className="loading-spinner" />
                  <p>Loading your cloud storage...</p>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="drive-empty-view">
                  <div className="empty-icon-circle">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <h3 className="empty-heading">
                    {searchQuery ? "No matching files or folders" : "This folder is empty"}
                  </h3>
                  <p className="empty-subtext">
                    Drag and drop files here or click Upload to store files in your cloud.
                  </p>
                  <div className="empty-actions">
                    <button
                      type="button"
                      className="btn-solid"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Upload File
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => setCreateFolderOpen(true)}
                    >
                      New Folder
                    </button>
                  </div>
                </div>
              ) : (
                <div className="drive-content-scrollable">
                  {/* FOLDERS SECTION */}
                  {folders.length > 0 && (
                    <section className="drive-section">
                      <h4 className="section-subtitle">Folders ({folders.length})</h4>
                      <div className="folders-grid-v2">
                        {folders.map((folder) => {
                          const isFolderSelected = selectedIds.has(folder.id);

                          return (
                            <div
                              key={folder.id}
                              className={`folder-tile-card ${activeMenuId === folder.id ? "menu-active" : ""} ${isFolderSelected ? "is-selected" : ""}`}
                              onClick={() => navigateTo(folder.relative_path)}
                            >
                              {/* Multi-Select Checkbox */}
                              <div
                                className={`card-checkbox-container ${isFolderSelected ? "visible" : ""}`}
                                onClick={(e) => toggleSelectItem(folder.id, e)}
                                title="Select folder"
                              >
                                <div className={`custom-card-checkbox ${isFolderSelected ? "checked" : ""}`}>
                                  {isFolderSelected && (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.5">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )}
                                </div>
                              </div>

                              <div className="folder-tile-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="#64748b" stroke="none">
                                  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                                </svg>
                              </div>
                              <span className="folder-tile-name" title={folder.name}>
                                {folder.name}
                              </span>

                              {/* 3-dots action menu */}
                              <div
                                className="item-menu-container"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMenuId(activeMenuId === folder.id ? null : folder.id);
                                }}
                              >
                                <button type="button" className="btn-dots-menu" title="More actions">
                                  &bull;&bull;&bull;
                                </button>

                                {activeMenuId === folder.id && (
                                  <div className="item-action-popover" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="action-popover-item"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        downloadAsZip(userId, [folder.id], `${folder.name}.zip`);
                                      }}
                                    >
                                      Download as ZIP
                                    </button>
                                    <button
                                      type="button"
                                      className="action-popover-item"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        handleDownloadFolderDirect([folder.id], folder.name);
                                      }}
                                    >
                                      Download as Folder
                                    </button>
                                    <div className="new-menu-divider" />
                                    <button
                                      type="button"
                                      className="action-popover-item"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        setRenameItem(folder);
                                        setRenameValue(folder.name);
                                      }}
                                    >
                                      Rename
                                    </button>
                                    <button
                                      type="button"
                                      className="action-popover-item"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        openMoveDialog(folder);
                                      }}
                                    >
                                      Move to...
                                    </button>
                                    <button
                                      type="button"
                                      className="action-popover-item item-danger"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        handleDelete(folder);
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* FILES SECTION */}
                  {files.length > 0 && (
                    <section className="drive-section" style={{ marginTop: folders.length > 0 ? "24px" : "0" }}>
                      <h4 className="section-subtitle">Files ({files.length})</h4>

                      {/* GRID VIEW */}
                      {viewMode === "grid" ? (
                        <div className="files-grid-v2">
                          {files.map((file) => {
                            const icon = getFileIcon(file.name);
                            const isMenuActive = activeMenuId === file.id;
                            const isFileSelected = selectedIds.has(file.id);

                            return (
                              <div
                                key={file.id}
                                className={`file-card-v2 ${isMenuActive ? "menu-active" : ""} ${isFileSelected ? "is-selected" : ""}`}
                              >
                                {/* Multi-Select Checkbox */}
                                <div
                                  className={`card-checkbox-container ${isFileSelected ? "visible" : ""}`}
                                  onClick={(e) => toggleSelectItem(file.id, e)}
                                  title="Select file"
                                >
                                  <div className={`custom-card-checkbox ${isFileSelected ? "checked" : ""}`}>
                                    {isFileSelected && (
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.5">
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                  </div>
                                </div>

                                <div className="file-card-preview">
                                  <span
                                    className="file-type-badge"
                                    style={{ background: icon.color }}
                                  >
                                    {icon.label}
                                  </span>
                                </div>

                                <div className="file-card-body">
                                  <div className="file-card-info">
                                    <h5 className="file-card-title" title={file.name}>
                                      {file.name}
                                    </h5>
                                    <p className="file-card-meta">
                                      {formatBytes(file.size)} &bull; {formatDate(file.updated_at || file.created_at)}
                                      {formatStorageBadge(file) && (
                                        <span className="file-target-tag">
                                          {formatStorageBadge(file)}
                                        </span>
                                      )}
                                    </p>
                                  </div>

                                  <div className="file-card-actions-row">
                                    <a
                                      href={`/api/drive/download/${file.id}?user_id=${userId}`}
                                      className="btn-file-download"
                                      title="Download file"
                                      download
                                    >
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7 10 12 15 17 10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                      </svg>
                                    </a>

                                    <div
                                      className="item-menu-container"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveMenuId(isMenuActive ? null : file.id);
                                      }}
                                    >
                                      <button type="button" className="btn-dots-menu" title="Actions">
                                        &bull;&bull;&bull;
                                      </button>

                                      {isMenuActive && (
                                        <div className="item-action-popover" onClick={(e) => e.stopPropagation()}>
                                          <a
                                            href={`/api/drive/download/${file.id}?user_id=${userId}`}
                                            className="action-popover-item"
                                            download
                                          >
                                            Download
                                          </a>
                                          <button
                                            type="button"
                                            className="action-popover-item"
                                            onClick={() => {
                                              setActiveMenuId(null);
                                              setRenameItem(file);
                                              setRenameValue(file.name);
                                            }}
                                          >
                                            Rename
                                          </button>
                                          <button
                                            type="button"
                                            className="action-popover-item"
                                            onClick={() => {
                                              setActiveMenuId(null);
                                              openMoveDialog(file);
                                            }}
                                          >
                                            Move to...
                                          </button>
                                          <button
                                            type="button"
                                            className="action-popover-item item-danger"
                                            onClick={() => {
                                              setActiveMenuId(null);
                                              handleDelete(file);
                                            }}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        /* LIST VIEW */
                        <div className="files-table-wrapper">
                          <table className="drive-table-v2">
                            <thead>
                              <tr>
                                <th className="table-checkbox-th">
                                  <input
                                    type="checkbox"
                                    className="table-checkbox"
                                    checked={files.length > 0 && files.every((f) => selectedIds.has(f.id))}
                                    onChange={handleSelectAll}
                                    title="Select all"
                                  />
                                </th>
                                <th>Name</th>
                                <th>Size</th>
                                <th>Modified</th>
                                <th style={{ textAlign: "right" }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {files.map((file) => {
                                const icon = getFileIcon(file.name);
                                const isMenuActive = activeMenuId === file.id;
                                const isFileSelected = selectedIds.has(file.id);

                                return (
                                  <tr key={file.id} className={isFileSelected ? "table-row-selected" : ""}>
                                    <td className="table-checkbox-td" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        className="table-checkbox"
                                        checked={isFileSelected}
                                        onChange={(e) => toggleSelectItem(file.id, e)}
                                      />
                                    </td>
                                    <td className="table-name-cell">
                                      <span
                                        className="file-mini-badge"
                                        style={{ background: icon.color }}
                                      >
                                        {icon.label}
                                      </span>
                                      <span className="table-item-name" title={file.name}>
                                        {file.name}
                                      </span>
                                      {formatStorageBadge(file) && (
                                        <span className="file-target-tag">
                                          {formatStorageBadge(file)}
                                        </span>
                                      )}
                                    </td>
                                    <td className="table-meta-cell">{formatBytes(file.size)}</td>
                                    <td className="table-meta-cell">{formatDate(file.updated_at || file.created_at)}</td>
                                    <td className="table-actions-cell">
                                      <div className="table-btn-group">
                                        <a
                                          href={`/api/drive/download/${file.id}?user_id=${userId}`}
                                          className="btn-table-action"
                                          title="Download"
                                          download
                                        >
                                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="7 10 12 15 17 10" />
                                            <line x1="12" y1="15" x2="12" y2="3" />
                                          </svg>
                                        </a>

                                        <div
                                          className="item-menu-container"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveMenuId(isMenuActive ? null : file.id);
                                          }}
                                        >
                                          <button type="button" className="btn-dots-menu">
                                            &bull;&bull;&bull;
                                          </button>

                                          {isMenuActive && (
                                            <div className="item-action-popover" onClick={(e) => e.stopPropagation()}>
                                              <button
                                                type="button"
                                                className="action-popover-item"
                                                onClick={() => {
                                                  setActiveMenuId(null);
                                                  setRenameItem(file);
                                                  setRenameValue(file.name);
                                                }}
                                              >
                                                Rename
                                              </button>
                                              <button
                                                type="button"
                                                className="action-popover-item"
                                                onClick={() => {
                                                  setActiveMenuId(null);
                                                  openMoveDialog(file);
                                                }}
                                              >
                                                Move to...
                                              </button>
                                              <button
                                                type="button"
                                                className="action-popover-item item-danger"
                                                onClick={() => {
                                                  setActiveMenuId(null);
                                                  handleDelete(file);
                                                }}
                                              >
                                                Delete
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* FLOATING REAL-TIME UPLOAD PROGRESS TOAST */}
      {uploadProgress.active && (
        <div className="upload-progress-toast" role="status" aria-live="polite">
          <div className="toast-header">
            <div className="toast-title-row">
              <span className="toast-status-icon">
                {uploadProgress.status === "done" ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : uploadProgress.status === "error" ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                )}
              </span>
              <span className="toast-title">
                {uploadProgress.status === "done"
                  ? "Upload Complete"
                  : uploadProgress.status === "error"
                  ? "Upload Failed"
                  : `Uploading ${uploadProgress.fileCount} file${uploadProgress.fileCount === 1 ? "" : "s"}...`}
              </span>
            </div>

            <button
              type="button"
              className="toast-close-btn"
              onClick={() => {
                if (currentUploadXhr.current && uploadProgress.status === "uploading") {
                  currentUploadXhr.current.abort();
                }
                setUploadProgress((prev) => ({ ...prev, active: false }));
              }}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="toast-filename" title={uploadProgress.fileName}>
            {uploadProgress.fileName}
          </div>

          <div className="toast-progress-track">
            <div
              className={`toast-progress-fill ${uploadProgress.status === "done" ? "toast-done" : uploadProgress.status === "error" ? "toast-error" : ""}`}
              style={{ width: `${uploadProgress.status === "error" ? 100 : uploadProgress.percent}%` }}
            />
          </div>

          <div className="toast-footer">
            {uploadProgress.status === "error" ? (
              <span style={{ color: "#ef4444" }}>{uploadProgress.error || "Upload failed."}</span>
            ) : uploadProgress.status === "done" ? (
              <span style={{ color: "#10b981" }}>
                Saved to {systemDrives.find((d) => d.id === storageLocation)?.name || (storageLocation === "all" ? "Cloud Drive" : `${storageLocation} Storage`)}
              </span>
            ) : (
              <>
                <span>{uploadProgress.percent}%</span>
                <span>
                  {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* FLOATING MULTI-SELECT BAR */}
      {selectedIds.size > 0 && (
        <aside className="selection-action-bar" role="toolbar" aria-label="Selection Actions">
          <span className="selection-count-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{selectedIds.size} selected</span>
          </span>

          <div className="selection-actions-group">
            <button
              type="button"
              className="btn-batch-action"
              onClick={handleSelectAll}
              title={selectedIds.size === filteredItems.length ? "Deselect All" : "Select All"}
            >
              <span>{selectedIds.size === filteredItems.length ? "Deselect All" : "Select All"}</span>
            </button>

            <button
              type="button"
              className="btn-batch-action action-download-zip"
              onClick={handleBatchDownloadZip}
              title="Download selected items as a ZIP archive"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download ZIP</span>
            </button>

            <button
              type="button"
              className="btn-batch-action action-download-folder"
              onClick={handleBatchDownloadFolder}
              title="Download selected items directly into a local folder on your computer"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>
              <span>Download as Folder</span>
            </button>

            <button
              type="button"
              className="btn-batch-action action-batch-delete"
              onClick={handleBatchDelete}
              title="Delete selected items"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Delete</span>
            </button>
          </div>

          <button
            type="button"
            className="btn-selection-close"
            onClick={clearSelection}
            title="Clear selection"
          >
            ✕
          </button>
        </aside>
      )}

      {/* FOLDER DOWNLOAD PROGRESS TOAST */}
      {folderDownloadProgress.active && (
        <div className="upload-progress-toast" role="status" aria-live="polite">
          <div className="toast-header">
            <div className="toast-title-row">
              <span className="toast-status-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5">
                  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                </svg>
              </span>
              <span className="toast-title">
                {folderDownloadProgress.status === "done"
                  ? "Download Complete"
                  : folderDownloadProgress.status === "error"
                  ? "Download Failed"
                  : `Saving to Folder: ${folderDownloadProgress.current} / ${folderDownloadProgress.total}`}
              </span>
            </div>

            <button
              type="button"
              className="toast-close-btn"
              onClick={() => setFolderDownloadProgress((p) => ({ ...p, active: false }))}
            >
              ✕
            </button>
          </div>

          <div className="toast-filename" title={folderDownloadProgress.fileName}>
            {folderDownloadProgress.fileName || folderDownloadProgress.message}
          </div>

          <div className="toast-progress-track">
            <div
              className="toast-progress-fill toast-done"
              style={{
                width: `${folderDownloadProgress.status === "error" ? 100 : folderDownloadProgress.percent}%`,
                background: folderDownloadProgress.status === "error" ? "#ef4444" : "#0284c7",
              }}
            />
          </div>

          <div className="toast-footer">
            <span>{folderDownloadProgress.percent}%</span>
            <span>{folderDownloadProgress.message || `${folderDownloadProgress.current} of ${folderDownloadProgress.total} files`}</span>
          </div>
        </div>
      )}

      {/* CONFIRM REMOVE DEVICE MODAL */}
      {confirmRemoveDevice && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 className="modal-title">Remove &ldquo;{confirmRemoveDevice.device_name}&rdquo;?</h3>
            <p className="modal-text">
              This will log out the device from your account. Files stored on that device will remain safe on its local disk, but will no longer appear in your active cloud drive.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setConfirmRemoveDevice(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-solid"
                style={{ background: "#dc2626" }}
                disabled={removingDeviceId !== null}
                onClick={handleConfirmRemoveDevice}
              >
                {removingDeviceId !== null ? "Removing..." : "Remove Device"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STORAGE DRIVE SELECTION MODAL */}
      {showDrivePicker && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 className="modal-title">Select Storage Drive</h3>
            <p className="modal-text">
              Multiple physical drives were detected on your host PC. Choose which drive will store your MyOwnCloud files:
            </p>

            <div className="drive-options-list">
              {systemDrives.map((d) => (
                <label
                  key={d.root_path}
                  className={`drive-option-card ${selectedDriveRoot === d.root_path ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="system_drive"
                    value={d.root_path}
                    checked={selectedDriveRoot === d.root_path}
                    onChange={() => setSelectedDriveRoot(d.root_path)}
                  />
                  <div className="drive-option-info">
                    <span className="drive-name-text">
                      {d.name} ({d.root_path})
                    </span>
                    <span className="drive-free-space">
                      {d.free_space_gb} GB free of {d.total_space_gb} GB
                    </span>
                  </div>
                </label>
              ))}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-solid"
                disabled={savingDrive || !selectedDriveRoot}
                onClick={handleSelectDrive}
              >
                {savingDrive ? "Configuring..." : "Confirm Drive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW FOLDER MODAL */}
      {createFolderOpen && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 className="modal-title">New Folder</h3>
            <form onSubmit={handleCreateFolder}>
              <div className="form-field" style={{ margin: "16px 0" }}>
                <input
                  type="text"
                  placeholder="Folder name"
                  className="field-input"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => {
                    setCreateFolderOpen(false);
                    setNewFolderName("");
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-solid">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RENAME MODAL */}
      {renameItem && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 className="modal-title">Rename {renameItem.type}</h3>
            <form onSubmit={handleRename}>
              <div className="form-field" style={{ margin: "16px 0" }}>
                <input
                  type="text"
                  className="field-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => {
                    setRenameItem(null);
                    setRenameValue("");
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-solid">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MOVE ITEM MODAL */}
      {moveItem && (
        <div className="modal-backdrop">
          <div className="modal-card move-modal-card">
            <h3 className="modal-title">Move &ldquo;{moveItem.name}&rdquo;</h3>
            <p className="modal-text">Select destination disk and folder:</p>

            {/* Step 1: Storage Location / Disk Selector */}
            <div className="move-disk-selector-wrapper">
              <label className="move-section-label">1. Choose Destination Device &amp; Disk</label>
              <div className="move-disk-selector-grouped">
                {systemDevices.length > 0 ? (
                  systemDevices.map((dev) => (
                    <div key={dev.device_name} className="move-device-group-card">
                      <div className="move-device-group-header">
                        <span className="move-device-group-icon">
                          {dev.is_host ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect width="20" height="14" x="2" y="3" rx="2" />
                              <line x1="8" x2="16" y1="21" y2="21" />
                              <line x1="12" x2="12" y1="17" y2="21" />
                            </svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                              <line x1="12" x2="12.01" y1="18" y2="18" />
                            </svg>
                          )}
                        </span>
                        <span className="move-device-group-title">{dev.device_name}</span>
                        <span className={`sidebar-device-tag ${dev.is_host ? "host" : dev.is_online ? "online" : "offline"}`}>
                          {dev.is_host ? "Host PC" : dev.is_online ? "Online" : "Offline"}
                        </span>
                      </div>

                      <div className="move-device-disks-list">
                        {(dev.disks || []).map((disk) => (
                          <button
                            key={disk.id}
                            type="button"
                            className={`move-disk-tab ${moveTargetDisk === disk.id ? "active" : ""}`}
                            onClick={() => handleMoveDiskChange(disk.id)}
                          >
                            <span className="move-disk-tab-icon">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="22" y1="12" x2="2" y2="12" />
                                <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                                <line x1="6" y1="16" x2="6.01" y2="16" />
                                <line x1="10" y1="16" x2="10.01" y2="16" />
                              </svg>
                            </span>
                            <div className="move-disk-tab-info">
                              <span className="move-disk-tab-name">{disk.disk_name}</span>
                              <span className="move-disk-tab-free">{disk.free || "Available"}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="move-device-group-card">
                    <div className="move-device-group-header">
                      <span className="move-device-group-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect width="20" height="14" x="2" y="3" rx="2" />
                          <line x1="8" x2="16" y1="21" y2="21" />
                          <line x1="12" x2="12" y1="17" y2="21" />
                        </svg>
                      </span>
                      <span className="move-device-group-title">Windows PC</span>
                      <span className="sidebar-device-tag host">Host PC</span>
                    </div>
                    <div className="move-device-disks-list">
                      {(systemDrives.length > 0 ? systemDrives : [{ id: "C", disk_name: "Local Disk (C:)", free: "Available" }]).map((disk) => (
                        <button
                          key={disk.id}
                          type="button"
                          className={`move-disk-tab ${moveTargetDisk === disk.id ? "active" : ""}`}
                          onClick={() => handleMoveDiskChange(disk.id)}
                        >
                          <span className="move-disk-tab-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="22" y1="12" x2="2" y2="12" />
                              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                              <line x1="6" y1="16" x2="6.01" y2="16" />
                              <line x1="10" y1="16" x2="10.01" y2="16" />
                            </svg>
                          </span>
                          <div className="move-disk-tab-info">
                            <span className="move-disk-tab-name">{disk.disk_name || disk.name}</span>
                            <span className="move-disk-tab-free">{disk.free || "Available"}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Destination Folder Selector in Selected Disk */}
            <div className="move-folder-section">
              <label className="move-section-label">
                2. Destination Folder in{" "}
                {(() => {
                  const found = systemDrives.find((d) => d.id === moveTargetDisk);
                  return found ? `${found.device_name} - ${found.disk_name}` : moveTargetDisk;
                })()}
              </label>

              <div className="move-folder-list">
                <label className={`move-folder-option ${selectedDestination === "" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="destination"
                    value=""
                    checked={selectedDestination === ""}
                    onChange={() => setSelectedDestination("")}
                  />
                  <span className="folder-icon-tiny">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#64748b" stroke="none">
                      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                    </svg>
                  </span>
                  <span>
                    {(() => {
                      const found = systemDrives.find((d) => d.id === moveTargetDisk);
                      return found ? `${found.device_name} - ${found.disk_name}` : "Target";
                    })()}{" "}
                    (Root / Top Level)
                  </span>
                </label>

                {availableFolders.map((f) => (
                  <label
                    key={f.id}
                    className={`move-folder-option ${selectedDestination === f.relative_path ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="destination"
                      value={f.relative_path}
                      checked={selectedDestination === f.relative_path}
                      onChange={() => setSelectedDestination(f.relative_path)}
                    />
                    <span className="folder-icon-tiny">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#64748b" stroke="none">
                        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                      </svg>
                    </span>
                    <span>{f.relative_path}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setMoveItem(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-solid"
                onClick={handleMove}
              >
                Move here
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UPLOAD DESTINATION SELECTOR MODAL (WHEN IN UNIFIED POOL) */}
      {uploadDestinationPrompt && (
        <div className="modal-backdrop-v2" onClick={() => setUploadDestinationPrompt(null)}>
          <div className="modal-dialog-v2" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-v2">
              <div className="modal-icon-header">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="12" x2="2" y2="12" />
                  <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                  <line x1="6" y1="16" x2="6.01" y2="16" />
                  <line x1="10" y1="16" x2="10.01" y2="16" />
                </svg>
              </div>
              <div>
                <h3>Select Storage Destination</h3>
                <p className="modal-subtitle">Choose which physical disk to store your uploaded file(s) in:</p>
              </div>
            </div>

            <div className="target-selection-grouped">
              {systemDevices.map((dev) => (
                <div key={dev.device_name} className="target-device-group">
                  <div className="target-device-header">
                    <span className="sidebar-device-icon">
                      {dev.is_host ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect width="20" height="14" x="2" y="3" rx="2" />
                          <line x1="8" x2="16" y1="21" y2="21" />
                          <line x1="12" x2="12" y1="17" y2="21" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                          <line x1="12" x2="12.01" y1="18" y2="18" />
                        </svg>
                      )}
                    </span>
                    <span className="target-device-title">{dev.device_name}</span>
                    <span className={`sidebar-device-tag ${dev.is_host ? "host" : dev.is_online ? "online" : "offline"}`}>
                      {dev.is_host ? "Host PC" : dev.is_online ? "Online" : "Offline"}
                    </span>
                  </div>

                  <div className="target-device-disks">
                    {(dev.disks || []).map((disk) => (
                      <button
                        key={disk.id}
                        type="button"
                        className="target-disk-option-btn"
                        onClick={() => {
                          const pending = uploadDestinationPrompt;
                          setUploadDestinationPrompt(null);
                          executeUpload(pending.files, pending.paths, disk.id);
                        }}
                      >
                        <div className="target-option-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="22" y1="12" x2="2" y2="12" />
                            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                            <line x1="6" y1="16" x2="6.01" y2="16" />
                            <line x1="10" y1="16" x2="10.01" y2="16" />
                          </svg>
                        </div>
                        <div className="target-option-details">
                          <span className="target-option-name">{disk.disk_name}</span>
                          <span className="target-option-meta">{disk.free || "Available"}</span>
                        </div>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-footer-v2">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setUploadDestinationPrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

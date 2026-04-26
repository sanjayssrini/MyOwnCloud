"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "../../components/Navbar.js";
import Heartbeat from "../../components/Heartbeat.js";

const USER_ID_KEY = "myowncloud_user_id";
const DEVICE_NAME_KEY = "myowncloud_device_name";

function buildDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "LAN Device";
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${platform} ${suffix}`.replace(/\s+/g, " ").trim();
}

function formatSize(bytes) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function DashboardPage() {
  const router = useRouter();
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [folderPathInput, setFolderPathInput] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [savingDevice, setSavingDevice] = useState(false);

  const userId = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(USER_ID_KEY) || "";
  }, []);

  const refreshData = useCallback(async () => {
    if (!userId) {
      return;
    }

    setError("");
    setRefreshing(true);

    try {
      const response = await fetch(`/api/files?user_id=${encodeURIComponent(userId)}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to load folders and files.");
      }

      setFolders(payload.folders || []);
      setFiles(payload.files || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load folders and files.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    const storedUserId = window.localStorage.getItem(USER_ID_KEY);
    if (!storedUserId) {
      router.replace("/");
      return;
    }

    const storedDeviceName = window.localStorage.getItem(DEVICE_NAME_KEY) || buildDeviceName();
    window.localStorage.setItem(DEVICE_NAME_KEY, storedDeviceName);
    setDeviceName(storedDeviceName);

    refreshData();
  }, [router, refreshData]);

  async function saveDeviceName() {
    const nextName = deviceName.trim();
    if (!nextName) {
      setError("Device name cannot be empty.");
      return;
    }

    setSavingDevice(true);
    setError("");

    try {
      window.localStorage.setItem(DEVICE_NAME_KEY, nextName);
      const response = await fetch("/api/device", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: Number(userId),
          device_name: nextName,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to update device name.");
      }

      await refreshData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update device name.");
    } finally {
      setSavingDevice(false);
    }
  }

  async function addFolder(event) {
    event.preventDefault();
    setError("");

    const trimmedPath = folderPathInput.trim();
    const trimmedDeviceName = deviceName.trim() || "LAN Device";

    if (!trimmedPath) {
      setError("Please provide an absolute folder path from this PC.");
      return;
    }

    setSavingFolder(true);

    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: Number(userId),
          path: trimmedPath,
          device_name: trimmedDeviceName,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to add folder.");
      }

      setFolderPathInput("");
      await refreshData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to add folder.");
    } finally {
      setSavingFolder(false);
    }
  }

  const unavailableCount = folders.filter((folder) => folder.status === "unavailable").length;

  return (
    <main className="page">
      <Navbar />
      <Heartbeat />

      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Your LAN workspace</span>
            <h2>Host, manage, and explore your folders across devices.</h2>
            <p>
              Register any number of local folders from this PC, then access them from other devices on the same network. Update your device name anytime so collaborators can identify this host quickly.
            </p>
          </div>

          <div className="hero-side">
            <div className="stat-card">
              <p className="stat-label">Linked folders</p>
              <p className="stat-value">{folders.length}</p>
            </div>

            <div className="stat-card">
              <p className="stat-label">Available files</p>
              <p className="stat-value">{files.length}</p>
            </div>

            <div className="stat-card">
              <p className="stat-label">Unavailable folders</p>
              <p className="stat-value">{unavailableCount}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="main-grid">
        <div className="card">
          <div className="section-head">
            <div>
              <h3 className="section-title">Host setup</h3>
              <p className="subtle">Enter absolute paths from this PC and add as many folders as you want.</p>
            </div>
          </div>

          <form className="stack-form" onSubmit={addFolder}>
            <div className="split-inputs">
              <div className="field">
                <label className="label" htmlFor="device-name">
                  Device name
                </label>
                <input
                  id="device-name"
                  className="input"
                  type="text"
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                  placeholder="My Laptop"
                  required
                />
              </div>

              <div className="inline-actions align-end">
                <button className="secondary-button" type="button" onClick={saveDeviceName} disabled={savingDevice}>
                  {savingDevice ? "Saving..." : "Save device name"}
                </button>
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="folder-path">
                Folder path on this PC
              </label>
              <input
                id="folder-path"
                className="input"
                type="text"
                value={folderPathInput}
                onChange={(event) => setFolderPathInput(event.target.value)}
                placeholder="C:\\Users\\YourName\\Documents\\ProjectFiles"
                required
              />
            </div>

            <div className="inline-actions">
              <button className="primary-button" type="submit" disabled={savingFolder}>
                {savingFolder ? "Adding..." : "Add folder"}
              </button>
              <button className="secondary-button" type="button" onClick={refreshData} disabled={refreshing}>
                {refreshing ? "Refreshing..." : "Refresh data"}
              </button>
            </div>
          </form>

          {error ? <div className="error-box">{error}</div> : null}
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h3 className="section-title">Registered folders</h3>
              <p className="subtle">Folders remain user-managed. Nothing is auto-created by the app.</p>
            </div>
          </div>

          {loading ? <div className="loading-bar" aria-hidden="true" /> : null}

          {!loading && folders.length === 0 ? (
            <div className="empty-state">No folders added yet. Add your first local folder path to begin sharing files on LAN.</div>
          ) : null}

          {!loading && folders.length > 0 ? (
            <div className="folder-list">
              {folders.map((folder) => (
                <div className="folder-item" key={folder.id}>
                  <div className="folder-item-head">
                    <span className="folder-title">{folder.name}</span>
                    <span className={`status-pill status-${folder.status === "ready" ? "online" : "offline"}`}>
                      {folder.status}
                    </span>
                  </div>
                  <p className="meta">{folder.path}</p>
                  <p className="meta">Host: {folder.device_name}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h3 className="section-title">Files</h3>
              <p className="subtle">Combined view of files from all available registered folders.</p>
            </div>
          </div>

          {loading ? <div className="loading-bar" aria-hidden="true" /> : null}

          {!loading && files.length === 0 ? (
            <div className="empty-state">No files found. Add folders or place files in your existing folders.</div>
          ) : null}

          {!loading && files.length > 0 ? (
            <table className="file-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Folder</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={`${file.folderId}-${file.name}-${file.modifiedAt}`}>
                    <td>
                      <div className="file-name">{file.name}</div>
                    </td>
                    <td className="file-time">{file.folderName}</td>
                    <td className="file-size">{formatSize(file.size)}</td>
                    <td className="file-time">{formatDate(file.modifiedAt)}</td>
                    <td>
                      <div className="file-actions">
                        <Link className="ghost-button" href={file.downloadUrl} prefetch={false}>
                          Download
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </section>
    </main>
  );
}

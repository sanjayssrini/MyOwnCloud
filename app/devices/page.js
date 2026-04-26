"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "../../components/Navbar.js";
import Heartbeat from "../../components/Heartbeat.js";

const USER_ID_KEY = "myowncloud_user_id";
const DEVICE_NAME_KEY = "myowncloud_device_name";

function buildDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "LAN Device";
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${platform} ${suffix}`.replace(/\s+/g, " ").trim();
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    const userId = window.localStorage.getItem(USER_ID_KEY);
    if (!userId) {
      router.replace("/");
      return;
    }

    const savedName = window.localStorage.getItem(DEVICE_NAME_KEY) || buildDeviceName();
    window.localStorage.setItem(DEVICE_NAME_KEY, savedName);
    setDeviceName(savedName);

    let cancelled = false;

    async function loadDevices() {
      try {
        const response = await fetch("/api/device");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Unable to load devices.");
        }

        if (!cancelled) {
          setDevices(payload.devices || []);
          setError("");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load devices.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDevices();
    const intervalId = window.setInterval(loadDevices, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [router]);

  async function saveDeviceName() {
    const userId = Number(window.localStorage.getItem(USER_ID_KEY));
    const trimmedName = deviceName.trim();

    if (!trimmedName) {
      setError("Device name cannot be empty.");
      return;
    }

    setSavingName(true);

    try {
      const response = await fetch("/api/device", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          device_name: trimmedName,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to update device name.");
      }

      window.localStorage.setItem(DEVICE_NAME_KEY, trimmedName);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update device name.");
    } finally {
      setSavingName(false);
    }
  }

  const onlineDevices = devices.filter((device) => device.status === "online").length;
  const offlineDevices = devices.length - onlineDevices;

  return (
    <main className="page">
      <Navbar />
      <Heartbeat />

      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Live device heartbeat</span>
            <h2>Track activity across your local network.</h2>
            <p>
              Device status refreshes every five seconds. Edit your current device name anytime to keep your network view clear and easy to understand.
            </p>
          </div>

          <div className="hero-side">
            <div className="stat-card">
              <p className="stat-label">Online devices</p>
              <p className="stat-value">{onlineDevices}</p>
            </div>

            <div className="stat-card">
              <p className="stat-label">Offline devices</p>
              <p className="stat-value">{offlineDevices}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h3 className="section-title">Current device name</h3>
            <p className="subtle">This name is used by heartbeat updates and folder host metadata.</p>
          </div>
        </div>

        <div className="split-inputs">
          <div className="field">
            <label className="label" htmlFor="device-name-edit">
              Device name
            </label>
            <input
              id="device-name-edit"
              className="input"
              type="text"
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="My Laptop"
            />
          </div>

          <div className="inline-actions align-end">
            <button className="secondary-button" type="button" onClick={saveDeviceName} disabled={savingName}>
              {savingName ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h3 className="section-title">Devices</h3>
            <p className="subtle">Each device becomes offline if it does not report within ten seconds.</p>
          </div>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        {loading ? <div className="loading-bar" aria-hidden="true" /> : null}

        {!loading && !error && devices.length === 0 ? (
          <div className="empty-state">No devices have sent a heartbeat yet.</div>
        ) : null}

        {!loading && devices.length > 0 ? (
          <table className="file-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>User</th>
                <th>Last seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td className="file-name">{device.device_name}</td>
                  <td className="file-time">{device.email}</td>
                  <td className="file-time">{formatTimestamp(device.last_seen)}</td>
                  <td>
                    <span className={`status-pill status-${device.status}`}>{device.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </main>
  );
}

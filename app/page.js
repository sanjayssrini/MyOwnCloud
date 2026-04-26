"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const USER_ID_KEY = "myowncloud_user_id";
const EMAIL_KEY = "myowncloud_email";
const DEVICE_NAME_KEY = "myowncloud_device_name";

function buildDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "LAN Device";
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${platform} ${suffix}`.replace(/\s+/g, " ").trim();
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpToken, setOtpToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [otpHint, setOtpHint] = useState("");
  const [expiresAt, setExpiresAt] = useState(null);

  useEffect(() => {
    const savedUserId = window.localStorage.getItem(USER_ID_KEY);
    const savedEmail = window.localStorage.getItem(EMAIL_KEY);
    const savedDeviceName = window.localStorage.getItem(DEVICE_NAME_KEY) || buildDeviceName();

    if (savedEmail) {
      setEmail(savedEmail);
    }

    setDeviceName(savedDeviceName);

    if (savedUserId) {
      router.replace("/dashboard");
    }
  }, [router]);

  async function requestOtp(event) {
    event.preventDefault();
    setError("");
    setOtpHint("");

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Please enter an email address.");
      return;
    }

    const trimmedDeviceName = deviceName.trim();
    if (!trimmedDeviceName) {
      setError("Please enter a device name.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "request_otp",
          email: trimmedEmail,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to request OTP.");
      }

      setOtpToken(payload.otp_token);
      setOtpHint(payload.otp_code || "");
      setExpiresAt(payload.expires_at || null);
      window.localStorage.setItem(EMAIL_KEY, trimmedEmail);
      window.localStorage.setItem(DEVICE_NAME_KEY, trimmedDeviceName);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to request OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();
    setError("");

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedDeviceName = deviceName.trim();
    const trimmedOtp = otpCode.trim();

    if (!trimmedOtp) {
      setError("Please enter the OTP.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "verify_otp",
          email: trimmedEmail,
          otp_token: otpToken,
          otp_code: trimmedOtp,
          device_name: trimmedDeviceName,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "OTP verification failed.");
      }

      window.localStorage.setItem(USER_ID_KEY, String(payload.user_id));
      window.localStorage.setItem(EMAIL_KEY, payload.email);
      window.localStorage.setItem(DEVICE_NAME_KEY, payload.device_name || trimmedDeviceName);
      router.push("/dashboard");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "OTP verification failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-layout">
        <div className="auth-card">
          <div className="auth-copy">
            <span className="eyebrow">MyOwnCloud (LAN MVP)</span>
            <h1 className="auth-title">Own your files on your own network.</h1>
            <p className="subtle">
              MyOwnCloud lets you map folders from your PC and share them securely inside your local network. Start with OTP login, register folders you want to expose, and explore your private LAN workspace from any connected device.
            </p>
          </div>

          <ul className="feature-list">
            <li>OTP sign-in with no external cloud dependency.</li>
            <li>Add one or many local folders from your host machine.</li>
            <li>Track which devices are active in real time.</li>
          </ul>

          <div className="helper-box">
            <strong>Start in under a minute</strong>
            <p className="meta">
              Set your device name, request an OTP, verify it, and begin adding folders from your PC dashboard.
            </p>
          </div>
        </div>

        <form className="auth-card" onSubmit={otpToken ? verifyOtp : requestOtp}>
          <div>
            <h2 className="section-title">Login with OTP</h2>
            <p className="subtle">Use your email and a one-time code to access your LAN workspace.</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              disabled={Boolean(otpToken)}
            />
          </div>

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

          {otpToken ? (
            <div className="field">
              <label className="label" htmlFor="otp">
                OTP code
              </label>
              <input
                id="otp"
                className="input"
                type="text"
                inputMode="numeric"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value.replace(/\D+/g, "").slice(0, 6))}
                placeholder="Enter 6-digit OTP"
                required
              />
            </div>
          ) : null}

          {otpHint ? (
            <div className="notice-box">
              <strong>Local OTP for MVP:</strong> {otpHint}
              {expiresAt ? <p className="meta">Expires at: {new Date(expiresAt).toLocaleTimeString()}</p> : null}
            </div>
          ) : null}

          {error ? <div className="error-box">{error}</div> : null}

          <div className="inline-actions">
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Working..." : otpToken ? "Verify and continue" : "Send OTP"}
            </button>

            {otpToken ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setOtpToken("");
                  setOtpCode("");
                  setOtpHint("");
                  setExpiresAt(null);
                  setError("");
                }}
              >
                Edit email
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </main>
  );
}

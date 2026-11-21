"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase.js";
import { getOrCreateDeviceToken, getSuggestedDeviceName } from "../lib/device-name.js";
import Logo from "../components/Logo.js";

const USER_ID_KEY = "myowncloud_user_id";
const EMAIL_KEY = "myowncloud_email";
const USER_NAME_KEY = "myowncloud_user_name";
const DEVICE_NAME_KEY = "myowncloud_device_name";

function formatFirebaseError(error) {
  if (!error) return "An unexpected error occurred.";
  const code = error.code || "";
  switch (code) {
    case "auth/operation-not-allowed":
      return "This sign-in method is currently disabled in your Firebase project. Please enable it in Firebase Console → Authentication → Sign-in method.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password. Please verify your credentials.";
    case "auth/email-already-in-use":
      return "This email is already registered. Please sign in instead.";
    case "auth/weak-password":
      return "Password should be at least 6 characters long.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/popup-closed-by-user":
      return "Google sign-in popup was closed before completing.";
    case "auth/popup-blocked":
      return "Mobile Chrome blocked the sign-in popup. Tap the popup icon in Chrome's address bar to allow popups, or use Email & Password below.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Access is temporarily restricted. Please wait a minute.";
    case "auth/network-request-failed":
      return "Network connection error. Please verify your connection.";
    default:
      return error.message || "Authentication failed.";
  }
}

export default function AuthLandingPage() {
  const router = useRouter();

  // Mode: "login" | "signup" | "verify_email" | "forgot_password" | "name_device"
  const [mode, setMode] = useState("login");

  // Form inputs
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newDeviceName, setNewDeviceName] = useState("");
  const [pendingUserSession, setPendingUserSession] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  // Status & feedback
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // Initialize session check
  useEffect(() => {
    let cancelled = false;

    const savedUserId = window.localStorage.getItem(USER_ID_KEY);
    const savedEmail = window.localStorage.getItem(EMAIL_KEY);
    const savedName = window.localStorage.getItem(USER_NAME_KEY);

    if (savedEmail) setEmail(savedEmail);
    if (savedName) setName(savedName);

    // Make sure device token is initialized in this browser
    getOrCreateDeviceToken();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (cancelled) return;
      if (currentUser && currentUser.emailVerified && savedUserId) {
        router.replace("/dashboard");
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [router]);

  // Resend countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Core session synchronization and device checking
  async function handleSessionSync(userEmail, userName, userUid) {
    const deviceToken = getOrCreateDeviceToken();

    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userEmail,
        name: userName,
        uid: userUid,
        device_token: deviceToken,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to initialize local workspace.");
    }

    // Persist core user data
    window.localStorage.setItem(USER_ID_KEY, String(payload.user_id));
    window.localStorage.setItem(EMAIL_KEY, payload.email);
    window.localStorage.setItem(USER_NAME_KEY, payload.name || userName);
    if (auth.currentUser?.photoURL) {
      window.localStorage.setItem("myowncloud_photo_url", auth.currentUser.photoURL);
    }

    // Check if this device is signing in for the first time
    if (payload.is_new_device) {
      // First time on this device: Ask user to name this device
      const suggested = await getSuggestedDeviceName();
      setNewDeviceName(suggested);
      setPendingUserSession({
        userId: payload.user_id,
        email: payload.email,
        name: payload.name || userName,
      });
      setMode("name_device");
      setLoading(false);
      return;
    }

    // Known device: Reuse registered name and redirect immediately
    window.localStorage.setItem(DEVICE_NAME_KEY, payload.device_name || "LAN Device");
    router.replace("/dashboard");
  }

  // Save new device name and proceed
  async function handleSaveNewDevice(event) {
    event.preventDefault();
    setError("");

    const trimmedDeviceName = newDeviceName.trim();
    if (!trimmedDeviceName) {
      setError("Please give this device a name.");
      return;
    }

    const userId = pendingUserSession?.userId || (typeof window !== "undefined" ? window.localStorage.getItem(USER_ID_KEY) : null);
    const email = pendingUserSession?.email || (typeof window !== "undefined" ? window.localStorage.getItem(EMAIL_KEY) : "");
    const name = pendingUserSession?.name || (typeof window !== "undefined" ? window.localStorage.getItem(USER_NAME_KEY) : "");

    if (!userId && !email) {
      router.replace("/");
      return;
    }

    setLoading(true);
    try {
      const deviceToken = getOrCreateDeviceToken();
      const response = await fetch("/api/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId ? Number(userId) : null,
          email: email,
          name: name,
          device_name: trimmedDeviceName,
          device_token: deviceToken,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save device name.");
      }

      window.localStorage.setItem(DEVICE_NAME_KEY, trimmedDeviceName);
      if (payload.user_id) {
        window.localStorage.setItem(USER_ID_KEY, String(payload.user_id));
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save device name.");
      setLoading(false);
    }
  }

  // Email Sign Up
  async function handleSignUp(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setError("Please enter your name.");
      return;
    }
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: trimmedName });
      await sendEmailVerification(user);

      window.localStorage.setItem(USER_NAME_KEY, trimmedName);
      window.localStorage.setItem(EMAIL_KEY, trimmedEmail);

      setUnverifiedEmail(trimmedEmail);
      setMode("verify_email");
      setNotice(`Verification link sent to ${trimmedEmail}.`);
      setResendCooldown(60);
    } catch (err) {
      setError(formatFirebaseError(err));
    } finally {
      setLoading(false);
    }
  }

  // Email Sign In
  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Please enter your email.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      const user = userCredential.user;

      if (!user.emailVerified) {
        setUnverifiedEmail(user.email);
        setMode("verify_email");
        setError("Your email address is not verified yet. Please check your inbox or click resend.");
        return;
      }

      await handleSessionSync(user.email, user.displayName || name || "User", user.uid);
    } catch (err) {
      setError(formatFirebaseError(err));
    } finally {
      setLoading(false);
    }
  }

  // Google Sign-In (Standard Firebase direct popup)
  async function handleGoogleSignIn() {
    setError("");
    setNotice("");
    setLoading(true);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const extractedName = user.displayName || user.email?.split("@")[0] || "User";
      await handleSessionSync(user.email, extractedName, user.uid);
    } catch (err) {
      if (err.code === "auth/popup-closed-by-user") {
        setLoading(false);
        return;
      }
      if (err.code === "auth/unauthorized-domain") {
        const currentHost = typeof window !== "undefined" ? window.location.hostname : "this IP";
        setError(
          `Domain or IP "${currentHost}" is not authorized for Google Sign-In in Firebase Console. Please add "${currentHost}" in Firebase Console → Authentication → Settings → Authorized domains, or use Email & Password sign-in.`
        );
      } else {
        setError(formatFirebaseError(err));
      }
      setLoading(false);
    }
  }

  // Check email verification status
  async function handleCheckVerification() {
    setError("");
    setNotice("");
    setLoading(true);

    try {
      if (!auth.currentUser) {
        setError("Session expired. Please sign in to re-check verification.");
        setMode("login");
        return;
      }

      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        setNotice("Email verified successfully! Loading your drive...");
        await handleSessionSync(
          auth.currentUser.email,
          auth.currentUser.displayName || name || "User",
          auth.currentUser.uid,
        );
      } else {
        setError("Email is not verified yet. Please click the link sent to your email and try again.");
      }
    } catch (err) {
      setError(formatFirebaseError(err));
    } finally {
      setLoading(false);
    }
  }

  // Resend verification email
  async function handleResendVerification() {
    setError("");
    setNotice("");
    if (resendCooldown > 0) return;

    try {
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser);
        setNotice("A fresh verification link has been sent to your email.");
        setResendCooldown(60);
      } else {
        setError("Please sign in again to resend verification.");
      }
    } catch (err) {
      setError(formatFirebaseError(err));
    }
  }

  // Forgot password
  async function handleForgotPassword(event) {
    event.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setNotice(`Password reset email sent to ${trimmedEmail}.`);
    } catch (err) {
      setError(formatFirebaseError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-canvas">
      <div className="landing-wrap">
        {/* Left Column: Product Introduction */}
        <section className="landing-showcase">
          <div className="showcase-header">
            <Logo size={28} showTag={true} href="/" />
          </div>

          <div className="showcase-content">
            <h1 className="showcase-heading">
              Personal cloud storage, hosted on your local network.
            </h1>
            <p className="showcase-description">
              Turn this computer into private network storage. Browse, download, and stream your files from any phone, laptop, or tablet on your Wi-Fi without cloud fees or external bandwidth caps.
            </p>
          </div>

          <div className="feature-list-clean">
            <div className="feature-row">
              <div className="feature-icon-frame">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                  <path d="M12 12v9" />
                  <path d="m8 17 4 4 4-4" />
                </svg>
              </div>
              <div>
                <h4 className="feature-title">Native LAN transfer speeds</h4>
                <p className="feature-desc">Transfer multi-gigabyte folders in seconds directly over your Wi-Fi router.</p>
              </div>
            </div>

            <div className="feature-row">
              <div className="feature-icon-frame">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="14" x="2" y="3" rx="2" />
                  <line x1="8" x2="16" y1="21" y2="21" />
                  <line x1="12" x2="12" y1="17" y2="21" />
                </svg>
              </div>
              <div>
                <h4 className="feature-title">Access from any device</h4>
                <p className="feature-desc">Open the host IP on any device browser to view and download files without installing extra apps.</p>
              </div>
            </div>

            <div className="feature-row">
              <div className="feature-icon-frame">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <div>
                <h4 className="feature-title">Private & authenticated</h4>
                <p className="feature-desc">Secured via Firebase email verification and Google sign-in. Your files stay on your hardware.</p>
              </div>
            </div>
          </div>

          <div className="status-badge-row">
            <span className="status-ping" />
            <span className="status-text">Host ready • Local Network Cloud</span>
          </div>
        </section>

        {/* Right Column: Authentication Card */}
        <section className="landing-auth">
          <div className="auth-panel">
            {mode === "name_device" ? (
              /* First-Time Device Naming Prompt (Only shown once per new device) */
              <form className="auth-form-clean" onSubmit={handleSaveNewDevice}>
                <div className="device-prompt-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="14" x="2" y="3" rx="2" />
                    <line x1="8" x2="16" y1="21" y2="21" />
                    <line x1="12" x2="12" y1="17" y2="21" />
                  </svg>
                </div>

                <div className="panel-head">
                  <h2 className="panel-title">Name this device</h2>
                  <p className="panel-subtitle">
                    We noticed you&apos;re signing in from a new device. Give it a name to recognize it on your local network.
                  </p>
                </div>

                {error ? <div className="notice-banner error-banner">{error}</div> : null}

                <div className="form-field">
                  <label className="field-label" htmlFor="first-time-device-name">
                    Device Name
                  </label>
                  <input
                    id="first-time-device-name"
                    className="field-input"
                    type="text"
                    value={newDeviceName}
                    onChange={(e) => setNewDeviceName(e.target.value)}
                    placeholder="e.g. My Laptop, Living Room iPad"
                    required
                    autoFocus
                  />
                  <span className="field-hint">
                    This name will appear on the dashboard and device list. You can change it anytime.
                  </span>
                </div>

                <button className="btn-solid" type="submit" disabled={loading}>
                  {loading ? "Saving device..." : "Save & Open My Drive"}
                </button>
              </form>
            ) : mode === "verify_email" ? (
              /* Email Verification Screen */
              <div className="verify-container">
                <div className="verify-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </div>

                <div className="verify-head">
                  <h2 className="panel-title">Check your email</h2>
                  <p className="panel-subtitle">
                    We sent a verification link to:
                  </p>
                  <span className="verify-email-chip">{unverifiedEmail || email}</span>
                </div>

                <p className="verify-note">
                  Click the link inside to activate your account. If you do not see it within a minute, please check your <strong>Spam / Junk</strong> folder.
                </p>

                {error ? <div className="notice-banner error-banner">{error}</div> : null}
                {notice ? <div className="notice-banner success-banner">{notice}</div> : null}

                <div className="verify-btn-group">
                  <button
                    className="btn-solid"
                    type="button"
                    onClick={handleCheckVerification}
                    disabled={loading}
                  >
                    {loading ? "Checking..." : "I've Verified My Email"}
                  </button>

                  <button
                    className="btn-outline"
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendCooldown > 0}
                  >
                    {resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : "Resend Verification Email"}
                  </button>

                  <button
                    className="btn-subtle"
                    type="button"
                    onClick={async () => {
                      await signOut(auth);
                      setError("");
                      setNotice("");
                      setMode("login");
                    }}
                  >
                    ← Back to Sign In
                  </button>
                </div>
              </div>
            ) : mode === "forgot_password" ? (
              /* Forgot Password Screen */
              <form className="auth-form-clean" onSubmit={handleForgotPassword}>
                <div className="panel-head">
                  <h2 className="panel-title">Reset password</h2>
                  <p className="panel-subtitle">Enter your account email to receive reset instructions.</p>
                </div>

                {error ? <div className="notice-banner error-banner">{error}</div> : null}
                {notice ? <div className="notice-banner success-banner">{notice}</div> : null}

                <div className="form-field">
                  <label className="field-label" htmlFor="forgot-email">Email Address</label>
                  <input
                    id="forgot-email"
                    className="field-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>

                <button className="btn-solid" type="submit" disabled={loading}>
                  {loading ? "Sending link..." : "Send Reset Link"}
                </button>

                <button
                  className="btn-subtle"
                  type="button"
                  onClick={() => {
                    setError("");
                    setNotice("");
                    setMode("login");
                  }}
                >
                  ← Back to Sign In
                </button>
              </form>
            ) : (
              /* Normal Sign In / Sign Up Flow (NO device name asked upfront!) */
              <div className="auth-flow-main">
                {/* Segmented Control Tabs */}
                <div className="segmented-tabs" role="tablist">
                  <button
                    className={`tab-item ${mode === "login" ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setError("");
                      setNotice("");
                    }}
                  >
                    Sign In
                  </button>
                  <button
                    className={`tab-item ${mode === "signup" ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setMode("signup");
                      setError("");
                      setNotice("");
                    }}
                  >
                    Create Account
                  </button>
                </div>

                <div className="panel-head">
                  <h2 className="panel-title">
                    {mode === "login" ? "Welcome back" : "Create your account"}
                  </h2>
                  <p className="panel-subtitle">
                    {mode === "login"
                      ? "Sign in to manage and explore your local files."
                      : "Set up an account to share folders across your Wi-Fi."}
                  </p>
                </div>

                {error ? <div className="notice-banner error-banner">{error}</div> : null}
                {notice ? <div className="notice-banner success-banner">{notice}</div> : null}

                <form className="auth-form-clean" onSubmit={mode === "login" ? handleLogin : handleSignUp}>
                  {mode === "signup" ? (
                    <div className="form-field">
                      <label className="field-label" htmlFor="signup-name">
                        Your Full Name
                      </label>
                      <input
                        id="signup-name"
                        className="field-input"
                        type="text"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Alex Morgan"
                        required
                      />
                    </div>
                  ) : null}

                  <div className="form-field">
                    <label className="field-label" htmlFor="user-email">Email Address</label>
                    <input
                      id="user-email"
                      className="field-input"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </div>

                  <div className="form-field">
                    <div className="field-label-split">
                      <label className="field-label" htmlFor="user-password">Password</label>
                      {mode === "login" ? (
                        <button
                          className="text-action"
                          type="button"
                          onClick={() => {
                            setError("");
                            setNotice("");
                            setMode("forgot_password");
                          }}
                        >
                          Forgot?
                        </button>
                      ) : null}
                    </div>

                    <div className="input-affix-wrap">
                      <input
                        id="user-password"
                        className="field-input"
                        type={showPassword ? "text" : "password"}
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={mode === "login" ? "••••••••" : "Minimum 6 characters"}
                        required
                      />
                      <button
                        className="affix-btn"
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  {mode === "signup" ? (
                    <div className="form-field">
                      <label className="field-label" htmlFor="confirm-pass">Confirm Password</label>
                      <input
                        id="confirm-pass"
                        className="field-input"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        required
                      />
                    </div>
                  ) : null}

                  <button className="btn-solid" type="submit" disabled={loading}>
                    {loading
                      ? mode === "login" ? "Signing In..." : "Creating Account..."
                      : mode === "login" ? "Sign In" : "Create Account"}
                  </button>
                </form>

                {/* Divider */}
                <div className="clean-divider">
                  <span>or continue with</span>
                </div>

                {/* Google Sign-In with official Google G Icon */}
                <button
                  className="btn-google"
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                >
                  <svg className="google-svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>

                <div className="panel-footer">
                  {mode === "login" ? (
                    <p>
                      Don&apos;t have an account?{" "}
                      <button
                        className="text-action font-semibold"
                        type="button"
                        onClick={() => {
                          setMode("signup");
                          setError("");
                          setNotice("");
                        }}
                      >
                        Sign up
                      </button>
                    </p>
                  ) : (
                    <p>
                      Already have an account?{" "}
                      <button
                        className="text-action font-semibold"
                        type="button"
                        onClick={() => {
                          setMode("login");
                          setError("");
                          setNotice("");
                        }}
                      >
                        Sign in
                      </button>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

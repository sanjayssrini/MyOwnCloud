"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ProfileDropdown({ onOpenDevices }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPhoto, setUserPhoto] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    const savedName = window.localStorage.getItem("myowncloud_user_name") || "";
    const savedEmail = window.localStorage.getItem("myowncloud_email") || "";
    const savedPhoto = window.localStorage.getItem("myowncloud_photo_url") || "";

    setUserName(savedName);
    setUserEmail(savedEmail);
    setUserPhoto(savedPhoto);

    // Also check active Firebase auth user if available
    import("../lib/firebase.js").then(({ auth }) => {
      if (auth.currentUser) {
        if (auth.currentUser.displayName) setUserName(auth.currentUser.displayName);
        if (auth.currentUser.email) setUserEmail(auth.currentUser.email);
        if (auth.currentUser.photoURL) setUserPhoto(auth.currentUser.photoURL);
      }
    });
  }, []);

  // Close on outside click or Escape
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleLogout() {
    setIsOpen(false);
    try {
      const { signOut } = await import("firebase/auth");
      const { auth } = await import("../lib/firebase.js");
      await signOut(auth);
    } catch {
      // Ignored
    }

    window.localStorage.removeItem("myowncloud_user_id");
    window.localStorage.removeItem("myowncloud_user_name");
    window.localStorage.removeItem("myowncloud_email");
    window.localStorage.removeItem("myowncloud_photo_url");
    router.replace("/");
  }

  const initial = (userName || userEmail || "U").charAt(0).toUpperCase();

  return (
    <div className="profile-dropdown-wrapper" ref={dropdownRef}>
      <button
        className="profile-avatar-btn"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title={userName || userEmail || "Account"}
      >
        {userPhoto ? (
          <img src={userPhoto} alt={userName || "Profile"} className="profile-avatar-img" />
        ) : (
          <span className="profile-avatar-initial">{initial}</span>
        )}
      </button>

      {isOpen && (
        <div className="profile-menu-popover" role="menu">
          {/* User Profile Card */}
          <div className="profile-menu-header">
            <div className="profile-menu-avatar-large">
              {userPhoto ? (
                <img src={userPhoto} alt={userName || "Profile"} />
              ) : (
                <span>{initial}</span>
              )}
            </div>
            <div className="profile-menu-info">
              <h4 className="profile-menu-name">{userName || "User"}</h4>
              <p className="profile-menu-email">{userEmail || "Signed in"}</p>
            </div>
          </div>

          <div className="profile-menu-divider" />

          {/* Manage Devices Option */}
          {onOpenDevices ? (
            <button
              type="button"
              className="profile-menu-item"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onOpenDevices();
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
              <span>Manage Devices</span>
            </button>
          ) : (
            <Link
              href="/dashboard?section=devices"
              className="profile-menu-item"
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
              <span>Manage Devices</span>
            </Link>
          )}

          <div className="profile-menu-divider" />

          {/* Logout Option */}
          <button
            className="profile-menu-item profile-menu-logout"
            role="menuitem"
            type="button"
            onClick={handleLogout}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" x2="9" y1="12" y2="12" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      )}
    </div>
  );
}

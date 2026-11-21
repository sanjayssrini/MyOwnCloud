"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ProfileDropdown from "./ProfileDropdown.js";
import Logo from "./Logo.js";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <div className="brand">
        <Logo size={24} showTag={true} href="/dashboard" />
      </div>

      <nav className="nav-links" aria-label="Primary" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <Link className={`nav-link ${pathname === "/dashboard" ? "active" : ""}`} href="/dashboard">
          My Drive
        </Link>
        <Link className={`nav-link ${pathname === "/devices" ? "active" : ""}`} href="/dashboard?section=devices">
          Devices
        </Link>
        <ProfileDropdown />
      </nav>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <div className="brand">
        <h1>MyOwnCloud</h1>
        <p>LAN-only cloud storage MVP</p>
      </div>

      <nav className="nav-links" aria-label="Primary">
        <Link className={`nav-link ${pathname === "/dashboard" ? "active" : ""}`} href="/dashboard">
          Dashboard
        </Link>
        <Link className={`nav-link ${pathname === "/devices" ? "active" : ""}`} href="/devices">
          Devices
        </Link>
      </nav>
    </header>
  );
}

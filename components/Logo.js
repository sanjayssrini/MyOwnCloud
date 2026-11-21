"use client";

import Link from "next/link";

export default function Logo({ size = 26, showTag = true, href = "/dashboard", className = "" }) {
  const content = (
    <div className={`brand-logo-unified ${className}`} style={{ display: "inline-flex", alignItems: "center", gap: "10px", textDecoration: "none" }}>
      <div
        className="brand-logo-icon-badge"
        style={{
          width: `${size + 12}px`,
          height: `${size + 12}px`,
          borderRadius: "10px",
          background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          boxShadow: "0 2px 8px rgba(37, 99, 235, 0.25)",
          flexShrink: 0,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      </div>
      <div className="brand-logo-text-block">
        <span
          className="brand-logo-title"
          style={{
            fontSize: "1.2rem",
            fontWeight: 700,
            color: "#0f172a",
            letterSpacing: "-0.02em",
            display: "block",
            lineHeight: 1.15,
          }}
        >
          MyOwnCloud
        </span>
        {showTag && (
          <span
            className="brand-logo-subtitle"
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              color: "#2563eb",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              display: "block",
              marginTop: "2px",
            }}
          >
            Local Storage
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        {content}
      </Link>
    );
  }

  return content;
}

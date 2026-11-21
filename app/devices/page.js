"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DevicesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard?section=devices");
  }, [router]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f8fafc" }}>
      <p style={{ color: "#64748b", fontSize: "0.95rem" }}>Loading Manage Devices...</p>
    </div>
  );
}

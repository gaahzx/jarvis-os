"use client";

import dynamic from "next/dynamic";

// Dashboard importado dinamicamente para evitar SSR com Three.js / ReactFlow
const Dashboard = dynamic(() => import("@/components/Dashboard"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#020b14",
        color: "#00d4ff",
        fontFamily: "'Orbitron', monospace",
        fontSize: "12px",
        letterSpacing: "0.2em",
        flexDirection: "column",
        gap: "20px",
      }}
    >
      <div style={{ fontSize: "28px", opacity: 0.6 }}>J.A.R.V.I.S.</div>
      <div
        style={{
          width: "60px",
          height: "2px",
          background: "linear-gradient(90deg, transparent, #00d4ff, transparent)",
          animation: "none",
        }}
      />
      <div style={{ opacity: 0.4, fontSize: "10px" }}>INICIALIZANDO SISTEMA...</div>
    </div>
  ),
});

export default function Page() {
  return <Dashboard />;
}

import React from "react";

const RED = "#E30613";

export default function Spinner({ text = "Carregant…" }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", zIndex: 9999, gap: 20,
    }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", border: "5px solid rgba(255,255,255,.2)", borderTop: `5px solid ${RED}`, animation: "spin .85s linear infinite" }} />
      <div style={{ color: "#fff", fontWeight: 700, fontSize: 17, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "1px" }}>{text}</div>
    </div>
  );
}

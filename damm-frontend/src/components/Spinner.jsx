import React from "react";
import { DAMM_RED } from "../App";

export default function Spinner({ text = "Carregant…" }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", zIndex: 9999, gap: 20,
    }}>
      <div style={{ fontSize: 52 }}>🍺</div>
      <div style={{ width: 52, height: 52, borderRadius: "50%", border: "5px solid rgba(255,255,255,.2)", borderTop: `5px solid ${DAMM_RED}`, animation: "spin .85s linear infinite" }} />
      <div style={{ color: "#fff", fontWeight: 700, fontSize: 17 }}>{text}</div>
    </div>
  );
}

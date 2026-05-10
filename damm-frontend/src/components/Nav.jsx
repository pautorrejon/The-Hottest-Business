import React from "react";
import { NavLink } from "react-router-dom";
import { DAMM_RED } from "../App";

export default function Nav({ routeId, clearRoute }) {
  const base = {
    padding: "7px 18px", borderRadius: 6, textDecoration: "none",
    fontWeight: 700, fontSize: 13, transition: "all .15s",
  };
  const act   = { ...base, color: "#fff", background: DAMM_RED };
  const inact = { ...base, color: DAMM_RED, background: "rgba(255,255,255,.15)", border: `1.5px solid ${DAMM_RED}` };

  return (
    <nav style={{ background: "#1a1a1a", padding: "0 20px", display: "flex", alignItems: "center", gap: 10, height: 48 }}>
      <span style={{ color: "#fff", fontWeight: 800, fontSize: 16, marginRight: 12, letterSpacing: -.3 }}>
        🍺 Damm Smart Truck
      </span>
      <NavLink to="/orders"    style={({ isActive }) => isActive ? act : inact}>📋 Comandes</NavLink>
      <NavLink to="/warehouse" style={({ isActive }) => isActive ? act : inact}>🏭 Magatzem</NavLink>
      <NavLink to="/driver"    style={({ isActive }) => isActive ? act : inact}>🚚 Conductor</NavLink>
      {routeId && (
        <>
          <span style={{ color: "#555", fontSize: 12, marginLeft: 8 }}>Ruta: <code style={{ color: "#aaa" }}>{routeId}</code></span>
          <button onClick={clearRoute} style={{ marginLeft: "auto", background: "transparent", border: "1px solid #555", color: "#aaa", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>
            ✕ Esborrar ruta
          </button>
        </>
      )}
      <span style={{ marginLeft: routeId ? 0 : "auto", color: "#555", fontSize: 11 }}>Interhack BCN 2026</span>
    </nav>
  );
}

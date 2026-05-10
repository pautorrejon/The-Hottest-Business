import React from "react";
import { NavLink } from "react-router-dom";

const RED = "#E30613";

export default function Nav({ routeId, clearRoute }) {
  const base = {
    padding: "7px 18px", borderRadius: 6, textDecoration: "none",
    fontWeight: 700, fontSize: 13, transition: "all .15s",
    fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px",
  };
  const act   = { ...base, color: "#fff", background: RED };
  const inact = { ...base, color: RED, background: "rgba(255,255,255,.15)", border: `1.5px solid ${RED}` };

  return (
    <nav style={{ background: "#1a1a1a", padding: "0 20px", display: "flex", alignItems: "center", gap: 10, height: 48 }}>
      <span style={{ color: "#fff", fontWeight: 900, fontSize: 18, marginRight: 12, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "2px" }}>
        DAMMLOAD
      </span>
      <NavLink to="/orders"    style={({ isActive }) => isActive ? act : inact}>COMANDES</NavLink>
      <NavLink to="/warehouse" style={({ isActive }) => isActive ? act : inact}>MAGATZEM</NavLink>
      <NavLink to="/driver"    style={({ isActive }) => isActive ? act : inact}>CONDUCTOR</NavLink>
      {routeId && (
        <>
          <span style={{ color: "#555", fontSize: 12, marginLeft: 8 }}>Ruta: <code style={{ color: "#aaa" }}>{routeId}</code></span>
          <button onClick={clearRoute} style={{ marginLeft: "auto", background: "transparent", border: "1px solid #555", color: "#aaa", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>
            x Esborrar ruta
          </button>
        </>
      )}
    </nav>
  );
}

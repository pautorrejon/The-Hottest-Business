import React, { useState, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import Orders from "./views/Orders";
import Warehouse from "./views/Warehouse";
import Driver from "./views/Driver";

export const DAMM_RED = "#E30613";

const LS_KEY = "damm_route_id";
const LS_VEHICLE_KEY = "damm_vehicle_type";
const today = new Date().toLocaleDateString("ca-ES", { day: "2-digit", month: "long", year: "numeric" });

function Toast({ msg }) {
  return (
    <div style={{
      position: "fixed", top: 56, right: 16, zIndex: 9999,
      background: "#2ecc71", color: "#fff", borderRadius: 10,
      padding: "12px 20px", fontWeight: 700, fontSize: 14,
      boxShadow: "0 4px 20px rgba(0,0,0,.5)",
      animation: "toast-in .35s ease",
    }}>
      {msg}
    </div>
  );
}

function Header({ onReset }) {
  const navStyle = ({ isActive }) => ({
    color: isActive ? "#fff" : "rgba(255,255,255,.55)",
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700, fontSize: 15, letterSpacing: "0.5px",
    textDecoration: "none", padding: "4px 0",
    borderBottom: isActive ? "2px solid rgba(255,255,255,.8)" : "2px solid transparent",
    transition: "all .2s",
  });
  return (
    <header style={{
      background: "#E30613", height: 48,
      display: "flex", alignItems: "center",
      padding: "0 20px", gap: 16, flexShrink: 0,
      position: "sticky", top: 0, zIndex: 1000,
      boxShadow: "0 2px 12px rgba(0,0,0,.4)",
    }}>
      <span style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 900, fontSize: 24, color: "#fff", letterSpacing: "2px", whiteSpace: "nowrap",
      }}>
        DAMMLOAD
      </span>
      <div style={{ flex: 1, display: "flex", gap: 24, alignItems: "center", paddingLeft: 20 }}>
        <NavLink to="/orders"    style={navStyle}>COMANDES</NavLink>
        <NavLink to="/warehouse" style={navStyle}>MAGATZEM</NavLink>
        <NavLink to="/driver"    style={navStyle}>CONDUCTOR</NavLink>
      </div>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "rgba(255,255,255,.55)", whiteSpace: "nowrap" }}>
        {today}
      </span>
      <button onClick={onReset} style={{
        background: "rgba(0,0,0,.25)", color: "#fff", border: "1px solid rgba(255,255,255,.3)",
        borderRadius: 6, padding: "5px 14px", fontWeight: 700, fontSize: 12,
        cursor: "pointer", fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px",
        whiteSpace: "nowrap",
      }}>
        ↺ RESET DEMO
      </button>
    </header>
  );
}

function AppInner({ routeId, vehicleType, saveRoute, onResetFn, resetKey, toast }) {
  const navigate = useNavigate();
  const handleReset = useCallback(() => onResetFn(navigate), [navigate, onResetFn]);
  return (
    <div style={{ minHeight: "100vh", background: "#0f0f0f" }}>
      <Header onReset={handleReset} />
      {toast && <Toast msg={toast} />}
      <Routes>
        <Route path="/" element={<Navigate to={routeId ? "/warehouse" : "/orders"} replace />} />
        <Route path="/orders"    element={<Orders key={resetKey} onRouteReady={saveRoute} />} />
        <Route path="/warehouse" element={routeId ? <Warehouse routeId={routeId} vehicleType={vehicleType} /> : <Navigate to="/orders" replace />} />
        <Route path="/driver"    element={routeId ? <Driver    routeId={routeId} vehicleType={vehicleType} /> : <Navigate to="/orders" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  const [routeId,     setRouteId]     = useState(() => localStorage.getItem(LS_KEY));
  const [vehicleType, setVehicleType] = useState(() => localStorage.getItem(LS_VEHICLE_KEY) || "camio_8");
  const [resetKey,    setResetKey]    = useState(0);
  const [toast,       setToast]       = useState(null);

  function saveRoute(id, vtype) {
    localStorage.setItem(LS_KEY, id);
    setRouteId(id);
    if (vtype) {
      localStorage.setItem(LS_VEHICLE_KEY, vtype);
      setVehicleType(vtype);
    }
  }

  const onResetFn = useCallback((navigate) => {
    localStorage.clear();
    setRouteId(null);
    setVehicleType("camio_8");
    setResetKey(k => k + 1);
    setToast("Demo reiniciat ✓");
    setTimeout(() => setToast(null), 3000);
    navigate("/orders");
  }, []);

  return (
    <BrowserRouter>
      <AppInner
        routeId={routeId}
        vehicleType={vehicleType}
        saveRoute={saveRoute}
        onResetFn={onResetFn}
        resetKey={resetKey}
        toast={toast}
      />
    </BrowserRouter>
  );
}

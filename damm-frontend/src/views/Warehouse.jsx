import React, { useState, useEffect, useCallback } from "react";
import { getWarehouse, putStop } from "../api";

const RED = "#E30613";
const MAX_KG = 8000;
const today = new Date().toLocaleDateString("ca-ES", { day: "2-digit", month: "long", year: "numeric" });

const VEHICLE_INFO = {
  furgoneta: { name: "Furgoneta",  emoji: "🚐", color: "#5c6bc0", cols: 2, lanes: 1 },
  camio_6:   { name: "Camió 6 t", emoji: "🚛", color: "#ef6c00", cols: 3, lanes: 2 },
  camio_8:   { name: "Camió 8 t", emoji: "🚚", color: "#E30613", cols: 4, lanes: 2 },
};

function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  utter.voice = voices.find(v => v.lang === "ca-ES") || voices.find(v => v.lang.startsWith("es")) || null;
  utter.lang = utter.voice?.lang ?? "ca-ES";
  utter.rate = 0.88; utter.pitch = 1.05;
  window.speechSynthesis.speak(utter);
}

const PEDESTRIAN_STRIPE = "repeating-linear-gradient(45deg, rgba(243,156,18,.18) 0px, rgba(243,156,18,.18) 6px, transparent 6px, transparent 14px)";

/* ── Proportional truck diagram ─────────────────────────────────────────────── */
function TruckLaneDiagram({ zones, vehicleType, checkedSet, highlightIdx }) {
  const vInfo = VEHICLE_INFO[vehicleType] || VEHICLE_INFO.camio_8;
  const { lanes } = vInfo;

  /* Compute total cm span; fall back to boxes_n proportions when no dimension data */
  const totalCm = zones.reduce((s, z) => s + Math.max(0, (z.zone_x_end ?? 0) - (z.zone_x_start ?? 0)), 0);
  const totalBoxes = zones.reduce((s, z) => s + (z.boxes_n || 1), 0);

  function getWidth(zone) {
    if (totalCm > 0) {
      const cm = Math.max(0, (zone.zone_x_end ?? 0) - (zone.zone_x_start ?? 0));
      return Math.max(5, (cm / totalCm) * 100) + "%";
    }
    /* Fallback: proportional to box count */
    return Math.max(5, ((zone.boxes_n || 1) / Math.max(totalBoxes, 1)) * 100) + "%";
  }

  return (
    <div style={{ background: "#111", borderRadius: 10, overflow: "hidden", border: "1px solid #222" }}>
      <div style={{ display: "flex", alignItems: "stretch", minHeight: lanes === 1 ? 90 : 140 }}>
        {/* Cabin */}
        <div style={{
          width: 56, background: "#1a1a1a", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 28, borderRight: "2px solid #333", flexShrink: 0,
        }}>
          🚛
        </div>

        {/* Cargo area: proportional zones */}
        <div style={{ flex: 1, padding: 6, display: "flex", flexDirection: "column", gap: 4, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", gap: 3, alignItems: "stretch" }}>
            {zones.map((zone, i) => {
              const isHighlighted = i === highlightIdx;
              const isChecked = checkedSet.has(zone.client_nom);
              return (
                <div key={i} style={{
                  width: getWidth(zone),
                  flexShrink: 0,
                  background: zone.color ?? "#2a2a2a",
                  border: isHighlighted ? `2px solid ${RED}` : "1px solid #2a2a2a",
                  borderRadius: 5,
                  opacity: isChecked ? 0.35 : 1,
                  position: "relative",
                  overflow: "hidden",
                  transition: "opacity .3s",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  padding: "4px 5px",
                  minWidth: 0,
                }}>
                  {/* Pedestrian striped overlay */}
                  {zone.is_pedestrian && (
                    <div style={{
                      position: "absolute", inset: 0,
                      background: PEDESTRIAN_STRIPE,
                      pointerEvents: "none",
                    }} />
                  )}
                  {/* Client name */}
                  <div style={{
                    fontSize: 8, color: "rgba(255,255,255,.92)", fontWeight: 700,
                    lineHeight: 1.2, fontFamily: "'DM Mono', monospace",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    position: "relative",
                  }}>
                    {zone.client_nom?.split(" ")[0]}
                  </div>
                  {/* Stats */}
                  <div style={{
                    fontSize: 7, color: "rgba(255,255,255,.6)",
                    fontFamily: "'DM Mono', monospace", lineHeight: 1.4,
                    position: "relative",
                  }}>
                    {zone.boxes_n != null && <div>{zone.boxes_n} CAJ</div>}
                    {zone.weight_kg != null && <div>{zone.weight_kg} kg</div>}
                    {zone.is_pedestrian && <div>🚶</div>}
                  </div>
                  {/* Highlight pulse */}
                  {isHighlighted && (
                    <div style={{
                      position: "absolute", inset: 0,
                      border: `2px solid ${RED}`, borderRadius: 5,
                      animation: "pulse 1.5s infinite",
                    }} />
                  )}
                </div>
              );
            })}
          </div>
          {/* Direction labels */}
          <div style={{
            display: "flex", justifyContent: "space-between",
            fontSize: 9, color: "#444", padding: "2px 0",
            fontFamily: "'DM Mono', monospace",
          }}>
            <span>← FONS</span>
            <span>PORTA →</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */
export default function Warehouse({ routeId, vehicleType = "camio_8" }) {
  const [data,    setData]    = useState(null);
  const [checked, setChecked] = useState({});
  const [stepIdx, setStepIdx] = useState(0);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!routeId) return;
    getWarehouse(routeId).then(setData).catch(e => setError(e.message));
  }, [routeId]);

  const loadingOrder = data?.loading_order ?? [];

  const handleCheck = useCallback((stop) => {
    setChecked(prev => {
      const next = !prev[stop.client_nom];
      putStop(stop.delivery_order, "carregat").catch(console.warn);
      return { ...prev, [stop.client_nom]: next };
    });
  }, []);

  const advance = () => {
    const stop = loadingOrder[stepIdx];
    if (stop && !checked[stop.client_nom]) handleCheck(stop);
    if (stepIdx + 1 < loadingOrder.length) setStepIdx(stepIdx + 1);
  };

  function handleVoice() {
    const stop = loadingOrder[stepIdx];
    if (!stop) { speakText("Tots els clients han estat carregats. El camió pot sortir."); return; }
    const text = `Pas ${stepIdx + 1} de ${loadingOrder.length}. Carrega ${stop.client_nom}. ` +
      `Zona X ${stop.zone_x_start} a ${stop.zone_x_end} centímetres. ` +
      `${stop.boxes_n} caixes, ${stop.weight_kg} quilograms.` +
      (stop.is_pedestrian ? ` Atenció: zona de vianants.` : "");
    speakText(text);
  }

  if (error) return <ErrBox msg={error} />;
  if (!data)  return <div style={{ padding: 32, color: "#888" }}>Carregant dades…</div>;

  const vInfo     = VEHICLE_INFO[vehicleType] || VEHICLE_INFO.camio_8;
  const checkedSet = new Set(Object.keys(checked).filter(k => checked[k]));
  const loadedKg   = loadingOrder.filter(s => checked[s.client_nom]).reduce((a, s) => a + s.weight_kg, 0);
  const pct        = Math.min(100, (loadedKg / MAX_KG) * 100);
  const axleF      = data.axle_front_kg ?? 0;
  const axleR      = data.axle_rear_kg  ?? 0;
  const axleWarn   = data.axle_warning  ?? false;
  const currentStop = loadingOrder[stepIdx];
  const allDone    = loadingOrder.every(s => checked[s.client_nom]);

  const zones = loadingOrder.map(s => ({
    client_nom:    s.client_nom,
    zone_x_start:  s.zone_x_start,
    zone_x_end:    s.zone_x_end,
    color:         s.zone_color,
    boxes_n:       s.boxes_n,
    weight_kg:     s.weight_kg,
    is_pedestrian: s.is_pedestrian ?? false,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)", overflow: "hidden", background: "#0f0f0f" }}>

      {/* ── Main row ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* LEFT 55%: truck diagram + axles */}
        <div style={{ width: "55%", display: "flex", flexDirection: "column", padding: "16px 20px", gap: 14, overflow: "hidden", borderRight: "1px solid #1a1a1a" }}>

          {/* Badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              background: vInfo.color, color: "#fff", borderRadius: 6, padding: "3px 14px",
              fontWeight: 900, fontSize: 14, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px",
            }}>
              {vInfo.emoji} {vInfo.name}
            </span>
            <span style={{ fontSize: 12, color: "#555" }}>
              {data.efficiency_pct ?? "—"}% eficiència ·{" "}
              <code style={{ color: RED, fontFamily: "'DM Mono', monospace" }}>{routeId}</code>
            </span>
          </div>

          {/* Truck lane diagram */}
          <TruckLaneDiagram
            zones={zones}
            vehicleType={vehicleType}
            checkedSet={checkedSet}
            highlightIdx={stepIdx}
          />

          {/* Axle bars */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <AxleBar label="Eix davanter" kg={axleF} />
            <AxleBar label="Eix posterior" kg={axleR} />
          </div>
          {axleWarn && (
            <div style={{ background: "#1a0a00", border: "1.5px solid #f39c12", borderRadius: 8, padding: "8px 12px", color: "#f39c12", fontSize: 12, fontWeight: 700 }}>
              ⚠️ ATENCIÓ: Sobrecàrrega en algun eix! Redistribueix el pes.
            </div>
          )}
        </div>

        {/* RIGHT 45%: picking list */}
        <div style={{ width: "45%", display: "flex", flexDirection: "column", background: "#0f0f0f", overflow: "hidden" }}>

          {/* Header */}
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #1a1a1a" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 14, color: "#f0f0f0", fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "1px" }}>
                  FULL DE PICKING
                </div>
                <div style={{ fontSize: 11, color: "#555", fontFamily: "'DM Mono', monospace" }}>{today}</div>
              </div>
              <button onClick={() => window.print()} style={{
                background: "none", border: "1px solid #333", color: "#666",
                borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer",
              }}>
                🖨 Imprimir
              </button>
            </div>

            {/* Progress bar */}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", marginBottom: 4 }}>
                <span>Pas {Math.min(stepIdx + 1, loadingOrder.length)} de {loadingOrder.length}</span>
                <span style={{ color: "#f0f0f0" }}>{checkedSet.size}/{loadingOrder.length} carregats</span>
              </div>
              <div style={{ background: "#1a1a1a", borderRadius: 4, height: 4 }}>
                <div style={{ width: `${(checkedSet.size / Math.max(loadingOrder.length, 1)) * 100}%`, background: RED, height: 4, borderRadius: 4, transition: "width .4s" }} />
              </div>
            </div>
          </div>

          {/* Current step card */}
          {currentStop && !allDone && (
            <div style={{ margin: "10px 12px 0", background: "#1a1a1a", borderRadius: 10, padding: "12px", border: `2px solid ${RED}`, flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: RED, fontWeight: 700, marginBottom: 4, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "1px" }}>
                CARREGA ARA — PAS {stepIdx + 1}
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2, color: "#f0f0f0" }}>{currentStop.client_nom}</div>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>{currentStop.adresa}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ background: "#111", color: "#888", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
                  X: {currentStop.zone_x_start}–{currentStop.zone_x_end} cm
                </span>
                <span style={{ background: "#111", color: "#888", borderRadius: 20, padding: "2px 10px", fontSize: 11 }}>
                  {currentStop.boxes_n} caixes · {currentStop.weight_kg} kg
                </span>
                {currentStop.is_pedestrian && (
                  <span style={{ background: "#f39c12", color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>
                    🚶 Vianants
                  </span>
                )}
              </div>
              <button onClick={advance} style={{
                width: "100%", padding: "9px 0", background: RED, color: "#fff",
                border: "none", borderRadius: 7, fontWeight: 900, fontSize: 13, cursor: "pointer",
                fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "1px",
              }}>
                ✓ CARREGAT — {stepIdx + 1 < loadingOrder.length ? "SEGÜENT →" : "FINALITZAR"}
              </button>
            </div>
          )}

          {allDone && (
            <div style={{ margin: "10px 12px 0", background: "#0d1f0d", border: "2px solid #2ecc71", borderRadius: 10, padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
              <div style={{ fontWeight: 900, fontSize: 16, color: "#2ecc71", fontFamily: "'Barlow Condensed', sans-serif" }}>CÀRREGA COMPLETADA</div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>El camió pot sortir cap a ruta</div>
            </div>
          )}

          {/* Checklist */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            {/* Zone dividers + check cards */}
            {loadingOrder.map((stop, i) => (
              <React.Fragment key={stop.client_nom}>
                {/* Zone divider */}
                <div style={{
                  background: stop.zone_color + "22",
                  borderLeft: `3px solid ${stop.zone_color}`,
                  padding: "4px 8px", marginBottom: 4, marginTop: i > 0 ? 10 : 0,
                  fontSize: 10, fontWeight: 700, color: "#888",
                  fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "1px",
                }}>
                  ZONA {stop.loading_seq} — {stop.client_nom}
                  {stop.is_pedestrian && <span style={{ marginLeft: 6, color: "#f39c12" }}>🚶 VIANANTS</span>}
                </div>

                {/* Products for this client */}
                {(stop.products ?? []).slice(0, 5).map((p, pi) => (
                  <div key={pi} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 8px", fontSize: 11, color: "#888",
                    borderBottom: "1px solid #111",
                  }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", color: "#555", fontSize: 10, flexShrink: 0, width: 40 }}>{p.codi?.slice(0, 6)}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nom}</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", color: RED, fontWeight: 700, flexShrink: 0 }}>{p.quantitat} {p.unitat}</span>
                  </div>
                ))}
                {(stop.products ?? []).length > 5 && (
                  <div style={{ fontSize: 10, color: "#444", padding: "2px 8px" }}>+ {stop.products.length - 5} productes més</div>
                )}

                {/* Service time estimate */}
                <div style={{ padding: "3px 8px 4px", fontSize: 10, color: "#444", fontFamily: "'DM Mono', monospace" }}>
                  ⏱ ~{Math.max(3, Math.round(5 + stop.boxes_n * 0.5))} min estimats
                </div>

                {/* Check card */}
                <CheckCard
                  stop={stop}
                  isChecked={!!checked[stop.client_nom]}
                  isActive={i === stepIdx}
                  onCheck={() => handleCheck(stop)}
                  onClick={() => setStepIdx(i)}
                />
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div style={{ background: "#111", borderTop: "1px solid #1a1a1a", padding: "9px 20px", display: "flex", alignItems: "center", gap: 20, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#555", fontSize: 11, marginBottom: 3 }}>
            <span>Pes carregat</span>
            <strong style={{ color: "#f0f0f0", fontFamily: "'DM Mono', monospace" }}>{loadedKg.toFixed(0)} / {MAX_KG} kg</strong>
          </div>
          <div style={{ background: "#1a1a1a", borderRadius: 4, height: 6 }}>
            <div style={{ width: `${pct}%`, background: pct > 90 ? "#e53935" : RED, height: 6, borderRadius: 4, transition: "width .4s" }} />
          </div>
        </div>
        <div style={{ fontSize: 11, whiteSpace: "nowrap", fontFamily: "'DM Mono', monospace" }}>
          <span style={{ color: axleF > 4000 ? "#ef5350" : "#2ecc71" }}>Dav: <strong>{axleF.toFixed(0)}</strong></span>
          <span style={{ color: "#333", margin: "0 8px" }}>|</span>
          <span style={{ color: axleR > 4000 ? "#ef5350" : "#2ecc71" }}>Post: <strong>{axleR.toFixed(0)}</strong></span>
        </div>
        <button onClick={handleVoice} style={{
          background: RED, color: "#fff", border: "none", borderRadius: 7,
          padding: "7px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap",
          fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px",
        }}>
          🔊 Instruccions
        </button>
      </div>
    </div>
  );
}

/* ── Axle bar ── */
function AxleBar({ label, kg }) {
  const pct   = Math.min(100, (kg / 4000) * 100);
  const color = kg > 4000 ? "#ef5350" : "#2ecc71";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", marginBottom: 3 }}>
        <span>{label}</span>
        <strong style={{ color, fontFamily: "'DM Mono', monospace" }}>{kg.toFixed(0)} kg</strong>
      </div>
      <div style={{ background: "#1a1a1a", borderRadius: 4, height: 8 }}>
        <div style={{ width: `${pct}%`, background: color, height: 8, borderRadius: 4, transition: "width .4s" }} />
      </div>
      <div style={{ fontSize: 9, color: "#333", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>màx 4.000 kg</div>
    </div>
  );
}

/* ── Check card ── */
function CheckCard({ stop, isChecked, isActive, onCheck, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: isChecked ? "#0d1a0d" : isActive ? "#1a0a0a" : "#111",
      border: `1.5px solid ${isActive ? RED : isChecked ? "#2ecc71" : "#1a1a1a"}`,
      borderRadius: 7, marginBottom: 4, overflow: "hidden",
      opacity: isChecked ? 0.6 : 1, transition: "all .2s", cursor: "pointer",
    }}>
      <div style={{ padding: "7px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: stop.zone_color, flexShrink: 0, border: "1px solid rgba(255,255,255,.1)" }} />
        <span style={{
          background: "#1a1a1a", color: "#888", borderRadius: 3,
          padding: "1px 5px", fontSize: 10, fontWeight: 700, fontFamily: "'DM Mono', monospace",
        }}>{stop.loading_seq}</span>
        <span style={{ fontWeight: 700, fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#f0f0f0" }}>
          {stop.client_nom}
        </span>
        {stop.is_pedestrian && <span style={{ fontSize: 11 }}>🚶</span>}
        <input type="checkbox" checked={isChecked} onChange={onCheck}
          onClick={e => e.stopPropagation()}
          style={{ width: 16, height: 16, accentColor: RED, cursor: "pointer", flexShrink: 0 }} />
      </div>
    </div>
  );
}

function ErrBox({ msg }) {
  return (
    <div style={{ padding: 32, color: "#ef5350", background: "#1a0505", margin: 24, borderRadius: 10, border: "1px solid #c62828" }}>
      ⚠️ {msg}
    </div>
  );
}

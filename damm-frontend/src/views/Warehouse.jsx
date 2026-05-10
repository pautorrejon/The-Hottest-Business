import React, { useState, useEffect, useCallback } from "react";
import { getWarehouse, putStop } from "../api";

const RED    = "#E30613";
const GREEN  = "#16a34a";
const ORANGE = "#d97706";
const MAX_KG = 8000;
const today  = new Date().toLocaleDateString("ca-ES", { day: "2-digit", month: "long", year: "numeric" });

const VEHICLE_INFO = {
  furgoneta: { name: "Furgoneta",  color: "#5c6bc0", cols: 2, lanes: 1 },
  camio_6:   { name: "Camio 6 t", color: "#ef6c00", cols: 3, lanes: 2 },
  camio_8:   { name: "Camio 8 t", color: "#E30613", cols: 4, lanes: 2 },
};

function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter  = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  utter.voice  = voices.find(v => v.lang === "ca-ES") || voices.find(v => v.lang.startsWith("es")) || null;
  utter.lang   = utter.voice?.lang ?? "ca-ES";
  utter.rate   = 0.88; utter.pitch = 1.05;
  window.speechSynthesis.speak(utter);
}

const PEDESTRIAN_STRIPE = "repeating-linear-gradient(45deg,rgba(217,119,6,.14) 0px,rgba(217,119,6,.14) 6px,transparent 6px,transparent 14px)";

/* ── Proportional truck diagram ─────────────────────────────────────────────── */
function TruckLaneDiagram({ zones, vehicleType, checkedSet, highlightIdx }) {
  const vInfo = VEHICLE_INFO[vehicleType] || VEHICLE_INFO.camio_8;
  const { lanes } = vInfo;

  const totalCm    = zones.reduce((s, z) => s + Math.max(0, (z.zone_x_end ?? 0) - (z.zone_x_start ?? 0)), 0);
  const totalBoxes = zones.reduce((s, z) => s + (z.boxes_n || 1), 0);

  function getWidth(zone) {
    if (totalCm > 0) {
      const cm = Math.max(0, (zone.zone_x_end ?? 0) - (zone.zone_x_start ?? 0));
      return Math.max(5, (cm / totalCm) * 100) + "%";
    }
    return Math.max(5, ((zone.boxes_n || 1) / Math.max(totalBoxes, 1)) * 100) + "%";
  }

  return (
    <div style={{ background: "#f8f9fb", borderRadius: 10, overflow: "hidden", border: "1px solid #e0e4ec" }}>
      <div style={{ display: "flex", alignItems: "stretch", minHeight: lanes === 1 ? 90 : 140 }}>
        {/* Cabin */}
        <div style={{
          width: 52, background: "#eef0f4", display: "flex", alignItems: "center",
          justifyContent: "center", borderRight: "2px solid #dde1e9", flexShrink: 0,
        }}>
          <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: 11, color: "#9ca3af", letterSpacing: "1px", writingMode: "vertical-rl", transform: "rotate(180deg)" }}>CAB</span>
        </div>

        {/* Cargo zones */}
        <div style={{ flex: 1, padding: 6, display: "flex", flexDirection: "column", gap: 4, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", gap: 3, alignItems: "stretch" }}>
            {zones.map((zone, i) => {
              const isHighlighted = i === highlightIdx;
              const isChecked     = checkedSet.has(zone.client_nom);
              return (
                <div key={i} style={{
                  width: getWidth(zone), flexShrink: 0,
                  background: zone.color ?? "#dde1e9",
                  border: isHighlighted ? `2px solid ${RED}` : "1px solid rgba(0,0,0,.12)",
                  borderRadius: 5,
                  opacity: isChecked ? 0.3 : 1,
                  position: "relative", overflow: "hidden",
                  transition: "opacity .3s",
                  display: "flex", flexDirection: "column", justifyContent: "space-between",
                  padding: "4px 5px", minWidth: 0,
                }}>
                  {zone.is_pedestrian && (
                    <div style={{ position: "absolute", inset: 0, background: PEDESTRIAN_STRIPE, pointerEvents: "none" }} />
                  )}
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,.95)", fontWeight: 700, lineHeight: 1.2, fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", position: "relative" }}>
                    {zone.client_nom?.split(" ")[0]}
                  </div>
                  <div style={{ fontSize: 7, color: "rgba(255,255,255,.75)", fontFamily: "'DM Mono',monospace", lineHeight: 1.4, position: "relative" }}>
                    {zone.boxes_n   != null && <div>{zone.boxes_n} CAJ</div>}
                    {zone.weight_kg != null && <div>{zone.weight_kg} kg</div>}
                    {zone.is_pedestrian && <div style={{ color: "#fde68a", fontWeight: 700 }}>PZ</div>}
                  </div>
                  {isHighlighted && (
                    <div style={{ position: "absolute", inset: 0, border: `2px solid ${RED}`, borderRadius: 5, animation: "pulse 1.5s infinite" }} />
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#9ca3af", padding: "2px 0", fontFamily: "'DM Mono',monospace" }}>
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
      putStop(stop.delivery_order, "carregat").catch(console.warn);
      return { ...prev, [stop.client_nom]: !prev[stop.client_nom] };
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
      (stop.is_pedestrian ? " Atenció: zona de vianants." : "");
    speakText(text);
  }

  if (error) return <ErrBox msg={error} />;
  if (!data)  return <div style={{ padding: 32, color: "#6b7280" }}>Carregant dades…</div>;

  const vInfo      = VEHICLE_INFO[vehicleType] || VEHICLE_INFO.camio_8;
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
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)", overflow: "hidden", background: "#f4f6f9" }}>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── LEFT: truck diagram + axles ── */}
        <div style={{ width: "55%", display: "flex", flexDirection: "column", padding: "16px 20px", gap: 14, overflow: "hidden", borderRight: "1px solid #dde1e9" }}>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ background: vInfo.color, color: "#fff", borderRadius: 6, padding: "3px 14px", fontWeight: 900, fontSize: 14, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.5px" }}>
              {vInfo.name}
            </span>
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              {data.efficiency_pct ?? "—"}% eficiència ·{" "}
              <code style={{ color: RED, fontFamily: "'DM Mono',monospace" }}>{routeId}</code>
            </span>
          </div>

          <TruckLaneDiagram zones={zones} vehicleType={vehicleType} checkedSet={checkedSet} highlightIdx={stepIdx} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <AxleBar label="Eix davanter" kg={axleF} />
            <AxleBar label="Eix posterior" kg={axleR} />
          </div>

          {axleWarn && (
            <div style={{ background: "#fffbeb", border: "1.5px solid #fbbf24", borderRadius: 8, padding: "8px 12px", color: "#92400e", fontSize: 12, fontWeight: 700 }}>
              ! ATENCIO: Sobrecàrrega en algun eix! Redistribueix el pes.
            </div>
          )}
        </div>

        {/* ── RIGHT: picking list ── */}
        <div style={{ width: "45%", display: "flex", flexDirection: "column", background: "#f4f6f9", overflow: "hidden" }}>

          {/* Header */}
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #dde1e9", background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 14, color: "#111827", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "1px" }}>
                  FULL DE PICKING
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Mono',monospace" }}>{today}</div>
              </div>
              <button onClick={() => window.print()} style={{
                background: "#fff", border: "1px solid #dde1e9", color: "#6b7280",
                borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer",
              }}>
                Imprimir
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                <span>Pas {Math.min(stepIdx + 1, loadingOrder.length)} de {loadingOrder.length}</span>
                <span style={{ color: "#111827", fontWeight: 600 }}>{checkedSet.size}/{loadingOrder.length} carregats</span>
              </div>
              <div style={{ background: "#e8eaed", borderRadius: 4, height: 4 }}>
                <div style={{ width: `${(checkedSet.size / Math.max(loadingOrder.length, 1)) * 100}%`, background: RED, height: 4, borderRadius: 4, transition: "width .4s" }} />
              </div>
            </div>
          </div>

          {/* Current step card */}
          {currentStop && !allDone && (
            <div style={{ margin: "10px 12px 0", background: "#fff", borderRadius: 10, padding: "12px", border: `2px solid ${RED}`, flexShrink: 0, boxShadow: "0 1px 6px rgba(0,0,0,.06)" }}>
              <div style={{ fontSize: 10, color: RED, fontWeight: 700, marginBottom: 4, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "1px" }}>
                CARREGA ARA — PAS {stepIdx + 1}
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2, color: "#111827" }}>{currentStop.client_nom}</div>
              <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 8 }}>{currentStop.adresa}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ background: "#f0f2f5", color: "#6b7280", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                  X: {currentStop.zone_x_start}–{currentStop.zone_x_end} cm
                </span>
                <span style={{ background: "#f0f2f5", color: "#6b7280", borderRadius: 20, padding: "2px 10px", fontSize: 11 }}>
                  {currentStop.boxes_n} caixes · {currentStop.weight_kg} kg
                </span>
                {currentStop.is_pedestrian && (
                  <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>
                    Zona vianants
                  </span>
                )}
              </div>
              <button onClick={advance} style={{
                width: "100%", padding: "9px 0", background: RED, color: "#fff",
                border: "none", borderRadius: 7, fontWeight: 900, fontSize: 13, cursor: "pointer",
                fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "1px",
              }}>
                CARREGAT — {stepIdx + 1 < loadingOrder.length ? "SEGUENT →" : "FINALITZAR"}
              </button>
            </div>
          )}

          {allDone && (
            <div style={{ margin: "10px 12px 0", background: "#f0fdf4", border: `2px solid ${GREEN}`, borderRadius: 10, padding: "18px 16px", textAlign: "center" }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: GREEN, fontFamily: "'Barlow Condensed',sans-serif" }}>CÀRREGA COMPLETADA</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>El camió pot sortir cap a ruta</div>
            </div>
          )}

          {/* Checklist */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            {loadingOrder.map((stop, i) => (
              <React.Fragment key={stop.client_nom}>
                {/* Zone header */}
                <div style={{
                  background: stop.zone_color + "18",
                  borderLeft: `3px solid ${stop.zone_color}`,
                  padding: "4px 8px", marginBottom: 4, marginTop: i > 0 ? 10 : 0,
                  fontSize: 10, fontWeight: 700, color: "#374151",
                  fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "1px",
                  borderRadius: "0 4px 4px 0",
                }}>
                  ZONA {stop.loading_seq} — {stop.client_nom}
                  {stop.is_pedestrian && <span style={{ marginLeft: 6, color: ORANGE }}>P VIANANTS</span>}
                </div>

                {/* Products */}
                {(stop.products ?? []).slice(0, 5).map((p, pi) => (
                  <div key={pi} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 8px", fontSize: 11, color: "#4b5563",
                    borderBottom: "1px solid #f0f2f5",
                  }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", color: "#9ca3af", fontSize: 10, flexShrink: 0, width: 40 }}>{p.codi?.slice(0, 6)}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nom}</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", color: RED, fontWeight: 700, flexShrink: 0 }}>{p.quantitat} {p.unitat}</span>
                  </div>
                ))}
                {(stop.products ?? []).length > 5 && (
                  <div style={{ fontSize: 10, color: "#9ca3af", padding: "2px 8px" }}>+ {stop.products.length - 5} productes més</div>
                )}

                <div style={{ padding: "3px 8px 4px", fontSize: 10, color: "#9ca3af", fontFamily: "'DM Mono',monospace" }}>
                  ~{stop.temps_servei_min ?? Math.max(3, Math.round(5 + stop.boxes_n * 0.5))} min descàrrega
                </div>

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
      <div style={{ background: "#fff", borderTop: "1px solid #dde1e9", padding: "9px 20px", display: "flex", alignItems: "center", gap: 20, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#6b7280", fontSize: 11, marginBottom: 3 }}>
            <span>Pes carregat</span>
            <strong style={{ color: "#111827", fontFamily: "'DM Mono',monospace" }}>{loadedKg.toFixed(0)} / {MAX_KG} kg</strong>
          </div>
          <div style={{ background: "#e8eaed", borderRadius: 4, height: 6 }}>
            <div style={{ width: `${pct}%`, background: pct > 90 ? "#dc2626" : RED, height: 6, borderRadius: 4, transition: "width .4s" }} />
          </div>
        </div>
        <div style={{ fontSize: 11, whiteSpace: "nowrap", fontFamily: "'DM Mono',monospace" }}>
          <span style={{ color: axleF > 4000 ? "#dc2626" : GREEN }}>Dav: <strong>{axleF.toFixed(0)}</strong></span>
          <span style={{ color: "#dde1e9", margin: "0 8px" }}>|</span>
          <span style={{ color: axleR > 4000 ? "#dc2626" : GREEN }}>Post: <strong>{axleR.toFixed(0)}</strong></span>
        </div>
        <button onClick={handleVoice} style={{
          background: RED, color: "#fff", border: "none", borderRadius: 7,
          padding: "7px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap",
          fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.5px",
        }}>
          Instruccions (veu)
        </button>
      </div>
    </div>
  );
}

/* ── Axle bar ── */
function AxleBar({ label, kg }) {
  const pct   = Math.min(100, (kg / 4000) * 100);
  const color = kg > 4000 ? "#dc2626" : GREEN;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7280", marginBottom: 3 }}>
        <span>{label}</span>
        <strong style={{ color, fontFamily: "'DM Mono',monospace" }}>{kg.toFixed(0)} kg</strong>
      </div>
      <div style={{ background: "#e8eaed", borderRadius: 4, height: 8 }}>
        <div style={{ width: `${pct}%`, background: color, height: 8, borderRadius: 4, transition: "width .4s" }} />
      </div>
      <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 2, fontFamily: "'DM Mono',monospace" }}>màx 4.000 kg</div>
    </div>
  );
}

/* ── Check card ── */
function CheckCard({ stop, isChecked, isActive, onCheck, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: isChecked ? "#f0fdf4" : isActive ? "#fff5f5" : "#fff",
      border: `1.5px solid ${isActive ? RED : isChecked ? GREEN : "#dde1e9"}`,
      borderRadius: 7, marginBottom: 4, overflow: "hidden",
      opacity: isChecked ? 0.65 : 1, transition: "all .2s", cursor: "pointer",
      boxShadow: "0 1px 3px rgba(0,0,0,.04)",
    }}>
      <div style={{ padding: "7px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: stop.zone_color, flexShrink: 0, border: "1px solid rgba(0,0,0,.1)" }} />
        <span style={{
          background: "#f0f2f5", color: "#6b7280", borderRadius: 3,
          padding: "1px 5px", fontSize: 10, fontWeight: 700, fontFamily: "'DM Mono',monospace",
        }}>{stop.loading_seq}</span>
        <span style={{ fontWeight: 700, fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827" }}>
          {stop.client_nom}
        </span>
        {stop.is_pedestrian && <span style={{ fontSize: 10, color: ORANGE, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>PZ</span>}
        <input type="checkbox" checked={isChecked} onChange={onCheck}
          onClick={e => e.stopPropagation()}
          style={{ width: 16, height: 16, accentColor: RED, cursor: "pointer", flexShrink: 0 }} />
      </div>
    </div>
  );
}

function ErrBox({ msg }) {
  return (
    <div style={{ padding: 28, color: "#b91c1c", background: "#fef2f2", margin: 24, borderRadius: 10, border: "1px solid #fca5a5" }}>
      Error: {msg}
    </div>
  );
}

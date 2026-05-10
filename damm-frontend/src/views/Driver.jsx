import React, { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getRoute, putStop, postAssistant } from "../api";

const RED     = "#E30613";
const ORANGE  = "#f39c12";
const DEPOT_LAT = 41.5388;
const DEPOT_LON = 2.2131;

/* ── Icones de marcador ─────────────────────────────────────────────────────── */
function makeIcon(num, color, size = 30) {
  return L.divIcon({
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size * 0.43)}px;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)">${num}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], className: "",
  });
}

function makePulsingIcon(num, size = 36) {
  return L.divIcon({
    html: `<div style="background:${ORANGE};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size * 0.43)}px;border:3px solid #fff;box-shadow:0 0 12px rgba(243,156,18,.7);animation:pulse 0.7s ease-in-out infinite">${num}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], className: "",
  });
}

/* ── FitBounds ──────────────────────────────────────────────────────────────── */
function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length > 0) map.fitBounds(coords, { padding: [40, 40] });
  }, [coords, map]);
  return null;
}

/* ── Animació del camió (20s + pauses per parada) ───────────────────────────── */
function RouteController({ geometry, stops, isAnimating, callbacksRef }) {
  const map = useMap();
  const stateRef = useRef({ cancel: false, rafId: null, marker: null });

  useEffect(() => {
    if (!isAnimating || !geometry || geometry.length < 2) return;

    const state = stateRef.current;
    state.cancel = false;

    // Emoji del camió
    const icon = L.divIcon({
      html: '<span style="font-size:24px;line-height:1;display:block;transform:scaleX(-1)">🚛</span>',
      className: "", iconAnchor: [12, 12],
    });
    state.marker = L.marker(geometry[0], { icon, zIndexOffset: 1000 }).addTo(map);

    const validStops = stops.filter(s => s.lat && s.lon);
    const N          = validStops.length;
    const TOTAL_MS   = 20000;
    const PAUSE_MS   = N > 0 ? Math.min(900, Math.round(5000 / N)) : 0;
    const MOVE_MS    = Math.max(TOTAL_MS - PAUSE_MS * N, 5000);

    // Índex del punt de geometria més proper a cada parada
    const stopIndices = validStops.map(stop => {
      let minDist = Infinity, minIdx = 0;
      geometry.forEach(([lat, lon], i) => {
        const d = Math.hypot(lat - stop.lat, lon - stop.lon);
        if (d < minDist) { minDist = d; minIdx = i; }
      });
      return minIdx;
    });

    /* Anima un segment de la polilínia en segMs ms */
    function animateSegment(fromIdx, toIdx, segMs) {
      return new Promise(resolve => {
        if (state.cancel) { resolve(); return; }
        const pts = geometry.slice(fromIdx, Math.max(fromIdx + 1, toIdx + 1));
        if (pts.length < 2) {
          if (state.marker && pts.length === 1) state.marker.setLatLng(pts[0]);
          resolve(); return;
        }
        const t0 = performance.now();
        const dur = Math.max(segMs, 80);
        function step(now) {
          if (state.cancel) { resolve(); return; }
          const t  = Math.min((now - t0) / dur, 1);
          const fi = t * (pts.length - 1);
          const i  = Math.min(Math.floor(fi), pts.length - 2);
          const fr = fi - i;
          const lat = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * fr;
          const lng = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * fr;
          if (state.marker) state.marker.setLatLng([lat, lng]);
          if (t < 1) { state.rafId = requestAnimationFrame(step); }
          else { resolve(); }
        }
        state.rafId = requestAnimationFrame(step);
      });
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, state.cancel ? 0 : ms));
    }

    async function run() {
      for (let seg = 0; seg <= N; seg++) {
        if (state.cancel) break;

        const fromIdx = seg === 0 ? 0 : (stopIndices[seg - 1] ?? 0);
        const toIdx   = seg === N ? geometry.length - 1 : (stopIndices[seg] ?? geometry.length - 1);
        const segLen  = Math.max(1, toIdx - fromIdx);
        const segMs   = (segLen / geometry.length) * MOVE_MS;

        // Neteja parada anterior (si n'hi ha)
        if (seg > 0) callbacksRef.current.onStopReached(-1, "");

        await animateSegment(fromIdx, toIdx, segMs);

        // Pausa a la parada
        if (seg < N && !state.cancel) {
          callbacksRef.current.onStopReached(seg, validStops[seg].client_nom, validStops[seg].order);
          await sleep(PAUSE_MS);
        }
      }
      if (!state.cancel) callbacksRef.current.onDone();
    }

    run();

    return () => {
      state.cancel = true;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      if (state.marker) { state.marker.remove(); state.marker = null; }
    };
  }, [isAnimating, geometry, stops, map, callbacksRef]);

  return null;
}

/* ── Ruta OSRM amb dipòsit ──────────────────────────────────────────────────── */
async function fetchOSRMRoute(stops) {
  const valid = stops.filter(s => s.lat && s.lon);
  if (valid.length < 1) return null;
  const coords = [`${DEPOT_LON},${DEPOT_LAT}`, ...valid.map(s => `${s.lon},${s.lat}`)].join(";");
  try {
    const res  = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`);
    const data = await res.json();
    if (!data.routes?.[0]) return null;
    const route    = data.routes[0];
    const geometry = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    const steps    = route.legs.flatMap(leg => leg.steps)
      .filter(s => s.maneuver?.type !== "arrive" && s.name)
      .map(s => {
        const mod  = s.maneuver?.modifier ? ` (${s.maneuver.modifier})` : "";
        const type = s.maneuver?.type === "turn"       ? "Gira"
                   : s.maneuver?.type === "roundabout" ? "Rotonda"
                   : "Segueix";
        return `${type}${mod} per ${s.name}`;
      });
    return { geometry, steps, distance_m: route.distance, duration_s: route.duration };
  } catch { return null; }
}

/* ════════════════════════════════════════════════════════════════════════════════
   DRIVER VIEW
   ════════════════════════════════════════════════════════════════════════════════ */
export default function Driver({ routeId }) {
  const [route,        setRoute]        = useState(null);
  const [stops,        setStops]        = useState([]);
  const [done,         setDone]         = useState({});
  const [currentIdx,   setCurrentIdx]   = useState(0);
  const [roadLine,     setRoadLine]     = useState([]);
  const [turnSteps,    setTurnSteps]    = useState([]);
  const [stepIdx,      setStepIdx]      = useState(0);
  const [drawerOpen,   setDrawerOpen]   = useState(true);
  const [modal,        setModal]        = useState(false);
  const [question,     setQuestion]     = useState("");
  const [answer,       setAnswer]       = useState("");
  const [asking,       setAsking]       = useState(false);
  const [isAnimating,  setIsAnimating]  = useState(false);
  const [animDone,     setAnimDone]     = useState(false);
  const [animStopIdx,  setAnimStopIdx]  = useState(-1);   // índex a validStops, -1 = en moviment
  const [animStopName, setAnimStopName] = useState("");
  const [animStopOrd,  setAnimStopOrd]  = useState(-1);   // stop.order en pausa
  const [osrmKm,       setOsrmKm]       = useState(null);
  const [osrmMin,      setOsrmMin]      = useState(null);
  const [error,        setError]        = useState(null);

  /* Callbacks estables per al RouteController (sense re-renders innecessaris) */
  const callbacksRef = useRef({ onStopReached: null, onDone: null });
  callbacksRef.current.onStopReached = (idx, name, order = -1) => {
    setAnimStopIdx(idx);
    setAnimStopName(name || "");
    setAnimStopOrd(order);
  };
  callbacksRef.current.onDone = () => {
    setIsAnimating(false);
    setAnimDone(true);
    setAnimStopIdx(-1);
    setAnimStopName("");
    setAnimStopOrd(-1);
  };

  useEffect(() => {
    if (!routeId) return;
    getRoute(routeId).then(r => {
      setRoute(r);
      const s = r.stops ?? [];
      setStops(s);
      fetchOSRMRoute(s).then(osrm => {
        if (osrm) {
          setRoadLine(osrm.geometry);
          setTurnSteps(osrm.steps);
          setOsrmKm((osrm.distance_m / 1000).toFixed(1));
          setOsrmMin(Math.round(osrm.duration_s / 60));
        } else {
          setRoadLine([[DEPOT_LAT, DEPOT_LON], ...s.filter(x => x.lat && x.lon).map(x => [x.lat, x.lon])]);
        }
      });
    }).catch(e => setError(e.message));
  }, [routeId]);

  useEffect(() => {
    const first = stops.findIndex(s => !done[s.order]);
    setCurrentIdx(first >= 0 ? first : Math.max(0, stops.length - 1));
  }, [done, stops]);

  const handleComplete = useCallback(async (stop) => {
    setDone(prev => ({ ...prev, [stop.order]: true }));
    try { await putStop(stop.order, "completat"); } catch (e) { console.warn(e); }
  }, []);

  const handleAsk = async () => {
    if (!question.trim() || asking) return;
    setAsking(true); setAnswer("");
    try {
      const r = await postAssistant(routeId, question.trim());
      setAnswer(r.answer);
    } catch (e) { setAnswer(`Error: ${e.message}`); }
    finally { setAsking(false); }
  };

  if (error)  return <div style={{ padding: 32, color: "#ef5350", background: "#1a0505", margin: 24, borderRadius: 10 }}>⚠️ {error}</div>;
  if (!route) return <div style={{ padding: 32, color: "#888" }}>Carregant ruta…</div>;

  const kpis        = route.kpis ?? {};
  const pending     = stops.filter(s => !done[s.order]);
  const current     = stops[currentIdx] ?? stops[0];
  const allCoords   = stops.filter(s => s.lat && s.lon).map(s => [s.lat, s.lon]);
  const currentTurn = turnSteps[stepIdx] || "";
  const validStops  = stops.filter(s => s.lat && s.lon);

  /* Minuts cap a hores/minuts per al missatge de finalització */
  const formatDurada = (min) => {
    if (!min) return "";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };

  return (
    <div style={{ position: "relative", height: "calc(100vh - 48px)", overflow: "hidden", background: "#0a0a0a" }}>

      {/* ── Mapa a pantalla completa ── */}
      {allCoords.length > 0 && (
        <MapContainer center={allCoords[0]} zoom={14}
          style={{ position: "absolute", inset: 0, height: "100%", width: "100%" }}
          zoomControl={false}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; OSM &copy; CARTO'
          />
          <FitBounds coords={[[DEPOT_LAT, DEPOT_LON], ...allCoords]} />

          {/* Marcador dipòsit */}
          <Marker position={[DEPOT_LAT, DEPOT_LON]} icon={L.divIcon({
            html: '<div style="background:#1a1a1a;border:2px solid #E30613;color:#E30613;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:900;white-space:nowrap;font-family:Barlow Condensed,sans-serif;letter-spacing:1px">DDI</div>',
            className: "", iconAnchor: [16, 14],
          })} />

          {/* Ruta real OSRM */}
          {roadLine.length > 1 && (
            <Polyline positions={roadLine} color={RED} weight={4} opacity={0.8} />
          )}

          {/* Marcadors de parades */}
          {stops.map((s, i) => {
            if (!s.lat || !s.lon) return null;
            const isCurrent  = i === currentIdx;
            const isDone     = !!done[s.order];
            const isPausing  = s.order === animStopOrd && animStopIdx >= 0;
            const color = isDone ? "#444" : isPausing ? ORANGE : isCurrent ? RED : "#3498db";
            const size  = isPausing ? 38 : isCurrent ? 34 : 26;
            const icon  = isPausing ? makePulsingIcon(s.order + 1, size) : makeIcon(s.order + 1, color, size);
            return (
              <Marker key={s.order} position={[s.lat, s.lon]} icon={icon}>
                <Popup>
                  <strong>#{s.order + 1} {s.client_nom}</strong><br />
                  {s.adresa}<br />
                  Arr. estimada: {s.estimated_arrival}
                </Popup>
              </Marker>
            );
          })}

          <RouteController
            geometry={roadLine}
            stops={validStops}
            isAnimating={isAnimating}
            callbacksRef={callbacksRef}
          />
        </MapContainer>
      )}

      {/* ── Indicador torn a torn (visible fora de l'animació) ── */}
      {currentTurn && !isAnimating && (
        <div style={{
          position: "absolute", top: 12, left: 12, right: 68, zIndex: 1000,
          background: "rgba(10,10,10,.92)", borderRadius: 10, padding: "10px 14px",
          display: "flex", alignItems: "center", gap: 10, backdropFilter: "blur(4px)",
        }}>
          <span style={{ fontSize: 18 }}>↗</span>
          <span style={{ color: "#f0f0f0", fontSize: 13, fontWeight: 600, flex: 1 }}>{currentTurn}</span>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button onClick={() => setStepIdx(i => Math.max(0, i - 1))}
              style={{ background: "none", border: "1px solid #333", color: "#888", borderRadius: 5, padding: "2px 7px", cursor: "pointer", fontSize: 13 }}>‹</button>
            <button onClick={() => setStepIdx(i => Math.min(turnSteps.length - 1, i + 1))}
              style={{ background: "none", border: "1px solid #333", color: "#888", borderRadius: 5, padding: "2px 7px", cursor: "pointer", fontSize: 13 }}>›</button>
          </div>
        </div>
      )}

      {/* ── Barra de progrés de l'animació ── */}
      {isAnimating && (
        <div style={{
          position: "absolute", top: 12, left: 12, right: 68, zIndex: 1000,
          background: "rgba(10,10,10,.93)", borderRadius: 10, padding: "12px 14px",
          backdropFilter: "blur(4px)",
        }}>
          {/* Títol + info parada actual */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>🚛</span>
            <span style={{ color: "#f0f0f0", fontWeight: 700, fontSize: 13, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px" }}>
              SIMULANT RUTA
              {animStopIdx >= 0
                ? ` · PARADA ${animStopIdx + 1} DE ${validStops.length}`
                : " · EN TRÀNSIT"}
            </span>
          </div>
          {/* Nom del client en pausa */}
          {animStopIdx >= 0 && animStopName && (
            <div style={{ fontSize: 12, color: ORANGE, fontWeight: 700, marginBottom: 6 }}>
              ⏸ {animStopName}
            </div>
          )}
          {/* Barra de 20s */}
          <div style={{ background: "#1a1a1a", borderRadius: 4, height: 4, overflow: "hidden" }}>
            <div style={{ width: "100%", background: animStopIdx >= 0 ? ORANGE : RED, height: 4, borderRadius: 4, animation: "progress-anim 20s linear forwards" }} />
          </div>
        </div>
      )}

      {/* ── Missatge de finalització ── */}
      {animDone && !isAnimating && (
        <div style={{
          position: "absolute", top: 12, left: 12, right: 68, zIndex: 1000,
          background: "rgba(13,31,13,.95)", border: "1px solid #2ecc71", borderRadius: 10,
          padding: "10px 14px", color: "#2ecc71", fontWeight: 700, fontSize: 13,
          backdropFilter: "blur(4px)",
        }}>
          ✓ Ruta completada · {osrmKm} km · temps estimat: {formatDurada(osrmMin)}
        </div>
      )}

      {/* ── KPIs (dalt dreta) ── */}
      <div style={{
        position: "absolute", top: 12, right: 12, zIndex: 1000,
        background: "rgba(10,10,10,.85)", borderRadius: 10, padding: "8px 12px",
        backdropFilter: "blur(4px)",
      }}>
        <div style={{ color: "#555", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
          <div>Parades: <strong style={{ color: "#f0f0f0" }}>{pending.length}/{kpis.n_stops ?? "?"}</strong></div>
          {osrmKm && <div>Ruta: <strong style={{ color: "#f0f0f0" }}>{osrmKm} km</strong></div>}
        </div>
      </div>

      {/* ── Botó REPRODUIR / ATURAR ── */}
      <div style={{ position: "absolute", bottom: 220, right: 16, zIndex: 1000 }}>
        {!isAnimating ? (
          <button onClick={() => { setIsAnimating(true); setAnimDone(false); setAnimStopIdx(-1); setAnimStopName(""); }} style={{
            background: RED, color: "#fff", border: "none", borderRadius: "50%",
            width: 54, height: 54, fontSize: 22, cursor: "pointer",
            boxShadow: "0 4px 20px rgba(227,6,19,.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>▶</button>
        ) : (
          <button onClick={() => setIsAnimating(false)} style={{
            background: "#1a1a1a", color: "#f0f0f0", border: `2px solid ${RED}`, borderRadius: "50%",
            width: 54, height: 54, fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>⏹</button>
        )}
      </div>

      {/* ── Botó assistent ── */}
      <div style={{ position: "absolute", bottom: 284, right: 16, zIndex: 1000 }}>
        <button onClick={() => { setModal(true); setAnswer(""); }} style={{
          background: "rgba(10,10,10,.85)", color: "#888", border: "1px solid #333", borderRadius: "50%",
          width: 44, height: 44, fontSize: 18, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>💬</button>
      </div>

      {/* ── Calaix inferior ── */}
      {current && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 500,
          background: "#111", borderRadius: "16px 16px 0 0",
          boxShadow: "0 -4px 24px rgba(0,0,0,.7)",
          maxHeight: drawerOpen ? "42%" : "58px",
          overflow: "hidden", transition: "max-height .3s ease",
        }}>
          <div onClick={() => setDrawerOpen(o => !o)} style={{
            padding: "12px 16px 8px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          }}>
            <span style={{ background: RED, color: "#fff", borderRadius: 6, padding: "2px 10px", fontWeight: 900, fontSize: 14, fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
              #{(current.order + 1).toString().padStart(2, "0")}
            </span>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#f0f0f0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {current.client_nom}
            </span>
            {done[current.order] && <span style={{ color: "#2ecc71", flexShrink: 0 }}>✓</span>}
            <span style={{ color: "#444", fontSize: 14, flexShrink: 0 }}>{drawerOpen ? "▼" : "▲"}</span>
          </div>

          <div style={{ padding: "0 16px 16px", overflowY: "auto" }}>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 10 }}>{current.adresa}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {current.time_window && (
                <span style={{ background: "#1a1a1a", color: "#888", borderRadius: 20, padding: "3px 10px", fontSize: 11 }}>
                  🕐 {current.time_window.open} – {current.time_window.close}
                </span>
              )}
              <span style={{ background: "#1a1a1a", color: "#888", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
                Arr. {current.estimated_arrival}
              </span>
              {current.pedestrian_zone && (
                <span style={{ background: "#7a4800", color: "#f39c12", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600 }}>
                  🚶 Zona vianants
                </span>
              )}
            </div>
            {current.pedestrian_zone && (
              <div style={{ background: "#1a1000", border: "1px solid #7a4800", borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "#f39c12", marginBottom: 12 }}>
                🅿️ Aparca i camina <strong>{current.pedestrian_zone.walk_min} min</strong> fins al client
              </div>
            )}
            {!done[current.order] ? (
              <button onClick={() => handleComplete(current)} style={{
                width: "100%", padding: "13px", background: RED, color: "#fff",
                border: "none", borderRadius: 8, fontWeight: 900, fontSize: 16, cursor: "pointer",
                fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "1.5px",
              }}>
                ✓ ENTREGAT
              </button>
            ) : (
              <div style={{ textAlign: "center", color: "#2ecc71", fontWeight: 800, fontSize: 15 }}>
                ✅ Entrega completada
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Píndoles de parades pendents ── */}
      {pending.length > 0 && (
        <div style={{
          position: "absolute", bottom: drawerOpen ? 210 : 64, left: 12, zIndex: 400,
          display: "flex", flexDirection: "column", gap: 6, transition: "bottom .3s",
        }}>
          {pending.slice(0, 4).map(s => {
            const idx      = stops.indexOf(s);
            const isActive = idx === currentIdx;
            const isPausing = s.order === animStopOrd && animStopIdx >= 0;
            return (
              <div key={s.order} onClick={() => setCurrentIdx(idx)} style={{
                background: isPausing ? "rgba(243,156,18,.85)" : isActive ? "rgba(227,6,19,.9)" : "rgba(10,10,10,.85)",
                border: `1px solid ${isPausing ? ORANGE : isActive ? RED : "#333"}`,
                borderRadius: 8, padding: "5px 10px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 7, backdropFilter: "blur(4px)",
              }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
                  #{s.order + 1}
                </span>
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>
                  {s.client_nom.split(" ").slice(0, 2).join(" ")}
                </span>
                {isPausing && <span style={{ fontSize: 12 }}>⏸</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal assistent ── */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }}>
          <div style={{ background: "#1a1a1a", borderRadius: "18px 18px 0 0", padding: "22px 20px", width: "100%", maxWidth: 520 }}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 12, color: "#f0f0f0", fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "1px" }}>
              💬 ASSISTENT GEMINI
            </div>
            <textarea value={question} onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              placeholder="ex: Quina és la propera parada? On aparco?"
              rows={3} style={{ width: "100%", border: "1.5px solid #333", borderRadius: 9, padding: 10, fontSize: 13, resize: "none", outline: "none", boxSizing: "border-box", background: "#111", color: "#f0f0f0" }} />
            {asking && <div style={{ color: "#888", fontSize: 12, padding: "6px 0" }}>⏳ Consultant Gemini…</div>}
            {answer && !asking && (
              <div style={{ background: "#111", border: `1.5px solid ${RED}`, borderRadius: 9, padding: "10px 12px", fontSize: 13, color: "#f0f0f0", margin: "10px 0", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                🤖 {answer}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={handleAsk} disabled={asking || !question.trim()} style={{
                flex: 1, background: asking ? "#333" : RED, color: "#fff",
                border: "none", borderRadius: 8, padding: 11, fontWeight: 700,
                cursor: asking ? "not-allowed" : "pointer",
                fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px",
              }}>
                {asking ? "Esperant…" : "ENVIAR"}
              </button>
              <button onClick={() => setModal(false)} style={{ flex: 1, background: "#222", color: "#f0f0f0", border: "none", borderRadius: 8, padding: 11, fontWeight: 700, cursor: "pointer" }}>
                Tancar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

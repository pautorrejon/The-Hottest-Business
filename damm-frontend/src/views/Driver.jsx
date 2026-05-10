import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getRoute, putStop, postAssistant } from "../api";

const RED    = "#E30613";
const ORANGE = "#f39c12";
const DEPOT_LAT = 41.5388;
const DEPOT_LON = 2.2131;

/* ── Marker icons (no emojis) ───────────────────────────────────────────────── */
function makeIcon(num, color, size = 28) {
  return L.divIcon({
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size*0.42)}px;border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.5);font-family:'DM Mono',monospace">${num}</div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2], className: "",
  });
}
function makePulsingIcon(num, size = 34) {
  return L.divIcon({
    html: `<div style="background:${ORANGE};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size*0.42)}px;border:2.5px solid #fff;box-shadow:0 0 12px rgba(243,156,18,.7);animation:pulse 0.7s ease-in-out infinite;font-family:'DM Mono',monospace">${num}</div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2], className: "",
  });
}
/* Truck: SVG silhouette facing right */
function makeTruckIcon() {
  const svg = `
    <svg width="48" height="28" viewBox="0 0 48 28" xmlns="http://www.w3.org/2000/svg">
      <!-- cargo box -->
      <rect x="0" y="3" width="30" height="18" rx="2" fill="${RED}" stroke="#fff" stroke-width="1.2"/>
      <!-- cab -->
      <path d="M30 8 L30 21 L44 21 L44 12 Q44 8 40 8 Z" fill="${RED}" stroke="#fff" stroke-width="1.2"/>
      <!-- windshield -->
      <path d="M31 9.5 L31 16 L42 16 L42 12.5 Q42 9.5 39 9.5 Z" fill="rgba(255,255,255,0.55)"/>
      <!-- headlight -->
      <rect x="43" y="14" width="3" height="4" rx="1" fill="#fde68a"/>
      <!-- wheels -->
      <circle cx="8"  cy="23" r="4.5" fill="#1f2937"/>
      <circle cx="8"  cy="23" r="2"   fill="#6b7280"/>
      <circle cx="22" cy="23" r="4.5" fill="#1f2937"/>
      <circle cx="22" cy="23" r="2"   fill="#6b7280"/>
      <circle cx="38" cy="23" r="4.5" fill="#1f2937"/>
      <circle cx="38" cy="23" r="2"   fill="#6b7280"/>
      <!-- glow shadow -->
      <ellipse cx="24" cy="27.5" rx="20" ry="1.5" fill="rgba(227,6,19,0.25)"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [48, 28],
    iconAnchor: [24, 27],
  });
}

/* ── FitBounds ──────────────────────────────────────────────────────────────── */
function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length > 0) map.fitBounds(coords, { padding: [72, 72] });
  }, [coords, map]);
  return null;
}

/* ── Segment animation (20 s + pauses) ─────────────────────────────────────── */
function RouteController({ geometry, stops, isAnimating, callbacksRef }) {
  const map      = useMap();
  const stateRef = useRef({ cancel: false, rafId: null, marker: null });

  useEffect(() => {
    if (!isAnimating || !geometry || geometry.length < 2) return;

    const state = stateRef.current;
    state.cancel = false;

    state.marker = L.marker(geometry[0], { icon: makeTruckIcon(), zIndexOffset: 1000 }).addTo(map);

    const validStops = stops.filter(s => s.lat && s.lon);
    const N          = validStops.length;
    const TOTAL_MS   = 20000;
    const PAUSE_MS   = N > 0 ? Math.min(1500, Math.round(6000 / N)) : 0;
    const MOVE_MS    = Math.max(TOTAL_MS - PAUSE_MS * N, 4000);

    /* Closest geometry point to each stop */
    const stopIndices = validStops.map(stop => {
      let minDist = Infinity, minIdx = 0;
      geometry.forEach(([lat, lon], i) => {
        const d = Math.hypot(lat - stop.lat, lon - stop.lon);
        if (d < minDist) { minDist = d; minIdx = i; }
      });
      return minIdx;
    });

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
          const i  = Math.max(0, Math.min(Math.floor(fi), pts.length - 2));
          const fr = fi - i;
          /* null-guard: bail cleanly if pts are somehow invalid */
          if (!pts[i] || !pts[i + 1]) { resolve(); return; }
          const lat = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * fr;
          const lng = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * fr;
          if (state.marker) state.marker.setLatLng([lat, lng]);
          map.panTo([lat, lng], { animate: false, noMoveStart: true });
          if (t < 1) { state.rafId = requestAnimationFrame(step); }
          else        { resolve(); }
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
        const fromIdx = seg === 0 ? 0 : (stopIndices[seg-1] ?? 0);
        const toIdx   = seg === N ? geometry.length - 1 : (stopIndices[seg] ?? geometry.length - 1);
        const segLen  = Math.max(1, toIdx - fromIdx);
        const segMs   = (segLen / geometry.length) * MOVE_MS;

        if (seg > 0) callbacksRef.current.onStopReached(-1, "", -1);
        await animateSegment(fromIdx, toIdx, segMs);

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

/* ── OSRM route with depot ──────────────────────────────────────────────────── */
async function fetchOSRMRoute(stops) {
  const valid = stops.filter(s => s.lat && s.lon);
  if (valid.length < 1) return null;
  const coords = [`${DEPOT_LON},${DEPOT_LAT}`, ...valid.map(s => `${s.lon},${s.lat}`)].join(";");
  try {
    const res  = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
    const data = await res.json();
    if (!data.routes?.[0]) return null;
    const route    = data.routes[0];
    const geometry = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    /* Per-leg travel seconds */
    const legDurations = route.legs.map(leg => leg.duration); // seconds
    return {
      geometry,
      legDurations,
      distance_m : route.distance,
      duration_s : route.duration,
    };
  } catch { return null; }
}

function minToHHMM(m) {
  if (!m && m !== 0) return "—";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2,"0")}:${min.toString().padStart(2,"0")}`;
}
function formatDuration(min) {
  if (!min) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

/* ── Compute per-stop ETAs using OSRM leg durations ──────────────────────────── */
function computeETAs(stops, legDurations) {
  if (!stops.length) return [];
  let cursor = 8 * 60; // 08:00 departure
  return stops.map((s, i) => {
    const travelMin = legDurations?.[i] != null ? Math.round(legDurations[i] / 60) : 0;
    cursor += travelMin;
    // Wait for opening time
    const open = s.time_window?.open ? (parseInt(s.time_window.open) * 60 + parseInt(s.time_window.open.slice(3))) : 480;
    if (cursor < open) cursor = open;
    const arrival = cursor;
    const service = s.service_min ?? 5;
    cursor += service;
    return { arrival, departure: cursor, travelMin, service };
  });
}

/* ── Group consecutive stops by pedestrian zone ─────────────────────────────── */
function groupStops(stops) {
  const groups = [];
  let i = 0;
  while (i < stops.length) {
    const s  = stops[i];
    const pz = s.pedestrian_zone?.zone_id;
    if (pz) {
      /* Collect all consecutive stops in same zone */
      const grp = [s];
      let j = i + 1;
      while (j < stops.length && stops[j].pedestrian_zone?.zone_id === pz) {
        grp.push(stops[j]);
        j++;
      }
      groups.push({ type: "pz", zone_id: pz, stops: grp, parking: s.pedestrian_zone });
      i = j;
    } else {
      groups.push({ type: "normal", stops: [s] });
      i++;
    }
  }
  return groups;
}

/* ── Route sheet table ──────────────────────────────────────────────────────── */
function RouteSheet({ stops, route, osrmKm, osrmMin, legDurations, animStopOrd, allDone }) {
  const kpis   = route?.kpis ?? {};
  const etas   = computeETAs(stops, legDurations);
  const groups = groupStops(stops);

  /* Compute return time */
  const lastEta   = etas[etas.length - 1];
  const returnMin = lastEta ? lastEta.departure + Math.round((osrmMin ?? 0) / (stops.length + 1)) : null;

  /* Departure 08:00, estimate return */
  const totalKm  = osrmKm ?? kpis.total_km ?? "—";
  const totalMin = osrmMin ?? Math.round(kpis.total_min ?? 0);

  let stopSeq = 0; // global stop counter for the table

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid #dde1e9", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: 16, color: "#111827", letterSpacing: "1.5px" }}>
            FULL DE RUTA
          </div>
          <button onClick={() => window.print()} style={{
            background: "none", border: "1px solid #dde1e9", color: "#6b7280",
            borderRadius: 5, padding: "3px 10px", fontSize: 11, cursor: "pointer",
            fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.5px",
          }}>
            Imprimir full de ruta
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
          {kpis.vehicle_name ?? "Camio"} &nbsp;·&nbsp; {kpis.n_stops ?? stops.length} parades &nbsp;·&nbsp; {totalKm} km
        </div>
      </div>

      {/* Table header */}
      <div style={{
        display: "grid", gridTemplateColumns: "28px 1fr 56px 52px 50px",
        gap: 0, padding: "5px 12px", borderBottom: "1px solid #dde1e9",
        fontSize: 9, fontWeight: 700, color: "#9ca3af",
        fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "1px",
        flexShrink: 0, background: "#f8f9fb",
      }}>
        <span>#</span>
        <span>CLIENT · ADRESA</span>
        <span style={{ textAlign: "right" }}>HORA</span>
        <span style={{ textAlign: "right" }}>DESC.</span>
        <span style={{ textAlign: "right" }}>PALES</span>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {groups.map((grp, gi) => {
          if (grp.type === "pz") {
            /* Pedestrian zone group — shared parking row + sub-clients */
            const firstStop = grp.stops[0];
            const lastStop  = grp.stops[grp.stops.length - 1];
            const firstIdx  = stops.indexOf(firstStop);
            const etaFirst  = etas[firstIdx];
            const totalSvc  = grp.stops.reduce((s, st) => s + (st.service_min ?? 5), 0);
            const pallet1   = firstStop.truck_zone?.pallet_start;
            const pallet2   = lastStop.truck_zone?.pallet_end;
            const isActive  = grp.stops.some(s => s.order === animStopOrd);
            stopSeq++;
            const seqNum = stopSeq;

            return (
              <React.Fragment key={gi}>
                {/* Zone parking header row */}
                <div style={{
                  display: "grid", gridTemplateColumns: "28px 1fr 56px 52px 50px",
                  gap: 0, padding: "7px 12px",
                  borderBottom: "1px solid #dde1e9",
                  background: isActive ? "#fffbeb" : "#fff",
                  borderLeft: isActive ? `3px solid ${ORANGE}` : "3px solid transparent",
                }}>
                  <span style={{ fontFamily: "'DM Mono',monospace", color: isActive ? ORANGE : RED, fontWeight: 700, fontSize: 11, alignSelf: "center" }}>{seqNum}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 12, color: isActive ? "#d97706" : "#111827" }}>
                      ZONA VIANANTS — {grp.zone_id}
                    </div>
                    <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "'DM Mono',monospace" }}>
                      Aparca: {firstStop.pedestrian_zone?.walk_min ?? "?"} min a peu · {grp.stops.length} clients
                    </div>
                    {/* Sub-clients */}
                    {grp.stops.map((sub, si) => (
                      <div key={si} style={{ fontSize: 10, color: "#6b7280", paddingLeft: 6, marginTop: 2, borderLeft: "2px solid #e8eaed" }}>
                        · {sub.client_nom}
                      </div>
                    ))}
                  </div>
                  <span style={{ textAlign: "right", fontSize: 11, color: "#6b7280", fontFamily: "'DM Mono',monospace", alignSelf: "start", paddingTop: 2 }}>
                    {etaFirst ? minToHHMM(etaFirst.arrival) : firstStop.estimated_arrival}
                  </span>
                  <span style={{ textAlign: "right", fontSize: 11, color: "#6b7280", fontFamily: "'DM Mono',monospace", alignSelf: "start", paddingTop: 2 }}>
                    {totalSvc} min
                  </span>
                  <span style={{ textAlign: "right", fontSize: 11, color: "#9ca3af", fontFamily: "'DM Mono',monospace", alignSelf: "start", paddingTop: 2 }}>
                    {pallet1 != null && pallet2 != null ? `P${pallet1}-P${pallet2}` : "—"}
                  </span>
                </div>
              </React.Fragment>
            );
          }

          /* Normal single stop */
          const s    = grp.stops[0];
          const idx  = stops.indexOf(s);
          const eta  = etas[idx];
          const isActive = s.order === animStopOrd;
          const isDone   = s.estat === "completat";
          stopSeq++;
          const seqNum = stopSeq;

          return (
            <div key={gi} style={{
              display: "grid", gridTemplateColumns: "28px 1fr 56px 52px 50px",
              gap: 0, padding: "7px 12px",
              borderBottom: "1px solid #dde1e9",
              background: isActive ? "#fff5f5" : isDone ? "#f0fdf4" : "#fff",
              borderLeft: isActive ? `3px solid ${RED}` : isDone ? `3px solid #16a34a` : "3px solid transparent",
              opacity: isDone ? 0.65 : 1,
            }}>
              <span style={{ fontFamily: "'DM Mono',monospace", color: isActive ? RED : isDone ? "#16a34a" : "#9ca3af", fontWeight: 700, fontSize: 11, alignSelf: "center" }}>{seqNum}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.client_nom}
                </div>
                <div style={{ fontSize: 9, color: "#9ca3af", fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.adresa}
                </div>
              </div>
              <span style={{ textAlign: "right", fontSize: 11, color: isActive ? RED : "#6b7280", fontFamily: "'DM Mono',monospace", alignSelf: "center" }}>
                {eta ? minToHHMM(eta.arrival) : s.estimated_arrival}
              </span>
              <span style={{ textAlign: "right", fontSize: 11, color: "#6b7280", fontFamily: "'DM Mono',monospace", alignSelf: "center" }}>
                {s.service_min ?? "?"} min
              </span>
              <span style={{ textAlign: "right", fontSize: 11, color: "#9ca3af", fontFamily: "'DM Mono',monospace", alignSelf: "center" }}>
                {s.truck_zone?.pallet_start != null
                  ? `P${s.truck_zone.pallet_start}${s.truck_zone.pallet_end !== s.truck_zone.pallet_start ? `-P${s.truck_zone.pallet_end}` : ""}`
                  : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Summary footer */}
      <div style={{ borderTop: "1px solid #dde1e9", padding: "8px 12px", flexShrink: 0, background: "#f8f9fb" }}>
        <div style={{ fontSize: 10, color: "#6b7280", fontFamily: "'DM Mono',monospace", lineHeight: 1.7 }}>
          <div>Sortida: 08:00 &nbsp;·&nbsp; Retorn estimat: {returnMin ? minToHHMM(returnMin) : "—"}</div>
          <div>Distancia total: {totalKm} km &nbsp;·&nbsp; Temps trajecte: {formatDuration(totalMin)}</div>
          <div style={{ color: RED, fontWeight: 700 }}>
            Temps de parada: {stops.reduce((s, st) => s + (st.service_min ?? 0), 0)} min
          </div>
          {kpis.vehicle_name && <div>Vehicle: {kpis.vehicle_name}</div>}
        </div>
        {allDone && (
          <div style={{ marginTop: 6, padding: "5px 10px", background: "#f0fdf4", border: "1px solid #16a34a", borderRadius: 6, color: "#16a34a", fontWeight: 700, fontSize: 11, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.5px" }}>
            RUTA COMPLETADA
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════
   DRIVER VIEW — two-panel layout
   Left:  Full route sheet
   Right: Leaflet map + animation controls
   ════════════════════════════════════════════════════════════════════════════════ */
export default function Driver({ routeId }) {
  const [route,       setRoute]       = useState(null);
  const [stops,       setStops]       = useState([]);
  const [done,        setDone]        = useState({});
  const [roadLine,    setRoadLine]    = useState([]);
  const [legDurations,setLegDurations]= useState(null);
  const [osrmKm,      setOsrmKm]     = useState(null);
  const [osrmMin,     setOsrmMin]     = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animDone,    setAnimDone]    = useState(false);
  const [animStopIdx, setAnimStopIdx] = useState(-1);
  const [animStopOrd, setAnimStopOrd] = useState(-1);
  const [animStopName,setAnimStopName]= useState("");
  const [modal,       setModal]       = useState(false);
  const [question,    setQuestion]    = useState("");
  const [answer,      setAnswer]      = useState("");
  const [asking,      setAsking]      = useState(false);
  const [error,       setError]       = useState(null);

  /* Stable animation callbacks */
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
          setLegDurations(osrm.legDurations);
          setOsrmKm((osrm.distance_m / 1000).toFixed(1));
          setOsrmMin(Math.round(osrm.duration_s / 60));
        } else {
          setRoadLine([[DEPOT_LAT, DEPOT_LON], ...s.filter(x => x.lat && x.lon).map(x => [x.lat, x.lon])]);
        }
      });
    }).catch(e => setError(e.message));
  }, [routeId]);

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

  /* Stable reference — only recomputed when `stops` state changes, NOT on animation state changes */
  /* Must be declared before any early returns to satisfy Rules of Hooks */
  const validStops  = useMemo(() => stops.filter(s => s.lat && s.lon), [stops]);
  const allCoords   = useMemo(() => validStops.map(s => [s.lat, s.lon]), [validStops]);
  /* Stable full-route bounds — includes depot, never recreated on animation state changes */
  const fitCoords   = useMemo(() => [[DEPOT_LAT, DEPOT_LON], ...validStops.map(s => [s.lat, s.lon])], [validStops]);

  if (error) return (
    <div style={{ padding: 32, color: "#b91c1c", background: "#fef2f2", margin: 24, borderRadius: 10, border: "1px solid #fca5a5" }}>
      Error: {error}
    </div>
  );
  if (!route) return <div style={{ padding: 32, color: "#6b7280" }}>Carregant ruta…</div>;
  const currentStop = stops.find(s => !done[s.order]) ?? stops[0];
  const allDone    = stops.length > 0 && stops.every(s => done[s.order]);

  /* Unique parking locations count */
  const uniqueParks = new Set();
  stops.forEach(s => {
    if (s.pedestrian_zone?.zone_id) uniqueParks.add(s.pedestrian_zone.zone_id);
    else uniqueParks.add(`stop-${s.order}`);
  });
  const nParades = uniqueParks.size;

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", overflow: "hidden", background: "#f4f6f9" }}>

      {/* ══ LEFT 46%: Route sheet ══ */}
      <div style={{ width: "46%", borderRight: "1px solid #dde1e9", overflow: "hidden", display: "flex", flexDirection: "column", background: "#fff" }}>
        <RouteSheet
          stops={stops}
          route={route}
          osrmKm={osrmKm}
          osrmMin={osrmMin}
          legDurations={legDurations}
          animStopOrd={animStopOrd}
          allDone={allDone}
        />
      </div>

      {/* ══ RIGHT 54%: Map + controls ══ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Map */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {allCoords.length > 0 && (
            <MapContainer center={allCoords[0]} zoom={13}
              style={{ position: "absolute", inset: 0, height: "100%", width: "100%" }}
              zoomControl={false}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; OSM &copy; CARTO'
              />
              {/* Only auto-fit when NOT animating — during animation the truck follower drives the view */}
              {!isAnimating && <FitBounds coords={fitCoords} />}

              {/* Depot marker */}
              <Marker position={[DEPOT_LAT, DEPOT_LON]} icon={L.divIcon({
                html: '<div style="background:#fff;border:2px solid #E30613;color:#E30613;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:900;white-space:nowrap;font-family:\'Barlow Condensed\',sans-serif;letter-spacing:1px;box-shadow:0 1px 6px rgba(0,0,0,.2)">DDI</div>',
                className: "", iconAnchor: [14, 12],
              })} />

              {/* Road polyline */}
              {roadLine.length > 1 && (
                <Polyline positions={roadLine} color={RED} weight={3} opacity={0.75} />
              )}

              {/* Stop markers */}
              {stops.map((s, i) => {
                if (!s.lat || !s.lon) return null;
                const isDone   = !!done[s.order];
                const isPausing = s.order === animStopOrd && animStopIdx >= 0;
                const isCurrent = s === currentStop;
                const color = isDone ? "#9ca3af" : isPausing ? ORANGE : allDone ? "#16a34a" : isCurrent ? RED : "#2563eb";
                const size  = isPausing ? 36 : isCurrent ? 32 : 24;
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

          {/* Animation overlay — top bar */}
          {isAnimating && (
            <div style={{
              position: "absolute", top: 10, left: 10, right: 120, zIndex: 1000,
              background: "rgba(255,255,255,.94)", borderRadius: 8, padding: "9px 12px",
              backdropFilter: "blur(4px)", border: "1px solid #dde1e9",
              boxShadow: "0 2px 12px rgba(0,0,0,.1)",
            }}>
              <div style={{ color: "#111827", fontWeight: 700, fontSize: 12, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.5px", marginBottom: 6 }}>
                SIMULANT RUTA
                {animStopIdx >= 0 ? ` · PARADA ${animStopIdx + 1} DE ${validStops.length}` : " · EN TRANSIT"}
              </div>
              {animStopIdx >= 0 && animStopName && (
                <div style={{ fontSize: 11, color: "#d97706", fontWeight: 700, marginBottom: 5 }}>
                  {animStopName}
                </div>
              )}
              <div style={{ background: "#eef0f4", borderRadius: 3, height: 3, overflow: "hidden" }}>
                <div style={{ width: "100%", background: animStopIdx >= 0 ? ORANGE : RED, height: 3, animation: "progress-anim 20s linear forwards" }} />
              </div>
            </div>
          )}

          {/* Completion banner */}
          {animDone && !isAnimating && (
            <div style={{
              position: "absolute", top: 10, left: 10, right: 120, zIndex: 1000,
              background: "rgba(240,253,244,.97)", border: "1px solid #16a34a", borderRadius: 8,
              padding: "9px 12px", color: "#16a34a", fontWeight: 700, fontSize: 12,
              backdropFilter: "blur(4px)", boxShadow: "0 2px 12px rgba(0,0,0,.08)",
            }}>
              Simulacio completada · {osrmKm} km · {formatDuration(osrmMin)}
            </div>
          )}

          {/* KPIs top-right */}
          <div style={{ position: "absolute", top: 10, right: 10, zIndex: 999, background: "rgba(255,255,255,.92)", borderRadius: 8, padding: "7px 10px", backdropFilter: "blur(4px)", border: "1px solid #dde1e9", boxShadow: "0 1px 6px rgba(0,0,0,.08)" }}>
            <div style={{ fontSize: 10, color: "#6b7280", fontFamily: "'DM Mono',monospace", lineHeight: 1.7 }}>
              <div>Parades: <strong style={{ color: "#111827" }}>{nParades}</strong></div>
              {osrmKm && <div>Km: <strong style={{ color: "#111827" }}>{osrmKm}</strong></div>}
            </div>
          </div>
        </div>

        {/* ── Controls bar ── */}
        <div style={{ background: "#fff", borderTop: "1px solid #dde1e9", padding: "10px 16px", flexShrink: 0 }}>

          {/* Current stop card */}
          {currentStop && !allDone && (
            <div style={{ marginBottom: 10, padding: "9px 12px", background: "#f8f9fb", borderRadius: 8, border: `1.5px solid ${animStopOrd === currentStop.order ? ORANGE : "#dde1e9"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ background: RED, color: "#fff", borderRadius: 4, padding: "1px 8px", fontWeight: 900, fontSize: 12, fontFamily: "'DM Mono',monospace" }}>
                  #{(currentStop.order + 1).toString().padStart(2,"0")}
                </span>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#111827", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {currentStop.client_nom}
                </span>
                <span style={{ fontFamily: "'DM Mono',monospace", color: "#9ca3af", fontSize: 11 }}>
                  {currentStop.estimated_arrival}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>{currentStop.adresa}</div>
              {currentStop.pedestrian_zone && (
                <div style={{ fontSize: 11, color: "#d97706", background: "#fffbeb", borderRadius: 5, padding: "4px 8px", marginBottom: 8, border: "1px solid #fde68a" }}>
                  Zona vianants — aparca i camina {currentStop.pedestrian_zone.walk_min} min
                </div>
              )}
              <button onClick={() => handleComplete(currentStop)} style={{
                width: "100%", padding: "8px 0", background: RED, color: "#fff",
                border: "none", borderRadius: 6, fontWeight: 900, fontSize: 14, cursor: "pointer",
                fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "1.5px",
              }}>
                ENTREGAT →
              </button>
            </div>
          )}
          {allDone && (
            <div style={{ marginBottom: 10, padding: "9px 12px", background: "#f0fdf4", border: "1px solid #16a34a", borderRadius: 8, color: "#16a34a", fontWeight: 700, fontSize: 13, textAlign: "center", fontFamily: "'Barlow Condensed',sans-serif" }}>
              TOTES LES ENTREGUES COMPLETADES
            </div>
          )}

          {/* Animation + assistant buttons */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!isAnimating ? (
              <button onClick={() => { setIsAnimating(true); setAnimDone(false); setAnimStopIdx(-1); setAnimStopName(""); setAnimStopOrd(-1); }} style={{
                flex: 1, padding: "10px 0", background: RED, color: "#fff", border: "none", borderRadius: 7,
                fontWeight: 900, fontSize: 14, cursor: "pointer",
                fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "1.5px",
              }}>
                SIMULAR RECORREGUT
              </button>
            ) : (
              <button onClick={() => setIsAnimating(false)} style={{
                flex: 1, padding: "10px 0", background: "#fff", color: RED,
                border: `2px solid ${RED}`, borderRadius: 7, fontWeight: 900, fontSize: 14, cursor: "pointer",
                fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "1.5px",
              }}>
                ATURAR
              </button>
            )}
            <button onClick={() => { setModal(true); setAnswer(""); }} style={{
              padding: "10px 14px", background: "#fff", color: "#6b7280",
              border: "1px solid #dde1e9", borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: "pointer",
              fontFamily: "'Barlow Condensed',sans-serif", whiteSpace: "nowrap",
            }}>
              ASSISTENT
            </button>
          </div>
        </div>
      </div>

      {/* ── Gemini assistant modal ── */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 420, maxWidth: "90vw", border: "1px solid #dde1e9", boxShadow: "0 8px 32px rgba(0,0,0,.18)" }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: 18, color: "#111827", letterSpacing: "1px", marginBottom: 16 }}>
              ASSISTENT GEMINI
            </div>
            <textarea value={question} onChange={e => setQuestion(e.target.value)}
              placeholder="Ex: Quina es la millor ruta fins al seguent client?"
              style={{ width: "100%", minHeight: 70, background: "#f8f9fb", border: "1.5px solid #dde1e9", borderRadius: 7, padding: "8px 10px", color: "#111827", fontSize: 13, resize: "vertical", fontFamily: "'Barlow',sans-serif" }}
            />
            {answer && (
              <div style={{ background: "#f8f9fb", borderRadius: 7, padding: "10px 12px", fontSize: 13, color: "#374151", marginTop: 10, maxHeight: 160, overflowY: "auto", lineHeight: 1.5, border: "1px solid #dde1e9" }}>
                {answer}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={handleAsk} disabled={asking} style={{
                flex: 1, padding: "10px 0", background: asking ? "#9ca3af" : RED, color: "#fff",
                border: "none", borderRadius: 7, fontWeight: 900, fontSize: 14, cursor: asking ? "wait" : "pointer",
                fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "1px",
              }}>
                {asking ? "CONSULTANT..." : "PREGUNTAR"}
              </button>
              <button onClick={() => { setModal(false); setAnswer(""); setQuestion(""); }} style={{
                padding: "10px 16px", background: "#fff", color: "#6b7280", border: "1px solid #dde1e9",
                borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 13,
              }}>
                Tancar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

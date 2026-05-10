import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { postOptimize, postPackTruck, getProducts, getDemoRoute } from "../api";
import Spinner from "../components/Spinner";

const RED = "#E30613";

/* ── 13 Granollers clients · DR0011 · 02/02/2026 ─────────────────────────── */
const PZ_LABELS = {
  PZ_CENTRE:    { label: "Zona Vianants Centre", color: "#7c3aed" },
  PZ_CORONA:    { label: "Zona Vianants Corona", color: "#0891b2" },
  PZ_ALFONS_IV: { label: "Zona Vianants Alfons IV", color: "#d97706" },
};

const DEMO_CLIENTS = [
  { nom: "EL MENÚ",            adresa: "Carrer de Ponent 12",             cp: "08401", svc: 20,  boxes: 10, pz: null,
    prods: ["ESTRELLA DAMM 1/3 RET. PP ×1 CAJ","AGUA VERI 1,5L PET 12U ×2 CAJ","LETONA GRAN CREME 1,5L 6U ×2 CAJ","COCA COLA LATA 33CL 24U ×1 CAJ","COCA COLA ZERO LATA 33CL 24U ×1 CAJ","AGUA VERI 1/2 PET 24U ×1 CAJ"] },
  { nom: "BAR MERCADO",        adresa: "Plaça Caserna s/n",               cp: "08401", svc: 25,  boxes: 12, pz: null,
    prods: ["FONT D.OR NATURAL 1,5L PET 6U ×4 CAJ","YOSOY AVENA BARISTA 1L 6U ×1 CAJ","JUVER NÉCTAR MELOCOTÓN 20CL 24U ×1 CAJ","VICHY CATALAN GAS 30CL 24U ×1 CAJ","TRINA NARANJA SLEEK 33CL 24U ×1 CAJ","BARGALLO OLIVA SANSA 5L ×1 UN"] },
  { nom: "CAFE SANT ROC",      adresa: "Carrer de Sant Roc 5",            cp: "08400", svc: 35,  boxes: 18, pz: null,
    prods: ["ESTRELLA DAMM 1/3 RET. PP ×4 CAJ","VOLL-DAMM 1/3 RET. ×1 CAJ","DAURA DAMM 1/3 SR 6U ×1 CAJ","VICHY CATALAN GAS 30CL 24U ×1 CAJ","LETONA SEMI 1,5L 6U ×3 CAJ","ALLUE CAVA BRUT NATURE 75CL 6U ×1 CAJ","MARINAS PATATAS OLIVA 47G 10U ×2 CAJ"] },
  { nom: "PA TONET",           adresa: "Plaça de la Porxada 3",           cp: "08401", svc: 32,  boxes: 22, pz: "PZ_CENTRE",
    prods: ["LETONA GRAN CREME 1L VR 12U ×5 CAJ","AGUA VERI 1,5L PET 12U ×2 CAJ","CACAOLAT VIDRIO 20CL 30U ×2 CAJ","COCA COLA ZERO VR23,7 24U ×1 CAJ","GRANINI MELOCOTÓN 20CL 24U ×2 CAJ","GRANINI PINYA 20CL 24U ×2 CAJ","SCHWEPPES TONICA 20CL 24U ×1 CAJ","YOSOY AVENA BARISTA 1L 6U ×4 CAJ"] },
  { nom: "CASA FONDA EUROPA",  adresa: "Carrer Anselm Clavé 1",           cp: "08402", svc: 40,  boxes: 35, pz: "PZ_CENTRE",
    prods: ["LETONA GRAN CREME 1,5L 6U ×14 CAJ","FRIMASOL ACEITE GIRASOL 25L ×2 UN","SABOR DEL SUR ACEITE OLIVA 5L ×6 UN","BARGALLO OLI FREGIR 20L ×4 UN","AZUCARERA AZÚCAR 25KG ×2 UN","GALLO PAN RALLADO 5KG ×2 UN","GALLO HARINA DE TRIGO 5KG ×6 UN","VICHY CATALAN GAS 1/2 20U ×7 CAJ"] },
  { nom: "Platillos",          adresa: "Plaça de Pau Casals 14",          cp: "08402", svc: 33,  boxes: 12, pz: "PZ_CENTRE",
    prods: ["FREE DAMM LIMON 1/3 RET. ×2 CAJ","FREE DAMM TOSTADA 1/3 RET. ×2 CAJ","LETONA GRAN CREME 1,5L 6U ×1 CAJ","FRIMASOL ACEITE GIRASOL 25L ×1 UN","GC SERVILLETAS 2C 40x40 100U ×10 UN","BALNIC LAVAVAJILLAS MAQ. 6KG ×1 UN"] },
  { nom: "A VOCADOS",          adresa: "Plaça Josep Barangé 2",           cp: "08402", svc: 30,  boxes: 13, pz: null,
    prods: ["FREE DAMM TOSTADA 1/3 RET. ×1 CAJ","VOLL-DAMM 1/3 RET. ×1 CAJ","AGUA PIRINEA 1/3 GAS RET ×1 CAJ","GATA NEGRA TINTO JOVEN 75CL 6U ×1 CAJ","SEÑORIO DE LIZIA VERDEJO 75CL 6U ×1 CAJ","IRREVERENTE TINTO ROBLE 75CL 6U ×1 CAJ","MONTERIO BLANCO ROSCA 6U ×1 CAJ"] },
  { nom: "CAFE DE LA CORONA",  adresa: "Plaça de la Corona 14",           cp: "08402", svc: 47,  boxes: 36, pz: "PZ_CORONA",
    prods: ["ESTRELLA DAMM 1/3 RET. PP ×7 CAJ","FREE DAMM LIMON 1/3 RET. ×1 CAJ","FREE DAMM TOSTADA 1/3 RET. ×1 CAJ","VOLL-DAMM 1/3 RET. ×1 CAJ","VICHY CATALAN GAS 30CL 24U ×1 CAJ","LETONA SEMI 1,5L 6U ×5 CAJ","CACAOLAT VIDRIO 20CL 30U ×2 CAJ","MARINAS PATATAS OLIVA 47G 10U ×4 CAJ"] },
  { nom: "GRANJA GROC",        adresa: "Plaça de la Corona 9",            cp: "08402", svc: 28,  boxes: 20, pz: "PZ_CORONA",
    prods: ["ESTRELLA DAMM 1/3 RET. PP ×6 CAJ","CACAOLAT VIDRIO 20CL 30U ×1 CAJ","LETONA GRAN CREME 1,5L 6U ×6 CAJ","AGUA VERI 1/2 PET 24U ×5 CAJ"] },
  { nom: "BUSSINETS DE CUINA", adresa: "Carrer Conestable de Portugal 13",cp: "08402", svc: 30,  boxes: 10, pz: null,
    prods: ["GANCEDO CÓCTEL FRUTOS SECOS 1KG ×5 UN","GANCEDO ALMENDRA TOSTADA 1KG ×2 UN","PROEZA GARBANZOS EXTRA 3KG ×2 UN","FRIMASOL ACEITE GIRASOL 25L ×1 UN","GALLO TORTELINIS CARNE 2KG ×1 UN","SURINVER ESCALIVADA 1,1KG ×2 UN"] },
  { nom: "BAR LOCALET",        adresa: "Carrer d'Alfons IV 48",           cp: "08401", svc: 30,  boxes: 10, pz: "PZ_ALFONS_IV",
    prods: ["VOLL-DAMM 1/3 RET. ×3 CAJ","COCA COLA ZERO IMPORT LATA33 24U ×2 CAJ","ATO DESNATADA SIN LACTOSA 1L 6U ×1 CAJ","KH 7 DESENGRASANTE 5L ×1 UN"] },
  { nom: "CAVANET",            adresa: "Carrer d'Alfons IV 85",           cp: "08402", svc: 30,  boxes: 16, pz: "PZ_ALFONS_IV",
    prods: ["ESTRELLA DAMM 1/5 LN ×5 CAJ","VOLL-DAMM 1/3 RET. ×3 CAJ","LETONA GRAN CREME 1,5L 6U ×4 CAJ"] },
  { nom: "EL REFUGI D'EN CUCH",adresa: "Carrer de Sant Jaume 46",         cp: "08401", svc: 15,  boxes: 6,  pz: null,
    prods: ["LETONA GRAN CREME 1,5L 6U ×6 CAJ"] },
];

let _uid = 1;
const uid = () => _uid++;

function newProduct() {
  return { id: uid(), codi: "", nom: "", qty: 1, pes_kg: 0, llarg: 0, ample: 0, alt: 0, unitat: "CAJ" };
}
function newClient(preset = {}) {
  return {
    id:       uid(),
    nom:      preset.nom    ?? "",
    adresa:   preset.adresa ?? "",
    ciutat:   preset.ciutat ?? "",
    open:     preset.open   ?? "08:00",
    close:    preset.close  ?? "22:00",
    products: preset.products?.map(p => ({ id: uid(), unitat: "CAJ", ...p })) ?? [newProduct()],
  };
}

/* ── Descripció breu del producte ─────────────────────────────────────────── */
function getDescripcio(prod) {
  const nom = (prod.nom || "").toLowerCase();
  const kg  = prod.pes_kg ? `${prod.pes_kg} kg/CAJ` : "";
  if (nom.includes("1/3"))               return "Caixa de 24 unitats" + (kg ? ` · ${kg}` : "");
  if (nom.match(/1[,.]5\s*l/))           return "Pack de 12 ampolles" + (kg ? ` · ${kg}` : "");
  if (nom.match(/33\s*cl/))              return "Caixa de 24 llaunes" + (kg ? ` · ${kg}` : "");
  if (nom.match(/50\s*cl/))              return "Caixa de 24 ampolles" + (kg ? ` · ${kg}` : "");
  if (nom.includes("barril") || nom.includes("barrel")) return "Barril" + (kg ? ` · ${kg}` : "");
  if (nom.includes("got") || nom.includes("vas")) return "Caixa de gots" + (kg ? ` · ${kg}` : "");
  return kg ? `Caixa · ${kg}` : "Unitat";
}

export default function Orders({ onRouteReady }) {
  const [clients,   setClients]  = useState([newClient()]);
  const [products,  setProducts] = useState([]);
  const [loading,   setLoading]  = useState(false);
  const [loadStep,  setLoadStep] = useState("");
  const [error,     setError]    = useState(null);
  const [demoMode,  setDemoMode] = useState(false);
  const [expanded,  setExpanded] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    getProducts().then(r => setProducts(r.products ?? [])).catch(() => {});
  }, []);

  const setClient = useCallback((id, field, val) => {
    setClients(cs => cs.map(c => c.id === id ? { ...c, [field]: val } : c));
  }, []);

  const addClient    = () => { if (clients.length < 20) setClients(cs => [...cs, newClient()]); };
  const removeClient = (id) => setClients(cs => cs.filter(c => c.id !== id));

  const setProduct = useCallback((cid, pid, field, val) => {
    setClients(cs => cs.map(c =>
      c.id === cid
        ? { ...c, products: c.products.map(p => p.id === pid ? { ...p, [field]: val } : p) }
        : c
    ));
  }, []);

  const addProduct    = (cid) => setClients(cs => cs.map(c => c.id === cid ? { ...c, products: [...c.products, newProduct()] } : c));
  const removeProduct = (cid, pid) => setClients(cs => cs.map(c => c.id === cid ? { ...c, products: c.products.filter(p => p.id !== pid) } : c));

  const selectProductRef = useCallback((cid, pid, codi) => {
    const ref = products.find(p => p.codi === codi);
    setClients(cs => cs.map(c =>
      c.id === cid
        ? { ...c, products: c.products.map(p =>
            p.id === pid
              ? ref
                ? { ...p, codi: ref.codi, nom: ref.nom, pes_kg: ref.pes_kg ?? 0, llarg: ref.llarg_cm ?? 0, ample: ref.ample_cm ?? 0, alt: ref.alt_cm ?? 0 }
                : { ...p, codi }
              : p
          )}
        : c
    ));
  }, [products]);

  /* ── Demo: load 13 Granollers clients ───────────────────────────────────── */
  function loadGranollers() {
    setError(null);
    setDemoMode(true);
    setExpanded({});
  }

  async function handleDemoRoute() {
    setError(null);
    setLoading(true);
    setLoadStep("Generant ruta Granollers (OR-Tools + LIFO 3D)…");
    try {
      const r = await getDemoRoute();
      const vtype = r.kpis?.vehicle_type ?? "camio_6";
      onRouteReady(r.route_id, vtype);
      navigate("/warehouse");
    } catch (e) {
      setError(`Error al backend: ${e.message}`);
      setLoading(false);
    }
  }

  /* ── Manual route optimize ───────────────────────────────────────────────── */
  async function handleOptimize() {
    setError(null);
    setLoading(true);
    try {
      setLoadStep("Optimitzant ruta amb OR-Tools…");
      const payload = {
        clients: clients.map(c => ({
          nom: c.nom, adresa: c.adresa, ciutat: c.ciutat, open: c.open, close: c.close,
          products: c.products.map(p => ({
            codi: p.codi || "MANUAL", nom: p.nom || "Producte",
            qty: p.qty, pes_kg: p.pes_kg, llarg: p.llarg, ample: p.ample, alt: p.alt,
          })),
        })),
      };
      const opt = await postOptimize(payload);
      setLoadStep("Calculant càrrega del camió (FFD-LIFO 3D)…");
      await postPackTruck(opt.route_id);
      const vtype = opt.kpis?.vehicle_type ?? "camio_8";
      onRouteReady(opt.route_id, vtype);
      navigate("/warehouse");
    } catch (e) {
      setError(`Error al backend: ${e.message}.`);
      setLoading(false);
    }
  }

  const totalSvc = DEMO_CLIENTS.reduce((s, c) => s + c.svc, 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px 80px" }}>
      {loading && <Spinner text={loadStep} />}

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 4px", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: 32, color: "#111827", letterSpacing: "1px" }}>
          GESTIÓ DE COMANDES
        </h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
          Carrega la ruta de Granollers o crea una ruta manual
        </p>
      </div>

      {/* ── DEMO button ── */}
      <button onClick={loadGranollers} style={{
        width: "100%", padding: "18px 0", marginBottom: 12,
        background: demoMode ? "#b91c1c" : RED, color: "#fff", border: "none", borderRadius: 10,
        fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900,
        fontSize: 20, letterSpacing: "1.5px", cursor: "pointer",
        boxShadow: "0 4px 24px rgba(227,6,19,.35)",
      }}>
        {demoMode ? "COMANDA GRANOLLERS CARREGADA" : "CARREGAR COMANDA GRANOLLERS"}
      </button>

      {/* ── Manual form toggle ── */}
      {!demoMode && (
        <button onClick={() => setClients([newClient()])} style={{
          width: "100%", padding: "10px 0", marginBottom: 24,
          background: "#fff", color: "#4b5563", border: "1.5px solid #dde1e9",
          borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: "pointer",
        }}>
          + Nova comanda en blanc
        </button>
      )}
      {demoMode && (
        <button onClick={() => setDemoMode(false)} style={{
          width: "100%", padding: "8px 0", marginBottom: 24,
          background: "#fff", color: "#6b7280", border: "1.5px solid #dde1e9",
          borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}>
          Crear ruta manual en blanc
        </button>
      )}

      {error && (
        <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* ══ DEMO MODE: 13 read-only client cards ══════════════════════════════ */}
      {demoMode && (
        <>
          {/* Route header */}
          <div style={{ background: "#fff", borderRadius: 10, padding: "14px 18px", marginBottom: 16, border: "1.5px solid #dde1e9", boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: 16, color: "#111827", letterSpacing: "0.5px" }}>
                  RUTA DR0011 — GRANOLLERS
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
                  02/02/2026 · Repartidor: Adrià Ramos Rosich
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 20, flexShrink: 0 }}>
                <KpiChip label="Clients" val="13" />
                <KpiChip label="Parades" val="9" />
                <KpiChip label="Temps parada" val={`${totalSvc} min`} />
              </div>
            </div>
          </div>

          {/* PZ legend */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {Object.entries(PZ_LABELS).map(([id, { label, color }]) => (
              <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: color + "15", border: `1px solid ${color}40`, borderRadius: 20, padding: "3px 10px", fontSize: 11, color, fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.3px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
                {label}
              </span>
            ))}
          </div>

          {/* Client cards */}
          {DEMO_CLIENTS.map((c, i) => {
            const pzInfo = c.pz ? PZ_LABELS[c.pz] : null;
            const isOpen = !!expanded[i];
            return (
              <div key={i} style={{
                background: "#fff", borderRadius: 10, marginBottom: 10,
                border: `1px solid ${pzInfo ? pzInfo.color + "40" : "#dde1e9"}`,
                borderLeft: `4px solid ${pzInfo ? pzInfo.color : RED}`,
                boxShadow: "0 1px 4px rgba(0,0,0,.05)",
                overflow: "hidden",
              }}>
                <div
                  onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}>
                  <span style={{ background: RED, color: "#fff", borderRadius: 5, padding: "1px 9px", fontWeight: 900, fontSize: 12, fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.nom}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "'DM Mono',monospace" }}>
                      {c.adresa} · {c.cp}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    {pzInfo && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: pzInfo.color, background: pzInfo.color + "12", borderRadius: 5, padding: "2px 7px", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.3px" }}>
                        {pzInfo.label.replace("Zona Vianants ", "PZ ")}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Mono',monospace", whiteSpace: "nowrap" }}>
                      {c.boxes} caixes · {c.svc} min
                    </span>
                    <span style={{ color: "#9ca3af", fontSize: 14 }}>{isOpen ? "▲" : "▼"}</span>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: "0 16px 12px 16px", borderTop: "1px solid #f0f2f5" }}>
                    {c.prods.map((p, pi) => (
                      <div key={pi} style={{ fontSize: 12, color: "#374151", padding: "4px 0", borderBottom: pi < c.prods.length - 1 ? "1px solid #f8f9fb" : "none", display: "flex", gap: 8 }}>
                        <span style={{ color: "#9ca3af", fontFamily: "'DM Mono',monospace", fontSize: 10, flexShrink: 0, paddingTop: 1 }}>·</span>
                        {p}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* CTA */}
          <div style={{ marginTop: 20 }}>
            <button onClick={handleDemoRoute} style={{
              width: "100%", padding: "16px 0", background: RED, color: "#fff",
              border: "none", borderRadius: 10,
              fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900,
              fontSize: 20, letterSpacing: "2px", cursor: "pointer",
              boxShadow: "0 4px 24px rgba(227,6,19,.4)",
            }}>
              GENERAR RUTA GRANOLLERS →
            </button>
            <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 8 }}>
              Assignació automàtica de vehicle · FFD-LIFO 3D · 9 parades · {totalSvc} min temps de parada
            </p>
          </div>
        </>
      )}

      {/* ══ MANUAL MODE ═══════════════════════════════════════════════════════ */}
      {!demoMode && (
        <>
          {clients.map((c, ci) => (
            <ClientBlock key={c.id} c={c} ci={ci}
              productCatalogue={products}
              setClient={setClient}
              setProduct={setProduct}
              selectProductRef={selectProductRef}
              addProduct={addProduct}
              removeProduct={removeProduct}
              removeClient={() => removeClient(c.id)}
              canRemove={clients.length > 1}
            />
          ))}

          <button onClick={addClient} disabled={clients.length >= 20} style={{
            width: "100%", padding: 12, border: `2px dashed ${RED}`,
            background: "transparent", color: RED, borderRadius: 10,
            fontWeight: 700, cursor: "pointer", fontSize: 14,
            marginBottom: 24, opacity: clients.length >= 20 ? 0.4 : 1,
            fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.5px",
          }}>
            + AFEGIR CLIENT {clients.length >= 20 ? "(MÀXIM 20)" : `(${clients.length}/20)`}
          </button>

          <button onClick={handleOptimize} style={{
            width: "100%", padding: "16px 0", background: RED, color: "#fff",
            border: "none", borderRadius: 10,
            fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900,
            fontSize: 20, letterSpacing: "2px", cursor: "pointer",
            boxShadow: "0 4px 24px rgba(227,6,19,.4)",
          }}>
            OPTIMITZAR RUTA →
          </button>
          <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 10 }}>
            Assignació automàtica de vehicle · FFD-LIFO 3D · OR-Tools CVRPTW
          </p>
        </>
      )}
    </div>
  );
}

function KpiChip({ label, val }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 16, color: RED }}>{val}</div>
      <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
    </div>
  );
}

function ClientBlock({ c, ci, productCatalogue, setClient, setProduct, selectProductRef, addProduct, removeProduct, removeClient, canRemove }) {
  const sc = (f, v) => setClient(c.id, f, v);
  return (
    <div style={{
      background: "#fff", borderRadius: 12, padding: "18px 20px", marginBottom: 14,
      borderLeft: `4px solid ${RED}`, boxShadow: "0 1px 6px rgba(0,0,0,.07)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{
          background: RED, color: "#fff", borderRadius: 6, padding: "2px 12px",
          fontWeight: 900, fontSize: 13, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px",
        }}>
          CLIENT {ci + 1}
        </span>
        {canRemove && (
          <button onClick={removeClient} style={{ marginLeft: "auto", background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 18 }}>✕</button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: 10, marginBottom: 12 }}>
        <Field label="Nom del client" value={c.nom}    onChange={v => sc("nom", v)}    placeholder="ex: BAR LA CANTINA" />
        <Field label="Adreça"         value={c.adresa} onChange={v => sc("adresa", v)} placeholder="ex: Carrer Major 12" />
        <Field label="Ciutat"         value={c.ciutat} onChange={v => sc("ciutat", v)} placeholder="ex: Granollers" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        <Field label="Obertura"  value={c.open}  onChange={v => sc("open",  v)} type="time" />
        <Field label="Tancament" value={c.close} onChange={v => sc("close", v)} type="time" />
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "1px" }}>
        Productes
      </div>
      <div style={{ background: "#f8f9fb", borderRadius: 8, padding: "10px 12px", border: "1px solid #e8eaed" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 24px", gap: 6, fontSize: 10, color: "#9ca3af", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          <span>Producte</span><span>Quantitat</span><span>Unitat</span><span />
        </div>
        {c.products.map(p => (
          <ProductRow key={p.id}
            p={p}
            catalogue={productCatalogue}
            onSelectRef={(codi) => selectProductRef(c.id, p.id, codi)}
            onChange={(f, v) => setProduct(c.id, p.id, f, v)}
            onRemove={() => removeProduct(c.id, p.id)}
            canRemove={c.products.length > 1}
          />
        ))}
        <button onClick={() => addProduct(c.id)} style={{
          marginTop: 8, background: "none", border: "1px dashed #dde1e9", color: "#6b7280",
          borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 12, width: "100%",
        }}>
          + Afegir producte
        </button>
      </div>
    </div>
  );
}

const NI = {
  width: "100%", padding: "7px 10px", borderRadius: 6,
  border: "1.5px solid #dde1e9", fontSize: 13, outline: "none",
  background: "#fff", color: "#111827",
};

function ProductRow({ p, catalogue, onSelectRef, onChange, onRemove, canRemove }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [search,       setSearch]       = useState(p.nom || "");
  const [focusIdx,     setFocusIdx]     = useState(-1);

  const filtered = search.length > 0
    ? catalogue.filter(c =>
        c.nom.toLowerCase().includes(search.toLowerCase()) ||
        c.codi.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 8)
    : [];

  function selectRef(prod) {
    setSearch(prod.nom);
    setShowDropdown(false);
    setFocusIdx(-1);
    onSelectRef(prod.codi);
  }

  function handleKeyDown(e) {
    if (!showDropdown || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && focusIdx >= 0) {
      e.preventDefault();
      selectRef(filtered[focusIdx]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setFocusIdx(-1);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 24px", gap: 6, marginBottom: 6, alignItems: "start" }}>

      {/* ── Autocomplete ── */}
      <div style={{ position: "relative" }}>
        <input style={NI} value={search}
          onChange={e => { setSearch(e.target.value); onChange("nom", e.target.value); setShowDropdown(true); setFocusIdx(-1); }}
          onBlur={() => setTimeout(() => { setShowDropdown(false); setFocusIdx(-1); }, 160)}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder="ex: Estrella Damm 330ml" />

        {showDropdown && filtered.length > 0 && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
            background: "#fff", border: "1.5px solid #dde1e9", borderRadius: 8,
            boxShadow: "0 6px 24px rgba(0,0,0,.1)", maxHeight: 300, overflowY: "auto",
          }}>
            {filtered.map((prod, idx) => (
              <div key={prod.codi} onMouseDown={() => selectRef(prod)} style={{
                padding: "9px 12px", cursor: "pointer",
                borderBottom: "1px solid #f0f2f5",
                background: idx === focusIdx ? "#f3f4f6" : "transparent",
                transition: "background .1s",
              }}
              onMouseEnter={() => setFocusIdx(idx)}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontFamily: "'DM Mono', monospace", color: "#9ca3af", fontSize: 10, flexShrink: 0 }}>
                    {prod.codi}
                  </span>
                  <span style={{ color: "#111827", fontWeight: 700, fontSize: 12 }}>
                    {prod.nom}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>
                  {getDescripcio(prod)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quantitat */}
      <input style={{ ...NI, textAlign: "center" }} type="number" min="1" value={p.qty}
        onChange={e => onChange("qty", +e.target.value)} />

      {/* Unitat */}
      <select style={{ ...NI, cursor: "pointer" }} value={p.unitat || "CAJ"}
        onChange={e => onChange("unitat", e.target.value)}>
        <option value="CAJ">CAJ</option>
        <option value="PAL">PAL</option>
        <option value="UN">UN</option>
      </select>

      {canRemove
        ? <button onClick={onRemove} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 16, padding: 0, marginTop: 6 }}>✕</button>
        : <span />}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, display: "block", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700 }}>{label}</label>
      <input type={type} style={NI} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
}

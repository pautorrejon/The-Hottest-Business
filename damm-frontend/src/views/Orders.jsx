import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { postOptimize, postPackTruck, getProducts, getClients } from "../api";
import Spinner from "../components/Spinner";

const RED = "#E30613";

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
  const [clients,  setClients]  = useState([newClient()]);
  const [products, setProducts] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [loadStep, setLoadStep] = useState("");
  const [error,    setError]    = useState(null);
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

  async function loadGranollers() {
    setError(null);
    setLoading(true); setLoadStep("Carregant clients reals de MongoDB…");
    try {
      const r = await getClients();
      setClients((r.clients ?? []).map(c => newClient(c)));
    } catch (e) {
      setError(`No s'han pogut carregar els clients: ${e.message}`);
    } finally {
      setLoading(false); setLoadStep("");
    }
  }

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
      setError(`Error al backend: ${e.message}. Comprova que main.py funciona a localhost:8000.`);
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px 80px" }}>
      {loading && <Spinner text={loadStep} />}

      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          margin: "0 0 6px",
          fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 900, fontSize: 32, color: "#f0f0f0", letterSpacing: "1px",
        }}>
          NOVA RUTA DE LLIURAMENT
        </h1>
        <p style={{ margin: 0, color: "#666", fontSize: 13 }}>
          Afegeix clients i productes, o carrega les comandes reals de MongoDB
        </p>
      </div>

      <button onClick={loadGranollers} style={{
        width: "100%", padding: "16px 0", marginBottom: 16,
        background: RED, color: "#fff", border: "none", borderRadius: 10,
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
        fontSize: 18, letterSpacing: "1.5px", cursor: "pointer",
        boxShadow: "0 4px 24px rgba(227,6,19,.35)",
      }}>
        🍺 CARREGAR COMANDA GRANOLLERS
      </button>

      <button onClick={() => setClients([newClient()])} style={{
        width: "100%", padding: "10px 0", marginBottom: 24,
        background: "transparent", color: "#666", border: "1.5px solid #333",
        borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: "pointer",
      }}>
        + Nova comanda en blanc
      </button>

      {error && (
        <div style={{ background: "#1a0a0a", border: "1.5px solid #c62828", borderRadius: 8, padding: "10px 14px", color: "#ef9a9a", fontSize: 13, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

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
        fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px",
      }}>
        + AFEGIR CLIENT {clients.length >= 20 ? "(MÀXIM 20)" : `(${clients.length}/20)`}
      </button>

      <button onClick={handleOptimize} style={{
        width: "100%", padding: "16px 0", background: RED, color: "#fff",
        border: "none", borderRadius: 10,
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
        fontSize: 20, letterSpacing: "2px", cursor: "pointer",
        boxShadow: "0 4px 24px rgba(227,6,19,.4)",
      }}>
        OPTIMITZAR RUTA →
      </button>
      <p style={{ textAlign: "center", color: "#555", fontSize: 12, marginTop: 10 }}>
        Assignació automàtica de vehicle · FFD-LIFO 3D · OR-Tools CVRPTW
      </p>
    </div>
  );
}

function ClientBlock({ c, ci, productCatalogue, setClient, setProduct, selectProductRef, addProduct, removeProduct, removeClient, canRemove }) {
  const sc = (f, v) => setClient(c.id, f, v);
  return (
    <div style={{
      background: "#1a1a1a", borderRadius: 12, padding: "18px 20px", marginBottom: 14,
      borderLeft: `4px solid ${RED}`, boxShadow: "0 2px 12px rgba(0,0,0,.3)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{
          background: RED, color: "#fff", borderRadius: 6, padding: "2px 12px",
          fontWeight: 900, fontSize: 13, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px",
        }}>
          CLIENT {ci + 1}
        </span>
        {canRemove && (
          <button onClick={removeClient} style={{ marginLeft: "auto", background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18 }}>✕</button>
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

      <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: "1px" }}>
        Productes
      </div>
      <div style={{ background: "#111", borderRadius: 8, padding: "10px 12px", border: "1px solid #222" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 24px", gap: 6, fontSize: 10, color: "#555", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
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
          marginTop: 8, background: "none", border: "1px dashed #333", color: "#555",
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
  border: "1.5px solid #2a2a2a", fontSize: 13, outline: "none",
  background: "#0f0f0f", color: "#f0f0f0",
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
            background: "#1a1a1a", border: "1.5px solid #333", borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,.6)", maxHeight: 300, overflowY: "auto",
          }}>
            {filtered.map((prod, idx) => (
              <div key={prod.codi} onMouseDown={() => selectRef(prod)} style={{
                padding: "9px 12px", cursor: "pointer",
                borderBottom: "1px solid #222",
                background: idx === focusIdx ? "#2a2a2a" : "transparent",
                transition: "background .1s",
              }}
              onMouseEnter={() => setFocusIdx(idx)}>
                {/* Línia 1: codi + nom */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontFamily: "'DM Mono', monospace", color: "#555", fontSize: 10, flexShrink: 0 }}>
                    {prod.codi}
                  </span>
                  <span style={{ color: "#f0f0f0", fontWeight: 700, fontSize: 12 }}>
                    {prod.nom}
                  </span>
                </div>
                {/* Línia 2: descripció breu */}
                <div style={{ fontSize: 11, color: "#666" }}>
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
        ? <button onClick={onRemove} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: 0, marginTop: 6 }}>✕</button>
        : <span />}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700 }}>{label}</label>
      <input type={type} style={NI} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
}

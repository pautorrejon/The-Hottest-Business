const BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

export const fetchHealth     = ()           => GET("/api/health");
export const postOptimize    = (body)       => POST("/api/optimize", body || undefined);
export const postPackTruck   = (id)         => POST("/api/pack-truck", { route_id: id });
export const getRoute        = (id)         => GET(`/api/route/${id}`);
export const getWarehouse    = (id)         => GET(`/api/warehouse/${id}`);
export const postAssistant   = (rid, q)     => POST("/api/assistant", { route_id: rid, question: q });
export const getProducts     = ()           => GET("/api/products");
export const getClients      = ()           => GET("/api/clients");
export const getDemoRoute    = ()           => GET("/api/demo/granollers");

export async function putStop(stopId, estat) {
  const res = await fetch(`${BASE}/api/stop/${stopId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ estat }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function GET(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function POST(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

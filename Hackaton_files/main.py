"""
Damm Smart Truck · FastAPI Backend
====================================
3L-CVRPTW solver (Vehicle Routing + 3D Loading + LIFO) for Damm
beverage distribution in Granollers.  Interhack BCN 2026.

Endpoints:
  POST /api/optimize        — run OR-Tools CVRPTW, save route
  POST /api/pack-truck      — FFD-LIFO 3D bin packing, update route
  GET  /api/route/{id}      — driver mobile view
  PUT  /api/stop/{id}       — update stop status + recalculate ETAs
  GET  /api/warehouse/{id}  — warehouse tablet loading checklist
  GET  /api/health          — MongoDB ping
"""

import math
import uuid
import datetime
import os
import requests as http_requests
from typing import Optional
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
import uvicorn

# ── CONFIGURATION ───────────────────────────────────────────────────────────
_MONGO_URI_DEFAULT = (
    "mongodb+srv://pautorrejon_db_user:tQDV09cNAMgoELai"
    "@dammsmarttruck.k9q2nbf.mongodb.net/damm_hackathon"
    "?retryWrites=true&w=majority&appName=DammSmartTruck"
)
MONGO_URI = os.getenv("MONGO_URI", _MONGO_URI_DEFAULT)
DB_NAME = "damm_hackathon"

# DDI Mollet del Vallès — truck depot
DEPOT_LAT = 41.5388
DEPOT_LON = 2.2131

# Truck physical dimensions (cm) and max payload (kg)
TRUCK_L_CM    = 600   # X axis: door (0) → back wall (600)
TRUCK_W_CM    = 220   # Y axis
TRUCK_H_CM    = 220   # Z axis
MAX_WEIGHT_KG = 8000
FRONT_AXLE_LIMIT_KG = 4000   # X in [0, 300]
REAR_AXLE_LIMIT_KG  = 4000   # X in [300, 600]

# Routing parameters
MAX_CLIENTS_PER_CLUSTER = 8
CITY_SPEED_KMH = 30

# Cost function weights  (α·travel + β·tw_penalty + γ·pz_overhead)
ALPHA = 1.0   # travel time weight
BETA  = 2.0   # time-window violation penalty weight
GAMMA = 0.5   # pedestrian walking overhead weight

# Parking coordinates for each pedestrian zone
PEDESTRIAN_ZONE_PARKING = {
    "PZ_CORONA"  : {"lat": 41.6075, "lon": 2.2880},
    "PZ_SANT_ROC": {"lat": 41.6070, "lon": 2.2895},
}

# Access config: per-client unloading difficulty
ACCES_CONFIG = {
    "CAFE DE LA CORONA":         {"temps_descarrega_base_min": 5, "factor_acces": 1.5, "te_moll_carrega": False},
    "LAPONIA CAFE":              {"temps_descarrega_base_min": 5, "factor_acces": 1.5, "te_moll_carrega": False},
    "A VOCADOS":                 {"temps_descarrega_base_min": 5, "factor_acces": 1.5, "te_moll_carrega": False},
    "CAFE SANT ROC":             {"temps_descarrega_base_min": 5, "factor_acces": 1.5, "te_moll_carrega": False},
    "BK GRANOLLERS":             {"temps_descarrega_base_min": 5, "factor_acces": 1.0, "te_moll_carrega": True},
    "Comercial Bebidas Burj SL": {"temps_descarrega_base_min": 5, "factor_acces": 0.7, "te_moll_carrega": True},
}


def calcular_temps_servei(nom: str, num_caixes: int) -> dict:
    """Returns service time (min) + access metadata for a client."""
    acces = ACCES_CONFIG.get(nom, {})
    base   = acces.get("temps_descarrega_base_min", 5)
    moll   = acces.get("te_moll_carrega", False)
    factor = 0.7 if moll else acces.get("factor_acces", 1.0)
    temps  = max(1, int(round(base * factor + num_caixes * 0.5)))
    return {
        "temps_servei_min": temps,
        "factor_acces":     factor,
        "te_moll_carrega":  moll,
    }


# One colour per client stop (assigned in delivery order)
ZONE_COLORS = [
    "#D85A30", "#BA7517", "#3a8c1a", "#0a8a62",
    "#2272cc", "#6b5fc2", "#777",    "#E24B4A",
]

# ── VEHICLE FLEET ─────────────────────────────────────────────────────────────
FLEET = {
    "furgoneta": {
        "name": "Furgoneta", "emoji": "🚐",
        "L_cm": 300, "W_cm": 170, "H_cm": 170,
        "max_kg": 1500, "max_vol_l": 1700, "pallets": 3,
    },
    "camio_6": {
        "name": "Camió 6 t", "emoji": "🚛",
        "L_cm": 450, "W_cm": 210, "H_cm": 210,
        "max_kg": 4000, "max_vol_l": 5000, "pallets": 6,
    },
    "camio_8": {
        "name": "Camió 8 t", "emoji": "🚚",
        "L_cm": 600, "W_cm": 220, "H_cm": 220,
        "max_kg": 8000, "max_vol_l": 9000, "pallets": 8,
    },
}


def assign_vehicle(total_kg: float, total_vol_l: float) -> str:
    """Returns the smallest vehicle type that fits the load."""
    for vtype in ("furgoneta", "camio_6", "camio_8"):
        v = FLEET[vtype]
        if total_kg <= v["max_kg"] and total_vol_l <= v["max_vol_l"]:
            return vtype
    return "camio_8"


# ── DATABASE ─────────────────────────────────────────────────────────────────
def get_db():
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return client[DB_NAME]


# ── HAVERSINE & COST MATRIX ──────────────────────────────────────────────────
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two GPS points (km)."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def travel_min(lat1, lon1, lat2, lon2) -> float:
    """Travel time in minutes at city speed."""
    return haversine_km(lat1, lon1, lat2, lon2) / CITY_SPEED_KMH * 60.0


def arc_cost(i: dict, j: dict, arrival_min: float, pz_overhead: dict) -> float:
    """
    Composite arc cost from node i to node j (minutes):

      cost = α · travel_time(i→j)
           + β · max(0, arrival_at_j - close_min_j)   ← TW violation
           + γ · pedestrian_walk_overhead(j)

    α=1.0 prioritises travel time.
    β=2.0 heavily penalises arriving after closing time.
    γ=0.5 adds half the walking penalty so pedestrian stops are
          slightly less preferred when alternatives exist.
    """
    tt = travel_min(i["lat"], i["lon"], j["lat"], j["lon"])

    # Minutes we'd arrive past the close window (0 if within window)
    tw_viol = max(0.0, arrival_min + tt - j.get("close_min", 1320))

    # Extra walking minutes if j lives in a pedestrian zone
    pz_id = j.get("zona_vianants_id")
    pz_min = pz_overhead.get(pz_id, 0.0) if pz_id else 0.0

    return ALPHA * tt + BETA * tw_viol + GAMMA * pz_min


def build_cost_matrix(nodes: list, pz_overhead: dict) -> list[list[int]]:
    """
    Build integer n×n cost matrix (minutes × 10 for OR-Tools integer arithmetic).
    Node 0 is always the depot.
    """
    n = len(nodes)
    SCALE = 10
    departure = 8 * 60  # assume 08:00 departure from depot
    matrix = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                matrix[i][j] = int(
                    arc_cost(nodes[i], nodes[j], departure, pz_overhead) * SCALE
                )
    return matrix


# ── GEOGRAPHIC CLUSTERING ────────────────────────────────────────────────────
def cluster_clients(clients: list, orders_by_client: dict) -> list[list]:
    """
    Greedy proximity clustering.

    Algorithm:
      1. Sort clients by distance from the depot.
      2. Pick the nearest unassigned client as cluster seed.
      3. Expand with its nearest unassigned neighbours until
         MAX_CLIENTS_PER_CLUSTER or MAX_WEIGHT_KG is reached.
      4. Repeat until all clients are assigned.

    This keeps clusters geographically tight, minimising inter-stop travel.
    """
    def client_kg(c):
        return sum(o["kg_total"] for o in orders_by_client.get(c["nom"], []))

    sorted_c = sorted(
        clients,
        key=lambda c: haversine_km(DEPOT_LAT, DEPOT_LON, c["lat"], c["lon"])
    )
    used = set()
    clusters = []

    for seed in sorted_c:
        if seed["nom"] in used:
            continue
        cluster = [seed]
        cluster_kg = client_kg(seed)
        used.add(seed["nom"])

        neighbours = sorted(
            [c for c in sorted_c if c["nom"] not in used],
            key=lambda c: haversine_km(seed["lat"], seed["lon"], c["lat"], c["lon"])
        )
        for nb in neighbours:
            if len(cluster) >= MAX_CLIENTS_PER_CLUSTER:
                break
            w = client_kg(nb)
            if cluster_kg + w <= MAX_WEIGHT_KG:
                cluster.append(nb)
                cluster_kg += w
                used.add(nb["nom"])

        clusters.append(cluster)

    return clusters


# ── OR-TOOLS CVRPTW SOLVER ───────────────────────────────────────────────────
def solve_cluster_vrp(cluster: list, orders_by_client: dict, pz_overhead: dict) -> list[str]:
    """
    Runs OR-Tools CVRPTW on one cluster.  Returns ordered client names.

    Node layout: 0=depot, 1..n=clients.
    Capacity dimension: kg per truck (MAX_WEIGHT_KG).
    Time dimension: minutes × 10 (integer arithmetic for OR-Tools).
    Time windows: from MongoDB open_min / close_min.
    Search: PATH_CHEAPEST_ARC seed → GUIDED_LOCAL_SEARCH, 5s limit.
    """
    try:
        from ortools.constraint_solver import routing_enums_pb2, pywrapcp
    except ImportError:
        # OR-Tools not available — fall back to nearest-neighbour
        return _nearest_neighbour(cluster)

    if len(cluster) == 1:
        return [cluster[0]["nom"]]

    SCALE = 10  # scale factor: minutes → integer tenths of a minute
    depot_node = {
        "nom": "DEPOT", "lat": DEPOT_LAT, "lon": DEPOT_LON,
        "open_min": 0, "close_min": 24 * 60, "zona_vianants_id": None
    }
    nodes = [depot_node] + cluster
    n = len(nodes)

    cost_matrix = build_cost_matrix(nodes, pz_overhead)

    def transit_cb(from_idx, to_idx):
        return cost_matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    def demand_cb(from_idx):
        idx = manager.IndexToNode(from_idx)
        if idx == 0:
            return 0
        return int(sum(o["kg_total"] for o in orders_by_client.get(nodes[idx]["nom"], [])))

    manager = pywrapcp.RoutingIndexManager(n, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    transit_id = routing.RegisterTransitCallback(transit_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_id)

    # Capacity constraint
    demand_id = routing.RegisterUnaryTransitCallback(demand_cb)
    routing.AddDimensionWithVehicleCapacity(demand_id, 0, [MAX_WEIGHT_KG], True, "Cap")

    # Time-window constraint
    routing.AddDimension(transit_id, 60 * SCALE, 24 * 60 * SCALE, False, "Time")
    time_dim = routing.GetDimensionOrDie("Time")
    for node_idx, node in enumerate(nodes):
        ri = manager.NodeToIndex(node_idx)
        time_dim.CumulVar(ri).SetRange(
            int(node.get("open_min",  0) * SCALE),
            int(node.get("close_min", 24 * 60) * SCALE),
        )

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.seconds = 2

    solution = routing.SolveWithParameters(params)
    if not solution:
        return _nearest_neighbour(cluster)

    route = []
    idx = routing.Start(0)
    while not routing.IsEnd(idx):
        node_idx = manager.IndexToNode(idx)
        if node_idx != 0:
            route.append(nodes[node_idx]["nom"])
        idx = solution.Value(routing.NextVar(idx))
    return route


def _nearest_neighbour(cluster: list) -> list[str]:
    """Greedy nearest-neighbour fallback when OR-Tools is unavailable."""
    unvisited = list(cluster)
    ordered = []
    prev_lat, prev_lon = DEPOT_LAT, DEPOT_LON
    while unvisited:
        nearest = min(
            unvisited,
            key=lambda c: haversine_km(prev_lat, prev_lon, c["lat"], c["lon"])
        )
        ordered.append(nearest["nom"])
        prev_lat, prev_lon = nearest["lat"], nearest["lon"]
        unvisited.remove(nearest)
    return ordered


# ── FASTAPI APP ───────────────────────────────────────────────────────────────
app = FastAPI(title="Damm Smart Truck API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── MODELS ────────────────────────────────────────────────────────────────────
class PackRequest(BaseModel):
    route_id: str

class AssistantRequest(BaseModel):
    question: str
    route_id: str

class StopUpdate(BaseModel):
    estat: str                        # "carregat" | "completat" | "incidencia"
    completion_time: Optional[str] = None   # ISO timestamp (optional)

class ProductLine(BaseModel):
    codi: str
    nom: str
    qty: int
    pes_kg: float
    llarg: float
    ample: float
    alt: float

class ClientOrder(BaseModel):
    nom: str
    adresa: str
    ciutat: str
    open: str   # "HH:MM"
    close: str  # "HH:MM"
    products: list[ProductLine]

class OptimizeRequest(BaseModel):
    clients: Optional[list[ClientOrder]] = None


# ════════════════════════════════════════════════════════════════════════════════
# ENDPOINT 1 · POST /api/optimize
# ════════════════════════════════════════════════════════════════════════════════
@app.post("/api/optimize")
def optimize(body: Optional[OptimizeRequest] = None):
    """
    Full optimization pipeline:
      1. Load Granollers clients + orders from MongoDB (or use custom body).
      2. Build cost matrix (Haversine + TW penalty + pedestrian overhead).
      3. Cluster clients geographically (greedy proximity, ≤8 per truck, ≤8 t).
      4. Solve each cluster with OR-Tools CVRPTW.
      5. Compute estimated arrivals, assign vehicle, persist result.
    """
    try:
        db = get_db()

        # 1. Load clients — use custom body clients or fall back to MongoDB GPS clients
        DEFAULT_LAT = 41.6067
        if body and body.clients:
            # Convert form clients to internal format, geocode from MongoDB if possible
            clients = []
            orders_by_client: dict[str, list] = {}
            for ci in body.clients:
                # Try to look up GPS from MongoDB
                nom = ci.nom.strip().upper()
                db_client = db["clients"].find_one(
                    {"nom": {"$regex": f"^{nom}$", "$options": "i"}}, {"_id": 0}
                )
                lat = db_client["lat"] if db_client and db_client.get("lat") != DEFAULT_LAT else 41.6067
                lon = db_client["lon"] if db_client and db_client.get("lon") else 2.2894
                open_min  = int(ci.open[:2]) * 60 + int(ci.open[3:])
                close_min = int(ci.close[:2]) * 60 + int(ci.close[3:])
                clients.append({
                    "nom": ci.nom, "lat": lat, "lon": lon,
                    "carrer": ci.adresa, "cp": "", "poblacio": ci.ciutat,
                    "open_min": open_min, "close_min": close_min, "service_min": 10,
                    "zona_vianants_id": None,
                })
                total_kg = sum(p.qty * p.pes_kg for p in ci.products)
                total_vol = sum(p.qty * p.llarg * p.ample * p.alt / 1000 for p in ci.products)
                orders_by_client[ci.nom] = [{
                    "entrega_id": f"FORM-{ci.nom[:8]}-001",
                    "client_nom": ci.nom,
                    "kg_total": total_kg,
                    "vol_total_l": total_vol,
                    "linies": [
                        {
                            "material": p.codi or "MANUAL",
                            "nom": p.nom,
                            "quantitat": p.qty,
                            "unitat": "CAJ",
                            "pes_kg": p.qty * p.pes_kg,
                        }
                        for p in ci.products
                    ],
                }]
        else:
            clients = list(db["clients"].find(
                {"poblacio": "Granollers", "lat": {"$ne": DEFAULT_LAT}},
                {"_id": 0}
            ))
            if not clients:
                raise HTTPException(404, "No Granollers clients with real GPS found")
            # Load and index orders by client name
            raw_orders = list(db["orders"].find({"poblacio": "Granollers"}, {"_id": 0}))
            orders_by_client = {}
            for o in raw_orders:
                orders_by_client.setdefault(o["client_nom"], []).append(o)

        # 2. Load pedestrian zone average walking times for cost matrix
        pz_docs = list(db["pedestrian_zones"].find({}, {"_id": 0}))
        pz_overhead: dict[str, float] = {}
        for pz in pz_docs:
            walks = list(pz["minuts_a_peu"].values())
            pz_overhead[pz["zone_id"]] = sum(walks) / len(walks) if walks else 0

        # 4. Cluster and solve
        clusters = cluster_clients(clients, orders_by_client)

        route_id     = str(uuid.uuid4())[:8].upper()
        all_stops    = []
        stop_order   = 0
        total_km     = 0.0
        total_min    = 0.0
        total_kg     = 0.0
        current_time = 8 * 60   # 08:00 departure from depot

        for cluster_idx, cluster in enumerate(clusters):
            ordered_noms = solve_cluster_vrp(cluster, orders_by_client, pz_overhead)

            prev_lat, prev_lon = DEPOT_LAT, DEPOT_LON

            for nom in ordered_noms:
                cdata = next((c for c in clients if c["nom"] == nom), None)
                if not cdata:
                    continue

                # Pedestrian zone: truck parks at zone parking spot
                pz_id = cdata.get("zona_vianants_id")
                if pz_id and pz_id in PEDESTRIAN_ZONE_PARKING:
                    stop_lat = PEDESTRIAN_ZONE_PARKING[pz_id]["lat"]
                    stop_lon = PEDESTRIAN_ZONE_PARKING[pz_id]["lon"]
                else:
                    stop_lat = cdata["lat"]
                    stop_lon = cdata["lon"]

                # Load orders + compute service time before ETA calc
                client_orders = orders_by_client.get(nom, [])
                weight = sum(o["kg_total"] for o in client_orders)
                volume = sum(o["vol_total_l"] for o in client_orders)
                num_caixes = sum(
                    int(linia.get("quantitat", 0))
                    for o in client_orders
                    for linia in o.get("linies", [])
                )
                servei = calcular_temps_servei(nom, num_caixes)

                # Travel from previous stop
                dist_km   = haversine_km(prev_lat, prev_lon, stop_lat, stop_lon)
                travel    = dist_km / CITY_SPEED_KMH * 60.0
                arrival   = current_time + travel
                # Wait if we arrive before opening time
                arrival   = max(arrival, cdata.get("open_min", 480))
                departure = arrival + servei["temps_servei_min"]

                # Walking time for this specific client in the zone
                pz_walk = 0
                for pz in pz_docs:
                    if nom in pz.get("client_noms", []):
                        pz_walk = pz["minuts_a_peu"].get(nom, 0)
                        break

                all_stops.append({
                    "order"              : stop_order,
                    "cluster"            : cluster_idx,
                    "client_nom"         : nom,
                    "carrer"             : cdata.get("carrer", ""),
                    "cp"                 : cdata.get("cp", ""),
                    "poblacio"           : "Granollers",
                    "lat"                : cdata["lat"],
                    "lon"                : cdata["lon"],
                    "stop_lat"           : stop_lat,
                    "stop_lon"           : stop_lon,
                    "time_window"        : {
                        "open_min" : cdata.get("open_min", 480),
                        "close_min": cdata.get("close_min", 1320),
                    },
                    "estimated_arrival"  : int(arrival),
                    "estimated_departure": int(departure),
                    "service_min"        : servei["temps_servei_min"],
                    "temps_servei_min"   : servei["temps_servei_min"],
                    "factor_acces"       : servei["factor_acces"],
                    "te_moll_carrega"    : servei["te_moll_carrega"],
                    "pedestrian_zone"    : {
                        "zone_id"    : pz_id,
                        "parking_lat": stop_lat,
                        "parking_lon": stop_lon,
                        "walk_min"   : pz_walk,
                    } if pz_id else None,
                    "weight_kg"          : round(weight, 2),
                    "volume_l"           : round(volume, 2),
                    "orders"             : [o["entrega_id"] for o in client_orders],
                    "estat"              : "pending",
                    "zone_truck_cm"      : None,    # filled by /api/pack-truck
                    "color"              : ZONE_COLORS[stop_order % len(ZONE_COLORS)],
                })

                total_km  += dist_km
                total_min += travel + servei["temps_servei_min"]
                total_kg  += weight
                current_time = departure
                prev_lat, prev_lon = stop_lat, stop_lon
                stop_order += 1

        total_vol_l = sum(s.get("volume_l", 0) for s in all_stops)
        vehicle_type = assign_vehicle(total_kg, total_vol_l)
        vehicle      = FLEET[vehicle_type]
        capacity_pct = round(total_kg / vehicle["max_kg"] * 100, 1)

        kpis = {
            "total_km"    : round(total_km, 2),
            "total_min"   : round(total_min, 2),
            "weight_kg"   : round(total_kg, 2),
            "n_stops"     : len(all_stops),
            "n_clusters"  : len(clusters),
            "vehicle_type": vehicle_type,
            "vehicle_name": vehicle["name"],
            "vehicle_emoji": vehicle["emoji"],
            "pallets_used": min(len(all_stops), vehicle["pallets"]),
            "pallets_total": vehicle["pallets"],
            "capacity_pct": capacity_pct,
        }

        # 5. Persist to MongoDB
        db["routes"].insert_one({
            "route_id"    : route_id,
            "created_at"  : datetime.datetime.utcnow(),
            "status"      : "optimized",
            "depot"       : {"lat": DEPOT_LAT, "lon": DEPOT_LON, "nom": "DDI Mollet"},
            "stops"       : all_stops,
            "kpis"        : kpis,
            "truck_loading": None,
        })

        return {"route_id": route_id, "stops": all_stops, "kpis": kpis}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ════════════════════════════════════════════════════════════════════════════════
# ENDPOINT 2 · POST /api/pack-truck
# ════════════════════════════════════════════════════════════════════════════════
@app.post("/api/pack-truck")
def pack_truck(req: PackRequest):
    """
    FFD-LIFO 3D bin packing.

    LIFO principle: the last delivery stop must be FIRST loaded (deepest in truck).
      → We iterate stops in REVERSE delivery order.

    FFD (First Fit Decreasing): within each client, boxes are sorted by
      volume descending so large boxes are placed first, minimising waste.

    Packing coordinate system:
      X: 0=door → 600cm=back wall  (depth, advances per layer)
      Y: 0 → 220cm                  (width, filled first)
      Z: 0 → 220cm                  (height, stacked when Y full)

    Axle weight split:
      Front axle = boxes whose centre X ∈ [0, 300)
      Rear  axle = boxes whose centre X ∈ [300, 600]
      Boxes spanning both: weight split proportionally by overlap.
    """
    try:
        db = get_db()
        route = db["routes"].find_one({"route_id": req.route_id}, {"_id": 0})
        if not route:
            raise HTTPException(404, "Route not found")

        stops = route["stops"]

        # Pre-load dimension + weight catalogue
        products = {p["codi"]: p for p in db["products"].find({}, {"_id": 0})}
        # Index all orders by entrega_id for fast lookup
        all_eids = [eid for s in stops for eid in s.get("orders", [])]
        orders   = {
            o["entrega_id"]: o
            for o in db["orders"].find({"entrega_id": {"$in": all_eids}}, {"_id": 0})
        }

        # Packing state
        current_x      = 0.0   # depth cursor: advances as clients fill the truck
        axle_front_kg  = 0.0
        axle_rear_kg   = 0.0
        vol_used_cm3   = 0.0
        truck_zones    = []    # one entry per client, in LOADING order

        # LIFO: reverse so last-delivery client is loaded first (deepest)
        for stop in reversed(stops):
            nom = stop["client_nom"]

            # ── Gather and sort boxes (FFD: volume descending) ────────────────
            boxes = []
            for eid in stop.get("orders", []):
                order = orders.get(eid)
                if not order:
                    continue
                for linia in order.get("linies", []):
                    prod = products.get(linia["material"])
                    if not prod:
                        continue
                    l = float(prod.get("llarg_cm", 0))
                    a = float(prod.get("ample_cm", 0))
                    h = float(prod.get("alt_cm",   0))
                    v = float(prod.get("volum_l",  0))
                    w = float(prod.get("pes_kg",   0))
                    qty = int(linia.get("quantitat", 0))
                    if l > 0 and a > 0 and h > 0 and qty > 0:
                        for _ in range(qty):
                            boxes.append({"l": l, "a": a, "h": h, "v": v, "w": w})

            if not boxes:
                truck_zones.append({
                    "client_nom"  : nom,
                    "zone_x_start": round(current_x, 1),
                    "zone_x_end"  : round(current_x, 1),
                    "boxes_n"     : 0,
                    "weight_kg"   : 0.0,
                    "color"       : stop.get("color", "#777"),
                })
                continue

            # FFD: biggest volume first
            boxes.sort(key=lambda b: b["v"], reverse=True)

            # ── Layer packing within this client's zone ───────────────────────
            # Each "layer" is a slab of constant X-depth equal to one box length.
            zone_x_start   = current_x
            cursor_y       = 0.0
            cursor_z       = 0.0
            layer_depth    = 0.0   # max box length in current layer
            row_height     = 0.0   # max box height in current Y-row
            client_weight  = 0.0
            boxes_placed   = 0

            for box in boxes:
                bl, ba, bh = box["l"], box["a"], box["h"]

                # Can this box fit in the current Y position?
                if cursor_y + ba > TRUCK_W_CM:
                    # Move to next row: reset Y, advance Z
                    cursor_y   = 0.0
                    cursor_z  += row_height
                    row_height = 0.0

                # Can this box fit in the current Z position?
                if cursor_z + bh > TRUCK_H_CM:
                    # Start a new X layer: advance X cursor
                    current_x  += layer_depth
                    layer_depth = 0.0
                    cursor_y    = 0.0
                    cursor_z    = 0.0
                    row_height  = 0.0

                # Does this box fit within truck length?
                if current_x + bl > TRUCK_L_CM:
                    break   # truck full; skip remaining boxes

                # ── Place box at (current_x, cursor_y, cursor_z) ─────────────
                bx_start = current_x
                bx_end   = current_x + bl
                bx_mid   = (bx_start + bx_end) / 2.0   # centre of box on X

                # Axle weight: proportional split if box crosses X=300
                if bx_end <= 300:
                    axle_front_kg += box["w"]
                elif bx_start >= 300:
                    axle_rear_kg  += box["w"]
                else:
                    front_frac = (300.0 - bx_start) / bl
                    axle_front_kg += box["w"] * front_frac
                    axle_rear_kg  += box["w"] * (1.0 - front_frac)

                cursor_y      += ba
                row_height     = max(row_height, bh)
                layer_depth    = max(layer_depth, bl)
                client_weight += box["w"]
                vol_used_cm3  += bl * ba * bh
                boxes_placed  += 1

            # Advance X cursor past this client's zone
            if layer_depth > 0:
                current_x += layer_depth

            truck_zones.append({
                "client_nom"  : nom,
                "zone_x_start": round(zone_x_start, 1),
                "zone_x_end"  : round(current_x, 1),
                "boxes_n"     : boxes_placed,
                "weight_kg"   : round(client_weight, 1),
                "color"       : stop.get("color", "#777"),
            })

        # ── KPIs ──────────────────────────────────────────────────────────────
        truck_vol_cm3    = TRUCK_L_CM * TRUCK_W_CM * TRUCK_H_CM
        efficiency_pct   = round(vol_used_cm3 / truck_vol_cm3 * 100, 1)
        axle_warning     = axle_front_kg > FRONT_AXLE_LIMIT_KG or axle_rear_kg > REAR_AXLE_LIMIT_KG

        # truck_zones is currently in loading order; flip to delivery order for response
        zones_delivery = list(reversed(truck_zones))
        zone_by_client = {z["client_nom"]: z for z in zones_delivery}

        # Stamp truck zone info onto each stop
        for stop in stops:
            z = zone_by_client.get(stop["client_nom"])
            if z:
                stop["zone_truck_cm"] = {
                    "x_start": z["zone_x_start"],
                    "x_end"  : z["zone_x_end"],
                    "color"  : z["color"],
                }

        truck_loading = {
            "truck_zones"   : zones_delivery,
            "axle_front_kg" : round(axle_front_kg, 1),
            "axle_rear_kg"  : round(axle_rear_kg, 1),
            "axle_warning"  : axle_warning,
            "efficiency_pct": efficiency_pct,
            "loaded_at"     : datetime.datetime.utcnow(),
        }

        db["routes"].update_one(
            {"route_id": req.route_id},
            {"$set": {"truck_loading": truck_loading, "stops": stops, "status": "packed"}}
        )

        return {
            "route_id"      : req.route_id,
            "truck_zones"   : zones_delivery,
            "axle_front_kg" : round(axle_front_kg, 1),
            "axle_rear_kg"  : round(axle_rear_kg, 1),
            "axle_warning"  : axle_warning,
            "efficiency_pct": efficiency_pct,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ════════════════════════════════════════════════════════════════════════════════
# ENDPOINT 3 · GET /api/route/{route_id}
# ════════════════════════════════════════════════════════════════════════════════
@app.get("/api/route/{route_id}")
def get_route(route_id: str):
    """
    Driver mobile view.  Returns all stop info formatted for direct React rendering:
    human-readable time strings, address, GPS, pedestrian zone details, truck zone.
    """
    try:
        db = get_db()
        route = db["routes"].find_one({"route_id": route_id}, {"_id": 0})
        if not route:
            raise HTTPException(404, "Route not found")

        def min_to_str(m: int) -> str:
            return f"{m // 60:02d}:{m % 60:02d}"

        driver_stops = []
        for stop in route["stops"]:
            arr  = stop.get("estimated_arrival", 0)
            dep  = stop.get("estimated_departure", 0)
            tw   = stop.get("time_window", {})
            pz   = stop.get("pedestrian_zone")
            zone = stop.get("zone_truck_cm")

            driver_stops.append({
                "order"            : stop["order"],
                "client_nom"       : stop["client_nom"],
                "adresa"           : f"{stop.get('carrer', '')} — {stop.get('cp', '')} Granollers",
                "lat"              : stop["lat"],
                "lon"              : stop["lon"],
                "time_window"      : {
                    "open" : min_to_str(tw.get("open_min",  480)),
                    "close": min_to_str(tw.get("close_min", 1320)),
                },
                "estimated_arrival"  : min_to_str(arr),
                "estimated_departure": min_to_str(dep),
                "weight_kg"          : stop.get("weight_kg", 0),
                "estat"              : stop.get("estat", "pending"),
                "pedestrian_zone"    : {
                    "zone_id"    : pz["zone_id"],
                    "parking_lat": pz["parking_lat"],
                    "parking_lon": pz["parking_lon"],
                    "walk_min"   : pz["walk_min"],
                    "note"       : f"Aparca i camina {pz['walk_min']} min fins al client",
                } if pz else None,
                "truck_zone"         : {
                    "x_start_cm": zone["x_start"],
                    "x_end_cm"  : zone["x_end"],
                    "color"     : zone["color"],
                    "note"      : f"Caixes entre {zone['x_start']}–{zone['x_end']} cm del camió",
                } if zone else None,
            })

        return {
            "route_id": route_id,
            "status"  : route.get("status"),
            "depot"   : route.get("depot"),
            "stops"   : driver_stops,
            "kpis"    : route.get("kpis"),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ════════════════════════════════════════════════════════════════════════════════
# ENDPOINT 4 · PUT /api/stop/{stop_id}
# ════════════════════════════════════════════════════════════════════════════════
@app.put("/api/stop/{stop_id}")
def update_stop(stop_id: int, body: StopUpdate):
    """
    Updates a stop's estat (status).

    Valid values:
      "carregat"   — boxes loaded onto truck at warehouse
      "completat"  — delivery confirmed by driver
      "incidencia" — delivery problem reported

    If estat="completat", recalculates ETAs for all subsequent pending stops
    using the actual current time as the new departure baseline.
    """
    if body.estat not in ("carregat", "completat", "incidencia"):
        raise HTTPException(400, "estat must be 'carregat', 'completat' or 'incidencia'")

    try:
        db = get_db()
        route = db["routes"].find_one({"stops.order": stop_id}, {"_id": 0})
        if not route:
            raise HTTPException(404, f"Stop {stop_id} not found in any route")

        stops      = route["stops"]
        updated_etas = []
        next_stop    = None

        # Apply status update
        for stop in stops:
            if stop["order"] == stop_id:
                stop["estat"] = body.estat
                if body.estat == "completat":
                    stop["actual_completion"] = datetime.datetime.utcnow().isoformat()

        # Recalculate downstream ETAs when a stop is marked completed
        if body.estat == "completat":
            current_stop = next(s for s in stops if s["order"] == stop_id)
            now = datetime.datetime.utcnow()
            # Use actual wall-clock time as new baseline
            current_time = now.hour * 60 + now.minute
            prev_lat = current_stop.get("stop_lat", current_stop["lat"])
            prev_lon = current_stop.get("stop_lon", current_stop["lon"])

            pending = sorted(
                [s for s in stops if s["order"] > stop_id and s["estat"] == "pending"],
                key=lambda s: s["order"]
            )
            for s in pending:
                sl = s.get("stop_lat", s["lat"])
                sk = s.get("stop_lon", s["lon"])
                travel   = travel_min(prev_lat, prev_lon, sl, sk)
                arrival  = max(current_time + travel, s["time_window"]["open_min"])
                s["estimated_arrival"]   = int(arrival)
                s["estimated_departure"] = int(arrival + s.get("service_min", 10))
                updated_etas.append({
                    "order"             : s["order"],
                    "client_nom"        : s["client_nom"],
                    "estimated_arrival" : f"{int(arrival)//60:02d}:{int(arrival)%60:02d}",
                })
                current_time = arrival + s.get("service_min", 10)
                prev_lat, prev_lon = sl, sk

            if pending:
                ns = pending[0]
                next_stop = {
                    "order"     : ns["order"],
                    "client_nom": ns["client_nom"],
                    "adresa"    : f"{ns.get('carrer','')} {ns.get('cp','')}",
                }

        db["routes"].update_one(
            {"route_id": route["route_id"]},
            {"$set": {"stops": stops}}
        )

        return {
            "ok"          : True,
            "route_id"    : route["route_id"],
            "stop_id"     : stop_id,
            "new_estat"   : body.estat,
            "next_stop"   : next_stop,
            "updated_etas": updated_etas,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ════════════════════════════════════════════════════════════════════════════════
# ENDPOINT 5 · GET /api/warehouse/{route_id}
# ════════════════════════════════════════════════════════════════════════════════
@app.get("/api/warehouse/{route_id}")
def warehouse(route_id: str):
    """
    Warehouse tablet loading checklist.

    Returns stops in LOADING order (= reverse delivery order, LIFO).
    Each entry shows: colour-coded truck zone, X coordinates, full product list,
    total weight, and a flag for pedestrian-zone stops.

    This view drives the warehouse worker who physically loads the truck:
    they load from the back, starting with the last delivery's boxes.
    """
    try:
        db = get_db()
        route = db["routes"].find_one({"route_id": route_id}, {"_id": 0})
        if not route:
            raise HTTPException(404, "Route not found")

        products = {p["codi"]: p for p in db["products"].find({}, {"_id": 0})}
        all_eids = [eid for s in route["stops"] for eid in s.get("orders", [])]
        orders   = {
            o["entrega_id"]: o
            for o in db["orders"].find({"entrega_id": {"$in": all_eids}}, {"_id": 0})
        }

        truck_loading = route.get("truck_loading") or {}
        zone_by_client: dict = {}
        for z in truck_loading.get("truck_zones", []):
            zone_by_client[z["client_nom"]] = z

        # Loading order = reverse delivery order
        loading_stops = list(reversed(route["stops"]))
        checklist = []

        for seq, stop in enumerate(loading_stops, start=1):
            nom  = stop["client_nom"]
            zone = zone_by_client.get(nom, {})

            # Build per-product lines for the warehouse picker
            product_lines = []
            for eid in stop.get("orders", []):
                order = orders.get(eid)
                if not order:
                    continue
                for linia in order.get("linies", []):
                    prod = products.get(linia["material"], {})
                    product_lines.append({
                        "codi"     : linia["material"],
                        "nom"      : linia.get("nom", linia["material"]),
                        "quantitat": linia.get("quantitat", 0),
                        "unitat"   : linia.get("unitat", "CAJ"),
                        "pes_kg"   : round(linia.get("pes_kg", 0), 1),
                        "llarg_cm" : prod.get("llarg_cm", 0),
                        "ample_cm" : prod.get("ample_cm", 0),
                        "alt_cm"   : prod.get("alt_cm",   0),
                    })

            pz = stop.get("pedestrian_zone")
            checklist.append({
                "loading_seq"       : seq,
                "delivery_order"    : stop["order"],
                "client_nom"        : nom,
                "adresa"            : f"{stop.get('carrer','')} — {stop.get('cp','')}",
                "zone_color"        : zone.get("color", "#777"),
                "zone_x_start"      : zone.get("zone_x_start", 0),
                "zone_x_end"        : zone.get("zone_x_end",   0),
                "boxes_n"           : zone.get("boxes_n", 0),
                "weight_kg"         : round(stop.get("weight_kg", 0), 1),
                "is_pedestrian"     : pz is not None,
                "pedestrian_zone_id": pz["zone_id"] if pz else None,
                "temps_servei_min"  : stop.get("temps_servei_min", 5),
                "factor_acces"      : stop.get("factor_acces", 1.0),
                "te_moll_carrega"   : stop.get("te_moll_carrega", False),
                "products"          : product_lines,
            })

        return {
            "route_id"     : route_id,
            "loading_order": checklist,
            "axle_front_kg": truck_loading.get("axle_front_kg"),
            "axle_rear_kg" : truck_loading.get("axle_rear_kg"),
            "axle_warning" : truck_loading.get("axle_warning"),
            "efficiency_pct": truck_loading.get("efficiency_pct"),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ════════════════════════════════════════════════════════════════════════════════
# ASSISTANT · POST /api/assistant
# ════════════════════════════════════════════════════════════════════════════════
@app.post("/api/assistant")
def assistant(req: AssistantRequest):
    """
    Calls Gemini 1.5 Flash with route context from MongoDB.

    Context built for Gemini:
      - Depot and total KPIs (km, stops, weight)
      - Ordered stop list: position, client, address, time window,
        estimated arrival, truck zone, pedestrian zone details
      - Current stop statuses (pending / completat / incidencia)

    The model is instructed to answer in Catalan, acting as a
    logistics assistant for the Damm truck driver.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(500, "GEMINI_API_KEY not configured")
    try:
        db = get_db()
        route = db["routes"].find_one({"route_id": req.route_id}, {"_id": 0})
        if not route:
            raise HTTPException(404, f"Route {req.route_id} not found")

        stops = route.get("stops", [])
        kpis  = route.get("kpis", {})

        # ── Build a compact text context for Gemini ───────────────────────────
        lines = [
            "Ets l'assistent de logistics del camió Damm Smart Truck.",
            "Respon sempre en català, de forma breu i concreta (màxim 3 frases).",
            "",
            f"Ruta ID: {req.route_id}",
            f"Dipòsit: DDI Mollet del Vallès",
            f"KPIs: {kpis.get('n_stops','?')} parades · "
            f"{kpis.get('total_km','?')} km · "
            f"{kpis.get('weight_kg','?')} kg càrrega total",
            "",
            "PARADES (en ordre de lliurament):",
        ]

        for s in stops:
            tw  = s.get("time_window", {})
            pz  = s.get("pedestrian_zone")
            zon = s.get("zone_truck_cm")
            arr = s.get("estimated_arrival", 0)
            arr_str = f"{arr // 60:02d}:{arr % 60:02d}"

            line = (
                f"  #{s['order'] + 1} [{s.get('estat','pending').upper()}] "
                f"{s['client_nom']} · {s.get('carrer','')} · "
                f"Finestra: {tw.get('open_min',480)//60:02d}h–{tw.get('close_min',1320)//60:02d}h · "
                f"Arr. estimada: {arr_str} · "
                f"Pes: {s.get('weight_kg',0):.0f} kg"
            )
            if pz:
                line += f" · ZONA VIANANTS {pz['zone_id']} ({pz['walk_min']} min a peu)"
            if zon:
                line += f" · Camió X {zon['x_start']}–{zon['x_end']} cm"
            lines.append(line)

        context = "\n".join(lines)

        # ── Call Gemini 1.5 Flash via REST ────────────────────────────────────
        payload = {
            "contents": [{
                "parts": [
                    {"text": context},
                    {"text": f"\nPregunta del conductor: {req.question}"},
                ]
            }],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 200,
            },
        }

        resp = http_requests.post(
            GEMINI_URL,
            params={"key": GEMINI_API_KEY},
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        answer = (
            data["candidates"][0]["content"]["parts"][0]["text"]
            .strip()
        )
        return {"answer": answer, "route_id": req.route_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Gemini error: {e}")


# ════════════════════════════════════════════════════════════════════════════════
# ENDPOINT 6 · GET /api/products
# ════════════════════════════════════════════════════════════════════════════════
@app.get("/api/products")
def get_products():
    """Returns all products from MongoDB (codi, nom, dimensions, weight)."""
    try:
        db = get_db()
        products = list(db["products"].find(
            {},
            {"_id": 0, "codi": 1, "nom": 1, "llarg_cm": 1, "ample_cm": 1, "alt_cm": 1, "pes_kg": 1, "volum_l": 1}
        ).limit(500))
        return {"products": products, "total": len(products)}
    except Exception as e:
        raise HTTPException(500, str(e))


# ════════════════════════════════════════════════════════════════════════════════
# ENDPOINT 7 · GET /api/clients
# ════════════════════════════════════════════════════════════════════════════════
@app.get("/api/clients")
def get_clients():
    """
    Returns all real-GPS Granollers clients with their orders, formatted
    for the Orders form (nom, adresa, open/close times, products list).
    """
    try:
        db = get_db()
        DEFAULT_LAT = 41.6067
        clients = list(db["clients"].find(
            {"poblacio": "Granollers", "lat": {"$ne": DEFAULT_LAT}},
            {"_id": 0}
        ))
        products = {p["codi"]: p for p in db["products"].find({}, {"_id": 0})}

        def min_to_hhmm(m):
            return f"{m // 60:02d}:{m % 60:02d}"

        result = []
        for c in clients:
            nom = c["nom"]
            raw_orders = list(db["orders"].find({"client_nom": nom}, {"_id": 0}))
            product_lines = []
            for o in raw_orders:
                for linia in o.get("linies", []):
                    prod = products.get(linia["material"], {})
                    product_lines.append({
                        "codi"   : linia["material"],
                        "nom"    : linia.get("nom", linia["material"]),
                        "qty"    : int(linia.get("quantitat", 1)),
                        "pes_kg" : round(float(prod.get("pes_kg", 0)), 2),
                        "llarg"  : round(float(prod.get("llarg_cm", 0)), 1),
                        "ample"  : round(float(prod.get("ample_cm", 0)), 1),
                        "alt"    : round(float(prod.get("alt_cm", 0)), 1),
                    })

            result.append({
                "nom"    : nom,
                "adresa" : c.get("carrer", ""),
                "ciutat" : "Granollers",
                "open"   : min_to_hhmm(c.get("open_min", 480)),
                "close"  : min_to_hhmm(c.get("close_min", 1320)),
                "products": product_lines[:20],  # cap at 20 products per client
            })

        return {"clients": result}
    except Exception as e:
        raise HTTPException(500, str(e))


# ════════════════════════════════════════════════════════════════════════════════
# HEALTH CHECK · GET /api/health
# ════════════════════════════════════════════════════════════════════════════════
@app.get("/api/health")
def health():
    """Ping MongoDB Atlas and return document counts per collection."""
    try:
        db = get_db()
        db.command("ping")
        counts = {
            col: db[col].count_documents({})
            for col in ["clients", "products", "orders", "pedestrian_zones", "routes"]
        }
        return {"status": "ok", "mongo": "connected", "collections": counts}
    except Exception as e:
        raise HTTPException(503, f"MongoDB unreachable: {e}")


# ── ENTRY POINT ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

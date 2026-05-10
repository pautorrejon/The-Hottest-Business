import React from "react";

const VEHICLE_LAYOUTS = {
  furgoneta: { rows: 1, cols: 3 },
  camio_6:   { rows: 2, cols: 3 },
  camio_8:   { rows: 2, cols: 4 },
};

const TW = 90;   // tile width (px)
const TH = 45;   // tile height = TW/2 for 2:1 isometric
const BH = 38;   // box height

function isoPoint(col, row, z, originX, originY) {
  return {
    x: originX + (col - row) * TW / 2,
    y: originY + (col + row) * TH / 2 - z * BH,
  };
}

function pts(arr) {
  return arr.map(p => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(" ");
}

function expandHex(hex) {
  const h = hex.replace("#", "");
  return h.length === 3
    ? "#" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    : "#" + h.padEnd(6, "0");
}

function shade(hex, factor) {
  try {
    const expanded = expandHex(hex);
    const num = parseInt(expanded.slice(1), 16);
    const r = Math.min(255, Math.round(((num >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.round(((num >> 8)  & 0xff) * factor));
    const b = Math.min(255, Math.round((num & 0xff)         * factor));
    return `rgb(${r},${g},${b})`;
  } catch {
    return hex;
  }
}

function PalletBox({ col, row, originX, originY, color, label, dimmed }) {
  const op = dimmed ? 0.3 : 1;

  // 4 top-face corners (z=1)
  const tl = isoPoint(col,   row,   1, originX, originY);
  const tr = isoPoint(col+1, row,   1, originX, originY);
  const br = isoPoint(col+1, row+1, 1, originX, originY);
  const bl = isoPoint(col,   row+1, 1, originX, originY);

  // Bottom edge (z=0) for visible side faces
  const tl0 = isoPoint(col,   row,   0, originX, originY);
  const br0 = isoPoint(col+1, row+1, 0, originX, originY);
  const bl0 = isoPoint(col,   row+1, 0, originX, originY);

  const topC   = color;
  const leftC  = shade(color, 0.72);  // left face (row+1 side)
  const rightC = shade(color, 0.52);  // right face (col+1 side)

  // Label position: center of top face
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + br.y) / 2;
  const shortLabel = label && label.length > 9 ? label.slice(0, 8) + "…" : label;

  return (
    <g opacity={op}>
      {/* Left face — row+1 side, visible bottom-left */}
      <polygon points={pts([tl, bl, bl0, tl0])} fill={leftC} stroke="rgba(0,0,0,0.15)" strokeWidth={0.5} />
      {/* Right face — col+1 side, visible bottom-right */}
      <polygon points={pts([bl, br, br0, bl0])} fill={rightC} stroke="rgba(0,0,0,0.15)" strokeWidth={0.5} />
      {/* Top face */}
      <polygon points={pts([tl, tr, br, bl])} fill={topC} stroke="rgba(255,255,255,0.3)" strokeWidth={0.5} />
      {/* Label */}
      {shortLabel && (
        <text x={cx} y={cy + 3} textAnchor="middle"
          fontSize={Math.min(11, TW / 7)} fill="#fff" fontWeight="700"
          style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6))" }}>
          {shortLabel}
        </text>
      )}
    </g>
  );
}

function EmptySlot({ col, row, originX, originY }) {
  const tl = isoPoint(col,   row,   0, originX, originY);
  const tr = isoPoint(col+1, row,   0, originX, originY);
  const br = isoPoint(col+1, row+1, 0, originX, originY);
  const bl = isoPoint(col,   row+1, 0, originX, originY);
  return (
    <polygon points={pts([tl, tr, br, bl])}
      fill="#f2f2f2" stroke="#ccc" strokeWidth={1} strokeDasharray="4,3" />
  );
}

export default function IsometricTruckSVG({ zones = [], vehicleType = "camio_8", checkedClients = new Set(), highlightIdx = null }) {
  const layout = VEHICLE_LAYOUTS[vehicleType] || VEHICLE_LAYOUTS.camio_8;
  const { rows, cols } = layout;

  const PAD = 14;
  const originX = PAD + rows * TW / 2;
  const originY = PAD + BH + 4;

  const svgW = PAD * 2 + (cols + rows) * TW / 2;
  const svgH = PAD + BH + (cols + rows) * TH / 2 + 22;

  // Assign zones to pallet positions.
  // zones[0] = first loaded (LIFO) = deepest = back of truck (high col).
  // We fill: col=COLS-1..0, for each col row=0..ROWS-1.
  const pallets = [];
  let zIdx = 0;
  for (let c = cols - 1; c >= 0; c--) {
    for (let r = 0; r < rows; r++) {
      pallets.push({ col: c, row: r, zone: zones[zIdx] || null, zIdx, depth: c + r });
      zIdx++;
    }
  }

  // Painter's algorithm: draw smallest (col+row) first (back of isometric grid)
  pallets.sort((a, b) => a.depth - b.depth);

  // Truck floor outline
  const wallTL = isoPoint(0,    0,    0, originX, originY);
  const wallTR = isoPoint(cols, 0,    0, originX, originY);
  const wallBR = isoPoint(cols, rows, 0, originX, originY);
  const wallBL = isoPoint(0,    rows, 0, originX, originY);

  const doorPt = isoPoint(0,      rows / 2, 0, originX, originY);
  const cabPt  = isoPoint(cols,   rows / 2, 0, originX, originY);

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" style={{ display: "block" }}>
      {/* Floor background */}
      <polygon points={pts([wallTL, wallTR, wallBR, wallBL])}
        fill="#fafafa" stroke="#aaa" strokeWidth={2} />

      {pallets.map((p, i) => (
        p.zone
          ? <PalletBox key={i}
              col={p.col} row={p.row}
              originX={originX} originY={originY}
              color={p.zone.color || "#888"}
              label={p.zone.client_nom?.split(" ")[0]}
              dimmed={checkedClients.has(p.zone.client_nom)}
            />
          : <EmptySlot key={i}
              col={p.col} row={p.row}
              originX={originX} originY={originY}
            />
      ))}

      {/* Highlight ring on currently active step */}
      {highlightIdx !== null && pallets[highlightIdx] && (() => {
        const { col, row } = pallets[highlightIdx];
        const tl = isoPoint(col,   row,   1, originX, originY);
        const tr = isoPoint(col+1, row,   1, originX, originY);
        const br = isoPoint(col+1, row+1, 1, originX, originY);
        const bl = isoPoint(col,   row+1, 1, originX, originY);
        return (
          <polygon points={pts([tl, tr, br, bl])}
            fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="5,3" opacity={0.9} />
        );
      })()}

      {/* Floor labels */}
      <text x={doorPt.x} y={svgH - 3} textAnchor="middle" fontSize={9} fill="#888">← PORTA</text>
      <text x={cabPt.x}  y={svgH - 3} textAnchor="middle" fontSize={9} fill="#888">CABINA →</text>
    </svg>
  );
}

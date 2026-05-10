import React from "react";

const TRUCK_CM = 600;
const RETORN_FRAC = 0.10;  // right 10% reserved for retornables

export default function TruckSVG({ zones = [], checkedClients = new Set(), highlightClient = null }) {
  const W = 900, H = 190;
  const PAD = 8;
  const BAR_Y = 28, BAR_H = 118;
  const TOTAL_W = W - PAD * 2;
  // Client area occupies left 90%; retornables occupy right 10%
  const CLIENT_W = TOTAL_W * (1 - RETORN_FRAC);
  const RETORN_X = PAD + CLIENT_W;

  // Scale cm → px within the client area
  function xs(cm) { return PAD + (cm / TRUCK_CM) * CLIENT_W; }

  const midY = BAR_Y + BAR_H / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>

      {/* Truck body outline */}
      <rect x={PAD} y={BAR_Y} width={TOTAL_W} height={BAR_H}
        fill="#f9f9f9" stroke="#333" strokeWidth={2} rx={5} />

      {/* Axle midpoint dashed line at 300cm */}
      <line x1={xs(300)} y1={BAR_Y} x2={xs(300)} y2={BAR_Y + BAR_H}
        stroke="#ccc" strokeWidth={1.5} strokeDasharray="6,4" />
      <text x={xs(300)} y={BAR_Y - 6} textAnchor="middle" fontSize={9} fill="#bbb">eix central</text>

      {/* Client zones */}
      {zones.map((z, i) => {
        const x1 = xs(z.zone_x_start);
        const x2 = xs(z.zone_x_end);
        const bw = Math.max(x2 - x1, 3);
        if (bw < 1) return null;

        const dimmed     = checkedClients.has(z.client_nom);
        const highlighted = z.client_nom === highlightClient;
        const opacity    = dimmed ? 0.28 : 0.88;
        const label      = z.client_nom.split(" ").slice(0, 2).join(" ");
        const cx         = x1 + bw / 2;

        return (
          <g key={i}>
            <rect x={x1} y={BAR_Y + 2} width={bw} height={BAR_H - 4}
              fill={z.color} opacity={opacity} rx={3}
              stroke={highlighted ? "#fff" : "transparent"} strokeWidth={highlighted ? 2.5 : 0} />
            {highlighted && (
              <rect x={x1 - 1} y={BAR_Y + 1} width={bw + 2} height={BAR_H - 2}
                fill="none" stroke="#fff" strokeWidth={2.5} rx={3} strokeDasharray="6,3" opacity={.7} />
            )}
            {bw > 28 && (
              <text x={cx} y={midY - (bw > 50 && z.boxes_n > 0 ? 10 : 4)}
                textAnchor="middle" fontSize={Math.min(11, bw / 5.5)} fill="#fff" fontWeight="700">
                {label}
              </text>
            )}
            {bw > 50 && z.boxes_n > 0 && (
              <text x={cx} y={midY + 10} textAnchor="middle" fontSize={Math.min(9, bw / 8)} fill="#fff">
                {z.boxes_n} caixes · {z.weight_kg?.toFixed(0)} kg
              </text>
            )}
          </g>
        );
      })}

      {/* Retornables zone */}
      <rect x={RETORN_X} y={BAR_Y} width={TOTAL_W * RETORN_FRAC} height={BAR_H}
        fill="#ddd" stroke="#bbb" strokeWidth={1} rx={0} />
      <text x={RETORN_X + (TOTAL_W * RETORN_FRAC) / 2} y={midY - 6}
        textAnchor="middle" fontSize={9.5} fill="#888" fontWeight="700">Retorn-</text>
      <text x={RETORN_X + (TOTAL_W * RETORN_FRAC) / 2} y={midY + 7}
        textAnchor="middle" fontSize={9.5} fill="#888" fontWeight="700">ables</text>

      {/* Floor labels */}
      <text x={PAD + 6}     y={BAR_Y + BAR_H + 18} fontSize={11} fill="#555">← PORTA CÀRREGA</text>
      <text x={RETORN_X - 6} y={BAR_Y + BAR_H + 18} fontSize={11} fill="#555" textAnchor="end">CABINA →</text>
    </svg>
  );
}

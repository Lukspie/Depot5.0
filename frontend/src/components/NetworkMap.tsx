import type { LoginInfo } from "../api/public";

const W = 760;
const H = 440;
// room around the dots; more on the right, where the labels usually go (as in the mockup)
const PAD = { left: 60, right: 190, top: 50, bottom: 60 };

type Box = [number, number, number, number];

interface Placed {
  code: string;
  name: string;
  label: string;
  x: number;
  y: number;
  r: number;
  tx: number;
  ty: number;
  anchor: "start" | "end";
}

/** Width of a label in px (Inter 15/12.5 px), enough to keep the labels apart. */
const textWidth = (name: string, label: string) => Math.max(name.length * 8.6, label.length * 6.8);

/** Does the segment a–b cross the box? (sampled, the boxes are bigger than the step) */
function crosses([ax, ay]: [number, number], [bx, by]: [number, number], [x0, y0, x1, y1]: Box): boolean {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 4);
  for (let i = 0; i <= steps; i++) {
    const x = ax + ((bx - ax) * i) / steps;
    const y = ay + ((by - ay) * i) / steps;
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
}

/**
 * Network of depots on the dark login panel (maketa-login): positions from the database
 * (stretched to fill the panel), linehaul connections full, planned feeders dashed.
 * Each label goes right, left, below or above its dot, wherever it covers no other label, dot
 * or connection.
 */
export function NetworkMap({ info }: { info: LoginInfo }) {
  const depots = info.depots;
  if (depots.length === 0) return null;
  const k = Math.cos((depots.reduce((s, d) => s + d.lat, 0) / depots.length) * (Math.PI / 180));
  const xs = depots.map((d) => d.lon * k);
  const ys = depots.map((d) => d.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // a schematic, not a map: east-west and north-south fill the panel each (as in the mockup)
  const sx = (W - PAD.left - PAD.right) / (x1 - x0 || 1);
  const sy = (H - PAD.top - PAD.bottom) / (y1 - y0 || 1);
  const at = (lat: number, lon: number): [number, number] => [PAD.left + (lon * k - x0) * sx, PAD.top + (y1 - lat) * sy];

  const dots = depots.map((d) => ({ d, xy: at(d.lat, d.lon), r: d.kind === "hub" || d.label.startsWith("prekládkové") ? 9 : 6.5 }));
  const where = new Map(dots.map((p) => [p.d.code, p.xy]));
  const segments = info.links.flatMap((l) => {
    const a = where.get(l.origin);
    const b = where.get(l.destination);
    return a && b ? [[a, b] as const] : [];
  });
  const boxes: Box[] = dots.map(({ xy: [x, y], r }) => [x - r - 3, y - r - 3, x + r + 3, y + r + 3]);
  const free = (box: Box) =>
    box[0] >= 0 &&
    box[2] <= W &&
    box[1] >= 0 &&
    box[3] <= H &&
    !boxes.some(([a0, b0, a1, b1]) => box[0] < a1 && box[2] > a0 && box[1] < b1 && box[3] > b0) &&
    !segments.some(([a, b]) => crosses(a, b, box));
  const placed: Placed[] = dots.map(({ d, xy: [x, y], r }) => {
    const w = textWidth(d.name, d.label);
    const boxOf = ([tx, ty, anchor]: [number, number, "start" | "end"]): Box =>
      anchor === "start" ? [tx - 2, ty - 15, tx + w, ty + 22] : [tx - w, ty - 15, tx + 2, ty + 22];
    const right: [number, number, "start" | "end"] = [x + r + 10, y + 2, "start"];
    const options: [number, number, "start" | "end"][] = [
      right,
      [x - r - 10, y + 2, "end"],
      [x - 12, y + r + 24, "start"],
      [x - 12, y - r - 30, "start"],
      [x + r + 8, y - r - 22, "start"],
      [x + r + 8, y + r + 18, "start"],
    ];
    const pick = options.find((o) => free(boxOf(o))) ?? right;
    boxes.push(boxOf(pick));
    const [tx, ty, anchor] = pick;
    return { code: d.code, name: d.name, label: d.label, x, y, r, tx, ty, anchor };
  });
  const byCode = new Map(placed.map((p) => [p.code, p]));
  const names = placed.map((p) => p.name).join(", ");
  return (
    <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="h-auto w-full" role="img" aria-label={`Sieť skladov: ${names}`}>
      <defs>
        <pattern id="login-grid" width="38" height="38" patternUnits="userSpaceOnUse">
          <path d="M38 0H0V38" fill="none" stroke="#2a2926" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#login-grid)" />
      {info.links.map((l) => {
        const a = byCode.get(l.origin);
        const b = byCode.get(l.destination);
        if (!a || !b) return null;
        return l.kind === "linehaul" ? (
          <line key={`${l.origin}-${l.destination}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f39200" strokeWidth="2.5" strokeLinecap="round" />
        ) : (
          <line key={`${l.origin}-${l.destination}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#6b6a65" strokeWidth="1.6" strokeDasharray="4 6" />
        );
      })}
      {placed.map((p) => (
        <g key={p.code}>
          <circle cx={p.x} cy={p.y} r={p.r + 9} fill="#f39200" opacity="0.16" />
          <circle cx={p.x} cy={p.y} r={p.r} fill="#f39200" stroke="#1d1d1b" strokeWidth="2" />
          <text x={p.tx} y={p.ty} textAnchor={p.anchor} fill="#ffffff" fontSize="15" fontWeight="700">
            {p.name}
          </text>
          <text x={p.tx} y={p.ty + 17} textAnchor={p.anchor} fill="#a3a29d" fontSize="12.5">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

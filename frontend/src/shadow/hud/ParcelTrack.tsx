import { Check, ChevronRight, Package, X } from "lucide-react";
import { Link } from "react-router";
import { isApiError } from "../../api/client";
import type { ParcelLocate } from "../../api/shadow";
import { Button, cn } from "../../components/ui";
import { PARCEL_STATUS } from "../../domain/labels";
import { hhmm, kg } from "../../lib/format";

function placeLabel(p: ParcelLocate, onLine: string | null): string {
  if (onLine) return `na triediacej linke · ${onLine}`;
  if (p.vehiclePlate && (p.status === "loaded" || p.place.kind === "door")) return `v kamióne ${p.vehiclePlate}`;
  switch (p.place.kind) {
    case "belt":
      return "na triediacom páse";
    case "door":
      return `pri bráne ${p.place.code ?? "?"}`;
    case "bay":
      return `na odstavnej ploche ${p.place.code ?? "?"}`;
    default:
      return "mimo haly";
  }
}

interface Props {
  barcode: string;
  result: ParcelLocate | undefined;
  error: unknown;
  canOpen: boolean;
  onClose: () => void;
  /** the checkpoint of the sorting line the parcel passed last, while it is on the line */
  onLine?: string | null;
}

interface Step {
  key: string;
  label: string;
  sub: string;
  state: "done" | "current" | "next";
}

/** The steps of the parcel: its events, and the departure still ahead when it is in a truck. */
function steps(r: ParcelLocate): Step[] {
  const out: Step[] = r.events.map((e, i) => ({
    key: `${e.at}-${String(i)}`,
    // a passage through a checkpoint keeps the status: the step is named after the checkpoint
    label:
      e.checkpointLabel && r.events[i - 1]?.status === e.status
        ? e.checkpointLabel
        : `${PARCEL_STATUS[e.status].label}${e.doorCode ? ` · ${e.doorCode}` : ""}`,
    sub: e.checkpointLabel ? `${hhmm(e.at)} · kontrolný bod` : hhmm(e.at),
    state: "done",
  }));
  const last = out.at(-1);
  if (r.status === "loaded" && r.plannedDeparture) {
    // loaded, the truck has not left yet: the loading is current, the departure ahead
    if (last) last.state = "current";
    out.push({ key: "departure", label: "Odchod", sub: `plán ${hhmm(r.plannedDeparture)}`, state: "next" });
  } else if (last) {
    last.state = "current";
  }
  return out;
}

/**
 * Bottom-left parcel tracking (maketa-tien): the parcel with its weight and where it is, the
 * steps as circles on a line (done with a check, the current one with a ring, the next grey).
 * The scene marks the parcel when it is in the hall; the full history is on /parcels/:id.
 */
export function ParcelTrack({ barcode, result, error, canOpen, onClose, onLine = null }: Props) {
  const list = result ? steps(result) : [];
  return (
    <div className="bg-surface border-line shadow-card rounded-2xl border px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="bg-brand-50 text-brand-700 grid h-9 w-9 shrink-0 place-items-center rounded-[10px]">
          <Package size={18} />
        </span>
        {/* on a phone the icon and the barcode say it, the title would push the row wider (390 px) */}
        <span className="hidden text-[15px] font-bold whitespace-nowrap sm:inline">Sledovanie balíka</span>
        <span className="border-line bg-subtle shrink-0 rounded-md border px-2 py-0.5 font-mono text-[13px] font-semibold">{barcode}</span>
        {result && (
          <span className="text-ink-muted hidden truncate text-[13px] sm:inline">
            {result.weightKg !== null ? `${kg(result.weightKg)} · ` : ""}
            {placeLabel(result, onLine)}
          </span>
        )}
        <span className="flex-1" />
        {result && canOpen && (
          <Link to={`/parcels/${String(result.id)}`} className="text-brand-700 flex shrink-0 items-center gap-0.5 text-[13px] font-semibold underline underline-offset-2">
            Detail balíka <ChevronRight size={14} />
          </Link>
        )}
        <Button variant="ghost" size="sm" className="!p-1" aria-label="Zavrieť sledovanie" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>
      {isApiError(error, 404) && <p className="text-danger-700 mt-2 text-sm">Balík s týmto kódom neexistuje.</p>}
      {list.length > 0 && (
        <ol className="relative mt-4 flex justify-between overflow-x-auto pb-1">
          {list.map((s, i) => (
            <li key={s.key} className="relative flex min-w-[88px] flex-1 flex-col items-center text-center">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn("absolute top-[13px] right-1/2 h-[3px] w-full -translate-x-[14px]", s.state === "next" ? "bg-line" : "bg-brand-500")}
                  style={{ width: "calc(100% - 28px)" }}
                />
              )}
              <span
                className={cn(
                  "relative z-10 grid h-7 w-7 place-items-center rounded-full",
                  s.state === "done" && "bg-brand-500 text-white",
                  s.state === "current" && "border-brand-500 bg-surface border-[3px] shadow-[0_0_0_4px_rgb(243_146_0/0.2)]",
                  s.state === "next" && "bg-track",
                )}
              >
                {s.state === "done" && <Check size={15} strokeWidth={3} />}
                {s.state === "current" && <span className="bg-brand-500 h-2.5 w-2.5 rounded-full" />}
                {s.state === "next" && <span className="h-2 w-2 rounded-full bg-[#b5b4af]" />}
              </span>
              <span className="mt-1.5 text-[12.5px] font-bold whitespace-nowrap">{s.label}</span>
              <span className="text-ink-muted text-[11.5px] whitespace-nowrap">{s.sub}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

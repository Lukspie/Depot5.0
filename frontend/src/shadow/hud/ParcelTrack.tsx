import { ExternalLink, X } from "lucide-react";
import { Link } from "react-router";
import { isApiError } from "../../api/client";
import type { ParcelLocate } from "../../api/shadow";
import { Badge, Button } from "../../components/ui";
import { PARCEL_STATUS, hhmm } from "../../domain/labels";

function placeLabel(p: ParcelLocate["place"]): string {
  switch (p.kind) {
    case "belt":
      return "na triediacom páse";
    case "door":
      return `pri bráne ${p.code ?? "?"}`;
    case "bay":
      return `na odstavnej ploche ${p.code ?? "?"}`;
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
}

/**
 * Bottom-left parcel tracking (reference): status steps as circles on a horizontal line; the
 * scene marks the parcel when it is in the hall. The full history is on /parcels/:id.
 */
export function ParcelTrack({ barcode, result, error, canOpen, onClose }: Props) {
  const last = result ? result.events.length - 1 : -1;
  return (
    <div className="bg-surface shadow-card rounded-2xl p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-ink-muted text-[11px] font-semibold tracking-wider uppercase">Sledovanie balíka</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm font-semibold">{barcode}</span>
            {result && <Badge tone={PARCEL_STATUS[result.status].tone} size="sm">{PARCEL_STATUS[result.status].label}</Badge>}
          </div>
          {result && (
            <div className="text-ink-muted truncate text-xs">
              {result.directionName} · {placeLabel(result.place)}
            </div>
          )}
        </div>
        {result && canOpen && (
          <Link to={`/parcels/${String(result.id)}`} className="text-brand-700 flex shrink-0 items-center gap-1 text-xs underline">
            Detail <ExternalLink size={12} />
          </Link>
        )}
        <Button variant="ghost" size="sm" className="!p-1" aria-label="Zavrieť sledovanie" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>
      {isApiError(error, 404) && <p className="text-danger-600 mt-2 text-sm">Balík s týmto kódom neexistuje.</p>}
      {result && (
        <ol className="mt-3 flex overflow-x-auto pb-1">
          {result.events.map((e, i) => (
            <li key={`${e.at}-${String(i)}`} className="flex shrink-0 items-start">
              <div className="flex w-24 flex-col items-center text-center">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold ${i === last ? "border-brand-500 bg-brand-500 text-on-brand" : "border-brand-500 bg-surface text-brand-700"}`}
                >
                  {i + 1}
                </span>
                <span className="mt-1 text-[11px] font-medium whitespace-nowrap">{PARCEL_STATUS[e.status].label}</span>
                <span className="text-ink-muted text-[10px] whitespace-nowrap">
                  {hhmm(e.at)}
                  {e.doorCode ? ` · ${e.doorCode}` : ""}
                </span>
              </div>
              {i < last && <span className="bg-brand-500 mt-3 h-0.5 w-4" />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

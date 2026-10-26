import { Search } from "lucide-react";
import { useState } from "react";
import { isApiError } from "../../api/client";
import type { ParcelLocate } from "../../api/shadow";
import { Badge, Card } from "../../components/ui";
import { PARCEL_STATUS, hhmm } from "../../domain/labels";

function placeLabel(p: ParcelLocate["place"]): string {
  switch (p.kind) {
    case "belt":
      return "Na triediacom páse";
    case "door":
      return `Pri bráne ${p.code ?? "?"}`;
    case "bay":
      return `Na odstavnej ploche ${p.code ?? "?"}`;
    default:
      return "Mimo haly";
  }
}

interface Props {
  result: ParcelLocate | undefined;
  error: unknown;
  loading: boolean;
  onSearch: (barcode: string | null) => void;
}

/**
 * Bottom panel (zadanie §7): find a parcel by barcode, show its status timeline horizontally; if
 * it is physically in the hall, the scene marks the spot.
 */
export function ParcelSearch({ result, error, loading, onSearch }: Props) {
  const [text, setText] = useState("");
  return (
    <Card>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = text.trim().toUpperCase();
          onSearch(v.length >= 3 ? v : null);
        }}
      >
        <label htmlFor="shadow-parcel" className="text-sm font-semibold">
          Nájsť balík
        </label>
        <div className="border-line bg-surface flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2">
          <Search size={16} className="text-ink-muted shrink-0" />
          <input
            id="shadow-parcel"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Čiarový kód, napr. DP261026…"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="bg-brand-500 text-on-brand rounded-xl px-4 py-2 text-sm font-medium whitespace-nowrap">
          Hľadať
        </button>
        {result && (
          <button
            type="button"
            className="text-ink-muted text-sm underline"
            onClick={() => {
              setText("");
              onSearch(null);
            }}
          >
            Zrušiť
          </button>
        )}
      </form>
      {loading && <p className="text-ink-muted mt-3 text-sm">Hľadám…</p>}
      {isApiError(error, 404) && <p className="text-danger-600 mt-3 text-sm">Balík s týmto kódom neexistuje.</p>}
      {result && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-semibold">{result.barcode}</span>
            <Badge tone={PARCEL_STATUS[result.status].tone}>{PARCEL_STATUS[result.status].label}</Badge>
            <span className="text-ink-muted">
              {result.directionName} · {placeLabel(result.place)}
            </span>
          </div>
          <ol className="mt-3 flex gap-0 overflow-x-auto pb-1">
            {result.events.map((e, i) => (
              <li key={`${e.at}-${String(i)}`} className="flex shrink-0 items-start">
                <div className="flex w-32 flex-col items-center text-center">
                  <span className={`h-3 w-3 rounded-full ${i === result.events.length - 1 ? "bg-brand-500" : "bg-neutral-300"}`} />
                  <span className="mt-1 text-xs font-medium whitespace-nowrap">{PARCEL_STATUS[e.status].label}</span>
                  <span className="text-ink-muted text-[11px] whitespace-nowrap">
                    {hhmm(e.at)}
                    {e.doorCode ? ` · ${e.doorCode}` : ""}
                  </span>
                </div>
                {i < result.events.length - 1 && <span className="bg-line mt-1.5 h-0.5 w-6" />}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}

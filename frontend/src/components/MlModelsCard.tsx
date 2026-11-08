import { useQuery } from "@tanstack/react-query";
import { getJson, isApiError } from "../api/client";
import { Badge } from "./ui";

interface ModelStatus {
  name: string;
  title: string;
  available: boolean;
  metrics: Record<string, unknown> | null;
}

const num = (v: unknown): string | null => (typeof v === "number" ? v.toLocaleString("sk-SK", { maximumFractionDigits: 2 }) : null);

/** Phase 6 models (ADR-057): loaded or "model nedostupný", with their key metric. */
export function MlModelsCard() {
  const q = useQuery({
    queryKey: ["ml", "status"],
    queryFn: () => getJson<{ models: ModelStatus[] }>("/api/ml/status"),
    refetchInterval: 30_000,
    retry: false,
  });
  if (isApiError(q.error, 403)) return null; // couriers do not see the models
  return (
    <section className="bg-surface shadow-card rounded-card p-5">
      <h2 className="mb-1 font-semibold">ML modely</h2>
      <p className="text-ink-muted mb-4 text-sm">Načítané v hlavnom backende z ml/artifacts.</p>
      {q.isError && <p className="text-danger-700 text-sm">Stav modelov sa nepodarilo načítať.</p>}
      <ul className="divide-line divide-y text-sm">
        {q.data?.models.map((m) => {
          const mae = num(m.metrics?.maeMin);
          const base = num(m.metrics?.maeBaselineMin);
          return (
            <li key={m.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block font-medium">{m.title}</span>
                {mae && base && (
                  <span className="text-ink-muted block text-xs">
                    MAE {mae} min (baseline {base} min)
                  </span>
                )}
              </span>
              <Badge tone={m.available ? "ok" : "warn"} size="sm">
                {m.available ? "načítaný" : "model nedostupný"}
              </Badge>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

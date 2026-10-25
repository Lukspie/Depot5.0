import type { UseQueryResult } from "@tanstack/react-query";
import type { Health, Hello } from "../api/system";

interface Props {
  title: string;
  subtitle: string;
  hello: UseQueryResult<Hello>;
  health: UseQueryResult<Health>;
  waitingFor?: string;
}

type Tone = "ok" | "error" | "loading";

const TONE: Record<Tone, { badge: string; label: string }> = {
  ok: { badge: "bg-mint-100 text-mint-600", label: "V poriadku" },
  error: { badge: "bg-rose-100 text-rose-600", label: "Nedostupné" },
  loading: { badge: "bg-sky-100 text-sky-600", label: "Načítavam…" },
};

function toneOf(q: UseQueryResult<unknown>, ok: boolean): Tone {
  if (q.isPending) return "loading";
  if (q.isError) return "error";
  return ok ? "ok" : "error";
}

export function ServiceCard({ title, subtitle, hello, health, waitingFor }: Props) {
  const serviceTone = toneOf(hello, true);
  const dbTone = toneOf(health, health.data?.db === "ok");

  return (
    <section className="bg-surface shadow-card rounded-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-ink-muted text-sm">{subtitle}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONE[serviceTone].badge}`}>
          {waitingFor ?? TONE[serviceTone].label}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-muted">Jazyk</dt>
        <dd>{hello.data?.language ?? "—"}</dd>
        <dt className="text-ink-muted">Verzia</dt>
        <dd>{hello.data?.version ?? "—"}</dd>
        <dt className="text-ink-muted">Čas servera</dt>
        <dd>{hello.data ? new Date(hello.data.time).toLocaleTimeString("sk-SK") : "—"}</dd>
        <dt className="text-ink-muted">Databáza</dt>
        <dd>
          <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[dbTone].badge}`}>
            {TONE[dbTone].label}
          </span>
        </dd>
      </dl>

      {hello.isError && (
        <p className="mt-4 rounded-xl bg-rose-100 px-3 py-2 text-sm text-rose-600">
          {hello.error.message}. Skúšam znova každých 10 s.
        </p>
      )}
    </section>
  );
}

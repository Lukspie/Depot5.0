import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, ChevronDown, ScanLine, ShieldAlert, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getJson, isApiError, sendJson } from "../api/client";
import { useDepots } from "../api/depots";
import { Badge, Button, Card, EmptyState, Spinner, type Tone } from "../components/ui";
import { useChannel } from "../hooks/telematics";

interface GateResult {
  vehicles: { type: string; confidence: number; box: [number, number, number, number]; detail?: string | null }[];
  vehicleType: string | null;
  plate: string | null;
  plateConfidence: number | null;
  text: string;
  expected: boolean;
  fleetKind: string | null;
  recorded: boolean;
  decision: string;
  reason: string;
  eventId: number | null;
}

interface GateAudit {
  at: string;
  actor: string | null;
  action: string;
  reason: string;
}

interface GateEvent {
  id: number;
  at: string;
  source: "camera" | "sim";
  /** whose gate (phase 7c) */
  depot: string | null;
  direction: "in" | "out";
  vehicleType: string | null;
  vehicleConfidence: number | null;
  plate: string | null;
  plateConfidence: number | null;
  fleetKind: string | null;
  allowedHolder: string | null;
  decision: "auto_pass" | "pass_verify" | "hold";
  reason: string;
  resolution: "allowed" | "denied" | "verified" | "expired" | null;
  resolvedBy: string | null;
  note: string | null;
  audit: GateAudit[];
}

interface AllowedPlate {
  id: number;
  plate: string;
  holder: string;
  validUntil: string | null;
}

const TYPE: Record<string, string> = { truck: "kamión", car: "osobné auto", bus: "autobus", van: "dodávka" };
const REASON: Record<string, string> = {
  fleet_vehicle: "vozidlo vozového parku",
  allowed_plate: "povolená externá ŠPZ",
  exit_after_entry: "odchod po povolenom vjazde",
  truck_unknown_plate: "kamión s neznámou ŠPZ",
  truck_no_plate: "kamión, ŠPZ neprečítaná",
  no_vehicle: "na zábere nie je vozidlo",
  type_mismatch: "typ nesedí s vozidlom tejto ŠPZ",
  end_of_day: "koniec dňa",
  low_vehicle_confidence: "nízka istota typu vozidla",
  low_plate_confidence: "nízka istota čítania ŠPZ",
  unknown_plate: "ŠPZ nie je v databáze",
  no_plate: "ŠPZ sa nepodarilo prečítať",
};
const ACTION: Record<string, string> = {
  auto_pass: "prejazd (pravidlá)",
  pass_verify: "prejazd, overiť (pravidlá)",
  hold: "zastavené, čaká (pravidlá)",
  allowed: "povolené",
  denied: "zamietnuté",
  verified: "overené",
  expired: "uzavreté systémom",
};
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("sk-SK", { timeZone: "Europe/Bratislava", hour: "2-digit", minute: "2-digit" });
const inputClass = "border-line bg-surface focus:border-brand-500 focus:ring-brand-100 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-4";

function state(e: Pick<GateEvent, "decision" | "resolution">): { label: string; tone: Tone } {
  if (e.resolution === "allowed") return { label: "povolené", tone: "ok" };
  if (e.resolution === "denied") return { label: "zamietnuté", tone: "danger" };
  if (e.resolution === "verified") return { label: "overené", tone: "ok" };
  if (e.resolution === "expired") return { label: "uzavreté", tone: "neutral" };
  if (e.decision === "hold") return { label: "čaká na ochranku", tone: "danger" };
  if (e.decision === "pass_verify") return { label: "prešiel, overiť", tone: "warn" };
  return { label: "prejazd", tone: "ok" };
}

function detect(file: File, direction: "in" | "out", depot: string): Promise<GateResult> {
  // the gate of the depot chosen above (phase 7c); Budimír when "all depots" is selected
  return getJson<GateResult>(`/api/gate/detect?direction=${direction}&depot=${depot || "BUD"}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
}

function vehicleLabel(e: Pick<GateEvent, "vehicleType" | "plate">) {
  return (
    <>
      <span className="font-mono font-semibold">{e.plate ?? "bez ŠPZ"}</span>
      <span className="text-ink-muted"> · {e.vehicleType ? TYPE[e.vehicleType] ?? e.vehicleType : "vozidlo nerozpoznané"}</span>
    </>
  );
}

/** One open decision: a held vehicle (allow / deny with a note) or a lorry to verify. */
function QueueItem({ e, onDone }: { e: GateEvent; onDone: () => void }) {
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (action: "allow" | "deny" | "verify") => sendJson<GateEvent>("POST", `/api/gate/events/${String(e.id)}/decision`, { action, note }),
    onSuccess: onDone,
  });
  const hold = e.decision === "hold";
  const noteOk = !hold || note.trim().length >= 3;
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm">
          {vehicleLabel(e)}
          <span className="text-ink-muted block text-xs">
            {e.direction === "in" ? "vjazd" : "výjazd"} · {hhmm(e.at)} · {REASON[e.reason] ?? e.reason}
          </span>
          <span className="text-ink-muted block text-xs">
            istota typu {pct(e.vehicleConfidence)} · ŠPZ {e.plate ? pct(e.plateConfidence) : "neprečítaná"}
          </span>
        </span>
        <Badge tone={state(e).tone} size="sm">
          {state(e).label}
        </Badge>
      </div>
      <input
        value={note}
        onChange={(ev) => setNote(ev.target.value)}
        maxLength={500}
        placeholder={hold ? "Dôvod rozhodnutia (povinné)" : "Poznámka (nepovinné)"}
        aria-label={`Poznámka k ${e.plate ?? "vozidlu"}`}
        className={`${inputClass} mt-2`}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {hold ? (
          <>
            <Button size="sm" icon={<Check size={14} />} disabled={!noteOk || decide.isPending} onClick={() => decide.mutate("allow")}>
              Povoliť
            </Button>
            <Button size="sm" variant="danger" icon={<X size={14} />} disabled={!noteOk || decide.isPending} onClick={() => decide.mutate("deny")}>
              Zamietnuť
            </Button>
          </>
        ) : (
          <Button size="sm" icon={<Check size={14} />} disabled={decide.isPending} onClick={() => decide.mutate("verify")}>
            Overené
          </Button>
        )}
      </div>
      {decide.isError && <p className="text-danger-600 mt-1 text-xs">{isApiError(decide.error, 409) ? "O vozidle už rozhodol niekto iný." : "Rozhodnutie sa nepodarilo uložiť."}</p>}
    </li>
  );
}

/** A passage of today with its decision; the audit opens on click. */
function EventRow({ e, depotName }: { e: GateEvent; depotName?: (code: string) => string }) {
  const [open, setOpen] = useState(false);
  const s = state(e);
  return (
    <li className="py-2">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0">
          {vehicleLabel(e)}
          <span className="text-ink-muted block text-xs">
            {hhmm(e.at)} · {e.direction === "in" ? "vjazd" : "výjazd"} · {e.allowedHolder ?? REASON[e.reason] ?? e.reason}
            {e.source === "camera" && " · fotka"}
            {e.depot && depotName ? ` · ${depotName(e.depot)}` : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Badge tone={s.tone} size="sm">
            {s.label}
          </Badge>
          <ChevronDown size={14} className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <ol className="border-line text-ink-muted mt-2 ml-1 space-y-1 border-l-2 pl-3 text-xs">
          {e.audit.map((a, i) => (
            <li key={i}>
              <span className="text-ink">{hhmm(a.at)}</span> · {a.actor ?? "pravidlá"} · {ACTION[a.action] ?? a.action}
              {" – "}
              {a.actor ? a.reason : REASON[a.reason] ?? a.reason}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function AllowedPlates() {
  const qc = useQueryClient();
  const plates = useQuery({ queryKey: ["gate", "allowed"], queryFn: () => getJson<AllowedPlate[]>("/api/gate/allowed-plates") });
  const [plate, setPlate] = useState("");
  const [holder, setHolder] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["gate", "allowed"] });
  const add = useMutation({
    mutationFn: () => sendJson<AllowedPlate>("POST", "/api/gate/allowed-plates", { plate, holder }),
    onSuccess: () => {
      setPlate("");
      setHolder("");
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: number) => sendJson<null>("DELETE", `/api/gate/allowed-plates/${String(id)}`), onSuccess: refresh });
  const removePlate = (p: AllowedPlate) => {
    if (window.confirm(`Odobrať ${p.plate} (${p.holder}) zo zoznamu povolených?`)) remove.mutate(p.id);
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    add.mutate();
  };
  return (
    <Card title="Povolené externé ŠPZ" subtitle="Prejdú bez zastavenia.">
      {plates.isPending && <Spinner className="py-4" />}
      {plates.isError && <p className="text-danger-600 text-sm">Zoznam sa nepodarilo načítať.</p>}
      {remove.isError && <p className="text-danger-600 text-xs">ŠPZ sa nepodarilo odobrať.</p>}
      <ul className="divide-line divide-y text-sm">
        {(plates.data ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block font-mono font-semibold">{p.plate}</span>
              <span className="text-ink-muted block truncate text-xs">
                {p.holder}
                {p.validUntil && ` · do ${new Date(p.validUntil).toLocaleDateString("sk-SK")}`}
              </span>
            </span>
            <Button size="sm" variant="ghost" aria-label={`Odobrať ${p.plate}`} icon={<Trash2 size={14} />} onClick={() => removePlate(p)} />
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 grid gap-2">
        <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ŠPZ, napr. BA-123CD" aria-label="ŠPZ" className={`${inputClass} font-mono`} />
        <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Firma alebo držiteľ" aria-label="Držiteľ" className={inputClass} />
        <Button type="submit" size="sm" variant="secondary" disabled={add.isPending || plate.trim().length < 7 || holder.trim().length < 2}>
          Pridať
        </Button>
        {add.isError && (
          <p className="text-danger-600 text-xs">{isApiError(add.error, 409) ? "ŠPZ už je v zozname." : isApiError(add.error, 422) ? "Toto nie je slovenská ŠPZ." : "Nepodarilo sa uložiť."}</p>
        )}
      </form>
    </Card>
  );
}

/**
 * Gate for security (phase 6 ADR-059, decisions ADR-061): the model reads the vehicle type and the
 * plate, the rules decide by the fleet and the allowed plates, security decides the uncertain cases
 * in the queue. Every decision is in the audit of the passage.
 */
export function GatePage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["gate"] });
  const run = useMutation({ mutationFn: (f: File) => detect(f, direction, depot), onSuccess: refresh });
  // which depot's gate: all by default (phase 7c, every depot has its own gate)
  const [depot, setDepot] = useState("");
  const depots = useDepots();
  const nameOf = (code: string) => depots.data?.find((d) => d.code === code)?.name ?? code;
  const filter = depot ? `depot=${depot}` : "";
  const queue = useQuery({ queryKey: ["gate", "queue", depot], queryFn: () => getJson<GateEvent[]>(`/api/gate/queue?${filter}`), refetchInterval: 10_000 });
  const events = useQuery({ queryKey: ["gate", "events", depot], queryFn: () => getJson<GateEvent[]>(`/api/gate/events?limit=25&${filter}`), refetchInterval: 15_000 });

  // the object URL of the preview is released when it changes and on leaving the page
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  // a passage of the simulated camera reaches the app within ~1 s: refresh the lists once per burst
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useChannel("devices", (ev) => {
    if (ev.type !== "gate_passage" || pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      refresh();
    }, 1500);
  });
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const r = run.data;
  const error = run.error
    ? isApiError(run.error, 503)
      ? "Model brány nie je dostupný (model nedostupný)."
      : isApiError(run.error, 413)
        ? "Obrázok je väčší ako 8 MB."
        : "Obrázok sa nepodarilo vyhodnotiť."
    : null;
  const open = queue.data ?? [];
  // the rules decide by the largest vehicle in the picture
  const largest = r?.vehicles.reduce<GateResult["vehicles"][number] | null>(
    (best, v) => (!best || (v.box[2] - v.box[0]) * (v.box[3] - v.box[1]) > (best.box[2] - best.box[0]) * (best.box[3] - best.box[1]) ? v : best),
    null,
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_24rem]">
      <div className="order-2 grid min-w-0 content-start gap-6 lg:order-1">
        <Card
          title={
            <span className="flex items-center gap-2">
              <Camera size={18} /> Kamera brány
            </span>
          }
          subtitle="Model určí typ a ŠPZ, o prejazde rozhodnú pravidlá, pri neistote vy."
        >
          <div className="flex flex-wrap items-center gap-2">
            <label className="border-line hover:bg-canvas cursor-pointer rounded-xl border px-3 py-2 text-sm">
              Vybrať fotku
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setPreview(f ? URL.createObjectURL(f) : null);
                  run.reset();
                }}
              />
            </label>
            {(["in", "out"] as const).map((d) => (
              <Button key={d} size="sm" variant={direction === d ? "primary" : "secondary"} aria-pressed={direction === d} onClick={() => setDirection(d)}>
                {d === "in" ? "Vjazd" : "Výjazd"}
              </Button>
            ))}
            <Button icon={<ScanLine size={16} />} disabled={!file || run.isPending} onClick={() => file && run.mutate(file)}>
              {run.isPending ? "Vyhodnocujem…" : "Vyhodnotiť"}
            </Button>
          </div>

          {preview && (
            <div className="relative mt-4 overflow-hidden rounded-xl">
              <img src={preview} alt="Fotka z brány" className="block h-auto w-full" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
              {r && size && (
                <svg viewBox={`0 0 ${String(size.w)} ${String(size.h)}`} className="absolute inset-0 h-full w-full" aria-hidden>
                  {r.vehicles.map((v, i) => (
                    <rect key={i} x={v.box[0]} y={v.box[1]} width={v.box[2] - v.box[0]} height={v.box[3] - v.box[1]} fill="none" stroke="#f39200" strokeWidth={Math.max(3, size.w / 200)} />
                  ))}
                </svg>
              )}
            </div>
          )}

          {error && <p className="text-danger-600 mt-3 text-sm">{error}</p>}
          {r && (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">Rozhodnutie</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <Badge tone={state({ decision: r.decision as GateEvent["decision"], resolution: null }).tone}>
                  {state({ decision: r.decision as GateEvent["decision"], resolution: null }).label}
                </Badge>
                <span className="text-ink-muted">{REASON[r.reason] ?? r.reason}</span>
              </dd>
              <dt className="text-ink-muted">Vozidlo</dt>
              <dd>
                {r.vehicleType ? TYPE[r.vehicleType] ?? r.vehicleType : "nerozpoznané"}
                {largest && <span className="text-ink-muted"> · istota {pct(largest.confidence)}</span>}
              </dd>
              <dt className="text-ink-muted">ŠPZ</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-base font-semibold">{r.plate ?? "nečitateľná"}</span>
                {r.plate && <span className="text-ink-muted">istota {pct(r.plateConfidence)}</span>}
                {r.plate && r.expected && <Badge tone="ok">{r.fleetKind ? "vozidlo flotily" : "povolená ŠPZ"}</Badge>}
              </dd>
              <dt className="text-ink-muted">Prejazd</dt>
              <dd>{r.eventId ? `zapísaný (${direction === "in" ? "vjazd" : "výjazd"})` : "nezapísaný"}</dd>
              {r.text && (
                <>
                  <dt className="text-ink-muted">Prečítaný text</dt>
                  <dd className="text-ink-muted min-w-0 truncate font-mono text-xs" title={r.text}>
                    {r.text}
                  </dd>
                </>
              )}
            </dl>
          )}
        </Card>

        <Card title="Prejazdy dnes" subtitle="Klik ukáže audit: kto, kedy a prečo rozhodol.">
          {events.isPending ? (
            <Spinner className="py-6" />
          ) : events.isError ? (
            <p className="text-danger-600 text-sm">Prejazdy sa nepodarilo načítať.</p>
          ) : (events.data ?? []).length === 0 ? (
            <p className="text-ink-muted text-sm">Zatiaľ žiadny prejazd.</p>
          ) : (
            <ul className="divide-line divide-y">
              {(events.data ?? []).map((e) => (
                <EventRow key={e.id} e={e} depotName={depot ? undefined : nameOf} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="order-1 grid min-w-0 content-start gap-6 lg:order-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              <ShieldAlert size={18} /> Čaká na ochranku {open.length > 0 && <Badge tone="danger">{open.length}</Badge>}
            </span>
          }
          subtitle="Rozhodnite s dôvodom alebo potvrďte overenie."
          actions={
            <select
              value={depot}
              onChange={(e) => setDepot(e.target.value)}
              aria-label="Brána skladu"
              className="border-line bg-surface focus:border-brand-500 rounded-xl border px-2 py-1.5 text-sm"
            >
              <option value="">Všetky brány</option>
              {depots.data?.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          }
        >
          {queue.isPending ? (
            <Spinner className="py-6" />
          ) : queue.isError ? (
            <p className="text-danger-600 text-sm">Front sa nepodarilo načítať. Vozidlá môžu čakať, skontrolujte bránu.</p>
          ) : open.length === 0 ? (
            <EmptyState title="Nič nečaká" description="Všetky vozidlá pri bráne sú vybavené." />
          ) : (
            <ul className="divide-line divide-y">
              {open.map((e) => (
                <QueueItem key={e.id} e={e} onDone={refresh} />
              ))}
            </ul>
          )}
        </Card>
        <AllowedPlates />
      </div>
    </div>
  );
}

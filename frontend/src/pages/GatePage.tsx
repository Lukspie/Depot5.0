import { useMutation } from "@tanstack/react-query";
import { Camera, ScanLine } from "lucide-react";
import { useEffect, useState } from "react";
import { getJson, isApiError } from "../api/client";
import { Badge, Button, Card } from "../components/ui";
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
}

interface Passage {
  at: string;
  direction: "in" | "out";
  vehicleType: string;
  plate: string | null;
  expected: boolean;
}

const TYPE: Record<string, string> = { truck: "kamión", car: "osobné auto", bus: "autobus", van: "dodávka" };
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);

function detect(file: File, direction: "in" | "out"): Promise<GateResult> {
  return getJson<GateResult>(`/api/gate/detect?direction=${direction}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
}

/**
 * Gate camera for security (phase 6, ADR-059): upload or take a photo, the app finds the vehicle
 * (YOLOX) and reads the plate (OCR); the passage appears in the yard of the digital shadow and an
 * unknown plate raises an alert. Below: live passages from the gate camera channel.
 */
export function GatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [passages, setPassages] = useState<Passage[]>([]);
  const run = useMutation({ mutationFn: (f: File) => detect(f, direction) });

  // the object URL of the preview is released when it changes and on leaving the page
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  useChannel<Passage>("devices", (ev) => {
    if (ev.type === "gate_passage") setPassages((p) => [ev.data, ...p].slice(0, 12));
  });

  const r = run.data;
  const error = run.error
    ? isApiError(run.error, 503)
      ? "Model brány nie je dostupný (model nedostupný)."
      : isApiError(run.error, 413)
        ? "Obrázok je väčší ako 8 MB."
        : "Obrázok sa nepodarilo vyhodnotiť."
    : null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_20rem]">
      <Card
        title={
          <span className="flex items-center gap-2">
            <Camera size={18} /> Kamera brány
          </span>
        }
        subtitle="Nahrajte alebo odfoťte vozidlo. Systém rozpozná typ vozidla a ŠPZ a zapíše prejazd."
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
            <dt className="text-ink-muted">Vozidlo</dt>
            <dd>
              {r.vehicleType ? TYPE[r.vehicleType] ?? r.vehicleType : "nerozpoznané"}
              {r.vehicles[0] && <span className="text-ink-muted"> · istota {pct(r.vehicles[0].confidence)}</span>}
            </dd>
            <dt className="text-ink-muted">ŠPZ</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-semibold">{r.plate ?? "nečitateľná"}</span>
              {r.plate && <span className="text-ink-muted">istota {pct(r.plateConfidence)}</span>}
              {r.plate && (r.expected ? <Badge tone="ok">vozidlo flotily</Badge> : <Badge tone="warn">neznáma ŠPZ – alarm</Badge>)}
            </dd>
            <dt className="text-ink-muted">Prejazd</dt>
            <dd>{r.recorded ? `zapísaný (${direction === "in" ? "vjazd" : "výjazd"})` : "nezapísaný"}</dd>
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

      <Card title="Posledné prejazdy" subtitle="Naživo z kamery brány (simulácia aj nahrané fotky).">
        {passages.length === 0 ? (
          <p className="text-ink-muted text-sm">Zatiaľ žiadny prejazd.</p>
        ) : (
          <ul className="divide-line divide-y text-sm">
            {passages.map((p, i) => (
              <li key={`${p.at}-${String(i)}`} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block font-mono font-semibold">{p.plate ?? "—"}</span>
                  <span className="text-ink-muted text-xs">
                    {p.direction === "in" ? "vjazd" : "výjazd"} · {TYPE[p.vehicleType] ?? p.vehicleType} ·{" "}
                    {new Date(p.at).toLocaleTimeString("sk-SK", { timeZone: "Europe/Bratislava", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                {!p.expected && <Badge tone="warn">neznáme</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

import { ArrowRight, Download, FlaskConical, MoreVertical } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useDispatch, type AlertCard, type Dispatch, type TripRow } from "../api/dispatch";
import { useStartMaintenance } from "../api/shadow";
import { useAckAlert } from "../api/wms";
import {
  AlertItem,
  Button,
  Card,
  DataTable,
  DayTimeline,
  DeltaBadge,
  EmptyState,
  FilterChips,
  KpiCard,
  Menu,
  MenuItem,
  PageHeader,
  RiskChip,
  SegmentedTabs,
  Spinner,
  StackedBar,
  StatusBadge,
  type Column,
  type RowGroup,
  type Tone,
} from "../components/ui";
import { ALERT_KIND } from "../domain/labels";
import { useSimClock } from "../hooks/telematics";
import { useDepot } from "../hooks/useDepot";
import { dayMonth, hhmm, num, relative, signedMinutes } from "../lib/format";

const TONE_VAR: Record<Tone | "primary", string> = {
  ok: "var(--color-ok-600)",
  info: "var(--color-info-600)",
  warn: "var(--color-warn-600)",
  danger: "var(--color-danger-600)",
  neutral: "#d4d2cc",
  brand: "var(--color-brand-500)",
  primary: "var(--color-ink)",
};
const BAR_COLORS = ["var(--color-brand-500)", "#6f6e69", "#e2e0da"];
const DOT: Record<Tone, string> = { ok: "#23874f", info: "#2f5be9", warn: "#c97f00", danger: "#c93434", neutral: "#8a8984", brand: "#f39200" };
const FILTER_OF: Record<string, string> = { diaľkový: "Diaľkové", prechod: "Prechody", kuriér: "Kuriéri" };

type Filter = "all" | "risk" | string;

/** Delta of the estimate: late is amber, very late red, early or on time green. */
const deltaTone = (m: number): Tone => (m > 15 ? "danger" : m > 0 ? "warn" : "ok");

function tripColumns(now: Date | null, navigate: (to: string) => void): Column<TripRow>[] {
  return [
    {
      key: "plan",
      header: "Plán",
      width: "5rem",
      render: (r) => (
        <span className="flex flex-col leading-tight">
          <span className="font-bold tabular-nums">{hhmm(r.plan)}</span>
          {r.plan && now && new Date(r.plan) > now && r.missing === null && <span className="text-ink-muted text-[11px] whitespace-nowrap">{relative(r.plan, now)}</span>}
        </span>
      ),
    },
    {
      key: "dir",
      header: "Smer",
      minWidth: "9.75rem",
      title: (r) => r.direction,
      render: (r) => {
        const body = (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-semibold">{r.direction}</span>
            <span className="text-ink-muted truncate text-[11.5px]">
              {r.plate} · {r.typeLabel}
            </span>
          </span>
        );
        const href = r.href;
        return href ? (
          <button type="button" className="max-w-full min-w-0 text-left hover:underline" onClick={() => navigate(href)}>
            {body}
          </button>
        ) : (
          body
        );
      },
    },
    { key: "door", header: "Brána", width: "4.5rem", render: (r) => <span className="text-ink-soft font-mono text-xs font-semibold">{r.door ?? "—"}</span> },
    {
      key: "status",
      header: "Stav",
      width: "7rem",
      control: true,
      render: (r) => (
        <StatusBadge tone={r.statusTone} variant={r.status === "planned" ? "plain" : "tinted"}>
          {r.statusLabel}
        </StatusBadge>
      ),
    },
    {
      key: "load",
      header: "Nakládka",
      minWidth: "8.25rem",
      render: (r) => {
        if (r.expected === 0 && r.loadingFrom === null && r.missing === null) return <span className="text-ink-faint">—</span>;
        const pct = r.expected ? Math.min(100, (r.loaded / r.expected) * 100) : 0;
        const late = r.missing !== null && r.missing > 20;
        const bar = r.missing === null ? "var(--color-brand-500)" : late ? "var(--color-warn-600)" : "var(--color-ok-600)";
        return (
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2">
              <span className="bg-line-soft h-1.5 flex-1 overflow-hidden rounded-[3px]">
                <span className="block h-full rounded-[3px]" style={{ width: `${String(pct)}%`, background: bar }} />
              </span>
              <span className="text-ink-soft text-xs font-semibold whitespace-nowrap tabular-nums">
                {num(r.loaded)} / {num(r.expected)}
              </span>
            </span>
            <span className={`text-[11px] font-semibold whitespace-nowrap ${late ? "text-warn-700" : "text-ink-muted"}`}>
              {r.missing !== null ? (r.missing ? `${num(r.missing)} nenaložených` : "kompletné") : r.loadingFrom
                  ? // a truck stands at its door from then; the couriers start loading at 06:30
                    `${r.typeLabel === "kuriér" ? "nakládka od" : "pri bráne od"} ${hhmm(r.loadingFrom)}`
                  : ""}
            </span>
          </span>
        );
      },
    },
    {
      key: "eta",
      header: "Odhad",
      width: "6.75rem",
      control: true,
      title: (r) => (r.etaBy === "ml" ? "odhad modelu ML" : r.etaBy === "cascade" ? "odhad z kaskády nočných kamiónov" : r.etaBy === "telematics" ? "odhad z polohy" : ""),
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="font-semibold tabular-nums">{hhmm(r.eta)}</span>
          {r.deltaMin !== null && r.deltaMin !== 0 && <DeltaBadge tone={deltaTone(r.deltaMin)}>{signedMinutes(r.deltaMin)}</DeltaBadge>}
        </span>
      ),
    },
    {
      key: "risk",
      header: "Riziko",
      width: "6.25rem",
      control: true,
      render: (r) =>
        r.risk ? (
          <RiskChip tone={r.risk.tone} title={r.risk.reason}>
            {r.risk.label}
          </RiskChip>
        ) : (
          <span className="text-[#b5b4af]">—</span>
        ),
    },
  ];
}

function TripsCard({ data, now }: { data: Dispatch; now: Date | null }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"out" | "in">("out");
  const [filter, setFilter] = useState<Filter>("all");
  const groups = data.groups.filter((g) => g.tab === tab);
  const inTab = data.trips.filter((r) => groups.some((g) => g.key === r.group));
  const types = [...new Set(inTab.map((r) => r.typeLabel))].filter((t) => FILTER_OF[t]);
  const risky = inTab.filter((r) => r.risk).length;
  const keep = (r: TripRow) => filter === "all" || (filter === "risk" ? r.risk !== null : r.typeLabel === filter);
  const rowGroups: RowGroup<TripRow>[] = groups
    .map((g) => ({ key: g.key, title: g.title, sub: g.sub, dot: DOT[g.tone], rows: data.trips.filter((r) => r.group === g.key && keep(r)) }))
    .filter((g) => g.rows.length > 0);
  const count = (t: "out" | "in") => data.trips.filter((r) => data.groups.some((g) => g.key === r.group && g.tab === t)).length;
  const columns = useMemo(() => tripColumns(now, (to) => void navigate(to)), [now, navigate]);
  return (
    <Card
      flush
      label="Jazdy dňa"
      title={
        <span className="flex items-center gap-2.5">
          Jazdy dňa
          <SegmentedTabs
            label="Smer jázd"
            items={[
              { id: "out", label: "Odchody", count: count("out") },
              { id: "in", label: "Príchody", count: count("in") },
            ]}
            active={tab}
            onChange={(t) => {
              setTab(t);
              setFilter("all");
            }}
          />
        </span>
      }
      actions={
        <FilterChips
          label="Filter jázd"
          active={filter}
          onChange={setFilter}
          items={[
            { id: "all", label: "Všetky" },
            ...types.map((t) => ({ id: t, label: FILTER_OF[t] ?? t })),
            ...(risky ? [{ id: "risk", label: "S rizikom", count: risky, accent: true }] : []),
          ]}
        />
      }
    >
      <DataTable
        columns={columns}
        groups={rowGroups}
        rowKey={(r) => r.key}
        empty={<EmptyState title="Žiadne jazdy" description="V tomto výbere nie je žiadna jazda." />}
        actions={(r) => (
          <Menu
            trigger={
              <button type="button" aria-label={`Akcie: ${r.direction}`} className="text-ink-muted hover:bg-track grid h-7 w-7 place-items-center rounded-md">
                <MoreVertical size={16} />
              </button>
            }
          >
            {r.href && <MenuItem onSelect={() => void navigate(r.href ?? "/")}>{r.href.startsWith("/shadow") ? "Otvoriť v digitálnom tieni" : "Otvoriť"}</MenuItem>}
            <MenuItem onSelect={() => void navigate(`/fleet?plate=${encodeURIComponent(r.plate)}`)}>Vozidlo vo Flotile</MenuItem>
          </Menu>
        )}
      />
    </Card>
  );
}

function AlertsCard({ data }: { data: Dispatch }) {
  const navigate = useNavigate();
  const ack = useAckAlert();
  const maintenance = useStartMaintenance();
  const [tab, setTab] = useState<"all" | "critical" | "warning">("all");
  const [all, setAll] = useState(false);
  const critical = data.alerts.filter((a) => a.severity === "critical").length;
  const shown = data.alerts.filter((a) => tab === "all" || (tab === "critical" ? a.severity === "critical" : a.severity !== "critical"));
  const act = (a: AlertCard) => {
    if (!a.action) return undefined;
    const { kind, target, label } = a.action;
    return {
      label,
      disabled: maintenance.isPending,
      onClick: () => (kind === "maintenance" ? maintenance.mutate({ code: target, minutes: 30 }) : void navigate(target)),
    };
  };
  return (
    <Card
      flush
      label="Alarmy"
      title={
        <span className="flex items-center gap-2">
          Alarmy
          {data.alerts.length > 0 && <span className="bg-danger-100 text-danger-700 rounded-full px-[7px] py-px text-[11.5px] font-bold">{data.alerts.length}</span>}
        </span>
      }
      actions={
        <SegmentedTabs
          size="sm"
          label="Závažnosť"
          active={tab}
          onChange={setTab}
          items={[
            { id: "all", label: "Všetky" },
            { id: "critical", label: "Kritické", count: critical },
            { id: "warning", label: "Varovania", count: data.alerts.length - critical },
          ]}
        />
      }
    >
      {shown.length === 0 ? (
        <div className="py-6">
          <EmptyState title="Žiadne aktívne alarmy" description="Všetko beží podľa plánu." />
        </div>
      ) : (
        <>
          {(all ? shown : shown.slice(0, 4)).map((a) => (
            <AlertItem
              key={a.id}
              tone={a.severity === "critical" ? "danger" : "warn"}
              type={ALERT_KIND[a.kind]}
              meta={[hhmm(a.at), a.source].filter(Boolean).join(" · ")}
              title={a.title}
              facts={a.facts}
              primary={act(a)}
              secondary={{ label: "Potvrdiť", onClick: () => ack.mutate(a.id), disabled: ack.isPending }}
            />
          ))}
          {shown.length > 4 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="text-brand-700 hover:text-brand-800 flex h-10 w-full items-center justify-center gap-1 text-[12.5px] font-bold">
              {all ? "Zobraziť menej" : `Zobraziť všetkých ${String(shown.length)} alarmov`} <ArrowRight size={14} />
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function DirectionsCard({ data }: { data: Dispatch }) {
  const max = Math.max(1, ...data.directions.map((d) => d.total));
  return (
    <Card
      label="Balíky podľa smerov"
      title={data.depot.mode === "transship" ? "Balíky podľa smerov" : "Balíky podľa rajónov"}
      actions={
        <span className="flex flex-wrap gap-3.5 text-xs font-semibold text-neutral-700">
          {data.legend.map((l, i) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: BAR_COLORS[i] }} />
              {l} {num(data.legendTotals[i] ?? 0)}
            </span>
          ))}
        </span>
      }
    >
      {data.directions.length === 0 ? (
        <EmptyState title="Zatiaľ žiadne balíky" />
      ) : (
        <div className="flex flex-col gap-[9px]">
          {data.directions.map((d) => (
            <div key={d.name} className="grid grid-cols-[8.25rem_minmax(0,1fr)_3rem] items-center gap-3 text-[12.5px]">
              <span className="truncate font-semibold" title={d.name}>
                {d.name}
              </span>
              <StackedBar scale={d.total / max} segments={d.parts.map((v, i) => ({ value: v, color: BAR_COLORS[i] ?? "#e2e0da", label: data.legend[i] ?? "" }))} />
              <span className="text-ink-soft text-right font-bold tabular-nums">{num(d.total)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DayCard({ data, now }: { data: Dispatch; now: Date | null }) {
  return (
    <Card
      label="Prevádzkový deň"
      title={
        <span className="flex items-center gap-2">
          Prevádzkový deň <span className="text-ink-muted text-xs font-normal">15:00 → 15:00</span>
        </span>
      }
    >
      <DayTimeline
        dayStart={new Date(data.dayStart)}
        now={now}
        segments={data.timeline.map((s) => ({ name: s.name, start: new Date(s.start), end: new Date(s.end), color: TONE_VAR[s.tone] }))}
      />
      <ul className="mt-3.5">
        {data.timeline.map((s) => (
          <li key={s.name} className="border-line-soft flex items-center gap-2.5 border-t py-2 text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: TONE_VAR[s.tone] }} />
            <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
            <span className="text-ink-muted whitespace-nowrap tabular-nums">
              {hhmm(s.start)}
              {s.end !== s.start && new Date(s.end).getTime() - new Date(s.start).getTime() > 15 * 60_000 ? `–${hhmm(s.end)}` : ""}
            </span>
            <StatusBadgeLite tone={s.stateTone}>{s.state}</StatusBadgeLite>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StatusBadgeLite({ tone, children }: { tone: Tone; children: string }) {
  const cls: Record<Tone, string> = {
    ok: "bg-ok-100 text-ok-700",
    info: "bg-info-100 text-info-700",
    warn: "bg-warn-100 text-warn-700",
    danger: "bg-danger-100 text-danger-700",
    neutral: "bg-neutral-100 text-neutral-700",
    brand: "bg-warn-100 text-warn-700",
  };
  return <span className={`rounded-[5px] px-[7px] py-px text-[11.5px] font-bold whitespace-nowrap ${cls[tone]}`}>{children}</span>;
}

/** CSV of the day's trips (Excel: semicolons, UTF-8 with BOM). */
function exportDay(data: Dispatch) {
  const head = ["Skupina", "Plán", "Smer", "Vozidlo", "Typ", "Brána", "Stav", "Naložené", "Očakávané", "Nenaložené", "Odhad", "Odchýlka (min)", "Riziko"];
  const groupName = new Map(data.groups.map((g) => [g.key, g.title]));
  const rows = data.trips.map((r) => [
    groupName.get(r.group) ?? r.group,
    hhmm(r.plan),
    r.direction,
    r.plate,
    r.typeLabel,
    r.door ?? "",
    r.statusLabel,
    String(r.loaded),
    String(r.expected),
    r.missing === null ? "" : String(r.missing),
    hhmm(r.eta),
    r.deltaMin === null ? "" : String(r.deltaMin),
    r.risk?.label ?? "",
  ]);
  const csv = [head, ...rows].map((line) => line.map((v) => `"${v.replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `dispecing-${data.depot.code}-${data.clock.operatingDay}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Dispatching of design system v2 (docs/design/maketa-dispecing) for the depot of the top bar:
 * KPIs with the day's history, trips in groups with the estimate and the risk, structured
 * alerts with actions, parcels per direction and the operating day (ADR-067, ADR-068).
 */
export function DashboardPage() {
  const { code } = useDepot();
  const dispatch = useDispatch(code);
  const navigate = useNavigate();
  const { now } = useSimClock();
  const data = dispatch.data;
  if (dispatch.isError && !data) {
    return <p className="bg-danger-100 text-danger-700 rounded-xl px-4 py-3 text-sm">Dispečing sa nepodarilo načítať.</p>;
  }
  if (!data) return <Spinner label="Načítavam dispečing…" className="py-20" />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dispečing"
        subtitle={`Prevádzkový deň so ${dayMonth(data.dayStart)} · ${data.summary}`}
        actions={
          <>
            {data.depot.mode === "transship" && (
              <Button variant="secondary" icon={<FlaskConical size={15} />} onClick={() => void navigate(`/shadow?depot=${data.depot.code}&scenario=1`)}>
                Scenár (čo ak)
              </Button>
            )}
            <Button icon={<Download size={15} />} onClick={() => exportDay(data)}>
              Export dňa
            </Button>
          </>
        }
      />
      <section aria-label="Ukazovatele" className="kpi-grid">
        {data.kpis.map((k) => (
          <KpiCard key={k.key} label={k.label} tone={k.tone} value={k.value} unit={k.unit ?? undefined} spark={k.spark} delta={k.delta ?? undefined} context={k.context ?? undefined} />
        ))}
      </section>
      <div className="dispatch-grid">
        <TripsCard data={data} now={now} />
        <AlertsCard data={data} />
      </div>
      <div className="dispatch-grid">
        <DirectionsCard data={data} />
        <DayCard data={data} now={now} />
      </div>
    </div>
  );
}

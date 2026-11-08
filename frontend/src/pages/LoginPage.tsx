import { ChevronDown, Eye, EyeOff, Package } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useLogin, useMe } from "../api/auth";
import { isApiError } from "../api/client";
import { useLoginInfo, type LoginInfo } from "../api/public";
import { ROLE_LABEL } from "../auth/roles";
import { NetworkMap } from "../components/NetworkMap";
import { cn, Logo, Popover } from "../components/ui";

function loginErrorMessage(err: unknown): string {
  if (isApiError(err, 401)) return "Nesprávne používateľské meno alebo heslo.";
  if (isApiError(err, 403)) return "Účet je zablokovaný. Obráťte sa na administrátora.";
  if (isApiError(err, 429)) return "Príliš veľa pokusov o prihlásenie. Skúste to znova o minútu.";
  if (isApiError(err, 422)) return "Vyplňte používateľské meno aj heslo.";
  if (isApiError(err, 0)) return "Server je nedostupný. Skontrolujte pripojenie.";
  return "Prihlásenie zlyhalo. Skúste to znova.";
}

/** "4 ML modely", "1 ML model", "5 skladov" */
function plural(n: number, one: string, few: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
}

function Pill({ color, children }: { color: string; children: string }) {
  return (
    <span className="flex h-8 items-center gap-2 rounded-full bg-[#2a2926] px-3 text-[12.5px] font-semibold text-[#e9e8e4]">
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

/** Dark brand panel with the network of depots (maketa-login). */
function BrandPanel({ info }: { info: LoginInfo | undefined }) {
  return (
    <section aria-label="Depot 5.0" className="relative flex min-w-0 flex-col overflow-hidden bg-[#1d1d1b] px-6 py-6 text-white md:min-h-full md:flex-[1.25] md:px-12 md:py-10">
      <div className="relative flex items-center gap-3">
        <Logo size={40} />
        <span className="text-lg font-extrabold tracking-[-0.01em]">Depot 5.0</span>
      </div>
      <div className="mx-auto my-4 w-full max-w-[760px] md:my-8">{info && <NetworkMap info={info} />}</div>
      <span className="hidden flex-1 md:block" />
      <div className="relative max-w-[520px]">
        <h1 className="text-[26px] leading-[1.15] font-extrabold tracking-[-0.02em] md:text-4xl">
          Prekládková sieť
          <br />
          pod kontrolou.
        </h1>
        <p className="mt-3.5 hidden text-[15px] leading-[1.55] text-[#c9c8c3] sm:block">
          Nakládka, telematika a digitálny tieň pre všetky depá na jednom mieste. Predikcie meškaní a údržby skenerov skôr, než sa niečo pokazí.
        </p>
        {info && (
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Pill color="#f39200">{plural(info.depots.length, "sklad", "sklady", "skladov")}</Pill>
            <Pill color={info.telemetryLive ? "#3fb86f" : "#8a8984"}>{info.telemetryLive ? "Telemetria naživo" : "Telemetria nedostupná"}</Pill>
            <Pill color="#6f8fff">{plural(info.mlModels, "ML model", "ML modely", "ML modelov")}</Pill>
          </div>
        )}
      </div>
    </section>
  );
}

/** Names and roles of the demo accounts (demo mode only); a click fills in the username. */
function DemoAccounts({ accounts, onPick }: { accounts: NonNullable<LoginInfo["demoAccounts"]>; onPick: (username: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-line rounded-[10px] border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-ink-soft flex w-full items-center justify-between px-3.5 py-2.5 text-[12.5px] font-semibold"
      >
        Demo účty (obhajoba)
        <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <ul className="border-line-soft grid grid-cols-2 gap-1 border-t p-1.5">
          {accounts.map((a) => (
            <li key={a.username}>
              <button
                type="button"
                onClick={() => onPick(a.username)}
                className="hover:bg-track w-full rounded-md px-2 py-1.5 text-left"
                aria-label={`${a.username}, ${ROLE_LABEL[a.role]}: vyplniť meno`}
              >
                <span className="block font-mono text-xs font-semibold">{a.username}</span>
                <span className="text-ink-muted block text-[11.5px]">
                  {ROLE_LABEL[a.role]}
                  {a.depot ? ` · ${a.depot}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <p className="text-ink-muted border-line-soft border-t px-3.5 py-2 text-[11.5px]">Heslá sú v súbore .env (SEED_*_PASSWORD).</p>}
    </div>
  );
}

/**
 * Login of design system v2 (docs/design/maketa-login): dark panel with the network of depots
 * from the database, the form with a password toggle and the error states, the 8 h session.
 */
export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const info = useLoginInfo();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (me.data) return <Navigate to={from} replace />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ username, password }, { onSuccess: () => navigate(from, { replace: true }) });
  }

  const data = info.data;
  const statusOk = data?.servicesOk ?? null;
  const inputCls =
    "border-[#d9d8d3] bg-surface text-ink focus:border-brand-500 h-[42px] w-full rounded-[9px] border px-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgb(243_146_0/0.18)]";
  return (
    <div className="bg-surface flex min-h-full flex-col md:flex-row">
      <BrandPanel info={data} />
      <section aria-label="Prihlásenie" className="flex min-w-0 flex-1 flex-col px-6 py-6 md:px-12 md:py-10">
        <div className="text-ink-muted flex items-center justify-end gap-1.5 text-[12.5px]">
          {statusOk !== null && (
            <>
              <span className={cn("h-[7px] w-[7px] rounded-full", statusOk ? "bg-ok-600" : "bg-warn-600")} />
              {statusOk ? "Všetky služby v prevádzke" : "Niektoré služby nebežia"}
            </>
          )}
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <form onSubmit={onSubmit} noValidate className="flex w-full max-w-[360px] flex-col gap-[18px]">
            <div>
              <h2 className="text-[26px] font-extrabold tracking-[-0.01em]">Prihlásenie</h2>
              <p className="text-ink-muted mt-1.5 text-[13.5px] leading-normal">Použite svoje firemné konto. Prístup je možný len z firemnej siete alebo cez VPN.</p>
            </div>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Používateľské meno
              <input
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputCls}
                aria-invalid={isApiError(login.error, 401) || undefined}
              />
            </label>
            <div className="flex flex-col gap-1.5 text-[13px] font-semibold">
              <span className="flex justify-between">
                <label htmlFor="password">Heslo</label>
                <Popover
                  align="end"
                  className="w-72 p-3.5"
                  trigger={
                    <button type="button" className="text-brand-700 hover:text-brand-800 text-[12.5px] font-semibold underline underline-offset-2">
                      Zabudnuté heslo?
                    </button>
                  }
                >
                  <p className="text-ink-soft text-[13px] leading-snug font-normal">
                    Heslo obnoví <b>administrátor</b> v správe používateľov. Kontaktujte vedúceho zmeny alebo IT podporu, nové heslo dostanete osobne.
                  </p>
                </Popover>
              </span>
              <span className="relative flex">
                <input
                  id="password"
                  ref={passwordRef}
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn(inputCls, "pr-[42px]")}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Skryť heslo" : "Zobraziť heslo"}
                  aria-pressed={show}
                  className="text-ink-muted hover:bg-track absolute top-1 right-1 grid h-[34px] w-[34px] place-items-center rounded-[7px]"
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </div>

            {login.isError && (
              <p role="alert" className="bg-danger-100 text-danger-700 rounded-[9px] px-3 py-2 text-[13px] font-medium">
                {loginErrorMessage(login.error)}
              </p>
            )}

            <button
              type="submit"
              disabled={login.isPending || !username || !password}
              className="bg-primary text-on-primary hover:bg-primary-hover h-11 rounded-[9px] text-sm font-bold transition-colors disabled:opacity-50"
            >
              {login.isPending ? "Prihlasujem…" : "Prihlásiť sa"}
            </button>
            <p className="text-ink-muted text-[12.5px] leading-normal">
              Relácia platí {String(data?.sessionHours ?? 8)} hodín (dĺžka smeny). Po prihlásení uvidíte svoj sklad, dispečeri a administrátori môžu sklady prepínať.
            </p>
            {data?.demoAccounts && (
              <DemoAccounts
                accounts={data.demoAccounts}
                onPick={(u) => {
                  setUsername(u);
                  passwordRef.current?.focus();
                }}
              />
            )}
            <div className="border-line bg-subtle flex items-center gap-2.5 rounded-[10px] border px-3.5 py-3">
              <span className="bg-brand-50 text-brand-700 grid h-8 w-8 shrink-0 place-items-center rounded-lg">
                <Package size={16} aria-hidden="true" />
              </span>
              <span className="text-ink-soft text-[12.5px] leading-[1.45]">
                <b>Čakáte zásielku?</b> Sledujte ju cez odkaz zo SMS, prihlásenie nepotrebujete.
              </span>
            </div>
          </form>
        </div>
        <div className="text-ink-muted flex justify-between text-xs">
          <span>Depot 5.0 · interný systém</span>
          <Popover
            align="end"
            className="w-64 p-3.5"
            trigger={
              <button type="button" className="text-ink-muted underline underline-offset-2">
                Stav systému
              </button>
            }
          >
            <ul className="text-ink-soft space-y-1.5 text-[13px]">
              <li className="flex justify-between gap-2">
                WMS <b className={data ? "text-ok-700" : "text-warn-700"}>{data ? "beží" : info.isError ? "nedostupné" : "—"}</b>
              </li>
              <li className="flex justify-between gap-2">
                Telematika <b className={data?.telemetryLive ? "text-ok-700" : "text-warn-700"}>{data ? (data.telemetryLive ? "beží" : "nedostupná") : "—"}</b>
              </li>
              <li className="flex justify-between gap-2">
                ML modely <b>{data ? String(data.mlModels) : "—"}</b>
              </li>
            </ul>
          </Popover>
        </div>
      </section>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useLogin, useMe } from "../api/auth";
import { isApiError } from "../api/client";
import { Logo } from "../components/ui";

function loginErrorMessage(err: unknown): string {
  if (isApiError(err, 401)) return "Nesprávne používateľské meno alebo heslo.";
  if (isApiError(err, 403)) return "Účet je deaktivovaný. Obráťte sa na administrátora.";
  if (isApiError(err, 429)) return "Príliš veľa pokusov o prihlásenie. Skúste to znova o minútu.";
  if (isApiError(err, 422)) return "Vyplňte používateľské meno aj heslo.";
  if (isApiError(err, 0)) return "Server je nedostupný. Skontrolujte pripojenie.";
  return "Prihlásenie zlyhalo. Skúste to znova.";
}

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (me.data) {
    return <Navigate to={from} replace />;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate(
      { username, password },
      { onSuccess: () => navigate(from, { replace: true }) },
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-50 via-canvas to-neutral-100 p-4">
      <div className="bg-surface shadow-card rounded-card w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-xl font-semibold">DepoTrack</h1>
            <p className="text-ink-muted text-sm">SPS depo Košice</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium">
              Používateľské meno
            </label>
            <input
              id="username"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="border-line focus:border-brand-500 focus:ring-brand-100 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-4"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Heslo
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-line focus:border-brand-500 focus:ring-brand-100 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-4"
            />
          </div>

          {login.isError && (
            <p role="alert" className="rounded-xl bg-danger-100 px-3 py-2 text-sm text-danger-600">
              {loginErrorMessage(login.error)}
            </p>
          )}

          <button
            type="submit"
            disabled={login.isPending || !username || !password}
            className="bg-brand-500 hover:bg-brand-600 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-on-brand transition-colors disabled:opacity-50"
          >
            {login.isPending ? "Prihlasujem…" : "Prihlásiť sa"}
          </button>
        </form>
      </div>
    </div>
  );
}

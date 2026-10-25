import { useEffect, useState, type FormEvent } from "react";
import type { Role, User } from "../../api/auth";
import { isApiError } from "../../api/client";
import { useCreateUser, useUpdateUser, type UserUpdate } from "../../api/users";
import { ROLE_LABEL, ROLES } from "../../auth/roles";

interface Props {
  /** undefined = create a new user */
  user?: User;
  isSelf: boolean;
  onClose: () => void;
}

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function saveErrorMessage(err: unknown): string {
  if (isApiError(err, 409)) return "Používateľské meno už existuje.";
  if (isApiError(err, 400)) return "Vlastný účet nemôžete deaktivovať ani mu zmeniť rolu.";
  if (isApiError(err, 422))
    return "Skontrolujte údaje: meno 3–32 znakov (a–z, 0–9, . _ -), heslo aspoň 8 znakov.";
  if (isApiError(err, 403)) return "Na túto akciu nemáte oprávnenie.";
  if (isApiError(err, 0)) return "Server je nedostupný.";
  return "Uloženie zlyhalo.";
}

const inputCls =
  "border-line focus:border-brand-500 focus:ring-brand-100 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-4 disabled:bg-canvas disabled:text-ink-muted";

export function UserDialog({ user, isSelf, onClose }: Props) {
  const create = useCreateUser();
  const update = useUpdateUser();
  const mutation = user ? update : create;

  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "operator");
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const normalizedUsername = username.trim().toLowerCase();
  const usernameInvalid = !user && username !== "" && !USERNAME_RE.test(normalizedUsername);
  const passwordInvalid = password !== "" && password.length < 8;
  const canSubmit =
    fullName.trim().length >= 2 &&
    !passwordInvalid &&
    (user ? true : USERNAME_RE.test(normalizedUsername) && password.length >= 8);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (user) {
      const body: UserUpdate = { full_name: fullName.trim() };
      if (!isSelf) {
        body.role = role;
        body.active = active;
      }
      if (password) body.password = password;
      update.mutate({ id: user.id, ...body }, { onSuccess: onClose });
    } else {
      create.mutate(
        { username: normalizedUsername, full_name: fullName.trim(), role, password },
        { onSuccess: onClose },
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-dialog-title"
        className="bg-surface shadow-card rounded-card w-full max-w-md p-6"
      >
        <h2 id="user-dialog-title" className="mb-4 text-lg font-semibold">
          {user ? `Upraviť: ${user.username}` : "Nový používateľ"}
        </h2>

        <form onSubmit={onSubmit} className="space-y-4">
          {!user && (
            <div>
              <label htmlFor="u-username" className="mb-1 block text-sm font-medium">
                Používateľské meno
              </label>
              <input
                id="u-username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputCls}
                aria-invalid={usernameInvalid}
              />
              <p className={`mt-1 text-xs ${usernameInvalid ? "text-rose-600" : "text-ink-muted"}`}>
                3–32 znakov: malé písmená bez diakritiky, číslice, bodka, podčiarkovník, pomlčka.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="u-name" className="mb-1 block text-sm font-medium">
              Celé meno
            </label>
            <input
              id="u-name"
              autoFocus={!!user}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="u-role" className="mb-1 block text-sm font-medium">
              Rola
            </label>
            <select
              id="u-role"
              value={role}
              disabled={isSelf}
              onChange={(e) => setRole(e.target.value as Role)}
              className={inputCls}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>

          {user && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                disabled={isSelf}
                onChange={(e) => setActive(e.target.checked)}
                className="accent-brand-500 h-4 w-4"
              />
              Účet je aktívny
            </label>
          )}
          {isSelf && (
            <p className="text-ink-muted text-xs">
              Vlastnú rolu ani stav účtu nemôžete zmeniť, aby ste sa nezamkli.
            </p>
          )}

          <div>
            <label htmlFor="u-password" className="mb-1 block text-sm font-medium">
              {user ? "Nové heslo (nepovinné)" : "Heslo"}
            </label>
            <input
              id="u-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              aria-invalid={passwordInvalid}
            />
            <p className={`mt-1 text-xs ${passwordInvalid ? "text-rose-600" : "text-ink-muted"}`}>
              Aspoň 8 znakov.{user ? " Zmena hesla odhlási používateľa zo všetkých zariadení." : ""}
            </p>
          </div>

          {mutation.isError && (
            <p role="alert" className="rounded-xl bg-rose-100 px-3 py-2 text-sm text-rose-600">
              {saveErrorMessage(mutation.error)}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="text-ink-muted hover:bg-canvas rounded-xl px-4 py-2 text-sm"
            >
              Zrušiť
            </button>
            <button
              type="submit"
              disabled={!canSubmit || mutation.isPending}
              className="bg-brand-500 hover:bg-brand-700 rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {mutation.isPending ? "Ukladám…" : "Uložiť"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

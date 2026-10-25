import { useMemo, useState } from "react";
import { useMe, type User } from "../../api/auth";
import { useUsers } from "../../api/users";
import { ROLE_BADGE, ROLE_LABEL } from "../../auth/roles";
import { UserDialog } from "./UserDialog";

type DialogState = { mode: "create" } | { mode: "edit"; user: User } | null;

export function UsersTab() {
  const users = useUsers();
  const me = useMe();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = users.data ?? [];
    if (!q) return list;
    return list.filter(
      (u) =>
        u.username.includes(q) ||
        u.full_name.toLowerCase().includes(q) ||
        ROLE_LABEL[u.role].toLowerCase().includes(q),
    );
  }, [users.data, query]);

  return (
    <section className="bg-surface shadow-card rounded-card">
      <div className="border-line flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Hľadať meno, používateľa alebo rolu…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border-line focus:border-brand-500 focus:ring-brand-100 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-4 sm:max-w-xs"
        />
        <button
          type="button"
          onClick={() => setDialog({ mode: "create" })}
          className="bg-brand-500 hover:bg-brand-700 rounded-xl px-4 py-2 text-sm font-medium text-white"
        >
          + Pridať používateľa
        </button>
      </div>

      {users.isPending && <p className="text-ink-muted p-8 text-center text-sm">Načítavam…</p>}
      {users.isError && (
        <p className="m-4 rounded-xl bg-rose-100 px-3 py-2 text-sm text-rose-600">
          Zoznam používateľov sa nepodarilo načítať.{" "}
          <button type="button" className="underline" onClick={() => void users.refetch()}>
            Skúsiť znova
          </button>
        </p>
      )}
      {users.isSuccess && filtered.length === 0 && (
        <p className="text-ink-muted p-8 text-center text-sm">Žiadny používateľ nezodpovedá hľadaniu.</p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted text-xs tracking-wide uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Meno</th>
                <th className="px-4 py-3 font-medium">Používateľ</th>
                <th className="px-4 py-3 font-medium">Rola</th>
                <th className="px-4 py-3 font-medium">Stav</th>
                <th className="px-4 py-3 font-medium">Vytvorený</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-line hover:bg-canvas/60 border-t">
                  <td className="px-4 py-3 font-medium">
                    {u.full_name}
                    {u.id === me.data?.id && (
                      <span className="text-ink-muted ml-2 text-xs font-normal">(vy)</span>
                    )}
                  </td>
                  <td className="text-ink-muted px-4 py-3 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs ${ROLE_BADGE[u.role]}`}>
                      {ROLE_LABEL[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.active ? (
                      <span className="text-mint-600 text-xs">● Aktívny</span>
                    ) : (
                      <span className="text-xs text-rose-600">● Deaktivovaný</span>
                    )}
                  </td>
                  <td className="text-ink-muted px-4 py-3 text-xs">
                    {new Date(u.created_at).toLocaleDateString("sk-SK")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setDialog({ mode: "edit", user: u })}
                      className="text-brand-700 hover:bg-brand-50 rounded-lg px-3 py-1 text-sm"
                    >
                      Upraviť
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <UserDialog
          user={dialog.mode === "edit" ? dialog.user : undefined}
          isSelf={dialog.mode === "edit" && dialog.user.id === me.data?.id}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

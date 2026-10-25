import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useMe, type User } from "../../api/auth";
import { useUsers } from "../../api/users";
import { ROLE_LABEL, ROLE_TONE } from "../../auth/roles";
import { Badge, Button, Card, DataTable, EmptyState, StatusDot, type Column } from "../ui";
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

  const columns: Column<User>[] = [
    {
      key: "name",
      header: "Meno",
      minWidth: "11rem",
      title: (u) => u.full_name,
      render: (u) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{u.full_name}</span>
          {u.id === me.data?.id && (
            <span className="text-ink-muted shrink-0 text-xs whitespace-nowrap">(vy)</span>
          )}
        </span>
      ),
    },
    {
      key: "username",
      header: "Používateľ",
      width: "9rem",
      hideBelow: "md",
      title: (u) => u.username,
      render: (u) => <span className="text-ink-muted font-mono text-xs">{u.username}</span>,
    },
    {
      key: "role",
      header: "Rola",
      width: "11.5rem",
      render: (u) => <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>,
    },
    {
      key: "active",
      header: "Stav",
      width: "9rem",
      hideBelow: "sm",
      render: (u) =>
        u.active ? (
          <StatusDot tone="ok" colored>
            Aktívny
          </StatusDot>
        ) : (
          <StatusDot tone="danger" colored>
            Deaktivovaný
          </StatusDot>
        ),
    },
    {
      key: "created",
      header: "Vytvorený",
      width: "7rem",
      hideBelow: "lg",
      render: (u) => <span className="text-ink-muted text-xs">{new Date(u.created_at).toLocaleDateString("sk-SK")}</span>,
    },
    {
      key: "actions",
      header: "",
      width: "7.5rem",
      align: "right",
      control: true,
      render: (u) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDialog({ mode: "edit", user: u });
          }}
        >
          Upraviť
        </Button>
      ),
    },
  ];

  return (
    <Card flush>
      <div className="border-line flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative w-full sm:max-w-xs">
          <Search size={16} className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
          <input
            type="search"
            placeholder="Hľadať meno, používateľa alebo rolu…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-line focus:border-brand-500 focus:ring-brand-100 w-full rounded-xl border py-2 pr-3 pl-9 text-sm outline-none focus:ring-4"
          />
        </label>
        <Button icon={<Plus size={16} />} onClick={() => setDialog({ mode: "create" })}>
          Pridať používateľa
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={users.data ? filtered : undefined}
        rowKey={(u) => u.id}
        onRowClick={(u) => setDialog({ mode: "edit", user: u })}
        loading={users.isPending}
        error={
          users.isError && (
            <p className="bg-danger-100 text-danger-600 rounded-xl px-3 py-2 text-sm">
              Zoznam používateľov sa nepodarilo načítať.{" "}
              <button type="button" className="underline" onClick={() => void users.refetch()}>
                Skúsiť znova
              </button>
            </p>
          )
        }
        empty={<EmptyState title="Žiadny používateľ nezodpovedá hľadaniu" />}
      />

      {dialog && (
        <UserDialog
          user={dialog.mode === "edit" ? dialog.user : undefined}
          isSelf={dialog.mode === "edit" && dialog.user.id === me.data?.id}
          onClose={() => setDialog(null)}
        />
      )}
    </Card>
  );
}

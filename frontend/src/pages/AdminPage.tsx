import { useState } from "react";
import { UsersTab } from "../components/admin/UsersTab";

interface Tab {
  id: string;
  label: string;
  /** phase in which the tab gets its content; undefined = ready */
  phase?: number;
}

const TABS: Tab[] = [
  { id: "users", label: "Používatelia" },
  { id: "directions", label: "Smery", phase: 3 },
  { id: "devices", label: "Zariadenia", phase: 3 },
  { id: "simulation", label: "Simulácia", phase: 3 },
  { id: "notifications", label: "Notifikácie zákazníkom", phase: 4 },
];

export function AdminPage() {
  const [active, setActive] = useState("users");
  const tab = TABS.find((t) => t.id === active) ?? TABS[0]!;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Administrácia</h1>
        <p className="text-ink-muted mt-1 text-sm">
          Správa používateľov a rolí, smerov, zariadení a simulácie.
        </p>
      </header>

      <div role="tablist" className="bg-surface shadow-card mb-6 flex gap-1 overflow-x-auto rounded-2xl p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={t.id === active}
            onClick={() => setActive(t.id)}
            className={`rounded-xl px-4 py-2 text-sm whitespace-nowrap transition-colors ${
              t.id === active
                ? "bg-brand-100 text-brand-700 font-medium"
                : "text-ink-muted hover:bg-brand-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab.phase === undefined ? (
        <UsersTab />
      ) : (
        <div className="bg-surface shadow-card rounded-card text-ink-muted p-10 text-center text-sm">
          Táto časť pribudne vo fáze {tab.phase}.
        </div>
      )}
    </div>
  );
}

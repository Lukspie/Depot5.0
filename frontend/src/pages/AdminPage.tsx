import { type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { NotificationsTab } from "../components/admin/NotificationsTab";
import { DevicesTab, DirectionsTab, SimulationTab } from "../components/admin/SimulationTabs";
import { UsersTab } from "../components/admin/UsersTab";
import { PageHeader, Tabs } from "../components/ui";

type TabId = "users" | "directions" | "devices" | "simulation" | "notifications";

const TABS: { id: TabId; label: string }[] = [
  { id: "users", label: "Používatelia" },
  { id: "directions", label: "Smery" },
  { id: "devices", label: "Zariadenia" },
  { id: "simulation", label: "Simulácia" },
  { id: "notifications", label: "Notifikácie" },
];

const CONTENT: Record<TabId, () => ReactNode> = {
  users: () => <UsersTab />,
  directions: () => <DirectionsTab />,
  devices: () => <DevicesTab />,
  simulation: () => <SimulationTab />,
  notifications: () => <NotificationsTab />,
};

export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const active: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : "users";
  const setActive = (id: TabId) => setParams(id === "users" ? {} : { tab: id }, { replace: true });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Administrácia" subtitle="Používatelia a roly, smery, zariadenia, simulácia a notifikácie." />
      <Tabs items={TABS} active={active} onChange={setActive} className="mb-5" />
      {CONTENT[active]()}
    </div>
  );
}

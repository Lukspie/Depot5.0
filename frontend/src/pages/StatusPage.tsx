import { useAppStatus, usePublicConfig, useTelematicsStatus } from "../api/system";
import { LiveSimulationCard } from "../components/LiveSimulationCard";
import { ServiceCard } from "../components/ServiceCard";

export function StatusPage() {
  const config = usePublicConfig();
  const app = useAppStatus();
  const telematics = useTelematicsStatus(config.data?.telematics_url);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Stav systému</h1>
        <p className="text-ink-muted mt-1 text-sm">
          Frontend volá oba backendy priamo: hlavný backend na rovnakom origine, telematiku na{" "}
          <code className="bg-surface rounded px-1.5 py-0.5">
            {config.data?.telematics_url ?? "…"}
          </code>
          .
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <ServiceCard
          title="Hlavný backend (app)"
          subtitle="Auth, balíky, jazdy, ML · db-wms"
          hello={app.hello}
          health={app.health}
        />
        <ServiceCard
          title="Telematika (telematics)"
          subtitle="Simulátor, hodiny, telemetria · db-telemetry"
          hello={telematics.hello}
          health={telematics.health}
          waitingFor={config.isError ? "Chýba konfigurácia" : undefined}
        />
        <LiveSimulationCard />
      </div>
    </div>
  );
}

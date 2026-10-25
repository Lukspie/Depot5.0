import { Boxes } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useLayout } from "../api/depots";
import { Card, EmptyState, KeyValue, PageHeader, Spinner } from "../components/ui";

/** Digital twin of a depot (full 3D scene arrives in phase 5); reached by clicking a depot on the map. */
export function TwinPage() {
  const [params] = useSearchParams();
  const code = params.get("depot") ?? "BUD";
  const layout = useLayout(code);
  if (layout.isPending) return <Spinner label="Načítavam sklad…" className="py-20" />;
  if (layout.isError) {
    return (
      <Card>
        <EmptyState title="Sklad neexistuje" action={<Link to="/fleet" className="text-brand-700 underline">Späť na mapu</Link>} />
      </Card>
    );
  }
  const l = layout.data;
  const hall = l.layout.hall;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Digitálne dvojča – ${l.depot.name}`} subtitle="3D scéna haly z tohto rozloženia pribudne vo fáze 5." />
      <Card>
        <div className="bg-brand-100 text-brand-700 mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
          <Boxes size={22} />
        </div>
        <KeyValue
          rows={[
            ["Typ", l.depot.kind === "hub" ? "Hub" : "Prekládkové depo"],
            ["Poloha", `${l.depot.lat.toFixed(5)}, ${l.depot.lon.toFixed(5)}`],
            ["Hala", hall ? `${String(hall.width)} × ${String(hall.depth)} m, výška ${String(hall.height)} m` : "—"],
            ["Brány a plochy", String(l.doors.length)],
          ]}
        />
        <Link to="/fleet" className="text-brand-700 mt-4 inline-block text-sm underline">
          Späť na mapu
        </Link>
      </Card>
    </div>
  );
}

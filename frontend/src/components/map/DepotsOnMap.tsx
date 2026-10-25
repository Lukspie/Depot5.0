import { useMemo } from "react";
import { useDepotState, useDepots, useDevices, useLayout, type Depot } from "../../api/depots";
import type { DepotLive } from "./depot3d";
import { DepotLayer } from "./DepotLayer";

function OneDepot({ depot }: { depot: Depot }) {
  const layout = useLayout(depot.code);
  const state = useDepotState(depot.code);
  const devices = useDevices();
  const live: DepotLive = useMemo(
    () => ({
      occupied: state.data?.occupied ?? [],
      staged: state.data?.staged ?? [],
      trucksAtHub: (state.data?.trucks ?? []).filter((t) => t.state === "at_hub" || t.state === "loading_at_hub").length,
      devices: depot.kind === "depot" ? (devices.data?.devices ?? []).filter((d) => d.depotCode === depot.code) : [],
    }),
    [state.data, devices.data, depot],
  );
  if (!layout.data) return null;
  return <DepotLayer layout={layout.data} live={live} />;
}

/** All depots and hubs as 3D objects on the map. */
export function DepotsOnMap() {
  const depots = useDepots();
  return (
    <>
      {depots.data?.map((d) => (
        <OneDepot key={d.code} depot={d} />
      ))}
    </>
  );
}

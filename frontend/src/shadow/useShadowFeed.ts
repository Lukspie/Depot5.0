import { useEffect } from "react";
import type { DeviceInfo } from "../api/telematicsApi";
import { useChannel } from "../hooks/telematics";
import { useShadowStore, type DoorReading, type LiveScan } from "./store";

interface GatePassage {
  direction: "in" | "out";
  vehicleType: string;
  plate: string | null;
  at: string;
}

/**
 * Telematics "devices" channel -> shadow store: device status (snapshot on subscribe, then
 * changes), every scan (pin pulse, belt animation, last 20 scans) and gate passages (yard).
 */
export function useShadowFeed(depotCode: string): void {
  const store = useShadowStore;
  useEffect(() => {
    store.getState().reset();
    return () => store.getState().reset();
  }, [store, depotCode]);

  useChannel<unknown>("devices", (ev) => {
    const s = store.getState();
    if (ev.type === "status") {
      const d = ev.data as DeviceInfo;
      if (d.depotCode === depotCode) s.device(d);
    } else if (ev.type === "scan") {
      const sc = ev.data as LiveScan;
      if (sc.device in s.devices) s.scan(sc);
    } else if (ev.type === "door") {
      const r = ev.data as DoorReading;
      if (r.device in s.devices) s.door(r);
    } else if (ev.type === "gate_passage") {
      s.gate(ev.data as GatePassage);
    }
  });
}

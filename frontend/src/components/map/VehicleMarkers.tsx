import * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useMap } from "./MapView";

export interface MapVehicle {
  plate: string;
  kind: "truck" | "van";
  lat: number;
  lon: number;
  /** trip status (planned, en_route, at_door, loading, departed…) or null when parked */
  status: string | null;
  delayMin: number | null;
  label?: string;
}

const TRUCK =
  '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="white" d="M2 6h12v9H2zM14 9h4.5l3.5 3.5V15h-8z"/><circle cx="6" cy="17" r="1.8" fill="white"/><circle cx="17.5" cy="17" r="1.8" fill="white"/></svg>';
const VAN =
  '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="white" d="M2 7h12v8H2zM14 9.5h4l3 3V15h-7z"/><circle cx="6" cy="17" r="1.8" fill="white"/><circle cx="17" cy="17" r="1.8" fill="white"/></svg>';

/** Pin colour: delay first (amber / red), otherwise the trip state. */
export function pinColor(v: Pick<MapVehicle, "status" | "delayMin">): string {
  if (v.delayMin !== null && v.delayMin >= 30) return "var(--color-danger-600)";
  if (v.delayMin !== null && v.delayMin >= 10) return "var(--color-warn-600)";
  switch (v.status) {
    case "en_route":
    case "departed":
      return "var(--color-info-600)";
    case "loading":
    case "at_door":
      return "var(--color-ok-600)";
    default:
      return "var(--color-neutral-600)";
  }
}

interface Props {
  vehicles: MapVehicle[];
  selected: string | null;
  onSelect: (plate: string) => void;
}

/** Rounded pins with a vehicle icon (reference style); positions update in place. */
export function VehicleMarkers({ vehicles, selected, onSelect }: Props) {
  const map = useMap();
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>());
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  });

  useEffect(() => {
    if (!map) return;
    const seen = new Set<string>();
    for (const v of vehicles) {
      seen.add(v.plate);
      let entry = markers.current.get(v.plate);
      if (!entry) {
        const el = document.createElement("div");
        el.className = "dt-pin";
        el.setAttribute("role", "button");
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          select.current(v.plate);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([v.lon, v.lat]).addTo(map);
        entry = { marker, el };
        markers.current.set(v.plate, entry);
      }
      entry.marker.setLngLat([v.lon, v.lat]);
      entry.el.innerHTML = `<span class="dt-pin-body">${v.kind === "van" ? VAN : TRUCK}</span>`;
      entry.el.style.setProperty("--pin", pinColor(v));
      entry.el.title = v.label ?? v.plate;
      entry.el.setAttribute("aria-label", v.label ?? v.plate);
      entry.el.classList.toggle("dt-pin-selected", v.plate === selected);
      entry.el.style.zIndex = v.plate === selected ? "5" : "1";
    }
    for (const [plate, entry] of markers.current) {
      if (!seen.has(plate)) {
        entry.marker.remove();
        markers.current.delete(plate);
      }
    }
  }, [map, vehicles, selected]);

  useEffect(
    () => () => {
      for (const entry of markers.current.values()) entry.marker.remove();
      markers.current.clear();
    },
    [],
  );
  return null;
}

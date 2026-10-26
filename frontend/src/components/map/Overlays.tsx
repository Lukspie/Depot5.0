/**
 * Small map overlays shared by /track and /courier: labelled point pins, an accuracy circle
 * (approximate courier position) and a one-time camera fit.
 */

import type { Feature } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useMap } from "./MapView";

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  /** text inside the dot (stop number) or an svg icon */
  label?: string;
  icon?: string;
  /** CSS colour, e.g. var(--color-brand-500) */
  color?: string;
  title?: string;
  /** big pin (own home, the van) vs. small numbered dot (stops) */
  variant?: "pin" | "dot";
}

export const HOME_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="white" d="M12 3 2 11h3v9h5v-6h4v6h5v-9h3z"/></svg>';
export const VAN_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="white" d="M2 7h12v8H2zM14 9.5h4l3 3V15h-7z"/><circle cx="6" cy="17" r="1.8" fill="white"/><circle cx="17" cy="17" r="1.8" fill="white"/></svg>';

/** HTML markers; updated in place by id. */
export function PointMarkers({ points, onSelect }: { points: MapPoint[]; onSelect?: (id: string) => void }) {
  const map = useMap();
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>());
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  });

  useEffect(() => {
    if (!map) return;
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      let entry = markers.current.get(p.id);
      if (!entry) {
        const el = document.createElement("div");
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          select.current?.(p.id);
        });
        const marker = new maplibregl.Marker({
          element: el,
          anchor: p.variant === "dot" ? "center" : "bottom",
        })
          .setLngLat([p.lon, p.lat])
          .addTo(map);
        entry = { marker, el };
        markers.current.set(p.id, entry);
      }
      entry.marker.setLngLat([p.lon, p.lat]);
      const el = entry.el;
      el.className = p.variant === "dot" ? "dt-dot" : "dt-pin";
      el.innerHTML =
        p.variant === "dot" ? `<span>${p.label ?? ""}</span>` : `<span class="dt-pin-body">${p.icon ?? p.label ?? ""}</span>`;
      el.style.setProperty("--pin", p.color ?? "var(--color-brand-500)");
      el.title = p.title ?? "";
      if (p.title) el.setAttribute("aria-label", p.title);
    }
    for (const [id, entry] of markers.current) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markers.current.delete(id);
      }
    }
  }, [map, points]);

  useEffect(
    () => () => {
      for (const entry of markers.current.values()) entry.marker.remove();
      markers.current.clear();
    },
    [],
  );
  return null;
}

const CIRCLE = "dt-accuracy";

function circlePolygon(lat: number, lon: number, radiusM: number): Feature {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (2 * Math.PI * i) / 64;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

/** Translucent circle: "the courier is somewhere here" (approximate position). */
export function AccuracyCircle({ circle }: { circle: { lat: number; lon: number; radiusM: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const css = getComputedStyle(document.documentElement).getPropertyValue("--color-info-600").trim() || "#2563eb";
    const data: Feature = circle
      ? circlePolygon(circle.lat, circle.lon, circle.radiusM)
      : {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [] },
        };
    const source = map.getSource<GeoJSONSource>(CIRCLE);
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource(CIRCLE, { type: "geojson", data });
    map.addLayer({
      id: `${CIRCLE}-fill`,
      type: "fill",
      source: CIRCLE,
      paint: { "fill-color": css, "fill-opacity": 0.14 },
    });
    map.addLayer({
      id: `${CIRCLE}-line`,
      type: "line",
      source: CIRCLE,
      paint: {
        "line-color": css,
        "line-width": 2,
        "line-dasharray": [2, 2],
        "line-opacity": 0.7,
      },
    });
  }, [map, circle]);
  useEffect(
    () => () => {
      if (!map?.getStyle()) return;
      for (const id of [`${CIRCLE}-line`, `${CIRCLE}-fill`]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(CIRCLE)) map.removeSource(CIRCLE);
    },
    [map],
  );
  return null;
}

/** Fit the camera to the points once they are known (and again when `fitKey` changes). */
export function FitBounds({ points, fitKey, maxZoom = 15 }: { points: [number, number][]; fitKey: string; maxZoom?: number }) {
  const map = useMap();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!map || points.length === 0 || done.current === fitKey) return;
    done.current = fitKey;
    const bounds = new maplibregl.LngLatBounds();
    for (const [lat, lon] of points) bounds.extend([lon, lat]);
    map.fitBounds(bounds, { padding: 60, maxZoom, pitch: 45, duration: 0 });
  }, [map, points, fitKey, maxZoom]);
  return null;
}

import type { Feature } from "geojson";
import type { GeoJSONSource } from "maplibre-gl";
import { useEffect } from "react";
import { useMap } from "./MapView";

const SOURCE = "dt-route";

/** Coloured line of the selected vehicle's route ([lat, lon] points), white casing underneath. */
export function RouteLine({ points, color = "var(--color-brand-500)" }: { points: [number, number][] | null; color?: string }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const css = color.startsWith("var(")
      ? getComputedStyle(document.documentElement).getPropertyValue(color.slice(4, -1)).trim() || "#f39200"
      : color;
    const data: Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: (points ?? []).map(([lat, lon]) => [lon, lat]) },
    };
    const source = map.getSource<GeoJSONSource>(SOURCE);
    if (source) {
      source.setData(data);
      map.setPaintProperty(`${SOURCE}-line`, "line-color", css);
    } else {
      map.addSource(SOURCE, { type: "geojson", data });
      const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      map.addLayer(
        {
          id: `${SOURCE}-casing`,
          type: "line",
          source: SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 },
        },
        firstSymbol,
      );
      map.addLayer(
        {
          id: `${SOURCE}-line`,
          type: "line",
          source: SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": css, "line-width": 5 },
        },
        firstSymbol,
      );
    }
  }, [map, points, color]);

  useEffect(
    () => () => {
      if (!map || !map.getStyle()) return;
      for (const id of [`${SOURCE}-line`, `${SOURCE}-casing`]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    },
    [map],
  );
  return null;
}

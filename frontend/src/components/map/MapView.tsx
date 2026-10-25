/**
 * Shared map (MapLibre GL, ADR-040): light vector style from OpenFreeMap, pitch ~45°, 3D
 * buildings, attribution. Used by /fleet now and by /track and /courier later. Child components
 * (markers, route line, depot layers) get the map instance from context.
 */

import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 runs tile parsing in an ES-module web worker: let Vite bundle it and pass its URL
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
// the OpenFreeMap style adds "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" itself
export const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>';

export const SLOVAKIA: maplibregl.LngLatBoundsLike = [
  [16.8, 47.7],
  [22.6, 49.65],
];

maplibregl.setWorkerUrl(workerUrl);

const MapContext = createContext<MapLibreMap | null>(null);

export function useMap(): MapLibreMap | null {
  return useContext(MapContext);
}

/** 3D buildings from the OpenMapTiles "building" layer, below the labels. */
function addBuildings(map: MapLibreMap): void {
  if (map.getLayer("dt-3d-buildings") || !map.getSource("openmaptiles")) return;
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addLayer(
    {
      id: "dt-3d-buildings",
      source: "openmaptiles",
      "source-layer": "building",
      type: "fill-extrusion",
      minzoom: 13,
      paint: {
        "fill-extrusion-color": "#e3e1dc",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.85,
      },
    },
    firstSymbol,
  );
}

interface Props {
  children?: ReactNode;
  className?: string;
  /** initial camera; defaults to the whole of Slovakia, tilted */
  bounds?: maplibregl.LngLatBoundsLike;
  pitch?: number;
}

function supportsWebGL(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export function MapView({ children, className = "", bounds = SLOVAKIA, pitch = 45 }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [failed] = useState(() => !supportsWebGL());

  useEffect(() => {
    if (!container.current || failed) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE,
      bounds,
      fitBoundsOptions: { padding: 30 },
      pitch,
      maxPitch: 70,
      attributionControl: { compact: false, customAttribution: ATTRIBUTION },
      canvasContextAttributes: { antialias: true },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    m.on("load", () => {
      addBuildings(m);
      m.resize();
      setMap(m);
    });
    return () => {
      setMap(null);
      m.remove();
    };
    // the map is created once; later bounds/pitch changes are done by flyTo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`relative h-full w-full ${className}`}>
      {/* maplibre sets position: relative on this element, so size it explicitly */}
      <div ref={container} className="h-full w-full" />
      {failed && (
        <div className="bg-canvas text-ink-muted absolute inset-0 flex items-center justify-center p-6 text-center text-sm">
          Mapa potrebuje WebGL, ktorý tento prehliadač nepodporuje.
        </div>
      )}
      <MapContext.Provider value={map}>{map && children}</MapContext.Provider>
    </div>
  );
}

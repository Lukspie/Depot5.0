import * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { createDepotLayer, type DepotLayerHandle, type DepotLayout, type DepotLive } from "./depot3d";
import { useMap } from "./MapView";

interface Props {
  layout: DepotLayout;
  live: DepotLive;
}

/**
 * A depot/hub on the map: 3D hall when zoomed in, big warehouse marker when zoomed out, label
 * always. Clicking it opens the digital shadow of that depot.
 */
export function DepotLayer({ layout, live }: Props) {
  const map = useMap();
  const navigate = useNavigate();
  const handle = useRef<DepotLayerHandle | null>(null);
  const code = layout.depot.code;

  useEffect(() => {
    if (!map) return;
    const h = createDepotLayer(`dt-depot-${code}`, layout);
    const centre = layout.layout.origin ?? [layout.depot.lat, layout.depot.lon];
    handle.current = h;
    map.addLayer(h.layer);

    const label = document.createElement("div");
    label.className = "dt-depot-label";
    label.textContent = [layout.depot.name, layout.depot.label].filter(Boolean).join(" · ");
    label.addEventListener("click", () => navigate(`/shadow?depot=${code}`));
    const marker = new maplibregl.Marker({ element: label, anchor: "top", offset: [0, 18] })
      .setLngLat([centre[1], centre[0]])
      .addTo(map);

    // click on the 3D marker / hall
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const p = map.project([centre[1], centre[0]]);
      const zoom = map.getZoom();
      const radius = zoom >= 15 ? 120 : 34;
      if (Math.hypot(e.point.x - p.x, e.point.y - p.y) < radius) navigate(`/shadow?depot=${code}`);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
      marker.remove();
      if (map.getStyle() && map.getLayer(h.layer.id)) map.removeLayer(h.layer.id);
      handle.current = null;
    };
  }, [map, layout, code, navigate]);

  useEffect(() => {
    handle.current?.update(live);
  }, [live]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker } from "leaflet";

interface Props {
  value: { lat: number; lng: number };
  onChange: (v: { lat: number; lng: number }) => void;
  height?: number;
  label: string;
}

/**
 * Pin picker on OpenStreetMap tiles (no API key). Leaflet touches `window`, so it is imported only
 * inside the effect. Tap the map or drag the pin. For heavy traffic switch to a paid tile provider.
 */
export function MapPicker({ value, onChange, height = 260, label }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange; // always call the latest handler from map events
  });

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !el.current || map.current) return;
      const m = L.map(el.current, { scrollWheelZoom: false }).setView([value.lat, value.lng], 15);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      const icon = L.divIcon({ html: '<div style="font-size:30px;line-height:30px">📍</div>', className: "", iconSize: [30, 30], iconAnchor: [15, 30] });
      const mk = L.marker([value.lat, value.lng], { draggable: true, icon }).addTo(m);
      mk.on("dragend", () => {
        const p = mk.getLatLng();
        onChangeRef.current({ lat: p.lat, lng: p.lng });
      });
      m.on("click", (e) => {
        mk.setLatLng(e.latlng);
        onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      map.current = m;
      marker.current = mk;
    })();
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // The map is created once; later value changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changes that come from outside the map (e.g. "use my location") move the pin and the view.
  useEffect(() => {
    const m = map.current;
    const mk = marker.current;
    if (!m || !mk) return;
    const p = mk.getLatLng();
    if (Math.abs(p.lat - value.lat) > 1e-6 || Math.abs(p.lng - value.lng) > 1e-6) {
      mk.setLatLng([value.lat, value.lng]);
      m.setView([value.lat, value.lng], Math.max(m.getZoom(), 15));
    }
  }, [value.lat, value.lng]);

  return <div ref={el} dir="ltr" style={{ height }} className="w-full overflow-hidden rounded-xl border border-line bg-aqua-100" role="application" aria-label={label} />;
}

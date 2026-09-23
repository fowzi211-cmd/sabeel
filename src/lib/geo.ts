/**
 * Rough bounding box of the Makkah area (approximate — refine with real district polygons later).
 * A pin outside it is almost certainly a mis-tap, and the pilot only serves Makkah.
 */
export const MAKKAH_BOUNDS = { latMin: 21.2, latMax: 21.7, lngMin: 39.55, lngMax: 40.1 };
export const MAKKAH_CENTER = { lat: 21.3891, lng: 39.8579 };

export const insideMakkah = (lat: number, lng: number) =>
  lat >= MAKKAH_BOUNDS.latMin && lat <= MAKKAH_BOUNDS.latMax && lng >= MAKKAH_BOUNDS.lngMin && lng <= MAKKAH_BOUNDS.lngMax;

/** Great-circle distance in metres (haversine). Good to a few metres at city scale — plenty for a 100 m delivery radius. */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

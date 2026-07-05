const EARTH_RADIUS_M = 6371008.8;

/** Ring of [lng, lat] pairs approximating a metric circle; closed (first == last). */
export function circlePolygonCoords(
  lat: number,
  lng: number,
  radiusM: number,
  steps = 64,
): [number, number][] {
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos(latRad);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return ring;
}

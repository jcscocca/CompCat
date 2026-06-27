export function parseRouteGeometry(geometry: string | null | undefined): [number, number][] {
  if (!geometry) return [];
  const points: [number, number][] = [];
  for (const raw of geometry.split(";")) {
    const [latText, lonText] = raw.split(",");
    if (latText === undefined || lonText === undefined) continue;
    const lat = Number(latText);
    const lon = Number(lonText);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      points.push([lat, lon]);
    }
  }
  return points;
}

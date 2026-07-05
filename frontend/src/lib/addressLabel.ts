// SPD block_address strings are messy display labels: ALL-CAPS, anonymized block-faces
// ("14XX BLOCK OF 2ND AVE"), and intersections that appear in either cross-street order
// ("PIKE ST / 3RD AVE" and "3RD AVE / PIKE ST" are the same corner). This tidies them for
// display and canonicalizes intersections so both orderings render identically. Display-only —
// the stored strings and the (spatial) incident matching are untouched.

const DIRECTIONALS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
const UNAVAILABLE = new Set(["", "-", "UNKNOWN", "FK ERROR", "NULL", "N/A"]);
const BLOCK_FACE = /^(\d+)(XX)?\s+BLOCK(?:\s+OF)?\s+(.+)$/i;

function titleToken(token: string): string {
  const upper = token.toUpperCase();
  if (DIRECTIONALS.has(upper)) return upper;
  if (/^\d+(ST|ND|RD|TH)$/.test(upper)) return upper.toLowerCase(); // 3RD -> 3rd
  if (/^\d+$/.test(token)) return token; // house number
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function titleCaseStreet(text: string): string {
  return text.trim().split(/\s+/).filter(Boolean).map(titleToken).join(" ");
}

function formatIntersection(a: string, b: string): string {
  const streets = [titleCaseStreet(a), titleCaseStreet(b)];
  // Canonical order (case-insensitive) so "A / B" and "B / A" collapse to one label.
  streets.sort((x, y) => {
    const kx = x.toUpperCase();
    const ky = y.toUpperCase();
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
  return `${streets[0]} & ${streets[1]}`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatIncidentAddress(raw: string | null | undefined): string {
  if (raw == null) return "Unavailable";
  const text = raw.trim();
  const upper = text.toUpperCase();
  if (UNAVAILABLE.has(upper)) return "Unavailable";
  if (upper === "REDACTED") return "Address withheld";

  const parts = text.split("/");
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return formatIntersection(parts[0], parts[1]);
  }

  const blockFace = text.match(BLOCK_FACE);
  if (blockFace) {
    const number = blockFace[2] ? `${blockFace[1]}00` : blockFace[1];
    return `${number} block of ${titleCaseStreet(blockFace[3])}`;
  }

  return titleCaseStreet(text);
}

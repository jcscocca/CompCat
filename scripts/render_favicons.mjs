// Renders the PNG favicon fallbacks from the CompCat brand cat mark
// (the .mc-logo glyph in frontend/src/components/MapWorkspace.tsx).
// Usage: node scripts/render_favicons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(here, "..", "frontend");
const require = createRequire(join(frontendDir, "package.json"));
const { Resvg } = require("@resvg/resvg-js");

// Light-theme brand pair (--accent / --on-accent): reads on light and dark browser chrome.
const BG = "#0F6E56";
const FG = "#FFFFFF";

const HEAD = `<path d="M4 9 L4 4 L9 7 Q12 6 15 7 L20 4 L20 9 Q21.5 11.5 21.5 14 Q21.5 20 12 20 Q2.5 20 2.5 14 Q2.5 11.5 4 9 Z" fill="${FG}"/>`
  + `<circle cx="8.5" cy="13" r="1.3" fill="${BG}"/>`
  + `<circle cx="15.5" cy="13" r="1.3" fill="${BG}"/>`;

// Same 32-unit composition as public/assets/favicon.svg. iOS masks the touch icon itself,
// so that variant is a full-bleed square (rounded corners there would double up).
function mark(rounded) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">`
    + `<rect width="32" height="32"${rounded ? ' rx="9"' : ""} fill="${BG}"/>`
    + `<g transform="translate(4 4)">${HEAD}</g></svg>`;
}

function render(svg, width, path) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}

const out = join(frontendDir, "public", "assets");
mkdirSync(out, { recursive: true });
render(mark(true), 32, join(out, "favicon-32.png"));
render(mark(false), 180, join(out, "apple-touch-icon.png"));

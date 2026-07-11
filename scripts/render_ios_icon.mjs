// Renders the iOS app icon + splash from the approved Copper bust art
// (frontend/src/components/CopperAvatar.tsx) onto the night-mode surface.
// Usage: node scripts/render_ios_icon.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This script lives in repo-root scripts/, but @resvg/resvg-js is only
// installed under frontend/node_modules (npm workspace lives there, and
// that dir is a symlink into the sibling checkout). A bare `import` from
// this file's location wouldn't find it, so scope module resolution to
// frontend/ explicitly via createRequire.
const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(here, "..", "frontend");
const require = createRequire(join(frontendDir, "package.json"));
const { Resvg } = require("@resvg/resvg-js");

const BG = "#1B232B";

const BUST = `
  <path d="M34 44 Q22 72 32 96 Q41 99 43 80 Q39 60 41 47 Z" fill="#6b4520" />
  <path d="M86 44 Q98 72 88 96 Q79 99 77 80 Q81 60 79 47 Z" fill="#6b4520" />
  <path d="M28 100 Q34 80 50 78 L60 86 L70 78 Q86 80 92 100 Z" fill="#8a7a5f" />
  <path d="M50 78 L60 96 L44 92 Z" fill="#6f6249" />
  <path d="M70 78 L60 96 L76 92 Z" fill="#6f6249" />
  <polygon points="60,86 55,93 60,99 65,93" fill="#eee8da" />
  <circle cx="60" cy="54" r="25" fill="#b5793f" />
  <ellipse cx="60" cy="38" rx="30" ry="7" fill="#33332f" />
  <path d="M40 38 Q42 20 60 20 Q78 20 80 38 Q60 32 40 38 Z" fill="#444441" />
  <rect x="41" y="31" width="38" height="5" fill="#2c2c2a" />
  <rect x="44" y="48" width="11" height="4" rx="2" fill="#8a5a2e" />
  <rect x="65" y="48" width="11" height="4" rx="2" fill="#8a5a2e" />
  <circle cx="50" cy="55" r="3" fill="#2b2b2b" />
  <circle cx="71" cy="55" r="3" fill="#2b2b2b" />
  <ellipse cx="60" cy="67" rx="12" ry="9" fill="#e2c495" />
  <ellipse cx="60" cy="62" rx="4.8" ry="3.2" fill="#2b2b2b" />
  <path d="M60 66 Q60 71 54 71" stroke="#6b4520" stroke-width="1.6" fill="none" stroke-linecap="round" />
`;

// canvas: outer square; art: bust box (120-unit art scaled + centered)
function composite(canvas, art) {
  const scale = art / 120;
  const offset = (canvas - art) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">
    <rect width="${canvas}" height="${canvas}" fill="${BG}"/>
    <g transform="translate(${offset},${offset}) scale(${scale})">${BUST}</g>
  </svg>`;
}

function render(svg, path) {
  const png = new Resvg(svg).render().asPng();
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}

const out = join(frontendDir, "assets");
mkdirSync(out, { recursive: true });

render(composite(1024, 800), join(out, "icon-only.png"));
render(composite(2732, 800), join(out, "splash.png"));
render(composite(2732, 800), join(out, "splash-dark.png"));

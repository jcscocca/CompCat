// Renders the iOS app icon + splash from the approved Tabby bust art
// (frontend/src/components/TabbyAvatar.tsx) onto the night-mode surface, then installs
// the same pixels directly into the committed Xcode asset catalog.
// Usage: cd frontend && npm run ios:assets
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

const BG = "#1A222B";

const BUST = `
  <path d="M28 102 Q34 84 48 80 L60 86 L72 80 Q86 84 92 102 Z" fill="#9c6630" />
  <polygon points="60,86 54,93 60,100 66,93" fill="#e2c495" />
  <path d="M47 82 Q60 91 73 82 L73 87 Q60 96 47 87 Z" fill="#2f6c4f" />
  <circle cx="60" cy="93" r="3.2" fill="#d9b036" />
  <path d="M31 50 L26 20 L54 34 Z" fill="#b5793f" />
  <path d="M89 50 L94 20 L66 34 Z" fill="#b5793f" />
  <path d="M34 44 L31 27 L48 36 Z" fill="#6b4520" />
  <path d="M86 44 L89 27 L72 36 Z" fill="#6b4520" />
  <circle cx="60" cy="62" r="30" fill="#b5793f" />
  <path d="M53 34 Q54 41 52 46" stroke="#8a5a2e" stroke-width="3.4" fill="none" stroke-linecap="round" />
  <path d="M60 33 L60 45" stroke="#8a5a2e" stroke-width="3.4" stroke-linecap="round" />
  <path d="M67 34 Q66 41 68 46" stroke="#8a5a2e" stroke-width="3.4" fill="none" stroke-linecap="round" />
  <path d="M32 56 L41 58" stroke="#8a5a2e" stroke-width="3" stroke-linecap="round" />
  <path d="M88 56 L79 58" stroke="#8a5a2e" stroke-width="3" stroke-linecap="round" />
  <circle cx="49" cy="58" r="3.6" fill="#2f6c4f" />
  <circle cx="71" cy="58" r="3.6" fill="#2f6c4f" />
  <circle cx="49" cy="58" r="1.5" fill="#1c1c1a" />
  <circle cx="71" cy="58" r="1.5" fill="#1c1c1a" />
  <ellipse cx="60" cy="72" rx="12" ry="9" fill="#e2c495" />
  <path d="M56.5 68.5 L63.5 68.5 L60 73 Z" fill="#8a4b3a" />
  <path d="M60 73 Q60 77 55 77.5" stroke="#6b4520" stroke-width="1.6" fill="none" stroke-linecap="round" />
  <path d="M60 73 Q60 77 65 77.5" stroke="#6b4520" stroke-width="1.6" fill="none" stroke-linecap="round" />
  <path d="M47 70 Q39 68 32 67" stroke="#e2c495" stroke-width="1.5" fill="none" stroke-linecap="round" />
  <path d="M47 74 Q39 75 33 76" stroke="#e2c495" stroke-width="1.5" fill="none" stroke-linecap="round" />
  <path d="M73 70 Q81 68 88 67" stroke="#e2c495" stroke-width="1.5" fill="none" stroke-linecap="round" />
  <path d="M73 74 Q81 75 87 76" stroke="#e2c495" stroke-width="1.5" fill="none" stroke-linecap="round" />
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

function write(png, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}

function renderTo(svg, paths) {
  const png = new Resvg(svg).render().asPng();
  for (const path of paths) write(png, path);
}

const out = join(frontendDir, "assets");
mkdirSync(out, { recursive: true });
const xcodeAssets = join(frontendDir, "ios", "App", "App", "Assets.xcassets");

renderTo(composite(1024, 800), [
  join(out, "icon-only.png"),
  join(xcodeAssets, "AppIcon.appiconset", "AppIcon-512@2x.png"),
]);
// splash and splash-dark are deliberately identical — the shell has one dark
// surface (#1A222B), not separate light/dark splash treatments.
const splashPaths = [
  join(out, "splash.png"),
  join(out, "splash-dark.png"),
  ...["1x", "2x", "3x"].flatMap((scale) => [
    join(xcodeAssets, "Splash.imageset", `Default@${scale}~universal~anyany.png`),
    join(xcodeAssets, "Splash.imageset", `Default@${scale}~universal~anyany-dark.png`),
  ]),
];
renderTo(composite(2732, 800), splashPaths);

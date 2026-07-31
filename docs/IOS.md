# CompCat on iOS — personal build

The iOS app is a Capacitor shell in **remote-URL mode**: the WKWebView loads the
frontend straight from the backend over your tailnet. Same-origin sessions, SSE, and
tiles — the phone always runs whatever the ThinkPad serves. Design:
`docs/superpowers/specs/2026-07-10-ios-shell-design.md`.

## One-time setup

**ThinkPad (backend):**
1. Install Tailscale and join your tailnet; enable MagicDNS + HTTPS certificates in
   the tailnet admin console (DNS → HTTPS Certificates → Enable).
2. Front the personal instance (port 8000) with a stable HTTPS name:

       tailscale serve --bg 8000

   Check `tailscale serve status` — you should see
   `https://<hostname>.<tailnet>.ts.net/ → http://127.0.0.1:8000`.

**iPhone:** install the Tailscale app, sign in to the same tailnet, toggle the VPN on.

**Mac (build machine):** Xcode from the App Store (the full app, not just Command
Line Tools; first launch installs iOS support), then `sudo xcode-select -s
/Applications/Xcode.app/Contents/Developer`. CocoaPods is NOT needed — the project
uses Swift Package Manager.

## Build & run

    cd frontend
    export MCA_IOS_SERVER_URL="https://<hostname>.<tailnet>.ts.net"
    npm run ios:sync     # regenerate branding + vite build + cap sync
    npm run ios:open     # opens Xcode

In Xcode: select the App target → Signing & Capabilities → choose your team
(personal Apple ID works; free accounts re-sign every 7 days, a paid developer
account yearly), plug in the iPhone, pick it as the destination, Run. First run on
a free account: trust the developer profile on the phone (Settings → General → VPN &
Device Management).

The tailnet URL is baked at sync time and is deliberately NOT committed — the synced
`ios/App/App/capacitor.config.json` is gitignored, so a personal hostname physically
cannot land in the repo. Fresh clones: `npm run ios:sync` regenerates every
gitignored piece (`capacitor.config.json`, `config.xml`, `public/`,
`capacitor-cordova-ios-plugins/`) and installs the generated icon/splash PNGs directly
into the committed Xcode asset catalog. `npm run ios:assets` regenerates only those
branding files.

## On-device verification checklist

1. Cold boot on cellular with Tailscale connected → dashboard renders.
2. Save a place; force-quit; relaunch → session + place persist.
3. Map pans/zooms; tiles load.
4. Tabby chat streams token-by-token (confirms SSE isn't buffered by
   `tailscale serve`); first-visit pulse shows on a fresh install, stops after the
   first send.
5. Light and night themes render; status bar legible in both.
6. Tailscale off → system error page; reconnect + reload recovers.

## Troubleshooting

- **Blank/error page on launch:** Tailscale VPN off on the phone, `tailscale serve`
  not running on the ThinkPad, or the URL wasn't set when you ran `ios:sync`
  (re-export `MCA_IOS_SERVER_URL` and `npm run ios:sync` again).
- **App shows an old UI:** the phone renders whatever the ThinkPad serves — update
  and restart the backend, then relaunch the app; no rebuild needed.
- **Signature expired (free account):** re-run from Xcode to re-sign.
- **"Why does the Xcode project define a `COCOAPODS` compile flag / require
  `armv7`?"** Both are vestiges of Capacitor's stock iOS template (verified
  byte-identical to upstream) — the project is SPM-only, has no Podfile, and the
  `armv7` entry is ignored on modern arm64 devices. Don't chase them.
- **Regenerating the platform from scratch** (`rm -rf frontend/ios` + `cap add ios`)
  hits a known `@capacitor/cli` 7.6.7 bug: the `--packagemanager SPM` flag is
  lowercased before a case-sensitive check, so the CLI always demands CocoaPods.
  See the field note in `docs/superpowers/plans/2026-07-10-ios-shell.md` for the
  one-line transient patch used to scaffold. Day-to-day `cap sync` is unaffected
  (SPM is detected from the committed `CapApp-SPM/` directory).

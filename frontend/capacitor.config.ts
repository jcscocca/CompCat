import type { CapacitorConfig } from "@capacitor/cli";

// The real tailnet hostname is personal and never committed (public repo).
// Set MCA_IOS_SERVER_URL before `npm run ios:sync` — see docs/IOS.md.
const PLACEHOLDER_SERVER_URL = "https://compcat.example.ts.net";

const config: CapacitorConfig = {
  appId: "com.jscocca.compcat",
  appName: "CompCat",
  webDir: "../app/static/dashboard",
  backgroundColor: "#1A222B",
  server: {
    url: process.env.MCA_IOS_SERVER_URL || PLACEHOLDER_SERVER_URL,
  },
};

export default config;

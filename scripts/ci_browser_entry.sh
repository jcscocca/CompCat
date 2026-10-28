#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME" "$TMPDIR"
node <<'JS'
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const owner = process.env.COMPCAT_CI_OWNER_RUN;
if (!/^[0-9]+-[0-9]+$/.test(owner)) throw new Error('Invalid probe owner');
for (const root of [os.homedir(), os.tmpdir()]) fs.writeFileSync(path.join(root, 'ci-browser-owner.txt'), owner);
const identity = {owner, hostname: os.hostname(), home: os.homedir(), tmp: os.tmpdir(), uid: process.getuid(), node: process.version, playwright: require('@playwright/test/package.json').version, internalPort: 4173};
if (identity.node !== 'v22.23.3' || identity.playwright !== '1.63.0' || identity.uid !== 1001) throw new Error('Toolchain or user differs');
console.log('COMPCAT_BROWSER_IDENTITY ' + JSON.stringify(identity));
JS
PLAYWRIGHT_JSON_OUTPUT_FILE=/work/frontend/ci-browser-inventory.json npx playwright test --list --reporter=json
result=0
npm run test:visual -- --workers=1 --reporter=line,json || result=$?
node <<'JS'
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
for (const root of [os.homedir(), os.tmpdir()]) {
  if (fs.readFileSync(path.join(root, 'ci-browser-owner.txt'), 'utf8') !== process.env.COMPCAT_CI_OWNER_RUN) throw new Error('Profile owner changed');
}
console.log('COMPCAT_BROWSER_PROFILE_OK ' + process.env.COMPCAT_CI_OWNER_RUN);
JS
exit "$result"

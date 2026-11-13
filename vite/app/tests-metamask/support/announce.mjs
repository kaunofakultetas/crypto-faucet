// -----------------------------------------------------------
//  [*] MetaMask tests — what is under test
//
//  Run once before the tests: names the MetaMask build and
//  the Chromium the run uses, so a report always says which
//  wallet passed or failed — the store's build changes from
//  week to week, and that is the reason this suite exists.
//  It also names the older build the wallets "from an earlier
//  lecture" are made under, and whether the container has
//  internet this time.
// -----------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { EXTENSION, PREVIOUS, metamaskVersion } from './metamask.mjs';







// -----------------------------------------------------------
// announce (default export)
// -----------------------------------------------------------
//
// Prints the versions and the run's footing. Playwright calls
// it once, before the first test.
//
// Used by:
//   - playwright.config.js — globalSetup
// -----------------------------------------------------------

export default function announce() {
  const playwright = path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
  const { browsers } = JSON.parse(fs.readFileSync(path.join(playwright, 'browsers.json'), 'utf8'));
  const chromium = browsers.find((browser) => browser.name === 'chromium').browserVersion;
  const older = fs.existsSync(path.join(PREVIOUS, 'manifest.json')) ? `made under MetaMask ${metamaskVersion(PREVIOUS)}` : 'not tested — the image carries no older MetaMask';
  const footing = process.env.METAMASK_ONLINE ? 'WITH internet (the backend is still a double)' : 'no internet';

  console.log(`\nMetaMask ${metamaskVersion(EXTENSION)} in Chromium ${chromium} — ${footing}, nothing is paid out`);
  console.log(`Wallets from an earlier lecture: ${older}\n`);
}

// -----------------------------------------------------------
//  [*] MetaMask tests — how the suite runs
//
//  Every test starts a browser of its own and makes a new
//  wallet in it, which takes most of a minute — so the tests
//  run side by side, four at a time, and each is given
//  minutes rather than seconds. A failed test is run once
//  more before it counts: the wallet is somebody else's
//  program driven through its screens, and a window that came
//  up a moment late is not a defect of the faucet. A test
//  that only passes at the second try is reported as flaky,
//  not hidden.
// -----------------------------------------------------------

import { defineConfig } from '@playwright/test';


export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  globalSetup: './support/announce.mjs',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: 4,
  retries: 1,
  reporter: 'list',
  outputDir: '/tmp/metamask-test-results',
});

// -----------------------------------------------------------
//  [*] MetaMask tests — who takes part in a test
//
//  The fixtures every test file builds on:
//
//    faucet  — the built site with the backend's double behind
//              it, one per test, with the claims that reached
//              it
//    student — a browser with MetaMask installed and a
//              brand-new wallet made in it: the wallet to
//              answer MetaMask's windows with, and the faucet
//              page of a network or of a token opened on
//              request. The student can COME BACK: the browser
//              is closed and started again on the same
//              profile, as at a later lecture — MetaMask
//              installed, set up, locked
//    visitor — a browser WITHOUT MetaMask and the same page;
//              the extension can be installed while the page
//              is open, under the id the faucet page looks
//              for or under one it has never heard of
//
//  One option, madeUnder: a student's wallet is made under
//  today's MetaMask, or under the OLDER build the image also
//  carries — and then today's is put over it when the student
//  comes back, the way MetaMask updates itself between two
//  lectures. The wallet a returning student holds was made by
//  the MetaMask of another month.
//
//  A test that fails prints what MetaMask showed, window by
//  window, what the faucet page told the student and what it
//  logged — the screens nobody was watching.
// -----------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';

import { launchBrowser, installExtension, forgetBackgroundScript } from './browser.mjs';
import { EXTENSION, PREVIOUS, setUpWallet, returnToWallet } from './metamask.mjs';
import { startFaucet } from './faucet-double.mjs';


// What MetaMask's own script logs into every page it is on,
// whatever the page does — left out of a failing test's report
const WALLET_NOISE = /MaxListenersExceededWarning|ObjectMultiplex/;

// What a line starts with when it is one of the page's own
// outcome alerts, passed on by watchAlerts
const SHOWN = 'faucet-alert: ';

// How much of a logged line is kept for the report — MetaMask
// follows its one sentence with the whole error object
const LOGGED_LENGTH = 240;

// How much of their opening two logged lines must share,
// numbers aside, to count as the same line said again
const ALIKE_LENGTH = 100;







// -----------------------------------------------------------
// watchAlerts
// -----------------------------------------------------------
//
// Runs INSIDE the faucet page, from its first moment on:
// passes every outcome alert the page shows to the page's
// log, once, marked as such. The alerts fade after a few
// seconds, long before a failing test gets to its report —
// and what the page told the student is the first thing worth
// knowing about a claim that did not go through.
//
// Used by:
//   - openFaucetPage (below)
// -----------------------------------------------------------

function watchAlerts(mark) {
  const told = new WeakSet();
  new MutationObserver(() => {
    for (const alert of document.querySelectorAll('[role="alert"]')) {
      const text = alert.innerText.trim();
      if (told.has(alert) || !text) continue;
      told.add(alert);
      console.info(mark + text);
    }
  }).observe(document, { childList: true, subtree: true });
}







// -----------------------------------------------------------
// openFaucetPage
// -----------------------------------------------------------
//
// Opens one of the faucet's pages in a new tab and waits until
// it has loaded its data. What the page tells the student in
// its alerts and the warnings and errors it logs are written
// down, in the order they came, on the test's list of tabs —
// not on the tab, which does not outlive its browser — for a
// failing test's report.
//
// Used by:
//   - the `student` and `visitor` fixtures (below)
// -----------------------------------------------------------

async function openFaucetPage(context, faucet, route, tabs) {
  const page = await context.newPage();
  const logged = [];
  tabs.push({ route, logged });

  page.on('console', (message) => {
    const text = message.text().replace(/\s+/g, ' ');
    if (text.startsWith(SHOWN)) {
      logged.push(`[shown to the student] ${text.slice(SHOWN.length)}`);
    } else if (['error', 'warning'].includes(message.type()) && !WALLET_NOISE.test(text)) {
      logged.push(`[${message.type()}] ${text.slice(0, LOGGED_LENGTH)}`);
    }
  });
  page.on('pageerror', (error) => logged.push(`[uncaught] ${error.message}`));
  await page.addInitScript(watchAlerts, SHOWN);
  await page.goto(`${faucet.url}${route}`, { waitUntil: 'networkidle' });
  return page;
}







// -----------------------------------------------------------
// withoutStoreId
// -----------------------------------------------------------
//
// A copy of the MetaMask build without the store's key in its
// manifest: the browser then gives it an id of its own, one
// the faucet page does not know to ask about — MetaMask from
// a store the page has never heard of.
//
// Used by:
//   - the `visitor` fixture (below)
// -----------------------------------------------------------

function withoutStoreId() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'metamask-'));
  fs.cpSync(EXTENSION, folder, { recursive: true });
  const manifestPath = path.join(folder, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  delete manifest.key;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return folder;
}







// -----------------------------------------------------------
// report
// -----------------------------------------------------------
//
// Prints, for a test that did not end as expected, what
// MetaMask showed — across a restart of the browser, which
// is noted where it happened — and what the faucet pages
// showed and logged, tab by tab in the order they were
// opened. A line a page logged over and over — MetaMask,
// without internet, says every few seconds that it cannot
// reach the chain — is printed once, with how often it came,
// so the one line that matters is not buried under it.
//
// Used by:
//   - the `student` and `visitor` fixtures (below)
// -----------------------------------------------------------

function report(testInfo, tabs, wallet) {
  if (testInfo.status === testInfo.expectedStatus) return;

  const lines = [`--- ${testInfo.title}`];
  let windows = 0;
  for (const heard of wallet?.heard ?? []) {
    if (heard.note) {
      lines.push(`--- ${heard.note}`);
    } else {
      windows += 1;
      lines.push(`MetaMask window ${windows} — ${heard.kind} (${heard.type}), answered ${heard.answer ?? 'not at all'}: ${heard.text}`);
    }
  }
  for (const { route, logged } of tabs) {
    const said = new Map();
    for (const line of logged) {
      const alike = line.replace(/\d+(\.\d+)?/g, '#').slice(0, ALIKE_LENGTH);
      said.set(alike, { line: said.get(alike)?.line ?? line, times: (said.get(alike)?.times ?? 0) + 1 });
    }
    for (const { line, times } of said.values()) {
      lines.push(`page ${route}: ${line}${times > 1 ? ` — ${times} times alike` : ''}`);
    }
  }
  console.log(lines.join('\n'));
}







// -----------------------------------------------------------
// test
// -----------------------------------------------------------
//
// Playwright's test with the fixtures and the one option of
// this suite (see the file header). Every browser and every
// faucet lives for one test.
//
// A student's browser keeps its profile for the whole test,
// so it can be closed and started again (comeBack). A wallet
// made under the older MetaMask lives in a copy of that
// build, and today's build is put over the copy before the
// browser starts again — the extension's files replaced where
// they are, its stored wallet left alone. Without the older
// build in the image such a test is skipped, not failed.
//
// Used by:
//   - every file under tests/
// -----------------------------------------------------------

export const test = base.extend({

  madeUnder: ['today', { option: true }],

  // eslint-disable-next-line no-empty-pattern
  faucet: async ({}, use) => {
    const faucet = await startFaucet();
    await use(faucet);
    await faucet.close();
  },

  student: async ({ faucet, madeUnder }, use, testInfo) => {
    const older = madeUnder === 'previous';
    testInfo.skip(older && !fs.existsSync(path.join(PREVIOUS, 'manifest.json')), 'this image carries no older MetaMask build to make the wallet under');

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
    const installed = older ? fs.mkdtempSync(path.join(os.tmpdir(), 'installed-')) : EXTENSION;
    if (older) fs.cpSync(PREVIOUS, installed, { recursive: true });

    const tabs = [];
    let context = await launchBrowser({ extension: installed, profile });
    let wallet = null;
    let updateDue = older;

    try {
      wallet = await setUpWallet(context);
      await use({
        get context() { return context; },
        get wallet() { return wallet; },
        open: (network) => openFaucetPage(context, faucet, `/faucet/evm/${network}`, tabs),
        openToken: (symbol) => openFaucetPage(context, faucet, `/faucet/erc20/${symbol}`, tabs),

        async comeBack() {
          await context.close();
          if (updateDue) {
            fs.rmSync(installed, { recursive: true, force: true });
            fs.cpSync(EXTENSION, installed, { recursive: true });
            forgetBackgroundScript(profile);
            updateDue = false;
          }
          context = await launchBrowser({ extension: installed, profile });
          wallet = await returnToWallet(context, wallet);
        },
      });
    } finally {
      report(testInfo, tabs, wallet);
      await context.close();
      for (const folder of older ? [profile, installed] : [profile]) {
        try {
          fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        } catch { /* Chromium has not let go yet */ }
      }
    }
  },

  visitor: async ({ faucet }, use, testInfo) => {
    const context = await launchBrowser();
    const folders = [];
    const tabs = [];
    try {
      await use({
        context,
        open: (network) => openFaucetPage(context, faucet, `/faucet/evm/${network}`, tabs),
        installMetamask: ({ knownToThePage = true } = {}) => {
          if (knownToThePage) return installExtension(context, EXTENSION);
          folders.push(withoutStoreId());
          return installExtension(context, folders.at(-1));
        },
      });
    } finally {
      report(testInfo, tabs, null);
      await context.close();
      for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
    }
  },
});

export { expect };

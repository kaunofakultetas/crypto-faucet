// -----------------------------------------------------------
//  [*] MetaMask tests — the student's browser
//
//  A real Chromium, headless, with a profile of its own per
//  test — a browser nobody has used before, as on the day a
//  student installs their first wallet. It starts with the
//  MetaMask extension already installed, or with none and a
//  way to install one while a page is open: the two ways a
//  student arrives at the faucet.
//
//  MetaMask fences its own pages off from scripts (LavaMoat):
//  the page's globals are made unreachable, and Playwright's
//  usual way of reading a page trips over them. Those pages
//  are therefore read through the browser's debugging
//  protocol instead — an isolated world for what is on the
//  screen, the page's own world for the one thing MetaMask
//  leaves reachable on purpose, its state for bug reports.
//  Pressing and typing work as everywhere.
// -----------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';


// What a page looks like to a person, read in one go: its
// address, the test ids on screen (a disabled control marked),
// the labels of its buttons and its text. The language list
// MetaMask's first-run pages carry is left out of the text.
const DESCRIBE = `(() => {
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const ids = [...document.querySelectorAll('[data-testid]')].filter(visible)
    .map((el) => el.getAttribute('data-testid') + (el.disabled ? ' (disabled)' : ''));
  const buttons = [...document.querySelectorAll('button, [role=button]')].filter(visible)
    .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ')).filter(Boolean);
  const text = [...document.body.querySelectorAll('select')].reduce((all, select) => all.replace(select.innerText, ''), document.body.innerText)
    .replace(/\\n{2,}/g, '\\n').trim();
  return { url: location.href, ids: [...new Set(ids)], buttons: [...new Set(buttons)], text };
})()`;







// -----------------------------------------------------------
// launchBrowser
// -----------------------------------------------------------
//
// Starts a Chromium with the extension in the given folder
// installed from the start, or with none. English throughout,
// so MetaMask's windows can be told apart by what they say.
// Extensions are left switched on either way — Playwright
// starts a browser with them off — and the debugging protocol
// may install one later (installExtension).
//
// Without a profile the browser gets a fresh one that goes
// when it closes — as well as that goes while Chromium is
// still letting go of its files; what is left goes with the
// container. Given a profile folder it starts on THAT one and
// leaves it alone afterwards: the browser of a student who
// comes back to a later lecture, MetaMask installed, set up
// and remembering everything.
//
// Used by:
//   - support/test.mjs — the `student` and `visitor` fixtures
// -----------------------------------------------------------

export async function launchBrowser({ extension = null, profile = null } = {}) {
  const folder = profile ?? fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-extension-debugging'];
  if (extension) args.push(`--disable-extensions-except=${extension}`, `--load-extension=${extension}`);

  const context = await chromium.launchPersistentContext(folder, {
    channel: 'chromium',
    headless: true,
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    args,
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  if (!profile) {
    context.on('close', () => {
      try {
        fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch { /* Chromium has not let go yet */ }
    });
  }
  return context;
}







// -----------------------------------------------------------
// forgetBackgroundScript
// -----------------------------------------------------------
//
// One thing a browser does when it installs an extension's
// update, done by hand on a profile whose browser is closed:
// the copy it keeps of the old version's background script
// goes. Putting newer files where the extension lives is not
// enough — the browser would start the OLD background script
// from its copy, which asks for the old version's files, no
// longer there, and MetaMask comes up with "MetaMask had
// trouble starting". Everything the extension stored stays:
// the newer build meets the older one's wallet, which is what
// an update is.
//
// Used by:
//   - support/test.mjs — the `student` fixture, MetaMask
//     updated between two lectures
// -----------------------------------------------------------

export function forgetBackgroundScript(profile) {
  fs.rmSync(path.join(profile, 'Default', 'Service Worker'), { recursive: true, force: true });
}







// -----------------------------------------------------------
// installExtension
// -----------------------------------------------------------
//
// Installs the unpacked extension in a folder into a browser
// that is already running, pages open — what happens when a
// student adds MetaMask from the store with the faucet in
// another tab. Hands back the id the browser gave it.
//
// Used by:
//   - support/test.mjs — the `visitor` fixture
// -----------------------------------------------------------

export async function installExtension(context, folder) {
  const session = await context.browser().newBrowserCDPSession();
  try {
    const { id } = await session.send('Extensions.loadUnpacked', { path: folder });
    return id;
  } finally {
    await session.detach().catch(() => {});
  }
}







// -----------------------------------------------------------
// extensionId
// -----------------------------------------------------------
//
// The id of the extension installed in this browser, read off
// its service worker's address once that has started.
//
// Used by:
//   - support/metamask.mjs — setUpWallet
// -----------------------------------------------------------

export async function extensionId(context) {
  const running = context.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://'));
  const worker = running ?? await context.waitForEvent('serviceworker', { timeout: 90_000 });
  return new URL(worker.url()).host;
}







// -----------------------------------------------------------
// evaluateIn
// -----------------------------------------------------------
//
// Evaluates an expression in a page through the debugging
// protocol and hands back its value: in an isolated world —
// the page's document with untouched globals — or, when asked,
// in the page's own world, where only what the expression
// itself touches matters. A promise is awaited.
//
// Used by:
//   - describe (below)
//   - support/metamask.mjs — the wallet's own record
// -----------------------------------------------------------

export async function evaluateIn(page, expression, { ownWorld = false } = {}) {
  const session = await page.context().newCDPSession(page);
  try {
    const target = {};
    if (!ownWorld) {
      const { frameTree } = await session.send('Page.getFrameTree');
      const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'reader' });
      target.contextId = executionContextId;
    }
    const outcome = await session.send('Runtime.evaluate', { ...target, expression, returnByValue: true, awaitPromise: true });
    if (outcome.exceptionDetails) throw new Error(outcome.exceptionDetails.exception?.description ?? outcome.exceptionDetails.text);
    return outcome.result.value;
  } finally {
    await session.detach().catch(() => {});
  }
}







// -----------------------------------------------------------
// describe
// -----------------------------------------------------------
//
// What one of MetaMask's pages shows right now — its address,
// the test ids and button labels on screen and its text — or
// nothing while the page is between two documents.
//
// Used by:
//   - support/metamask.mjs — every step that looks at a
//     MetaMask page before acting on it
// -----------------------------------------------------------

export async function describe(page) {
  try {
    return await evaluateIn(page, DESCRIBE);
  } catch {
    return null;
  }
}

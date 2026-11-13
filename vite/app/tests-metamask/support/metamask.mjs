// -----------------------------------------------------------
//  [*] MetaMask tests — the wallet, driven like a student
//
//  The real MetaMask extension inside the test browser: a
//  brand-new wallet is made through its own first-run pages,
//  and every request the faucet page sends is answered in
//  MetaMask's own confirmation window, by pressing the button
//  a student would. Nothing of MetaMask is replaced or
//  reached around — the point of these tests is what the
//  wallet students install really does.
//
//  Two things differ from a student's screen. A headless
//  browser has no side panel and opens no popup, so the
//  window with MetaMask's question is opened by hand, as a
//  tab on the address the popup would have; it is the same
//  page. And the container has no internet, so MetaMask runs
//  without the settings it normally downloads and marks its
//  signature window "Security check unavailable".
//
//  A wallet is also picked up again in a browser started a
//  second time on the same profile — the student of a later
//  lecture: MetaMask installed, set up, and LOCKED. Its lock
//  screen stands in front of whatever the page asked, and is
//  answered like a question of its own, with the password.
//
//  A question is known by the id and the name MetaMask itself
//  keeps it under, not by what the window happens to show:
//  right after an answer the window can still show the
//  question just answered, and on its way to a new one it
//  passes through other screens — pressing yes on any of
//  those answers a question nobody read. The window is only
//  trusted once it shows the sentence that belongs to the
//  question MetaMask holds.
//
//  The steps go by the test ids and the English wording of
//  the MetaMask build in the image. A new build that moves a
//  first-run step or rewords a window fails here, by name,
//  rather than passing for the wrong reason.
// -----------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

import { extensionId, describe, evaluateIn } from './browser.mjs';


// The password the test wallet is locked with — the wallet
// lives for one test and never holds anything
const PASSWORD = 'Laboratorinis-2026!';

// How often a MetaMask page is looked at while waiting for it
const LOOK_MS = 300;

// How long a pressed button is given before it is pressed
// again — a second press too soon lands on whatever MetaMask
// shows next, and answers a question nobody looked at
const PRESS_AGAIN_MS = 4_000;

// How long the first-run pages may take altogether
const SETUP_MS = 120_000;

// How long MetaMask may take to show a question the page has
// just asked, and to let go of one that was answered — with
// internet it first asks its own servers about the request
const QUESTION_MS = 30_000;

// How long a wallet that holds no question is watched before
// "it asks nothing" is believed
const NO_QUESTION_MS = 4_000;

// MetaMask's confirmation windows: what each is called here,
// the request MetaMask files it under, and a sentence its
// window carries. Two of them come from the same request — a
// site asking for permission — and differ in what is asked:
// the account, in the connect window, or one more network on
// top of what the site already has (`more`), under "Review
// permissions"
const WINDOWS = [
  { kind: 'connect', type: 'wallet_requestPermissions', more: false, says: 'Connect this website with MetaMask' },
  { kind: 'permissions', type: 'wallet_requestPermissions', more: true, says: 'Review permissions' },
  { kind: 'add-network', type: 'wallet_addEthereumChain', says: 'is suggesting additional network details' },
  { kind: 'signature', type: 'personal_sign', says: 'Signature request' },
  { kind: 'add-token', type: 'wallet_watchAsset', says: 'Add suggested tokens' },
];

// The password field of MetaMask's lock screen — the test id
// the screen is known by. The lock screen is no question
// MetaMask holds: it stands in front of the one it does hold
const LOCK = 'unlock-password';

// The lock screen's button
const UNLOCK = 'unlock-submit';

// The button that says yes in those windows, under the test
// ids MetaMask gives it from window to window
const YES_BUTTONS = ['confirm-btn', 'confirmation-submit-button', 'confirm-footer-button', 'page-container-footer-next'];

// The first-run pages in the order a new wallet meets them:
// the test id that shows a step is on screen, and what a
// student in a hurry does there — a new secret phrase, a
// password, no biometrics, the backup postponed, no analytics
const SETUP_STEPS = [
  { on: 'onboarding-create-with-srp-button', press: 'onboarding-create-with-srp-button' },
  { on: 'onboarding-create-wallet', press: 'onboarding-create-wallet' },
  { on: 'create-password-submit', password: true },
  { on: 'passkey-maybe-later-button', press: 'passkey-maybe-later-button' },
  { on: 'recovery-phrase-remind-later', press: 'recovery-phrase-remind-later' },
  { on: 'metametrics-i-agree', analytics: true },
  { on: 'download-app-continue', press: 'download-app-continue' },
  { on: 'onboarding-complete-done', press: 'onboarding-complete-done', last: true },
];

// The test id only the wallet's home screen carries
const HOME = 'account-menu-icon';

// The questions MetaMask is holding, oldest first, read from
// the state it offers for bug reports: the id it keeps each
// under, its kind of request, the site that asked, and
// whether it asks for something on top of a permission the
// site already has
const PENDING = `(async () => {
  const state = await stateHooks.getCleanAppState();
  const held = Object.values(state.metamask?.pendingApprovals ?? {});
  return JSON.stringify(held.sort((a, b) => a.time - b.time).map(({ id, type, origin, requestData }) => ({ id, type, origin, more: Boolean(requestData?.diff) })));
})()`;







// -----------------------------------------------------------
// EXTENSION
// -----------------------------------------------------------
//
// The folder the MetaMask build was unpacked into while the
// image was built (fetch-metamask.mjs) — the store's build of
// that day, carrying the store's key.
//
// Used by:
//   - support/test.mjs — the browser every student starts with
//   - support/announce.mjs — the version a run names
// -----------------------------------------------------------

export const EXTENSION = process.env.METAMASK_EXTENSION ?? '/work/extension';







// -----------------------------------------------------------
// PREVIOUS
// -----------------------------------------------------------
//
// The folder of an OLDER MetaMask build, unpacked the same
// way — the build a wallet "from an earlier lecture" is made
// under, before the browser comes back with today's over it.
//
// Used by:
//   - support/test.mjs — a student whose wallet is older than
//     today's MetaMask
//   - support/announce.mjs — the version a run names
// -----------------------------------------------------------

export const PREVIOUS = process.env.METAMASK_PREVIOUS_EXTENSION ?? '/work/extension-previous';







// -----------------------------------------------------------
// STORE_ID
// -----------------------------------------------------------
//
// MetaMask's extension id in the Chrome Web Store — the id
// that build installs under, and the one the faucet page asks
// the browser about.
//
// Used by:
//   - tests/install.spec.mjs — the id an install must report
// -----------------------------------------------------------

export const STORE_ID = 'nkbihfbeogaeaoehlefnkodbefgpgknn';







// -----------------------------------------------------------
// sleep
// -----------------------------------------------------------
//
// A pause between two looks at a page.
//
// Used by:
//   - every waiting loop in this file
// -----------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));







// -----------------------------------------------------------
// press
// -----------------------------------------------------------
//
// Presses the control with this test id when it can be
// pressed right now; a control that is busy, disabled or gone
// again is left for the next look.
//
// Used by:
//   - createWallet, answerWindow (below)
// -----------------------------------------------------------

async function press(page, testId) {
  await page.locator(`[data-testid="${testId}"]`).first().click({ timeout: 2_000 }).catch(() => {});
}







// -----------------------------------------------------------
// createWallet
// -----------------------------------------------------------
//
// Walks MetaMask's first-run pages until a new wallet exists
// and its home screen shows: each look finds the step on
// screen and does what SETUP_STEPS says for it. The pages
// keep a step up, disabled, while they work, so a step is
// simply tried again at the next look. The last step's button
// wants to open the browser's side panel, which a headless
// browser has not — once it is pressed the wallet is made,
// and the wallet's own address is opened instead.
//
// Throws with what the page showed when the wallet is not
// there in time: a first-run flow this file does not know.
//
// Used by:
//   - setUpWallet (below)
// -----------------------------------------------------------

async function createWallet(context, id) {
  const home = `chrome-extension://${id}/home.html`;
  const page = context.pages().find((open) => open.url().startsWith(home)) ?? await context.newPage();
  if (!page.url().startsWith(home)) await page.goto(home);

  const deadline = Date.now() + SETUP_MS;
  let seen = null;
  let finishedAt = null;
  let reopenedAt = 0;

  while (Date.now() < deadline) {
    await sleep(LOOK_MS);
    seen = await describe(page);
    if (!seen) continue;
    if (seen.ids.includes(HOME)) {
      await page.close();
      return;
    }

    const step = SETUP_STEPS.find(({ on }) => seen.ids.some((testId) => testId === on || testId === `${on} (disabled)`));
    if (!step) continue;

    if (step.password) {
      if (seen.ids.includes('create-password-new-input (disabled)')) continue;
      await page.locator('[data-testid="create-password-new-input"]').fill(PASSWORD, { timeout: 2_000 }).catch(() => {});
      await page.locator('[data-testid="create-password-confirm-input"]').fill(PASSWORD, { timeout: 2_000 }).catch(() => {});
      if (seen.ids.includes('create-password-submit (disabled)')) {
        await page.locator('[data-testid="create-password-terms"]').first().click({ force: true, timeout: 2_000 }).catch(() => {});
      }
      await press(page, 'create-password-submit');
    } else if (step.analytics) {
      for (const box of ['metametrics-checkbox', 'metametrics-data-collection-checkbox']) {
        const checkbox = page.locator(`[data-testid="${box}"]`).first();
        if (await checkbox.isChecked().catch(() => false)) await checkbox.click({ force: true, timeout: 2_000 }).catch(() => {});
      }
      await press(page, 'metametrics-i-agree');
    } else if (step.last && finishedAt && Date.now() - finishedAt < 2 * PRESS_AGAIN_MS) {
      // Pressed already: MetaMask finishes the wallet, and the
      // side panel never comes — its own address is opened
      // instead, a little later and not too often. A step still
      // there long after is a press that did not take, and is
      // pressed again
      if (Date.now() - finishedAt > 2_500 && Date.now() - reopenedAt > 3_000) {
        reopenedAt = Date.now();
        await page.goto(home).catch(() => {});
      }
    } else {
      await press(page, step.press);
      if (step.last) finishedAt = Date.now();
    }
  }

  throw new Error(`MetaMask's first-run pages did not end in a wallet. Last seen at ${seen?.url}: test ids [${seen?.ids.join(', ')}], text "${seen?.text.slice(0, 300)}"`);
}







// -----------------------------------------------------------
// pendingQuestions
// -----------------------------------------------------------
//
// The questions MetaMask holds right now, as one of its own
// pages knows them — or null while that page is still
// starting and cannot say.
//
// Used by:
//   - openWindow, answerWindow (below)
// -----------------------------------------------------------

async function pendingQuestions(page) {
  try {
    return JSON.parse(await evaluateIn(page, PENDING, { ownWorld: true }));
  } catch {
    return null;
  }
}







// -----------------------------------------------------------
// openWindow
// -----------------------------------------------------------
//
// Opens the window MetaMask would pop up and waits for a NEW
// question in it: one MetaMask holds that this test has not
// answered yet, with the window showing the sentence that
// belongs to it — or the lock screen, which is then what the
// window asks first. While a question already answered is
// still listed, and while the window shows anything else on
// its way there, nothing is handed back: a yes pressed then
// would answer what nobody read.
//
// A wallet that holds nothing for a few seconds has nothing
// to ask: null, the tab closed again. A question MetaMask
// holds whose window never comes to read as it should is an
// error that says what the window read — a request this file
// does not know, or a window MetaMask has reworded.
//
// Used by:
//   - walletOf (below) — nextWindow
// -----------------------------------------------------------

async function openWindow(context, id, answered) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/notification.html`).catch(() => {});

  const opened = Date.now();
  let idleSince = null;
  let unread = null;

  while (Date.now() - opened < QUESTION_MS) {
    await sleep(LOOK_MS);
    const pending = await pendingQuestions(page);
    if (!pending) continue;

    if (pending.length === 0) {
      idleSince = idleSince ?? Date.now();
      if (Date.now() - idleSince >= NO_QUESTION_MS) break;
      continue;
    }
    idleSince = null;
    const fresh = pending.filter((question) => !answered.has(question.id));
    if (fresh.length < pending.length) continue;

    const seen = await describe(page);
    if (!seen) continue;
    if (seen.ids.includes(LOCK)) return { page, kind: 'unlock', type: `in front of ${fresh[0].type}`, question: null, text: seen.text };

    const known = WINDOWS.find(({ type, more }) => type === fresh[0].type && (more === undefined || more === fresh[0].more));
    if (known && seen.text.includes(known.says)) return { page, kind: known.kind, type: fresh[0].type, question: fresh[0].id, text: seen.text };
    unread = { type: fresh[0].type, says: known?.says ?? null, text: seen.text.replace(/\s+/g, ' ').slice(0, 300) };
  }

  await page.close().catch(() => {});
  if (unread?.says) throw new Error(`MetaMask holds a "${unread.type}" question, but its window never came to read "${unread.says}". It read: ${unread.text}`);
  if (unread) throw new Error(`MetaMask asks something this suite cannot name (${unread.type}): ${unread.text}`);
  return null;
}







// -----------------------------------------------------------
// unlock
// -----------------------------------------------------------
//
// Types the wallet's password into MetaMask's lock screen and
// waits until the screen is gone — the question it stood in
// front of is still held, and still to be answered. A wallet
// that stays locked is an error: the password is this file's
// own.
//
// Used by:
//   - answerWindow (below)
// -----------------------------------------------------------

async function unlock(page) {
  const deadline = Date.now() + QUESTION_MS;
  let typedAt = 0;

  while (Date.now() < deadline && !page.isClosed()) {
    const seen = await describe(page);
    if (seen && !seen.ids.includes(LOCK)) return;

    if (seen && Date.now() - typedAt > PRESS_AGAIN_MS) {
      await page.locator(`[data-testid="${LOCK}"]`).fill(PASSWORD, { timeout: 2_000 }).catch(() => {});
      await press(page, UNLOCK);
      typedAt = Date.now();
    }
    await sleep(LOOK_MS);
  }

  throw new Error('MetaMask stayed locked after its password was typed');
}







// -----------------------------------------------------------
// answerWindow
// -----------------------------------------------------------
//
// Presses yes or cancel in an open MetaMask window, once, and
// waits until MetaMask no longer holds that question — only
// then is the answer in, and only then is the tab closed. A
// MetaMask tab left open would catch the next question
// itself, where no test looks for it. A press that did not
// take (the button not ready yet) is repeated after a while,
// for as long as MetaMask still holds the same question. The
// lock screen's yes is the password; it has no cancel.
//
// Used by:
//   - walletOf (below) — confirm, cancel
// -----------------------------------------------------------

async function answerWindow(open, yes) {
  const { page, question } = open;

  if (open.kind === 'unlock') {
    if (!yes) throw new Error('MetaMask\'s lock screen cannot be declined');
    await unlock(page);
    await page.close().catch(() => {});
    return;
  }

  const deadline = Date.now() + QUESTION_MS;
  let pressedAt = 0;

  while (Date.now() < deadline && !page.isClosed()) {
    const pending = await pendingQuestions(page);
    if (pending && !pending.some(({ id }) => id === question)) break;

    if (Date.now() - pressedAt > PRESS_AGAIN_MS) {
      const seen = await describe(page);
      const button = yes && seen ? YES_BUTTONS.find((testId) => seen.ids.includes(testId)) : null;
      if (button) await press(page, button);
      if (!yes) await page.getByRole('button', { name: 'Cancel' }).first().click({ timeout: 2_000 }).catch(() => {});
      if (button || !yes) pressedAt = Date.now();
    }
    await sleep(LOOK_MS);
  }

  await page.close().catch(() => {});
}







// -----------------------------------------------------------
// metamaskVersion
// -----------------------------------------------------------
//
// The version of the MetaMask build unpacked in a folder, as
// its manifest states it.
//
// Used by:
//   - support/test.mjs — named in every run's report
// -----------------------------------------------------------

export function metamaskVersion(folder) {
  return JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')).version;
}







// -----------------------------------------------------------
// walletOf
// -----------------------------------------------------------
//
// The ways a test talks to the wallet in this browser:
//
//   heard        — every window MetaMask showed so far, in
//                  order: its kind, MetaMask's own name for
//                  the request, its text and the answer it
//                  got, for a failing test's report
//   nextWindow   — the kind of the question MetaMask is
//                  asking now ("unlock" for its lock screen),
//                  or null when it asks nothing
//   confirm      — presses yes on the question; given a kind,
//                  it must be THAT question
//   cancel       — presses cancel the same way
//   accountsOn   — the accounts MetaMask lets a site use,
//                  chain by chain, from the wallet's own
//                  record (the state it offers for bug
//                  reports) — the place the 13.55 defect
//                  shows: a chain with no account in it
//   tokens       — the tokens the wallet was asked to list,
//                  with the chain each is on, from the same
//                  record. MetaMask has kept them in two
//                  places over time — by chain and account,
//                  and, since it counts other chains than
//                  Ethereum's among its assets, by an asset
//                  id that names chain and contract in one —
//                  and both are read
//
// The two that read the record open the wallet's own page,
// which would catch a question still unanswered — they are
// for a wallet that is unlocked and asked nothing.
//
// Used by:
//   - setUpWallet, returnToWallet (below)
// -----------------------------------------------------------

function walletOf(context, id, heard) {
  const answered = new Set();
  let open = null;

  const look = async () => {
    if (!open) {
      open = await openWindow(context, id, answered);
      if (open) heard.push({ kind: open.kind, type: open.type, text: open.text.replace(/\s+/g, ' ').slice(0, 400) });
    }
    return open;
  };

  const settle = async (yes, expected) => {
    const asking = await look();
    if (!asking) throw new Error(`MetaMask asks nothing${expected ? ` — a "${expected}" window was expected` : ''}`);
    if (expected && asking.kind !== expected) {
      throw new Error(`MetaMask shows its "${asking.kind}" window where "${expected}" was expected: ${asking.text.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    open = null;
    if (asking.question) answered.add(asking.question);
    await answerWindow(asking, yes);
    heard.at(-1).answer = yes ? 'yes' : 'cancel';
    return asking.kind;
  };

  const record = async (...parts) => {
    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${id}/home.html`);
      const deadline = Date.now() + QUESTION_MS;
      while (Date.now() < deadline && !(await describe(page))?.ids.includes(HOME)) await sleep(LOOK_MS);
      return JSON.parse(await evaluateIn(page, `(async () => {
        const kept = (await stateHooks.getCleanAppState()).metamask ?? {};
        return JSON.stringify(Object.fromEntries(${JSON.stringify(parts)}.map((part) => [part, kept[part] ?? {}])));
      })()`, { ownWorld: true }));
    } finally {
      await page.close().catch(() => {});
    }
  };

  return {
    id,
    heard,
    nextWindow: async () => (await look())?.kind ?? null,
    confirm: (expected) => settle(true, expected),
    cancel: (expected) => settle(false, expected),

    async accountsOn(origin) {
      const { subjects } = await record('subjects');
      const chains = {};
      for (const permission of Object.values(subjects[origin]?.permissions ?? {})) {
        for (const caveat of permission.caveats ?? []) {
          for (const scopes of [caveat.value?.requiredScopes, caveat.value?.optionalScopes]) {
            for (const [scope, { accounts = [] }] of Object.entries(scopes ?? {})) {
              if (scope.startsWith('eip155:')) chains[scope] = accounts.map((account) => account.split(':').pop());
            }
          }
        }
      }
      return chains;
    },

    async tokens() {
      const { allTokens, customAssets, assetsInfo } = await record('allTokens', 'customAssets', 'assetsInfo');
      const listed = [];

      for (const [chain, accounts] of Object.entries(allTokens)) {
        for (const tokens of Object.values(accounts)) {
          for (const token of tokens) listed.push({ chain: parseInt(chain, 16), symbol: token.symbol, address: token.address.toLowerCase() });
        }
      }
      for (const assets of Object.values(customAssets)) {
        for (const asset of assets) {
          const [, chain, address] = asset.match(/^eip155:(\d+)\/erc20:(0x[0-9a-fA-F]{40})$/) ?? [];
          if (address) listed.push({ chain: Number(chain), symbol: assetsInfo[asset]?.symbol ?? null, address: address.toLowerCase() });
        }
      }
      return listed;
    },
  };
}







// -----------------------------------------------------------
// setUpWallet
// -----------------------------------------------------------
//
// Makes a brand-new wallet in the MetaMask of this browser
// and hands back the ways a test talks to it (walletOf).
//
// Used by:
//   - support/test.mjs — the `student` fixture
// -----------------------------------------------------------

export async function setUpWallet(context) {
  const id = await extensionId(context);
  await createWallet(context, id);
  return walletOf(context, id, []);
}







// -----------------------------------------------------------
// returnToWallet
// -----------------------------------------------------------
//
// The wallet made earlier, in a browser started again on the
// same profile: nothing is set up, MetaMask is simply there —
// locked — under the id it had. What it showed before the
// browser closed stays on the record, with a note of the
// restart.
//
// Used by:
//   - support/test.mjs — the `student` fixture's comeBack
// -----------------------------------------------------------

export async function returnToWallet(context, earlier) {
  const id = await extensionId(context);
  if (id !== earlier.id) throw new Error(`MetaMask came back under another id (${id}) than it had (${earlier.id}) — to the browser this is another extension, with nothing remembered`);
  earlier.heard.push({ note: 'the browser was closed and started again' });
  return walletOf(context, id, earlier.heard);
}

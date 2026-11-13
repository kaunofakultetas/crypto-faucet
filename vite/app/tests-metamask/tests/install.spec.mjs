// -----------------------------------------------------------
//  [*] MetaMask tests — MetaMask installed while the page is open
//
//  A student opens the faucet, is told to install MetaMask,
//  installs it — and the page they left open cannot see it: a
//  browser hands a new extension only to pages loaded after
//  it. The faucet page therefore reloads itself, and these
//  tests install the real extension into a running browser
//  with the page open to see it happen:
//
//    - under the store's id the page notices by itself, by
//      asking the browser whether that extension exists
//    - under an id the page has never heard of it cannot
//      notice — it reloads when the student, who pressed its
//      install link, comes back to the tab
//    - a page that came up with MetaMask never reloads at all
//
//  The store's page itself cannot load without internet; the
//  tab the install link opens stays an error page, which is
//  all the test needs of it — somewhere else to be.
//
//  One thing is told to the page by hand. An automated browser
//  keeps every tab "visible and in focus" whatever happens
//  around it — minimised, behind another tab — so the
//  student's leaving and coming back are sent as the two
//  signals a browser sends a window that loses and regains the
//  keyboard. What follows them is real: the reload, MetaMask
//  found, the connect step.
// -----------------------------------------------------------

import { STORE_ID } from '../support/metamask.mjs';
import { test, expect } from '../support/test.mjs';


// The name a tab's own count of its documents is kept under,
// in its session's storage
const DOCUMENTS = 'metamask-tests:documents';







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// installLink and connectButton are the page's two faces at
// the first steps: no wallet, and a wallet to connect.
// countLoads counts the documents a tab loads from now on — a
// reload shows as one. The count is kept by the tab itself,
// in its session's storage, by a script every new document
// runs first: the browser's own "loaded" signal cannot be
// trusted here — it is also sent for a tab that stays exactly
// as it is while an extension is installed beside it. leave
// and comeBack are the student turning to another tab or
// window and back, as the two signals the header explains.
// -----------------------------------------------------------

const installLink = (page) => page.getByRole('link', { name: 'Susidiegti MetaMask' });
const connectButton = (page) => page.getByRole('button', { name: 'Prijungti piniginę' });

const countLoads = async (page) => {
  await page.addInitScript((key) => { sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? 0) + 1)); }, DOCUMENTS);
  return { loads: () => page.evaluate((key) => Number(sessionStorage.getItem(key) ?? 0), DOCUMENTS) };
};

const leave = (page) => page.evaluate(() => { window.dispatchEvent(new Event('blur')); });
const comeBack = (page) => page.evaluate(() => { window.dispatchEvent(new Event('focus')); });







// -----------------------------------------------------------
// The install
// -----------------------------------------------------------
//
// The extension arrives under the id the page asks about,
// under one it does not know, or was there all along.
// -----------------------------------------------------------

test.describe('MetaMask installed while the faucet page is open', () => {

  test('the page notices the extension and moves on to the connect step by itself', async ({ visitor }) => {
    const page = await visitor.open('zkSyncSepolia');
    await expect(installLink(page)).toBeVisible();
    const counted = await countLoads(page);

    expect(await visitor.installMetamask()).toBe(STORE_ID);

    await expect(connectButton(page)).toBeVisible();
    expect(await counted.loads()).toBe(1);

    // And it stays there — one reload, not a loop
    await page.waitForTimeout(6_000);
    expect(await counted.loads()).toBe(1);
    await expect(connectButton(page)).toBeVisible();
  });


  test('under an id the page does not know, it reloads when the student comes back from the store', async ({ visitor }) => {
    const page = await visitor.open('zkSyncSepolia');
    const counted = await countLoads(page);

    // The student presses the install link: the store opens in a new tab
    const [store] = await Promise.all([
      visitor.context.waitForEvent('page'),
      installLink(page).click(),
    ]);
    await leave(page);
    expect(await page.evaluate(() => localStorage.getItem('walletInstall:MetaMask'))).toMatch(/^\d+$/);

    expect(await visitor.installMetamask({ knownToThePage: false })).not.toBe(STORE_ID);

    // Nobody has come back yet: the page cannot know
    await page.waitForTimeout(5_000);
    expect(await counted.loads()).toBe(0);
    await expect(installLink(page)).toBeVisible();

    await store.close();
    await comeBack(page);

    await expect(connectButton(page)).toBeVisible();
    expect(await counted.loads()).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('walletInstall:MetaMask'))).toBeNull();
  });


  test('a page that came up with MetaMask never reloads', async ({ student }) => {
    const page = await student.open('zkSyncSepolia');
    await expect(connectButton(page)).toBeVisible();
    const counted = await countLoads(page);

    await page.waitForTimeout(8_000);

    expect(await counted.loads()).toBe(0);
  });
});

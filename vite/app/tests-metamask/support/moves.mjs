// -----------------------------------------------------------
//  [*] MetaMask tests — what a student does on the faucet page
//
//  The moves every test repeats, by the page's own Lithuanian
//  labels: get to the claim button — connect the wallet, have
//  the page switch the network — press it, and answer what
//  MetaMask asks before it signs.
//
//  What MetaMask asks on the way is not the same twice. It
//  depends on the build, on whether the wallet is locked, on
//  whether the site was connected before and on whether the
//  network was added by the page or shipped with MetaMask. So
//  the moves do not expect one road: they answer what comes,
//  as long as it is a question a student would say yes to at
//  that point, and hand back what they met. A test then says
//  what must come OUT — the claim reached the backend — pins
//  the road only where the road is its subject, and prints
//  it, so the report shows what a student will be asked.
// -----------------------------------------------------------

import { expect } from '@playwright/test';


// How long the page is given to move on by itself after a
// button, before MetaMask is asked whether it wants something
// — a network MetaMask already has is switched to without a
// window
const MOVES_ON_MS = 1_500;

// How long the page is given to take in an answer MetaMask
// was just given
const TAKES_IN_MS = 6_000;

// How many windows MetaMask may put in front of one step —
// more than this is a wallet going in circles
const WINDOWS_PER_STEP = 3;

// How long MetaMask may take to come up with a window that is
// due. Without internet it asks at once; with it, MetaMask
// first puts the request to its own servers, and a wallet
// that seems to ask nothing is only slow
const DUE_MS = 60_000;







// -----------------------------------------------------------
// PAID
// -----------------------------------------------------------
//
// The page's sentence after a claim of coins went through,
// whatever the network.
//
// Used by:
//   - coinsPaid (below)
// -----------------------------------------------------------

export const PAID = /išsiųstas į jūsų piniginę/;







// -----------------------------------------------------------
// coinsPaid
// -----------------------------------------------------------
//
// The page's success alert for a claim of coins.
//
// Used by:
//   - tests/claim.spec.mjs, later-lecture.spec.mjs,
//     tokens.spec.mjs
// -----------------------------------------------------------

export const coinsPaid = (page) => page.getByRole('alert').filter({ hasText: PAID });







// -----------------------------------------------------------
// tokensPaid
// -----------------------------------------------------------
//
// The token page's success alert for a claim of one token.
//
// Used by:
//   - tests/tokens.spec.mjs, later-lecture.spec.mjs
// -----------------------------------------------------------

export const tokensPaid = (page, symbol) => page.getByRole('alert').filter({ hasText: `${symbol} išsiųsta!` });







// -----------------------------------------------------------
// claimOf
// -----------------------------------------------------------
//
// What a claim that reached the backend looks like: the
// network, the token when it is one, the address, a nonce and
// a full signature.
//
// Used by:
//   - every file under tests/ that claims
// -----------------------------------------------------------

export const claimOf = (network, address, token = null) => ({
  network,
  ...(token ? { token } : {}),
  address,
  nonce: expect.stringMatching(/^\d+$/),
  signature: expect.stringMatching(/^0x[0-9a-f]{130}$/),
});







// -----------------------------------------------------------
// connectedAccount
// -----------------------------------------------------------
//
// The account the page was given, asked of MetaMask through
// the page's own provider.
//
// Used by:
//   - reachTheClaim (below)
// -----------------------------------------------------------

export const connectedAccount = (page) => page.evaluate(async () => {
  const provider = await new Promise((resolve) => {
    window.addEventListener('eip6963:announceProvider', (event) => {
      if (event.detail?.info?.rdns === 'io.metamask') resolve(event.detail.provider);
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  });
  return (await provider.request({ method: 'eth_accounts' }))[0];
});







// -----------------------------------------------------------
// coinsButton
// -----------------------------------------------------------
//
// The claim button of a network's coin page.
//
// Used by:
//   - reachTheClaim (below), the tests that claim coins
// -----------------------------------------------------------

export const coinsButton = (page, networkName) => page.getByRole('button', { name: `Gauti ${networkName} valiutos` });







// -----------------------------------------------------------
// tokenButton
// -----------------------------------------------------------
//
// The claim button of a token, on the token's page. It is
// there from the start and cannot be pressed until the wallet
// sits on the token's chain.
//
// Used by:
//   - the tests that claim tokens
// -----------------------------------------------------------

export const tokenButton = (page, symbol) => page.getByRole('button', { name: `Gauti ${symbol}` });







// -----------------------------------------------------------
// canBePressed
// -----------------------------------------------------------
//
// Whether a button is on the page and takes a press right now.
//
// Used by:
//   - reachTheClaim (below)
// -----------------------------------------------------------

const canBePressed = async (button) => (await button.isVisible()) && (await button.isEnabled());







// -----------------------------------------------------------
// dueWindow
// -----------------------------------------------------------
//
// The kind of the next window of a wallet that is known to
// owe one — after a claim was pressed, say: looked for again
// and again until it is there. A wallet that has nothing to
// ask after all this time has none: null.
//
// Used by:
//   - reachTheClaim, signTheClaim (below)
//   - tests/claim.spec.mjs — the window a student declines
// -----------------------------------------------------------

export async function dueWindow(wallet, isStillDue = async () => true) {
  const deadline = Date.now() + DUE_MS;
  let kind = await wallet.nextWindow();

  while (!kind && Date.now() < deadline && await isStillDue()) kind = await wallet.nextWindow();
  return kind;
}







// -----------------------------------------------------------
// reachTheClaim
// -----------------------------------------------------------
//
// Does what stands between a student and the claim button of
// a page: the connect step and the network step, each only if
// the page shows it — a wallet that was connected at an
// earlier lecture is past the first, one already on the
// network past both. After each button MetaMask is answered
// yes for as long as the page has not moved on: its lock
// screen, its connect window, its window for a network.
//
// A page that has just loaded shows its connect button until
// MetaMask has told it that it is connected already — a
// moment a student never notices. That button is on its way
// out and is not pressed: MetaMask is asked what it tells the
// page, and a step that goes by itself under the press is
// simply looked at again.
//
// Hands back the claim button, ready to be pressed, the
// windows MetaMask showed on the way, in order, and the
// account the page was given.
//
// Used by:
//   - every file under tests/ that claims
// -----------------------------------------------------------

export async function reachTheClaim(page, wallet, networkName, claim = coinsButton(page, networkName)) {
  const connect = page.getByRole('button', { name: 'Prijungti piniginę' });
  const change = page.getByRole('button', { name: `Persijungti į ${networkName} tinklą` });
  const asked = [];

  if (await connectedAccount(page)) await expect(connect).toBeHidden();

  // Two steps at most, and a look more for each that went by
  // itself: every round waits until the page shows where it
  // stands, and the rounds end once the claim is ready
  for (let rounds = 0; rounds < 4; rounds += 1) {
    await expect.poll(async () => (await canBePressed(claim)) || (await connect.isVisible()) || (await change.isVisible())).toBe(true);
    if (await canBePressed(claim)) break;

    const step = (await connect.isVisible()) ? connect : change;
    const pressed = await step.click({ timeout: MOVES_ON_MS }).then(() => true, () => false);
    if (!pressed) continue;

    // The page moves on by itself, or MetaMask has a question —
    // and then another, until the step is done
    await step.waitFor({ state: 'hidden', timeout: MOVES_ON_MS }).catch(() => {});
    for (let windows = 0; windows < WINDOWS_PER_STEP && await step.isVisible(); windows += 1) {
      const kind = await dueWindow(wallet, () => step.isVisible());
      if (!kind) break;
      asked.push(await wallet.confirm(kind));
      await step.waitFor({ state: 'hidden', timeout: TAKES_IN_MS }).catch(() => {});
    }
    await expect(step).toBeHidden();
  }

  await expect(claim).toBeEnabled();
  return { claim, asked, account: await connectedAccount(page) };
}







// -----------------------------------------------------------
// signTheClaim
// -----------------------------------------------------------
//
// Answers MetaMask after the claim button was pressed, up to
// and including the signature. Two things may stand in front
// of the signature, and both are answered yes: the lock
// screen of a wallet that was not opened yet today, and the
// connect window the page brings up when MetaMask refuses to
// sign on a network that has no account of the wallet in its
// permission (MetaMask 13.55 and later, a network the page
// added). Hands back what stood there, in order — nothing at
// all for a wallet that simply signs.
//
// Used by:
//   - every file under tests/ that claims
// -----------------------------------------------------------

export async function signTheClaim(wallet) {
  const before = [];
  let kind = await dueWindow(wallet);

  while ((kind === 'unlock' || kind === 'connect') && before.length < WINDOWS_PER_STEP) {
    before.push(await wallet.confirm(kind));
    kind = await dueWindow(wallet);
  }

  await wallet.confirm('signature');
  return before;
}

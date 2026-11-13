// -----------------------------------------------------------
//  [*] MetaMask tests — the wallet from an earlier lecture
//
//  A wallet is made once. At every lecture after the first
//  the student starts a browser that has MetaMask installed,
//  set up and locked, with the faucet connected from last
//  time and the networks of last time in it — and meets a
//  network that is new. MetaMask has, as a rule, updated
//  itself in between: the wallet in the browser was made by
//  the MetaMask of another month.
//
//  That is where the defect of 12 November 2026 also sits. A
//  wallet that had a network added by the page under an older
//  MetaMask keeps that network WITHOUT its account, and since
//  13.55 MetaMask refuses to sign there — for a wallet that
//  worked all autumn, locked, at the first claim of the day.
//
//  Two lectures in one test, twice: with the wallet made under
//  today's MetaMask, and with the wallet made under the older
//  build the image carries, today's put over it before the
//  second lecture. The later lecture claims on the network of
//  the first, on a network new to the wallet, on one MetaMask
//  ships, and on the first again. Every claim must reach the
//  backend for the account of the first lecture. What MetaMask
//  put in front of each signature is printed, not pinned —
//  it is what the students will be asked that day.
// -----------------------------------------------------------

import { test, expect } from '../support/test.mjs';
import { claimOf, coinsPaid, reachTheClaim, signTheClaim } from '../support/moves.mjs';


// The two wallets a returning student may hold
const WALLETS = [
  { madeUnder: 'today', called: "made under today's MetaMask" },
  { madeUnder: 'previous', called: 'made under an older MetaMask and updated since' },
];

// The networks of the later lecture, in the order they are
// used, with what each is to the wallet by then
const LATER = [
  { key: 'zkSyncSepolia', name: 'zkSync Sepolia', is: 'the network of the first lecture' },
  { key: 'hoodi', name: 'Ethereum Hoodi', is: 'a network new to the wallet, added by the page' },
  { key: 'sepolia', name: 'Ethereum Sepolia', is: 'a network MetaMask ships' },
  { key: 'zkSyncSepolia', name: 'zkSync Sepolia', is: 'the first network again' },
];







// -----------------------------------------------------------
// The later lecture
// -----------------------------------------------------------
//
// One test per wallet. Two lectures and a restart of the
// browser take longer than any other test, so each is given
// twice the usual time.
// -----------------------------------------------------------

for (const { madeUnder, called } of WALLETS) {
  test.describe(`A wallet ${called}`, () => {

    test.use({ madeUnder });

    test('comes back locked at a later lecture and claims on every kind of network', async ({ student, faucet }) => {
      test.setTimeout(600_000);
      const road = [];

      // The first lecture: a brand-new wallet, one network
      let page = await student.open('zkSyncSepolia');
      const first = await reachTheClaim(page, student.wallet, 'zkSync Sepolia');
      await first.claim.click();
      road.push(`first lecture, zkSync Sepolia: ${[...first.asked, ...await signTheClaim(student.wallet), 'signature'].join(' → ')}`);
      await expect(coinsPaid(page)).toBeVisible();
      const expected = [claimOf('zkSyncSepolia', first.account)];

      // The browser is closed, and started again for a later lecture
      await student.comeBack();
      const { wallet } = student;

      for (const { key, name, is } of LATER) {
        page = await student.open(key);
        const { claim, asked, account } = await reachTheClaim(page, wallet, name);
        expect(account, `${name}: the account the page is given`).toBe(first.account);

        await claim.click();
        road.push(`later lecture, ${is} (${name}): ${[...asked, ...await signTheClaim(wallet), 'signature'].join(' → ')}`);
        await expect(coinsPaid(page), `${name}: the page's word that the coins are on their way`).toBeVisible();

        expected.push(claimOf(key, first.account));
        expect(faucet.claims(), `${name}: the claims the backend has by now`).toEqual(expected);
      }

      // The wallet was locked when the browser came back: whatever
      // else MetaMask asked, it asked for the password once
      expect(wallet.heard.filter((window) => window.kind === 'unlock')).toHaveLength(1);
      console.log(`A wallet ${called} — what MetaMask asked:\n${road.map((line) => `  ${line}`).join('\n')}`);
    });
  });
}

// -----------------------------------------------------------
//  [*] MetaMask tests — a brand-new wallet claims
//
//  The laboratory, start to finish, with the real MetaMask: a
//  student who has just made their first wallet opens the
//  faucet, connects, lets the page switch the network and
//  claims. On 12 November 2026 that ended in MetaMask's
//  "The requested account and/or method has not been
//  authorized by the user." for every network the page had to
//  ADD — MetaMask 13.55 had started to permit such a network
//  without the student's account (MetaMask issue 47773), and
//  the faucet's own tests, which run against a stand-in
//  wallet, had no way to notice.
//
//  The tests say what must come out — the claim reaches the
//  backend, for the account that signed — and take either road
//  MetaMask offers there: a build with the defect has the page
//  ask for the account once more, a build without it signs at
//  once. Each test prints which road it met, so the day
//  MetaMask mends the defect shows in the report rather than
//  as a failure.
// -----------------------------------------------------------

import { test, expect } from '../support/test.mjs';
import { claimOf, coinsPaid, dueWindow, reachTheClaim, signTheClaim } from '../support/moves.mjs';


// The opening of the page's sentence when the student
// declines the connect window the claim brought up
const NOT_CONFIRMED = 'MetaMask paprašė dar kartą patvirtinti prisijungimą šiame tinkle, bet patvirtinti nepavyko.';







// -----------------------------------------------------------
// The claims
// -----------------------------------------------------------
//
// One on a network the page has MetaMask add, one on a
// network MetaMask ships, and the student saying no to the
// window the repair brings up.
// -----------------------------------------------------------

test.describe('A brand-new wallet claims', () => {

  test('on zkSync Sepolia — a network the page has MetaMask add', async ({ student, faucet }) => {
    const { wallet } = student;
    const page = await student.open('zkSyncSepolia');
    const { claim, asked, account } = await reachTheClaim(page, wallet, 'zkSync Sepolia');
    expect(asked).toEqual(['connect', 'add-network']);

    await claim.click();
    const repaired = (await signTheClaim(wallet)).includes('connect');

    await expect(coinsPaid(page)).toBeVisible();
    expect(faucet.claims()).toEqual([claimOf('zkSyncSepolia', account)]);
    expect((await wallet.accountsOn(faucet.url))['eip155:300']).toEqual([account]);
    console.log(repaired
      ? '  zkSync Sepolia: MetaMask refused the first signature on the added network — the page asked for the account again and the claim went through'
      : '  zkSync Sepolia: MetaMask signed at once — this build permits an added network with its account');

    // The next claim needs the signature alone
    await claim.click();
    expect(await signTheClaim(wallet)).toEqual([]);
    await expect.poll(() => faucet.claims().length).toBe(2);
    expect(faucet.claims()[1]).toEqual(claimOf('zkSyncSepolia', account));
  });


  test('on Sepolia — a network MetaMask knows', async ({ student, faucet }) => {
    const { wallet } = student;
    const page = await student.open('sepolia');
    const { claim, asked, account } = await reachTheClaim(page, wallet, 'Ethereum Sepolia');
    expect(asked).toEqual(['connect', 'permissions']);

    await claim.click();
    expect(await signTheClaim(wallet)).toEqual([]);

    await expect(coinsPaid(page)).toBeVisible();
    expect(faucet.claims()).toEqual([claimOf('sepolia', account)]);
  });


  test('declining the connect window the claim brings up says what to do — and the next try goes through', async ({ student, faucet }) => {
    const { wallet } = student;
    const page = await student.open('zkSyncSepolia');
    const { claim, account } = await reachTheClaim(page, wallet, 'zkSync Sepolia');

    // Only a MetaMask that signs at once has nothing to decline; one
    // that asks nothing at all here is a failure, not a reason to skip
    await claim.click();
    test.skip(await dueWindow(wallet) === 'signature', 'this MetaMask build signs at once on an added network — there is no second connect window to decline');
    await wallet.cancel('connect');

    await expect(page.getByRole('alert').filter({ hasText: NOT_CONFIRMED })).toBeVisible();
    expect(faucet.claims()).toEqual([]);
    await expect(claim).toBeEnabled();

    await claim.click();
    expect(await signTheClaim(wallet)).toEqual(['connect']);
    await expect(coinsPaid(page)).toBeVisible();
    expect(faucet.claims()).toEqual([claimOf('zkSyncSepolia', account)]);
  });
});

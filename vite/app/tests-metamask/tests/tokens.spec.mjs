// -----------------------------------------------------------
//  [*] MetaMask tests — ERC-20 tokens
//
//  The token lecture with the real MetaMask. A token claim is
//  a signature like a coin claim, and two things besides: the
//  wallet must sit on the token's chain before the page lets
//  it claim, and a token just received does not show in
//  MetaMask until its contract is imported — the page's
//  "Rodyti MetaMask" button asks MetaMask to do that, in a
//  window of MetaMask's own.
//
//  The tokens and their contracts are the real ones (the kept
//  answers in ../backend). The double says the wallet holds
//  enough coins for gas, as a student does who took coins
//  first; without internet MetaMask cannot ask the chain about
//  the contract and takes the page's word for the token's
//  name and decimals.
// -----------------------------------------------------------

import fs from 'node:fs';

import { test, expect } from '../support/test.mjs';
import { claimOf, coinsPaid, tokensPaid, tokenButton, dueWindow, reachTheClaim, signTheClaim } from '../support/moves.mjs';


// The chain every token of the faucet lives on, as the page
// names it and as MetaMask numbers it
const TOKEN_CHAIN = { key: 'sepolia', name: 'Ethereum Sepolia', id: 11155111 };

// The kept answer about one token, as the backend gave it
const kept = (symbol) => JSON.parse(fs.readFileSync(new URL(`../backend/erc20-token-${symbol}.json`, import.meta.url), 'utf8'));







// -----------------------------------------------------------
// The tokens
// -----------------------------------------------------------
//
// The lecture as it goes — coins for gas, then the token,
// then the token made visible — and a wallet that arrives at
// the token's page sitting on another chain.
// -----------------------------------------------------------

test.describe('ERC-20 tokens', () => {

  test('a brand-new wallet takes coins for gas, claims LINK and has MetaMask show the token', async ({ student, faucet }) => {
    const { wallet } = student;
    const link = kept('LINK').deployments.find((deployment) => deployment.network === TOKEN_CHAIN.key);

    // Coins first: a token is no use without gas
    let page = await student.open(TOKEN_CHAIN.key);
    const coins = await reachTheClaim(page, wallet, TOKEN_CHAIN.name);
    await coins.claim.click();
    await signTheClaim(wallet);
    await expect(coinsPaid(page)).toBeVisible();

    // The token's page finds the wallet connected and on the token's chain
    page = await student.openToken('LINK');
    const { claim, asked, account } = await reachTheClaim(page, wallet, TOKEN_CHAIN.name, tokenButton(page, 'LINK'));
    expect(asked).toEqual([]);
    expect(account).toBe(coins.account);

    await claim.click();
    expect(await signTheClaim(wallet)).toEqual([]);
    await expect(tokensPaid(page, 'LINK')).toBeVisible();
    expect(faucet.claims()).toEqual([claimOf(TOKEN_CHAIN.key, account), claimOf(TOKEN_CHAIN.key, account, 'LINK')]);

    // The token is in the wallet's list only after MetaMask is asked to put it there
    expect(await wallet.tokens()).toEqual([]);
    await page.getByRole('button', { name: 'Rodyti MetaMask' }).click();
    expect(await dueWindow(wallet)).toBe('add-token');
    await wallet.confirm('add-token');
    await expect.poll(() => wallet.tokens()).toEqual([{ chain: TOKEN_CHAIN.id, symbol: 'LINK', address: link.contract_address.toLowerCase() }]);
  });


  test("a wallet sitting on another chain is taken to the token's chain by the page before it claims", async ({ student, faucet }) => {
    const { wallet } = student;

    // The student comes from the coin page of a network the page added
    let page = await student.open('zkSyncSepolia');
    const elsewhere = await reachTheClaim(page, wallet, 'zkSync Sepolia');
    expect(elsewhere.asked).toEqual(['connect', 'add-network']);

    // The token's page asks for its own chain, and holds the claim until then
    page = await student.openToken('FOLD');
    await expect(tokenButton(page, 'FOLD')).toBeDisabled();
    const { claim, asked, account } = await reachTheClaim(page, wallet, TOKEN_CHAIN.name, tokenButton(page, 'FOLD'));
    expect(asked).toEqual(['permissions']);
    expect(account).toBe(elsewhere.account);

    await claim.click();
    expect(await signTheClaim(wallet)).toEqual([]);
    await expect(tokensPaid(page, 'FOLD')).toBeVisible();
    expect(faucet.claims()).toEqual([claimOf(TOKEN_CHAIN.key, account, 'FOLD')]);
  });
});

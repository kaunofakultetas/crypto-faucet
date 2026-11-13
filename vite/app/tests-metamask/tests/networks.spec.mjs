// -----------------------------------------------------------
//  [*] MetaMask tests — every network of the faucet
//
//  One wallet goes through every EVM network the faucet
//  offers, one after the other, the way a student does over a
//  semester — one network at one lecture, another at the next
//  — and claims on each. By the end the wallet holds them all.
//
//  A network is either one MetaMask ships, which it asks to
//  permit ("Review permissions"), or one the page has to hand
//  it ("Add …"). The second kind is where the 13.55 defect
//  bites and the page's repair is needed, so the list is
//  worth reading before a laboratory: it is printed with the
//  run, each network with what MetaMask asked on the way to
//  the claim. A network MetaMask takes in neither way, or a
//  claim that does not reach the backend, fails the test.
//
//  The networks are the ones the backend's kept answer lists
//  (../backend/evm-networks.json): a network added to the
//  faucet is covered once that answer is taken again.
// -----------------------------------------------------------

import fs from 'node:fs';

import { test, expect } from '../support/test.mjs';
import { claimOf, coinsPaid, reachTheClaim, signTheClaim } from '../support/moves.mjs';


// The networks the backend's kept answer lists, as the page
// names them
const NETWORKS = Object.entries(JSON.parse(fs.readFileSync(new URL('../backend/evm-networks.json', import.meta.url), 'utf8')).networks)
  .map(([key, network]) => ({ key, name: network.full_name }));







// -----------------------------------------------------------
// The networks
// -----------------------------------------------------------
//
// One wallet, connected at the first network; six claims take
// longer than any single one, so the test is given twice the
// usual time.
// -----------------------------------------------------------

test.describe('Every EVM network of the faucet', () => {

  test('takes a claim from the same wallet, one network after the other — known to MetaMask or added by the page', async ({ student, faucet }) => {
    test.setTimeout(600_000);
    const { wallet } = student;
    const expected = [];
    const lines = [];

    for (const network of NETWORKS) {
      const page = await student.open(network.key);
      const { claim, asked, account } = await reachTheClaim(page, wallet, network.name);
      const added = asked.includes('add-network');
      expect(added || asked.includes('permissions'), `${network.name}: MetaMask either adds the network or permits one it knows — it asked ${asked.join(', ') || 'nothing'}`).toBe(true);

      await claim.click();
      const before = await signTheClaim(wallet);
      await expect(coinsPaid(page), `${network.name}: the page's word that the coins are on their way`).toBeVisible();

      expected.push(claimOf(network.key, account));
      expect(faucet.claims(), `${network.name}: the claims the backend has by now`).toEqual(expected);

      lines.push(`  ${network.name.padEnd(20)} ${(added ? 'has to be ADDED by the page' : 'known to MetaMask').padEnd(28)} ${[...asked, ...before, 'signature'].join(' → ')}`);
      await page.close();
    }

    console.log(`Networks, as a brand-new MetaMask sees them, and what it asked on the way to the claim:\n${lines.join('\n')}`);
  });
});

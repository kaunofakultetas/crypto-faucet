// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: the backend contract
//
//  Every response variant of contract.js against the four
//  endpoints the /graph/:network page reads, each with this
//  page's own way of showing a failure:
//
//    /api/evm/:network/faucet-balance — "Nepavyko gauti
//        čiaupo adreso"; "Kraunama…" while it hangs
//    /api/evm/networks — nothing to show: the heading falls
//        back to the URL key and the labels to ETH, the graph
//        works on
//    /api/evm/:network/transaction-days — today alone in the
//        date bar, the graph works on
//    /api/evm/:network/get-stored-transactions — the outage
//        notice over the canvas; "0 pervedimai" while it hangs
//
//  and then the malformed answers the matrix does not reach
//  but a backend or proxy can send: a stored-transactions 200
//  that is no transfer list (at boot, or in the boot sweep), a
//  transfer value that arrives as a string, a day list that is
//  no list — the defects they expose are pinned (it.fails)
//  with a one-line description.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { describeEndpointContract, settle, expectNoCrash } from '../../support/backend/contract';
import * as f from '../../support/backend/fixtures';
import { liveNetwork, networks } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, advance, renderGraph, bootedNetwork, transferRows, dayPicker,
  OUTAGE_TEXT, ADDR, NAMES, DAY_TRANSFERS, TODAY,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// pageStands: the page still shows one of its own states —
// its date bar, or one of its single status lines (the
// contract's `chrome`). renderScene: the page over the day's
// backend model (for the matrices of the endpoints the model
// does not answer).
// -----------------------------------------------------------

const pageStands = () => screen.queryByRole('combobox', { name: 'Data' })
  ?? screen.queryByText('Kraunama…')
  ?? screen.queryByText('Nepavyko gauti čiaupo adreso')
  ?? screen.queryByText('Adresas nerastas')
  ?? screen.queryByText('Šiam tinklui transakcijų srautas neprieinamas');

const renderScene = () => {
  installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
  return renderGraph();
};

const earlierButton = () => screen.queryByRole('button', { name: 'Ankstesnė diena' });







// -----------------------------------------------------------
// The contract matrices
// -----------------------------------------------------------
//
// One per endpoint, in the order the page asks them. The
// stored-transactions matrix runs without the backend model
// (the variant must answer that endpoint itself); the others
// run over the day's model, so a working graph can be told
// from a broken one.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/evm/:network/faucet-balance',
  fixture: f.evmBalance(),
  render: renderScene,
  chrome: pageStands,
  loaded: async () => { await bootedNetwork({ transfers: 3 }); },
  failed: async () => { await screen.findByText('Nepavyko gauti čiaupo adreso'); },
  loading: () => screen.getByText('Kraunama…'),
});


describeEndpointContract({
  path: '/api/evm/networks',
  fixture: f.evmNetworks,
  render: renderScene,
  chrome: pageStands,
  loaded: async () => {
    await screen.findByRole('heading', { level: 1, name: 'Transakcijų srautas — Ethereum Sepolia' });
    await waitFor(() => expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 SepETH (1 tx)']));
  },
  // No list, no failure line: the graph goes on with the URL
  // key as its heading and ETH on its labels
  failed: async () => {
    await bootedNetwork({ transfers: 3 });
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų srautas — sepolia' })).toBeInTheDocument();
    expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 ETH (1 tx)']);
  },
});


describeEndpointContract({
  path: '/api/evm/:network/transaction-days',
  fixture: f.evmTransactionDays(),
  render: renderScene,
  chrome: pageStands,
  loaded: async () => {
    await waitFor(() => expect(earlierButton()).toBeInTheDocument());
    expect(screen.getAllByRole('slider').find((slider) => slider.getAttribute('aria-orientation') === 'horizontal')).toHaveAttribute('aria-valuemax', '3');
  },
  // Today alone — no steppers, no slider — and the graph on
  failed: async () => {
    await bootedNetwork({ transfers: 3 });
    await settle(50);
    expect(earlierButton()).toBeNull();
    expect(dayPicker()).toHaveValue('2026-09-30 (šiandien)');
  },
  loading: () => (earlierButton() ? null : dayPicker()),
});


describeEndpointContract({
  path: '/api/evm/:network/get-stored-transactions',
  fixture: f.evmStoredTransactions(),
  render: () => renderGraph(),
  chrome: pageStands,
  loaded: async () => { await waitFor(() => expect(transferRows()).toHaveLength(2)); },
  failed: async () => { await screen.findByText(OUTAGE_TEXT); },
  loading: () => screen.getByRole('img', { name: `Transakcijų srauto grafikas, ${TODAY}: 0 pervedimai` }),
});







// -----------------------------------------------------------
// Malformed answers beyond the matrix
// -----------------------------------------------------------
//
// Shapes the matrix does not produce but a backend or a proxy
// can: what the page does with each, and the defects pinned.
// -----------------------------------------------------------

describe('Malformed answers beyond the matrix', () => {

  it('a network list that hangs does not hold the graph back — it is drawn with ETH meanwhile', async () => {
    given.hang('get', '/api/evm/networks');
    renderScene();
    await bootedNetwork({ transfers: 3 });
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų srautas — sepolia' })).toBeInTheDocument();
    expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 ETH (1 tx)']);
  });


  it('a stored-transactions JSON null is an outage: the faucet alone under the notice', async () => {
    given.json('get', '/api/evm/:network/get-stored-transactions', null);
    renderGraph();
    const network = await bootedNetwork({ transfers: 0 });
    expect(await screen.findByText(OUTAGE_TEXT)).toBeInTheDocument();
    expect(network.nodes().map((node) => node.id)).toEqual([ADDR.FAUCET]);
  });


  it.fails('a 200 that is no transfer list (a captive portal\'s page, an emptied object) is an outage the next sweep recovers from — PINNED KNOWN BUG: fetchTransactions returns data.transactions unchecked, boot throws on undefined.forEach, so no graph is built, no notice is shown and no sweep ever runs again', async () => {
    const calls = given.capture('get', '/api/evm/:network/get-stored-transactions', () => (calls.length > 1 ? f.evmStoredTransactions() : {}));
    renderGraph();
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(100);
    // The outage is told, over the faucet alone …
    expect(screen.queryByText(OUTAGE_TEXT)).not.toBeNull();
    expect(liveNetwork()).toBeTruthy();
    // … and the next live sweep brings the day in
    await advance(1_000);
    await waitFor(() => expect(transferRows()).toHaveLength(2));
  });


  it('what that malformed answer does today: an empty canvas, no notice, no Network, nothing asked again', async () => {
    const calls = given.capture('get', '/api/evm/:network/get-stored-transactions', {});
    const logged = vi.spyOn(console, 'error');
    renderGraph();
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(100);
    await advance(20_000);
    expectNoCrash();
    expect(networks).toHaveLength(0);
    expect(screen.queryByText(OUTAGE_TEXT)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(logged).toHaveBeenCalledWith('Graph boot failed:', expect.any(TypeError));
  });


  it.fails('one malformed answer during the boot sweep does not end the live refresh — PINNED KNOWN BUG: the boot sweep\'s merge throws on undefined.forEach, boot() rejects before scheduler.start(), and today\'s graph is never swept again', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    backend.answerOnce(ADDR.JONAS, { error: null });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    const asked = backend.requests.length;
    await advance(2_000);
    expect(backend.requests.length).toBeGreaterThan(asked);
  });


  it('a malformed answer in a later live sweep is logged, and the sweeps go on — one throw never ends the live refresh', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const logged = vi.spyOn(console, 'error');
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(backend.requests).toHaveLength(4));

    backend.answerOnce(ADDR.EGLE, { error: null });
    await advance(1_000);
    await waitFor(() => expect(logged).toHaveBeenCalledWith('Sweep failed:', expect.any(TypeError)));
    const asked = backend.requests.length;
    await advance(1_000);
    await waitFor(() => expect(backend.requests.length).toBeGreaterThan(asked));
    expect(network.nodes()).toHaveLength(3);
    expect(liveNetwork()).toBe(network);
  });


  it.fails('a transfer value that arrives as a string ("0.2") is drawn, not crashed on — PINNED KNOWN BUG: formatTransactionLabel calls value.toFixed; boot dies silently, and when the network list answers after it the currency relabel effect throws and the page crashes', async () => {
    given.slow('get', '/api/evm/networks', 300, f.evmNetworks);
    const calls = given.capture('get', '/api/evm/:network/get-stored-transactions', {
      transactions: f.evmStoredTransactions().transactions.map((row) => ({ ...row, value: String(row.value) })),
    });
    renderGraph();
    await waitFor(() => expect(calls).toHaveLength(1));
    // The network list lands after the day's answer
    await advance(400);
    await settle(100);
    expectNoCrash();
    await waitFor(() => expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 SepETH (1 tx)']));
  });


  it.fails('a day list that is not a list of { day } entries leaves the page standing — PINNED KNOWN BUG: GraphPage maps daysData.days unchecked during render, so { days: { "2026-09-29": 2 } } throws ".map is not a function" and takes the whole page down', async () => {
    const calls = given.capture('get', '/api/evm/:network/transaction-days', { days: { '2026-09-29': 2 } });
    renderScene();
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(100);
    expectNoCrash();
    expect(dayPicker()).toHaveValue('2026-09-30 (šiandien)');
  });
});

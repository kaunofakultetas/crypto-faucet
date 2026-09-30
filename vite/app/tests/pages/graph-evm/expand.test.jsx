// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: expanding an address
//
//  Double-clicking a node pulls that address's own transfers
//  of the viewed day in (GET …/get-stored-transactions for
//  that address and the day's window) and draws what is new
//  one level below it, leaving everything already drawn where
//  it stands. A past day is where this matters most — no live
//  sweep will ever refresh it — so the tests view 2026-09-29
//  and let the backend learn about a transfer after the boot
//  (it indexes late). Contracts and public hubs are never
//  expanded, a double-click on empty canvas does nothing, a
//  failed expansion raises the outage notice, and double-
//  clicking the faucet is how a failed past day is retried.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { settle } from '../../support/backend/contract';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, renderGraph, bootedNetwork, transferRows, outageNotice,
  OUTAGE_TEXT, dayPicker, at, ADDR, NAMES, WINDOW,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());


const DAY = '2026-09-29';

// The faucet's traffic on the viewed past day, and the cast's
// extra rows
const PAST_TRANSFERS = [
  { from: ADDR.FAUCET, to: ADDR.JONAS, value: 0.2, at: at(10, 0, DAY) },
  { from: ADDR.FAUCET, to: ADDR.EGLE, value: 0.2, at: at(10, 30, DAY) },
];

const CONTRACTS_AND_HUBS = {
  [ADDR.LINK]: { name: 'LINK token', contract: true, hub: false },
  [ADDR.HUB]: { name: 'Sepolia PoW faucet', contract: false, hub: true },
};







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// openPastDay renders the page, switches to 2026-09-29 and
// waits for its graph and its boot sweep; asksSince counts the
// requests about one address after a mark.
// -----------------------------------------------------------

async function openPastDay(backend, { transfers } = {}) {
  const view = renderGraph();
  await bootedNetwork();
  await view.user.click(dayPicker());
  await view.user.click(await screen.findByRole('option', { name: DAY }));
  await waitFor(() => expect(backend.requests.at(-1)).toMatchObject(WINDOW[DAY]));
  const network = await bootedNetwork({ transfers });
  await settle(100);
  return { ...view, network };
}

const asksSince = (backend, mark, address) => backend.requests.slice(mark).filter((request) => request.address === address);







// -----------------------------------------------------------
// Double-click
// -----------------------------------------------------------
//
// What a double-click on a node asks and draws.
// -----------------------------------------------------------

describe('Double-click', () => {

  it('asks about the double-clicked address for the viewed day and draws what is new one level below it', async () => {
    const backend = installGraphBackend({ transfers: PAST_TRANSFERS, addresses: NAMES });
    const { network } = await openPastDay(backend, { transfers: 2 });
    expect(network.node(ADDR.PETRAS)).toBeNull();

    // The backend indexes one more of Jonas's transfers
    backend.transfers.push({ from: ADDR.JONAS, to: ADDR.PETRAS, value: 0.05, at: at(11, 0, DAY) });
    const mark = backend.requests.length;
    await network.doubleClick(ADDR.JONAS);

    await waitFor(() => expect(network.node(ADDR.PETRAS)).toMatchObject({ x: 150, y: 550 }));
    expect(asksSince(backend, mark, ADDR.JONAS)).toEqual([expect.objectContaining({ network: 'sepolia', ...WINDOW[DAY] })]);
    expect(backend.requests).toHaveLength(mark + 1);
    expect(transferRows()).toContainEqual(['Jonas', '0x9a8b...7263', '0.0500 SepETH (1 tx)']);
  });


  it('leaves everything already drawn exactly where it stands', async () => {
    const backend = installGraphBackend({ transfers: PAST_TRANSFERS, addresses: NAMES });
    const { network } = await openPastDay(backend, { transfers: 2 });
    const before = network.nodes().map(({ id, x, y }) => ({ id, x, y }));

    backend.transfers.push({ from: ADDR.EGLE, to: ADDR.PETRAS, value: 0.1, at: at(11, 0, DAY) });
    await network.doubleClick(ADDR.EGLE);
    await waitFor(() => expect(network.nodes()).toHaveLength(4));
    expect(network.nodes().slice(0, 3).map(({ id, x, y }) => ({ id, x, y }))).toEqual(before);
  });


  it('double-clicking the faucet refreshes the root\'s own transfers', async () => {
    const backend = installGraphBackend({ transfers: PAST_TRANSFERS, addresses: NAMES });
    const { network } = await openPastDay(backend, { transfers: 2 });
    backend.transfers.push({ from: ADDR.FAUCET, to: ADDR.RUTA, value: 0.2, at: at(23, 0, DAY) });
    const mark = backend.requests.length;

    await network.doubleClick(ADDR.FAUCET);
    await waitFor(() => expect(network.node(ADDR.RUTA)).toMatchObject({ x: 450, y: 275 }));
    expect(asksSince(backend, mark, ADDR.FAUCET)).toHaveLength(1);
  });


  it('an address with nothing new is asked once and nothing changes', async () => {
    const backend = installGraphBackend({ transfers: PAST_TRANSFERS, addresses: NAMES });
    const { network } = await openPastDay(backend, { transfers: 2 });
    const mark = backend.requests.length;
    await network.doubleClick(ADDR.EGLE);
    await waitFor(() => expect(asksSince(backend, mark, ADDR.EGLE)).toHaveLength(1));
    await settle(100);
    expect(network.nodes()).toHaveLength(3);
    expect(transferRows()).toHaveLength(2);
  });


  it('never expands a contract — its history is the whole testnet\'s', async () => {
    const backend = installGraphBackend({
      transfers: [...PAST_TRANSFERS, { from: ADDR.JONAS, to: ADDR.LINK, value: 0, at: at(11, 0, DAY) }],
      addresses: { ...NAMES, ...CONTRACTS_AND_HUBS },
    });
    const { network } = await openPastDay(backend, { transfers: 3 });
    const mark = backend.requests.length;
    await network.doubleClick(ADDR.LINK);
    await settle(100);
    expect(backend.requests).toHaveLength(mark);
  });


  it('never expands a public hub either', async () => {
    const backend = installGraphBackend({
      transfers: [...PAST_TRANSFERS, { from: ADDR.HUB, to: ADDR.EGLE, value: 1, at: at(11, 0, DAY) }],
      addresses: { ...NAMES, ...CONTRACTS_AND_HUBS },
    });
    const { network } = await openPastDay(backend, { transfers: 3 });
    const mark = backend.requests.length;
    await network.doubleClick(ADDR.HUB);
    await settle(100);
    expect(backend.requests).toHaveLength(mark);
  });


  it('a double-click on empty canvas does nothing', async () => {
    const backend = installGraphBackend({ transfers: PAST_TRANSFERS, addresses: NAMES });
    const { network } = await openPastDay(backend, { transfers: 2 });
    const mark = backend.requests.length;
    await network.doubleClick(undefined);
    await settle(100);
    expect(backend.requests).toHaveLength(mark);
    expect(network.nodes()).toHaveLength(3);
  });
});







// -----------------------------------------------------------
// When the expansion fails
// -----------------------------------------------------------
//
// A failed expansion is an outage like any other; on a past
// day it is also the way to retry one.
// -----------------------------------------------------------

describe('When the expansion fails', () => {

  it('a failed expansion shows the outage notice and keeps the graph', async () => {
    const backend = installGraphBackend({ transfers: PAST_TRANSFERS, addresses: NAMES });
    const { network } = await openPastDay(backend, { transfers: 2 });
    backend.outage = true;
    await network.doubleClick(ADDR.JONAS);
    expect(await screen.findByText(OUTAGE_TEXT)).toBeInTheDocument();
    expect(network.nodes()).toHaveLength(3);
    expect(transferRows()).toHaveLength(2);
  });


  it('double-clicking the faucet retries a past day that failed — the day fills in, the notice goes', async () => {
    const backend = installGraphBackend({ transfers: PAST_TRANSFERS, addresses: NAMES });
    const view = renderGraph();
    await bootedNetwork();
    await view.user.click(dayPicker());
    const option = await screen.findByRole('option', { name: DAY });
    backend.outage = true;
    await view.user.click(option);
    await waitFor(() => expect(backend.requests.at(-1)).toMatchObject(WINDOW[DAY]));
    const network = await bootedNetwork({ transfers: 0 });
    expect(await screen.findByText(OUTAGE_TEXT)).toBeInTheDocument();

    backend.outage = false;
    await network.doubleClick(ADDR.FAUCET);
    await waitFor(() => expect(transferRows()).toHaveLength(2));
    expect(outageNotice()).toBeNull();
  });
});

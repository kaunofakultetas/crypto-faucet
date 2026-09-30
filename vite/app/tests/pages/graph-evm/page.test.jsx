// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: the page shell
//
//  The /graph/:network page before and around the graph: the
//  faucet address from /api/evm/<network>/faucet-balance as
//  the graph's root (the address every later request is
//  about), the states the page shows instead of a graph —
//  "Kraunama…" while the address loads, "Nepavyko gauti
//  čiaupo adreso" when it fails (an unknown network too),
//  "Adresas nerastas" for an answer without one, and the
//  one-line notice for a network without an explorer section
//  (has_explorer: false, whatever the other answers do) — the
//  visually hidden page heading with the network's full name,
//  the native currency of the edge labels from
//  /api/evm/networks (the ETH placeholder when the list is
//  missing, relabelled in place when it arrives late), and the
//  real App's route and tab title.
//
//  vis-network is replaced by the double in
//  tests/support/graph-evm/vis-network.js; the stored
//  transactions come from the backend model in backend.js.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderApp, makeQueryClient } from '../../support/render';
import { given } from '../../support/backend/server';
import { settle } from '../../support/backend/contract';
import * as f from '../../support/backend/fixtures';
import { networks, liveNetwork } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, renderGraph, bootedNetwork, canvas, transferRows,
  ADDR, NAMES, DAY_TRANSFERS, TODAY,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());


const LOADING = 'Kraunama…';
const NO_ADDRESS = 'Nepavyko gauti čiaupo adreso';
const ADDRESS_MISSING = 'Adresas nerastas';
const NO_EXPLORER = 'Šiam tinklui transakcijų srautas neprieinamas';







// -----------------------------------------------------------
// The faucet address — the graph's root
// -----------------------------------------------------------
//
// Everything the graph asks for is about the address the
// faucet-balance answer names: the day list, the first
// stored-transactions request, the root node.
// -----------------------------------------------------------

describe('The faucet address — the graph\'s root', () => {

  it('roots the graph at the faucet address: its own transfers are asked first and it is drawn as the faucet', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });

    expect(backend.requests[0]).toMatchObject({ network: 'sepolia', address: ADDR.FAUCET });
    expect(network.node(ADDR.FAUCET)).toMatchObject({ image: '/img/faucet.png', x: 0, y: 0 });
    expect(canvas()).toHaveAccessibleName(`Transakcijų srauto grafikas, ${TODAY}: 3 pervedimai`);
  });


  it('follows whatever address the backend names — another faucet wallet roots another graph', async () => {
    given.json('get', '/api/evm/:network/faucet-balance', { ...f.evmBalance(), address: ADDR.RUTA });
    const days = given.capture('get', '/api/evm/:network/transaction-days', { days: [] });
    const backend = installGraphBackend({ transfers: [{ from: ADDR.RUTA, to: ADDR.JONAS, value: 0.5, at: DAY_TRANSFERS[0].at }], addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 1 });

    expect(backend.requests[0].address).toBe(ADDR.RUTA);
    await waitFor(() => expect(days).toHaveLength(1));
    expect(days[0].query.address).toBe(ADDR.RUTA);
    expect(network.node(ADDR.RUTA).image).toBe('/img/faucet.png');
    expect(network.node(ADDR.FAUCET)).toBeNull();
  });


  it('coming from the faucet page, the address and the network list are already known — neither is asked again', async () => {
    const balance = given.capture('get', '/api/evm/:network/faucet-balance', f.evmBalance());
    const list = given.capture('get', '/api/evm/networks', f.evmNetworks);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    // The faucet page's answers, in the cache entries both pages
    // share
    const client = makeQueryClient({ gcTime: Infinity });
    client.setQueryData(['evm-faucet-balance', 'sepolia'], f.evmBalance());
    client.setQueryData(['evm-networks'], f.evmNetworks);
    renderGraph({ client });
    expect(screen.queryByText(LOADING)).toBeNull();
    await bootedNetwork({ transfers: 3 });
    expect(balance).toHaveLength(0);
    expect(list).toHaveLength(0);
  });


  it('asks for the day list only once the address is known', async () => {
    given.hang('get', '/api/evm/:network/faucet-balance');
    const days = given.capture('get', '/api/evm/:network/transaction-days', f.evmTransactionDays());
    renderGraph();
    expect(await screen.findByText(LOADING)).toBeInTheDocument();
    await settle(100);
    expect(days).toHaveLength(0);
    expect(networks).toHaveLength(0);
  });
});







// -----------------------------------------------------------
// The states instead of a graph
// -----------------------------------------------------------
//
// Loading, a failed or unknown network, an answer without an
// address, a network without an explorer — each a single
// centred line, no graph, no graph requests.
// -----------------------------------------------------------

describe('The states instead of a graph', () => {

  it('says "Kraunama…" while the faucet address is on its way, and builds no graph', async () => {
    given.hang('get', '/api/evm/:network/faucet-balance');
    const backend = installGraphBackend();
    renderGraph();
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    await settle(100);
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(backend.requests).toHaveLength(0);
  });


  it('shows "Nepavyko gauti čiaupo adreso" when the faucet-balance request fails, with no graph and no graph requests', async () => {
    given.error('get', '/api/evm/:network/faucet-balance', 'Vidinė serverio klaida', 500);
    const days = given.capture('get', '/api/evm/:network/transaction-days', f.evmTransactionDays());
    const backend = installGraphBackend();
    renderGraph();
    expect(await screen.findByText(NO_ADDRESS)).toBeInTheDocument();
    await settle(100);
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Data' })).toBeNull();
    expect(days).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
  });


  it('an unknown network in the URL is the same failure — the backend refuses its faucet balance', async () => {
    renderGraph({ network: 'noSuchNet' });
    expect(await screen.findByText(NO_ADDRESS)).toBeInTheDocument();
    expect(networks).toHaveLength(0);
  });


  it('a dropped connection on the faucet balance is the same failure', async () => {
    given.networkError('get', '/api/evm/:network/faucet-balance');
    renderGraph();
    expect(await screen.findByText(NO_ADDRESS)).toBeInTheDocument();
  });


  it('says "Adresas nerastas" when the faucet-balance answer names no address', async () => {
    given.json('get', '/api/evm/:network/faucet-balance', { balance: 41.6, chunk_size: 0.2 });
    const backend = installGraphBackend();
    renderGraph();
    expect(await screen.findByText(ADDRESS_MISSING)).toBeInTheDocument();
    await settle(100);
    expect(networks).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
  });


  it('an empty address string counts as no address', async () => {
    given.json('get', '/api/evm/:network/faucet-balance', { ...f.evmBalance(), address: '' });
    renderGraph();
    expect(await screen.findByText(ADDRESS_MISSING)).toBeInTheDocument();
  });


  it(`a network without an explorer section shows "${NO_EXPLORER}" and never starts a graph`, async () => {
    // The balance answers after the network list, so the page
    // knows about the missing explorer before it has an address
    given.slow('get', '/api/evm/:network/faucet-balance', 200, f.evmBalance());
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph({ network: 'arbitrumSepolia' });
    expect(await screen.findByText(NO_EXPLORER)).toBeInTheDocument();
    await settle(400);
    expect(screen.getByText(NO_EXPLORER)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Data' })).toBeNull();
    expect(networks).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
  });


  it('the explorer notice wins over a failed faucet balance too', async () => {
    given.slow('get', '/api/evm/:network/faucet-balance', 200, { error: 'Vidinė serverio klaida' }, { status: 500 });
    renderGraph({ network: 'arbitrumSepolia' });
    expect(await screen.findByText(NO_EXPLORER)).toBeInTheDocument();
    await settle(400);
    expect(screen.queryByText(NO_ADDRESS)).toBeNull();
  });


  it('a network list that reveals the missing explorer only after the graph started replaces the graph with the notice and tears it down', async () => {
    given.slow('get', '/api/evm/networks', 400, f.evmNetworks);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph({ network: 'arbitrumSepolia' });
    const network = await bootedNetwork();
    expect(await screen.findByText(NO_EXPLORER)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(network.destroyed).toBe(true);
    expect(liveNetwork()).toBeUndefined();
  });


  it('has_explorer missing from the entry is not "false" — the graph is shown', async () => {
    const withoutFlag = structuredClone(f.evmNetworks);
    delete withoutFlag.networks.sepolia.has_explorer;
    given.json('get', '/api/evm/networks', withoutFlag);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    expect(screen.queryByText(NO_EXPLORER)).toBeNull();
  });
});







// -----------------------------------------------------------
// The network's name and currency
// -----------------------------------------------------------
//
// /api/evm/networks gives the page its heading (the network's
// full name, the URL key without it) and the native currency
// symbol of every edge label ('ETH' until it is known).
// -----------------------------------------------------------

describe('The network\'s name and currency', () => {

  it('names the page after the network\'s full name in a visually hidden heading', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    expect(await screen.findByRole('heading', { level: 1, name: 'Transakcijų srautas — Ethereum Sepolia' })).toBeInTheDocument();
  });


  it('labels every transfer in the network\'s own currency — SepETH on Sepolia', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(network.edge(`${ADDR.FAUCET}-${ADDR.JONAS}`).label).toBe('0.2000 SepETH\n(1 tx)'));
    expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 SepETH (1 tx)']);
  });


  it('another network, another symbol — Hoodi\'s ETH', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph({ network: 'hoodi' });
    const network = await bootedNetwork({ transfers: 3 });
    expect(await screen.findByRole('heading', { level: 1, name: 'Transakcijų srautas — Ethereum Hoodi' })).toBeInTheDocument();
    expect(network.edge(`${ADDR.FAUCET}-${ADDR.JONAS}`).label).toBe('0.2000 ETH\n(1 tx)');
  });


  it('without the network list the heading falls back to the URL key and the labels to ETH — the graph itself still works', async () => {
    given.error('get', '/api/evm/networks', 'Vidinė serverio klaida', 500);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų srautas — sepolia' })).toBeInTheDocument();
    expect(network.edge(`${ADDR.FAUCET}-${ADDR.JONAS}`).label).toBe('0.2000 ETH\n(1 tx)');
    expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 ETH (1 tx)']);
  });


  it('a network list that lands after the graph was drawn relabels the edges in place — the same Network, nothing rebuilt', async () => {
    given.slow('get', '/api/evm/networks', 500, f.evmNetworks);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(network.edge(`${ADDR.FAUCET}-${ADDR.JONAS}`).label).toBe('0.2000 ETH\n(1 tx)');
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų srautas — sepolia' })).toBeInTheDocument();

    await waitFor(() => expect(network.edge(`${ADDR.FAUCET}-${ADDR.JONAS}`).label).toBe('0.2000 SepETH\n(1 tx)'));
    expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 SepETH (1 tx)']);
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų srautas — Ethereum Sepolia' })).toBeInTheDocument();
    expect(networks).toHaveLength(1);
    expect(network.destroyed).toBe(false);
  });
});







// -----------------------------------------------------------
// The route in the real App
// -----------------------------------------------------------
//
// /graph/:network mounts this page under the app's shell and
// titles the tab.
// -----------------------------------------------------------

describe('The route in the real App', () => {

  it('/graph/sepolia shows the graph and titles the tab "Transakcijų srautas"', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderApp({ route: '/graph/sepolia' });
    await bootedNetwork({ transfers: 3 });
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų srautas — Ethereum Sepolia' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Transakcijų srautas — VU KNF Faucet'as"));
  });
});

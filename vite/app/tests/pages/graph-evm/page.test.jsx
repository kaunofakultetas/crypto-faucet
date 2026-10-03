// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: the page shell
//
//  The /graph/:network page before and around the graph: the
//  faucet address from this network's entry in
//  /api/evm/networks (faucet_address, checksummed there and
//  lowercased for the graph) as the graph's root — the address
//  every later request is about — with NO request for the
//  faucet's balance at all, so a balance read failing on its
//  RPC never touches the page; the states the page shows
//  instead of a graph — "Kraunama…" while the list loads, and
//  what went wrong when it cannot be used: the backend's own
//  sentence, or "Nepavyko gauti tinklų sąrašo." with the
//  reason after it (a dropped connection, an answer that is
//  no list), the faucet having no such EVM network for a
//  :network the list does not know, "Nepavyko gauti čiaupo
//  adreso." for an entry without the address, and the
//  one-line notice for a network without an explorer section
//  (has_explorer false, which wins over the rest) — the
//  visually hidden page heading with the network's full name,
//  the native currency of the edge labels from the same entry
//  (relabelled in place when a refreshed list brings another),
//  and the real App's route and tab title.
//
//  vis-network is replaced by the double in
//  tests/support/graph-evm/vis-network.js; the stored
//  transactions come from the backend model in backend.js.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { renderApp, makeQueryClient } from '../../support/render';
import { given } from '../../support/backend/server';
import { settle } from '../../support/backend/contract';
import * as f from '../../support/backend/fixtures';
import { networks, liveNetwork } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, renderGraph, bootedNetwork, canvas, transferRows, dayPicker,
  ADDR, NAMES, DAY_TRANSFERS, TODAY,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());


// What the page says while the network list is on its way
const LOADING = 'Kraunama…';

// The one-line notice of a network without an explorer section
const NO_EXPLORER = 'Šiam tinklui transakcijų srautas neprieinamas';

// The page's sentence for a network list it could not get,
// with a dropped connection's reason after it
const LIST_DROPPED = 'Nepavyko gauti tinklų sąrašo. Patikrinkite interneto ryšį.';

// The same sentence with the reason of an answer that is no
// network list
const LIST_MALFORMED = 'Nepavyko gauti tinklų sąrašo. Serveris atsakė netinkamo formato duomenimis.';

// The page's sentence for an entry that names no faucet
// address, with the malformed answer's reason after it
const NO_ADDRESS_IN_ENTRY = 'Nepavyko gauti čiaupo adreso. Serveris atsakė netinkamo formato duomenimis.';

// The page's sentence for an entry whose address is null — the
// backend's way of saying it has no usable faucet key
const NO_FAUCET_KEY = 'Čiaupo adresas nesukonfigūruotas: serveryje nenustatytas arba netinkamas čiaupo raktas. Praneškite dėstytojui.';

// Ruta's address the way the list would name it — checksummed
const RUTA_CHECKSUMMED = '0x1C2d3e4f5A6b7c8d9e0F1A2B3c4d5e6F7A8b9c0D';







// -----------------------------------------------------------
// noSuchNetwork
// -----------------------------------------------------------
//
// What the page says for a :network the list does not know:
// that the faucet has no such EVM network, then to check the
// link that led there.
// -----------------------------------------------------------

function noSuchNetwork(network) {
  return `Čiaupas neturi EVM tinklo „${network}“. Patikrinkite nuorodą.`;
}







// -----------------------------------------------------------
// withSepolia
// -----------------------------------------------------------
//
// The network list with its Sepolia entry changed by the
// test — a copy, so the shared fixture stays as it is.
// -----------------------------------------------------------

function withSepolia(change) {
  const list = structuredClone(f.evmNetworks);
  change(list.networks.sepolia);
  return list;
}







// -----------------------------------------------------------
// balanceReads
// -----------------------------------------------------------
//
// Every request for the faucet's balance, answered as the
// backend would — though the page must never make one, and
// the tests assert the list stays empty.
// -----------------------------------------------------------

function balanceReads() {
  return given.capture('get', '/api/evm/:network/faucet-balance', f.evmBalance());
}







// -----------------------------------------------------------
// The faucet address — the graph's root
// -----------------------------------------------------------
//
// Everything the graph asks for is about the address this
// network's entry in the network list names: the day list,
// the first stored-transactions request, the root node. The
// faucet's balance is never asked for.
// -----------------------------------------------------------

describe('The faucet address — the graph\'s root', () => {

  it('roots the graph at the address the network list names: its own transfers are asked first, it is drawn as the faucet, its balance never asked', async () => {
    const balance = balanceReads();
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });

    expect(backend.requests[0]).toMatchObject({ network: 'sepolia', address: ADDR.FAUCET });
    expect(network.node(ADDR.FAUCET)).toMatchObject({ image: '/img/faucet.png', x: 0, y: 0 });
    // One faucet node: the checksummed address is the flows'
    // lowercase one, not a second node beside it
    expect(network.nodes().map((node) => node.id)).toEqual([ADDR.FAUCET, ADDR.JONAS, ADDR.EGLE]);
    expect(canvas()).toHaveAccessibleName(`Transakcijų srauto grafikas, ${TODAY}: 3 pervedimai`);
    expect(balance).toHaveLength(0);
  });


  it('follows whatever address the list names — another faucet wallet roots another graph, lowercased like the flows', async () => {
    given.json('get', '/api/evm/networks', withSepolia((entry) => { entry.faucet_address = RUTA_CHECKSUMMED; }));
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


  it('coming from the faucet page, the network list is already known — it is not asked again, and the balance never is', async () => {
    const balance = balanceReads();
    const list = given.capture('get', '/api/evm/networks', f.evmNetworks);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    // The faucet page's answer, in the cache entry both pages share
    const client = makeQueryClient({ gcTime: Infinity });
    client.setQueryData(['evm-networks'], f.evmNetworks);
    renderGraph({ client });
    expect(screen.queryByText(LOADING)).toBeNull();
    await bootedNetwork({ transfers: 3 });
    expect(balance).toHaveLength(0);
    expect(list).toHaveLength(0);
  });


  it('asks for the day list only once the address is known', async () => {
    given.hang('get', '/api/evm/networks');
    const days = given.capture('get', '/api/evm/:network/transaction-days', f.evmTransactionDays());
    renderGraph();
    expect(await screen.findByText(LOADING)).toBeInTheDocument();
    await settle(100);
    expect(days).toHaveLength(0);
    expect(networks).toHaveLength(0);
  });
});







// -----------------------------------------------------------
// A faucet whose RPC is down
// -----------------------------------------------------------
//
// The balance read is the one that needs the network's RPC —
// and the page never makes it, so however it would fail, the
// graph is drawn as usual.
// -----------------------------------------------------------

describe('A faucet whose RPC is down', () => {

  it.each([
    ['answers the RPC timeout\'s sentence', () => HttpResponse.json({ error: 'Nepavyko gauti čiaupo balanso: tinklo RPC serveris neatsakė per 10 s.' }, { status: 500 })],
    ['drops the connection', () => HttpResponse.error()],
  ])('a faucet balance that %s does not touch the page — the graph is drawn, the balance never asked', async (_, answer) => {
    const balance = given.capture('get', '/api/evm/:network/faucet-balance', () => answer());
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await settle(100);

    expect(dayPicker()).toBeInTheDocument();
    expect(screen.queryByText(/^Nepavyko gauti čiaupo balanso/)).toBeNull();
    expect(balance).toHaveLength(0);
  });
});







// -----------------------------------------------------------
// The states instead of a graph
// -----------------------------------------------------------
//
// Loading, a list that failed or is none — said in the
// backend's words or with the reason — a network the list
// does not know, an entry without the faucet's address, a
// network without an explorer: each a single centred line,
// no graph, no graph requests.
// -----------------------------------------------------------

describe('The states instead of a graph', () => {

  it('says "Kraunama…" while the network list is on its way, and builds no graph', async () => {
    given.hang('get', '/api/evm/networks');
    const backend = installGraphBackend();
    renderGraph();
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    await settle(100);
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(backend.requests).toHaveLength(0);
  });


  it('shows the backend\'s own sentence when the network list fails, with no graph and no graph requests', async () => {
    given.error('get', '/api/evm/networks', 'Vidinė serverio klaida', 500);
    const days = given.capture('get', '/api/evm/:network/transaction-days', f.evmTransactionDays());
    const backend = installGraphBackend();
    renderGraph();
    expect(await screen.findByText('Vidinė serverio klaida')).toBeInTheDocument();
    await settle(100);
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Data' })).toBeNull();
    expect(days).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
  });


  it('a dropped connection on the network list: the page\'s sentence with the reason after it', async () => {
    given.networkError('get', '/api/evm/networks');
    renderGraph();
    expect(await screen.findByText(LIST_DROPPED)).toBeInTheDocument();
  });


  it.each([
    ['an empty object', {}],
    ['a list', []],
    ['a string', 'netikėtas atsakymas'],
    ['the networks as a list', { default_network: 'sepolia', networks: [] }],
    ['the networks as null', { default_network: 'sepolia', networks: null }],
  ])('a network list that is no list — %s — is a malformed answer', async (_, body) => {
    given.json('get', '/api/evm/networks', body);
    const backend = installGraphBackend();
    renderGraph();
    expect(await screen.findByText(LIST_MALFORMED)).toBeInTheDocument();
    await settle(100);
    expect(networks).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
  });


  it('an unusable list already in the shared cache is the same malformed answer — and nothing is asked', async () => {
    const list = given.capture('get', '/api/evm/networks', f.evmNetworks);
    const client = makeQueryClient({ gcTime: Infinity });
    client.setQueryData(['evm-networks'], { default_network: 'sepolia' });
    renderGraph({ client });
    expect(await screen.findByText(LIST_MALFORMED)).toBeInTheDocument();
    await settle(100);
    expect(list).toHaveLength(0);
    expect(networks).toHaveLength(0);
  });


  it.each([
    ['noSuchNet'],
    // A property every object inherits is no network either
    ['constructor'],
  ])('a network the list does not know — %s — is said to be none of the faucet\'s', async (key) => {
    const balance = balanceReads();
    const backend = installGraphBackend();
    renderGraph({ network: key });
    expect(await screen.findByText(noSuchNetwork(key))).toBeInTheDocument();
    await settle(100);
    expect(networks).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
    expect(balance).toHaveLength(0);
  });


  it.each([
    ['no faucet_address', (entry) => { delete entry.faucet_address; }],
    ['an empty one', (entry) => { entry.faucet_address = ''; }],
    ['a number', (entry) => { entry.faucet_address = 12345; }],
  ])('an entry with %s is a malformed answer — no graph, no graph requests', async (_, change) => {
    given.json('get', '/api/evm/networks', withSepolia(change));
    const backend = installGraphBackend();
    renderGraph();
    expect(await screen.findByText(NO_ADDRESS_IN_ENTRY)).toBeInTheDocument();
    await settle(100);
    expect(networks).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
  });


  it('an entry whose address is null says the backend has no faucet key — no graph, no graph requests', async () => {
    given.json('get', '/api/evm/networks', withSepolia((entry) => { entry.faucet_address = null; }));
    const backend = installGraphBackend();
    renderGraph();
    expect(await screen.findByText(NO_FAUCET_KEY)).toBeInTheDocument();
    expect(screen.queryByText(NO_ADDRESS_IN_ENTRY)).toBeNull();
    await settle(100);
    expect(networks).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
  });


  it(`a network without an explorer section shows "${NO_EXPLORER}" and never starts a graph`, async () => {
    const balance = balanceReads();
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph({ network: 'arbitrumSepolia' });
    expect(await screen.findByText(NO_EXPLORER)).toBeInTheDocument();
    await settle(100);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Data' })).toBeNull();
    expect(networks).toHaveLength(0);
    expect(backend.requests).toHaveLength(0);
    expect(balance).toHaveLength(0);
  });


  it('the explorer notice wins over an entry without the faucet\'s address too', async () => {
    const list = structuredClone(f.evmNetworks);
    delete list.networks.arbitrumSepolia.faucet_address;
    given.json('get', '/api/evm/networks', list);
    renderGraph({ network: 'arbitrumSepolia' });
    expect(await screen.findByText(NO_EXPLORER)).toBeInTheDocument();
    expect(screen.queryByText(NO_ADDRESS_IN_ENTRY)).toBeNull();
  });


  it('a slow network list holds the page at "Kraunama…" — a network without an explorer then shows its notice, no graph ever built', async () => {
    given.slow('get', '/api/evm/networks', 400, f.evmNetworks);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph({ network: 'arbitrumSepolia' });
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    expect(await screen.findByText(NO_EXPLORER)).toBeInTheDocument();
    await settle(100);
    expect(networks).toHaveLength(0);
    expect(liveNetwork()).toBeUndefined();
  });


  it('has_explorer missing from the entry is not "false" — the graph is shown', async () => {
    given.json('get', '/api/evm/networks', withSepolia((entry) => { delete entry.has_explorer; }));
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
// The same entry gives the page its heading (the network's
// full name, the URL key without it) and the native currency
// symbol of every edge label — known before the graph is
// drawn, as the graph waits for the list that names its root.
// -----------------------------------------------------------

describe('The network\'s name and currency', () => {

  it('names the page after the network\'s full name in a visually hidden heading', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    expect(await screen.findByRole('heading', { level: 1, name: 'Transakcijų srautas — Ethereum Sepolia' })).toBeInTheDocument();
  });


  it('a network without a full name is headed by its URL key', async () => {
    given.json('get', '/api/evm/networks', withSepolia((entry) => { delete entry.full_name; }));
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų srautas — sepolia' })).toBeInTheDocument();
  });


  it('labels every transfer in the network\'s own currency from the first drawing — SepETH on Sepolia', async () => {
    given.slow('get', '/api/evm/networks', 300, f.evmNetworks);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(network.edge(`${ADDR.FAUCET}-${ADDR.JONAS}`).label).toBe('0.2000 SepETH\n(1 tx)');
    expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 SepETH (1 tx)']);
  });


  it('another network, another symbol — Hoodi\'s ETH', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph({ network: 'hoodi' });
    const network = await bootedNetwork({ transfers: 3 });
    expect(await screen.findByRole('heading', { level: 1, name: 'Transakcijų srautas — Ethereum Hoodi' })).toBeInTheDocument();
    expect(network.edge(`${ADDR.FAUCET}-${ADDR.JONAS}`).label).toBe('0.2000 ETH\n(1 tx)');
  });


  it('a refreshed list that brings another currency relabels the edges in place — the same Network, nothing rebuilt', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const client = makeQueryClient({ gcTime: Infinity });
    renderGraph({ client });
    const network = await bootedNetwork({ transfers: 3 });
    expect(network.edge(`${ADDR.FAUCET}-${ADDR.JONAS}`).label).toBe('0.2000 SepETH\n(1 tx)');

    await act(async () => {
      client.setQueryData(['evm-networks'], withSepolia((entry) => { entry.native_currency.symbol = 'tETH'; }));
    });

    await waitFor(() => expect(network.edge(`${ADDR.FAUCET}-${ADDR.JONAS}`).label).toBe('0.2000 tETH\n(1 tx)'));
    expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 tETH (1 tx)']);
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

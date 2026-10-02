// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: what is drawn
//
//  The stored transactions of the viewed day turned into the
//  picture vis-network is handed (the double records it): the
//  container and the options that keep vis from moving
//  anything (no layout engine, no physics, nodes dragged only
//  sideways, keyboard bound to the canvas), one node per
//  address with its icon (faucet, user, contract), level row
//  and column slot, the labels (name, shortened address,
//  "Atnaujinta: prieš …" in every unit, ISO and unix times, a
//  clock running behind), one edge per sender→receiver pair
//  labelled with the summed value, the currency and the count
//  (a value sent as text read as the number it spells, one
//  that is no number at all printed as a question mark),
//  mixed-case addresses folded onto one node, names and the
//  contract flag taken fresh from every answer — and the text
//  alternative: the canvas named with the day and the transfer
//  count, its noun agreeing with the number the Lithuanian
//  way, the visually hidden table listing every drawn
//  transfer. Then the graph's life: a network switch or an
//  unmount tears the Network down and asks nothing more.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Link } from 'react-router-dom';
import { renderPage } from '../../support/render';
import { given } from '../../support/backend/server';
import { settle } from '../../support/backend/contract';
import { networks, liveNetwork } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, holdClockStill, advance, renderGraph, bootedNetwork,
  canvas, transferRows, short, at, ADDR, NAMES, DAY_TRANSFERS, TODAY,
} from '../../support/graph-evm/scene';
import GraphPage from '@/pages/Graph/Page';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// flow builds one row of the stored-transactions answer
// directly (for the tests about exact timestamps and flags —
// the backend model computes those itself); answerFlows
// serves the same rows for every address the graph asks
// about. edgeId is the graph's own id for a pair; payee turns
// a number into a wallet address of its own, for as many
// distinct wallets as a test needs.
// -----------------------------------------------------------

const payee = (n) => `0x${n.toString(16).padStart(40, '0')}`;

const flow = (from, to, {
  value = 0.2, count = 1, fromName = null, toName = null, fromAt = at(10), toAt = at(10),
  fromContract = 0, toContract = 0, fromHub = 0, toHub = 0,
} = {}) => ({
  from_address: from, from_name: fromName, from_timestamp: fromAt,
  to_address: to, to_name: toName, to_timestamp: toAt,
  from_addr_contract: fromContract, to_addr_contract: toContract,
  from_addr_hub: fromHub, to_addr_hub: toHub,
  value, count,
});

const answerFlows = (...rows) => given.json('get', '/api/evm/:network/get-stored-transactions', { transactions: rows });

const edgeId = (from, to) => `${from}-${to}`;

// The "Atnaujinta" line of a node's label
const updatedLine = (network, id) => network.node(id).label.split('\n').at(-1);







// -----------------------------------------------------------
// What vis is handed
// -----------------------------------------------------------
//
// The container, the DataSets and the options — the layout is
// the graph's own, vis only renders.
// -----------------------------------------------------------

describe('What vis is handed', () => {

  it('draws into the page\'s graph area — the element named as the day\'s transfer graph', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(network.container).toBe(canvas());
    expect(networks).toHaveLength(1);
  });


  it('turns vis\'s own layout and physics off, so a dragged node stays where it was dropped', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const { options } = await bootedNetwork();
    expect(options.layout).toEqual({ hierarchical: { enabled: false }, improvedLayout: false });
    expect(options.physics).toBe(false);
  });


  it('lets nodes move sideways only — each stays on its level row', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const { options } = await bootedNetwork();
    expect(options.nodes.fixed).toEqual({ x: false, y: true });
  });


  it('binds vis\'s keyboard shortcuts to the canvas, not the window — "-" stays typable in the date search', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const { options } = await bootedNetwork();
    expect(options.interaction.keyboard).toEqual({ enabled: true, bindToWindow: false });
    expect(options.interaction.zoomView).toBe(true);
  });


  it('draws edges as grey clockwise curves labelled mid-way, and node captions in 14 px Tahoma', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(network.options.edges).toEqual({
      width: 2,
      smooth: { type: 'curvedCW', roundness: 0.2 },
      font: { size: 12, align: 'middle', multi: 'html' },
      color: { color: '#848484', highlight: '#848484', hover: '#848484' },
    });
    expect(network.options.nodes.font).toEqual({ size: 14, face: 'Tahoma' });
    expect(network.edges().every((edge) => edge.font.align === 'middle' && edge.font.size === 12)).toBe(true);
  });


  it('listens for exactly what the student can do on the canvas: zoom, double-click, right-click, drag', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork();
    expect([...network.events.keys()].sort()).toEqual(['doubleClick', 'dragEnd', 'oncontext', 'zoom']);
  });
});







// -----------------------------------------------------------
// Nodes
// -----------------------------------------------------------
//
// One per address: the faucet on top, each hop a level row
// lower, newcomers dealt slots left to right; the icon by
// kind; the label from the name, the address and the last
// sighting.
// -----------------------------------------------------------

describe('Nodes', () => {

  it('draws one node per address: the faucet on top, the addresses it paid one level below, left to right', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(network.nodes().map(({ id, x, y }) => ({ id, x, y }))).toEqual([
      { id: ADDR.FAUCET, x: 0, y: 0 },
      { id: ADDR.JONAS, x: 150, y: 275 },
      { id: ADDR.EGLE, x: 300, y: 275 },
    ]);
  });


  it('each hop further from the faucet is one level row lower — found by the boot sweep', async () => {
    installGraphBackend({
      transfers: [
        ...DAY_TRANSFERS,
        { from: ADDR.JONAS, to: ADDR.PETRAS, value: 0.05, at: at(11, 0) },
        { from: ADDR.PETRAS, to: ADDR.RUTA, value: 0.01, at: at(11, 10) },
      ],
      addresses: NAMES,
    });
    renderGraph();
    const network = await bootedNetwork({ transfers: 5 });
    expect(network.node(ADDR.PETRAS)).toMatchObject({ x: 150, y: 550 });
    expect(network.node(ADDR.RUTA)).toMatchObject({ x: 150, y: 825 });
  });


  it('someone paying the faucet who was not paid by it today lands one level below it', async () => {
    installGraphBackend({ transfers: [{ from: ADDR.PETRAS, to: ADDR.FAUCET, value: 0.1, at: at(9, 0) }], addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 1 });
    expect(network.node(ADDR.PETRAS)).toMatchObject({ y: 275, image: '/img/user.png' });
  });


  it('shows the faucet larger with its own icon, wallets with the user icon, contracts with the contract icon', async () => {
    installGraphBackend({
      transfers: [...DAY_TRANSFERS, { from: ADDR.JONAS, to: ADDR.LINK, value: 0, at: at(11, 30) }],
      addresses: { ...NAMES, [ADDR.LINK]: { name: 'LINK token', contract: true, hub: false } },
    });
    renderGraph();
    const network = await bootedNetwork({ transfers: 4 });
    expect(network.node(ADDR.FAUCET)).toMatchObject({ shape: 'image', image: '/img/faucet.png', size: 30 });
    expect(network.node(ADDR.JONAS)).toMatchObject({ shape: 'image', image: '/img/user.png', size: 20 });
    expect(network.node(ADDR.LINK)).toMatchObject({ shape: 'image', image: '/img/contract.png', size: 20 });
  });


  it('labels a node with its name, its shortened address and when it was last seen', async () => {
    holdClockStill();
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    // Jonas last moved at 11:55, Eglė was paid at 10:30
    await waitFor(() => expect(network.node(ADDR.JONAS).label).toBe(`Jonas\n${short(ADDR.JONAS)}\nAtnaujinta: prieš 5 min.`));
    expect(network.node(ADDR.EGLE).label).toBe(`Eglė\n${short(ADDR.EGLE)}\nAtnaujinta: prieš 1 val.`);
    expect(network.node(ADDR.FAUCET).label).toBe(`KNF Faucet\n${short(ADDR.FAUCET)}\nAtnaujinta: prieš 5 min.`);
    expect(short(ADDR.JONAS)).toBe('0xb3fa...57d9');
  });


  it('an address without a name is labelled by its address alone', async () => {
    holdClockStill();
    installGraphBackend({ transfers: [{ from: ADDR.FAUCET, to: ADDR.PETRAS, value: 0.2, at: at(11, 0) }], addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 1 });
    expect(network.node(ADDR.PETRAS).label).toBe(`${short(ADDR.PETRAS)}\nAtnaujinta: prieš 1 val.`);
  });


  it('the faucet alone on a quiet day says "ką tik" — it has no sighting yet', async () => {
    installGraphBackend({ addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 0 });
    expect(network.nodes()).toHaveLength(1);
    expect(network.node(ADDR.FAUCET).label).toBe(`${short(ADDR.FAUCET)}\nAtnaujinta: ką tik`);
    expect(network.edges()).toEqual([]);
  });


  it.each([
    ['30 seconds', 30, 'prieš 30 sek.'],
    ['59 seconds', 59, 'prieš 59 sek.'],
    ['a minute', 60, 'prieš 1 min.'],
    ['59 minutes', 59 * 60 + 59, 'prieš 59 min.'],
    ['3 hours', 3 * 3600, 'prieš 3 val.'],
    ['2 days', 2 * 86400, 'prieš 2 d.'],
    ['45 days — a whole 30-day month', 45 * 86400, 'prieš 1 mėn.'],
    ['364 days — still months', 364 * 86400, 'prieš 12 mėn.'],
    ['365 days — a year', 365 * 86400, 'prieš 1 m.'],
    ['800 days', 800 * 86400, 'prieš 2 m.'],
  ])('says how long ago in the largest whole unit: %s → "%s"', async (_, secondsAgo, text) => {
    holdClockStill();
    const now = Math.floor(Date.now() / 1000);
    answerFlows(flow(ADDR.FAUCET, ADDR.JONAS, { toName: 'Jonas', fromAt: now - secondsAgo, toAt: now - secondsAgo }));
    renderGraph();
    const network = await bootedNetwork({ transfers: 1 });
    await waitFor(() => expect(updatedLine(network, ADDR.JONAS)).toBe(`Atnaujinta: ${text}`));
  });


  it('a block time a few seconds ahead of a lagging lab clock says "prieš 0 sek.", never a negative age', async () => {
    holdClockStill();
    const now = Math.floor(Date.now() / 1000);
    answerFlows(flow(ADDR.FAUCET, ADDR.JONAS, { fromAt: now + 7, toAt: now + 7 }));
    renderGraph();
    const network = await bootedNetwork({ transfers: 1 });
    expect(updatedLine(network, ADDR.JONAS)).toBe('Atnaujinta: prieš 0 sek.');
  });


  it('understands ISO timestamps as well as unix seconds', async () => {
    holdClockStill();
    answerFlows(flow(ADDR.FAUCET, ADDR.JONAS, { fromAt: '2026-09-30T11:00:00Z', toAt: '2026-09-30T09:00:00Z' }));
    renderGraph();
    const network = await bootedNetwork({ transfers: 1 });
    expect(updatedLine(network, ADDR.FAUCET)).toBe('Atnaujinta: prieš 1 val.');
    expect(updatedLine(network, ADDR.JONAS)).toBe('Atnaujinta: prieš 3 val.');
  });


  it('a timestamp it cannot read counts as "just now" and is reported on the console', async () => {
    holdClockStill();
    const logged = vi.spyOn(console, 'error');
    answerFlows(flow(ADDR.FAUCET, ADDR.JONAS, { toAt: null }));
    renderGraph();
    const network = await bootedNetwork({ transfers: 1 });
    expect(updatedLine(network, ADDR.JONAS)).toBe('Atnaujinta: prieš 0 sek.');
    expect(logged).toHaveBeenCalledWith('Unrecognized timestamp format:', null);
  });


  it('folds a mixed-case (checksummed) address onto the same lowercase node', async () => {
    const checksummed = '0xB3fA7Be6763eE3BcD32e9C6D90237C0a1A2d57D9';
    answerFlows(
      flow(ADDR.FAUCET, checksummed, { toName: 'Jonas' }),
      flow(ADDR.JONAS, ADDR.FAUCET, { fromName: 'Jonas', value: 0.1 }),
    );
    renderGraph();
    const network = await bootedNetwork({ transfers: 2 });
    expect(network.nodes().map((node) => node.id)).toEqual([ADDR.FAUCET, ADDR.JONAS]);
    expect(network.edge(edgeId(ADDR.FAUCET, ADDR.JONAS))).toMatchObject({ from: ADDR.FAUCET, to: ADDR.JONAS });
  });


  it('takes every name fresh from the backend — a rename made elsewhere shows at the next sweep', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(network.node(ADDR.EGLE).label).toMatch(/^Eglė\n/);

    backend.addresses[ADDR.EGLE].name = 'Eglė Petraitė';
    await advance(1_000);
    await waitFor(() => expect(network.node(ADDR.EGLE).label).toMatch(/^Eglė Petraitė\n/));
    expect(transferRows()).toContainEqual(['KNF Faucet', 'Eglė Petraitė', '0.2000 SepETH (1 tx)']);
  });


  it('a wallet the backend later marks as a contract switches to the contract icon in place', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(network.node(ADDR.EGLE).image).toBe('/img/user.png');

    backend.addresses[ADDR.EGLE].contract = true;
    await advance(1_000);
    await waitFor(() => expect(network.node(ADDR.EGLE).image).toBe('/img/contract.png'));
    expect(network.node(ADDR.EGLE)).toMatchObject({ x: 300, y: 275 });
  });


  it('once a contract, always a contract — a later answer without the flag does not turn it back', async () => {
    const backend = installGraphBackend({
      transfers: [...DAY_TRANSFERS, { from: ADDR.JONAS, to: ADDR.LINK, value: 0, at: at(11, 30) }],
      addresses: { ...NAMES, [ADDR.LINK]: { name: 'LINK token', contract: true, hub: false } },
    });
    renderGraph();
    const network = await bootedNetwork({ transfers: 4 });
    backend.addresses[ADDR.LINK].contract = false;
    await advance(1_000);
    await settle(50);
    expect(network.node(ADDR.LINK).image).toBe('/img/contract.png');
  });
});







// -----------------------------------------------------------
// Edges
// -----------------------------------------------------------
//
// One per sender→receiver pair: an arrow labelled with the
// summed value (4 decimals), the currency and the count.
// -----------------------------------------------------------

describe('Edges', () => {

  it('draws one arrow per sender→receiver pair, both directions apart', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(network.edges().map(({ id, from, to, arrows }) => ({ id, from, to, arrows }))).toEqual([
      { id: edgeId(ADDR.FAUCET, ADDR.JONAS), from: ADDR.FAUCET, to: ADDR.JONAS, arrows: 'to' },
      { id: edgeId(ADDR.FAUCET, ADDR.EGLE), from: ADDR.FAUCET, to: ADDR.EGLE, arrows: 'to' },
      { id: edgeId(ADDR.JONAS, ADDR.FAUCET), from: ADDR.JONAS, to: ADDR.FAUCET, arrows: 'to' },
    ]);
  });


  it('labels an edge with the value to four decimals, the currency and "(1 tx)"', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(network.edge(edgeId(ADDR.JONAS, ADDR.FAUCET)).label).toBe('0.1998 SepETH\n(1 tx)'));
  });


  it('several transfers between the same pair are one edge with their sum and "(n txs)"', async () => {
    installGraphBackend({
      transfers: [
        { from: ADDR.FAUCET, to: ADDR.JONAS, value: 0.2, at: at(9, 0) },
        { from: ADDR.FAUCET, to: ADDR.JONAS, value: 0.2, at: at(10, 0) },
        { from: ADDR.FAUCET, to: ADDR.JONAS, value: 0.2, at: at(11, 0) },
      ],
      addresses: NAMES,
    });
    renderGraph();
    const network = await bootedNetwork({ transfers: 1 });
    await waitFor(() => expect(network.edge(edgeId(ADDR.FAUCET, ADDR.JONAS)).label).toBe('0.6000 SepETH\n(3 txs)'));
    expect(transferRows()).toEqual([['KNF Faucet', 'Jonas', '0.6000 SepETH (3 txs)']]);
  });


  it('rounds to four decimals and writes zero as 0.0000', async () => {
    answerFlows(
      flow(ADDR.FAUCET, ADDR.JONAS, { value: 1.23456789, toName: 'Jonas' }),
      flow(ADDR.JONAS, ADDR.LINK, { value: 0, fromName: 'Jonas', toContract: 1 }),
    );
    renderGraph();
    const network = await bootedNetwork({ transfers: 2 });
    await waitFor(() => expect(network.edge(edgeId(ADDR.FAUCET, ADDR.JONAS)).label).toBe('1.2346 SepETH\n(1 tx)'));
    expect(network.edge(edgeId(ADDR.JONAS, ADDR.LINK)).label).toBe('0.0000 SepETH\n(1 tx)');
  });


  it('a value or a count that is no number at all prints as "?" — the transfer is still drawn', async () => {
    answerFlows(
      flow(ADDR.FAUCET, ADDR.JONAS, { value: 'daug', toName: 'Jonas' }),
      flow(ADDR.JONAS, ADDR.FAUCET, { value: null, count: null, fromName: 'Jonas' }),
    );
    renderGraph();
    const network = await bootedNetwork({ transfers: 2 });
    await waitFor(() => expect(network.edge(edgeId(ADDR.FAUCET, ADDR.JONAS)).label).toBe('? SepETH\n(1 tx)'));
    expect(network.edge(edgeId(ADDR.JONAS, ADDR.FAUCET)).label).toBe('? SepETH\n(? tx)');
    await waitFor(() => expect(transferRows()).toContainEqual([short(ADDR.FAUCET), 'Jonas', '? SepETH (1 tx)']));
  });


  it('a value sent as text is read as the number it spells', async () => {
    answerFlows(flow(ADDR.FAUCET, ADDR.JONAS, { value: '1.23456789', count: '3', toName: 'Jonas' }));
    renderGraph();
    const network = await bootedNetwork({ transfers: 1 });
    await waitFor(() => expect(network.edge(edgeId(ADDR.FAUCET, ADDR.JONAS)).label).toBe('1.2346 SepETH\n(3 txs)'));
  });


  it('an edge whose sum grows is relabelled in place — still one edge', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    backend.transfers.push({ from: ADDR.FAUCET, to: ADDR.JONAS, value: 0.2, at: at(11, 58) });
    await advance(1_000);
    await waitFor(() => expect(network.edge(edgeId(ADDR.FAUCET, ADDR.JONAS)).label).toBe('0.4000 SepETH\n(2 txs)'));
    expect(network.edges()).toHaveLength(3);
  });
});







// -----------------------------------------------------------
// The text alternative
// -----------------------------------------------------------
//
// The canvas is an image named after the day and the number
// of drawn transfers, described by a visually hidden table
// that lists them — from, to, amount and count.
// -----------------------------------------------------------

describe('The text alternative', () => {

  it('names the canvas with the day and the number of transfers, and describes it with the table', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    expect(canvas()).toHaveAccessibleName(`Transakcijų srauto grafikas, ${TODAY}: 3 pervedimai`);
    expect(canvas()).toHaveAccessibleDescription(/^Pervedimai 2026-09-30 dieną/);
  });


  it('lists every drawn transfer in the hidden table: from, to, amount and count', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    const table = screen.getByRole('table', { name: `Pervedimai ${TODAY} dieną` });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Iš', 'Į', 'Suma ir transakcijų skaičius']);
    await waitFor(() => expect(transferRows()).toEqual([
      ['KNF Faucet', 'Jonas', '0.2000 SepETH (1 tx)'],
      ['KNF Faucet', 'Eglė', '0.2000 SepETH (1 tx)'],
      ['Jonas', 'KNF Faucet', '0.1998 SepETH (1 tx)'],
    ]));
  });


  it('an unnamed address appears in the table as its shortened address', async () => {
    installGraphBackend({ transfers: [{ from: ADDR.FAUCET, to: ADDR.PETRAS, value: 0.2, at: at(11, 0) }], addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 1 });
    await waitFor(() => expect(transferRows()).toEqual([['KNF Faucet', '0x9a8b...7263', '0.2000 SepETH (1 tx)']]));
  });


  it.each([
    [1, '1 pervedimas'],
    [2, '2 pervedimai'],
    [10, '10 pervedimų'],
    [11, '11 pervedimų'],
    [21, '21 pervedimas'],
  ])('counts %i drawn transfers in agreement with the number — "%s"', async (count, text) => {
    answerFlows(...Array.from({ length: count }, (_, i) => flow(ADDR.FAUCET, payee(i + 1))));
    renderGraph();
    await bootedNetwork();
    await waitFor(() => expect(canvas()).toHaveAccessibleName(`Transakcijų srauto grafikas, ${TODAY}: ${text}`));
    expect(transferRows()).toHaveLength(count);
  });


  it('is empty — "0 pervedimų" — while the day\'s first answer is on its way', async () => {
    given.hang('get', '/api/evm/:network/get-stored-transactions');
    renderGraph();
    await waitFor(() => expect(canvas()).toBeInTheDocument());
    await settle(100);
    expect(canvas()).toHaveAccessibleName(`Transakcijų srauto grafikas, ${TODAY}: 0 pervedimų`);
    expect(transferRows()).toEqual([]);
    expect(networks).toHaveLength(0);
  });


  it('a day without transfers: the faucet alone and an empty table', async () => {
    installGraphBackend({ addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 0 });
    expect(network.nodes().map((node) => node.id)).toEqual([ADDR.FAUCET]);
    expect(transferRows()).toEqual([]);
  });


  it('markup in a name is shown as text, never as elements', async () => {
    answerFlows(flow(ADDR.FAUCET, ADDR.JONAS, { toName: '<img src=x onerror=alert(1)><b>Jonas</b>' }));
    renderGraph();
    await bootedNetwork({ transfers: 1 });
    await waitFor(() => expect(transferRows()).toEqual([[short(ADDR.FAUCET), '<img src=x onerror=alert(1)><b>Jonas</b>', '0.2000 SepETH (1 tx)']]));
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });
});







// -----------------------------------------------------------
// The graph's life
// -----------------------------------------------------------
//
// A network switch rebuilds the graph from nothing; leaving
// the page destroys the Network and asks nothing more.
// -----------------------------------------------------------

describe('The graph\'s life', () => {

  it('switching the network in the URL tears the old graph down and builds the new network\'s from scratch', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderPage(
      <>
        <GraphPage />
        <Link to="/graph/hoodi">Hoodi</Link>
      </>,
      { route: '/graph/sepolia', path: '/graph/:network' },
    );
    const sepolia = await bootedNetwork({ transfers: 3 });

    await user.click(screen.getByRole('link', { name: 'Hoodi' }));
    await waitFor(() => expect(liveNetwork()).not.toBe(sepolia));
    expect(sepolia.destroyed).toBe(true);
    const hoodi = await bootedNetwork({ transfers: 3 });
    expect(backend.requests.at(-1).network).toBe('hoodi');
    await waitFor(() => expect(hoodi.edge(edgeId(ADDR.FAUCET, ADDR.JONAS)).label).toBe('0.2000 ETH\n(1 tx)'));
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų srautas — Ethereum Hoodi' })).toBeInTheDocument();
  });


  it('leaving the page destroys the Network and stops asking the backend', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { unmount } = renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    unmount();
    expect(network.destroyed).toBe(true);
    const asked = backend.requests.length;
    await advance(60_000);
    expect(backend.requests).toHaveLength(asked);
  });


  it('leaving while the first answer is still out never builds a Network for it', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const release = backend.hold();
    const { unmount } = renderGraph();
    await waitFor(() => expect(backend.requests).toHaveLength(1));
    unmount();
    release();
    await settle(100);
    expect(networks).toHaveLength(0);
  });
});

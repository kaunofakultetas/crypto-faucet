// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: dragged positions
//
//  The student's own arrangement: a node dropped at a new x
//  stays there (only sideways — its level row never moves),
//  and every node's x is saved in localStorage under
//  graphNodePositions:<network>:<day> — so each network AND
//  each viewed day keeps its own arrangement, restored when it
//  is opened again (the faucet's too). Newcomers are dealt
//  slots to the right of what already stands on their level —
//  a restored node listed after them and a node dragged past
//  the end of the row included; a canvas pan saves as well; a
//  broken or partly broken saved entry means a clean slate, a
//  full storage only a console warning; old days are pruned so
//  the storage never fills up — never more than 30 survive,
//  the day being saved always among them and the newest of the
//  others filling the rest, whatever network they belong to,
//  and nothing else in localStorage is touched.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { settle } from '../../support/backend/contract';
import { liveNetwork } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, advance, renderGraph, bootedNetwork, dayPicker,
  at, ADDR, NAMES, DAY_TRANSFERS, TODAY,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// saved reads the stored arrangement of one network and day;
// store writes one before the page opens; scopeKeys lists
// every saved arrangement's key. The graph is always the day's
// three-transfer scene unless a test says otherwise.
// -----------------------------------------------------------

const keyOf = (network, day) => `graphNodePositions:${network}:${day}`;

const saved = (network = 'sepolia', day = TODAY) => {
  const raw = localStorage.getItem(keyOf(network, day));
  return raw === null ? null : JSON.parse(raw);
};

const store = (network, day, positions) => localStorage.setItem(keyOf(network, day), JSON.stringify(positions));

const scopeKeys = () => Object.keys(localStorage).filter((key) => key.startsWith('graphNodePositions:')).sort();

const position = (network, id) => {
  const { x, y } = network.node(id);
  return { x, y };
};

async function drawnGraph({ network = 'sepolia', transfers = DAY_TRANSFERS, drawn = 3 } = {}) {
  const backend = installGraphBackend({ transfers, addresses: NAMES });
  const view = renderGraph({ network });
  const graph = await bootedNetwork({ transfers: drawn });
  return { ...view, backend, graph };
}

async function switchDay(user, label) {
  await user.click(dayPicker());
  await user.click(await screen.findByRole('option', { name: label }));
  await waitFor(() => expect(dayPicker()).toHaveValue(label));
}







// -----------------------------------------------------------
// Dragging
// -----------------------------------------------------------
//
// A drop moves the node sideways, saves the arrangement and
// keeps the next newcomer of the level off the dropped node.
// -----------------------------------------------------------

describe('Dragging a node', () => {

  it('keeps a dropped node where it was dropped — sideways only — and saves every node\'s x for this network and day', async () => {
    const { graph } = await drawnGraph();
    expect(saved()).toBeNull();

    await graph.drag(ADDR.JONAS, 420);
    expect(position(graph, ADDR.JONAS)).toEqual({ x: 420, y: 275 });
    expect(saved()).toEqual({ [ADDR.FAUCET]: 0, [ADDR.JONAS]: 420, [ADDR.EGLE]: 300 });
  });


  it('the dropped x survives the next sweep — nothing snaps back', async () => {
    const { graph } = await drawnGraph();
    await graph.drag(ADDR.EGLE, -250);
    await advance(3_000);
    await settle(50);
    expect(position(graph, ADDR.EGLE)).toEqual({ x: -250, y: 275 });
  });


  it('a canvas pan (a drag with no node) saves the arrangement too', async () => {
    const { graph } = await drawnGraph();
    await graph.pan();
    expect(saved()).toEqual({ [ADDR.FAUCET]: 0, [ADDR.JONAS]: 150, [ADDR.EGLE]: 300 });
  });


  it('a full storage only warns on the console — the node still moves', async () => {
    const { graph } = await drawnGraph();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); });
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await graph.drag(ADDR.JONAS, 600);
    expect(position(graph, ADDR.JONAS)).toEqual({ x: 600, y: 275 });
    expect(warned).toHaveBeenCalledWith('Failed to save node positions to localStorage:', expect.any(DOMException));
  });


  it('a newcomer is dealt a slot right of a node dragged past the end of its level, never on top of it', async () => {
    const { backend, graph } = await drawnGraph();
    // Eglė dropped exactly where her level's next slot would be
    await graph.drag(ADDR.EGLE, 450);
    backend.transfers.push({ from: ADDR.FAUCET, to: ADDR.PETRAS, value: 0.2, at: at(12, 0) });
    await advance(1_000);
    await waitFor(() => expect(graph.node(ADDR.PETRAS)).not.toBeNull());
    expect(position(graph, ADDR.PETRAS)).toEqual({ x: 600, y: 275 });
    expect(position(graph, ADDR.EGLE)).toEqual({ x: 450, y: 275 });
  });
});







// -----------------------------------------------------------
// Restoring an arrangement
// -----------------------------------------------------------
//
// The same network and day open as they were left; other
// days and networks keep theirs.
// -----------------------------------------------------------

describe('Restoring an arrangement', () => {

  it('opening the same day again restores the arrangement', async () => {
    const { graph, unmount } = await drawnGraph();
    await graph.drag(ADDR.JONAS, 420);
    await graph.drag(ADDR.FAUCET, -80);
    unmount();

    const { graph: reopened } = await drawnGraph();
    expect(position(reopened, ADDR.JONAS)).toEqual({ x: 420, y: 275 });
    expect(position(reopened, ADDR.FAUCET)).toEqual({ x: -80, y: 0 });
    expect(position(reopened, ADDR.EGLE)).toEqual({ x: 300, y: 275 });
  });


  it('each viewed day keeps its own arrangement', async () => {
    const transfers = [...DAY_TRANSFERS, ...DAY_TRANSFERS.map((t) => ({ ...t, at: t.at - 86400 }))];
    const { user, graph } = await drawnGraph({ transfers });
    await graph.drag(ADDR.JONAS, 420);

    await switchDay(user, '2026-09-29');
    const yesterday = await bootedNetwork({ transfers: 3 });
    expect(position(yesterday, ADDR.JONAS)).toEqual({ x: 150, y: 275 });
    await yesterday.drag(ADDR.EGLE, 999);
    expect(saved('sepolia', '2026-09-29')).toEqual({ [ADDR.FAUCET]: 0, [ADDR.JONAS]: 150, [ADDR.EGLE]: 999 });

    await switchDay(user, `${TODAY} (šiandien)`);
    const today = await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(liveNetwork()).toBe(today));
    expect(position(today, ADDR.JONAS)).toEqual({ x: 420, y: 275 });
    expect(position(today, ADDR.EGLE)).toEqual({ x: 300, y: 275 });
  });


  it('each network keeps its own arrangement for the same day', async () => {
    store('sepolia', TODAY, { [ADDR.FAUCET]: 0, [ADDR.JONAS]: 420, [ADDR.EGLE]: 300 });
    const { graph } = await drawnGraph({ network: 'hoodi' });
    expect(position(graph, ADDR.JONAS)).toEqual({ x: 150, y: 275 });
    await graph.drag(ADDR.JONAS, -300);
    expect(saved('hoodi', TODAY)).toMatchObject({ [ADDR.JONAS]: -300 });
    expect(saved('sepolia', TODAY)).toMatchObject({ [ADDR.JONAS]: 420 });
  });


  it('a newcomer after a reload is dealt a slot right of everything already on its level', async () => {
    store('sepolia', TODAY, { [ADDR.FAUCET]: 0, [ADDR.JONAS]: 900 });
    const { graph } = await drawnGraph();
    expect(position(graph, ADDR.JONAS)).toEqual({ x: 900, y: 275 });
    expect(position(graph, ADDR.EGLE)).toEqual({ x: 1050, y: 275 });
  });


  it('a newcomer listed before a restored node on its level never lands on top of it — the newcomers are dealt slots right of it', async () => {
    // Saved when Jonas was the only one paid: he sits in the
    // first slot of his level
    store('sepolia', TODAY, { [ADDR.FAUCET]: 0, [ADDR.JONAS]: 150 });
    // Since then Petras was paid — and his row comes first
    const { graph } = await drawnGraph({
      transfers: [{ from: ADDR.FAUCET, to: ADDR.PETRAS, value: 0.2, at: at(9, 0) }, ...DAY_TRANSFERS],
      drawn: 4,
    });
    expect(position(graph, ADDR.JONAS)).toEqual({ x: 150, y: 275 });
    expect(position(graph, ADDR.PETRAS).x).not.toBe(position(graph, ADDR.JONAS).x);
    // In the order they were sighted: Petras, then Eglė
    expect(position(graph, ADDR.PETRAS)).toEqual({ x: 300, y: 275 });
    expect(position(graph, ADDR.EGLE)).toEqual({ x: 450, y: 275 });
  });


  it('a saved entry that is not JSON is ignored with a console warning — a clean slate', async () => {
    localStorage.setItem(keyOf('sepolia', TODAY), '{not json');
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { graph } = await drawnGraph();
    expect(position(graph, ADDR.JONAS)).toEqual({ x: 150, y: 275 });
    expect(warned).toHaveBeenCalledWith('Failed to load node positions from localStorage:', expect.any(SyntaxError));
  });


  it('a saved x that is not a number is skipped — that node gets a fresh slot, the others keep theirs', async () => {
    store('sepolia', TODAY, { [ADDR.FAUCET]: 0, [ADDR.JONAS]: 'far left', [ADDR.EGLE]: '720' });
    const { graph } = await drawnGraph();
    expect(position(graph, ADDR.EGLE)).toEqual({ x: 720, y: 275 });
    expect(position(graph, ADDR.JONAS).x).not.toBe(720);
    expect(Number.isFinite(position(graph, ADDR.JONAS).x)).toBe(true);
  });
});







// -----------------------------------------------------------
// Pruning old days
// -----------------------------------------------------------
//
// Saving prunes the oldest saved days — by date, whatever the
// network — so that never more than 30 stay, the day being
// saved among them, and leaves every other localStorage entry
// alone.
// -----------------------------------------------------------

describe('Pruning old days', () => {

  // Saved arrangements for 35 older days, alternating networks
  const OLD_DAYS = Array.from({ length: 35 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 7, 1 + i));
    return { network: i % 2 ? 'hoodi' : 'sepolia', day: date.toISOString().slice(0, 10) };
  });


  it('drops the oldest days first, whatever network they belong to, and touches nothing else', async () => {
    OLD_DAYS.forEach(({ network, day }) => store(network, day, { [ADDR.FAUCET]: 0 }));
    localStorage.setItem('evmLastNetwork', 'sepolia');
    const { graph } = await drawnGraph();
    await graph.drag(ADDR.JONAS, 420);

    const kept = scopeKeys();
    // The six oldest make room: the 29 newest old days and today stay
    for (const { network, day } of OLD_DAYS.slice(0, 6)) expect(kept).not.toContain(keyOf(network, day));
    for (const { network, day } of OLD_DAYS.slice(6)) expect(kept).toContain(keyOf(network, day));
    expect(kept).toContain(keyOf('sepolia', TODAY));
    expect(kept).toHaveLength(30);
    expect(localStorage.getItem('evmLastNetwork')).toBe('sepolia');
  });


  it('never keeps more than 30 days — saving a new day next to 30 saved ones drops the oldest of them', async () => {
    OLD_DAYS.slice(0, 30).forEach(({ network, day }) => store(network, day, { [ADDR.FAUCET]: 0 }));
    const { graph } = await drawnGraph();
    await graph.drag(ADDR.JONAS, 420);
    expect(scopeKeys()).toHaveLength(30);
    expect(scopeKeys()).toContain(keyOf('sepolia', TODAY));
    expect(scopeKeys()).not.toContain(keyOf(OLD_DAYS[0].network, OLD_DAYS[0].day));
  });


  it('saving an old day keeps that day — the oldest of the others makes room for it', async () => {
    // Thirty arrangements of days newer than 2026-09-25: five
    // days on six networks
    const newer = ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']
      .flatMap((day) => ['sepolia', 'hoodi', 'holesky', 'base', 'optimism', 'arbitrum'].map((network) => ({ network, day })));
    newer.forEach(({ network, day }) => store(network, day, { [ADDR.FAUCET]: 0 }));
    const { user } = await drawnGraph();

    await switchDay(user, '2026-09-25');
    const past = await bootedNetwork({ transfers: 0 });
    await past.drag(ADDR.FAUCET, -80);
    expect(saved('sepolia', '2026-09-25')).toEqual({ [ADDR.FAUCET]: -80 });
    expect(scopeKeys()).toHaveLength(30);
    expect(scopeKeys()).not.toContain(keyOf('sepolia', '2026-09-26'));
  });
});

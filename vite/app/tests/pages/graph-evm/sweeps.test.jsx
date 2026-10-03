// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: the sweeps
//
//  How the graph keeps itself fresh, under fake timers that
//  the tests jump: the boot (the faucet's own transfers, then
//  one sweep over everything drawn), the live sweeps that run
//  ONLY while today is viewed — five warm-up sweeps a second
//  apart, then one every 15 s, measured on the backend's
//  request log — a past day that is swept once and stands
//  still, a hidden tab that keeps the cadence but asks
//  nothing, the next sweep armed only after the previous one
//  finished (a slow backend never stacks them), at most four
//  requests in flight, new addresses followed at most five
//  hops per sweep, contracts and public hubs never asked
//  about, new transfers appearing live — and the outage
//  notice, saying what went wrong and closing with "Rodomi
//  paskutiniai gauti duomenys.": shown while the backend fails
//  (a 500 in the backend's words, the proxy's HTML page or a
//  dropped connection with the reason after "Nepavyko
//  atnaujinti grafiko."), the last drawn graph kept under it,
//  gone once an answer comes back. Late answers of a
//  torn-down graph never reach the next one. The backend's
//  word on a failed Etherscan refresh (refresh_error — a
//  refused API key, a rate limit) is shown over the canvas in
//  its words while an address still swept carries it, and
//  goes once its refresh recovers.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { settle } from '../../support/backend/contract';
import { liveNetwork } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, advance, renderGraph, bootedNetwork, transferRows,
  outageNotice, gapText, OUTAGE_TEXT, dayPicker, at, ADDR, NAMES, DAY_TRANSFERS, TODAY, WINDOW,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// sweepTimes: when (on the test's clock) the backend was
// asked about an address — one entry per sweep that reached
// it. gaps: the distances between consecutive entries.
// viewPastDay: switch to 2026-09-29 through the dropdown and
// wait for its graph. hop: the address at a given place in a
// chain of wallets, each paying the next.
// -----------------------------------------------------------

const sweepTimes = (backend, address) => backend.asked(address).map((request) => request.at);

const gaps = (times) => times.slice(1).map((time, i) => time - times[i]);

async function viewPastDay(user, backend, day = '2026-09-29') {
  await user.click(dayPicker());
  await user.click(await screen.findByRole('option', { name: day }));
  await waitFor(() => expect(backend.requests.at(-1)).toMatchObject(WINDOW[day]));
  return bootedNetwork();
}

const hop = (n) => `0x${String(n).repeat(40)}`;

// The same traffic one day earlier (2026-09-29)
const yesterdays = (transfers) => transfers.map((t) => ({ ...t, at: t.at - 86400 }));

const askedFor = (backend, day) => backend.requests.filter((request) => request.from === WINDOW[day].from);

// The faucet pays hop 1, hop 1 pays hop 2, … hop 6 pays hop 7
const CHAIN = [
  { from: ADDR.FAUCET, to: hop(1), value: 0.2, at: at(9, 0) },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ from: hop(n), to: hop(n + 1), value: 0.1, at: at(9, 10 * n) })),
];







// -----------------------------------------------------------
// Boot
// -----------------------------------------------------------
//
// The faucet's own transfers first (the root), then one sweep
// over every address drawn from them.
// -----------------------------------------------------------

describe('Boot', () => {

  it('asks about the faucet first, then sweeps every drawn address once', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(backend.requests).toHaveLength(4));
    expect(backend.requests[0].address).toBe(ADDR.FAUCET);
    expect(backend.requests.slice(1).map((request) => request.address).sort()).toEqual([ADDR.FAUCET, ADDR.JONAS, ADDR.EGLE].sort());
  });


  it('asks every question about the viewed day\'s window on this network', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await advance(3_000);
    expect(backend.requests.length).toBeGreaterThan(4);
    expect(backend.requests.every((request) => request.network === 'sepolia' && request.from === WINDOW[TODAY].from && request.to === WINDOW[TODAY].to)).toBe(true);
  });


  it('follows new addresses at most five hops in one sweep — the sixth hop waits for the next', async () => {
    const backend = installGraphBackend({ transfers: [...CHAIN, ...yesterdays(CHAIN)] });
    const { user } = renderGraph();
    await bootedNetwork();
    const network = await viewPastDay(user, backend);

    // Boot: the faucet → hop 1; the sweep: hops 2 … 6
    await waitFor(() => expect(network.nodes()).toHaveLength(7));
    await settle(100);
    expect(network.nodes().map((node) => node.id)).toEqual([ADDR.FAUCET, hop(1), hop(2), hop(3), hop(4), hop(5), hop(6)]);
    expect(network.node(hop(7))).toBeNull();
    expect(network.node(hop(6))).toMatchObject({ y: 6 * 275 });
  });


  it('the next live sweep goes on from where the last one stopped', async () => {
    installGraphBackend({ transfers: CHAIN });
    renderGraph();
    const network = await bootedNetwork();
    await waitFor(() => expect(network.nodes()).toHaveLength(7));
    expect(network.node(hop(7))).toBeNull();
    await advance(1_000);
    await waitFor(() => expect(network.node(hop(7))).not.toBeNull());
    expect(network.node(hop(7))).toMatchObject({ y: 7 * 275 });
  });
});







// -----------------------------------------------------------
// Live sweeps
// -----------------------------------------------------------
//
// Only while today is viewed: a warm-up of five sweeps a
// second apart, then one every 15 s — each armed after the
// previous one finished; a hidden tab keeps the beat but asks
// nothing.
// -----------------------------------------------------------

describe('Live sweeps', () => {

  it('sweeps today again every second five times, then every fifteen seconds', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(sweepTimes(backend, ADDR.JONAS)).toHaveLength(1));

    await advance(25_000);
    // The boot sweep, five warm-up sweeps, one steady sweep
    const times = sweepTimes(backend, ADDR.JONAS);
    expect(times).toHaveLength(7);
    const [firstFive, last] = [gaps(times).slice(0, 5), gaps(times)[5]];
    for (const gap of firstFive) {
      expect(gap).toBeGreaterThanOrEqual(1_000);
      expect(gap).toBeLessThan(1_200);
    }
    expect(last).toBeGreaterThanOrEqual(15_000);
    expect(last).toBeLessThan(15_200);
  });


  it('every sweep asks about every address it can expand', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await advance(3_500);
    const faucet = backend.asked(ADDR.FAUCET).length;
    expect(faucet).toBeGreaterThanOrEqual(5);
    // Each sweep asked about all three; the faucet once more —
    // its boot request
    expect(backend.asked(ADDR.JONAS)).toHaveLength(faucet - 1);
    expect(backend.asked(ADDR.EGLE)).toHaveLength(faucet - 1);
  });


  it('shows a new transfer within a sweep, no reload needed', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });

    backend.transfers.push({ from: ADDR.FAUCET, to: ADDR.PETRAS, value: 0.2, at: at(12, 0) });
    await advance(1_000);
    await waitFor(() => expect(network.node(ADDR.PETRAS)).toMatchObject({ x: 450, y: 275 }));
    expect(transferRows()).toContainEqual(['KNF Faucet', '0x9a8b...7263', '0.2000 SepETH (1 tx)']);
    expect(liveNetwork()).toBe(network);
  });


  it('a past day is swept once at boot and then stands still', async () => {
    const backend = installGraphBackend({ transfers: [...DAY_TRANSFERS, ...yesterdays(DAY_TRANSFERS)], addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await viewPastDay(user, backend);
    await waitFor(() => expect(askedFor(backend, '2026-09-29')).toHaveLength(4));
    const asked = backend.requests.length;

    await advance(60_000);
    expect(backend.requests).toHaveLength(asked);
  });


  it('a hidden tab keeps the beat but asks nothing; shown again, it sweeps at the next beat', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(backend.requests).toHaveLength(4));

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await advance(3_000);
    expect(backend.requests).toHaveLength(4);

    hidden.mockReturnValue(false);
    await advance(1_000);
    await waitFor(() => expect(backend.requests).toHaveLength(7));
  });


  it('arms the next sweep only after the last one finished — a slow backend never stacks sweeps', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(backend.requests).toHaveLength(4));

    const release = backend.hold();
    await advance(1_000);
    await waitFor(() => expect(backend.inFlight).toBe(3));
    // Half a minute of a stuck backend: still that one sweep
    await advance(30_000);
    expect(backend.requests).toHaveLength(7);

    release();
    await waitFor(() => expect(backend.inFlight).toBe(0));
    await advance(1_000);
    await waitFor(() => expect(backend.requests).toHaveLength(10));
  });


  it('keeps at most four requests in flight, however many addresses there are', async () => {
    const students = [ADDR.JONAS, ADDR.EGLE, ADDR.PETRAS, ADDR.RUTA, hop(8), hop(9)];
    const backend = installGraphBackend({ transfers: students.map((to, i) => ({ from: ADDR.FAUCET, to, value: 0.2, at: at(9, i) })) });
    let release = backend.hold();
    renderGraph();
    await waitFor(() => expect(backend.requests).toHaveLength(1));
    // The faucet's answer goes through; the sweep's are held
    release();
    release = backend.hold();

    await waitFor(() => expect(backend.inFlight).toBe(4));
    await settle(100);
    expect(backend.inFlight).toBe(4);
    expect(backend.requests).toHaveLength(5);

    release();
    await waitFor(() => expect(backend.requests.length).toBeGreaterThanOrEqual(8));
    expect(backend.maxInFlight).toBe(4);
    expect(new Set(backend.requests.slice(1, 8).map((request) => request.address))).toEqual(new Set([ADDR.FAUCET, ...students]));
  });


  it('never asks about a contract or a public hub — their history is the whole testnet\'s', async () => {
    const backend = installGraphBackend({
      transfers: [
        ...DAY_TRANSFERS,
        { from: ADDR.JONAS, to: ADDR.LINK, value: 0, at: at(11, 30) },
        { from: ADDR.HUB, to: ADDR.EGLE, value: 1, at: at(11, 40) },
      ],
      addresses: {
        ...NAMES,
        [ADDR.LINK]: { name: 'LINK token', contract: true, hub: false },
        [ADDR.HUB]: { name: 'Sepolia PoW faucet', contract: false, hub: true },
      },
    });
    renderGraph();
    const network = await bootedNetwork({ transfers: 5 });
    await advance(5_000);
    expect(network.node(ADDR.LINK)).not.toBeNull();
    expect(network.node(ADDR.HUB)).not.toBeNull();
    expect(backend.asked(ADDR.LINK)).toEqual([]);
    expect(backend.asked(ADDR.HUB)).toEqual([]);
  });


  it('a hub keeps the user icon — only the sweeps skip it', async () => {
    installGraphBackend({
      transfers: [...DAY_TRANSFERS, { from: ADDR.HUB, to: ADDR.EGLE, value: 1, at: at(11, 40) }],
      addresses: { ...NAMES, [ADDR.HUB]: { name: 'Sepolia PoW faucet', contract: false, hub: true } },
    });
    renderGraph();
    const network = await bootedNetwork({ transfers: 4 });
    expect(network.node(ADDR.HUB).image).toBe('/img/user.png');
  });
});







// -----------------------------------------------------------
// The outage notice
// -----------------------------------------------------------
//
// A failed fetch must not look like a quiet day: the notice
// shows over the canvas, the last drawn graph stays, and the
// first good answer takes the notice away.
// -----------------------------------------------------------

describe('The outage notice', () => {

  it.each([
    ['a 500 { error } answer', true, OUTAGE_TEXT.error],
    ['the proxy\'s HTML 502 page', 'html', OUTAGE_TEXT.html],
    ['a dropped connection', 'drop', OUTAGE_TEXT.drop],
  ])('%s during a sweep shows the notice saying what went wrong and keeps the last drawn graph under it', async (_, outage, notice) => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    expect(outageNotice()).toBeNull();

    backend.outage = outage;
    await advance(1_000);
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(network.nodes()).toHaveLength(3);
    expect(transferRows()).toHaveLength(3);
    expect(liveNetwork()).toBe(network);
  });


  it('takes the notice away at the first good answer', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    backend.outage = true;
    await advance(1_000);
    await screen.findByText(OUTAGE_TEXT.error);

    backend.outage = false;
    await advance(1_000);
    await waitFor(() => expect(outageNotice()).toBeNull());
  });


  it('a backend down from the start shows the faucet alone with the notice, and fills in once it is back', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    backend.outage = true;
    renderGraph();
    const network = await bootedNetwork({ transfers: 0 });
    expect(await screen.findByText(OUTAGE_TEXT.error)).toBeInTheDocument();
    expect(network.nodes().map((node) => node.id)).toEqual([ADDR.FAUCET]);

    backend.outage = false;
    await advance(1_000);
    await waitFor(() => expect(transferRows()).toHaveLength(3));
    expect(outageNotice()).toBeNull();
    expect(liveNetwork()).toBe(network);
  });


  it('a past day that could not be fetched keeps its notice — no live sweep retries it', async () => {
    const backend = installGraphBackend({ transfers: [...DAY_TRANSFERS, ...yesterdays(DAY_TRANSFERS)], addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork({ transfers: 3 });
    backend.outage = true;
    await user.click(dayPicker());
    await user.click(await screen.findByRole('option', { name: '2026-09-29' }));
    expect(await screen.findByText(OUTAGE_TEXT.error)).toBeInTheDocument();

    backend.outage = false;
    const asked = backend.requests.length;
    await advance(30_000);
    expect(backend.requests).toHaveLength(asked);
    expect(outageNotice()).not.toBeNull();
  });


  it('moving to another day while a sweep is out is no outage — the aborted requests are not failures', async () => {
    const backend = installGraphBackend({ transfers: [...DAY_TRANSFERS, ...yesterdays(DAY_TRANSFERS)], addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork({ transfers: 3 });
    const release = backend.hold();
    await advance(1_000);
    await waitFor(() => expect(backend.inFlight).toBe(3));

    await user.click(dayPicker());
    await user.click(await screen.findByRole('option', { name: '2026-09-29' }));
    release();
    const network = await bootedNetwork({ transfers: 3 });
    await settle(100);
    expect(outageNotice()).toBeNull();
    expect(network.nodes()).toHaveLength(3);
  });


  it('late answers of a torn-down graph never land in the next one', async () => {
    const backend = installGraphBackend({
      transfers: [...DAY_TRANSFERS, { from: ADDR.FAUCET, to: ADDR.PETRAS, value: 0.2, at: at(10, 0, '2026-09-29') }],
      addresses: NAMES,
    });
    const { user } = renderGraph();
    await bootedNetwork({ transfers: 3 });
    const release = backend.hold();
    await advance(1_000);
    await waitFor(() => expect(backend.inFlight).toBe(3));

    await user.click(dayPicker());
    await user.click(await screen.findByRole('option', { name: '2026-09-29' }));
    release();
    const network = await bootedNetwork({ transfers: 1 });
    await settle(200);
    expect(network.nodes().map((node) => node.id)).toEqual([ADDR.FAUCET, ADDR.PETRAS]);
    expect(transferRows()).toEqual([['KNF Faucet', '0x9a8b...7263', '0.2000 SepETH (1 tx)']]);
  });
});







// -----------------------------------------------------------
// The Etherscan refresh notice
// -----------------------------------------------------------
//
// The backend serves its cache when Etherscan refuses it or
// does not answer, and says why with every answer about the
// address (refresh_error). The graph shows that sentence —
// with the warning that transfers may be missing — while any
// address it still sweeps carries one, the drawn graph under
// it.
// -----------------------------------------------------------

describe('The Etherscan refresh notice', () => {

  const KEY_REFUSED = 'Nepavyko atnaujinti transakcijų sąrašo: Etherscan serveris atmetė čiaupo operatoriaus API raktą (Invalid API Key).';
  const RATE_LIMITED = 'Nepavyko atnaujinti transakcijų sąrašo: Etherscan serveris riboja užklausų skaičių (Max rate limit reached).';


  it('a refused Etherscan key the backend reports is shown in its words, the graph drawn under it', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    backend.refreshErrors[ADDR.FAUCET] = KEY_REFUSED;
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });

    expect(await screen.findByText(gapText(KEY_REFUSED))).toBeInTheDocument();
    expect(network.nodes()).toHaveLength(3);
    expect(outageNotice()).toBeNull();
  });


  it('goes once the backend\'s next answer about the address reports its refresh recovered', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    backend.refreshErrors[ADDR.FAUCET] = KEY_REFUSED;
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await screen.findByText(gapText(KEY_REFUSED));

    delete backend.refreshErrors[ADDR.FAUCET];
    await advance(1_000);
    await waitFor(() => expect(screen.queryByText(gapText(KEY_REFUSED))).toBeNull());
  });


  it('a rate limit on another swept address is shown too, and stays while that address carries it', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    backend.refreshErrors[ADDR.JONAS] = RATE_LIMITED;
    renderGraph();
    await bootedNetwork({ transfers: 3 });

    expect(await screen.findByText(gapText(RATE_LIMITED))).toBeInTheDocument();
    // The faucet's own answers carry none — they do not take it away
    await advance(1_000);
    await settle(50);
    expect(screen.getByText(gapText(RATE_LIMITED))).toBeInTheDocument();

    delete backend.refreshErrors[ADDR.JONAS];
    await advance(1_000);
    await waitFor(() => expect(screen.queryByText(gapText(RATE_LIMITED))).toBeNull());
  });


  it('the last word of an address found to be a public hub goes — the graph never asks about it again', async () => {
    const backend = installGraphBackend({
      transfers: [...DAY_TRANSFERS, { from: ADDR.JONAS, to: ADDR.HUB, value: 0.1, at: at(11, 0) }],
      addresses: NAMES,
    });
    backend.refreshErrors[ADDR.HUB] = RATE_LIMITED;
    renderGraph();
    await bootedNetwork({ transfers: 4 });
    expect(await screen.findByText(gapText(RATE_LIMITED))).toBeInTheDocument();

    // The backend flags it, and the next answers say so
    backend.addresses[ADDR.HUB] = { name: '', contract: false, hub: true };
    await advance(1_000);
    await advance(1_000);
    await waitFor(() => expect(screen.queryByText(gapText(RATE_LIMITED))).toBeNull());
  });


  it('a failed Etherscan refresh and an outage are told side by side', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    backend.refreshErrors[ADDR.FAUCET] = KEY_REFUSED;
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await screen.findByText(gapText(KEY_REFUSED));

    backend.outage = 'drop';
    await advance(1_000);
    expect(await screen.findByText(OUTAGE_TEXT.drop)).toBeInTheDocument();
    expect(screen.getByText(gapText(KEY_REFUSED))).toBeInTheDocument();
  });
});

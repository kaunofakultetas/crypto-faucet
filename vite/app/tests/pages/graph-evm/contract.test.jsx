// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: the backend contract
//
//  Every response variant of contract.js against the four
//  endpoints the /graph/:network page reads, each with this
//  page's own way of showing a failure — and its exact words:
//  the backend's sentence when the answer carried one,
//  otherwise the page's own with the reason after it:
//
//    /api/evm/:network/faucet-balance — "Nepavyko gauti
//        čiaupo adreso." in the graph's place; "Kraunama…"
//        while it hangs
//    /api/evm/networks — nothing to show: the heading falls
//        back to the URL key and the labels to ETH, the graph
//        works on
//    /api/evm/:network/transaction-days — "Nepavyko gauti
//        dienų sąrašo." under the date bar, today alone in it,
//        the graph works on
//    /api/evm/:network/get-stored-transactions — the outage
//        notice over the canvas, closed with "Rodomi
//        paskutiniai gauti duomenys."; "0 pervedimų" while it
//        hangs
//
//  and then the malformed answers the matrix does not reach
//  but a backend or proxy can send: a stored-transactions 200
//  that is no transfer list — at boot, in the boot sweep, in a
//  later sweep — is an outage said to be a malformed answer,
//  which the next sweep recovers from; a sweep that throws is
//  said in its own words and the live refresh outlives it; a
//  transfer value that arrives as a string is drawn; a day
//  list that is no list, or holds entries without a readable
//  date, is said to be malformed and leaves the page standing
//  with the days it can read.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { DataSet } from 'vis-data';
import { given } from '../../support/backend/server';
import { describeEndpointContract, settle, expectNoCrash } from '../../support/backend/contract';
import { MalformedAnswerError } from '@/utils/requestError';
import * as f from '../../support/backend/fixtures';
import { liveNetwork } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, advance, renderGraph, bootedNetwork, transferRows, dayPicker, outageNotice,
  outageText, gapText, OUTAGE_TEXT, at, ADDR, NAMES, DAY_TRANSFERS, TODAY,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// pageStands: the page still shows one of its own states —
// its date bar, or one of its single status lines, the
// failure in the graph's place whatever its words: the page's
// own sentence with its reason, or the backend's sentences
// the matrix answers with (the contract's `chrome`).
// renderScene: the page over the day's backend model (for the
// matrices of the endpoints the model does not answer).
// refuseOnce: vis refusing to add one node, once — it throws
// on a duplicate id, say — which stands in for any throw
// inside a sweep, as no answer of the backend can cause one.
// The page's own sentences for the two reads it says the
// failure of: ADDRESS_FAILED and DAYS_FAILED.
// -----------------------------------------------------------

const ADDRESS_FAILED = 'Nepavyko gauti čiaupo adreso.';
const DAYS_FAILED = 'Nepavyko gauti dienų sąrašo.';
const MALFORMED = 'Serveris atsakė netinkamo formato duomenimis.';

const pageStands = () => screen.queryByRole('combobox', { name: 'Data' })
  ?? screen.queryByText('Kraunama…')
  ?? screen.queryByText(/^Nepavyko gauti čiaupo adreso\. /)
  ?? screen.queryByText(/^(Vidinė serverio klaida|Nepalaikomas tinklas: x|Nerasta)$/)
  ?? screen.queryByText('Šiam tinklui transakcijų srautas neprieinamas');

const renderScene = () => {
  installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
  return renderGraph();
};

const earlierButton = () => screen.queryByRole('button', { name: 'Ankstesnė diena' });

// The page a captive portal answers every request with
const PORTAL_PAGE = '<html><body><h1>Prisijunkite prie tinklo</h1></body></html>';

function refuseOnce(id) {
  const add = DataSet.prototype.add;
  let refused = false;
  vi.spyOn(DataSet.prototype, 'add').mockImplementation(function (data, ...rest) {
    if (!refused && data?.id === id) {
      refused = true;
      throw new Error(`vis refused ${id}`);
    }
    return add.call(this, data, ...rest);
  });
}







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
  failed: async (says) => { await screen.findByText(says(ADDRESS_FAILED)); },
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
  // What went wrong under the bar, today alone in it — no
  // steppers, no slider — and the graph on
  failed: async (says) => {
    await bootedNetwork({ transfers: 3 });
    expect(await screen.findByText(says(DAYS_FAILED))).toBeInTheDocument();
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
  failed: async (says) => { await screen.findByText(outageText(says('Nepavyko atnaujinti grafiko.'))); },
  loading: () => screen.getByRole('img', { name: `Transakcijų srauto grafikas, ${TODAY}: 0 pervedimų` }),
});







// -----------------------------------------------------------
// Malformed answers beyond the matrix
// -----------------------------------------------------------
//
// Shapes the matrix does not produce but a backend or a proxy
// can, and what the page does with each: a stored-transactions
// answer that is no transfer list is an outage wherever it
// lands, said to be a malformed answer; a sweep that throws is
// said in its own words and never ends the live refresh; a
// value sent as text is drawn; and a day list the page cannot
// read is said to be malformed, leaving today and the days it
// can read.
// -----------------------------------------------------------

describe('Malformed answers beyond the matrix', () => {

  it('a network list that hangs does not hold the graph back — it is drawn with ETH meanwhile', async () => {
    given.hang('get', '/api/evm/networks');
    renderScene();
    await bootedNetwork({ transfers: 3 });
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų srautas — sepolia' })).toBeInTheDocument();
    expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 ETH (1 tx)']);
  });


  it('a stored-transactions JSON null is an outage: the faucet alone under the notice, which says the answer was malformed', async () => {
    given.json('get', '/api/evm/:network/get-stored-transactions', null);
    renderGraph();
    const network = await bootedNetwork({ transfers: 0 });
    expect(await screen.findByText(OUTAGE_TEXT.malformed)).toBeInTheDocument();
    expect(network.nodes().map((node) => node.id)).toEqual([ADDR.FAUCET]);
  });


  // The malformed answers last until the test lifts them, so
  // the root's answer and the boot sweep's are both malformed —
  // the boot sweep asks about the faucet again at once, and a
  // good answer there would take the notice away before it
  // could be read
  it.each([
    ['an emptied object', () => HttpResponse.json({})],
    ['a captive portal\'s page', () => new HttpResponse(PORTAL_PAGE, { status: 200, headers: { 'Content-Type': 'text/html' } })],
    ['rows that name no sender or receiver', () => HttpResponse.json({ transactions: [{ value: 0.2, count: 1 }] })],
  ])('a 200 that is no transfer list — %s — is an outage the next sweep recovers from', async (_, malformed) => {
    let lifted = false;
    const calls = given.capture('get', '/api/evm/:network/get-stored-transactions', () => (lifted ? f.evmStoredTransactions() : malformed()));
    renderGraph();
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    await settle(100);
    // The outage is told, over the faucet alone …
    expect(screen.queryByText(OUTAGE_TEXT.malformed)).not.toBeNull();
    expect(liveNetwork().nodes().map((node) => node.id)).toEqual([ADDR.FAUCET]);
    // … and the next live sweep brings the day in
    lifted = true;
    await advance(1_000);
    await waitFor(() => expect(transferRows()).toHaveLength(2));
    expect(outageNotice()).toBeNull();
  });


  it('one malformed answer during the boot sweep does not end the live refresh', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    backend.answerOnce(ADDR.JONAS, { error: null });
    const logged = vi.spyOn(console, 'error');
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    // The root's answer and the boot sweep's three
    await waitFor(() => expect(backend.requests).toHaveLength(4));
    expect(logged).toHaveBeenCalledWith('Error fetching transactions:', expect.any(Error));
    await advance(2_000);
    expect(backend.requests.length).toBeGreaterThan(4);
  });


  it('a boot sweep that throws is logged and said in its own words, and the live refresh starts regardless', async () => {
    installGraphBackend({ transfers: [...DAY_TRANSFERS, { from: ADDR.JONAS, to: ADDR.PETRAS, value: 0.05, at: at(11, 0) }], addresses: NAMES });
    // Petras is first drawn by the boot sweep, so its mirror throws
    refuseOnce(ADDR.PETRAS);
    const logged = vi.spyOn(console, 'error');
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(logged).toHaveBeenCalledWith('Sweep failed:', expect.any(Error)));
    expect(network.node(ADDR.PETRAS)).toBeNull();
    expect(await screen.findByText(gapText(`Nepavyko nupiešti grafiko: vis refused ${ADDR.PETRAS}`))).toBeInTheDocument();

    // The next sweep draws him, and its answers take the notice away
    await advance(1_000);
    await waitFor(() => expect(network.node(ADDR.PETRAS)).not.toBeNull());
    await waitFor(() => expect(transferRows()).toHaveLength(4));
    expect(screen.queryByText(/^Nepavyko nupiešti grafiko/)).toBeNull();
    expect(liveNetwork()).toBe(network);
  });


  it('a malformed answer in a later live sweep is an outage like any other — logged, the graph kept, the sweeps going on', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const logged = vi.spyOn(console, 'error');
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(backend.requests).toHaveLength(4));

    backend.answerOnce(ADDR.EGLE, { error: null });
    await advance(1_000);
    await waitFor(() => expect(logged).toHaveBeenCalledWith('Error fetching transactions:', expect.any(Error)));
    expect(logged).toHaveBeenCalledWith('Error fetching transactions:', expect.any(MalformedAnswerError));
    const asked = backend.requests.length;
    await advance(1_000);
    await waitFor(() => expect(backend.requests.length).toBeGreaterThan(asked));
    expect(network.nodes()).toHaveLength(3);
    expect(transferRows()).toHaveLength(3);
    expect(liveNetwork()).toBe(network);
  });


  it('a live sweep that throws is logged, and the sweeps go on — one throw never ends the live refresh', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const logged = vi.spyOn(console, 'error');
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(backend.requests).toHaveLength(4));

    // Petras is paid now, and the sweep that draws him throws
    refuseOnce(ADDR.PETRAS);
    backend.transfers.push({ from: ADDR.FAUCET, to: ADDR.PETRAS, value: 0.2, at: at(12, 0) });
    await advance(1_000);
    await waitFor(() => expect(logged).toHaveBeenCalledWith('Sweep failed:', expect.any(Error)));
    expect(network.node(ADDR.PETRAS)).toBeNull();
    expect(await screen.findByText(gapText(`Nepavyko nupiešti grafiko: vis refused ${ADDR.PETRAS}`))).toBeInTheDocument();

    await advance(1_000);
    await waitFor(() => expect(network.node(ADDR.PETRAS)).not.toBeNull());
    expect(liveNetwork()).toBe(network);
  });


  it('a transfer value that arrives as a string ("0.2") is drawn, and relabelled when the currency arrives — nothing crashes', async () => {
    given.slow('get', '/api/evm/networks', 300, f.evmNetworks);
    const calls = given.capture('get', '/api/evm/:network/get-stored-transactions', {
      transactions: f.evmStoredTransactions().transactions.map((row) => ({ ...row, value: String(row.value) })),
    });
    renderGraph();
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    // The network list lands after the day's answer
    await advance(400);
    await settle(100);
    expectNoCrash();
    await waitFor(() => expect(transferRows()).toContainEqual(['KNF Faucet', 'Jonas', '0.2000 SepETH (1 tx)']));
    expect(transferRows()).toContainEqual(['Jonas', 'KNF Faucet', '0.1998 SepETH (1 tx)']);
  });


  it('a day list that is not a list of { day } entries leaves the page standing — today alone is offered, the answer said to be malformed', async () => {
    const calls = given.capture('get', '/api/evm/:network/transaction-days', { days: { '2026-09-29': 2 } });
    renderScene();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(await screen.findByText(`${DAYS_FAILED} ${MALFORMED}`)).toBeInTheDocument();
    expectNoCrash();
    expect(dayPicker()).toHaveValue('2026-09-30 (šiandien)');
    expect(earlierButton()).toBeNull();
  });


  it('a day list with entries the page cannot read offers the days it can read and leaves the rest out', async () => {
    given.json('get', '/api/evm/:network/transaction-days', {
      days: [{ count: 1, day: '2026-09-28' }, { count: 2 }, null, { count: 1, day: 12345 }, { count: 3, day: 'vakar' }],
    });
    const { user } = renderScene();
    await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(earlierButton()).toBeInTheDocument());
    // The entries it could not read are not passed over in silence
    expect(screen.getByText(`${DAYS_FAILED} ${MALFORMED}`)).toBeInTheDocument();
    await user.click(dayPicker());
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['2026-09-30 (šiandien)', '2026-09-28']);
    expectNoCrash();
  });
});

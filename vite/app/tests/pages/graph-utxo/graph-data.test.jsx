// -----------------------------------------------------------
//  [*] Tests — UTXO graph: the day's data (useTransactionGraph)
//
//  The data side through the page, against the backend double
//  and a fake clock: what is asked for (the route's network,
//  the day as a local-midnight [from, to) window — across a
//  month's end, and 25 hours long on Vilnius' autumn clock
//  change); how often (every 3 s while the backend says the
//  day's first crawl is still filling its cache, every 5 s on
//  a live window, never again for a past day once landed —
//  unless the backend still calls it live, the hour after
//  midnight — and on through an outage until it recovers);
//  the day list asked again exactly when a first crawl lands
//  — judged per window: leaving a day mid-crawl is no landing,
//  coming back to it once its crawl landed is — with the
//  picked day surviving the list growing under it; what the
//  canvas says about the day, word for word — "Kraunama…",
//  the first crawl collecting, "Atnaujinama…", an empty day
//  (today or past), transactions not fetched yet — no
//  failure — or refused by the server, with its reason
//  (centred or as a pill), the backend's own error or the
//  page's sentence with the reason centred, a failed refresh
//  with its reason as a pill over the kept drawing, the
//  backend's failed crawl in its own words (centred, or as a
//  pill saying the drawing is what was collected before),
//  their order of urgency, and nothing at all once the day is
//  drawn and complete; and a malformed answer cleaned before
//  it is drawn — every transaction without a real txid or a
//  place to be drawn left out, each once, a waiting one off a
//  past day, a forgotten block given its column, inputs that
//  name no outpoint dropped while outputs keep their places,
//  only text taken as a name, an address or a failure
//  sentence, the flags believed only when plainly true, a
//  body of nulls or swapped types an empty day — and a body
//  that is no object at all a failure, never a quiet day.
// -----------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { mediaQueryMatches } from '../../support/setup';
import { nullLeaves, settle, swapTypes } from '../../support/backend/contract';
import * as f from '../../support/backend/fixtures';
import {
  GRAPH, DAYS, TODAY, YESTERDAY, pinToday, useFakeClock, advance, renderGraph, answerGraph, askedFor, graphFor, windowOf,
  findBox, getBox, queryBox, allBoxes, bandOf, rowsOf, headerCells,
} from '../../support/graph-utxo/graph';
import { T, X, spend, coin, transaction, dayTransactions } from '../../support/graph-utxo/transactions';
import { COLORS } from '@/pages/Graph_UTXO/constants';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// status is the canvas' message — its status region — if
// any; expectStatus waits for it to read exactly the given
// text, with or without the spinner, and toneOf names its
// colour. showYesterday presses the previous-day stepper
// ("Ankstesnė diena") once. answerPastDay answers the fixture
// day's window from `steps` (one per request, the last
// repeating) and every other window as the default handler
// does. daysAsked captures the day-list requests.
// CRAWL_FAILED and REFUSED are the backend's sentences for a
// crawl that could not reach its Electrum server and for a
// transaction a node without -txindex would not give.
// -----------------------------------------------------------

const CRAWL_FAILED = 'Nepavyko atnaujinti grafiko: Electrum serveris neatsakė per 15 s.';
const REFUSED = "Nepavyko gauti transakcijos: Electrum serveris atsakė klaida: daemon error: DaemonError({'code': -5, "
  + "'message': 'No such mempool transaction. Use -txindex or provide a block hash to enable blockchain transaction "
  + "queries. Use gettransaction for wallet transactio…";

const status = () => screen.queryByRole('status');

const TONES = { 'text-red-700': 'error', 'text-amber-800': 'warn', 'text-slate-600': 'info' };
const toneOf = () => Object.entries(TONES).find(([cls]) => status().firstElementChild.classList.contains(cls))?.[1];

async function showYesterday(user) {
  await user.click(await screen.findByRole('button', { name: 'Ankstesnė diena' }));
}

function answerPastDay(...steps) {
  let asked = 0;
  return given.capture('get', GRAPH, ({ query }) => {
    if (query.get('from') !== windowOf(YESTERDAY).from) return graphFor(query);
    const step = steps[Math.min(asked, steps.length - 1)];
    asked += 1;
    return graphFor(query, step);
  });
}

const daysAsked = (body = f.utxoTransactionDays()) => given.capture('get', DAYS, body);

async function expectStatus(text, { busy = false } = {}) {
  await waitFor(() => expect(status()?.textContent).toBe(text));
  if (busy) expect(within(status()).getByRole('progressbar')).toBeInTheDocument();
  else expect(within(status()).queryByRole('progressbar')).toBeNull();
}







// -----------------------------------------------------------
// What is asked for
// -----------------------------------------------------------

describe('What the page asks for', () => {

  it("asks for today's local-midnight window on the route's network", async () => {
    const calls = answerGraph();
    renderGraph();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].params.network).toBe('btc4');
    expect(calls[0].query).toEqual(windowOf(TODAY));
    expect(Number(calls[0].query.from)).toBe(new Date(2026, 8, 30).getTime() / 1000);
  });


  it('asks for the network the route names', async () => {
    const calls = answerGraph();
    renderGraph({ network: 'ltc4' });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].params.network).toBe('ltc4');
  });


  it("ends a month's last day at the next month's first midnight", async () => {
    pinToday(new Date(2026, 9, 31, 12));
    const calls = answerGraph();
    renderGraph();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].query).toEqual({
      from: String(new Date(2026, 9, 31).getTime() / 1000),
      to: String(new Date(2026, 10, 1).getTime() / 1000),
    });
  });


  it("makes the day of the autumn clock change 25 hours long in the student's zone (Vilnius)", async () => {
    const zone = process.env.TZ;
    process.env.TZ = 'Europe/Vilnius';
    try {
      pinToday(new Date('2026-10-25T09:00:00Z'));
      const calls = answerGraph();
      const days = daysAsked({ days: [] });
      renderGraph();
      await waitFor(() => expect(calls).toHaveLength(1));
      // 00:00 EEST (UTC+3) to the next 00:00 EET (UTC+2)
      expect(calls[0].query).toEqual({
        from: String(Date.parse('2026-10-24T21:00:00Z') / 1000),
        to: String(Date.parse('2026-10-25T22:00:00Z') / 1000),
      });
      await waitFor(() => expect(days).toHaveLength(1));
      expect(days[0].query).toEqual({ tz: 'Europe/Vilnius' });
    } finally {
      if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
    }
  });
});







// -----------------------------------------------------------
// Polling
// -----------------------------------------------------------
//
// Counted at the middle of each interval, so the fake clock's
// own drift (it advances with real time too) cannot land a
// count on a boundary.
// -----------------------------------------------------------

describe('Polling', () => {

  it('asks again every 5 s while the day is live', async () => {
    useFakeClock();
    const calls = answerGraph();
    renderGraph();
    await findBox(T.T5);
    expect(calls).toHaveLength(1);

    await advance(2500);
    expect(calls).toHaveLength(1);
    await advance(5000);
    expect(calls).toHaveLength(2);
    await advance(5000);
    expect(calls).toHaveLength(3);
  });


  it("asks every 3 s while the day's first crawl is still filling the backend's cache, then every 5 s", async () => {
    useFakeClock();
    const calls = answerGraph({ updating: true }, { updating: true }, {});
    renderGraph();
    await findBox(T.T1);

    await advance(1500);
    expect(calls).toHaveLength(1);
    await advance(3000);
    expect(calls).toHaveLength(2);
    await advance(3000);
    expect(calls).toHaveLength(3);
    // The crawl landed at 6 s: the next ask comes 5 s later
    await advance(2500);
    expect(calls).toHaveLength(3);
    await advance(3000);
    expect(calls).toHaveLength(4);
  });


  it('stops asking about a past day once its crawl has landed', async () => {
    useFakeClock();
    const calls = answerPastDay({ updating: true }, {});
    const { user } = renderGraph();
    await findBox(T.T5);
    await showYesterday(user);
    await waitFor(() => expect(askedFor(calls, YESTERDAY)).toHaveLength(1));

    await advance(4500);
    expect(askedFor(calls, YESTERDAY)).toHaveLength(2);
    await advance(20000);
    expect(askedFor(calls, YESTERDAY)).toHaveLength(2);
  });


  it('never asks a finished past day again, nor today once the page has left it', async () => {
    useFakeClock();
    const calls = answerGraph();
    const { user } = renderGraph();
    await findBox(T.T5);
    await showYesterday(user);
    await waitFor(() => expect(askedFor(calls, YESTERDAY)).toHaveLength(1));
    const todayAsked = askedFor(calls, TODAY).length;

    await advance(20000);
    expect(askedFor(calls, YESTERDAY)).toHaveLength(1);
    expect(askedFor(calls, TODAY)).toHaveLength(todayAsked);
  });


  it('keeps asking about yesterday while the backend still calls it live — the hour after midnight — and shows its mempool', async () => {
    useFakeClock(new Date(2026, 8, 30, 0, 30));
    const calls = answerGraph();
    const { user } = renderGraph();
    await findBox(T.T5);
    await showYesterday(user);
    await waitFor(() => expect(askedFor(calls, YESTERDAY)).toHaveLength(1));
    await findBox(T.T5);

    await advance(7500);
    expect(askedFor(calls, YESTERDAY)).toHaveLength(2);
  });


  it('keeps asking about a live day through an outage and draws it once the backend answers again', async () => {
    useFakeClock();
    given.sequence('get', GRAPH, [
      { status: 500, body: { error: 'Vidinė serverio klaida' } },
      { body: f.utxoGraph({ live: true }) },
    ]);
    renderGraph();
    await expectStatus('Vidinė serverio klaida');
    expect(allBoxes()).toHaveLength(0);

    await advance(5000);
    await findBox(T.T5);
    await waitFor(() => expect(status()).toBeNull());
  });
});







// -----------------------------------------------------------
// The day list follows the crawl
// -----------------------------------------------------------

describe('The day list follows the crawl', () => {

  it("asks for the day list again when the day's first crawl lands", async () => {
    useFakeClock();
    const days = daysAsked();
    answerGraph({ updating: true }, {});
    renderGraph();
    await findBox(T.T1);
    await waitFor(() => expect(days).toHaveLength(1));

    await advance(3500);
    await waitFor(() => expect(days).toHaveLength(2));
    expect(days[1].query).toEqual(days[0].query);
  });


  it('does not ask while the crawl is still running, nor on the polls after it landed', async () => {
    useFakeClock();
    const days = daysAsked();
    answerGraph({ updating: true }, { updating: true }, {});
    renderGraph();
    await findBox(T.T1);

    await advance(4500);
    await settle();
    expect(days).toHaveLength(1);
    await advance(3000);
    await waitFor(() => expect(days).toHaveLength(2));
    await advance(11000);
    await settle();
    expect(days).toHaveLength(2);
  });


  it('does not ask for the day list on leaving a day whose first crawl has not landed', async () => {
    useFakeClock();
    const days = daysAsked();
    given.capture('get', GRAPH, ({ query }) => graphFor(query, query.get('from') === windowOf(YESTERDAY).from ? {} : { updating: true }));
    const { user } = renderGraph();
    await findBox(T.T1);
    await waitFor(() => expect(days).toHaveLength(1));

    await showYesterday(user);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Data' })).toHaveValue(YESTERDAY));
    await findBox(T.T1);
    await settle(100);
    expect(days).toHaveLength(1);
  });


  it('asks for the day list once a day left mid-crawl is shown again with its crawl landed', async () => {
    useFakeClock();
    const days = daysAsked();
    let landed = false;
    given.capture('get', GRAPH, ({ query }) => graphFor(query, query.get('from') === windowOf(TODAY).from && !landed ? { updating: true } : {}));
    const { user } = renderGraph();
    await findBox(T.T5);
    await waitFor(() => expect(days).toHaveLength(1));

    await showYesterday(user);
    await waitFor(() => expect(queryBox(T.T5)).toBeNull());
    await settle(100);
    expect(days).toHaveLength(1);

    // Today's crawl lands while the page shows yesterday
    landed = true;
    await user.click(screen.getByRole('button', { name: 'Kita diena' }));
    await findBox(T.T5);
    await waitFor(() => expect(days).toHaveLength(2));
  });


  it('keeps the picked day when the refreshed list grows under it', async () => {
    useFakeClock();
    given.sequence('get', DAYS, [
      { body: f.utxoTransactionDays() },
      { body: { days: [{ count: 1, day: '2025-01-02' }, ...f.utxoTransactionDays().days] } },
    ]);
    const calls = answerPastDay({ updating: true }, {});
    const { user } = renderGraph();
    await waitFor(() => expect(screen.getByRole('slider', { name: 'Diena' })).toHaveAttribute('max', '3'));
    await showYesterday(user);
    await waitFor(() => expect(askedFor(calls, YESTERDAY)).toHaveLength(1));

    await advance(3500);
    await waitFor(() => expect(screen.getByRole('slider', { name: 'Diena' })).toHaveAttribute('max', '4'));
    expect(screen.getByRole('combobox', { name: 'Data' })).toHaveValue(YESTERDAY);
    expect(screen.getByRole('slider', { name: 'Diena' })).toHaveValue('3');
    expect(askedFor(calls, YESTERDAY)).toHaveLength(2);
  });
});







// -----------------------------------------------------------
// What the canvas says
// -----------------------------------------------------------
//
// Centred while nothing is drawn, a pill over a drawing;
// announced politely, as a status; a spinner while busy.
// -----------------------------------------------------------

describe('What the canvas says', () => {

  it('says "Kraunama…" with a spinner while the day loads', async () => {
    given.hang('get', GRAPH);
    renderGraph();
    await expectStatus('Kraunama…', { busy: true });
    expect(allBoxes()).toHaveLength(0);
  });


  it('says the first crawl is collecting while an empty day is being filled', async () => {
    answerGraph({ transactions: [], updating: true });
    renderGraph();
    await expectStatus('Renkamos transakcijos iš tinklo…', { busy: true });
  });


  it('says "Atnaujinama…" over a drawing the first crawl is still adding to', async () => {
    answerGraph({ updating: true });
    renderGraph();
    await findBox(T.T1);
    await expectStatus('Atnaujinama…', { busy: true });
  });


  it('says today has no faucet transactions yet', async () => {
    answerGraph({ transactions: [] });
    renderGraph();
    await expectStatus('Šiandien čiaupo transakcijų dar nėra');
  });


  it('says a past day had none', async () => {
    answerPastDay({ transactions: [] });
    const { user } = renderGraph();
    await findBox(T.T1);
    await showYesterday(user);
    await expectStatus('Šią dieną čiaupo transakcijų nėra');
  });


  it("says how many of the day's transactions are not fetched from the Electrum server yet — no failure — centred when none could be drawn", async () => {
    answerGraph({ transactions: [], missing: 3 });
    renderGraph();
    await expectStatus('Šios dienos transakcijų (3) dar negauta iš Electrum serverio');
    expect(toneOf()).toBe('info');
  });


  it('says how many are not fetched yet in a pill over the rest of the drawing', async () => {
    answerGraph({ missing: 2 });
    renderGraph();
    await findBox(T.T5);
    await expectStatus('Dalies transakcijų (2) dar negauta iš Electrum serverio — grafike jų dar nėra');
    expect(toneOf()).toBe('info');
    expect(allBoxes()).toHaveLength(5);
  });


  it("shows the backend's own message when the day cannot be had", async () => {
    given.error('get', GRAPH, 'Nepalaikomas tinklas: btc4', 400);
    renderGraph();
    await expectStatus('Nepalaikomas tinklas: btc4');
  });


  it('says "Nepavyko gauti transakcijų." and why when the failure carries no sentence — a proxy\'s page, a dropped connection', async () => {
    given.html('get', GRAPH);
    const { unmount } = renderGraph();
    await expectStatus('Nepavyko gauti transakcijų. Serveris grąžino klaidą (502).');
    expect(toneOf()).toBe('error');
    unmount();

    given.networkError('get', GRAPH);
    renderGraph();
    await expectStatus('Nepavyko gauti transakcijų. Patikrinkite interneto ryšį.');
  });


  it('says the server answered in a shape the page cannot use when the body is no object — never a quiet day', async () => {
    const answers = [
      () => given.json('get', GRAPH, null),
      () => given.json('get', GRAPH, []),
      () => given.text('get', GRAPH, 'OK'),
      () => given.empty('get', GRAPH),
    ];
    for (const answer of answers) {
      answer();
      const { unmount } = renderGraph();
      await expectStatus('Nepavyko gauti transakcijų. Serveris atsakė netinkamo formato duomenimis.');
      expect(toneOf()).toBe('error');
      unmount();
    }
  });


  it('keeps the last drawing on a failed refresh and says why in a pill', async () => {
    useFakeClock();
    given.sequence('get', GRAPH, [
      { body: f.utxoGraph({ live: true }) },
      { status: 500, body: { error: 'Vidinė serverio klaida' } },
      { error: true },
    ]);
    renderGraph();
    await findBox(T.T5);
    expect(status()).toBeNull();

    // The backend's own sentence, then a dropped connection's
    // reason after the page's
    await advance(5000);
    await expectStatus('Vidinė serverio klaida. Rodomi paskutiniai gauti duomenys.');
    expect(toneOf()).toBe('error');
    expect(allBoxes()).toHaveLength(5);

    await advance(5000);
    await expectStatus('Nepavyko atnaujinti grafiko. Patikrinkite interneto ryšį. Rodomi paskutiniai gauti duomenys.');
    expect(allBoxes()).toHaveLength(5);
  });


  it("says why the backend's last crawl failed, in its words, centred while nothing is drawn", async () => {
    answerGraph({ transactions: [], crawl_error: CRAWL_FAILED });
    renderGraph();
    await expectStatus(CRAWL_FAILED);
    expect(toneOf()).toBe('error');
  });


  it('says it in a pill over a drawing, which is what was collected before', async () => {
    answerGraph({ crawl_error: CRAWL_FAILED });
    renderGraph();
    await findBox(T.T5);
    await expectStatus(`${CRAWL_FAILED} Rodomi anksčiau surinkti duomenys.`);
    expect(toneOf()).toBe('error');
    expect(allBoxes()).toHaveLength(5);
  });


  it('says nothing of a crawl once one succeeded — the backend sends null', async () => {
    useFakeClock();
    answerGraph({ crawl_error: CRAWL_FAILED }, {});
    renderGraph();
    await expectStatus(`${CRAWL_FAILED} Rodomi anksčiau surinkti duomenys.`);

    await advance(5000);
    await waitFor(() => expect(status()).toBeNull());
  });


  it('puts a failed crawl after an outage and the first crawl collecting, before missing transactions and an empty day', async () => {
    useFakeClock();
    given.sequence('get', GRAPH, [
      { body: { ...f.utxoGraph({ live: true }), crawl_error: CRAWL_FAILED, missing: 2 } },
      { status: 500, body: { error: 'Vidinė serverio klaida' } },
    ]);
    const { unmount } = renderGraph();
    await expectStatus(`${CRAWL_FAILED} Rodomi anksčiau surinkti duomenys.`);
    await advance(5000);
    await expectStatus('Vidinė serverio klaida. Rodomi paskutiniai gauti duomenys.');
    unmount();

    answerGraph({ updating: true, crawl_error: CRAWL_FAILED });
    renderGraph();
    await findBox(T.T1);
    await expectStatus('Atnaujinama…', { busy: true });
  });


  it("says the missing transactions cannot be shown, with the server's own reason, when it refused them — centred and as a pill", async () => {
    answerGraph({ transactions: [], missing: 3, missing_error: REFUSED });
    const { unmount } = renderGraph();
    await expectStatus(`Šios dienos transakcijų (3) parodyti negalima. ${REFUSED}`);
    expect(toneOf()).toBe('warn');
    unmount();

    answerGraph({ missing: 2, missing_error: REFUSED });
    renderGraph();
    await findBox(T.T5);
    await expectStatus(`Dalies transakcijų (2) grafike nėra. ${REFUSED}`);
    expect(toneOf()).toBe('warn');
  });


  it('puts an outage before the collecting message, and the collecting message before missing transactions', async () => {
    useFakeClock();
    given.sequence('get', GRAPH, [
      { body: { ...f.utxoGraph({ live: true }), transactions: [], updating: true, missing: 4 } },
      { status: 502, body: { error: 'Blogas šliuzas' } },
    ]);
    renderGraph();
    await expectStatus('Renkamos transakcijos iš tinklo…', { busy: true });
    await advance(3000);
    await expectStatus('Blogas šliuzas');
  });


  it('puts the collecting pill before the missing one over a drawing', async () => {
    answerGraph({ updating: true, missing: 2 });
    renderGraph();
    await findBox(T.T1);
    await expectStatus('Atnaujinama…', { busy: true });
  });


  it('says nothing once the day is drawn and complete', async () => {
    renderGraph();
    await findBox(T.T5);
    await settle();
    expect(status()).toBeNull();
    expect(queryBox(T.T1)).not.toBeNull();
  });
});







// -----------------------------------------------------------
// Malformed answers
// -----------------------------------------------------------
//
// The data hook cleans every graph answer before the drawing
// reads it: what cannot be drawn is left out, a field of the
// wrong type reads as not known, and the rest is drawn as
// usual. day holds the fixture day's transactions by name.
// -----------------------------------------------------------

describe('Malformed answers', () => {

  const day = () => Object.fromEntries(dayTransactions().map((tx) => [Object.keys(T).find((k) => T[k] === tx.txid), tx]));


  it('draws an empty day from a body whose every leaf is null, or of the swapped type', async () => {
    for (const broken of [nullLeaves(f.utxoGraph({ live: true })), swapTypes(f.utxoGraph({ live: true }))]) {
      given.json('get', GRAPH, broken);
      const { unmount } = renderGraph();
      await expectStatus('Šiandien čiaupo transakcijų dar nėra');
      expect(allBoxes()).toHaveLength(0);
      unmount();
    }
  });


  it('draws the transactions it can and leaves out every one without a real txid, drawing a repeated txid once', async () => {
    const { T1, T2, T3, T4, T5 } = day();
    answerGraph({
      transactions: [
        T1,
        { ...T2, txid: null },
        { ...T3, txid: 12345 },
        { ...T4, txid: 'ne transakcija' },
        { ...T4, txid: '' },
        'transakcija', null, 42, [],
        T5,
        { ...T1, fee: 1 },
      ],
    });
    renderGraph();
    await findBox(T.T5);
    expect(allBoxes()).toHaveLength(2);
    expect(bandOf(getBox(T.T1)).fee).toBe("mokestis 1'100 sat");
  });


  it('leaves out a transaction with no place to be drawn in, and gives one in a block the list forgot that block\'s column', async () => {
    const { T1, T2, T3, T4 } = day();
    const { block: _block, ...homeless } = T4;
    answerGraph({ blocks: [f.utxoBlocks[0]], transactions: [T1, { ...T2, block: '154391' }, T3, homeless] });
    renderGraph();
    await findBox(T.T3);
    expect(allBoxes()).toHaveLength(2);
    expect(queryBox(T.T1)).not.toBeNull();
    expect(headerCells().map((cell) => cell.title)).toEqual(['Blokas #154390', 'Blokas #154395', 'Mempool']);
  });


  it('leaves a waiting transaction out of a past day, which has no mempool to put it in', async () => {
    answerPastDay({ transactions: dayTransactions() });
    const { user } = renderGraph();
    await findBox(T.T5);
    await showYesterday(user);
    await waitFor(() => expect(headerCells().map((cell) => cell.title)).toEqual(['Blokas #154390', 'Blokas #154391', 'Blokas #154395']));
    await findBox(T.T4);
    expect(queryBox(T.T5)).toBeNull();
  });


  it('drops an input that names no outpoint, and keeps an output of the wrong type in its place as one nobody knows', async () => {
    const odd = transaction({
      txid: X.JOIN,
      block: 154391,
      inputs: [spend(T.T0, 0, f.JONAS, 1000000), { txid: null, vout: 0 }, 'įvestis', spend(T.T1, 'nulis', f.JONAS, 5)],
      outputs: [coin(f.EGLE, 500000), 'išvestis', coin(f.JONAS, 400000, { spentBy: { txid: 12345, vin: 0 } })],
    });
    const bare = transaction({ txid: X.MINED, block: 154391, inputs: 'nėra', outputs: { 0: coin(f.EGLE, 1) } });
    answerGraph({ transactions: [odd, bare] });
    renderGraph();
    await waitFor(() => expect(rowsOf(getBox(X.JOIN)).outputs[0].secondary).toBe('0.005 tBTC4'));

    const { inputs, outputs } = rowsOf(getBox(X.JOIN));
    expect(inputs.map((row) => row.secondary)).toEqual(['a0a0a0…a0a0:0']);
    expect(outputs.map(({ primary, secondary, mark }) => [primary, secondary, mark])).toEqual([
      ['Eglė', '0.005 tBTC4', 'coin'],
      ['Nežinomas adresas', '? tBTC4', 'ring'],
      ['Jonas', '0.004 tBTC4', 'coin'],
    ]);
    expect(rowsOf(getBox(X.MINED))).toEqual({ inputs: [], outputs: [] });
  });


  it('takes only text as a name or as the faucet\'s address', async () => {
    answerGraph({ names: { [f.JONAS]: 42, [f.EGLE]: { vardas: 'Eglė' }, [f.FAUCET_UTXO]: "Faucet'as" }, faucet_address: 12345 });
    renderGraph();
    const t1 = await findBox(T.T1);
    expect(bandOf(t1).sender).toBe('tb1qxc2w…xek8');
    expect(bandOf(getBox(T.T3)).sender).toBe('tb1q3gq3…n05n');
    expect(bandOf(getBox(T.T2))).toMatchObject({ sender: "Faucet'as", color: COLORS.INK });
  });


  it('shows markup in a name as plain text', async () => {
    const name = '<img src=x onerror=alert(1)> Jonas';
    answerGraph({ names: { ...f.utxoNames, [f.JONAS]: name } });
    renderGraph();
    expect(bandOf(await findBox(T.T1)).sender).toBe(name);
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });


  it('believes the crawl is running, and transactions are missing, only when the answer says so plainly', async () => {
    answerGraph({ transactions: [], updating: 'true', missing: '3', live: 'false' });
    renderGraph();
    await expectStatus('Šiandien čiaupo transakcijų dar nėra');
  });


  it('takes only text as a failure sentence: a failed crawl or a reason of another type is not said', async () => {
    answerGraph({ transactions: [], crawl_error: 42, missing: 2, missing_error: { why: 'txindex' } });
    renderGraph();
    await expectStatus('Šios dienos transakcijų (2) dar negauta iš Electrum serverio');
  });
});

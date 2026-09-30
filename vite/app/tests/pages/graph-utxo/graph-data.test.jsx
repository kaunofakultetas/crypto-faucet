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
//  (leaving a day mid-crawl counting as landed — pinned), with
//  the picked day surviving the list growing under it;
//  and what the canvas says about the day — "Kraunama…", the
//  first crawl collecting, "Atnaujinama…", an empty day (today
//  or past), transactions the server did not give (centred or
//  as a pill), the backend's own error or the fallback one
//  centred, a failed refresh as a pill over the kept drawing,
//  their order of urgency, and nothing at all once the day is
//  drawn and complete.
// -----------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { mediaQueryMatches } from '../../support/setup';
import { settle } from '../../support/backend/contract';
import * as f from '../../support/backend/fixtures';
import {
  GRAPH, DAYS, TODAY, YESTERDAY, pinToday, useFakeClock, advance, renderGraph, answerGraph, askedFor, graphFor, windowOf,
  findBox, queryBox, allBoxes,
} from '../../support/graph-utxo/graph';
import { T } from '../../support/graph-utxo/transactions';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// status() is the canvas' message (role="status"), if any.
// showYesterday steps the slider back once and waits for the
// past day to be asked for. answerPastDay answers the fixture
// day's window from `steps` (one per request, the last
// repeating) and every other window as the default handler
// does. daysAsked captures the day-list requests.
// -----------------------------------------------------------

const status = () => screen.queryByRole('status');

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
  await waitFor(() => expect(status()).toHaveTextContent(text));
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


  it.fails('does not ask for the day list on leaving a day whose first crawl has not landed — PINNED KNOWN BUG: switching away from a day still being crawled counts as the crawl landing, so the list is asked again at once, before any crawl landed', async () => {
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
// announced politely (role="status"); a spinner while busy.
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


  it('says how many of the day\'s transactions the server did not give, centred when none could be drawn', async () => {
    answerGraph({ transactions: [], missing: 3 });
    renderGraph();
    await expectStatus('Serveris negrąžino šios dienos transakcijų (3) — parodyti jų negalima');
  });


  it('says how many are missing in a pill over the rest of the drawing', async () => {
    answerGraph({ missing: 2 });
    renderGraph();
    await findBox(T.T5);
    await expectStatus('Serveris negrąžino dalies transakcijų (2) — grafike jų nėra');
    expect(allBoxes()).toHaveLength(5);
  });


  it("shows the backend's own message when the day cannot be had", async () => {
    given.error('get', GRAPH, 'Nepalaikomas tinklas: btc4', 400);
    renderGraph();
    await expectStatus('Nepalaikomas tinklas: btc4');
  });


  it('says "Nepavyko gauti transakcijų" when the failure carries no message — a proxy\'s page, a dropped connection', async () => {
    given.html('get', GRAPH);
    const { unmount } = renderGraph();
    await expectStatus('Nepavyko gauti transakcijų');
    unmount();

    given.networkError('get', GRAPH);
    renderGraph();
    await expectStatus('Nepavyko gauti transakcijų');
  });


  it('keeps the last drawing on a failed refresh and says so in a pill', async () => {
    useFakeClock();
    given.sequence('get', GRAPH, [
      { body: f.utxoGraph({ live: true }) },
      { status: 500, body: { error: 'Vidinė serverio klaida' } },
    ]);
    renderGraph();
    await findBox(T.T5);
    expect(status()).toBeNull();

    await advance(5000);
    await expectStatus('Nepavyko atnaujinti grafiko — rodomi paskutiniai gauti duomenys');
    expect(allBoxes()).toHaveLength(5);
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

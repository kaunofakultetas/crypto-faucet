// -----------------------------------------------------------
//  [*] Tests — UTXO graph: the page (GraphUtxoPage)
//
//  The page around the drawing: its title with the network's
//  full name from the /api/utxo/networks catalog (the key
//  until it answers or when it fails), every amount in the
//  network's own unit (no unit at all without the catalog —
//  never one that may be another network's), a catalog that
//  failed said under the title row with why, word for word, an
//  unknown network (titled by its key, the backend's refusal
//  on the canvas, today alone in the picker), the legend of
//  the drawing's marks, opening on today, the page inside the
//  real App (its route and tab title, and the way in from the
//  UTXO faucet's "Transakcijų grafikas" button), and the tick
//  over at local midnight — a tab watching today follows it,
//  a tab on a past day stays, and today moves on in the list
//  every midnight.
// -----------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import { renderApp } from '../../support/render';
import { given } from '../../support/backend/server';
import { mediaQueryMatches } from '../../support/setup';
import {
  NETWORKS, YESTERDAY, pinToday, useFakeClock, advance, renderGraph, answerGraph, askedFor, windowOf, findBox, getBox, rowsOf,
} from '../../support/graph-utxo/graph';
import { T } from '../../support/graph-utxo/transactions';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

const title = () => screen.getByRole('heading', { level: 1 });
const dateField = () => screen.getByRole('combobox', { name: 'Data' });

// What the page says after a failed network list: that the
// amounts go without a currency code
const NO_UNIT = 'Sumos rodomos be valiutos kodo.';

async function dayOptions(user) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
  const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((option) => option.textContent);
  await user.keyboard('{Escape}');
  return options;
}







// -----------------------------------------------------------
// Title and unit
// -----------------------------------------------------------
//
// Display names only — from the same catalog the UTXO faucet
// page reads; when it fails, the line under the title row
// says why.
// -----------------------------------------------------------

describe('Title and unit', () => {

  it("titles the page with the network's full name", async () => {
    renderGraph();
    await waitFor(() => expect(title()).toHaveTextContent('Transakcijų Srautas - Bitcoin Testnet4'));
  });


  it("shows the network's key, and amounts without a unit, until the catalog answers", async () => {
    given.hang('get', NETWORKS);
    renderGraph();
    expect(title()).toHaveTextContent('Transakcijų Srautas - btc4');
    const box = await findBox(T.T1);
    expect(title()).toHaveTextContent('Transakcijų Srautas - btc4');
    expect(rowsOf(box).inputs[0].primary).toBe('0.01');
    expect(screen.queryByText(NO_UNIT, { exact: false })).toBeNull();
  });


  it("shows every amount in the network's own unit", async () => {
    renderGraph({ network: 'knf' });
    await waitFor(() => expect(title()).toHaveTextContent('Transakcijų Srautas - KNF Coin'));
    const box = await findBox(T.T1);
    await waitFor(() => expect(rowsOf(box).inputs[0].primary).toBe('0.01 KNF'));
  });


  it("says the network list could not be read, in the backend's words, and shows the key and no unit", async () => {
    given.error('get', NETWORKS, 'Vidinė serverio klaida', 500);
    renderGraph();
    const box = await findBox(T.T1);
    expect(await screen.findByText(`Vidinė serverio klaida. ${NO_UNIT}`)).toBeInTheDocument();
    expect(rowsOf(box).inputs[0].primary).toBe('0.01');
    expect(title().textContent).toBe('Transakcijų Srautas - btc4');
  });


  it("says the page's own sentence and the reason when the failure carries no sentence, or the list is no list", async () => {
    const failures = [
      [() => given.networkError('get', NETWORKS), 'Patikrinkite interneto ryšį.'],
      [() => given.json('get', NETWORKS, { default_network: 'btc4' }), 'Serveris atsakė netinkamo formato duomenimis.'],
    ];
    for (const [answer, reason] of failures) {
      answer();
      const { unmount } = renderGraph();
      const box = await findBox(T.T1);
      expect(await screen.findByText(`Nepavyko gauti tinklų sąrašo. ${reason} ${NO_UNIT}`)).toBeInTheDocument();
      expect(rowsOf(box).inputs[0].primary).toBe('0.01');
      unmount();
    }
  });


  it("an unknown network is titled by its key, with the backend's refusal on the canvas and today alone to pick", async () => {
    renderGraph({ network: 'doge' });
    expect(await screen.findByRole('status')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nepalaikomas tinklas: doge'));
    expect(title()).toHaveTextContent('Transakcijų Srautas - doge');
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');
    expect(screen.queryByRole('button', { name: 'Ankstesnė diena' })).toBeNull();
    // The day list was refused too — and says so under the title
    expect(await screen.findByText('Nepalaikomas tinklas: doge. Pasirinkti galima tik šiandieną.')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Frame
// -----------------------------------------------------------

describe('Page frame', () => {

  it('opens on today, its mempool live', async () => {
    renderGraph();
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');
    expect(await findBox(T.T5)).toHaveAccessibleName(/laukia patvirtinimo$/);
  });


  it("explains the drawing's marks in a legend", async () => {
    renderGraph();
    const legend = screen.getByRole('list');
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Čiaupo transakcija',
      'Kitos transakcijos',
      'Laukia patvirtinimo',
      'Neišleista išvestis (UTXO)',
      'Nežinoma, ar išleista',
    ]);
  });


  it("lives at /graph/utxo/:network in the App, under its own tab title", async () => {
    renderApp({ route: '/graph/utxo/btc4' });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų Srautas - Bitcoin Testnet4' })).toBeInTheDocument());
    await findBox(T.T1);
    await waitFor(() => expect(document.title).toBe("UTXO transakcijos — VU KNF Faucet'as"));
  });


  it("is reached from the UTXO faucet page's \"Transakcijų grafikas\" button", async () => {
    const { user } = renderApp({ route: '/faucet/utxo/btc4' });
    await user.click(await screen.findByRole('link', { name: 'Transakcijų grafikas' }));
    await waitFor(() => expect(window.location.pathname).toBe('/graph/utxo/btc4'));
    expect(await findBox(T.T1)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Transakcijų Srautas - Bitcoin Testnet4' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Midnight
// -----------------------------------------------------------
//
// The page ticks over a second after local midnight: the list
// gains the new day, and a tab watching "today" follows it.
// -----------------------------------------------------------

describe('Midnight', () => {

  it('moves a tab watching today on to the new day at local midnight', async () => {
    useFakeClock(new Date(2026, 8, 30, 23, 59, 30));
    const calls = answerGraph();
    const { user } = renderGraph();
    await findBox(T.T5);
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');

    await advance(31000);
    await waitFor(() => expect(dateField()).toHaveValue('2026-10-01 (šiandien)'));
    await waitFor(() => expect(askedFor(calls, '2026-10-01')).toHaveLength(1));
    expect(askedFor(calls, '2026-10-01')[0].query).toEqual(windowOf('2026-10-01'));
    // The old today had no mined transaction: it leaves the list
    expect(await dayOptions(user)).toEqual(['2026-10-01 (šiandien)', YESTERDAY, '2025-10-29', '2025-08-13']);
  });


  it('leaves a tab on a past day where it is, while today moves on in the list', async () => {
    useFakeClock(new Date(2026, 8, 30, 23, 59, 30));
    const { user } = renderGraph();
    await findBox(T.T5);
    await user.click(await screen.findByRole('button', { name: 'Ankstesnė diena' }));
    await waitFor(() => expect(dateField()).toHaveValue(YESTERDAY));

    await advance(31000);
    expect(await dayOptions(user)).toEqual(['2026-10-01 (šiandien)', YESTERDAY, '2025-10-29', '2025-08-13']);
    expect(dateField()).toHaveValue(YESTERDAY);
    expect(getBox(T.T1)).toBeInTheDocument();
  });


  it('ticks over again every midnight after', async () => {
    useFakeClock(new Date(2026, 8, 30, 23, 59, 30));
    const { user } = renderGraph();
    await findBox(T.T5);
    await user.click(await screen.findByRole('button', { name: 'Ankstesnė diena' }));
    await waitFor(() => expect(dateField()).toHaveValue(YESTERDAY));

    await advance(31000);
    await advance(24 * 60 * 60 * 1000);
    expect((await dayOptions(user))[0]).toBe('2026-10-02 (šiandien)');
  });
});

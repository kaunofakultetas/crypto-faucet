// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: the days and the date bar
//
//  Which days the graph offers and how a day reaches the
//  backend: the faucet's used days from
//  /api/evm/<network>/transaction-days (asked with the
//  faucet's address and the browser's IANA zone — captured),
//  today appended once (and only once), the three ways to
//  pick a day over the same list — the searchable "Data"
//  dropdown (newest first, today marked "(šiandien)", typed
//  fragments filter it), the − / + steppers (one used day at a
//  time, disabled at the ends) and the slider (named "Diena"
//  and speaking the day it stands on, keyboard steps commit, a
//  drag previews the day on the thumb and fetches only on
//  release) — the single-day bar, a failed list (said under
//  the bar in the backend's words) or an empty one, the picked
//  day's half-open LOCAL-midnight window in every request
//  (UTC, Vilnius, the 25-hour autumn day), the
//  selection kept as a day through a refetched list, and the
//  midnight tick-over: a tab watching today follows the
//  calendar, one watching a past day stays put.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { settle } from '../../support/backend/contract';
import * as f from '../../support/backend/fixtures';
import { networks, liveNetwork } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, moveStudentTo, freezeClock, advance, renderGraph, bootedNetwork,
  canvas, dayPicker, ADDR, NAMES, DAY_TRANSFERS, TODAY, WINDOW, at,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// The bar's controls by what a student sees: the dropdown's
// options in their order, the two steppers, the day slider
// (the horizontal one — the zoom slider is vertical). A graph
// "shows" a day when its canvas is named after it and the
// newest stored-transactions request asked for its window.
// -----------------------------------------------------------

const earlier = () => screen.getByRole('button', { name: 'Ankstesnė diena' });
const later = () => screen.getByRole('button', { name: 'Kita diena' });
const daySlider = () => screen.getAllByRole('slider').find((slider) => slider.getAttribute('aria-orientation') === 'horizontal');

async function dropdownOptions(user) {
  await user.click(dayPicker());
  const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
  await user.keyboard('{Escape}');
  return options;
}

async function pickDay(user, label) {
  await user.click(dayPicker());
  await user.click(await screen.findByRole('option', { name: label }));
}

async function expectGraphOf(backend, day) {
  await waitFor(() => expect(canvas()).toHaveAccessibleName(new RegExp(`^Transakcijų srauto grafikas, ${day}: `)));
  await waitFor(() => expect(backend.requests.at(-1)).toMatchObject(WINDOW[day]));
}

// The faucet's days as the backend lists them, today included
const DAYS_WITH_TODAY = { days: [...f.evmTransactionDays().days, { count: 3, day: TODAY }] };







// -----------------------------------------------------------
// The day list
// -----------------------------------------------------------
//
// transaction-days is asked about the faucet in the browser's
// zone; the dropdown offers its days plus today, newest first.
// -----------------------------------------------------------

describe('The day list', () => {

  it('asks for the faucet\'s used days with the faucet address and the browser\'s time zone', async () => {
    const days = given.capture('get', '/api/evm/:network/transaction-days', f.evmTransactionDays());
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await waitFor(() => expect(days).toHaveLength(1));
    expect(days[0].params.network).toBe('sepolia');
    expect(days[0].query).toEqual({ address: ADDR.FAUCET, tz: 'UTC' });
  });


  it('a student in Vilnius sends "Europe/Vilnius", percent-encoded in the URL', async () => {
    moveStudentTo('Europe/Vilnius');
    freezeClock();
    const days = given.capture('get', '/api/evm/:network/transaction-days', f.evmTransactionDays());
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await waitFor(() => expect(days).toHaveLength(1));
    expect(days[0].query.tz).toBe('Europe/Vilnius');
    expect(days[0].url).toContain('tz=Europe%2FVilnius');
  });


  it('offers the faucet\'s days plus today, newest first, today marked "(šiandien)"', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await waitFor(() => expect(later()).toBeInTheDocument());
    expect(await dropdownOptions(user)).toEqual(['2026-09-30 (šiandien)', '2026-09-29', '2026-09-28', '2026-09-25']);
  });


  it('lists today once when the backend already has it', async () => {
    given.json('get', '/api/evm/:network/transaction-days', DAYS_WITH_TODAY);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await waitFor(() => expect(later()).toBeInTheDocument());
    expect(await dropdownOptions(user)).toEqual(['2026-09-30 (šiandien)', '2026-09-29', '2026-09-28', '2026-09-25']);
  });


  it('opens on today: the dropdown shows it, the slider sits on the newest day, only "Ankstesnė diena" can step', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(later()).toBeInTheDocument());
    expect(dayPicker()).toHaveValue('2026-09-30 (šiandien)');
    expect(daySlider()).toHaveAttribute('aria-valuenow', '3');
    expect(daySlider()).toHaveAttribute('aria-valuemax', '3');
    expect(later()).toBeDisabled();
    expect(earlier()).toBeEnabled();
    expect(backend.requests[0]).toMatchObject(WINDOW[TODAY]);
  });


  it('a failed day list is said under the bar and leaves today alone — the dropdown by itself, no steppers, no slider, the graph still drawn', async () => {
    given.error('get', '/api/evm/:network/transaction-days', 'Nepavyko gauti dienų sąrašo: duomenų bazė užrakinta kitos rašančios užklausos (database is locked).', 500);
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork({ transfers: 3 });
    expect(await screen.findByText('Nepavyko gauti dienų sąrašo: duomenų bazė užrakinta kitos rašančios užklausos (database is locked).')).toBeInTheDocument();
    await settle(100);
    expect(dayPicker()).toHaveValue('2026-09-30 (šiandien)');
    expect(screen.queryByRole('button', { name: 'Ankstesnė diena' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kita diena' })).toBeNull();
    expect(daySlider()).toBeUndefined();
    expect(await dropdownOptions(user)).toEqual(['2026-09-30 (šiandien)']);
  });


  it('a faucet with no history yet has today alone — and nothing is said to have failed', async () => {
    given.json('get', '/api/evm/:network/transaction-days', { days: [] });
    installGraphBackend();
    const { user } = renderGraph();
    await bootedNetwork({ transfers: 0 });
    await settle(100);
    expect(screen.queryByText(/^Nepavyko gauti dienų sąrašo/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ankstesnė diena' })).toBeNull();
    expect(await dropdownOptions(user)).toEqual(['2026-09-30 (šiandien)']);
  });


  // The slider's positions are indices into the day list — what
  // it speaks is the day it stands on, today marked the way the
  // dropdown marks it
  it('names the day slider "Diena" and has it speak the day, not its index', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await waitFor(() => expect(later()).toBeInTheDocument());
    expect(daySlider()).toHaveAccessibleName('Diena');
    expect(daySlider()).toHaveAttribute('aria-valuetext', `${TODAY} (šiandien)`);

    act(() => daySlider().focus());
    await user.keyboard('{ArrowLeft}');
    await expectGraphOf(backend, '2026-09-29');
    expect(daySlider()).toHaveAttribute('aria-valuetext', '2026-09-29');
  });
});







// -----------------------------------------------------------
// Picking a day
// -----------------------------------------------------------
//
// The dropdown, the steppers and the slider all commit a day
// from the same list; the graph is rebuilt for that day's
// window.
// -----------------------------------------------------------

describe('Picking a day', () => {

  it('picking a past day in the dropdown rebuilds the graph for that day\'s window', async () => {
    const backend = installGraphBackend({ transfers: [...DAY_TRANSFERS, { from: ADDR.FAUCET, to: ADDR.PETRAS, value: 0.2, at: at(9, 0, '2026-09-28') }], addresses: NAMES });
    const { user } = renderGraph();
    const todays = await bootedNetwork({ transfers: 3 });

    await pickDay(user, '2026-09-28');
    await expectGraphOf(backend, '2026-09-28');
    expect(dayPicker()).toHaveValue('2026-09-28');
    expect(todays.destroyed).toBe(true);
    const network = liveNetwork();
    expect(network).not.toBe(todays);
    await waitFor(() => expect(network.nodes().map((node) => node.id)).toEqual([ADDR.FAUCET, ADDR.PETRAS]));
    expect(screen.getByRole('table', { name: 'Pervedimai 2026-09-28 dieną' })).toBeInTheDocument();
  });


  it('typing a fragment filters the dropdown — "-28" leaves one day', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await waitFor(() => expect(later()).toBeInTheDocument());
    await user.clear(dayPicker());
    await user.type(dayPicker(), '-28');
    await waitFor(() => expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['2026-09-28']));
  });


  it('typing "šiandien" finds today by its mark', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await waitFor(() => expect(later()).toBeInTheDocument());
    await user.clear(dayPicker());
    await user.type(dayPicker(), 'šiandien');
    await waitFor(() => expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['2026-09-30 (šiandien)']));
  });


  it('"Ankstesnė diena" steps one USED day back each time and stops at the oldest', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await waitFor(() => expect(earlier()).toBeEnabled());

    await user.click(earlier());
    await expectGraphOf(backend, '2026-09-29');
    await user.click(earlier());
    await expectGraphOf(backend, '2026-09-28');
    // 09-26 and 09-27 had no faucet traffic — not offered
    await user.click(earlier());
    await expectGraphOf(backend, '2026-09-25');
    expect(earlier()).toBeDisabled();
    expect(later()).toBeEnabled();
    expect(daySlider()).toHaveAttribute('aria-valuenow', '0');
  });


  it('"Kita diena" steps forward again, up to today, where it disables', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await pickDay(user, '2026-09-28');
    await expectGraphOf(backend, '2026-09-28');

    await user.click(later());
    await expectGraphOf(backend, '2026-09-29');
    await user.click(later());
    await expectGraphOf(backend, TODAY);
    expect(dayPicker()).toHaveValue('2026-09-30 (šiandien)');
    expect(later()).toBeDisabled();
  });


  it('the slider\'s arrow keys commit the neighbouring day, Home the oldest and End today', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await waitFor(() => expect(daySlider()).toBeDefined());

    act(() => daySlider().focus());
    await user.keyboard('{ArrowLeft}');
    await expectGraphOf(backend, '2026-09-29');
    expect(dayPicker()).toHaveValue('2026-09-29');
    await user.keyboard('{Home}');
    await expectGraphOf(backend, '2026-09-25');
    await user.keyboard('{End}');
    await expectGraphOf(backend, TODAY);
  });


  it('dragging the slider previews the day on the thumb and asks the backend only on release', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork({ transfers: 3 });
    await waitFor(() => expect(daySlider()).toBeDefined());

    // jsdom lays nothing out — the slider's track gets a width
    // (300 px: positions 0..3 at 0, 100, 200, 300) so a pointer
    // position maps to a day
    const thumb = daySlider().parentElement;
    const bar = thumb.parentElement;
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 300, width: 300, top: 0, bottom: 20, height: 20, x: 0, y: 0, toJSON() {} });
    const asked = backend.requests.length;

    fireEvent.mouseDown(bar, { button: 0, clientX: 0, clientY: 10 });
    await settle();
    expect(within(thumb).getByText('2026-09-25')).toBeInTheDocument();
    fireEvent.mouseMove(document, { buttons: 1, clientX: 100, clientY: 10 });
    await settle();
    expect(within(thumb).getByText('2026-09-28')).toBeInTheDocument();
    // Still today's graph while the thumb is held
    expect(canvas()).toHaveAccessibleName(`Transakcijų srauto grafikas, ${TODAY}: 3 pervedimai`);
    expect(backend.requests.slice(asked).every((request) => request.from === WINDOW[TODAY].from)).toBe(true);

    fireEvent.mouseUp(document, { clientX: 100, clientY: 10 });
    await expectGraphOf(backend, '2026-09-28');
  });


  it('picking the day already shown changes nothing — no rebuild, no request', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await pickDay(user, '2026-09-29');
    await expectGraphOf(backend, '2026-09-29');
    await settle(100);
    const network = liveNetwork();
    const asked = backend.requests.length;

    await pickDay(user, '2026-09-29');
    await settle(100);
    expect(liveNetwork()).toBe(network);
    expect(backend.requests).toHaveLength(asked);
  });


  it('keeps the picked DAY when a refetched list grows under it — same day, same graph', async () => {
    given.sequence('get', '/api/evm/:network/transaction-days', [
      { body: f.evmTransactionDays() },
      { body: { days: [{ count: 4, day: '2026-09-20' }, ...f.evmTransactionDays().days] } },
    ]);
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await pickDay(user, '2026-09-28');
    await expectGraphOf(backend, '2026-09-28');
    const network = liveNetwork();
    expect(daySlider()).toHaveAttribute('aria-valuenow', '1');

    // A minute later the list is stale; the tab regaining focus
    // refetches it, one day longer at the old end
    await advance(61_000);
    await act(async () => { window.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(daySlider()).toHaveAttribute('aria-valuemax', '4'));
    expect(daySlider()).toHaveAttribute('aria-valuenow', '2');
    expect(dayPicker()).toHaveValue('2026-09-28');
    expect(liveNetwork()).toBe(network);
  });
});







// -----------------------------------------------------------
// The day's window
// -----------------------------------------------------------
//
// Every request carries [local 00:00, next local 00:00) of the
// picked day in unix seconds — the student's midnight, not
// the server's.
// -----------------------------------------------------------

describe('The day\'s window', () => {

  it('sends each picked day as its UTC-midnight window for a student in UTC', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    expect(backend.requests[0]).toMatchObject(WINDOW[TODAY]);
    for (const day of ['2026-09-29', '2026-09-28', '2026-09-25']) {
      await pickDay(user, day);
      await expectGraphOf(backend, day);
      expect(WINDOW[day].to - WINDOW[day].from).toBe(86400);
    }
  });


  it('a student in Vilnius gets Vilnius midnights — the day starts at 21:00 UTC the evening before', async () => {
    moveStudentTo('Europe/Vilnius');
    freezeClock();
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork();
    // 2026-09-29T21:00:00Z … 2026-09-30T21:00:00Z
    expect(backend.requests[0]).toMatchObject({ from: 1790715600, to: 1790802000 });
  });


  it('the autumn clock change makes 2026-10-25 a 25-hour day in Vilnius', async () => {
    moveStudentTo('Europe/Vilnius');
    freezeClock(2026, 9, 26, 12);
    given.json('get', '/api/evm/:network/transaction-days', { days: [{ count: 1, day: '2026-10-24' }, { count: 2, day: '2026-10-25' }] });
    const backend = installGraphBackend();
    const { user } = renderGraph();
    await bootedNetwork();
    await pickDay(user, '2026-10-25');
    // 2026-10-24T21:00:00Z (EEST) … 2026-10-25T22:00:00Z (EET)
    await waitFor(() => expect(backend.requests.at(-1)).toMatchObject({ from: 1792875600, to: 1792965600 }));
    expect(backend.requests.at(-1).to - backend.requests.at(-1).from).toBe(25 * 3600);
  });
});







// -----------------------------------------------------------
// Midnight
// -----------------------------------------------------------
//
// "Today" ticks over at the student's local midnight: a tab
// watching today follows it, a tab on a past day stays, and
// the new day joins the list either way.
// -----------------------------------------------------------

describe('Midnight', () => {

  it('a tab left open on today follows the calendar: the new day is shown, marked and fetched live', async () => {
    freezeClock(2026, 8, 30, 23, 59, 50);
    given.json('get', '/api/evm/:network/transaction-days', DAYS_WITH_TODAY);
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    const yesterdays = await bootedNetwork({ transfers: 3 });
    expect(dayPicker()).toHaveValue('2026-09-30 (šiandien)');

    await advance(11_000);
    await expectGraphOf(backend, '2026-10-01');
    expect(dayPicker()).toHaveValue('2026-10-01 (šiandien)');
    expect(yesterdays.destroyed).toBe(true);
    expect(await dropdownOptions(user)).toEqual(['2026-10-01 (šiandien)', '2026-09-30', '2026-09-29', '2026-09-28', '2026-09-25']);

    // Still live: the new day keeps being swept
    const asked = backend.requests.length;
    await advance(1_000);
    await waitFor(() => expect(backend.requests.length).toBeGreaterThan(asked));
    expect(backend.requests.at(-1)).toMatchObject(WINDOW['2026-10-01']);
  });


  it('a tab watching a past day stays on it at midnight; the list gains the new today', async () => {
    freezeClock(2026, 8, 30, 23, 59, 50);
    given.json('get', '/api/evm/:network/transaction-days', DAYS_WITH_TODAY);
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    const { user } = renderGraph();
    await bootedNetwork();
    await pickDay(user, '2026-09-28');
    await expectGraphOf(backend, '2026-09-28');
    const network = liveNetwork();

    await advance(11_000);
    expect(dayPicker()).toHaveValue('2026-09-28');
    expect(liveNetwork()).toBe(network);
    expect(await dropdownOptions(user)).toEqual(['2026-10-01 (šiandien)', '2026-09-30', '2026-09-29', '2026-09-28', '2026-09-25']);
    expect(networks.filter((candidate) => !candidate.destroyed)).toHaveLength(1);
  });


  it('midnight is the student\'s own: in Vilnius the day turns at 21:00 UTC', async () => {
    moveStudentTo('Europe/Vilnius');
    freezeClock(2026, 8, 30, 23, 59, 50);
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    await bootedNetwork();
    await advance(11_000);
    await waitFor(() => expect(dayPicker()).toHaveValue('2026-10-01 (šiandien)'));
    // 2026-09-30T21:00:00Z … 2026-10-01T21:00:00Z
    await waitFor(() => expect(backend.requests.at(-1)).toMatchObject({ from: 1790802000, to: 1790888400 }));
  });


  it('the day turns just after midnight, not a moment before', async () => {
    freezeClock(2026, 8, 30, 23, 59, 50);
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork();

    // 23:59:58 — still the 30th
    await advance(8_000);
    expect(dayPicker()).toHaveValue('2026-09-30 (šiandien)');
    expect(liveNetwork()).toBe(network);
    expect(backend.requests.at(-1)).toMatchObject(WINDOW[TODAY]);

    // 00:00:01 — the 1st
    await advance(3_000);
    await waitFor(() => expect(dayPicker()).toHaveValue('2026-10-01 (šiandien)'));
  });
});

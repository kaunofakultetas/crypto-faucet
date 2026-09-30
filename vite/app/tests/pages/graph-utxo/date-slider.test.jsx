// -----------------------------------------------------------
//  [*] Tests — UTXO graph: the day picker (DateSliderBar)
//
//  The row that picks the day, on its own and on the page:
//  the "Data" dropdown (the picked day, today marked
//  "(šiandien)", the days newest first, a typed fragment
//  filtering them, a pick committing at once), the − / +
//  steppers (exactly one used day, greyed at the ends), the
//  "Diena" slider (standing on the picked day, rightmost the
//  newest; a drag previews the day in its label and commits
//  only on release, the keyboard commits each step), a picked
//  day that fell out of the list showing as the newest, a
//  single day shrinking the row to the dropdown alone — and,
//  on the page, the day list from /transaction-days asked in
//  the browser's timezone plus today, today alone while the
//  list fails, and the graph drawing the day picked.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import { renderPage } from '../../support/render';
import { given } from '../../support/backend/server';
import { mediaQueryMatches } from '../../support/setup';
import {
  DAYS, TODAY, YESTERDAY, pinToday, renderGraph, answerGraph, askedFor, windowOf, findBox, queryBox, headerCells,
} from '../../support/graph-utxo/graph';
import { T } from '../../support/graph-utxo/transactions';
import DateSliderBar from '@/pages/Graph_UTXO/components/DateSliderBar';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});


// The fixture's days plus today, ascending — what the page
// hands the bar
const FOUR_DAYS = ['2025-08-13', '2025-10-29', YESTERDAY, TODAY];







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderBar mounts the bar the way the page does — holding
// the picked day, so a commit moves it — and reports every
// commit to the spy it returns. The slider's rail has no
// layout in jsdom: sliderRail gives it a 300 px width to point
// at, so the four days sit at 0, 100, 200 and 300 px.
// -----------------------------------------------------------

function Bar({ days, initial, today, onCommit }) {
  const [day, setDay] = useState(initial);
  return (
    <DateSliderBar
      days={days}
      selectedDay={day}
      today={today}
      onCommit={(next) => { onCommit(next); setDay(next); }}
    />
  );
}

function renderBar({ days = FOUR_DAYS, selected = TODAY, today = TODAY } = {}) {
  const onCommit = vi.fn();
  const rendered = renderPage(<Bar days={days} initial={selected} today={today} onCommit={onCommit} />);
  return { ...rendered, onCommit };
}

const dateField = () => screen.getByRole('combobox', { name: 'Data' });
const daySlider = () => screen.getByRole('slider', { name: 'Diena' });

async function openList(user) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return screen.findByRole('listbox');
}

function sliderRail() {
  // MUI's slider root has no role — its class is the only handle
  const rail = daySlider().closest('.MuiSlider-root');
  rail.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 10, width: 300, height: 10, x: 0, y: 0 });
  return rail;
}







// -----------------------------------------------------------
// The dropdown
// -----------------------------------------------------------

describe('Day dropdown', () => {

  it('shows the picked day in the "Data" field, today marked "(šiandien)"', () => {
    renderBar();
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');
  });


  it('shows a past day as it is', () => {
    renderBar({ selected: YESTERDAY });
    expect(dateField()).toHaveValue(YESTERDAY);
  });


  it('lists the days newest first, today marked', async () => {
    const { user } = renderBar();
    const list = await openList(user);
    expect(within(list).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['2026-09-30 (šiandien)', YESTERDAY, '2025-10-29', '2025-08-13']);
  });


  it('commits a day picked from the list at once', async () => {
    const { user, onCommit } = renderBar();
    const list = await openList(user);
    await user.click(within(list).getByRole('option', { name: '2025-10-29' }));
    expect(onCommit).toHaveBeenCalledWith('2025-10-29');
    expect(dateField()).toHaveValue('2025-10-29');
  });


  it('filters the list by a typed fragment — "09-" leaves September\'s days', async () => {
    const { user } = renderBar();
    await user.clear(dateField());
    await user.type(dateField(), '09-');
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['2026-09-30 (šiandien)', YESTERDAY]);
  });
});







// -----------------------------------------------------------
// The steppers
// -----------------------------------------------------------

describe('Day steppers', () => {

  it('steps exactly one used day earlier with −, one later with +', async () => {
    const { user, onCommit } = renderBar({ selected: YESTERDAY });
    await user.click(screen.getByRole('button', { name: 'Ankstesnė diena' }));
    expect(onCommit).toHaveBeenLastCalledWith('2025-10-29');
    await user.click(screen.getByRole('button', { name: 'Kita diena' }));
    await user.click(screen.getByRole('button', { name: 'Kita diena' }));
    expect(onCommit).toHaveBeenLastCalledWith(TODAY);
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');
  });


  it('greys − out on the oldest day and + on the newest', () => {
    const { unmount } = renderBar({ selected: '2025-08-13' });
    expect(screen.getByRole('button', { name: 'Ankstesnė diena' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kita diena' })).toBeEnabled();
    unmount();

    renderBar({ selected: TODAY });
    expect(screen.getByRole('button', { name: 'Ankstesnė diena' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Kita diena' })).toBeDisabled();
  });


  it('treats a picked day that fell out of the list as the newest', async () => {
    const { user, onCommit } = renderBar({ selected: '2024-01-01' });
    expect(daySlider()).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'Kita diena' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Ankstesnė diena' }));
    expect(onCommit).toHaveBeenCalledWith(YESTERDAY);
  });


  it('shrinks to the dropdown alone when there is only one day — nothing to step or slide', () => {
    renderBar({ days: [TODAY] });
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');
    expect(screen.queryByRole('button', { name: 'Ankstesnė diena' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kita diena' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Diena' })).toBeNull();
  });
});







// -----------------------------------------------------------
// The slider
// -----------------------------------------------------------
//
// Positions are indices into the days, rightmost the newest.
// -----------------------------------------------------------

describe('Day slider', () => {

  it('stands on the picked day, the newest at its right end', () => {
    renderBar({ selected: YESTERDAY });
    expect(daySlider()).toHaveValue('2');
    expect(daySlider()).toHaveAttribute('min', '0');
    expect(daySlider()).toHaveAttribute('max', '3');
  });


  it('previews the day under the pointer while dragged and commits only on release', () => {
    const { onCommit } = renderBar();
    const rail = sliderRail();

    fireEvent.mouseDown(rail, { clientX: 100, clientY: 5, button: 0 });
    expect(daySlider()).toHaveValue('1');
    expect(within(rail).getByText('2025-10-29')).toBeInTheDocument();
    fireEvent.mouseMove(document, { clientX: 0, clientY: 5, buttons: 1 });
    expect(within(rail).getByText('2025-08-13')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');

    fireEvent.mouseUp(document, { clientX: 0, clientY: 5 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2025-08-13');
    expect(dateField()).toHaveValue('2025-08-13');
  });


  it('commits every keyboard step', async () => {
    const { user, onCommit } = renderBar();
    daySlider().focus();
    await user.keyboard('{ArrowLeft}');
    expect(onCommit).toHaveBeenLastCalledWith(YESTERDAY);
    await user.keyboard('{Home}');
    expect(onCommit).toHaveBeenLastCalledWith('2025-08-13');
    expect(daySlider()).toHaveValue('0');
  });
});







// -----------------------------------------------------------
// On the page
// -----------------------------------------------------------
//
// The list the page hands the bar: the backend's days (in the
// browser's timezone) plus today, which is always offered.
// -----------------------------------------------------------

describe('Day picker on the page', () => {

  it("offers the days the faucet has transactions on, plus today, opening on today", async () => {
    const { user } = renderGraph();
    await findBox(T.T1);
    await waitFor(() => expect(daySlider()).toHaveAttribute('max', '3'));
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');
    const list = await openList(user);
    expect(within(list).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['2026-09-30 (šiandien)', YESTERDAY, '2025-10-29', '2025-08-13']);
  });


  it("asks for the day list in the browser's own timezone", async () => {
    const calls = given.capture('get', DAYS, { days: [] });
    renderGraph();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].params.network).toBe('btc4');
    expect(calls[0].query).toEqual({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  });


  it('offers today alone while the day list cannot be had', async () => {
    given.error('get', DAYS, 'Vidinė serverio klaida', 500);
    renderGraph();
    await findBox(T.T1);
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');
    expect(screen.queryByRole('button', { name: 'Ankstesnė diena' })).toBeNull();
  });


  it("does not list today twice when the faucet already has transactions today", async () => {
    given.json('get', DAYS, { days: [{ count: 2, day: YESTERDAY }, { count: 1, day: TODAY }] });
    renderGraph();
    await waitFor(() => expect(daySlider()).toHaveAttribute('max', '1'));
  });


  it('draws the day picked in the dropdown: its window asked for, no mempool on a past day', async () => {
    const calls = answerGraph();
    const { user } = renderGraph();
    await findBox(T.T5);
    await waitFor(() => expect(daySlider()).toHaveAttribute('max', '3'));
    const list = await openList(user);
    await user.click(within(list).getByRole('option', { name: YESTERDAY }));

    await waitFor(() => expect(askedFor(calls, YESTERDAY)).toHaveLength(1));
    expect(askedFor(calls, YESTERDAY)[0].query).toEqual(windowOf(YESTERDAY));
    await waitFor(() => expect(queryBox(T.T5)).toBeNull());
    await findBox(T.T1);
    expect(headerCells().map((cell) => cell.title)).not.toContain('Mempool');
    expect(dateField()).toHaveValue(YESTERDAY);
  });


  it('draws the day the slider lands on', async () => {
    const calls = answerGraph();
    const { user } = renderGraph();
    await findBox(T.T1);
    await waitFor(() => expect(daySlider()).toHaveAttribute('max', '3'));
    daySlider().focus();
    await user.keyboard('{Home}');
    await waitFor(() => expect(askedFor(calls, '2025-08-13')).toHaveLength(1));
    expect(dateField()).toHaveValue('2025-08-13');
  });
});

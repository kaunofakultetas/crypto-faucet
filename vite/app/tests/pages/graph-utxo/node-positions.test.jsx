// -----------------------------------------------------------
//  [*] Tests — UTXO graph: where the boxes sit (useNodePositions)
//
//  The layout and drag rules, through the page, read the way
//  a student sees them — each box's place on the canvas (its
//  transform) and on the screen (the zoom, the margin and the
//  scroll counted in): the first layout (a column stacks its
//  boxes in the day's order, a chain inside one block starts
//  right of its parent, a transaction arriving with a poll
//  gets its own spot); click or drag (the 4 px slop in screen
//  pixels, Enter and Space, the right button, a cancelled
//  press, one pointer at a time, the pressed box drawn on
//  top, a box vanishing mid-press — pinned); the drag itself
//  (one box moves, every move measured from the press, the
//  block growing in the drag's direction — later blocks
//  pushed right, earlier ones left, the first into the
//  whitespace, the drawing upward with negative y, and
//  downward — the pointer's travel over the zoom, a scroll
//  made meanwhile counted in, the scroll following the
//  drawing's growth so the box stays under the pointer, the
//  browser's rounding carried along, a box mined mid-drag);
//  and the memory (localStorage
//  "utxo-graph-positions:<network>", written when a drag
//  ends, rounded, the 2000 most recently moved, read on
//  mount, per network, corrupt or blocked storage ignored,
//  positions kept across a day switch).
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { renderPage } from '../../support/render';
import { settle } from '../../support/backend/contract';
import { mediaQueryMatches } from '../../support/setup';
import * as f from '../../support/backend/fixtures';
import {
  pinToday, useFakeClock, advance, renderGraph, answerGraph, findBox, getBox, queryBox, positionOf, onScreen, headerCells,
  scroller, graphGroup, installViewport, roundScrolling, press, moveTo, release, dragBy,
} from '../../support/graph-utxo/graph';
import { T, X, spend, coin, transaction, dayTransactions } from '../../support/graph-utxo/transactions';
import { LAYOUT_CONFIG, NODE_CONFIG } from '@/pages/Graph_UTXO/constants';
import GraphUtxoPage from '@/pages/Graph_UTXO/Page';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});


const KEY = 'utxo-graph-positions:btc4';







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// saved() reads a network's stored positions; savePositions
// puts some there before the page mounts. screenOf maps the
// fixture's five boxes to where they sit on screen, to compare
// a whole drawing before and after a gesture. dialog() is the
// transaction dialog, if one is open. showDay steps the day
// slider once in a direction and waits for that day to draw.
// WithNetworkSwitch is the page next to a button that moves
// the router to the knf network — the page stays mounted.
// -----------------------------------------------------------

const saved = (key = KEY) => JSON.parse(localStorage.getItem(key) ?? 'null');

const savePositions = (positions, key = KEY) => localStorage.setItem(key, JSON.stringify(positions));

const FIVE = ['T1', 'T2', 'T3', 'T4', 'T5'];

const screenOf = (names = FIVE) => Object.fromEntries(names.map((name) => [name, onScreen(getBox(T[name]))]));

const dialog = () => screen.queryByRole('dialog', { name: 'Transakcija' });

async function showDay(user, button) {
  await user.click(await screen.findByRole('button', { name: button }));
  await waitFor(() => expect(queryBox(T.T1)).not.toBeNull());
}

async function closeDialog(user) {
  const [, footerClose] = within(dialog()).getAllByRole('button', { name: 'Uždaryti' });
  await user.click(footerClose);
  await waitFor(() => expect(dialog()).toBeNull());
}

function WithNetworkSwitch() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/graph/utxo/knf')}>Į KNF tinklą</button>
      <GraphUtxoPage />
    </>
  );
}







// -----------------------------------------------------------
// First layout
// -----------------------------------------------------------

describe('First layout', () => {

  it("stacks a column's boxes top to bottom in the day's order, every column starting at the same top", async () => {
    renderGraph();
    await findBox(T.T5);
    const at = Object.fromEntries(FIVE.map((name) => [name, positionOf(getBox(T[name]))]));
    expect(new Set([at.T1.y, at.T2.y, at.T3.y, at.T5.y]).size).toBe(1);
    expect(at.T4.y).toBeGreaterThan(at.T3.y + 88);
  });


  it('starts a transaction spending another of the same block to the right of its parent', async () => {
    renderGraph();
    await findBox(T.T4);
    const parent = positionOf(getBox(T.T3));
    const child = positionOf(getBox(T.T4));
    expect(child.x).toBeGreaterThanOrEqual(parent.x + NODE_CONFIG.WIDTH);
    expect(child.x - parent.x).toBeLessThan(2 * NODE_CONFIG.WIDTH);
  });


  it('reads a chain waiting together in the mempool left to right too', async () => {
    const child = transaction({ txid: X.JOIN, block: null, inputs: [spend(T.T5, 2, f.JONAS, 4998600)], outputs: [coin(f.EGLE, 4997000)], fee: 1600 });
    answerGraph({ transactions: [...dayTransactions(), child] });
    renderGraph();
    await findBox(X.JOIN);
    expect(positionOf(getBox(X.JOIN)).x).toBeGreaterThanOrEqual(positionOf(getBox(T.T5)).x + NODE_CONFIG.WIDTH);
  });


  it('gives a transaction arriving with a poll its own first-layout spot, while a dragged box stays where it was dropped', async () => {
    useFakeClock();
    const withoutT5 = dayTransactions().filter((tx) => tx.txid !== T.T5);
    answerGraph({ transactions: withoutT5 }, {});
    renderGraph();
    const t1 = await findBox(T.T1);
    dragBy(t1, 40, 200);
    const dropped = positionOf(t1);

    await advance(5000);
    const t5 = await findBox(T.T5);
    expect(positionOf(getBox(T.T1))).toEqual(dropped);
    expect(positionOf(t5).y).toBe(positionOf(getBox(T.T2)).y);
  });
});







// -----------------------------------------------------------
// Click or drag
// -----------------------------------------------------------
//
// A press that never travels 4 screen pixels is a click.
// -----------------------------------------------------------

describe('Click or drag', () => {

  it('a press released within 4 px is a click: it opens the dialog and moves nothing', async () => {
    renderGraph();
    const box = await findBox(T.T1);
    const before = screenOf();
    press(box, { x: 100, y: 100 });
    moveTo(box, 102, 102);
    release(box, 102, 102);

    const opened = await screen.findByRole('dialog', { name: 'Transakcija' });
    expect(within(opened).getByText(T.T1)).toBeInTheDocument();
    expect(onScreen(box)).toEqual(before.T1);
    expect(saved()).toEqual({});
  });


  it('a press travelling 4 px or more is a drag: the box follows, no dialog opens', async () => {
    renderGraph();
    const box = await findBox(T.T1);
    const before = onScreen(box);
    press(box, { x: 100, y: 100 });
    moveTo(box, 103, 103);
    release(box, 103, 103);

    expect(onScreen(box)).toEqual({ x: before.x + 3, y: before.y + 3 });
    await settle(50);
    expect(dialog()).toBeNull();
  });


  it('once past the slop, coming back to where the press began is still a drag — and puts the box back exactly', async () => {
    renderGraph();
    const box = await findBox(T.T1);
    const before = screenOf();
    press(box, { x: 100, y: 100 });
    moveTo(box, 160, 130);
    moveTo(box, 100, 100);
    release(box, 100, 100);

    expect(screenOf()).toEqual(before);
    await settle(50);
    expect(dialog()).toBeNull();
  });


  it('counts the slop in screen pixels whatever the zoom', async () => {
    const { user } = renderGraph();
    const box = await findBox(T.T1);
    for (let step = 0; step < 5; step += 1) await user.click(screen.getByRole('button', { name: 'Nutolinti' }));

    // At 0.5 a 3 px press is still a click …
    press(box, { x: 100, y: 100 });
    moveTo(box, 103, 100);
    release(box, 103, 100);
    await screen.findByRole('dialog', { name: 'Transakcija' });
    await closeDialog(user);

    // … and a 5 px one a drag of 10 canvas units
    const before = positionOf(box);
    dragBy(box, 5, 0);
    expect(positionOf(box).x).toBeCloseTo(before.x + 10, 6);
  });


  it('Enter or Space on a focused box opens its dialog; any other key does not', async () => {
    const { user } = renderGraph();
    const box = await findBox(T.T2);

    expect(fireEvent.keyDown(box, { key: 'a' })).toBe(true);
    await settle(50);
    expect(dialog()).toBeNull();

    // The key's default (Space scrolling the page) is prevented
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false);
    expect(within(await screen.findByRole('dialog', { name: 'Transakcija' })).getByText(T.T2)).toBeInTheDocument();
    await closeDialog(user);

    expect(fireEvent.keyDown(getBox(T.T2), { key: ' ' })).toBe(false);
    expect(within(await screen.findByRole('dialog', { name: 'Transakcija' })).getByText(T.T2)).toBeInTheDocument();
  });


  it('opens the dialog from the keyboard too: focus a box and press Enter', async () => {
    const { user } = renderGraph();
    const box = await findBox(T.T3);
    box.focus();
    await user.keyboard('{Enter}');
    expect(within(await screen.findByRole('dialog', { name: 'Transakcija' })).getByText(T.T3)).toBeInTheDocument();
  });


  it('ignores a press of any button but the primary one', async () => {
    renderGraph();
    const box = await findBox(T.T1);
    const before = onScreen(box);
    press(box, { x: 100, y: 100, button: 2 });
    moveTo(box, 150, 150);
    release(box, 150, 150);

    expect(onScreen(box)).toEqual(before);
    await settle(50);
    expect(dialog()).toBeNull();
  });


  it('a press the browser cancels opens nothing, and the next press works as usual', async () => {
    renderGraph();
    const box = await findBox(T.T1);
    press(box, { x: 100, y: 100 });
    fireEvent.pointerCancel(box, { pointerId: 1 });
    await settle(50);
    expect(dialog()).toBeNull();

    press(box, { x: 100, y: 100 });
    release(box, 100, 100);
    await screen.findByRole('dialog', { name: 'Transakcija' });
  });


  it('lets only the pointer that started the press move and end it — a second one is ignored', async () => {
    renderGraph();
    const t1 = await findBox(T.T1);
    const t2 = getBox(T.T2);
    const before = screenOf();

    press(t1, { x: 100, y: 100, pointerId: 1 });
    press(t2, { x: 400, y: 100, pointerId: 2 });
    moveTo(t2, 460, 160, { pointerId: 2 });
    moveTo(t1, 460, 160, { pointerId: 2 });
    release(t1, 460, 160, { pointerId: 2 });
    expect(screenOf()).toEqual(before);

    moveTo(t1, 100, 120, { pointerId: 1 });
    release(t1, 100, 120, { pointerId: 1 });
    expect(onScreen(t1)).toEqual({ x: before.T1.x, y: before.T1.y + 20 });
    expect(onScreen(getBox(T.T2))).toEqual(before.T2);
  });


  it('draws the pressed box once more on top of the rest until it is let go', async () => {
    renderGraph();
    const box = await findBox(T.T2);
    press(box, { x: 100, y: 100 });
    expect(document.querySelector('use')).toHaveAttribute('href', `#${box.id}`);
    moveTo(box, 150, 100);
    expect(document.querySelector('use')).toHaveAttribute('href', `#${box.id}`);
    release(box, 150, 100);
    expect(document.querySelector('use')).toBeNull();
  });


  it.fails('a box leaving the day while pressed does not swallow the next click on another box — PINNED KNOWN BUG: nothing ends the vanished box\'s press, so the next click only ends it and opens nothing', async () => {
    useFakeClock();
    const withoutT5 = dayTransactions().filter((tx) => tx.txid !== T.T5);
    answerGraph({}, { transactions: withoutT5 });
    const { user } = renderGraph();
    const t5 = await findBox(T.T5);

    // Pressed as the poll drops T5 from the mempool (replaced,
    // evicted): the box — and its pointer capture — are gone,
    // and the release lands on the empty canvas
    press(t5, { x: 500, y: 100 });
    await advance(5000);
    await waitFor(() => expect(queryBox(T.T5)).toBeNull());
    release(scroller(), 500, 100);

    await user.click(getBox(T.T1));
    const opened = await screen.findByRole('dialog', { name: 'Transakcija' }, { timeout: 1000 });
    expect(within(opened).getByText(T.T1)).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Dragging a box
// -----------------------------------------------------------
//
// One box moves; its block grows in the drag's direction and
// the scroll follows, so on screen the dragged box stays under
// the pointer and everything it did not push stays put.
// -----------------------------------------------------------

describe('Dragging a box', () => {

  it('moves only the dragged box while it stays inside its block', async () => {
    renderGraph();
    const box = await findBox(T.T3);
    const before = screenOf();
    const cells = headerCells();
    dragBy(box, 10, 40);

    expect(screenOf()).toEqual({ ...before, T3: { x: before.T3.x + 10, y: before.T3.y + 40 } });
    expect(headerCells()).toEqual(cells);
  });


  it('resolves every move against where the press began — moving back undoes the push exactly', async () => {
    renderGraph();
    const box = await findBox(T.T1);
    const before = screenOf();
    const cells = headerCells();
    press(box, { x: 100, y: 100 });
    moveTo(box, 250, 100);
    expect(onScreen(getBox(T.T2)).x).toBeGreaterThan(before.T2.x);
    moveTo(box, 100, 100);
    release(box, 100, 100);

    expect(screenOf()).toEqual(before);
    expect(headerCells()).toEqual(cells);
  });


  it('past the right edge the block grows and pushes the later blocks right', async () => {
    renderGraph();
    const box = await findBox(T.T1);
    const before = screenOf();
    const width = headerCells()[0].width;
    dragBy(box, 100, 0);

    const after = screenOf();
    expect(after.T1).toEqual({ x: before.T1.x + 100, y: before.T1.y });
    for (const name of ['T2', 'T3', 'T4', 'T5']) expect(after[name]).toEqual({ x: before[name].x + 100, y: before[name].y });
    expect(headerCells()[0].width).toBe(width + 100);
  });


  it('past the left edge the block grows leftward: the earlier blocks slide left, the later ones stay put', async () => {
    installViewport(800, 600);
    renderGraph();
    const box = await findBox(T.T2);
    const before = screenOf();
    dragBy(box, -60, 0);

    const after = screenOf();
    expect(after.T2).toEqual({ x: before.T2.x - 60, y: before.T2.y });
    expect(after.T1).toEqual({ x: before.T1.x - 60, y: before.T1.y });
    for (const name of ['T3', 'T4', 'T5']) expect(after[name]).toEqual(before[name]);
    expect(headerCells()[1].width).toBe(headerCells()[0].width + 60);
  });


  it('the first block grows into the whitespace on its left, nothing else moving', async () => {
    installViewport(800, 600);
    renderGraph();
    const box = await findBox(T.T1);
    const before = screenOf();
    dragBy(box, -60, 0);

    const after = screenOf();
    expect(after.T1).toEqual({ x: before.T1.x - 60, y: before.T1.y });
    for (const name of ['T2', 'T3', 'T4', 'T5']) expect(after[name]).toEqual(before[name]);
  });


  it('past the top the drawing grows upward — the box above the first row, at a negative y — and nothing else moves', async () => {
    installViewport(800, 600);
    renderGraph();
    const box = await findBox(T.T1);
    const before = screenOf();
    const canvasBefore = positionOf(box);
    dragBy(box, 0, -100);

    expect(positionOf(box)).toEqual({ x: canvasBefore.x, y: canvasBefore.y - 100 });
    expect(positionOf(box).y).toBeLessThan(0);
    const after = screenOf();
    expect(after.T1).toEqual({ x: before.T1.x, y: before.T1.y - 100 });
    for (const name of ['T2', 'T3', 'T4', 'T5']) expect(after[name]).toEqual(before[name]);
  });


  it('below the lowest box the drawing grows downward, nothing else moving', async () => {
    installViewport(800, 600);
    renderGraph();
    const box = await findBox(T.T4);
    const before = screenOf();
    const height = Number(graphGroup().getAttribute('height'));
    dragBy(box, 0, 300);

    expect(screenOf()).toEqual({ ...before, T4: { x: before.T4.x, y: before.T4.y + 300 } });
    expect(Number(graphGroup().getAttribute('height'))).toBe(height + 300);
  });


  it('keeps the dragged box under the pointer the whole way while its block grows leftward', async () => {
    installViewport(800, 600);
    renderGraph();
    const box = await findBox(T.T2);
    const start = onScreen(box);
    const t3 = onScreen(getBox(T.T3));
    press(box, { x: 400, y: 100 });
    for (let step = 1; step <= 10; step += 1) {
      moveTo(box, 400 - 12 * step, 100 - 5 * step);
      expect(onScreen(box)).toEqual({ x: start.x - 12 * step, y: start.y - 5 * step });
      expect(onScreen(getBox(T.T3))).toEqual(t3);
    }
    release(box, 280, 50);
  });


  it('counts the pointer\'s travel over the zoom: zoomed to 2×, a 100 px move is 50 canvas units', async () => {
    const { user } = renderGraph();
    const box = await findBox(T.T3);
    for (let step = 0; step < 10; step += 1) await user.click(screen.getByRole('button', { name: 'Priartinti' }));
    expect(screen.getByRole('slider', { name: 'Mastelis' })).toHaveValue('2');

    const canvas = positionOf(box);
    const before = onScreen(box);
    dragBy(box, 100, 60);
    expect(positionOf(box)).toEqual({ x: canvas.x + 50, y: canvas.y + 30 });
    expect(onScreen(box)).toEqual({ x: before.x + 100, y: before.y + 60 });
  });


  it('counts a scroll made during the drag in, so the box stays under the pointer', async () => {
    renderGraph();
    const box = await findBox(T.T3);
    const canvas = positionOf(box);
    const before = onScreen(box);
    press(box, { x: 100, y: 100 });
    scroller().scrollTop += 50;
    moveTo(box, 100, 110);
    release(box, 100, 110);

    expect(positionOf(box)).toEqual({ x: canvas.x, y: canvas.y + 60 });
    expect(onScreen(box)).toEqual({ x: before.x, y: before.y + 10 });
  });


  it('carries what the browser rounds off the scroll into the next shift, so a long drag never walks the drawing off by a pixel', async () => {
    renderGraph();
    const box = await findBox(T.T2);
    roundScrolling(scroller());
    const t3 = onScreen(getBox(T.T3));
    const start = onScreen(box);

    // Out of the click slop, then twenty moves of 0.7 px
    // leftwards (a high-resolution mouse): each grows the block
    // by 0.7, which a browser can only scroll by whole pixels
    press(box, { x: 400, y: 100 });
    moveTo(box, 390, 100);
    for (let step = 1; step <= 20; step += 1) {
      moveTo(box, 390 - 0.7 * step, 100);
      expect(Math.abs(onScreen(getBox(T.T3)).x - t3.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(onScreen(box).x - (start.x - 10 - 0.7 * step))).toBeLessThanOrEqual(1);
    }
    release(box, 376, 100);
  });


  it('keeps a waiting box under the pointer when it is mined in the middle of the drag', async () => {
    useFakeClock();
    const mined = { ...dayTransactions().find((tx) => tx.txid === T.T5), status: 'confirmed', block: 154396, time: '2026-09-29T11:20:00Z' };
    answerGraph({}, {
      blocks: [...f.utxoBlocks, { height: 154396, time: mined.time }],
      transactions: [...dayTransactions().filter((tx) => tx.txid !== T.T5), mined],
    });
    renderGraph();
    const box = await findBox(T.T5);
    const start = onScreen(box);

    press(box, { x: 500, y: 100 });
    moveTo(box, 480, 100);
    expect(onScreen(box)).toEqual({ x: start.x - 20, y: start.y });

    await advance(5000);
    await waitFor(() => expect(box).toHaveAccessibleName(/, blokas 154396$/));
    expect(onScreen(box)).toEqual({ x: start.x - 20, y: start.y });

    moveTo(box, 460, 100);
    expect(onScreen(box)).toEqual({ x: start.x - 40, y: start.y });
    release(box, 460, 100);
  });
});







// -----------------------------------------------------------
// The saved arrangement
// -----------------------------------------------------------
//
// Only the boxes a drag moved are kept, per network, when a
// drag ends.
// -----------------------------------------------------------

describe('The saved arrangement', () => {

  it("saves where a drag drops a box — rounded to whole canvas units — under the network's key, only once the drag ends", async () => {
    const { user } = renderGraph();
    const box = await findBox(T.T1);
    await user.click(screen.getByRole('button', { name: 'Priartinti' }));
    const start = positionOf(box);

    press(box, { x: 100, y: 100 });
    moveTo(box, 150, 130);
    expect(saved()).toEqual({});
    release(box, 150, 130);

    // 50 and 30 screen px at 1.1× are 45.45… and 27.27…
    // canvas units — kept exact on screen, stored whole
    expect(positionOf(box).x).toBeCloseTo(start.x + 50 / 1.1, 6);
    expect(saved()).toEqual({ [T.T1]: { x: Math.round(start.x + 50 / 1.1), y: Math.round(start.y + 30 / 1.1) } });
  });


  it('keeps only the boxes a drag moved, each by its txid', async () => {
    renderGraph();
    await findBox(T.T4);
    dragBy(getBox(T.T4), 20, 20);
    dragBy(getBox(T.T2), 0, 50);
    expect(Object.keys(saved())).toEqual([T.T4, T.T2]);
  });


  it('finds the arrangement as it was left when the page opens again', async () => {
    savePositions({ [T.T1]: { x: 500, y: 300 } });
    renderGraph();
    const box = await findBox(T.T1);
    expect(positionOf(box)).toEqual({ x: 500, y: 300 });
    // Its block grew around it, pushing the next one along
    expect(headerCells()[1].x).toBe(500 + NODE_CONFIG.WIDTH + LAYOUT_CONFIG.COLUMN_PADDING);
  });


  it("opens a day whose saved arrangement reaches above the first row with the drawing's top at the top of the view", async () => {
    installViewport(800, 600);
    savePositions({ [T.T1]: { x: 24, y: -100 } });
    renderGraph();
    const box = await findBox(T.T1);
    // The raised box sits one column padding under the pinned
    // row; the rest keep their distance below it
    const top = onScreen(box).y;
    expect(top).toBe(LAYOUT_CONFIG.HEADER_HEIGHT + LAYOUT_CONFIG.COLUMN_PADDING);
    expect(onScreen(getBox(T.T2)).y).toBe(top + 124);
  });


  it("keeps each network's arrangement apart", async () => {
    savePositions({ [T.T1]: { x: 500, y: 300 } });
    renderGraph({ network: 'knf' });
    const box = await findBox(T.T1);
    expect(positionOf(box)).toEqual({ x: 24, y: 24 });

    dragBy(box, 30, 0);
    expect(saved('utxo-graph-positions:knf')).toEqual({ [T.T1]: { x: 54, y: 24 } });
    expect(saved()).toEqual({ [T.T1]: { x: 500, y: 300 } });
  });


  it("swaps in the other network's arrangement when the page moves to it", async () => {
    savePositions({ [T.T1]: { x: 500, y: 300 } });
    savePositions({ [T.T1]: { x: 200, y: 100 } }, 'utxo-graph-positions:knf');
    const { user } = renderPage(<WithNetworkSwitch />, { route: '/graph/utxo/btc4', path: '/graph/utxo/:network' });
    expect(positionOf(await findBox(T.T1))).toEqual({ x: 500, y: 300 });

    await user.click(screen.getByRole('button', { name: 'Į KNF tinklą' }));
    await waitFor(() => expect(positionOf(getBox(T.T1))).toEqual({ x: 200, y: 100 }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Transakcijų Srautas - KNF Coin');
  });


  it('ignores storage that is not JSON', async () => {
    localStorage.setItem(KEY, 'not json{');
    renderGraph();
    expect(positionOf(await findBox(T.T1))).toEqual({ x: 24, y: 24 });
  });


  it('skips every entry that is not a pair of finite numbers and keeps the rest', async () => {
    savePositions({
      [T.T1]: { x: 'a', y: 5 },
      [T.T2]: null,
      [T.T4]: { x: 1 },
      [T.T3]: { x: 100, y: 200 },
    });
    renderGraph();
    await findBox(T.T4);
    expect(positionOf(getBox(T.T1))).toEqual({ x: 24, y: 24 });
    expect(positionOf(getBox(T.T2)).y).toBe(24);
    expect(positionOf(getBox(T.T3))).toEqual({ x: headerCells()[2].x + 100, y: 200 });
  });


  it('shrugs off storage holding a list, a string or null', async () => {
    for (const junk of ['[1, 2]', '"text"', 'null']) {
      localStorage.setItem(KEY, junk);
      const { unmount } = renderGraph();
      expect(positionOf(await findBox(T.T1))).toEqual({ x: 24, y: 24 });
      unmount();
    }
  });


  it('draws and drags as usual when the browser blocks storage (a private window)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    renderGraph();
    const box = await findBox(T.T1);
    const before = onScreen(box);
    dragBy(box, 30, 30);
    expect(onScreen(box)).toEqual({ x: before.x + 30, y: before.y + 30 });
  });


  it('keeps at most the 2000 most recently moved boxes, the oldest falling out first', async () => {
    const old = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`old-${i}`, { x: i, y: i }]));
    savePositions(old);
    renderGraph();
    dragBy(await findBox(T.T1), 10, 10);

    const keys = Object.keys(saved());
    expect(keys).toHaveLength(2000);
    expect(keys[0]).toBe('old-1');
    expect(keys.at(-1)).toBe(T.T1);
  });


  it('makes a box moved again the newest, so it outlives the older ones', async () => {
    const old = Object.fromEntries([[T.T1, { x: 30, y: 30 }], ...Array.from({ length: 1999 }, (_, i) => [`old-${i}`, { x: i, y: i }])]);
    savePositions(old);
    renderGraph();
    dragBy(await findBox(T.T1), 10, 10);

    const keys = Object.keys(saved());
    expect(keys).toHaveLength(2000);
    expect(keys[0]).toBe('old-0');
    expect(keys.at(-1)).toBe(T.T1);
    expect(saved()[T.T1]).toEqual({ x: 40, y: 40 });
  });


  it('keeps dragged boxes where they were left across a day switch and back', async () => {
    const { user } = renderGraph();
    const box = await findBox(T.T1);
    dragBy(box, 60, 90);
    const dropped = positionOf(box);

    await showDay(user, 'Ankstesnė diena');
    await waitFor(() => expect(queryBox(T.T5)).toBeNull());
    expect(positionOf(getBox(T.T1))).toEqual(dropped);

    await showDay(user, 'Kita diena');
    await findBox(T.T5);
    expect(positionOf(getBox(T.T1))).toEqual(dropped);
  });
});

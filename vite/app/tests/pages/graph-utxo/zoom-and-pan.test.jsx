// -----------------------------------------------------------
//  [*] Tests — UTXO graph: zoom, margins and panning
//
//  useZoom, ZoomControls and useBackgroundPan through the
//  page: the + / − buttons and the vertical "Mastelis" slider
//  (one step, the keyboard, the 0.2–2 clamp) zooming around
//  the middle of the view; the mouse wheel zooming around the
//  cursor, measured from the view's own corner (up in, down
//  out, Firefox's line steps, a big spin clamped, the page kept
//  from scrolling, a sideways trackpad swipe left alone); the
//  whitespace margin one view wide and tall around the drawing
//  — the drawing's corner landing at the view's corner under
//  the pinned row once the view is measured, staying put on
//  screen when the view resizes, and a new day or network
//  starting from the corner again; the pinned row
//  following the zoom sideways at its own height; and the
//  background drag that pans the view 1:1 (not from a box, the
//  scroller's own scrollbars, a finger or another button; one
//  pointer; ended by a release or a cancel). Where jsdom has no
//  layout, the view gets its size from support's
//  installViewport (800 × 600).
// -----------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { renderPage } from '../../support/render';
import { mediaQueryMatches } from '../../support/setup';
import {
  pinToday, renderGraph, findBox, getBox, queryBox, onScreen, zoomOf, scroller, header, drawing, graphGroup, headerCells,
  installViewport, press, moveTo, release,
} from '../../support/graph-utxo/graph';
import { T } from '../../support/graph-utxo/transactions';
import { LAYOUT_CONFIG } from '@/pages/Graph_UTXO/constants';
import GraphUtxoPage from '@/pages/Graph_UTXO/Page';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// zoom() is what the slider reads. canvasPointAt(cx, cy) is
// the point of the drawing (canvas units) under a spot of the
// view — the inverse of support's onScreen — so a zoom can be
// checked to keep its anchor in place. pressTimes clicks a
// zoom button n times. lane() is the first block's background
// band: empty canvas to grab. WithNetworkSwitch is the page
// beside a button that moves the router to another network.
// -----------------------------------------------------------

const slider = () => screen.getByRole('slider', { name: 'Mastelis' });
const zoom = () => Number(slider().value);

function canvasPointAt(cx, cy) {
  const { left, top, scale } = zoomOf();
  const view = scroller();
  const rowHeight = Number(header().getAttribute('height'));
  return { x: (view.scrollLeft + cx - left) / scale, y: (view.scrollTop + cy - rowHeight - top) / scale };
}

async function pressTimes(user, name, times) {
  const button = screen.getByRole('button', { name });
  for (let i = 0; i < times; i += 1) await user.click(button);
}

const lane = () => drawing().querySelector(':scope > g > rect');

const wheel = (init) => fireEvent.wheel(scroller(), { bubbles: true, cancelable: true, ...init });

// The page next to a button that moves the router to the knf
// network — the page stays mounted
function WithNetworkSwitch() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/graph/utxo/knf')}>Į KNF tinklą</button>
      <GraphUtxoPage />
    </>
  );
}

const expectSamePoint = (a, b) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};







// -----------------------------------------------------------
// Buttons and slider
// -----------------------------------------------------------

describe('Zoom buttons and slider', () => {

  it('opens at 1:1 on a vertical slider running from 0.2 to 2', async () => {
    renderGraph();
    await findBox(T.T1);
    expect(slider()).toHaveAttribute('aria-orientation', 'vertical');
    expect(slider()).toHaveAttribute('min', '0.2');
    expect(slider()).toHaveAttribute('max', '2');
    expect(zoom()).toBe(1);
    expect(zoomOf().scale).toBe(1);
  });


  it('zooms in one step with "Priartinti" and out one step with "Nutolinti", the drawing scaling along', async () => {
    const { user } = renderGraph();
    await findBox(T.T1);
    await pressTimes(user, 'Priartinti', 1);
    expect(zoom()).toBeCloseTo(1.1, 10);
    expect(zoomOf().scale).toBeCloseTo(1.1, 10);

    await pressTimes(user, 'Nutolinti', 2);
    expect(zoom()).toBeCloseTo(0.9, 10);
    expect(zoomOf().scale).toBeCloseTo(0.9, 10);
  });


  it('stops at 2× and at 0.2× however often the buttons are pressed', async () => {
    const { user } = renderGraph();
    await findBox(T.T1);
    await pressTimes(user, 'Priartinti', 14);
    expect(zoom()).toBe(2);
    expect(zoomOf().scale).toBe(2);

    await pressTimes(user, 'Nutolinti', 22);
    expect(zoom()).toBe(0.2);
    expect(zoomOf().scale).toBe(0.2);
  });


  it('sets the zoom from the slider: a step with the arrow keys, the limits with End and Home', async () => {
    const { user } = renderGraph();
    await findBox(T.T1);
    slider().focus();
    await user.keyboard('{ArrowUp}');
    expect(zoomOf().scale).toBeCloseTo(1.01, 10);
    await user.keyboard('{End}');
    expect(zoomOf().scale).toBe(2);
    await user.keyboard('{Home}');
    expect(zoomOf().scale).toBe(0.2);
  });


  it('zooms around the middle of the view: the point of the drawing there stays there', async () => {
    installViewport(800, 600);
    const { user } = renderGraph();
    await findBox(T.T1);
    const middle = canvasPointAt(400, 300);

    await pressTimes(user, 'Priartinti', 3);
    expectSamePoint(canvasPointAt(400, 300), middle);
    await pressTimes(user, 'Nutolinti', 7);
    expectSamePoint(canvasPointAt(400, 300), middle);

    fireEvent.change(slider(), { target: { value: '1.75' } });
    expect(zoomOf().scale).toBe(1.75);
    expectSamePoint(canvasPointAt(400, 300), middle);
  });


  it('leaves the view where it is when a press cannot zoom any further', async () => {
    installViewport(800, 600);
    const { user } = renderGraph();
    await findBox(T.T1);
    await pressTimes(user, 'Priartinti', 10);
    const scroll = [scroller().scrollLeft, scroller().scrollTop];
    await pressTimes(user, 'Priartinti', 2);
    expect([scroller().scrollLeft, scroller().scrollTop]).toEqual(scroll);
  });
});







// -----------------------------------------------------------
// The mouse wheel
// -----------------------------------------------------------
//
// Exponential: a 100 px notch is about 14 %.
// -----------------------------------------------------------

describe('Wheel zoom', () => {

  it('zooms in around the cursor as the wheel turns up, the point under the cursor staying put', async () => {
    installViewport(800, 600);
    renderGraph();
    await findBox(T.T1);
    const under = canvasPointAt(200, 150);

    wheel({ deltaY: -100, clientX: 200, clientY: 150 });
    expect(zoomOf().scale).toBeCloseTo(Math.exp(0.15), 10);
    expect(zoom()).toBeCloseTo(Math.exp(0.15), 10);
    expectSamePoint(canvasPointAt(200, 150), under);
  });


  it("measures the cursor from the view's own corner, wherever the view sits on the page", async () => {
    installViewport(800, 600);
    renderGraph();
    await findBox(T.T1);
    scroller().getBoundingClientRect = () => ({ left: 50, top: 120, right: 850, bottom: 720, width: 800, height: 600, x: 50, y: 120 });
    const under = canvasPointAt(200, 150);

    wheel({ deltaY: -100, clientX: 250, clientY: 270 });
    expectSamePoint(canvasPointAt(200, 150), under);
  });


  it('zooms out as the wheel turns down', async () => {
    installViewport(800, 600);
    renderGraph();
    await findBox(T.T1);
    const under = canvasPointAt(650, 420);
    wheel({ deltaY: 100, clientX: 650, clientY: 420 });
    expect(zoomOf().scale).toBeCloseTo(Math.exp(-0.15), 10);
    expectSamePoint(canvasPointAt(650, 420), under);
  });


  it('keeps the page from scrolling instead of zooming', async () => {
    renderGraph();
    await findBox(T.T1);
    expect(wheel({ deltaY: -100, clientX: 10, clientY: 10 })).toBe(false);
  });


  it('leaves a mostly sideways gesture (a trackpad swipe) to scroll the canvas', async () => {
    renderGraph();
    await findBox(T.T1);
    expect(wheel({ deltaX: 80, deltaY: 10, clientX: 10, clientY: 10 })).toBe(true);
    expect(zoomOf().scale).toBe(1);
  });


  it("counts Firefox's line steps as 16 px a line", async () => {
    renderGraph();
    await findBox(T.T1);
    wheel({ deltaY: -3, deltaMode: 1, clientX: 10, clientY: 10 });
    expect(zoomOf().scale).toBeCloseTo(Math.exp(48 * 0.0015), 10);
  });


  it('clamps a big spin to 2× and to 0.2×', async () => {
    renderGraph();
    await findBox(T.T1);
    wheel({ deltaY: -5000, clientX: 10, clientY: 10 });
    expect(zoom()).toBe(2);
    wheel({ deltaY: 50000, clientX: 10, clientY: 10 });
    expect(zoom()).toBe(0.2);
  });
});







// -----------------------------------------------------------
// Margins and the view
// -----------------------------------------------------------
//
// The drawing floats in whitespace one view wide on either
// side and one view tall above and below.
// -----------------------------------------------------------

describe('Margins and the view', () => {

  it("lands the drawing's top-left corner at the view's top-left, just under the pinned row, once the view is measured", async () => {
    installViewport(800, 600);
    renderGraph();
    const box = await findBox(T.T1);
    expect(onScreen(box)).toEqual({ x: LAYOUT_CONFIG.COLUMN_PADDING, y: LAYOUT_CONFIG.HEADER_HEIGHT + LAYOUT_CONFIG.COLUMN_PADDING });
    expect(canvasPointAt(0, LAYOUT_CONFIG.HEADER_HEIGHT)).toEqual({ x: 0, y: 0 });
  });


  it('surrounds the drawing with one view of whitespace on every side', async () => {
    installViewport(800, 600);
    renderGraph();
    await findBox(T.T5);
    const drawingWidth = headerCells().reduce((sum, cell) => sum + cell.width, 0);
    expect(Number(graphGroup().getAttribute('width'))).toBe(Math.ceil(drawingWidth + 2 * 800));
    expect(zoomOf()).toMatchObject({ left: 800, top: 600 });
    expect(headerCells()[0].x).toBe(800);
  });


  it('keeps the drawing where it is on screen when the view is resized', async () => {
    const view = installViewport(800, 600);
    renderGraph();
    const box = await findBox(T.T1);
    const before = onScreen(box);

    view.resize(1000, 700);
    await waitFor(() => expect(zoomOf()).toMatchObject({ left: 1000, top: 700 }));
    expect(onScreen(box)).toEqual(before);
  });


  it("starts a new day from the drawing's top-left corner, however far the view was panned", async () => {
    installViewport(800, 600);
    const { user } = renderGraph();
    const box = await findBox(T.T1);
    const home = onScreen(box);

    press(lane(), { x: 300, y: 300 });
    moveTo(lane(), 100, 50);
    release(lane(), 100, 50);
    expect(onScreen(box)).not.toEqual(home);

    await user.click(await screen.findByRole('button', { name: 'Ankstesnė diena' }));
    await waitFor(() => expect(queryBox(T.T5)).toBeNull());
    await findBox(T.T1);
    expect(onScreen(getBox(T.T1))).toEqual(home);
  });


  it("starts another network from the drawing's top-left corner too", async () => {
    installViewport(800, 600);
    const { user } = renderPage(<WithNetworkSwitch />, { route: '/graph/utxo/btc4', path: '/graph/utxo/:network' });
    const box = await findBox(T.T1);
    const home = onScreen(box);
    press(lane(), { x: 300, y: 300 });
    moveTo(lane(), 120, 80);
    release(lane(), 120, 80);
    expect(onScreen(box)).not.toEqual(home);

    await user.click(screen.getByRole('button', { name: 'Į KNF tinklą' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Transakcijų Srautas - KNF Coin'));
    await findBox(T.T1);
    expect(onScreen(getBox(T.T1))).toEqual(home);
  });


  it('moves the pinned row sideways with the zoom while it keeps its own height', async () => {
    installViewport(800, 600);
    const { user } = renderGraph();
    await findBox(T.T1);
    const before = headerCells();
    await pressTimes(user, 'Priartinti', 2);

    const scale = zoomOf().scale;
    headerCells().forEach((cell, i) => expect(cell.x).toBeCloseTo(800 + (before[i].x - 800) * scale, 6));
    expect(header()).toHaveAttribute('height', String(LAYOUT_CONFIG.HEADER_HEIGHT));
  });
});







// -----------------------------------------------------------
// Background pan
// -----------------------------------------------------------
//
// A mouse press on empty canvas grabs it; the content follows
// the pointer 1:1.
// -----------------------------------------------------------

describe('Background pan', () => {

  it('scrolls the view with a drag of the empty canvas, the drawing following the pointer', async () => {
    installViewport(800, 600);
    renderGraph();
    const box = await findBox(T.T1);
    const before = onScreen(box);
    const scroll = { left: scroller().scrollLeft, top: scroller().scrollTop };

    press(lane(), { x: 300, y: 300 });
    moveTo(lane(), 400, 350);
    expect(scroller().scrollLeft).toBe(scroll.left - 100);
    expect(scroller().scrollTop).toBe(scroll.top - 50);
    expect(onScreen(box)).toEqual({ x: before.x + 100, y: before.y + 50 });

    moveTo(lane(), 250, 200);
    expect(onScreen(box)).toEqual({ x: before.x - 50, y: before.y - 100 });
    release(lane(), 250, 200);
  });


  it('keeps the press from selecting text or moving the focus', async () => {
    renderGraph();
    await findBox(T.T1);
    expect(press(lane(), { x: 300, y: 300 })).toBe(false);
    release(lane(), 300, 300);
  });


  it('ends the pan on release — later moves scroll nothing', async () => {
    installViewport(800, 600);
    renderGraph();
    await findBox(T.T1);
    press(lane(), { x: 300, y: 300 });
    moveTo(lane(), 320, 330);
    release(lane(), 320, 330);
    const scroll = [scroller().scrollLeft, scroller().scrollTop];

    moveTo(lane(), 500, 500);
    expect([scroller().scrollLeft, scroller().scrollTop]).toEqual(scroll);
  });


  it('ends the pan when the browser cancels the pointer', async () => {
    installViewport(800, 600);
    renderGraph();
    await findBox(T.T1);
    press(lane(), { x: 300, y: 300 });
    fireEvent.pointerCancel(lane(), { pointerId: 1, pointerType: 'mouse' });
    const scroll = [scroller().scrollLeft, scroller().scrollTop];
    moveTo(lane(), 500, 500);
    expect([scroller().scrollLeft, scroller().scrollTop]).toEqual(scroll);
  });


  it('follows only the pointer that grabbed the canvas', async () => {
    installViewport(800, 600);
    renderGraph();
    await findBox(T.T1);
    press(lane(), { x: 300, y: 300, pointerId: 1 });
    const scroll = [scroller().scrollLeft, scroller().scrollTop];
    moveTo(lane(), 500, 500, { pointerId: 2 });
    release(lane(), 500, 500, { pointerId: 2 });
    expect([scroller().scrollLeft, scroller().scrollTop]).toEqual(scroll);

    moveTo(lane(), 310, 300, { pointerId: 1 });
    expect(scroller().scrollLeft).toBe(scroll[0] - 10);
  });


  it('leaves a press on a box to the box: it drags the box, the view stays', async () => {
    installViewport(800, 600);
    renderGraph();
    const box = await findBox(T.T3);
    const scroll = [scroller().scrollLeft, scroller().scrollTop];
    const before = onScreen(box);
    press(box, { x: 300, y: 300 });
    moveTo(box, 330, 340);
    release(box, 330, 340);

    expect([scroller().scrollLeft, scroller().scrollTop]).toEqual(scroll);
    expect(onScreen(box)).toEqual({ x: before.x + 30, y: before.y + 40 });
  });


  it("leaves a press on the scroller itself — its scrollbars — to the browser", async () => {
    installViewport(800, 600);
    renderGraph();
    await findBox(T.T1);
    const scroll = [scroller().scrollLeft, scroller().scrollTop];
    expect(press(scroller(), { x: 790, y: 300 })).toBe(true);
    moveTo(scroller(), 700, 200);
    expect([scroller().scrollLeft, scroller().scrollTop]).toEqual(scroll);
  });


  it('leaves a finger and every mouse button but the primary one to the browser', async () => {
    installViewport(800, 600);
    renderGraph();
    await findBox(T.T1);
    const scroll = [scroller().scrollLeft, scroller().scrollTop];

    press(lane(), { x: 300, y: 300, pointerType: 'touch' });
    moveTo(lane(), 400, 400, { pointerType: 'touch' });
    release(lane(), 400, 400, { pointerType: 'touch' });
    press(lane(), { x: 300, y: 300, button: 1 });
    moveTo(lane(), 400, 400);
    release(lane(), 400, 400);

    expect([scroller().scrollLeft, scroller().scrollTop]).toEqual(scroll);
  });
});

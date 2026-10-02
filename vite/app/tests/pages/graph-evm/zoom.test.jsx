// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: zooming
//
//  The floating zoom panel (ZoomControls) and every way to
//  zoom, all funnelled through one clamp to 0.2 … 2.0: the
//  vertical slider "Mastelis" starting at the graph's own
//  scale (1 while the canvas cannot say), "Priartinti" /
//  "Nutolinti" stepping by 0.1 and moving the camera there
//  with the view position kept and no animation, the limits,
//  the slider's own keys and drags, and the mouse wheel —
//  vis's 'zoom' event, which moves the slider and, past a
//  limit, pushes the camera back to it. The camera commands
//  are what the vis-network double records (moveTo).
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { settle } from '../../support/backend/contract';
import { networkDefaults, liveNetwork, networks } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, renderGraph, bootedNetwork, canvas, transferRows,
  dayPicker, NAMES, DAY_TRANSFERS,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// The zoom slider is the vertical one; its value is read as
// a number (0.1 steps are floating point). The camera the
// double saw last is `lastMove`.
// -----------------------------------------------------------

const zoomSlider = () => screen.getAllByRole('slider').find((slider) => slider.getAttribute('aria-orientation') === 'vertical');
const zoomValue = () => Number(zoomSlider().getAttribute('aria-valuenow'));
const zoomIn = () => screen.getByRole('button', { name: 'Priartinti' });
const zoomOut = () => screen.getByRole('button', { name: 'Nutolinti' });
const lastMove = (network) => network.moves.at(-1);

async function drawnGraph() {
  installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
  const view = renderGraph();
  const network = await bootedNetwork({ transfers: 3 });
  return { ...view, network };
}







// -----------------------------------------------------------
// The panel
// -----------------------------------------------------------
//
// Where the slider starts and what it spans.
// -----------------------------------------------------------

describe('The zoom panel', () => {

  it('offers a vertical slider from 0.2 to 2 between "Priartinti" and "Nutolinti"', async () => {
    await drawnGraph();
    expect(zoomSlider()).toHaveAttribute('aria-orientation', 'vertical');
    expect(zoomSlider()).toHaveAttribute('aria-valuemin', '0.2');
    expect(zoomSlider()).toHaveAttribute('aria-valuemax', '2');
    expect(zoomIn()).toBeEnabled();
    expect(zoomOut()).toBeEnabled();
  });


  it('starts at the graph\'s own scale once it is drawn', async () => {
    networkDefaults.scale = 0.8;
    await drawnGraph();
    await waitFor(() => expect(zoomValue()).toBe(0.8));
  });


  it('sits at 1 while the graph is not drawn yet, and the buttons still move it', async () => {
    given.hang('get', '/api/evm/:network/get-stored-transactions');
    const { user } = renderGraph();
    await waitFor(() => expect(canvas()).toBeInTheDocument());
    expect(zoomValue()).toBe(1);
    await user.click(zoomIn());
    expect(zoomValue()).toBeCloseTo(1.1);
    expect(networks).toHaveLength(0);
  });


  it('a canvas that cannot report its scale yet leaves the slider at 1 — the graph works regardless', async () => {
    networkDefaults.scale = 0.5;
    networkDefaults.getScaleThrows = true;
    await drawnGraph();
    await settle(50);
    expect(zoomValue()).toBe(1);
    expect(transferRows()).toHaveLength(3);
  });


  it('a graph rebuilt for another day starts at that graph\'s own scale again', async () => {
    const { user, network } = await drawnGraph();
    await user.click(zoomIn());
    await user.click(zoomIn());
    expect(zoomValue()).toBeCloseTo(1.2);
    expect(network.scale).toBeCloseTo(1.2);

    await user.click(dayPicker());
    await user.click(await screen.findByRole('option', { name: '2026-09-29' }));
    await waitFor(() => expect(liveNetwork()).not.toBe(network));
    await bootedNetwork();
    await waitFor(() => expect(zoomValue()).toBe(1));
  });


  it('names the zoom slider "Mastelis" for assistive technology, like its two buttons', async () => {
    await drawnGraph();
    expect(zoomSlider()).toHaveAccessibleName('Mastelis');
    expect(screen.getByRole('slider', { name: 'Mastelis' })).toBe(zoomSlider());
  });
});







// -----------------------------------------------------------
// The buttons and the slider
// -----------------------------------------------------------
//
// ±0.1 per press, the camera moved there at once from where
// it looks, clamped at the limits; the slider sets the scale
// directly.
// -----------------------------------------------------------

describe('The buttons and the slider', () => {

  it('"Priartinti" zooms in by 0.1 and moves the camera there — same view position, no animation', async () => {
    const { user, network } = await drawnGraph();
    await user.click(zoomIn());
    expect(zoomValue()).toBeCloseTo(1.1);
    expect(lastMove(network)).toEqual({ position: { x: 12, y: 34 }, scale: expect.closeTo(1.1), animation: false });
  });


  it('"Nutolinti" zooms out by 0.1', async () => {
    const { user, network } = await drawnGraph();
    await user.click(zoomOut());
    await user.click(zoomOut());
    expect(zoomValue()).toBeCloseTo(0.8);
    expect(lastMove(network).scale).toBeCloseTo(0.8);
  });


  it('stops at 2 however often "Priartinti" is pressed', async () => {
    const { user, network } = await drawnGraph();
    await network.wheelZoom(1.95);
    await user.click(zoomIn());
    expect(zoomValue()).toBe(2);
    await user.click(zoomIn());
    expect(zoomValue()).toBe(2);
    expect(lastMove(network).scale).toBe(2);
  });


  it('stops at 0.2 however often "Nutolinti" is pressed', async () => {
    const { user, network } = await drawnGraph();
    await network.wheelZoom(0.25);
    await user.click(zoomOut());
    expect(zoomValue()).toBe(0.2);
    await user.click(zoomOut());
    expect(zoomValue()).toBe(0.2);
    expect(lastMove(network).scale).toBe(0.2);
  });


  it('the slider\'s arrow keys zoom by 0.01', async () => {
    const { user, network } = await drawnGraph();
    act(() => zoomSlider().focus());
    await user.keyboard('{ArrowUp}');
    expect(zoomValue()).toBeCloseTo(1.01);
    expect(lastMove(network).scale).toBeCloseTo(1.01);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(zoomValue()).toBeCloseTo(0.99);
  });


  it('Home and End on the slider jump to the limits', async () => {
    const { user, network } = await drawnGraph();
    act(() => zoomSlider().focus());
    await user.keyboard('{End}');
    expect(zoomValue()).toBe(2);
    expect(lastMove(network).scale).toBe(2);
    await user.keyboard('{Home}');
    expect(zoomValue()).toBe(0.2);
    expect(lastMove(network).scale).toBe(0.2);
  });


  it('moving the slider sets the zoom it points at', async () => {
    const { network } = await drawnGraph();
    fireEvent.change(zoomSlider(), { target: { value: '1.5' } });
    expect(zoomValue()).toBe(1.5);
    expect(lastMove(network)).toEqual({ position: { x: 12, y: 34 }, scale: 1.5, animation: false });
  });
});







// -----------------------------------------------------------
// The mouse wheel
// -----------------------------------------------------------
//
// vis zooms the camera itself and reports it ('zoom'): the
// slider follows, and a zoom past a limit is pushed back.
// -----------------------------------------------------------

describe('The mouse wheel', () => {

  it('a wheel zoom inside the limits moves the slider along, nothing pushed back', async () => {
    const { network } = await drawnGraph();
    await network.wheelZoom(1.37);
    expect(zoomValue()).toBe(1.37);
    expect(network.moves).toEqual([]);
  });


  it('a wheel zoom past 2 is pushed back to 2 where the camera looks', async () => {
    const { network } = await drawnGraph();
    network.viewPosition = { x: -40, y: 275 };
    await network.wheelZoom(3.4);
    expect(lastMove(network)).toEqual({ position: { x: -40, y: 275 }, scale: 2, animation: false });
    expect(network.scale).toBe(2);
    expect(zoomValue()).toBe(2);
  });


  it('a wheel zoom below 0.2 is pushed back to 0.2', async () => {
    const { network } = await drawnGraph();
    await network.wheelZoom(0.05);
    expect(lastMove(network)).toMatchObject({ scale: 0.2, animation: false });
    expect(zoomValue()).toBe(0.2);
  });


  it('a zoom event without a scale changes nothing', async () => {
    const { network } = await drawnGraph();
    await act(async () => { network.emit('zoom', { direction: '+', pointer: { x: 0, y: 0 } }); });
    await act(async () => { network.emit('zoom', { scale: 'big' }); });
    expect(zoomValue()).toBe(1);
    expect(network.moves).toEqual([]);
  });


  it('the buttons continue from where the wheel left the zoom', async () => {
    const { user, network } = await drawnGraph();
    await network.wheelZoom(1.5);
    await user.click(zoomIn());
    expect(zoomValue()).toBeCloseTo(1.6);
    expect(lastMove(network).scale).toBeCloseTo(1.6);
  });
});

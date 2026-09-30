// -----------------------------------------------------------
//  [*] Test support — the UTXO transaction graph
//
//  What the graph-utxo tests share, so each test only says
//  what it is about:
//
//    - the clock: today is pinned to 2026-09-30 12:00 local,
//      which makes the fixture's day (2026-09-29) yesterday —
//      a PAST day, not live — and the page open on a live
//      today; fake timers (advancing on their own, so msw,
//      MUI and Testing Library keep flowing) for the tests
//      that wait for polls, the midnight tick or a tooltip
//    - the page on its route, the day's [from, to) window the
//      way the page asks for it, and graph answers built like
//      the default handler's (the mempool only on a live
//      window) with a test's changes on top
//    - readers of the drawing, the way a student reads it: a
//      box by its short txid, where it sits on the canvas and
//      on the screen, the sender band, the frame, the rows of
//      its two halves with the mark each row ends in, the
//      pinned header cells and the spend curves
//    - the geometry jsdom lacks: a view with a size (a
//      ResizeObserver double that measures the scroller), and
//      a scroller that rounds its offsets like a browser
//    - pointer gestures on a box or the background
//
//  Split into:
//
//    Clock          — NOW / TODAY / YESTERDAY, pinToday,
//                     useFakeClock, advance
//    Page           — renderGraph, the endpoint paths,
//                     windowOf, graphFor, answerGraph
//    Drawing        — the graph group, scroller, header,
//                     boxes, positions, bands, rows, edges
//    Geometry       — installViewport, roundScrolling
//    Gestures       — press / moveTo / release / dragBy
//    Dialog         — openTransaction
//
//  Used by:
//    - tests/pages/graph-utxo/*
// -----------------------------------------------------------

import { vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderPage } from '../render';
import { given } from '../backend/server';
import * as f from '../backend/fixtures';
import { COLORS } from '@/pages/Graph_UTXO/constants';
import GraphUtxoPage from '@/pages/Graph_UTXO/Page';







// -----------------------------------------------------------
// Clock
// -----------------------------------------------------------
//
// NOW is local noon, so the local day is the same in every
// timezone the suite may run in. pinToday() fakes only Date
// (timers stay real); useFakeClock() fakes the timers too —
// call it BEFORE rendering, so the page's intervals are made
// on the fake clock. setup.js' vi.useRealTimers() undoes both
// after every test.
// -----------------------------------------------------------

export const NOW = new Date(2026, 8, 30, 12, 0, 0);
export const TODAY = '2026-09-30';
export const YESTERDAY = '2026-09-29';

// The timers the page and its libraries schedule with — never
// the microtask queue, performance or requestAnimationFrame
const FAKED = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'];

export function pinToday(now = NOW) {
  vi.setSystemTime(now);
}

export function useFakeClock(now = NOW) {
  vi.useFakeTimers({ now, shouldAdvanceTime: true, toFake: FAKED });
}

export async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}







// -----------------------------------------------------------
// Page
// -----------------------------------------------------------
//
// renderGraph mounts the page on its route pattern, so
// useParams hands it the network. windowOf is the unix window
// of a local day, as the query strings carry it. graphFor
// answers like the default handler — the mempool (T5) only on
// a live window — with `changes` spread over the body;
// answerGraph installs that as a capturing handler, `steps`
// answering one per request (the last repeats).
// -----------------------------------------------------------

export const GRAPH = '/api/utxo/:network/graph';
export const DAYS = '/api/utxo/:network/transaction-days';
export const TRANSACTION = '/api/utxo/:network/transaction/:txid';
export const RENAME = '/api/utxo/:network/set-address-name';
export const NETWORKS = '/api/utxo/networks';

export const GRAPH_NAME = 'UTXO transakcijų grafikas pagal blokus';

export function renderGraph({ network = 'btc4', ...options } = {}) {
  return renderPage(<GraphUtxoPage />, { route: `/graph/utxo/${network}`, path: '/graph/utxo/:network', ...options });
}

export function windowOf(day) {
  const [year, month, date] = day.split('-').map(Number);
  return {
    from: String(new Date(year, month - 1, date).getTime() / 1000),
    to: String(new Date(year, month - 1, date + 1).getTime() / 1000),
  };
}

export function graphFor(query, changes = {}) {
  const live = Number(query.get('to')) > Date.now() / 1000 - 3600;
  const body = { ...f.utxoGraph({ live }), ...(typeof changes === 'function' ? changes(live) : changes) };
  return body;
}

export function answerGraph(...steps) {
  let asked = 0;
  const all = steps.length ? steps : [{}];
  return given.capture('get', GRAPH, ({ query }) => {
    const step = all[Math.min(asked, all.length - 1)];
    asked += 1;
    return graphFor(query, step);
  });
}

// The requests of one day's window among the captured ones
export const askedFor = (calls, day) => calls.filter((call) => call.query.from === windowOf(day).from);







// -----------------------------------------------------------
// Drawing
// -----------------------------------------------------------
//
// The drawing's SVG is a group named for the graph; its
// parent is the scroller, whose first child is the pinned
// block-height row. Inside the SVG, ONE scaled group holds
// the lanes, the curves and the boxes. A box is a button
// named "Transakcija <short txid>, siuntėjas …"; its position
// is its transform. On screen (relative to the scroller's
// top-left) a box sits at the scaled group's offset plus its
// canvas position times the zoom, less the scroll — and the
// pinned row's height lower.
// -----------------------------------------------------------

export const shortOf = (txid) => `${txid.slice(0, 6)}…${txid.slice(-4)}`;

// hidden: true — the readers of the drawing's geometry must
// work while a dialog hides the page from assistive tech
export const graphGroup = () => screen.getByRole('group', { name: GRAPH_NAME, hidden: true });
export const scroller = () => graphGroup().parentElement;
export const header = () => scroller().firstElementChild;
export const drawing = () => graphGroup().querySelector(':scope > g');

export const boxName = (txid) => new RegExp(`^Transakcija ${shortOf(txid)},`);
export const findBox = (txid) => screen.findByRole('button', { name: boxName(txid) });
export const getBox = (txid) => screen.getByRole('button', { name: boxName(txid) });
export const queryBox = (txid) => screen.queryByRole('button', { name: boxName(txid) });
export const allBoxes = () => screen.queryAllByRole('button', { name: /^Transakcija / });

const numbers = (text) => (text.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);

export function positionOf(box) {
  const [x, y] = numbers(box.getAttribute('transform'));
  return { x, y };
}

export function zoomOf() {
  const [left, top, scale] = numbers(drawing().getAttribute('transform'));
  return { left, top, scale };
}

export function onScreen(box) {
  const { left, top, scale } = zoomOf();
  const { x, y } = positionOf(box);
  const view = scroller();
  const rowHeight = Number(header().getAttribute('height'));
  return { x: left + x * scale - view.scrollLeft, y: rowHeight + top + y * scale - view.scrollTop };
}

// The band: the sender, the fee, the short txid, the full
// txid on hover, and the band's colour
export function bandOf(box) {
  const band = [...box.children].find((node) => node.tagName === 'g' && node.querySelectorAll(':scope > text').length === 3);
  const [sender, fee, txid] = band.querySelectorAll(':scope > text');
  return {
    sender: sender.textContent,
    fee: fee.textContent,
    txid: txid.textContent,
    tooltip: band.querySelector(':scope > title').textContent,
    color: band.querySelector(':scope > rect').getAttribute('fill'),
  };
}

// The frame drawn over the box: its colour, width and dashes
export function frameOf(box) {
  const frame = box.querySelector(':scope > rect[fill="none"]');
  return {
    color: frame.getAttribute('stroke'),
    width: Number(frame.getAttribute('stroke-width')),
    dashed: frame.hasAttribute('stroke-dasharray'),
  };
}

// What a row ends in: the gold coin (unspent), the dashed
// ring (nobody knows), the plain port (spent — or an input's
// attachment point), or nothing (data)
export function markOf(row) {
  const circle = row.querySelector(':scope > circle');
  if (!circle) return 'none';
  if (circle.getAttribute('fill') === COLORS.COIN) return 'coin';
  if (circle.hasAttribute('stroke-dasharray')) return 'ring';
  return 'port';
}

// The box's two halves: the input side (left-aligned text)
// and the output side (right-aligned), row by row
export function rowsOf(box) {
  const rows = [...box.children].filter((node) => node.tagName === 'g' && node.querySelectorAll(':scope > text').length === 2);
  const read = (row) => {
    const [primary, secondary] = row.querySelectorAll(':scope > text');
    return {
      primary: primary.textContent,
      secondary: secondary.textContent,
      tooltip: row.querySelector(':scope > title')?.textContent ?? '',
      color: primary.getAttribute('fill'),
      mark: markOf(row),
    };
  };
  const onRight = (row) => row.querySelector(':scope > text').getAttribute('text-anchor') === 'end';
  return {
    inputs: rows.filter((row) => !onRight(row)).map(read),
    outputs: rows.filter(onRight).map(read),
  };
}

// Where each row's mark sits on the canvas (the box's
// position plus the circle's centre), null for a row that
// ends in nothing — the points a spend curve attaches to
export function portsOf(box) {
  const { x, y } = positionOf(box);
  const rows = [...box.children].filter((node) => node.tagName === 'g' && node.querySelectorAll(':scope > text').length === 2);
  const at = (row) => {
    const circle = row.querySelector(':scope > circle');
    return circle ? { x: x + Number(circle.getAttribute('cx')), y: y + Number(circle.getAttribute('cy')) } : null;
  };
  const onRight = (row) => row.querySelector(':scope > text').getAttribute('text-anchor') === 'end';
  return { inputs: rows.filter((row) => !onRight(row)).map(at), outputs: rows.filter(onRight).map(at) };
}

// The pinned row's cells, left to right: their text, the
// title's font size, and where each cell spans (screen px
// from the drawing's left margin edge)
export function headerCells() {
  return [...header().querySelectorAll(':scope > g')].map((cell) => {
    const [title, subtitle] = cell.querySelectorAll(':scope > text');
    const band = cell.querySelector(':scope > rect');
    return {
      title: title.textContent,
      subtitle: subtitle?.textContent ?? '',
      tooltip: cell.querySelector(':scope > title').textContent,
      size: Number(title.getAttribute('font-size')),
      x: Number(band.getAttribute('x')),
      width: Number(band.getAttribute('width')),
    };
  });
}

// The spend curves: colour and both ends (canvas units)
export function edges() {
  return [...drawing().querySelectorAll('path[marker-end]')].map((path) => {
    const d = numbers(path.getAttribute('d'));
    return {
      color: path.getAttribute('stroke'),
      from: { x: d[0], y: d[1] },
      to: { x: d[6], y: d[7] },
    };
  });
}







// -----------------------------------------------------------
// Geometry
// -----------------------------------------------------------
//
// installViewport(width, height) — call BEFORE rendering: the
// ResizeObserver the zoom creates becomes a double that gives
// every element it observes that client size and reports it
// at once; resize(w, h) reports a new size later.
// roundScrolling(element) makes the element keep whole-pixel
// scroll offsets, as a browser does.
// -----------------------------------------------------------

export function installViewport(width = 800, height = 600) {
  const size = { width, height };
  const observed = [];

  const measure = (element) => {
    Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => size.width });
    Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => size.height });
  };
  const report = ({ element, callback, observer }) => {
    callback([{ target: element, contentRect: { width: size.width, height: size.height } }], observer);
  };

  class SizedResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe(element) {
      measure(element);
      const entry = { element, callback: this.callback, observer: this };
      observed.push(entry);
      report(entry);
    }

    unobserve() {}

    disconnect() {
      for (let i = observed.length - 1; i >= 0; i -= 1) {
        if (observed[i].observer === this) observed.splice(i, 1);
      }
    }
  }

  vi.stubGlobal('ResizeObserver', SizedResizeObserver);

  return {
    resize(nextWidth, nextHeight) {
      size.width = nextWidth;
      size.height = nextHeight;
      act(() => {
        observed.forEach(report);
      });
    },
  };
}

export function roundScrolling(element) {
  let left = Math.round(element.scrollLeft);
  let top = Math.round(element.scrollTop);
  Object.defineProperty(element, 'scrollLeft', { configurable: true, get: () => left, set: (value) => { left = Math.round(value); } });
  Object.defineProperty(element, 'scrollTop', { configurable: true, get: () => top, set: (value) => { top = Math.round(value); } });
}







// -----------------------------------------------------------
// Gestures
// -----------------------------------------------------------
//
// A mouse press, moves and a release as the browser reports
// them (pointer events with the pointer's id). fireEvent
// returns false when the handler prevented the default.
// dragBy presses at `from`, moves in `steps` equal steps and
// releases — unless `release: false` leaves it held.
// -----------------------------------------------------------

export function press(target, { x = 100, y = 100, pointerId = 1, button = 0, pointerType = 'mouse' } = {}) {
  return fireEvent.pointerDown(target, { clientX: x, clientY: y, pointerId, button, buttons: 1, pointerType, isPrimary: true });
}

export function moveTo(target, x, y, { pointerId = 1, pointerType = 'mouse' } = {}) {
  return fireEvent.pointerMove(target, { clientX: x, clientY: y, pointerId, buttons: 1, pointerType, isPrimary: true });
}

export function release(target, x, y, { pointerId = 1, pointerType = 'mouse' } = {}) {
  return fireEvent.pointerUp(target, { clientX: x, clientY: y, pointerId, button: 0, pointerType, isPrimary: true });
}

export function dragBy(target, dx, dy, { from = [100, 100], steps = 1, pointerId = 1, release: letGo = true } = {}) {
  const [x0, y0] = from;
  press(target, { x: x0, y: y0, pointerId });
  for (let step = 1; step <= steps; step += 1) {
    moveTo(target, x0 + (dx * step) / steps, y0 + (dy * step) / steps, { pointerId });
  }
  if (letGo) release(target, x0 + dx, y0 + dy, { pointerId });
}







// -----------------------------------------------------------
// Dialog
// -----------------------------------------------------------
//
// openTransaction clicks a box (as a student does — press and
// release without moving) and returns the dialog it opens.
// -----------------------------------------------------------

export async function openTransaction(user, txid) {
  await user.click(await findBox(txid));
  return screen.findByRole('dialog', { name: 'Transakcija' });
}

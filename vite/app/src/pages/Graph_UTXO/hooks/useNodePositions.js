// -----------------------------------------------------------
//  [*] Graph_UTXO — useNodePositions
//
//  Where every transaction box sits, and the drag rules.
//  Blocks are COLUMNS, left to right in height order with the
//  mempool last (today only), each exactly as wide as the
//  boxes inside it need. A box's position is kept RELATIVE to
//  its own column's origin (x) plus an absolute y, so a block
//  that changes width slides the other blocks along without
//  touching what is inside them. A box can never be dragged
//  into another block's space — its block grows instead, in
//  the direction it is dragged: past the right edge the later
//  blocks slide right, past the left edge the earlier blocks
//  slide left (the first block simply grows into the
//  whitespace), and past the top the drawing grows upward.
//  While a drag grows the drawing to the left or top, the
//  scroll moves along, so the dragged box stays under the
//  pointer and whatever was not pushed stays where it was.
//
//  A drag moves ONE box: the pointer is captured on it (a
//  fast move can't slip off), and every move is resolved
//  against where the box was at pointer-down — moving back
//  undoes exactly what moving out did, nothing accumulates.
//  The pointer's travel is counted in screen pixels over the
//  zoom, a scroll made meanwhile counted in — but not the
//  scroll that follows the drawing's own growth, which would
//  otherwise feed back into the drag. A press that never
//  travels CLICK_SLOP is a click instead: it opens the
//  transaction's dialog (so do Enter and Space on a focused
//  box) and moves nothing. Only one press runs at a time, so
//  every press must end — on its release, on the browser
//  cancelling it, on its box losing the pointer capture, or
//  on its box leaving the day under it (a poll drops a
//  replaced transaction from the mempool); a press that
//  outlived its box would refuse every press after it.
//
//  Only the boxes a drag moved are kept — in the browser's
//  localStorage, per network, written when a drag ends; so a
//  reload finds the arrangement as it was left, whichever day
//  it was made on. Every other box takes its first-layout
//  spot, recomputed when the transactions change — a new
//  payout arriving in the mempool finds room among boxes that
//  were never touched.
//
//  Split into (root last) — plain layout functions with no
//  React in them, then the hook:
//
//    columnKeyOf       — a transaction's column
//    buildColumns      — the columns, the mempool last
//    rowTop            — where row N starts in a box
//    rowCenterY        — where row N's port sits in a box
//    transactionHeight — a box's height from its rows
//    initialPositions  — the first layout
//    measureCanvas     — column edges, origins + canvas extent
//    withMoved         — dropped positions + one move's
//    loadDropped       — a network's saved positions
//    saveDropped       — the positions back to storage
//    useNodePositions  — state + pointer wiring (default
//                        export)
// -----------------------------------------------------------

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { LAYOUT_CONFIG, MEMPOOL_COLUMN, NODE_CONFIG } from '../constants';


// How far (px) a press may travel and still count as a click
const CLICK_SLOP = 4;

// localStorage: the dropped positions of one network live
// under this prefix + the network's key — at most MAX_SAVED
// boxes, the most recently moved
const STORAGE_PREFIX = 'utxo-graph-positions:';
const MAX_SAVED = 2000;







// -----------------------------------------------------------
// columnKeyOf
// -----------------------------------------------------------
//
// The column a transaction lives in: its block, or the
// mempool while no block holds it.
//
// Used by:
//   - initialPositions / measureCanvas / useNodePositions
//     (below)
//   - UtxoFlowGraph.jsx — a box's absolute x
// -----------------------------------------------------------

export const columnKeyOf = (tx) => (tx.block === null ? MEMPOOL_COLUMN : `block-${tx.block}`);







// -----------------------------------------------------------
// buildColumns
// -----------------------------------------------------------
//
// The columns in drawing order: one per block (ascending, as
// given), and the mempool last while the day is today
// (`live`) — drawn even empty, so it is clear where new
// transactions appear. A past day has no mempool.
//
// Used by:
//   - useNodePositions (below) — once per day
// -----------------------------------------------------------

function buildColumns(blocks, live) {
  const columns = blocks.map((block) => ({ key: `block-${block.height}`, height: block.height, time: block.time }));
  return live ? [...columns, { key: MEMPOOL_COLUMN, height: null, time: null }] : columns;
}







// -----------------------------------------------------------
// rowTop
// -----------------------------------------------------------
//
// The top y of input / output row `index` inside a box — the
// rows start under the band and the txid line.
//
// Used by:
//   - rowCenterY / transactionHeight (below)
//   - TransactionBox.jsx — each row's text and the middle
//     divider
// -----------------------------------------------------------

export const rowTop = (index) => NODE_CONFIG.BAND_HEIGHT + NODE_CONFIG.TXID_HEIGHT + index * NODE_CONFIG.ROW_HEIGHT;







// -----------------------------------------------------------
// rowCenterY
// -----------------------------------------------------------
//
// The y of row `index`'s middle inside a box — where its
// port sits and where an edge attaches.
//
// Used by:
//   - TransactionBox.jsx — the ports
//   - UtxoFlowGraph.jsx — the edge endpoints
// -----------------------------------------------------------

export const rowCenterY = (index) => rowTop(index) + NODE_CONFIG.ROW_HEIGHT / 2;







// -----------------------------------------------------------
// transactionHeight
// -----------------------------------------------------------
//
// A box's height: band, txid line, one row per input or
// output (whichever side has more), footer.
//
// Used by:
//   - initialPositions / measureCanvas (below)
//   - TransactionBox.jsx — the frame and the middle divider
// -----------------------------------------------------------

export function transactionHeight(tx) {
  return rowTop(Math.max(tx.inputs.length, tx.outputs.length)) + NODE_CONFIG.FOOTER;
}







// -----------------------------------------------------------
// initialPositions
// -----------------------------------------------------------
//
// The first layout, as every box's spot by txid — its x
// counted from its column's origin, and its y. Each column
// stacks its transactions top to bottom in list order. A
// transaction spending one in the SAME column (a chain mined
// in one block, or waiting together in the mempool) starts to
// the right of its parent, so the chain reads left to right
// and the block is born wide enough to show it.
//
// Used by:
//   - useNodePositions (below) — the spot of every box no
//     drag has placed
// -----------------------------------------------------------

function initialPositions(columns, transactions) {

  const { COLUMN_PADDING, BOX_GAP } = LAYOUT_CONFIG;
  const nextY = Object.fromEntries(columns.map((column) => [column.key, COLUMN_PADDING]));
  const placed = {};
  const columnOf = {};


  for (const tx of transactions) {
    const key = columnKeyOf(tx);
    const rightOfParents = tx.inputs
      .filter((input) => columnOf[input.txid] === key)
      .map((input) => placed[input.txid].x + NODE_CONFIG.WIDTH + BOX_GAP);

    placed[tx.txid] = { x: Math.max(COLUMN_PADDING, ...rightOfParents), y: nextY[key] };
    columnOf[tx.txid] = key;
    nextY[key] += transactionHeight(tx) + BOX_GAP;
  }


  return placed;
}







// -----------------------------------------------------------
// measureCanvas
// -----------------------------------------------------------
//
// The drawing's measurements: every column again, now with
// its left edge (x), its width and the origin its boxes' x
// counts from, and the drawing's width, top edge and height.
// Every column is as wide as its boxes need, padding on both
// sides, never narrower than one box — a box left of the
// padding widens its column to the LEFT, one past the right
// edge to the right — and the columns sit side by side from
// 0. The origin is the column's left edge itself until a box
// went left of the padding. So a block growing rightward
// pushes the later blocks along, and one growing leftward
// moves its own origin and everything after it right — which
// the drag's scroll turns, on screen, into the earlier blocks
// sliding left. Vertically the drawing reaches from its
// highest box to its lowest: `top` is 0 until a box is raised
// above the first layout's top row, then negative — the
// drawing's top edge in canvas units, where UtxoFlowGraph
// starts drawing.
//
// Used by:
//   - useNodePositions (below) — on every render
// -----------------------------------------------------------

function measureCanvas(columns, transactions, positions) {

  const { COLUMN_PADDING } = LAYOUT_CONFIG;
  const low = Object.fromEntries(columns.map((column) => [column.key, 0]));
  const high = Object.fromEntries(columns.map((column) => [column.key, NODE_CONFIG.WIDTH + 2 * COLUMN_PADDING]));
  let top = 0;
  let bottom = 0;


  for (const tx of transactions) {
    const key = columnKeyOf(tx);
    const { x, y } = positions[tx.txid];
    low[key] = Math.min(low[key], x - COLUMN_PADDING);
    high[key] = Math.max(high[key], x + NODE_CONFIG.WIDTH + COLUMN_PADDING);
    top = Math.min(top, y - COLUMN_PADDING);
    bottom = Math.max(bottom, y + transactionHeight(tx) + COLUMN_PADDING);
  }


  let left = 0;
  const measured = columns.map((column) => {
    const placed = { ...column, x: left, width: high[column.key] - low[column.key], origin: left - low[column.key] };
    left += placed.width;
    return placed;
  });


  return { columns: measured, width: left, top, height: bottom - top };
}







// -----------------------------------------------------------
// withMoved
// -----------------------------------------------------------
//
// Dropped positions with one move's applied — the moved box
// taken out and put back LAST, so the order of the map is the
// order boxes were last moved in, and saveDropped can keep
// the newest.
//
// Used by:
//   - useNodePositions (below) — every pointermove of a drag,
//     over the positions from before the drag
// -----------------------------------------------------------

function withMoved(dropped, moved) {
  const next = { ...dropped };
  for (const txid of Object.keys(moved)) delete next[txid];
  return Object.assign(next, moved);
}







// -----------------------------------------------------------
// loadDropped
// -----------------------------------------------------------
//
// A network's saved positions: each dropped box's x and y by
// its txid. Storage can be missing, blocked (a private
// window) or hold anything — every failure reads as nothing
// saved, and an entry without two finite numbers is skipped.
//
// Used by:
//   - useNodePositions (below) — on mount and on a network
//     switch
// -----------------------------------------------------------

function loadDropped(network) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + network) ?? '{}');
    return Object.fromEntries(Object.entries(saved).filter(([, position]) => (
      Number.isFinite(position?.x) && Number.isFinite(position?.y)
    )));
  } catch {
    return {};
  }
}







// -----------------------------------------------------------
// saveDropped
// -----------------------------------------------------------
//
// Writes a network's positions back, rounded to whole canvas
// units and cut to the MAX_SAVED most recently moved. A full
// or blocked storage keeps them for this visit only.
//
// Used by:
//   - useNodePositions (below) — when a drag ends
// -----------------------------------------------------------

function saveDropped(network, dropped) {
  const newest = Object.entries(dropped).slice(-MAX_SAVED)
    .map(([txid, { x, y }]) => [txid, { x: Math.round(x), y: Math.round(y) }]);
  try {
    localStorage.setItem(STORAGE_PREFIX + network, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Kept in memory; the next drag tries again
  }
}







// -----------------------------------------------------------
// useNodePositions (default export)
// -----------------------------------------------------------
//
// The boxes' layout and their pointer wiring. The caller gets
// `canvas`, the drawing as measureCanvas measures it;
// `positions`, every box's spot by txid; `draggingTxid`, the
// box being pressed or dragged, null while there is none; and
// bindBox, which hands out the pointer and key handlers to
// spread on one box.
//
// The network picks the saved positions; the day's blocks and
// transactions are laid out, with a mempool column while the
// window is live; the zoom scale turns screen pixels into
// canvas units; and the scroller around the canvas is what a
// drag scrolls along as the drawing grows. onOpen runs on a
// click, or Enter / Space on a focused box, with the txid and
// the box's screen rectangle for the dialog to fly out of.
// Dropped positions outlive a day switch and a reload (they
// are kept by txid), so coming back to a day finds it as it
// was left.
//
// Used by:
//   - UtxoFlowGraph.jsx
// -----------------------------------------------------------

export default function useNodePositions({ network, blocks, transactions, live, scale, scrollerRef, onOpen }) {

  const columns = useMemo(() => buildColumns(blocks, live), [blocks, live]);
  const firstLayout = useMemo(() => initialPositions(columns, transactions), [columns, transactions]);
  const columnOf = useMemo(() => Object.fromEntries(transactions.map((tx) => [tx.txid, columnKeyOf(tx)])), [transactions]);
  const [saved, setSaved] = useState(() => ({ network, dropped: loadDropped(network) }));
  const [draggingTxid, setDraggingTxid] = useState(null);
  const dragRef = useRef(null);


  // Another network: its own saved positions — swapped in
  // during render, before anything is drawn with the old ones
  if (saved.network !== network) {
    setSaved({ network, dropped: loadDropped(network) });
  }


  // Every box where a drag left it, else where the first
  // layout puts it — so a transaction that arrives later (a
  // new payout in a live poll, a crawl landing) gets its
  // first-layout spot instead of having no position at all
  const positions = { ...firstLayout, ...saved.dropped };
  const canvas = measureCanvas(columns, transactions, positions);
  const originOf = (key) => canvas.columns.find((column) => column.key === key)?.origin ?? 0;

  // The dragged box's column and its origin now — null while
  // no drag runs, or the box has left the day's data
  const draggedColumn = (draggingTxid && columnOf[draggingTxid]) || null;
  const draggedOrigin = draggedColumn ? originOf(draggedColumn) : null;


  // A press whose box has left the day — a poll dropped it
  // from the mempool, or the day changed under it — lost its
  // pointer capture with the box, so no release will ever
  // reach it: it ends here. This runs before the scroll-follow
  // below, which must not move the view for a drag now gone
  useLayoutEffect(() => {
    if (draggingTxid !== null && !columnOf[draggingTxid]) {
      dragRef.current = null;
      setDraggingTxid(null);
    }
  }, [draggingTxid, columnOf]);


  // A drag grew the drawing at its top, or moved its box's
  // column origin (the block grew leftward): scroll by as much
  // before paint, so the dragged box stays under the pointer
  // and what it did not push stays where it was. The scroll
  // this takes is kept on the drag, so the pointer math leaves
  // it out; what the browser rounded away is carried into the
  // next shift, so a long drag never walks the rest of the
  // drawing off by more than a pixel. The top edge moving for
  // any other reason — a day's data arriving — is left alone:
  // the view then starts at the new top. So is an origin that
  // jumped because the box itself changed column (mined in
  // the middle of the drag)
  const topRef = useRef(canvas.top);
  const carryRef = useRef({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const grownTop = topRef.current - canvas.top;
    topRef.current = canvas.top;
    const drag = dragRef.current;
    const scroller = scrollerRef.current;
    if (!drag?.moved || !scroller) return;

    const follow = (axis, property, grown) => {
      if (!grown) return;
      const before = scroller[property];
      const wanted = before + grown * scale + carryRef.current[axis];
      scroller[property] = wanted;
      carryRef.current[axis] = wanted - scroller[property];
      drag.followed[axis] += scroller[property] - before;
    };

    if (draggedColumn === drag.column) {
      follow('x', 'scrollLeft', draggedOrigin - drag.origin);
    }
    if (draggedColumn) {
      drag.column = draggedColumn;
      drag.origin = draggedOrigin;
    }
    follow('y', 'scrollTop', grownTop);
  }, [canvas.top, draggedColumn, draggedOrigin, scale, scrollerRef]);


  // Saved when a drag ends — never on every move of it
  useEffect(() => {
    if (draggingTxid === null) saveDropped(saved.network, saved.dropped);
  }, [saved, draggingTxid]);


  const scrollOffset = () => ({
    left: scrollerRef.current?.scrollLeft ?? 0,
    top: scrollerRef.current?.scrollTop ?? 0,
  });


  // Only the pointer that started the press may end it; a
  // press that never moved the box was a click and opens it.
  // A lost pointer capture ends the press too, but opens
  // nothing: wherever that release goes, it is not this box
  const endPress = (event) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingTxid(null);
    if (event.type === 'pointerup' && !drag.moved) {
      onOpen(drag.txid, event.currentTarget.getBoundingClientRect());
    }
  };


  const bindBox = (txid) => ({
    onPointerDown: (event) => {
      // Primary mouse button, a finger or a pen — and one drag
      // at a time
      if (event.button !== 0 || dragRef.current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      carryRef.current = { x: 0, y: 0 };
      dragRef.current = {
        txid,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scroll: scrollOffset(),
        followed: { x: 0, y: 0 },           // scroll the drawing's growth took, px
        column: columnOf[txid],
        origin: originOf(columnOf[txid]),
        start: positions[txid],
        before: saved.dropped,
        moved: false,
      };
      setDraggingTxid(txid);
    },

    onPointerMove: (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      // Inside the slop (screen pixels, whatever the zoom) it
      // may still become a click — nothing moves until the
      // press has clearly left its spot
      if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < CLICK_SLOP) return;
      drag.moved = true;
      // The pointer's travel plus any scroll made meanwhile,
      // less the scroll that only followed the drawing's
      // growth — in canvas units. Applied to the positions from
      // BEFORE the drag, so nothing a move did outlives it
      const scroll = scrollOffset();
      const dx = (event.clientX - drag.clientX + scroll.left - drag.scroll.left - drag.followed.x) / scale;
      const dy = (event.clientY - drag.clientY + scroll.top - drag.scroll.top - drag.followed.y) / scale;
      const moved = { [drag.txid]: { x: drag.start.x + dx, y: drag.start.y + dy } };
      setSaved((current) => ({ ...current, dropped: withMoved(drag.before, moved) }));
    },

    onPointerUp: endPress,
    onPointerCancel: endPress,
    onLostPointerCapture: endPress,

    // Enter or Space on a focused box opens it too; Space
    // would otherwise scroll the page
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onOpen(txid, event.currentTarget.getBoundingClientRect());
    },
  });


  return { canvas, positions, draggingTxid, bindBox };
}

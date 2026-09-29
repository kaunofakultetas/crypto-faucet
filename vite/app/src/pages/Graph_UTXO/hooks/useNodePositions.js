// -----------------------------------------------------------
//  [*] Graph_UTXO — useNodePositions
//
//  Where every transaction box sits, and the drag rules.
//  Blocks are COLUMNS, left to right in height order with the
//  mempool last (today only), each exactly as wide as the
//  boxes inside it need. A box's position is kept RELATIVE to
//  its own column (x) plus an absolute y, so a block that
//  widens slides every later block to the right without
//  touching what is inside them. A box can never be dragged
//  into another block's space: past its column's right edge
//  the column simply grows, and past the left edge the box
//  stops at the edge while its column-mates shift right — the
//  block widens either way.
//
//  A drag moves ONE box: the pointer is captured on it (a
//  fast move can't slip off), and every move is resolved
//  against a snapshot of the box's column taken at
//  pointer-down — moving back undoes exactly what moving out
//  did, nothing accumulates. Scrolling the canvas mid-drag is
//  folded into the offset, so the box stays under the
//  pointer. A press that never travels CLICK_SLOP is a click
//  instead: it opens the transaction's dialog (so do Enter
//  and Space on a focused box) and moves nothing. Only the positions a drag set are kept, in memory
//  (a reload starts from the first layout again); every other
//  box takes its first-layout spot, recomputed when the
//  transactions change.
//
//  Split into (root last) — plain layout functions with no
//  React in them, then the hook:
//
//    columnKeyOf       — a transaction's column
//    buildColumns      — blocks → columns, mempool last
//    rowTop            — where row N starts in a box
//    rowCenterY        — where row N's port sits in a box
//    transactionHeight — a box's height from its rows
//    initialPositions  — the first layout
//    measureCanvas     — column x / widths + canvas size
//    dragPositions     — one drag move, block rules applied
//    useNodePositions  — state + pointer wiring (default
//                        export)
// -----------------------------------------------------------

import { useMemo, useRef, useState } from 'react';

import { LAYOUT_CONFIG, MEMPOOL_COLUMN, NODE_CONFIG } from '../constants';


// How far (px) a press may travel and still count as a click
const CLICK_SLOP = 4;







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
//   initialPositions(columns, transactions)
//     → txid → { x (within its column), y }
//
// The first layout: each column stacks its transactions top
// to bottom in list order. A transaction spending one in the
// SAME column (a chain mined in one block, or waiting
// together in the mempool) starts to the right of its
// parent, so the chain reads left to right and the block is
// born wide enough to show it.
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
//   measureCanvas(columns, transactions, positions)
//     → { columns: [{ ...column, x, width }], width, height }
//
// Every column as wide as its right-most box needs (never
// narrower than one box plus padding), laid side by side —
// so a box dragged right widens its own block and pushes the
// later blocks along. The height reaches the lowest box.
//
// Used by:
//   - useNodePositions (below) — on every render
// -----------------------------------------------------------

function measureCanvas(columns, transactions, positions) {

  const { COLUMN_PADDING } = LAYOUT_CONFIG;
  const widths = Object.fromEntries(columns.map((column) => [column.key, NODE_CONFIG.WIDTH + 2 * COLUMN_PADDING]));
  let bottom = 0;


  for (const tx of transactions) {
    const key = columnKeyOf(tx);
    const { x, y } = positions[tx.txid];
    widths[key] = Math.max(widths[key], x + NODE_CONFIG.WIDTH + COLUMN_PADDING);
    bottom = Math.max(bottom, y + transactionHeight(tx) + COLUMN_PADDING);
  }


  let left = 0;
  const measured = columns.map((column) => {
    const placed = { ...column, x: left, width: widths[column.key] };
    left += placed.width;
    return placed;
  });


  return { columns: measured, width: left, height: bottom };
}







// -----------------------------------------------------------
// dragPositions
// -----------------------------------------------------------
//
//   dragPositions(snapshot, txid, dx, dy)
//     → txid → { x, y } for every box in the snapshot
//
// Where one drag leaves a column's boxes. `snapshot` holds
// the positions of the dragged box and its column-mates when
// the drag began, dx / dy the pointer's offset since. The
// dragged box never goes above the drawing's top nor left of
// its column's edge; dragged further left, it stays at the
// edge and the others shift right by the overflow — the
// block widens instead of the box leaving it. Rightwards
// needs no rule: measureCanvas grows the column to fit.
//
// Used by:
//   - useNodePositions (below) — every pointermove of a drag
// -----------------------------------------------------------

function dragPositions(snapshot, txid, dx, dy) {

  const { COLUMN_PADDING } = LAYOUT_CONFIG;
  const start = snapshot[txid];
  const wantedX = start.x + dx;
  const overflow = Math.max(0, COLUMN_PADDING - wantedX);


  return Object.fromEntries(Object.entries(snapshot).map(([id, position]) => [
    id,
    id === txid
      ? { x: Math.max(COLUMN_PADDING, wantedX), y: Math.max(COLUMN_PADDING, start.y + dy) }
      : { x: position.x + overflow, y: position.y },
  ]));
}







// -----------------------------------------------------------
// useNodePositions (default export)
// -----------------------------------------------------------
//
//   const { canvas, positions, draggingTxid, bindBox } =
//     useNodePositions({ blocks, transactions, live, scale,
//                        scrollerRef, onOpen })
//
//   canvas        — measured columns (x, width) + canvas size
//   positions     — txid → { x (within its column), y }
//   draggingTxid  — the box being pressed or dragged, or null
//   bindBox(txid) — pointer + key handlers to spread on that
//                   box
//
// blocks / transactions are the day's; live adds the mempool
// column; scale is the zoom — the pointer moves in screen
// pixels, a box in canvas units, so a drag divides by it and
// the box stays under the pointer at any zoom (the click slop
// stays in pixels); scrollerRef is the scrolling element
// around the canvas; onOpen(txid, rect) runs on a click or
// Enter / Space, with the box's screen rectangle for the
// dialog to fly out of. Dropped positions outlive a day
// switch (they are kept by txid), so coming back to a day
// finds it as it was left.
//
// Used by:
//   - UtxoFlowGraph.jsx
// -----------------------------------------------------------

export default function useNodePositions({ blocks, transactions, live, scale, scrollerRef, onOpen }) {

  const columns = useMemo(() => buildColumns(blocks, live), [blocks, live]);
  const firstLayout = useMemo(() => initialPositions(columns, transactions), [columns, transactions]);
  const [dropped, setDropped] = useState({});
  const [draggingTxid, setDraggingTxid] = useState(null);
  const dragRef = useRef(null);


  // Every box where a drag left it, else where the first
  // layout puts it — so a transaction that arrives later (an
  // edited mock under hot reload, live data one day) gets its
  // first-layout spot instead of having no position at all
  const positions = { ...firstLayout, ...dropped };


  // txid → the txids sharing its column (itself included) —
  // a drag snapshots and moves only these
  const columnMates = useMemo(() => {
    const byColumn = {};
    for (const tx of transactions) {
      (byColumn[columnKeyOf(tx)] ??= []).push(tx.txid);
    }
    return Object.fromEntries(transactions.map((tx) => [tx.txid, byColumn[columnKeyOf(tx)]]));
  }, [transactions]);


  const canvas = measureCanvas(columns, transactions, positions);


  const scrollOffset = () => ({
    left: scrollerRef.current?.scrollLeft ?? 0,
    top: scrollerRef.current?.scrollTop ?? 0,
  });


  // Only the pointer that started the press may end it; a
  // press that never moved the box was a click and opens it
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
      dragRef.current = {
        txid,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scroll: scrollOffset(),
        snapshot: Object.fromEntries(columnMates[txid].map((id) => [id, positions[id]])),
        moved: false,
      };
      setDraggingTxid(txid);
    },

    onPointerMove: (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const scroll = scrollOffset();
      const dx = event.clientX - drag.startX + (scroll.left - drag.scroll.left);
      const dy = event.clientY - drag.startY + (scroll.top - drag.scroll.top);
      // Inside the slop it may still become a click — nothing
      // moves until the press has clearly left its spot
      if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      drag.moved = true;
      setDropped((current) => ({ ...current, ...dragPositions(drag.snapshot, drag.txid, dx / scale, dy / scale) }));
    },

    onPointerUp: endPress,
    onPointerCancel: endPress,

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

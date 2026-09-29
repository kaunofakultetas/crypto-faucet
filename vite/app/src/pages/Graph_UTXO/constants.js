// -----------------------------------------------------------
//  [*] Graph_UTXO — constants
//
//  Every fixed number and colour of the UTXO transaction
//  graph in one place: canvas and box geometry (px), the zoom
//  range, how often the data is asked for again, and the
//  palette — brand burgundy for everything the faucet owns,
//  slate for everyone else, gold for coins nobody has spent.
//
//  Used by:
//    - useNodePositions.js, useTransactionGraph.js, useZoom.js
//    - UtxoFlowGraph.jsx, TransactionBox.jsx,
//      TransactionModal.jsx, ZoomControls.jsx
//    - Page.jsx — the legend swatches
// -----------------------------------------------------------







// -----------------------------------------------------------
// LAYOUT_CONFIG
// -----------------------------------------------------------
//
// Canvas geometry around the boxes, all in px: the pinned
// block-height row's height (screen pixels — it does not
// zoom) and, in canvas units, the padding inside every block
// column and the gap between boxes at first layout.
//
// Used by:
//   - useNodePositions.js — first layout, column widths and
//     the drag limits
//   - UtxoFlowGraph.jsx — the pinned block-height row
//   - useZoom.js — the row's height in every scroll it sets
//   - ZoomControls.jsx — the panel sits just under the row
// -----------------------------------------------------------

export const LAYOUT_CONFIG = {
  HEADER_HEIGHT: 56,     // the block-height row pinned over the view, px at any zoom
  COLUMN_PADDING: 24,    // inside every column, around its boxes
  BOX_GAP: 32,           // between boxes at first layout
};







// -----------------------------------------------------------
// NODE_CONFIG
// -----------------------------------------------------------
//
// One transaction box, in px: the band on top, the short
// txid line under it, then one row per input / output
// (whichever side has more), then the footer.
//
// Used by:
//   - useNodePositions.js — box heights, row tops and centres
//   - UtxoFlowGraph.jsx — edge endpoints
//   - TransactionBox.jsx — the drawing
// -----------------------------------------------------------

export const NODE_CONFIG = {
  WIDTH: 280,            // each half fits a bold "749.8999859 tBTC4"
  BAND_HEIGHT: 28,       // the sender + fee band
  TXID_HEIGHT: 18,       // the short txid line under the band
  ROW_HEIGHT: 36,        // one input or output: two text lines
  FOOTER: 6,
};







// -----------------------------------------------------------
// ZOOM_CONFIG
// -----------------------------------------------------------
//
// Zoom limits and feel — the EVM graph's range. Every zoom
// path (wheel, slider, buttons) is clamped to
// MIN_SCALE..MAX_SCALE.
//
// Used by:
//   - useZoom.js — the clamp, the wheel and the buttons
//   - ZoomControls.jsx — the slider's height
//   - UtxoFlowGraph.jsx — the slider's range and step
// -----------------------------------------------------------

export const ZOOM_CONFIG = {
  MIN_SCALE: 0.2,
  MAX_SCALE: 2.0,
  BUTTON_STEP: 0.1,      // one press of the + / − buttons
  SLIDER_STEP: 0.01,
  WHEEL_SPEED: 0.0015,   // exponential: one mouse-wheel notch (~100 px) ≈ 14 %
  SLIDER_HEIGHT: 180,    // the vertical slider, px
};







// -----------------------------------------------------------
// POLL_CONFIG
// -----------------------------------------------------------
//
// How often the day's graph is asked for again, in ms: fast
// while the backend says a crawl is filling its cache
// (`updating`), so its transactions land as they come; steady
// on a live window (today — new payouts, blocks mined); a past
// day, once its crawl has landed, is history and not asked
// again.
//
// Used by:
//   - useTransactionGraph.js — the graph query's refetchInterval
// -----------------------------------------------------------

export const POLL_CONFIG = {
  UPDATING_MS: 3_000,
  LIVE_MS: 15_000,
};







// -----------------------------------------------------------
// COLORS
// -----------------------------------------------------------
//
// The palette, one colour per MEANING, so the graph, the
// dialog and the legend always agree: brand burgundy for what
// the faucet owns, slate for everyone else, gold for coins
// nobody has spent, amber for waiting in the mempool, and the
// greys of lines, frames and the alternating block bands.
//
// Used by:
//   - UtxoFlowGraph.jsx — columns, edges, arrowheads
//   - TransactionBox.jsx — bands, names, ports, coins
//   - TransactionModal.jsx — avatars, the unspent chip
//   - Page.jsx — the legend swatches
// -----------------------------------------------------------

export const COLORS = {
  BRAND: 'rgb(123, 0, 63)',  // the faucet: its transactions and coins
  INK: '#334155',            // everyone else's transactions, names
  MUTED: '#64748b',          // amounts, other people's coin edges
  LINE: '#cbd5e1',           // block dividers, header rule
  BORDER: '#94a3b8',         // a mined box's frame
  COIN: '#f59e0b',           // an unspent output
  COIN_EDGE: '#b45309',      // its rim; a mempool box's dashed frame
  BLOCK_BAND: '#f8fafc',     // every other block column
  MEMPOOL_BAND: '#fffbeb',   // the mempool column
};







// -----------------------------------------------------------
// NAME_MAX_LENGTH
// -----------------------------------------------------------
//
// The longest controller name an address can carry — a label
// drawn inside a box row, not a paragraph (the EVM graph caps
// its names the same way).
//
// Used by:
//   - useTransactionGraph.js — renameAddress trims to it
//   - TransactionModal.jsx — the name editor's input limit
// -----------------------------------------------------------

export const NAME_MAX_LENGTH = 64;







// -----------------------------------------------------------
// MEMPOOL_COLUMN
// -----------------------------------------------------------
//
// The key of the last column: the transactions no block
// holds yet (block: null).
//
// Used by:
//   - useNodePositions.js — columnKeyOf, buildColumns
//   - UtxoFlowGraph.jsx — BlockColumn's mempool styling
// -----------------------------------------------------------

export const MEMPOOL_COLUMN = 'mempool';

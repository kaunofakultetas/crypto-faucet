// -----------------------------------------------------------
//  [*] Graph_UTXO — UtxoFlowGraph
//
//  Two SVGs in one scroller. On top, the block-height row,
//  pinned to the top of the view (sticky): one cell per block,
//  the mempool last. Under it, the drawing: every block as a
//  lane, every transaction as a TransactionBox in its block's
//  lane, and a curve from each output to the input that spent
//  it — burgundy when it was the faucet's coin. The
//  transactions scroll under the pinned row, and the
//  whitespace between the row and them is scroll area like
//  the rest. Dragging the empty background
//  pans, like the EVM graph (useBackgroundPan); the mouse wheel
//  zooms around the cursor and the slider on the right around
//  the middle of the view (useZoom, ZoomControls). The drawing
//  is in canvas units inside ONE scaled group, floating in a
//  margin of whitespace so it can sit anywhere in the view —
//  from its top edge, which a box raised above the rest takes
//  up with it; the pinned row follows it sideways but keeps
//  its size.
//  Clicking a box (or Enter / Space on a focused one) opens its
//  TransactionModal. The data comes from useTransactionGraph
//  (the backend), the positions, drag and click rules from
//  useNodePositions.
//
//  The backend answers from its cache while it crawls the
//  chain, so the canvas says what state the day is in: loading,
//  still being collected, empty, not given by the server, or
//  an outage — centred while nothing is drawn, as a pill under
//  the block row over a drawing (which then stays as it was).
//
//  Like the EVM graph, the picture has a TEXT ALTERNATIVE: a
//  visually hidden table lists every transaction with its
//  block, inputs, outputs and fee.
//
//  Split into (root component last):
//
//    bandOf           — a column's tint (lane and header cell)
//    ArrowMarkers     — the <defs> for edge arrowheads
//    headerLabels     — a header cell's text at its width
//    BlockHeaderRow   — the pinned block-height row
//    BlockColumn      — one block's lane in the drawing
//    SpendEdge        — one output → input curve
//    statusOf         — what the canvas says about the day
//    CanvasStatus     — that, centred or as a pill
//    TransactionTable — the visually hidden text version
//    UtxoFlowGraph    — data + positions + drawing (default
//                       export)
// -----------------------------------------------------------

import { useLayoutEffect, useRef, useState } from 'react';

import { CircularProgress } from '@mui/material';

import { COLORS, LAYOUT_CONFIG, MEMPOOL_COLUMN, NODE_CONFIG, ZOOM_CONFIG } from '../constants';
import useTransactionGraph, { formatAmount, nameOf, senderOf, shortTxid } from '../hooks/useTransactionGraph';
import useNodePositions, { columnKeyOf, rowCenterY } from '../hooks/useNodePositions';
import useBackgroundPan from '../hooks/useBackgroundPan';
import useZoom from '../hooks/useZoom';
import TransactionBox from './TransactionBox';
import TransactionModal from './TransactionModal';
import ZoomControls from './ZoomControls';


// Marker ids per edge colour — one canvas per page, so fixed
// ids cannot clash
const ARROWS = { faucet: 'utxo-arrow-faucet', other: 'utxo-arrow-other' };

// A column's tint — the mempool amber, every other block light
// grey — shared by the lane and its header cell
const bandOf = (column, index) =>
  (column.key === MEMPOOL_COLUMN ? COLORS.MEMPOOL_BAND : (index % 2 ? COLORS.BLOCK_BAND : '#ffffff'));

// The status box's colours per tone — the EVM graph's red
// outage notice, and its amber and neutral siblings
const TONE_CLASSES = {
  info: 'border-slate-200 bg-white text-slate-600',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
};







// -----------------------------------------------------------
// ArrowMarkers
// -----------------------------------------------------------
//
// The arrowheads the spend curves end in, defined once and
// referenced by id: one per edge colour — the faucet's
// burgundy and everyone else's slate — so a head always
// matches its line.
//
// Used by:
//   - UtxoFlowGraph (below) — once, inside the SVG
// -----------------------------------------------------------

function ArrowMarkers() {
  return (
    <defs>
      {[[ARROWS.faucet, COLORS.BRAND], [ARROWS.other, COLORS.MUTED]].map(([id, color]) => (
        <marker key={id} id={id} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      ))}
    </defs>
  );
}







// -----------------------------------------------------------
// headerLabels
// -----------------------------------------------------------
//
// What a column's header cell says at its on-screen `width`
// (px — the cell zooms, its text does not): the full "Blokas
// #height" over the block's local time while it fits, the
// short "#height" in a smaller font on a narrower cell, and
// only that once the time no longer fits either. The mempool
// reads "Mempool" over "laukia patvirtinimo", losing the
// second line first. A block whose time is not known yet shows
// no time. `tooltip` always holds the full text.
//
// Used by:
//   - BlockHeaderRow (below) — one per column
// -----------------------------------------------------------

function headerLabels(column, width) {

  const mempool = column.key === MEMPOOL_COLUMN;
  const time = column.time ? new Date(column.time).toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' }) : '';
  const full = mempool ? 'Mempool' : `Blokas #${column.height}`;
  const tooltip = mempool ? 'Mempool — laukia patvirtinimo' : [full, time].filter(Boolean).join(' — ');


  if (width >= 150) {
    return { title: full, titleSize: 15, subtitle: mempool ? 'laukia patvirtinimo' : time, tooltip };
  }
  const title = mempool ? 'Mempool' : `#${column.height}`;
  if (width >= 72) {
    return { title, titleSize: 12, subtitle: time, tooltip };
  }
  return { title, titleSize: 10, subtitle: '', tooltip };
}







// -----------------------------------------------------------
// BlockHeaderRow
// -----------------------------------------------------------
//
// The block-height row, pinned to the top of the view (sticky
// inside the scroller): one cell per column, placed where the
// column is on screen — `left` (the whitespace margin) plus
// its x times the zoom — so it follows sideways scrolling and
// zooming while the transactions scroll under it vertically.
// The row itself does not zoom: its text keeps a readable size
// and the labels shorten as the cells narrow (headerLabels).
// An opaque background hides what scrolls beneath, and a rule
// under the cells closes the row.
//
// Used by:
//   - UtxoFlowGraph (below) — the scroller's first child
// -----------------------------------------------------------

function BlockHeaderRow({ columns, width, left, drawingWidth, scale }) {

  const { HEADER_HEIGHT } = LAYOUT_CONFIG;
  const right = left + drawingWidth * scale;


  return (
    <svg className="sticky top-0 z-10 block select-none" width={width} height={HEADER_HEIGHT} aria-hidden="true">
      <rect width={width} height={HEADER_HEIGHT} fill="#ffffff" />

      {columns.map((column, index) => {
        const x = left + column.x * scale;
        const cellWidth = column.width * scale;
        const labels = headerLabels(column, cellWidth);
        return (
          <g key={column.key}>
            <title>{labels.tooltip}</title>
            <rect x={x} y={0} width={cellWidth} height={HEADER_HEIGHT} fill={bandOf(column, index)} />
            <line x1={x} x2={x} y1={0} y2={HEADER_HEIGHT} stroke={COLORS.LINE} strokeWidth={1.5} />
            <text
              x={x + cellWidth / 2}
              y={labels.subtitle ? 25 : 32}
              textAnchor="middle"
              fontSize={labels.titleSize}
              fontWeight={700}
              fill={column.key === MEMPOOL_COLUMN ? COLORS.COIN_EDGE : COLORS.INK}
            >
              {labels.title}
            </text>
            {labels.subtitle && (
              <text x={x + cellWidth / 2} y={43} textAnchor="middle" fontSize={11} fill={COLORS.MUTED}>
                {labels.subtitle}
              </text>
            )}
          </g>
        );
      })}

      <line x1={right} x2={right} y1={0} y2={HEADER_HEIGHT} stroke={COLORS.LINE} strokeWidth={1.5} />
      <line x1={left} x2={right} y1={HEADER_HEIGHT - 0.75} y2={HEADER_HEIGHT - 0.75} stroke={COLORS.LINE} strokeWidth={1.5} />
    </svg>
  );
}







// -----------------------------------------------------------
// BlockColumn
// -----------------------------------------------------------
//
// One block's lane in the drawing: the background band (the
// tint of its header cell) and the vertical line on its left
// edge — the first column's too: against the white margin it
// frames the drawing. Both run from `top` for `height`, the
// whole scroll area in canvas units, so a lane goes on above
// the transactions — up under the pinned row — and below
// them, at any zoom.
//
// Used by:
//   - UtxoFlowGraph (below) — one per column
// -----------------------------------------------------------

function BlockColumn({ column, index, top, height }) {
  return (
    <g>
      <rect x={column.x} y={top} width={column.width} height={height} fill={bandOf(column, index)} />
      <line x1={column.x} x2={column.x} y1={top} y2={top + height} stroke={COLORS.LINE} strokeWidth={1.5} />
    </g>
  );
}







// -----------------------------------------------------------
// SpendEdge
// -----------------------------------------------------------
//
// A horizontal-tangent curve from an output's port to the
// input that spent it. The bend grows with the distance, so
// a chain inside one block (the edge running back left)
// still loops clear of the boxes.
//
// Used by:
//   - UtxoFlowGraph (below) — one per edge
// -----------------------------------------------------------

function SpendEdge({ from, to, faucetCoin }) {

  const bend = Math.max(40, Math.abs(to.x - from.x) / 2);


  return (
    <path
      d={`M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`}
      fill="none"
      stroke={faucetCoin ? COLORS.BRAND : COLORS.MUTED}
      strokeOpacity={0.8}
      strokeWidth={1.75}
      markerEnd={`url(#${faucetCoin ? ARROWS.faucet : ARROWS.other})`}
    />
  );
}







// -----------------------------------------------------------
// statusOf
// -----------------------------------------------------------
//
//   statusOf({ loading, error, updating, missing, count, live })
//     → { centred, tone, busy, text } | null
//
// What the canvas says about the day, most urgent first. With
// no box drawn (count 0) the message is `centred` — loading,
// an outage, the first crawl still collecting, transactions
// the server did not give, or a plainly empty day; over a
// drawing it is a pill that leaves the boxes as they were: the
// first crawl adding to them, a failed refresh, or some
// transactions missing. `busy`
// adds a spinner. Counts go in parentheses — no noun has to
// agree with a number.
//
// Used by:
//   - CanvasStatus (below)
// -----------------------------------------------------------

function statusOf({ loading, error, updating, missing, count, live }) {

  if (loading) {
    return { centred: true, tone: 'info', busy: true, text: 'Kraunama…' };
  }


  if (count === 0) {
    if (error) return { centred: true, tone: 'error', busy: false, text: error };
    if (updating) return { centred: true, tone: 'info', busy: true, text: 'Renkamos transakcijos iš tinklo…' };
    if (missing) {
      return { centred: true, tone: 'warn', busy: false, text: `Serveris negrąžino šios dienos transakcijų (${missing}) — parodyti jų negalima` };
    }
    return { centred: true, tone: 'info', busy: false, text: live ? 'Šiandien čiaupo transakcijų dar nėra' : 'Šią dieną čiaupo transakcijų nėra' };
  }


  if (error) return { centred: false, tone: 'error', busy: false, text: 'Nepavyko atnaujinti grafiko — rodomi paskutiniai gauti duomenys' };
  if (updating) return { centred: false, tone: 'info', busy: true, text: 'Atnaujinama…' };
  if (missing) return { centred: false, tone: 'warn', busy: false, text: `Serveris negrąžino dalies transakcijų (${missing}) — grafike jų nėra` };
  return null;
}







// -----------------------------------------------------------
// CanvasStatus
// -----------------------------------------------------------
//
// statusOf's message over the canvas: a card in the middle of
// the view, or a pill centred just under the pinned block row.
// Never in the way — pointer events pass through to the
// panning background — and announced politely to screen
// readers as it changes.
//
// Used by:
//   - UtxoFlowGraph (below) — over the scroller
// -----------------------------------------------------------

function CanvasStatus({ status }) {

  if (!status) {
    return null;
  }


  const box = (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-1 text-sm shadow-sm ${TONE_CLASSES[status.tone]}`}>
      {status.busy && <CircularProgress size={12} color="inherit" />}
      {status.text}
    </div>
  );

  return status.centred ? (
    <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
      {box}
    </div>
  ) : (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 -translate-x-1/2"
      style={{ top: LAYOUT_CONFIG.HEADER_HEIGHT + 12 }}
    >
      {box}
    </div>
  );
}







// -----------------------------------------------------------
// TransactionTable
// -----------------------------------------------------------
//
// The same transactions as text for screen readers: block,
// full txid, sender, inputs, outputs and fee per row. Inputs
// read as the box shows them — amount and outpoint, with the
// owner's name only when several people pay; a coinbase's
// inputs read as new coins. Amounts go ungrouped: a screen
// reader may read digit groups as separate numbers.
//
// Used by:
//   - UtxoFlowGraph (below) — named by the SVG's
//     aria-describedby
// -----------------------------------------------------------

function TransactionTable({ id, transactions, names, unit }) {

  const inputsOf = (tx, sender) => (tx.coinbase ? 'naujos monetos (bloko atlygis)' : tx.inputs
    .map((input) => [
      sender.several && nameOf(input.address, names),
      `${formatAmount(input.value, { grouped: false })} ${unit}`,
      `(${shortTxid(input.txid)}:${input.vout})`,
    ].filter(Boolean).join(' '))
    .join('; '));

  const outputsOf = (tx) => tx.outputs
    .map((output) => `${nameOf(output.address, names, output.script_type)} ${formatAmount(output.value, { grouped: false })} ${unit}`)
    .join('; ');


  // The visually hidden box is a wrapper div, never the table
  // itself: a table ignores sr-only's 1px size (it cannot be
  // narrower than its unwrapped text) and, invisible, would
  // stretch the page sideways
  return (
    <div className="sr-only">
      <table id={id}>
        <caption>Transakcijos pagal blokus</caption>
        <thead>
          <tr>
            <th>Blokas</th><th>Transakcija</th><th>Siuntėjas</th><th>Įvestys</th><th>Išvestys</th><th>Mokestis</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const sender = senderOf(tx, names);
            return (
              <tr key={tx.txid}>
                <td>{tx.block ?? 'mempool'}</td>
                <td>{tx.txid}</td>
                <td>{sender.label}</td>
                <td>{inputsOf(tx, sender)}</td>
                <td>{outputsOf(tx)}</td>
                <td>{tx.fee === null ? '—' : `${tx.fee} sat`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}







// -----------------------------------------------------------
// UtxoFlowGraph (default export)
// -----------------------------------------------------------
//
// network is the route's; day / today pick what is drawn
// (Page.jsx owns the slider); unit is the network's short
// currency name ("tBTC4") shown after every amount. Stays
// mounted across day switches, so dragged boxes and the zoom
// survive them. Owns which transaction's dialog is open (and
// the box it flies out of) and which box holds keyboard focus.
//
// Used by:
//   - Page.jsx — under the title row and the legend
// -----------------------------------------------------------

export default function UtxoFlowGraph({ network, day, today, unit }) {

  const scrollerRef = useRef(null);
  const [opened, setOpened] = useState(null);           // { txid, rect } while a dialog is open
  const [focusedTxid, setFocusedTxid] = useState(null);
  const {
    blocks, transactions, byTxid, edges, live, names, faucetAddress, renameAddress, loading, error, updating, missing,
  } = useTransactionGraph(network, day, today);
  const { scale, margin, setZoom, zoomIn, zoomOut, goHome } = useZoom(scrollerRef);
  const { canvas, positions, draggingTxid, bindBox } = useNodePositions({
    network,
    blocks,
    transactions,
    live,
    scale,
    scrollerRef,
    onOpen: (txid, rect) => setOpened({ txid, rect }),
  });
  const { panning, panHandlers } = useBackgroundPan(scrollerRef);


  // A new day (or network) starts from the drawing's top-left
  // corner — a pan into the whitespace must not leave the next
  // one off screen
  useLayoutEffect(() => {
    goHome();
  }, [network, day, goHome]);


  // A box's top-left on the canvas is its column's origin plus
  // its own x from it (the origin sits right of the column's
  // left edge once the block has grown leftward)
  const columnOrigin = Object.fromEntries(canvas.columns.map((column) => [column.key, column.origin]));
  const origin = (txid) => ({
    x: columnOrigin[columnKeyOf(byTxid[txid])] + positions[txid].x,
    y: positions[txid].y,
  });


  // The drawing's SVG is the drawing at the current zoom plus
  // the whitespace margin on every side (see useZoom). Its top
  // edge is canvas.top — 0, or above it once a box was raised
  // over the rest — so the scaled group starts drawing there
  // (drawTop px down). The lanes cover all of it, margins
  // included — in canvas units they start laneTop above the
  // drawing's top edge
  const svgWidth = Math.ceil(canvas.width * scale + 2 * margin.x);
  const svgHeight = Math.ceil(canvas.height * scale + 2 * margin.y);
  const drawTop = margin.y - canvas.top * scale;
  const laneTop = canvas.top - margin.y / scale;
  const laneHeight = svgHeight / scale;


  return (
    // Same sizing as the EVM graph: a flex-grown box is not a
    // definite height for a percentage child, so the scroller
    // fills it absolutely (and useZoom measures it for the
    // margins). overflow-hidden: nothing in here may widen the
    // page
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scrollerRef}
        className={`absolute inset-0 overflow-auto rounded-lg border border-slate-200 bg-white ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
        {...panHandlers}
      >
        <BlockHeaderRow
          columns={canvas.columns}
          width={svgWidth}
          left={margin.x}
          drawingWidth={canvas.width}
          scale={scale}
        />

        <svg
          width={svgWidth}
          height={svgHeight}
          role="group"
          aria-label="UTXO transakcijų grafikas pagal blokus"
          aria-describedby="utxo-graph-table"
          className="block select-none"
        >
          <ArrowMarkers />

          {/* Everything below is in canvas units — placed past
              the margin, then zoomed, by this one transform */}
          <g transform={`translate(${margin.x} ${drawTop}) scale(${scale})`}>
            {canvas.columns.map((column, index) => (
              <BlockColumn key={column.key} column={column} index={index} top={laneTop} height={laneHeight} />
            ))}

            {/* The last lane's right edge — every other edge is its
                column's own left line */}
            <line
              x1={canvas.width}
              x2={canvas.width}
              y1={laneTop}
              y2={laneTop + laneHeight}
              stroke={COLORS.LINE}
              strokeWidth={1.5}
            />

            {/* Edges first, under the boxes: from an output's port
                to the input that spent it, stopping at the port */}
            {edges.map((edge) => {
              const from = origin(edge.fromTxid);
              const to = origin(edge.toTxid);
              return (
                <SpendEdge
                  key={edge.id}
                  from={{ x: from.x + NODE_CONFIG.WIDTH, y: from.y + rowCenterY(edge.vout) }}
                  to={{ x: to.x - 4, y: to.y + rowCenterY(edge.vin) }}
                  faucetCoin={Boolean(edge.address) && edge.address === faucetAddress}
                />
              );
            })}

            {transactions.map((tx) => {
              const { x, y } = origin(tx.txid);
              return (
                <TransactionBox
                  key={tx.txid}
                  id={`utxo-tx-${tx.txid}`}
                  tx={tx}
                  x={x}
                  y={y}
                  names={names}
                  faucetAddress={faucetAddress}
                  unit={unit}
                  dragging={draggingTxid === tx.txid}
                  focused={focusedTxid === tx.txid}
                  handlers={{
                    ...bindBox(tx.txid),
                    // Keyboard focus only — a mouse press focuses the
                    // box as well, and would leave it framed
                    onFocus: (event) => setFocusedTxid(event.currentTarget.matches(':focus-visible') ? tx.txid : null),
                    onBlur: () => setFocusedTxid(null),
                  }}
                />
              );
            })}

            {/* The dragged box drawn once more, on top of the rest.
                Moving the real one to the end would detach it from
                the DOM for a moment and drop its pointer capture. */}
            {draggingTxid && <use href={`#utxo-tx-${draggingTxid}`} pointerEvents="none" />}
          </g>
        </svg>
      </div>

      <CanvasStatus status={statusOf({ loading, error, updating, missing, count: transactions.length, live })} />

      <ZoomControls
        scale={scale}
        min={ZOOM_CONFIG.MIN_SCALE}
        max={ZOOM_CONFIG.MAX_SCALE}
        step={ZOOM_CONFIG.SLIDER_STEP}
        onScaleChange={setZoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
      />

      <TransactionTable id="utxo-graph-table" transactions={transactions} names={names} unit={unit} />

      {opened && (
        <TransactionModal
          network={network}
          txid={opened.txid}
          sourceRect={opened.rect}
          onClose={() => setOpened(null)}
          transactionsById={byTxid}
          names={names}
          renameAddress={renameAddress}
          faucetAddress={faucetAddress}
          unit={unit}
        />
      )}
    </div>
  );
}

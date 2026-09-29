// -----------------------------------------------------------
//  [*] Graph_UTXO — TransactionBox
//
//  One transaction as a draggable box. The band on top names
//  the SENDER once, with the fee on the right and the short
//  txid on a line under it (the full one on hover) — one
//  wallet signs every input of a normal transaction, so the
//  owner is said once, not on every input row. The input rows
//  show the coin being spent: its amount and which earlier
//  output it is (txid:index, the coin's name on the chain).
//  Only when the inputs provably belong to different people
//  (a CoinJoin, a PayJoin — see senderOf) does the band read
//  "Kelios pusės" and the input rows name their owners.
//  Output rows name the recipient over the amount; an output
//  nobody has spent ends in a gold coin, change (back to one
//  of the sender's own addresses) is marked ↩. The faucet's
//  own transactions carry a burgundy band, a box still in the
//  mempool a dashed amber frame. The box is a button: a click
//  (or Enter / Space when it has focus) opens the
//  transaction's dialog, and keyboard focus shows as a
//  burgundy frame.
//
//  Split into (root component last):
//
//    inputLabels    — an input row's two lines + tooltip
//    outputLabels   — an output row's two lines + tooltip
//    PortRow        — one row: its two lines and the port
//    TransactionBox — the box itself (default export)
// -----------------------------------------------------------

import { COLORS, NODE_CONFIG } from '../constants';
import { rowCenterY, rowTop, transactionHeight } from '../hooks/useNodePositions';
import { formatAmount, nameOf, outpointKey, senderOf, shortTxid } from '../hooks/useTransactionGraph';


// Room between a row's text and the box edge
const TEXT_INSET = 12;







// -----------------------------------------------------------
// inputLabels
// -----------------------------------------------------------
//
// An input row's text: the amount over the outpoint it spends
// (short txid:index) — or, when several people pay, the
// owner's name over the amount. The tooltip carries all of
// it: address, amount and the full outpoint.
//
// Used by:
//   - TransactionBox (below) — one per input
// -----------------------------------------------------------

function inputLabels(input, sender, names, faucetAddress, unit) {

  const amount = `${formatAmount(input.value)} ${unit}`;
  const tooltip = `${input.address} — ${amount} — ${input.txid}:${input.vout}`;


  if (sender.several) {
    return {
      primary: nameOf(input.address, names),
      secondary: amount,
      fill: input.address === faucetAddress ? COLORS.BRAND : COLORS.INK,
      tooltip,
    };
  }
  return { primary: amount, secondary: `${shortTxid(input.txid)}:${input.vout}`, fill: COLORS.INK, tooltip };
}







// -----------------------------------------------------------
// outputLabels
// -----------------------------------------------------------
//
// An output row's text: the recipient's name (↩ in front when
// the output is change) over the amount.
//
// Used by:
//   - TransactionBox (below) — one per output
// -----------------------------------------------------------

function outputLabels(output, isChange, unspent, names, faucetAddress, unit) {

  const name = nameOf(output.address, names);
  const amount = `${formatAmount(output.value)} ${unit}`;
  const tooltip = [output.address, amount, isChange && 'grąža', unspent && 'neišleista']
    .filter(Boolean)
    .join(' — ');


  return {
    primary: isChange ? `↩ ${name}` : name,
    secondary: amount,
    fill: output.address === faucetAddress ? COLORS.BRAND : COLORS.INK,
    tooltip,
  };
}







// -----------------------------------------------------------
// PortRow
// -----------------------------------------------------------
//
// One input (side 'in', left edge) or output (side 'out',
// right edge): the primary line over the secondary one, and
// the port where an edge attaches — a gold coin instead when
// the output is still unspent.
//
// Used by:
//   - TransactionBox (below) — one per input and output
// -----------------------------------------------------------

function PortRow({ side, index, labels, unspent = false }) {

  const input = side === 'in';
  const top = rowTop(index);
  const textX = input ? TEXT_INSET : NODE_CONFIG.WIDTH - TEXT_INSET;
  const anchor = input ? 'start' : 'end';


  return (
    <g>
      <title>{labels.tooltip}</title>
      <text x={textX} y={top + 15} textAnchor={anchor} fontSize={12} fontWeight={600} fill={labels.fill}>
        {labels.primary}
      </text>
      <text x={textX} y={top + 29} textAnchor={anchor} fontSize={11} fontFamily="ui-monospace, monospace" fill={COLORS.MUTED}>
        {labels.secondary}
      </text>

      {unspent ? (
        <circle cx={NODE_CONFIG.WIDTH} cy={rowCenterY(index)} r={6} fill={COLORS.COIN} stroke={COLORS.COIN_EDGE} strokeWidth={1.5} />
      ) : (
        <circle cx={input ? 0 : NODE_CONFIG.WIDTH} cy={rowCenterY(index)} r={3.5} fill="#ffffff" stroke={COLORS.MUTED} strokeWidth={1.5} />
      )}
    </g>
  );
}







// -----------------------------------------------------------
// TransactionBox (default export)
// -----------------------------------------------------------
//
// x / y is the box's top-left on the canvas; handlers are
// useNodePositions' bindBox (drag, click, keys) plus the
// canvas' focus tracking, which sets `focused`. id lets the
// canvas draw the box being dragged once more on top.
//
// Used by:
//   - UtxoFlowGraph.jsx — one per transaction
// -----------------------------------------------------------

export default function TransactionBox({ id, tx, x, y, graph, names, faucetAddress, unit, dragging, focused, handlers }) {

  const { WIDTH, BAND_HEIGHT } = NODE_CONFIG;
  const height = transactionHeight(tx);
  const mined = tx.block !== null;
  const sender = senderOf(tx, names);
  const band = tx.inputs.some((input) => input.address === faucetAddress) ? COLORS.BRAND : COLORS.INK;

  // The frame: grey when mined, amber while waiting — brand
  // burgundy whenever the box holds keyboard focus
  let frameColor = mined ? COLORS.BORDER : COLORS.COIN_EDGE;
  if (focused) frameColor = COLORS.BRAND;


  return (
    <g
      id={id}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`Transakcija ${shortTxid(tx.txid)}, siuntėjas ${sender.label}, ${mined ? `blokas ${tx.block}` : 'laukia patvirtinimo'}`}
      transform={`translate(${x}, ${y})`}
      className={dragging ? 'cursor-grabbing' : 'cursor-grab'}
      style={{ touchAction: 'none', outline: 'none' }}
      {...handlers}
    >
      <rect width={WIDTH} height={height} rx={6} fill="#ffffff" />

      {/* The band: the sender, said once for the whole
          transaction, and the fee (inputs − outputs); the short
          txid on the line under it, the full txid on hover. The
          second rect squares off the band's lower corners. */}
      <g>
        <title>{tx.txid}</title>
        <rect width={WIDTH} height={BAND_HEIGHT} rx={6} fill={band} />
        <rect y={BAND_HEIGHT - 6} width={WIDTH} height={6} fill={band} />
        <text x={10} y={19} fontSize={13} fontWeight={700} fill="#ffffff">
          {sender.label}
        </text>
        <text x={WIDTH - 10} y={19} textAnchor="end" fontSize={11} fill="#ffffff">
          mokestis {graph.fees[tx.txid].toLocaleString('lt-LT')} sat
        </text>
        <text x={10} y={BAND_HEIGHT + 13} fontSize={10.5} fontFamily="ui-monospace, monospace" fill={COLORS.MUTED}>
          {shortTxid(tx.txid)}
        </text>
      </g>

      <line x1={WIDTH / 2} x2={WIDTH / 2} y1={rowTop(0) + 4} y2={height - 4} stroke={COLORS.LINE} />

      {/* The frame after the band (its border runs over it) and
          before the rows (the ports and coins sit on top of it);
          dashed while the transaction waits in the mempool */}
      <rect
        width={WIDTH}
        height={height}
        rx={6}
        fill="none"
        stroke={frameColor}
        strokeWidth={dragging || focused ? 2.5 : 1.5}
        strokeDasharray={mined ? undefined : '6 4'}
      />

      {tx.inputs.map((input, vin) => (
        <PortRow
          key={`in-${vin}`}
          side="in"
          index={vin}
          labels={inputLabels(input, sender, names, faucetAddress, unit)}
        />
      ))}

      {tx.outputs.map((output, vout) => {
        const key = outpointKey(tx.txid, vout);
        const unspent = !graph.spent.has(key);
        return (
          <PortRow
            key={`out-${vout}`}
            side="out"
            index={vout}
            labels={outputLabels(output, graph.change.has(key), unspent, names, faucetAddress, unit)}
            unspent={unspent}
          />
        );
      })}
    </g>
  );
}

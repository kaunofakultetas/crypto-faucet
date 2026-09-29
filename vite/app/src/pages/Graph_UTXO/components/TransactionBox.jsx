// -----------------------------------------------------------
//  [*] Graph_UTXO — TransactionBox
//
//  One transaction as a draggable box. The band on top names
//  the SENDER once, with the fee on the right and the short
//  txid on a line under it (the full one on hover) — one
//  wallet signs every input of a normal transaction, so the
//  owner is said once, not on every input row. The input rows
//  show the coin being spent: its amount and which earlier
//  output it is (txid:index, the coin's name on the chain) —
//  "?" for an amount the server never gave. Only when the
//  inputs provably belong to different people (a CoinJoin, a
//  PayJoin — see senderOf) does the band read "Kelios pusės"
//  and the input rows name their owners. A coinbase has no
//  inputs at all: its left half says the coins are new, the
//  block's reward.
//
//  Output rows name the recipient over the amount (an output
//  with no address by what its script is — OP_RETURN data);
//  change (back to one of the sender's own addresses) is
//  marked ↩. The row's end tells the coin's state: a gold coin
//  while nobody has spent it, a dashed ring when nobody can
//  say (its address's history was never read), nothing for
//  data, and the plain port an edge leaves from once spent.
//  The faucet's own transactions carry a burgundy band, a box
//  still in the mempool a dashed amber frame. The box is a
//  button: a click (or Enter / Space when it has focus) opens
//  the transaction's dialog, and keyboard focus shows as a
//  burgundy frame.
//
//  Split into (root component last):
//
//    inputLabels    — an input row's two lines + tooltip
//    outputLabels   — an output row's two lines + tooltip
//    PortRow        — one row: its two lines and its end mark
//    CoinbaseRow    — a coinbase's left half: new coins
//    TransactionBox — the box itself (default export)
// -----------------------------------------------------------

import { COLORS, NODE_CONFIG } from '../constants';
import { rowCenterY, rowTop, transactionHeight } from '../hooks/useNodePositions';
import { formatAmount, isChange, nameOf, senderOf, shortTxid, spendStateOf } from '../hooks/useTransactionGraph';


// Room between a row's text and the box edge
const TEXT_INSET = 12;

// What an output row ends in, by its coin's state (see
// spendStateOf) — and the words its tooltip adds
const MARK_OF_STATE = { spent: 'port', unspent: 'coin', unknown: 'ring', data: 'none' };
const STATE_TEXT = { unspent: 'neišleista', unknown: 'nežinoma, ar išleista', data: 'duomenys — išleisti negalima' };







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
  const tooltip = `${input.address ?? 'adresas nežinomas'} — ${amount} — ${input.txid}:${input.vout}`;


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

function outputLabels(output, change, state, names, faucetAddress, unit) {

  const name = nameOf(output.address, names, output.script_type);
  const amount = `${formatAmount(output.value)} ${unit}`;
  const tooltip = [output.address ?? name, amount, change && 'grąža', STATE_TEXT[state]]
    .filter(Boolean)
    .join(' — ');


  return {
    primary: change ? `↩ ${name}` : name,
    secondary: amount,
    fill: output.address && output.address === faucetAddress ? COLORS.BRAND : COLORS.INK,
    tooltip,
  };
}







// -----------------------------------------------------------
// PortRow
// -----------------------------------------------------------
//
// One input (side 'in', left edge) or output (side 'out',
// right edge): the primary line over the secondary one, and
// what the row ends in (`mark`): the port where an edge
// attaches, a gold coin for an unspent output, a dashed ring
// when that is unknown, or nothing (data).
//
// Used by:
//   - TransactionBox (below) — one per input and output
// -----------------------------------------------------------

function PortRow({ side, index, labels, mark = 'port' }) {

  const input = side === 'in';
  const top = rowTop(index);
  const textX = input ? TEXT_INSET : NODE_CONFIG.WIDTH - TEXT_INSET;
  const anchor = input ? 'start' : 'end';
  const edgeX = input ? 0 : NODE_CONFIG.WIDTH;


  return (
    <g>
      <title>{labels.tooltip}</title>
      <text x={textX} y={top + 15} textAnchor={anchor} fontSize={12} fontWeight={600} fill={labels.fill}>
        {labels.primary}
      </text>
      <text x={textX} y={top + 29} textAnchor={anchor} fontSize={11} fontFamily="ui-monospace, monospace" fill={COLORS.MUTED}>
        {labels.secondary}
      </text>

      {mark === 'coin' && (
        <circle cx={edgeX} cy={rowCenterY(index)} r={6} fill={COLORS.COIN} stroke={COLORS.COIN_EDGE} strokeWidth={1.5} />
      )}
      {mark === 'ring' && (
        <circle cx={edgeX} cy={rowCenterY(index)} r={5} fill="#ffffff" stroke={COLORS.MUTED} strokeWidth={1.5} strokeDasharray="2 2" />
      )}
      {mark === 'port' && (
        <circle cx={edgeX} cy={rowCenterY(index)} r={3.5} fill="#ffffff" stroke={COLORS.MUTED} strokeWidth={1.5} />
      )}
    </g>
  );
}







// -----------------------------------------------------------
// CoinbaseRow
// -----------------------------------------------------------
//
// A coinbase's left half, where the inputs would be: the
// coins come from nowhere — the block's reward to its miner —
// so there is no row to draw and no port to link.
//
// Used by:
//   - TransactionBox (below) — instead of the input rows
// -----------------------------------------------------------

function CoinbaseRow() {
  return (
    <g>
      <title>Coinbase: naujos monetos — bloko atlygis kasėjui, įvesčių nėra</title>
      <text x={TEXT_INSET} y={rowTop(0) + 15} fontSize={12} fontWeight={600} fill={COLORS.INK}>
        Naujos monetos
      </text>
      <text x={TEXT_INSET} y={rowTop(0) + 29} fontSize={11} fill={COLORS.MUTED}>
        bloko atlygis
      </text>
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

export default function TransactionBox({ id, tx, x, y, names, faucetAddress, unit, dragging, focused, handlers }) {

  const { WIDTH, BAND_HEIGHT } = NODE_CONFIG;
  const height = transactionHeight(tx);
  const mined = tx.block !== null;
  const sender = senderOf(tx, names);
  const band = tx.inputs.some((input) => input.address && input.address === faucetAddress) ? COLORS.BRAND : COLORS.INK;

  // A coinbase has no fee to show; "?" when an input's amount
  // is not known
  let feeText = tx.fee === null ? 'mokestis ?' : `mokestis ${tx.fee.toLocaleString('lt-LT')} sat`;
  if (tx.coinbase) feeText = '';

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
          {feeText}
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

      {tx.coinbase && <CoinbaseRow />}

      {tx.inputs.map((input, vin) => (
        <PortRow
          key={`in-${vin}`}
          side="in"
          index={vin}
          labels={inputLabels(input, sender, names, faucetAddress, unit)}
        />
      ))}

      {tx.outputs.map((output, vout) => {
        const state = spendStateOf(output);
        return (
          <PortRow
            key={`out-${vout}`}
            side="out"
            index={vout}
            labels={outputLabels(output, isChange(tx, output), state, names, faucetAddress, unit)}
            mark={MARK_OF_STATE[state]}
          />
        );
      })}
    </g>
  );
}

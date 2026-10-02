// -----------------------------------------------------------
//  [*] Tests — UTXO graph: the plain helpers of the data module
//
//  The functions useTransactionGraph.js exports beside its
//  hooks, called directly — what the boxes, the table and the
//  dialog read every amount, name and state with:
//  groupThousands; formatAmount (every digit shown, trailing
//  zeros trimmed, apostrophe groups on both sides of the
//  point, exact integer arithmetic, "?" for an amount nobody
//  knows, bare digits for screen readers); shortTxid ("?" for
//  anything but a string); nameOf (a name from the book, a
//  short address, what an address-less script pays to,
//  "Nežinomas adresas", only text taken as a name or an
//  address); senderOf (one sender, several parties, a block's
//  reward, nobody known, only text counted as a name);
//  isChange; spendStateOf; dayOf — and the box
//  geometry useNodePositions.js exports (columnKeyOf, rowTop,
//  rowCenterY, transactionHeight). The fixture day's own
//  transactions are the cases wherever they have one.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as f from '../../support/backend/fixtures';
import { T, spend, coin, transaction } from '../../support/graph-utxo/transactions';
import { NODE_CONFIG } from '@/pages/Graph_UTXO/constants';
import {
  dayOf, formatAmount, groupThousands, isChange, nameOf, senderOf, shortTxid, spendStateOf,
} from '@/pages/Graph_UTXO/hooks/useTransactionGraph';
import { columnKeyOf, rowCenterY, rowTop, transactionHeight } from '@/pages/Graph_UTXO/hooks/useNodePositions';


// The fixture day's transactions by name, and its address book
const day = Object.fromEntries(f.utxoGraph({ live: true }).transactions.map((tx) => [Object.keys(T).find((k) => T[k] === tx.txid), tx]));
const names = f.utxoNames;







// -----------------------------------------------------------
// groupThousands
// -----------------------------------------------------------

describe('groupThousands', () => {

  it("splits a whole number into threes from the right with an apostrophe", () => {
    expect(groupThousands(1100)).toBe("1'100");
    expect(groupThousands(1234567)).toBe("1'234'567");
    expect(groupThousands(100000)).toBe("100'000");
    expect(groupThousands(1000)).toBe("1'000");
  });


  it('leaves a number of three digits or fewer as it is', () => {
    expect(groupThousands(0)).toBe('0');
    expect(groupThousands(12)).toBe('12');
    expect(groupThousands(999)).toBe('999');
  });


  it('takes the digits as a string too', () => {
    expect(groupThousands('4360')).toBe("4'360");
    expect(groupThousands('21000000')).toBe("21'000'000");
  });
});







// -----------------------------------------------------------
// formatAmount
// -----------------------------------------------------------
//
// Satoshis in, coin units out: the whole part grouped from
// the right, the eight decimals from the point.
// -----------------------------------------------------------

describe('formatAmount', () => {

  it("shows every satoshi digit, the decimals grouped from the point: 0.12345678 reads \"0.123'456'78\"", () => {
    expect(formatAmount(12345678)).toBe("0.123'456'78");
    expect(formatAmount(99999999)).toBe("0.999'999'99");
  });


  it("groups the whole part from the right and the decimals from the point: 1250.605598 reads \"1'250.605'598\"", () => {
    expect(formatAmount(125060559800)).toBe("1'250.605'598");
    expect(formatAmount(2100000000000000)).toBe("21'000'000");
  });


  it("one satoshi reads \"0.000'000'01\"", () => {
    expect(formatAmount(1)).toBe("0.000'000'01");
  });


  it('trims trailing zeros — a round amount has no point at all', () => {
    expect(formatAmount(10000000)).toBe('0.1');
    expect(formatAmount(100000000)).toBe('1');
    expect(formatAmount(5000000000)).toBe('50');
    expect(formatAmount(1000)).toBe("0.000'01");
    expect(formatAmount(0)).toBe('0');
  });


  it('is exact where floating point is not: 0.1 + 0.2 coins read "0.3"', () => {
    expect(formatAmount(10000000 + 20000000)).toBe('0.3');
    expect(formatAmount(30000000)).toBe('0.3');
    expect(formatAmount(70000001)).toBe("0.700'000'01");
  });


  it('reads the fixture day as the boxes show it', () => {
    expect(formatAmount(day.T1.outputs[0].value)).toBe("0.009'989");
    expect(formatAmount(day.T2.inputs[0].value)).toBe("749.929'951'1");
    expect(formatAmount(day.T4.outputs[1].value)).toBe("749.839'857'3");
    expect(formatAmount(day.T5.outputs[2].value)).toBe("0.049'986");
  });


  it('an amount nobody knows — an input whose earlier transaction the server never gave — reads "?"', () => {
    expect(formatAmount(null)).toBe('?');
    expect(formatAmount(undefined)).toBe('?');
    expect(formatAmount(null, { grouped: false })).toBe('?');
  });


  it('grouped: false gives the bare digits, for screen readers', () => {
    expect(formatAmount(12345678, { grouped: false })).toBe('0.12345678');
    expect(formatAmount(125060559800, { grouped: false })).toBe('1250.605598');
    expect(formatAmount(1, { grouped: false })).toBe('0.00000001');
    expect(formatAmount(2100000000000000, { grouped: false })).toBe('21000000');
    expect(formatAmount(10000000, { grouped: false })).toBe('0.1');
    expect(formatAmount(0, { grouped: false })).toBe('0');
  });
});







// -----------------------------------------------------------
// shortTxid
// -----------------------------------------------------------

describe('shortTxid', () => {

  it('keeps the first six and the last four characters around an ellipsis', () => {
    expect(shortTxid(T.T1)).toBe('a1a1a1…a1a1');
    expect(shortTxid(`3f9a1c${'0'.repeat(54)}7be2`)).toBe('3f9a1c…7be2');
  });


  it('reads "?" for anything that is not a string, instead of throwing', () => {
    for (const odd of [null, undefined, 12345, {}, ['a1'.repeat(32)]]) expect(shortTxid(odd)).toBe('?');
  });
});







// -----------------------------------------------------------
// nameOf
// -----------------------------------------------------------

describe('nameOf', () => {

  it('names an address from the book', () => {
    expect(nameOf(f.JONAS, names)).toBe('Jonas');
    expect(nameOf(f.FAUCET_UTXO, names)).toBe("Faucet'as");
  });


  it('cuts an address nobody named to its first eight and last four characters', () => {
    expect(nameOf(f.HUB, names)).toBe('tb1qw508…jzsx');
    expect(nameOf(f.EGLE, {})).toBe('tb1q3gq3…n05n');
  });


  it('names an output without an address by what its script pays to', () => {
    expect(nameOf(null, names, 'op_return')).toBe('OP_RETURN duomenys');
    expect(nameOf(null, names, 'p2pk')).toBe('Viešasis raktas (P2PK)');
    expect(nameOf(null, names, 'nonstandard')).toBe('Nestandartinis scenarijus');
  });


  it('an address nobody knows reads "Nežinomas adresas", whatever the script', () => {
    expect(nameOf(null, names)).toBe('Nežinomas adresas');
    expect(nameOf(null, names, 'p2wpkh')).toBe('Nežinomas adresas');
    expect(nameOf('', names)).toBe('Nežinomas adresas');
  });


  it('takes only text as a name or an address — anything else in the book falls back to the short address', () => {
    expect(nameOf(f.JONAS, { [f.JONAS]: 42 })).toBe('tb1qxc2w…xek8');
    expect(nameOf(f.JONAS, { [f.JONAS]: { vardas: 'Jonas' } })).toBe('tb1qxc2w…xek8');
    expect(nameOf(f.JONAS, { [f.JONAS]: '' })).toBe('tb1qxc2w…xek8');
    expect(nameOf(12345, names)).toBe('Nežinomas adresas');
    expect(nameOf('constructor', {})).toBe('construc…ctor');
  });


  it('labels an address-less output only by a script type it knows — never by what a plain object inherits', () => {
    for (const odd of ['constructor', '__proto__', 'toString', 42]) expect(nameOf(null, names, odd)).toBe('Nežinomas adresas');
  });
});







// -----------------------------------------------------------
// senderOf
// -----------------------------------------------------------
//
// All inputs count as ONE sender unless two different names
// prove otherwise.
// -----------------------------------------------------------

describe('senderOf', () => {

  it('one wallet signing every input is one sender: the name among them', () => {
    expect(senderOf(day.T2, names)).toEqual({ label: "Faucet'as", several: false });
    expect(senderOf(day.T1, names)).toEqual({ label: 'Jonas', several: false });
  });


  it('a named input and an unnamed one still make one sender — the named one', () => {
    const tx = transaction({ txid: T.T1, inputs: [spend(T.T0, 0, f.HUB, 5), spend(T.T0, 1, f.JONAS, 5)] });
    expect(senderOf(tx, names)).toEqual({ label: 'Jonas', several: false });
  });


  it('two addresses carrying the same name are still one sender', () => {
    const tx = transaction({ txid: T.T1, inputs: [spend(T.T0, 0, f.JONAS, 5), spend(T.T0, 1, f.PETRAS, 5)] });
    expect(senderOf(tx, { [f.JONAS]: 'Jonas', [f.PETRAS]: 'Jonas' })).toEqual({ label: 'Jonas', several: false });
  });


  it('two different names prove different people paid in: "Kelios pusės"', () => {
    const tx = transaction({ txid: T.T1, inputs: [spend(T.T0, 0, f.JONAS, 5), spend(T.T0, 1, f.EGLE, 5)] });
    expect(senderOf(tx, names)).toEqual({ label: 'Kelios pusės', several: true });
  });


  it("with nobody named, the first known input's short address", () => {
    const tx = transaction({ txid: T.T1, inputs: [spend(T.T0, 0, null, null), spend(T.T0, 1, f.HUB, 5), spend(T.T0, 2, f.JONAS, 5)] });
    expect(senderOf(tx, {})).toEqual({ label: 'tb1qw508…jzsx', several: false });
  });


  it('with no input address known at all: "Nežinomas siuntėjas"', () => {
    expect(senderOf(transaction({ txid: T.T1, inputs: [spend(T.T0, 0, null, null)] }), names)).toEqual({ label: 'Nežinomas siuntėjas', several: false });
    expect(senderOf(transaction({ txid: T.T1, inputs: [] }), names)).toEqual({ label: 'Nežinomas siuntėjas', several: false });
  });


  it("a coinbase has no sender — it is the block's reward", () => {
    const tx = transaction({ txid: T.COINBASE, coinbase: true, fee: null, outputs: [coin(f.FAUCET_UTXO, 5000000000)] });
    expect(senderOf(tx, names)).toEqual({ label: 'Bloko atlygis (coinbase)', several: false });
  });


  it('counts only text in the book as a name — a name of another type proves nobody', () => {
    const tx = transaction({ txid: T.T1, inputs: [spend(T.T0, 0, f.JONAS, 5), spend(T.T0, 1, f.EGLE, 5)] });
    expect(senderOf(tx, { [f.JONAS]: 42, [f.EGLE]: { vardas: 'Eglė' } })).toEqual({ label: 'tb1qxc2w…xek8', several: false });
    expect(senderOf(tx, { [f.JONAS]: 'Jonas', [f.EGLE]: ['Eglė'] })).toEqual({ label: 'Jonas', several: false });
  });
});







// -----------------------------------------------------------
// isChange
// -----------------------------------------------------------

describe('isChange', () => {

  it('an output paid back to an address the transaction spends from is change', () => {
    expect(isChange(day.T5, day.T5.outputs[2])).toBe(true);
    expect(isChange(day.T2, day.T2.outputs[1])).toBe(true);
  });


  it('a payment to anyone else is not', () => {
    expect(isChange(day.T5, day.T5.outputs[0])).toBe(false);
    expect(isChange(day.T1, day.T1.outputs[0])).toBe(false);
  });


  it('an output without an address is never change, not even beside an input without one', () => {
    const tx = transaction({ txid: T.T1, inputs: [spend(T.T0, 0, null, null)], outputs: [coin(null, 0, { scriptType: 'op_return' })] });
    expect(isChange(tx, tx.outputs[0])).toBe(false);
    expect(isChange(day.T5, day.T5.outputs[1])).toBe(false);
  });
});







// -----------------------------------------------------------
// spendStateOf
// -----------------------------------------------------------

describe('spendStateOf', () => {

  it('spent: a transaction some history lists spends it', () => {
    expect(spendStateOf(day.T1.outputs[0])).toBe('spent');
  });


  it("unspent: nobody has spent it, and that is certain — its address's history was read", () => {
    expect(spendStateOf(day.T4.outputs[1])).toBe('unspent');
    expect(spendStateOf(day.T5.outputs[2])).toBe('unspent');
  });


  it("unknown: nobody seen spending it, but nobody read that address's history", () => {
    expect(spendStateOf(day.T5.outputs[0])).toBe('unknown');
  });


  it('data: an OP_RETURN holds no coin to spend, whatever else is said of it', () => {
    expect(spendStateOf(day.T5.outputs[1])).toBe('data');
    expect(spendStateOf({ ...day.T5.outputs[1], spent_known: false })).toBe('data');
  });


  it('a known spender is final, even for an address whose history was not read', () => {
    expect(spendStateOf({ ...day.T5.outputs[0], spent_by: { txid: T.T0, vin: 0 } })).toBe('spent');
  });
});







// -----------------------------------------------------------
// dayOf
// -----------------------------------------------------------

describe('dayOf', () => {

  it('is the LOCAL calendar day as YYYY-MM-DD, zero-padded', () => {
    expect(dayOf(new Date(2026, 0, 5, 9, 30))).toBe('2026-01-05');
    expect(dayOf(new Date(2026, 8, 30, 12))).toBe('2026-09-30');
  });


  it('keeps a moment to its own day at both ends of it', () => {
    expect(dayOf(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31');
    expect(dayOf(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
    expect(dayOf(new Date(2027, 0, 1, 0, 0, 0))).toBe('2027-01-01');
  });
});







// -----------------------------------------------------------
// Box geometry
// -----------------------------------------------------------
//
// The layout functions useNodePositions.js exports: the
// column a transaction lives in, and where the rows of a box
// sit — under the band and the txid line, one row height
// apart, the port in each row's middle.
// -----------------------------------------------------------

describe('box geometry', () => {

  it('a mined transaction lives in its block\'s column, a waiting one in the mempool\'s', () => {
    expect(columnKeyOf(day.T1)).toBe('block-154390');
    expect(columnKeyOf(day.T5)).toBe('mempool');
  });


  it('rows start under the band and the txid line and stack one row height apart', () => {
    const { BAND_HEIGHT, TXID_HEIGHT, ROW_HEIGHT } = NODE_CONFIG;
    expect(rowTop(0)).toBe(BAND_HEIGHT + TXID_HEIGHT);
    expect(rowTop(1) - rowTop(0)).toBe(ROW_HEIGHT);
    expect(rowTop(3) - rowTop(2)).toBe(ROW_HEIGHT);
  });


  it("a row's port sits in the row's middle", () => {
    expect(rowCenterY(0)).toBe(rowTop(0) + NODE_CONFIG.ROW_HEIGHT / 2);
    expect(rowCenterY(2)).toBe(rowTop(2) + NODE_CONFIG.ROW_HEIGHT / 2);
  });


  it('a box is as tall as its longer side, plus the footer', () => {
    // T5: one input, three outputs; T2: two and two; a
    // coinbase: no inputs, two outputs
    expect(transactionHeight(day.T5)).toBe(rowTop(3) + NODE_CONFIG.FOOTER);
    expect(transactionHeight(day.T2)).toBe(rowTop(2) + NODE_CONFIG.FOOTER);
    expect(transactionHeight(transaction({ txid: T.COINBASE, coinbase: true, outputs: [coin(f.FAUCET_UTXO, 1), coin(null, 0)] }))).toBe(rowTop(2) + NODE_CONFIG.FOOTER);
    expect(transactionHeight(transaction({ txid: T.T1 }))).toBe(rowTop(0) + NODE_CONFIG.FOOTER);
  });
});

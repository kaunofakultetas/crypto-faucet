// -----------------------------------------------------------
//  [*] Tests — UTXO graph: one transaction box (TransactionBox)
//
//  The box on its own inside an <svg>, fed the fixture day's
//  transactions and made-up ones: the band (the sender said
//  once, burgundy when the faucet sends, the fee — "?" when an
//  input's amount is unknown, none for a coinbase — the short
//  txid under it and the full one on hover), the input rows
//  (amount over the outpoint; owners named only when several
//  people pay, the faucet's in burgundy; "?" for a coin the
//  server never gave), the output rows (recipient over amount,
//  a short address or the script's label when nobody named
//  it, change said only in the tooltip), the mark each output
//  ends in (gold coin, dashed ring, nothing, plain port), the
//  coinbase's "Naujos monetos" half, the frame (solid grey,
//  dashed amber in the mempool, burgundy and thicker with
//  keyboard focus, thicker while dragged), the box as a named
//  button placed at its x / y — and, on the page, keyboard
//  focus framing it while a mouse press does not.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderPage } from '../../support/render';
import { given } from '../../support/backend/server';
import { mediaQueryMatches } from '../../support/setup';
import * as f from '../../support/backend/fixtures';
import {
  DAYS, pinToday, renderGraph, findBox, bandOf, frameOf, rowsOf,
} from '../../support/graph-utxo/graph';
import { T, X, spend, coin, transaction, dayTransactions } from '../../support/graph-utxo/transactions';
import { COLORS } from '@/pages/Graph_UTXO/constants';
import TransactionBox from '@/pages/Graph_UTXO/components/TransactionBox';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});


const day = Object.fromEntries(dayTransactions().map((tx) => [Object.keys(T).find((k) => T[k] === tx.txid), tx]));







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// drawBox renders one box at (40, 60) in an <svg>, with the
// fixture's names, the faucet's address and "tBTC4" unless
// told otherwise, and returns it — a button, found by role.
// joinTx is a CoinJoin: Jonas and the faucet both pay in.
// coinbaseTx pays the faucet a block's reward.
// -----------------------------------------------------------

function drawBox(tx, { names = f.utxoNames, faucetAddress = f.FAUCET_UTXO, unit = 'tBTC4', dragging = false, focused = false, handlers = {} } = {}) {
  const rendered = renderPage(
    <svg>
      <TransactionBox
        id={`utxo-tx-${tx.txid}`}
        tx={tx}
        x={40}
        y={60}
        names={names}
        faucetAddress={faucetAddress}
        unit={unit}
        dragging={dragging}
        focused={focused}
        handlers={handlers}
      />
    </svg>,
  );
  return { ...rendered, box: within(rendered.container).getByRole('button') };
}

const joinTx = () => transaction({
  txid: X.JOIN,
  block: 154391,
  inputs: [spend(T.T0, 0, f.JONAS, 1000000), spend(T.OLD_FAUCET_COIN, 3, f.FAUCET_UTXO, 20000000)],
  outputs: [coin(f.EGLE, 20000000), coin(f.JONAS, 998500)],
});

const coinbaseTx = () => transaction({
  txid: T.COINBASE,
  block: 154000,
  coinbase: true,
  fee: null,
  outputs: [coin(f.FAUCET_UTXO, 5000000000, { spentBy: { txid: T.OLD_FAUCET_COIN, vin: 0 } }), coin(null, 0, { scriptType: 'op_return' })],
});







// -----------------------------------------------------------
// The band
// -----------------------------------------------------------
//
// The sender once for the whole transaction, the fee on the
// right, the short txid under it.
// -----------------------------------------------------------

describe('TransactionBox band', () => {

  it('names the sender once, with the fee on the right and the short txid under it — the full txid on hover', () => {
    const { box } = drawBox(day.T1);
    expect(bandOf(box)).toMatchObject({
      sender: 'Jonas',
      fee: "mokestis 1'100 sat",
      txid: 'a1a1a1…a1a1',
      tooltip: T.T1,
    });
  });


  it("wears the brand burgundy when the faucet sends, slate for everyone else's", () => {
    expect(bandOf(drawBox(day.T2).box).color).toBe(COLORS.BRAND);
    expect(bandOf(drawBox(day.T4).box).color).toBe(COLORS.BRAND);
    expect(bandOf(drawBox(day.T3).box).color).toBe(COLORS.INK);
  });


  it('groups a large fee in threes', () => {
    const { box } = drawBox({ ...day.T1, fee: 1234567 });
    expect(bandOf(box).fee).toBe("mokestis 1'234'567 sat");
  });


  it('reads "mokestis ?" when an input\'s amount is not known', () => {
    const tx = transaction({ txid: X.LOST, inputs: [spend(T.T0, 0, null, null)], outputs: [coin(f.JONAS, 1000)], fee: null });
    expect(bandOf(drawBox(tx).box).fee).toBe('mokestis ?');
  });


  it("shows no fee for a coinbase and names the block's reward as its sender", () => {
    const band = bandOf(drawBox(coinbaseTx()).box);
    expect(band.fee).toBe('');
    expect(band.sender).toBe('Bloko atlygis (coinbase)');
  });


  it('says "Kelios pusės" when two different people pay in', () => {
    expect(bandOf(drawBox(joinTx()).box).sender).toBe('Kelios pusės');
  });
});







// -----------------------------------------------------------
// Input and output rows
// -----------------------------------------------------------

describe('TransactionBox rows', () => {

  it("an input row shows the coin's amount over the outpoint it spends; its tooltip adds the address and the full outpoint", () => {
    const { inputs } = rowsOf(drawBox(day.T1).box);
    expect(inputs).toEqual([expect.objectContaining({
      primary: '0.01 tBTC4',
      secondary: 'a0a0a0…a0a0:0',
      tooltip: `${f.JONAS} — 0.01 tBTC4 — ${T.T0}:0`,
      color: COLORS.INK,
    })]);
  });


  it('lists every input in its order, each with its own outpoint', () => {
    const { inputs } = rowsOf(drawBox(day.T2).box);
    expect(inputs.map((row) => [row.primary, row.secondary])).toEqual([
      ["749.929'951'1 tBTC4", '0f0f0f…0f0f:1'],
      ["0.009'989 tBTC4", 'a1a1a1…a1a1:0'],
    ]);
  });


  it('an input whose earlier transaction the server never gave reads "?" and says the address is unknown', () => {
    const tx = transaction({ txid: X.LOST, inputs: [spend(T.T0, 2, null, null)], outputs: [coin(f.JONAS, 1000)], fee: null });
    const [row] = rowsOf(drawBox(tx).box).inputs;
    expect(row.primary).toBe('? tBTC4');
    expect(row.secondary).toBe('a0a0a0…a0a0:2');
    expect(row.tooltip).toBe(`adresas nežinomas — ? tBTC4 — ${T.T0}:2`);
  });


  it("when several people pay, each input row names its owner over the amount — the faucet's in burgundy", () => {
    const { inputs } = rowsOf(drawBox(joinTx()).box);
    expect(inputs.map(({ primary, secondary, color }) => ({ primary, secondary, color }))).toEqual([
      { primary: 'Jonas', secondary: '0.01 tBTC4', color: COLORS.INK },
      { primary: "Faucet'as", secondary: '0.2 tBTC4', color: COLORS.BRAND },
    ]);
  });


  it("an output row names the recipient over the amount — the faucet's name in burgundy", () => {
    const { outputs } = rowsOf(drawBox(day.T2).box);
    expect(outputs.map(({ primary, secondary, color }) => ({ primary, secondary, color }))).toEqual([
      { primary: 'Eglė', secondary: '0.1 tBTC4', color: COLORS.INK },
      { primary: "Faucet'as", secondary: "749.839'896'5 tBTC4", color: COLORS.BRAND },
    ]);
  });


  it('names an address nobody named by its short form, and an address-less output by its script', () => {
    const { outputs } = rowsOf(drawBox(day.T5).box);
    expect(outputs.map((row) => row.primary)).toEqual(['tb1qw508…jzsx', 'OP_RETURN duomenys', 'Jonas']);
    expect(outputs[1].secondary).toBe('0 tBTC4');
  });


  it('carries no change mark on the drawing — only the tooltip says the coin went back ("grąža")', () => {
    const [, , change] = rowsOf(drawBox(day.T5).box).outputs;
    expect(change.primary).toBe('Jonas');
    expect(change.secondary).toBe("0.049'986 tBTC4");
    expect(change.tooltip).toBe(`${f.JONAS} — 0.049'986 tBTC4 — grąža — neišleista`);
  });


  it("a spent output's tooltip is its address and amount alone", () => {
    const [row] = rowsOf(drawBox(day.T1).box).outputs;
    expect(row.tooltip).toBe(`${f.FAUCET_UTXO} — 0.009'989 tBTC4`);
  });


  it("shows every amount in the network's unit", () => {
    const { inputs, outputs } = rowsOf(drawBox(day.T1, { unit: 'KNF' }).box);
    expect(inputs[0].primary).toBe('0.01 KNF');
    expect(outputs[0].secondary).toBe("0.009'989 KNF");
  });
});







// -----------------------------------------------------------
// Spend marks
// -----------------------------------------------------------
//
// What an output row ends in tells the coin's state; every
// input row has the port its curve attaches to.
// -----------------------------------------------------------

describe('TransactionBox spend marks', () => {

  it('ends each output in its state: a dashed ring (unknown), nothing (data), a gold coin (unspent)', () => {
    const { outputs } = rowsOf(drawBox(day.T5).box);
    expect(outputs.map((row) => row.mark)).toEqual(['ring', 'none', 'coin']);
  });


  it('ends a spent output in the plain port its curve leaves from', () => {
    expect(rowsOf(drawBox(day.T1).box).outputs.map((row) => row.mark)).toEqual(['port']);
    expect(rowsOf(drawBox(day.T4).box).outputs.map((row) => row.mark)).toEqual(['port', 'coin']);
  });


  it('says the state in words in the tooltip', () => {
    const tooltips = rowsOf(drawBox(day.T5).box).outputs.map((row) => row.tooltip);
    expect(tooltips).toEqual([
      `${f.HUB} — 0.05 tBTC4 — nežinoma, ar išleista`,
      'OP_RETURN duomenys — 0 tBTC4 — duomenys — išleisti negalima',
      `${f.JONAS} — 0.049'986 tBTC4 — grąža — neišleista`,
    ]);
  });


  it('gives every input row a port', () => {
    expect(rowsOf(drawBox(day.T2).box).inputs.map((row) => row.mark)).toEqual(['port', 'port']);
  });
});







// -----------------------------------------------------------
// The coinbase
// -----------------------------------------------------------

describe('TransactionBox coinbase', () => {

  it("says in its left half that the coins are new — the block's reward — with no input row and no port", () => {
    const { inputs, outputs } = rowsOf(drawBox(coinbaseTx()).box);
    expect(inputs).toEqual([{
      primary: 'Naujos monetos',
      secondary: 'bloko atlygis',
      tooltip: 'Coinbase: naujos monetos — bloko atlygis kasėjui, įvesčių nėra',
      color: COLORS.INK,
      mark: 'none',
    }]);
    expect(outputs.map((row) => [row.primary, row.secondary, row.mark])).toEqual([
      ["Faucet'as", '50 tBTC4', 'port'],
      ['OP_RETURN duomenys', '0 tBTC4', 'none'],
    ]);
  });


  it('is named as a block\'s reward', () => {
    drawBox(coinbaseTx());
    expect(screen.getByRole('button', { name: 'Transakcija cbcbcb…cbcb, siuntėjas Bloko atlygis (coinbase), blokas 154000' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The button, its frame and its place
// -----------------------------------------------------------

describe('TransactionBox as a button', () => {

  it('is a focusable button opening a dialog, named by its short txid, sender and block', () => {
    const { box } = drawBox(day.T1);
    expect(box).toHaveAccessibleName('Transakcija a1a1a1…a1a1, siuntėjas Jonas, blokas 154390');
    expect(box).toHaveAttribute('aria-haspopup', 'dialog');
    expect(box).toHaveAttribute('tabindex', '0');
  });


  it('a mined box has a solid grey frame', () => {
    expect(frameOf(drawBox(day.T1).box)).toEqual({ color: COLORS.BORDER, width: 1.5, dashed: false });
  });


  it('a box waiting in the mempool says so in its name and wears a dashed amber frame', () => {
    const { box } = drawBox(day.T5);
    expect(box).toHaveAccessibleName('Transakcija a5a5a5…a5a5, siuntėjas Jonas, laukia patvirtinimo');
    expect(frameOf(box)).toEqual({ color: COLORS.COIN_EDGE, width: 1.5, dashed: true });
  });


  it('keyboard focus frames the box in burgundy with a thicker line', () => {
    expect(frameOf(drawBox(day.T1, { focused: true }).box)).toEqual({ color: COLORS.BRAND, width: 2.5, dashed: false });
    expect(frameOf(drawBox(day.T5, { focused: true }).box)).toEqual({ color: COLORS.BRAND, width: 2.5, dashed: true });
  });


  it('a box being dragged keeps its colour but gets the thicker line', () => {
    expect(frameOf(drawBox(day.T1, { dragging: true }).box)).toEqual({ color: COLORS.BORDER, width: 2.5, dashed: false });
  });


  it('sits with its top-left corner at the x / y it is given', () => {
    expect(drawBox(day.T1).box).toHaveAttribute('transform', 'translate(40, 60)');
  });


  it('passes the pointer and key handlers it is given to the box', async () => {
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    const { box, user } = drawBox(day.T1, { handlers: { onClick, onKeyDown } });
    await user.click(box);
    box.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }));
  });
});







// -----------------------------------------------------------
// Focus on the page
// -----------------------------------------------------------
//
// The canvas frames a box only for KEYBOARD focus: tabbing
// from the date field onto the first box (the day list holds
// only today, so no stepper stands between them) frames it; a
// mouse press focuses the box too but leaves it unframed.
// -----------------------------------------------------------

describe('TransactionBox focus on the page', () => {

  it('Tab onto a box frames it in burgundy; Shift+Tab away takes the frame off', async () => {
    given.json('get', DAYS, { days: [] });
    const { user } = renderGraph();
    const box = await findBox(T.T1);

    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Data' })).toHaveFocus();
    await user.tab();
    expect(box).toHaveFocus();
    await waitFor(() => expect(frameOf(box)).toEqual({ color: COLORS.BRAND, width: 2.5, dashed: false }));

    await user.tab({ shift: true });
    expect(box).not.toHaveFocus();
    await waitFor(() => expect(frameOf(box)).toEqual({ color: COLORS.BORDER, width: 1.5, dashed: false }));
  });


  it('a mouse press focuses the box without framing it', async () => {
    const { user } = renderGraph();
    const box = await findBox(T.T1);
    await user.pointer({ keys: '[MouseLeft>]', target: box });
    expect(box).toHaveFocus();
    expect(frameOf(box).color).toBe(COLORS.BORDER);
  });
});

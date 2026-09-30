// -----------------------------------------------------------
//  [*] Tests — UTXO graph: the drawing (UtxoFlowGraph)
//
//  What the canvas draws for a day, through the page: the
//  blocks as columns left to right with the mempool last only
//  while the day is live (drawn even empty), the pinned
//  block-height row — "Blokas #154390" over the block's local
//  time, "Mempool" over "laukia patvirtinimo", no time for a
//  block whose time is unknown, and the shorter "#154390" once
//  zoomed out — the lanes tinted like their cells (every other
//  block grey, the mempool amber), every box inside its own
//  block's column, each column as wide as its boxes need, the
//  spend curves (one per output a listed transaction spent,
//  solid, from the output's port to the input's, burgundy for
//  the faucet's coin with an arrowhead to match, none for a
//  coin from before the day, following a dragged box at both
//  ends), and the text alternative — the visually hidden
//  table the drawing is described by, with ungrouped amounts,
//  owners named only when several people pay, a coinbase's
//  new coins and its dash for a fee.
// -----------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import { mediaQueryMatches } from '../../support/setup';
import * as f from '../../support/backend/fixtures';
import {
  pinToday, renderGraph, answerGraph, findBox, getBox, queryBox, positionOf, headerCells, edges, portsOf, rowsOf, graphGroup, dragBy,
  drawing, header,
} from '../../support/graph-utxo/graph';
import { T, X, spend, coin, transaction, dayTransactions } from '../../support/graph-utxo/transactions';
import { COLORS, NODE_CONFIG } from '@/pages/Graph_UTXO/constants';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});


const TABLE_NAME = 'Transakcijos pagal blokus';







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// localTime is a block time as the viewer's clock shows it —
// 24-hour HH:MM (10:18 in the UTC container). showYesterday
// steps the day slider back once, from today to the fixture's
// day (a past one), and waits for its drawing. tableRows reads
// the hidden table's body as lists of cell texts.
// -----------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const localTime = (iso) => `${pad(new Date(iso).getHours())}:${pad(new Date(iso).getMinutes())}`;

async function showYesterday(user) {
  await user.click(await screen.findByRole('button', { name: 'Ankstesnė diena' }));
  await waitFor(() => {
    expect(queryBox(T.T1)).not.toBeNull();
    expect(queryBox(T.T5)).toBeNull();
  });
}

function tableRows() {
  const table = screen.getByRole('table', { name: TABLE_NAME });
  return within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
}

const withoutT5 = () => dayTransactions().filter((tx) => tx.txid !== T.T5);







// -----------------------------------------------------------
// Block columns and the pinned block row
// -----------------------------------------------------------

describe('Block columns and the pinned block row', () => {

  it("draws the day's blocks as columns left to right by height, the mempool last on a live day", async () => {
    renderGraph();
    await findBox(T.T1);
    expect(headerCells().map((cell) => cell.title)).toEqual(['Blokas #154390', 'Blokas #154391', 'Blokas #154395', 'Mempool']);
  });


  it("shows each block's local time under its height, and both in the cell's tooltip", async () => {
    renderGraph();
    await findBox(T.T1);
    const cells = headerCells();
    expect(cells.slice(0, 3).map((cell) => cell.subtitle)).toEqual(f.utxoBlocks.map((block) => localTime(block.time)));
    expect(cells[0].tooltip).toBe(`Blokas #154390 — ${localTime(f.utxoBlocks[0].time)}`);
    expect(cells[2].subtitle).toBe('11:02');
  });


  it('reads "Mempool" over "laukia patvirtinimo" on the mempool\'s cell', async () => {
    renderGraph();
    await findBox(T.T5);
    expect(headerCells()[3]).toMatchObject({ title: 'Mempool', subtitle: 'laukia patvirtinimo', tooltip: 'Mempool — laukia patvirtinimo' });
  });


  it('leaves the mempool column and its waiting transaction out of a past day', async () => {
    const { user } = renderGraph();
    await findBox(T.T5);
    await showYesterday(user);
    expect(headerCells().map((cell) => cell.title)).toEqual(['Blokas #154390', 'Blokas #154391', 'Blokas #154395']);
  });


  it('draws the mempool column on a live day even when nothing waits in it', async () => {
    answerGraph({ transactions: withoutT5() });
    renderGraph();
    await findBox(T.T4);
    expect(queryBox(T.T5)).toBeNull();
    expect(headerCells().map((cell) => cell.title)).toEqual(['Blokas #154390', 'Blokas #154391', 'Blokas #154395', 'Mempool']);
  });


  it("puts every box inside its own block's column, the columns side by side", async () => {
    renderGraph();
    await findBox(T.T5);
    const cells = headerCells();
    const columnOf = { 154390: 0, 154391: 1, 154395: 2, null: 3 };
    for (const tx of dayTransactions()) {
      const cell = cells[columnOf[tx.block]];
      const { x } = positionOf(getBox(tx.txid));
      expect(x).toBeGreaterThanOrEqual(cell.x);
      expect(x + NODE_CONFIG.WIDTH).toBeLessThanOrEqual(cell.x + cell.width);
    }
    cells.slice(1).forEach((cell, i) => expect(cell.x).toBe(cells[i].x + cells[i].width));
  });


  it('makes a column as wide as its boxes need — the chain in block 154395 holds two boxes side by side', async () => {
    renderGraph();
    await findBox(T.T4);
    const widths = headerCells().map((cell) => cell.width);
    expect(widths[2]).toBeGreaterThan(2 * NODE_CONFIG.WIDTH);
    expect(widths[0]).toBeLessThan(2 * NODE_CONFIG.WIDTH);
    expect(new Set([widths[0], widths[1], widths[3]]).size).toBe(1);
  });


  it('still draws a cell for a block the day has no transaction in', async () => {
    answerGraph({ blocks: [...f.utxoBlocks.slice(0, 2), { height: 154393, time: '2026-09-29T10:50:00Z' }, f.utxoBlocks[2]] });
    renderGraph();
    await findBox(T.T4);
    expect(headerCells().map((cell) => cell.title)).toEqual(['Blokas #154390', 'Blokas #154391', 'Blokas #154393', 'Blokas #154395', 'Mempool']);
  });


  it('shows no time for a block whose time is not known yet', async () => {
    answerGraph({ blocks: [{ height: 154390, time: null }, ...f.utxoBlocks.slice(1)] });
    renderGraph();
    await findBox(T.T1);
    expect(headerCells()[0]).toMatchObject({ title: 'Blokas #154390', subtitle: '', tooltip: 'Blokas #154390' });
  });


  it('shortens the labels as the cells narrow when zoomed out, and brings them back zoomed in', async () => {
    const { user } = renderGraph();
    await findBox(T.T5);
    const zoomOut = screen.getByRole('button', { name: 'Nutolinti' });
    for (let press = 0; press < 6; press += 1) await user.click(zoomOut);

    // At 0.4 the one-box columns are under 150 px: the short
    // "#height" in a smaller font, the time kept; the two-box
    // column still fits the full label; the mempool loses its
    // second line
    const narrow = headerCells();
    expect(narrow.map((cell) => [cell.title, cell.subtitle])).toEqual([
      ['#154390', localTime(f.utxoBlocks[0].time)],
      ['#154391', localTime(f.utxoBlocks[1].time)],
      ['Blokas #154395', localTime(f.utxoBlocks[2].time)],
      ['Mempool', ''],
    ]);
    expect(narrow[0].size).toBeLessThan(narrow[2].size);
    expect(narrow[0].tooltip).toBe(`Blokas #154390 — ${localTime(f.utxoBlocks[0].time)}`);

    const zoomIn = screen.getByRole('button', { name: 'Priartinti' });
    for (let press = 0; press < 6; press += 1) await user.click(zoomIn);
    expect(headerCells().map((cell) => cell.title)).toEqual(['Blokas #154390', 'Blokas #154391', 'Blokas #154395', 'Mempool']);
  });


  it("tints every other block's lane light grey and the mempool's amber, each header cell like its lane", async () => {
    renderGraph();
    await findBox(T.T5);
    // The lanes are the drawing's groups that are not boxes
    const lanes = [...drawing().children]
      .filter((node) => node.tagName === 'g' && !node.hasAttribute('role'))
      .map((lane) => lane.querySelector(':scope > rect').getAttribute('fill'));
    expect(lanes).toEqual(['#ffffff', COLORS.BLOCK_BAND, '#ffffff', COLORS.MEMPOOL_BAND]);
    const cellTints = [...header().querySelectorAll(':scope > g > rect')].map((rect) => rect.getAttribute('fill'));
    expect(cellTints).toEqual(lanes);
    const titles = [...header().querySelectorAll(':scope > g > text:first-of-type')].map((text) => text.getAttribute('fill'));
    expect(titles).toEqual([COLORS.INK, COLORS.INK, COLORS.INK, COLORS.COIN_EDGE]);
  });


  it('scales the cells with the zoom while their text keeps its size', async () => {
    const { user } = renderGraph();
    await findBox(T.T1);
    const before = headerCells();
    await user.click(screen.getByRole('button', { name: 'Priartinti' }));
    const after = headerCells();
    after.forEach((cell, i) => {
      expect(cell.width).toBeCloseTo(before[i].width * 1.1, 6);
      expect(cell.size).toBe(before[i].size);
    });
  });
});







// -----------------------------------------------------------
// Spend curves
// -----------------------------------------------------------
//
// One curve per input that spends an output of another listed
// transaction, output port to input port.
// -----------------------------------------------------------

describe('Spend curves', () => {

  it('draws one curve per spend between listed transactions — five on the live fixture day', async () => {
    renderGraph();
    await findBox(T.T5);
    expect(edges()).toHaveLength(5);
  });


  it("colours a curve carrying the faucet's coin burgundy, every other slate", async () => {
    renderGraph();
    await findBox(T.T5);
    // T1→T2, T2→T4 and T3→T4 move the faucet's coins; T2→T3
    // is Eglė's, T4→T5 Jonas'
    expect(edges().map((edge) => edge.color)).toEqual([COLORS.BRAND, COLORS.MUTED, COLORS.BRAND, COLORS.BRAND, COLORS.MUTED]);
  });


  it('draws every curve solid, ending in an arrowhead of its own colour', async () => {
    renderGraph();
    await findBox(T.T5);
    for (const path of drawing().querySelectorAll('path[marker-end]')) {
      expect(path).not.toHaveAttribute('stroke-dasharray');
      const head = document.querySelector(path.getAttribute('marker-end').replace(/^url\((.*)\)$/, '$1'));
      expect(head.querySelector('path')).toHaveAttribute('fill', path.getAttribute('stroke'));
    }
  });


  it("runs from the spent output's port to just before the spending input's port", async () => {
    renderGraph();
    await findBox(T.T2);
    const fromT1 = portsOf(getBox(T.T1)).outputs[0];
    const intoT2 = portsOf(getBox(T.T2)).inputs[1];
    expect(edges()[0].from).toEqual(fromT1);
    expect(edges()[0].to).toEqual({ x: intoT2.x - 4, y: intoT2.y });
  });


  it('gives an input spending a coin from before the day no curve — its row is still drawn', async () => {
    renderGraph();
    await findBox(T.T1);
    const intoT1 = portsOf(getBox(T.T1)).inputs[0];
    expect(edges().some((edge) => edge.to.y === intoT1.y && edge.to.x === intoT1.x - 4)).toBe(false);
    expect(rowsOf(getBox(T.T1)).inputs[0].secondary).toBe('a0a0a0…a0a0:0');
  });


  it('draws no curve into the mempool on a past day', async () => {
    const { user } = renderGraph();
    await findBox(T.T5);
    await showYesterday(user);
    expect(edges().map((edge) => edge.color)).toEqual([COLORS.BRAND, COLORS.MUTED, COLORS.BRAND, COLORS.BRAND]);
  });


  it('keeps both ends on their ports while a box is dragged', async () => {
    renderGraph();
    const box = await findBox(T.T3);
    const intoT3Before = portsOf(box).inputs[0];
    const fromT3Before = portsOf(box).outputs[0];
    dragBy(box, 30, 40);

    const intoT3 = portsOf(getBox(T.T3)).inputs[0];
    const fromT3 = portsOf(getBox(T.T3)).outputs[0];
    expect(intoT3).toEqual({ x: intoT3Before.x + 30, y: intoT3Before.y + 40 });
    expect(fromT3).toEqual({ x: fromT3Before.x + 30, y: fromT3Before.y + 40 });
    // T2:0 → T3:0 and T3:0 → T4:1
    expect(edges()[1].to).toEqual({ x: intoT3.x - 4, y: intoT3.y });
    expect(edges()[3].from).toEqual(fromT3);
  });
});







// -----------------------------------------------------------
// The text alternative
// -----------------------------------------------------------
//
// The visually hidden table that describes the drawing.
// -----------------------------------------------------------

describe('The text alternative', () => {

  it('describes the drawing with a table of every transaction', async () => {
    renderGraph();
    await findBox(T.T1);
    const table = screen.getByRole('table', { name: TABLE_NAME });
    expect(graphGroup()).toHaveAttribute('aria-describedby', table.id);
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent))
      .toEqual(['Blokas', 'Transakcija', 'Siuntėjas', 'Įvestys', 'Išvestys', 'Mokestis']);
  });


  it('gives each transaction its block, full txid, sender, inputs, outputs and fee — amounts ungrouped', async () => {
    renderGraph();
    await findBox(T.T5);
    expect(tableRows()).toEqual([
      ['154390', T.T1, 'Jonas', '0.01 tBTC4 (a0a0a0…a0a0:0)', "Faucet'as 0.009989 tBTC4", '1100 sat'],
      ['154391', T.T2, "Faucet'as", '749.9299511 tBTC4 (0f0f0f…0f0f:1); 0.009989 tBTC4 (a1a1a1…a1a1:0)', "Eglė 0.1 tBTC4; Faucet'as 749.8398965 tBTC4", '4360 sat'],
      ['154395', T.T3, 'Eglė', '0.1 tBTC4 (a2a2a2…a2a2:0)', "Faucet'as 0.0999862 tBTC4", '1380 sat'],
      ['154395', T.T4, "Faucet'as", '749.8398965 tBTC4 (a2a2a2…a2a2:1); 0.0999862 tBTC4 (a3a3a3…a3a3:0)', "Jonas 0.1 tBTC4; Faucet'as 749.8398573 tBTC4", '2540 sat'],
      ['mempool', T.T5, 'Jonas', '0.1 tBTC4 (a4a4a4…a4a4:0)', 'tb1qw508…jzsx 0.05 tBTC4; OP_RETURN duomenys 0 tBTC4; Jonas 0.049986 tBTC4', '1400 sat'],
    ]);
  });


  it("names each input's owner only when several people pay", async () => {
    const join = transaction({
      txid: X.JOIN,
      block: 154391,
      inputs: [spend(T.T0, 0, f.JONAS, 1000000), spend(T.T0, 1, f.EGLE, 2000000)],
      outputs: [coin(f.PETRAS, 2998000)],
      fee: 2000,
    });
    answerGraph({ transactions: [join] });
    renderGraph();
    await findBox(X.JOIN);
    expect(tableRows()).toEqual([
      ['154391', X.JOIN, 'Kelios pusės', 'Jonas 0.01 tBTC4 (a0a0a0…a0a0:0); Eglė 0.02 tBTC4 (a0a0a0…a0a0:1)', 'tb1qvrzf…ssky 0.02998 tBTC4', '2000 sat'],
    ]);
  });


  it("reads a coinbase's inputs as new coins, an unknown input as \"?\" and a missing fee as a dash", async () => {
    const mined = transaction({
      txid: T.COINBASE, block: 154390, coinbase: true, fee: null, outputs: [coin(f.FAUCET_UTXO, 5000000000)],
    });
    const lost = transaction({
      txid: X.LOST, block: 154391, fee: null, inputs: [spend(T.T0, 4, null, null)], outputs: [coin(f.JONAS, 1000)],
    });
    answerGraph({ transactions: [mined, lost] });
    renderGraph();
    await findBox(X.LOST);
    expect(tableRows()).toEqual([
      ['154390', T.COINBASE, 'Bloko atlygis (coinbase)', 'naujos monetos (bloko atlygis)', "Faucet'as 50 tBTC4", '—'],
      ['154391', X.LOST, 'Nežinomas siuntėjas', '? tBTC4 (a0a0a0…a0a0:4)', 'Jonas 0.00001 tBTC4', '—'],
    ]);
  });


  it('empties with the drawing when the day has no transaction', async () => {
    answerGraph({ transactions: [] });
    renderGraph();
    expect(await screen.findByText('Šiandien čiaupo transakcijų dar nėra')).toBeInTheDocument();
    expect(tableRows()).toEqual([]);
  });
});

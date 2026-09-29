// -----------------------------------------------------------
//  [*] Graph_UTXO — useTransactionGraph
//
//  The data side of the UTXO graph: where the transactions
//  come from, which of them the picked day shows, and what
//  they MEAN. For now the source is the hand-written sample
//  in mockTransactions.js — the GUI mockup — and swapping it
//  for backend fetches touches only this file. The meaning
//  is derived in one place from the plain list: which
//  outputs a listed transaction spends (the graph's edges),
//  which ones nobody has spent (the loose coins), every fee
//  (inputs minus outputs — a UTXO transaction never states
//  its fee), which outputs are change (paid back to one of
//  the transaction's own input addresses) and who the sender
//  is. The names that say who controls which address live
//  here as state: a rename from the transaction dialog
//  relabels the whole graph (in memory for now — the backend
//  will store them like the EVM graph's). The small
//  formatters every part of the drawing shares live here
//  too.
//
//  Split into (root last) — plain functions with no React in
//  them, then the hooks:
//
//    outpointKey         — "txid:vout"
//    formatAmount        — satoshis → "0.1", exact
//    shortTxid           — "3f9a1c…7be2"
//    nameOf              — a name from the book, else a short
//                          address
//    senderOf            — who pays: one sender, or several
//                          parties
//    deriveGraph         — edges, spent, change, fees
//    dayOf               — a Date → its local 'YYYY-MM-DD'
//    useTransactionDays  — the days the slider offers
//    useTransactionGraph — the day's data + derived model
//                          (default export)
// -----------------------------------------------------------

import { useCallback, useMemo, useState } from 'react';

import { NAME_MAX_LENGTH } from '../constants';
import { MOCK_BLOCKS, MOCK_FAUCET_ADDRESS, MOCK_NAMES, MOCK_TRANSACTIONS } from '../mockTransactions';







// -----------------------------------------------------------
// outpointKey
// -----------------------------------------------------------
//
// "txid:vout" — the one name an output has on the chain.
//
// Used by:
//   - deriveGraph (below)
//   - TransactionBox.jsx — looking up spent / change per row
//   - TransactionModal.jsx — each output's spender and change
// -----------------------------------------------------------

export const outpointKey = (txid, vout) => `${txid}:${vout}`;







// -----------------------------------------------------------
// formatAmount
// -----------------------------------------------------------
//
// Satoshis → coin units with trailing zeros trimmed
// (10000000 → "0.1"). Integer arithmetic only — dividing by
// 1e8 in floating point can print 0.30000000000000004.
//
// Used by:
//   - TransactionBox.jsx — every row's amount and tooltip
//   - TransactionModal.jsx — the cards and the fee sum
//   - UtxoFlowGraph.jsx — the text-alternative table
// -----------------------------------------------------------

export function formatAmount(sat) {
  const whole = Math.floor(sat / 100_000_000);
  const fraction = String(sat % 100_000_000).padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}







// -----------------------------------------------------------
// shortTxid
// -----------------------------------------------------------
//
// A txid cut to its first 6 and last 4 characters — enough
// to tell the transactions on screen apart; the full txid is
// always one hover or one copy away.
//
// Used by:
//   - TransactionBox.jsx — the txid line, the input rows'
//     outpoints and the box's spoken label
//   - TransactionModal.jsx — the outpoint and spender links
//   - UtxoFlowGraph.jsx — the text-alternative table
// -----------------------------------------------------------

export const shortTxid = (txid) => `${txid.slice(0, 6)}…${txid.slice(-4)}`;







// -----------------------------------------------------------
// nameOf
// -----------------------------------------------------------
//
// The address's name from the book, else the address cut to
// its first 8 and last 4 characters.
//
// Used by:
//   - TransactionBox.jsx — every row's label
//   - UtxoFlowGraph.jsx — the text-alternative table
// -----------------------------------------------------------

export const nameOf = (address, names) => names[address] ?? `${address.slice(0, 8)}…${address.slice(-4)}`;







// -----------------------------------------------------------
// senderOf
// -----------------------------------------------------------
//
//   senderOf(tx, names) → { label, several }
//
// Who pays in a transaction. One wallet normally signs every
// input, but it spends from many addresses of its own and the
// chain cannot tell which addresses share a wallet — so, as
// chain analysis assumes, all inputs count as ONE sender:
// the one name among them, else the first input's short
// address. Only inputs carrying two DIFFERENT names prove
// different people put coins in (a CoinJoin, a PayJoin):
// then `several` is true and the label says so.
//
// Used by:
//   - TransactionBox.jsx — the band and the input rows
//   - TransactionModal.jsx — the Siuntėjas line
//   - UtxoFlowGraph.jsx — the text-alternative table
// -----------------------------------------------------------

export function senderOf(tx, names) {

  const named = new Set(tx.inputs.map((input) => names[input.address]).filter(Boolean));


  if (named.size > 1) {
    return { label: 'Kelios pusės', several: true };
  }
  return { label: named.size === 1 ? [...named][0] : nameOf(tx.inputs[0].address, names), several: false };
}







// -----------------------------------------------------------
// deriveGraph
// -----------------------------------------------------------
//
//   const { edges, spent, change, fees } = deriveGraph(transactions)
//
//   edges  — one per input whose source transaction is listed:
//            { id, fromTxid, vout, toTxid, vin, address,
//              value, isChange }
//   spent  — Map outpointKey → { txid, vin }: the listed
//            input that spends that output
//   change — Set of outpointKeys paid back to an input address
//   fees   — txid → fee in satoshis
//
// An input whose source transaction is NOT listed (a coin
// from before the graph's window) gets no edge — its box
// still shows it as an input row.
//
// Used by:
//   - useTransactionGraph (below) — once, over every
//     transaction
// -----------------------------------------------------------

function deriveGraph(transactions) {

  const listed = new Set(transactions.map((tx) => tx.txid));
  const spent = new Map();
  const change = new Set();
  const fees = {};
  const edges = [];


  for (const tx of transactions) {
    const inputAddresses = new Set(tx.inputs.map((input) => input.address));
    const totalIn = tx.inputs.reduce((total, input) => total + input.value, 0);
    const totalOut = tx.outputs.reduce((total, output) => total + output.value, 0);
    fees[tx.txid] = totalIn - totalOut;

    tx.outputs.forEach((output, vout) => {
      if (inputAddresses.has(output.address)) change.add(outpointKey(tx.txid, vout));
    });
  }


  // A second pass: an edge asks whether its SOURCE output is
  // change, so every transaction's change must be known first
  for (const tx of transactions) {
    tx.inputs.forEach((input, vin) => {
      const key = outpointKey(input.txid, input.vout);
      spent.set(key, { txid: tx.txid, vin });
      if (listed.has(input.txid)) {
        edges.push({
          id: `${key}>${tx.txid}:${vin}`,
          fromTxid: input.txid,
          vout: input.vout,
          toTxid: tx.txid,
          vin,
          address: input.address,
          value: input.value,
          isChange: change.has(key),
        });
      }
    });
  }


  return { edges, spent, change, fees };
}







// -----------------------------------------------------------
// dayOf
// -----------------------------------------------------------
//
// A Date → 'YYYY-MM-DD' of its LOCAL calendar day — the unit
// the day slider picks, in the viewer's own timezone.
//
// Used by:
//   - useTransactionDays / useTransactionGraph (below)
//   - Page.jsx — today, and its tick over at midnight
// -----------------------------------------------------------

export function dayOf(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}







// -----------------------------------------------------------
// useTransactionDays
// -----------------------------------------------------------
//
//   const days = useTransactionDays(today)
//
// The days the slider offers, ascending: every local day a
// block falls on, plus today — always offered, its mempool is
// live even before today's first block. (The EVM graph asks
// its backend for the same list; so will this one.)
//
// Used by:
//   - Page.jsx — the day slider's options
// -----------------------------------------------------------

export function useTransactionDays(today) {
  return useMemo(() => {
    const used = new Set(MOCK_BLOCKS.map((block) => dayOf(new Date(block.time))));
    used.add(today);
    return [...used].sort();
  }, [today]);
}







// -----------------------------------------------------------
// useTransactionGraph (default export)
// -----------------------------------------------------------
//
//   const { blocks, transactions, live, byTxid, blockTimes,
//           names, renameAddress, faucetAddress, graph } =
//     useTransactionGraph(day, today)
//
//   blocks        — the day's blocks [{ height, time }],
//                   ascending
//   transactions  — the day's transactions [{ txid, block |
//                   null, vsize, inputs, outputs }], the
//                   mempool's included while the day is today
//   live          — the day is today (the mempool is shown)
//   byTxid        — EVERY transaction by txid, all days — the
//                   dialog's links walk across days
//   blockTimes    — height → time, every block
//   names         — address → who controls it
//   renameAddress(address, name) — '' clears the name
//   faucetAddress — the faucet's own address
//   graph         — deriveGraph's { edges, spent, change, fees }
//                   over every transaction: whether an output
//                   was spent is a fact of the chain, not of
//                   the day on screen
//
// The day decides WHAT is drawn; the chain facts — graph,
// byTxid, blockTimes — always cover every day. The names
// start from the sample's and change only through
// renameAddress.
//
// Used by:
//   - UtxoFlowGraph.jsx
// -----------------------------------------------------------

export default function useTransactionGraph(day, today) {

  // The mockup's source is the module's sample — a backend
  // fetch replaces it
  const [names, setNames] = useState(MOCK_NAMES);


  const graph = useMemo(() => deriveGraph(MOCK_TRANSACTIONS), []);
  const byTxid = useMemo(() => Object.fromEntries(MOCK_TRANSACTIONS.map((tx) => [tx.txid, tx])), []);
  const blockTimes = useMemo(() => Object.fromEntries(MOCK_BLOCKS.map((block) => [block.height, block.time])), []);


  // The picked day: its blocks, their transactions, and the
  // mempool when the day is today
  const { blocks, transactions } = useMemo(() => {
    const dayBlocks = MOCK_BLOCKS.filter((block) => dayOf(new Date(block.time)) === day);
    const heights = new Set(dayBlocks.map((block) => block.height));
    const dayTransactions = MOCK_TRANSACTIONS.filter((tx) => (tx.block === null ? day === today : heights.has(tx.block)));
    return { blocks: dayBlocks, transactions: dayTransactions };
  }, [day, today]);


  // One rename relabels every box and row of that address;
  // an empty name clears the label
  const renameAddress = useCallback((address, name) => {
    const trimmed = name.trim().slice(0, NAME_MAX_LENGTH);
    setNames((current) => {
      const next = { ...current };
      if (trimmed) {
        next[address] = trimmed;
      } else {
        delete next[address];
      }
      return next;
    });
  }, []);


  return {
    blocks,
    transactions,
    live: day === today,
    byTxid,
    blockTimes,
    names,
    renameAddress,
    faucetAddress: MOCK_FAUCET_ADDRESS,
    graph,
  };
}

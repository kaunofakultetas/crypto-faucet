// -----------------------------------------------------------
//  [*] Graph_UTXO — useTransactionGraph
//
//  The data side of the UTXO graph: the backend's four graph
//  endpoints behind TanStack Query, and what the answers MEAN.
//  The backend has already resolved the chain — every input's
//  address and amount (through the output it spends), every
//  output's spender, every fee (inputs minus outputs: a UTXO
//  transaction never states its fee) — so what is left here is
//  reading it: which listed transaction feeds which (the
//  graph's edges), which outputs are change (paid back to one
//  of the transaction's own input addresses), what state an
//  output is in, and who the sender is. The picked day travels
//  as a half-open [from, to) unix window from the student's
//  local midnight; the backend answers from its cache at once
//  and crawls the chain in the background, and while it says
//  `updating` the page asks again every few seconds — today's
//  window keeps being asked after that too, a past day does
//  not. The names that say who controls which address are the
//  backend's (shared with the EVM graph): a rename is stored
//  there and every graph query asks again. The small
//  formatters every part of the drawing shares live here
//  too.
//
//  Split into (root last) — plain functions with no React in
//  them, then the hooks:
//
//    formatAmount        — satoshis → "0.1", exact
//    shortTxid           — "3f9a1c…7be2"
//    nameOf              — a name from the book, a short
//                          address, or what a script pays to
//    senderOf            — who pays: one sender, several
//                          parties, or a block's reward
//    isChange            — an output back to an input address
//    spendStateOf        — spent, unspent, unknown or data
//    edgesOf             — the day's output → input links
//    dayOf               — a Date → its local 'YYYY-MM-DD'
//    rangeOfDay          — 'YYYY-MM-DD' → local-day unix window
//    useTransactionDays  — the days the slider offers
//    useTransaction      — one transaction, for the dialog
//    useTransactionGraph — the day's data + derived model
//                          (default export)
// -----------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import { NAME_MAX_LENGTH, POLL_CONFIG } from '../constants';


// What an output WITHOUT an address pays to, by its script type
const SCRIPT_LABELS = {
  op_return: 'OP_RETURN duomenys',
  p2pk: 'Viešasis raktas (P2PK)',
  nonstandard: 'Nestandartinis scenarijus',
};

// Stable empties while no answer has come — fresh [] / {} on
// every render would rebuild the layout for nothing
const NO_BLOCKS = [];
const NO_TRANSACTIONS = [];
const NO_NAMES = {};







// -----------------------------------------------------------
// formatAmount
// -----------------------------------------------------------
//
// Satoshis → coin units with trailing zeros trimmed
// (10000000 → "0.1"). Integer arithmetic only — dividing by
// 1e8 in floating point can print 0.30000000000000004. An
// amount nobody knows (an input whose earlier transaction the
// server did not give) reads "?".
//
// Used by:
//   - TransactionBox.jsx — every row's amount and tooltip
//   - TransactionModal.jsx — the cards and the fee sum
//   - UtxoFlowGraph.jsx — the text-alternative table
// -----------------------------------------------------------

export function formatAmount(sat) {
  if (sat === null || sat === undefined) return '?';
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
//   nameOf(address, names, scriptType?)
//
// The address's name from the book, else the address cut to
// its first 8 and last 4 characters. An output with no
// address (null) is named by what its script is — OP_RETURN
// data, a bare public key — and an input whose address is not
// known reads "Nežinomas adresas".
//
// Used by:
//   - senderOf (below)
//   - TransactionBox.jsx — every row's label
//   - TransactionModal.jsx — a card without an address
//   - UtxoFlowGraph.jsx — the text-alternative table
// -----------------------------------------------------------

export function nameOf(address, names, scriptType) {
  if (!address) return SCRIPT_LABELS[scriptType] ?? 'Nežinomas adresas';
  return names[address] ?? `${address.slice(0, 8)}…${address.slice(-4)}`;
}







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
// the one name among them, else the first known input's short
// address. Only inputs carrying two DIFFERENT names prove
// different people put coins in (a CoinJoin, a PayJoin):
// then `several` is true and the label says so. A coinbase
// has no sender — it is the block's reward, new coins.
//
// Used by:
//   - TransactionBox.jsx — the band and the input rows
//   - TransactionModal.jsx — the Siuntėjas line
//   - UtxoFlowGraph.jsx — the text-alternative table
// -----------------------------------------------------------

export function senderOf(tx, names) {

  if (tx.coinbase) {
    return { label: 'Bloko atlygis (coinbase)', several: false };
  }


  const known = tx.inputs.filter((input) => input.address);
  const named = new Set(known.map((input) => names[input.address]).filter(Boolean));

  if (named.size > 1) {
    return { label: 'Kelios pusės', several: true };
  }
  if (named.size === 1) {
    return { label: [...named][0], several: false };
  }
  return { label: known.length ? nameOf(known[0].address, names) : 'Nežinomas siuntėjas', several: false };
}







// -----------------------------------------------------------
// isChange
// -----------------------------------------------------------
//
// Whether an output is CHANGE: paid back to one of the
// addresses the transaction spends from — the sender keeping
// what was left over.
//
// Used by:
//   - edgesOf (below) — a dashed edge
//   - TransactionBox.jsx — the ↩ mark
//   - TransactionModal.jsx — the Grąža chip
// -----------------------------------------------------------

export function isChange(tx, output) {
  return Boolean(output.address) && tx.inputs.some((input) => input.address === output.address);
}







// -----------------------------------------------------------
// spendStateOf
// -----------------------------------------------------------
//
// An output's state, from the backend's spent_by and
// spent_known:
//
//   'spent'   — a transaction some history lists spends it
//   'data'    — OP_RETURN: data, no coin to spend
//   'unspent' — nobody has spent it, and that is certain (its
//               address's history was read)
//   'unknown' — nobody seen spending it, but its address's
//               history was never read (a public hub, or too
//               far from the faucet) — so nobody can say
//
// Used by:
//   - TransactionBox.jsx — the coin, ring or port on the row
//   - TransactionModal.jsx — the card's last line
// -----------------------------------------------------------

export function spendStateOf(output) {
  if (output.spent_by) return 'spent';
  if (output.script_type === 'op_return') return 'data';
  return output.spent_known ? 'unspent' : 'unknown';
}







// -----------------------------------------------------------
// edgesOf
// -----------------------------------------------------------
//
//   edgesOf(transactions) → [{ id, fromTxid, vout, toTxid,
//                              vin, address, isChange }]
//
// One edge per input that spends an output of ANOTHER listed
// transaction — both ends are on screen. An input spending a
// coin from before the day gets no edge; its box still shows
// it as an input row.
//
// Used by:
//   - useTransactionGraph (below) — once per answer
// -----------------------------------------------------------

function edgesOf(transactions) {

  const byTxid = Object.fromEntries(transactions.map((tx) => [tx.txid, tx]));
  const edges = [];


  for (const tx of transactions) {
    tx.inputs.forEach((input, vin) => {
      const source = byTxid[input.txid];
      const output = source?.outputs[input.vout];
      if (!output) return;
      edges.push({
        id: `${input.txid}:${input.vout}>${tx.txid}:${vin}`,
        fromTxid: input.txid,
        vout: input.vout,
        toTxid: tx.txid,
        vin,
        address: input.address,
        isChange: isChange(source, output),
      });
    });
  }


  return edges;
}







// -----------------------------------------------------------
// dayOf
// -----------------------------------------------------------
//
// A Date → 'YYYY-MM-DD' of its LOCAL calendar day — the unit
// the day slider picks, in the viewer's own timezone.
//
// Used by:
//   - Page.jsx — today, and its tick over at midnight
// -----------------------------------------------------------

export function dayOf(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}







// -----------------------------------------------------------
// rangeOfDay
// -----------------------------------------------------------
//
// 'YYYY-MM-DD' → that day's half-open unix window
// [00:00, next 00:00) in the student's local timezone — the
// EVM graph's rule. The Date(y, m, d) constructor handles
// month bounds and DST.
//
// Used by:
//   - useTransactionGraph (below) — the graph query's window
// -----------------------------------------------------------

function rangeOfDay(dayString) {
  const [year, month, day] = dayString.split('-').map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);

  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
  };
}







// -----------------------------------------------------------
// useTransactionDays
// -----------------------------------------------------------
//
//   const days = useTransactionDays(network, today)
//
// The days the slider offers, ascending: every local day the
// faucet has a mined transaction on (GET /api/utxo/<network>/
// transaction-days, bucketed in the browser's IANA zone — each
// block time under its OWN date's offset, so the list matches
// rangeOfDay in every season), plus today — always offered,
// its mempool is live even before today's first block. The
// zone is part of the query key, so a list built under one
// zone is never served under another. useTransactionGraph
// refreshes the list when a crawl lands.
//
// Used by:
//   - Page.jsx — the day slider's options
// -----------------------------------------------------------

export function useTransactionDays(network, today) {

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data } = useQuery({
    queryKey: ['utxo-tx-days', network, timeZone],
    queryFn: async () => (await axios.get(`/api/utxo/${network}/transaction-days`, { params: { tz: timeZone } })).data,
    staleTime: 60 * 1000,
  });


  return useMemo(() => {
    const used = new Set((data?.days ?? []).map((entry) => entry.day));
    used.add(today);
    return [...used].sort();
  }, [data, today]);
}







// -----------------------------------------------------------
// useTransaction
// -----------------------------------------------------------
//
//   const { data, isPending, isError, error } =
//     useTransaction(network, txid, enabled)
//
// One transaction in the graph's shape, with the names of its
// addresses (GET /api/utxo/<network>/transaction/<txid> —
// fetched from the chain when the backend lacks it). For the
// dialog's links that walk past the day on screen; `enabled`
// is false for a transaction the day already holds. A 404 is
// an answer, not a hiccup — never retried.
//
// Used by:
//   - TransactionModal.jsx — the transaction on show
// -----------------------------------------------------------

export function useTransaction(network, txid, enabled) {
  return useQuery({
    queryKey: ['utxo-tx', network, txid],
    queryFn: async ({ signal }) => (await axios.get(`/api/utxo/${network}/transaction/${txid}`, { signal })).data,
    enabled,
    staleTime: 30 * 1000,
    retry: false,
  });
}







// -----------------------------------------------------------
// useTransactionGraph (default export)
// -----------------------------------------------------------
//
//   const { blocks, transactions, byTxid, edges, live, names,
//           faucetAddress, renameAddress, loading, error,
//           updating, missing } =
//     useTransactionGraph(network, day, today)
//
//   blocks        — the day's blocks [{ height, time }],
//                   ascending
//   transactions  — the day's transactions, parents before
//                   children, the mempool's while live
//   byTxid        — the same by txid
//   edges         — edgesOf(transactions)
//   live          — the window reaches into the last hour: the
//                   mempool is shown (the backend decides, the
//                   EVM rule — so for an hour after midnight
//                   yesterday is live too)
//   names         — address → who controls it
//   renameAddress(address, name) → Promise<saved?> — '' clears
//   faucetAddress — the faucet's own address
//   loading       — no answer for this window yet
//   error         — the last request's failure, as text, or
//                   null (earlier data stays on screen)
//   updating      — a crawl is filling the backend's cache
//   missing       — window transactions the backend has met
//                   but cannot show (not fetched yet, or
//                   refused by its server)
//
// When a crawl lands (updating turns false) the day list is
// asked again — it is read from what the crawls stored.
//
// Used by:
//   - UtxoFlowGraph.jsx
// -----------------------------------------------------------

export default function useTransactionGraph(network, day, today) {

  const queryClient = useQueryClient();
  const { from, to } = useMemo(() => rangeOfDay(day), [day]);
  const liveGuess = day === today;


  // Fast while a crawl fills the cache, steady on a live
  // window, not at all on a past day once it has landed
  const query = useQuery({
    queryKey: ['utxo-graph', network, from, to],
    queryFn: async ({ signal }) => (await axios.get(`/api/utxo/${network}/graph`, { params: { from, to }, signal })).data,
    refetchInterval: (current) => {
      if (current.state.data?.updating) return POLL_CONFIG.UPDATING_MS;
      return (current.state.data?.live ?? liveGuess) ? POLL_CONFIG.LIVE_MS : false;
    },
  });
  const { data } = query;
  const updating = Boolean(data?.updating);


  // A landed crawl may have read the faucet's history for the
  // first time — the slider's day list comes from it
  const wasUpdating = useRef(false);
  useEffect(() => {
    if (wasUpdating.current && !updating) {
      queryClient.invalidateQueries({ queryKey: ['utxo-tx-days', network] });
    }
    wasUpdating.current = updating;
  }, [updating, network, queryClient]);


  const transactions = data?.transactions ?? NO_TRANSACTIONS;
  const byTxid = useMemo(() => Object.fromEntries(transactions.map((tx) => [tx.txid, tx])), [transactions]);
  const edges = useMemo(() => edgesOf(transactions), [transactions]);


  // Stored by the backend first; once it agreed, every graph
  // and transaction query of the network asks again — awaited,
  // so the dialog closes its editor on the new label, and
  // learns when the name was NOT saved
  const renameAddress = useCallback(async (address, name) => {
    const trimmed = name.trim().slice(0, NAME_MAX_LENGTH);
    try {
      await axios.get(`/api/utxo/${network}/set-address-name`, { params: { address, name: trimmed } });
    } catch (err) {
      console.error('Rename failed:', err);
      return false;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['utxo-graph', network] }),
      queryClient.invalidateQueries({ queryKey: ['utxo-tx', network] }),
    ]);
    return true;
  }, [network, queryClient]);


  return {
    blocks: data?.blocks ?? NO_BLOCKS,
    transactions,
    byTxid,
    edges,
    live: data?.live ?? liveGuess,
    names: data?.names ?? NO_NAMES,
    faucetAddress: data?.faucet_address ?? null,
    renameAddress,
    loading: query.isPending,
    error: query.isError ? (query.error?.response?.data?.error ?? 'Nepavyko gauti transakcijų') : null,
    updating,
    missing: data?.missing ?? 0,
  };
}

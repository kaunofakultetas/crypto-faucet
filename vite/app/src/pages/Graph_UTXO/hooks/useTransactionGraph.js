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
//  `updating` (the day's first crawl has not landed) the page
//  asks again every few seconds — today's window keeps being
//  asked after that too, as the backend keeps it current by
//  watching its addresses; a past day is not asked again. The
//  names that say who controls which address are the
//  backend's (shared with the EVM graph): a rename is stored
//  there and every graph query asks again. The small
//  formatters every part of the drawing shares live here
//  too.
//
//  Every answer is cleaned the moment it arrives, so the
//  drawing, the dialog and the day picker can trust its shape
//  without checking it again: a transaction is kept only with
//  a real txid and a place to be drawn in, each one once; a
//  field of the wrong type reads as not known; every block a
//  transaction sits in has its column; a day the list cannot
//  name is left out; and an answer for one transaction that
//  holds none is a failed request, not an empty one. A broken
//  answer therefore shows as less on screen, never as a
//  crashed page.
//
//  Split into (root last) — plain functions with no React in
//  them, then the hooks:
//
//    groupThousands      — digits in groups of three
//    formatAmount        — satoshis as coins, every digit kept
//    shortTxid           — a txid cut short to tell boxes apart
//    nameOf              — a name from the book, a short
//                          address, or what a script pays to
//    senderOf            — who pays: one sender, several
//                          parties, or a block's reward
//    isChange            — an output back to an input address
//    spendStateOf        — spent, unspent, unknown or data
//    edgesOf             — the day's spend links between boxes
//    dayOf               — the local calendar day of a moment
//    rangeOfDay          — a local day's unix window
//    isRecord            — a JSON object, not a list or a value
//    txidOf              — a field read as a txid
//    textOf              — a field read as text
//    countOf             — a field read as a whole count
//    timeOf              — a field read as a moment
//    inputOf             — one input, cleaned
//    outputOf            — one output, cleaned
//    transactionOf       — one transaction, cleaned
//    namesOf             — the address book, cleaned
//    graphOf             — a day's whole answer, cleaned
//    useTransactionDays  — the days the slider offers
//    useTransaction      — one transaction, for the dialog
//    useTransactionGraph — the day's data + derived model
//                          (default export)
// -----------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import { NAME_MAX_LENGTH, POLL_CONFIG } from '../constants';


// The mark between digit groups: an apostrophe, the Swiss way
// (1'250.605'598) — and never a line break inside a number
const DIGIT_GAP = "'";

// What an output WITHOUT an address pays to, by its script type
const SCRIPT_LABELS = {
  op_return: 'OP_RETURN duomenys',
  p2pk: 'Viešasis raktas (P2PK)',
  nonstandard: 'Nestandartinis scenarijus',
};

// A txid the way the chain writes one: 64 hex digits, the
// rule the backend holds every txid to
const TXID_PATTERN = /^[0-9a-f]{64}$/i;

// A day the way the slider names it, year-month-day — the
// only shape rangeOfDay can turn into a window
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Stable empties while no answer has come — fresh [] / {} on
// every render would rebuild the layout for nothing
const NO_BLOCKS = [];
const NO_TRANSACTIONS = [];
const NO_NAMES = {};







// -----------------------------------------------------------
// groupThousands
// -----------------------------------------------------------
//
// A whole number's digits in threes from the right, the
// groups split by DIGIT_GAP — the whole-coin part of an
// amount, and the satoshi and vbyte counts of the fee. The
// digits may come as a number or already as a string.
//
// Used by:
//   - formatAmount (below)
//   - TransactionBox.jsx — the band's fee
//   - TransactionModal.jsx — the fee rate's sum
// -----------------------------------------------------------

export const groupThousands = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, DIGIT_GAP);







// -----------------------------------------------------------
// formatAmount
// -----------------------------------------------------------
//
// Satoshis as coins, every digit shown and the trailing zeros
// trimmed, so a round amount has no point at all. Grouped —
// the default — the whole part goes in threes from the right
// and the eight decimals in threes from the point:
// millicoins, microcoins, then the last two satoshi digits.
// The arithmetic stays in whole numbers, because dividing by
// a hundred million in floating point leaves stray digits at
// the end. An amount nobody knows (an input whose earlier
// transaction the server did not give) reads "?". With
// grouped turned off it gives the bare digits, for screen
// readers — they may read the groups as separate numbers.
//
// Used by:
//   - TransactionBox.jsx — every row's amount and tooltip
//   - TransactionModal.jsx — the cards and the fee sum
//   - UtxoFlowGraph.jsx — the text-alternative table
//     (ungrouped)
// -----------------------------------------------------------

export function formatAmount(sat, { grouped = true } = {}) {

  if (sat === null || sat === undefined) return '?';
  const whole = String(Math.floor(sat / 100_000_000));
  const fraction = String(sat % 100_000_000).padStart(8, '0').replace(/0+$/, '');


  if (!grouped) {
    return fraction ? `${whole}.${fraction}` : whole;
  }
  const groupedWhole = groupThousands(whole);
  return fraction ? `${groupedWhole}.${fraction.match(/.{1,3}/g).join(DIGIT_GAP)}` : groupedWhole;
}







// -----------------------------------------------------------
// shortTxid
// -----------------------------------------------------------
//
// A txid cut to its first 6 and last 4 characters — enough
// to tell the transactions on screen apart; the full txid is
// always one hover or one copy away. Anything but a string
// reads "?": the answers are cleaned before they get here,
// and whatever slips past that must cost one label, never
// the whole drawing.
//
// Used by:
//   - TransactionBox.jsx — the txid line, the input rows'
//     outpoints and the box's spoken label
//   - TransactionModal.jsx — the outpoint and spender links
//   - UtxoFlowGraph.jsx — the text-alternative table
// -----------------------------------------------------------

export const shortTxid = (txid) => (typeof txid === 'string' ? `${txid.slice(0, 6)}…${txid.slice(-4)}` : '?');







// -----------------------------------------------------------
// nameOf
// -----------------------------------------------------------
//
// What an address is called on screen: its name from the
// book, else the address cut to its first 8 and last 4
// characters. An output with no address is named by what its
// script is — OP_RETURN data, a bare public key — and an
// input whose address is not known reads "Nežinomas
// adresas". Only a string counts as an address or a name, and
// only a label of SCRIPT_LABELS as a script's — never what a
// plain object inherits — so whatever a broken answer holds,
// the label is always text.
//
// Used by:
//   - senderOf (below)
//   - TransactionBox.jsx — every row's label
//   - TransactionModal.jsx — a card without an address
//   - UtxoFlowGraph.jsx — the text-alternative table
// -----------------------------------------------------------

export function nameOf(address, names, scriptType) {

  if (typeof address !== 'string' || !address) {
    const label = SCRIPT_LABELS[scriptType];
    return typeof label === 'string' ? label : 'Nežinomas adresas';
  }


  const name = names?.[address];
  return typeof name === 'string' && name ? name : `${address.slice(0, 8)}…${address.slice(-4)}`;
}







// -----------------------------------------------------------
// senderOf
// -----------------------------------------------------------
//
// Who pays in a transaction: the label to show, and whether
// it stands for several people. One wallet normally signs
// every input, but it spends from many addresses of its own
// and the chain cannot tell which addresses share a wallet —
// so, as chain analysis assumes, all inputs count as ONE
// sender: the one name among them, else the first known
// input's short address. Only inputs carrying two DIFFERENT
// names prove different people put coins in (a CoinJoin, a
// PayJoin): then `several` is set and the label says so. A
// coinbase has no sender — it is the block's reward, new
// coins. Only text in the book counts as a name.
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
  const named = new Set(known.map((input) => names[input.address]).filter((name) => typeof name === 'string' && name));

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
//   - TransactionBox.jsx — an output row's tooltip
//   - TransactionModal.jsx — the Grąža chip
// -----------------------------------------------------------

export function isChange(tx, output) {
  return Boolean(output.address) && tx.inputs.some((input) => input.address === output.address);
}







// -----------------------------------------------------------
// spendStateOf
// -----------------------------------------------------------
//
// An output's state, read from the backend's spent_by and
// spent_known. It is 'spent' once a transaction some history
// lists spends it, and 'data' for an OP_RETURN, which holds
// no coin to spend. Otherwise nobody has been seen spending
// it, and the rest depends on whether anybody looked: it is
// 'unspent' — certain — when its address's history was read,
// and 'unknown' when that history never was (a public hub, or
// an address too far from the faucet), so nobody can say.
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
// One edge per input that spends an output of ANOTHER listed
// transaction — both ends are on screen. An edge names the
// spent output (its transaction and index), the input that
// spends it (its transaction and index) and the coin's
// address, under an id built from both ends. An input
// spending a coin from before the day gets no edge; its box
// still shows it as an input row.
//
// Used by:
//   - useTransactionGraph (below) — once per answer
// -----------------------------------------------------------

function edgesOf(transactions) {

  const byTxid = Object.fromEntries(transactions.map((tx) => [tx.txid, tx]));
  const edges = [];


  for (const tx of transactions) {
    tx.inputs.forEach((input, vin) => {
      if (!byTxid[input.txid]?.outputs[input.vout]) return;
      edges.push({
        id: `${input.txid}:${input.vout}>${tx.txid}:${vin}`,
        fromTxid: input.txid,
        vout: input.vout,
        toTxid: tx.txid,
        vin,
        address: input.address,
      });
    });
  }


  return edges;
}







// -----------------------------------------------------------
// dayOf
// -----------------------------------------------------------
//
// The calendar day a moment falls on in the viewer's OWN
// timezone, written year-month-day — the unit the day slider
// picks.
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
// A day's half-open unix window, from its midnight up to the
// next one, in the student's local timezone — the EVM graph's
// rule. The Date constructor, given the year, month and day,
// handles the month ends and the clock changes, so the day of
// a clock change comes out an hour shorter or longer.
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
// isRecord
// -----------------------------------------------------------
//
// Whether a value from an answer is a JSON object — not a
// list, not a bare string or number, not null — and so can be
// asked for its fields at all.
//
// Used by:
//   - inputOf / outputOf / transactionOf / namesOf / graphOf
//     (below)
//   - useTransactionDays / useTransaction (below) — their
//     answers
// -----------------------------------------------------------

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);







// -----------------------------------------------------------
// txidOf
// -----------------------------------------------------------
//
// A field read as a txid: the string itself when it is one —
// TXID_PATTERN, the backend's own rule — else null. Holding
// every txid to that rule keeps the lookups by txid (the
// boxes, the edges, the dialog's links) on real txids only.
//
// Used by:
//   - inputOf / outputOf / transactionOf (below)
// -----------------------------------------------------------

const txidOf = (value) => (typeof value === 'string' && TXID_PATTERN.test(value) ? value : null);







// -----------------------------------------------------------
// textOf
// -----------------------------------------------------------
//
// A field read as text — an address, a script type, a name —
// or null for anything that is not a non-empty string, which
// the drawing then treats as not known.
//
// Used by:
//   - inputOf / outputOf / namesOf / graphOf (below)
// -----------------------------------------------------------

const textOf = (value) => (typeof value === 'string' && value !== '' ? value : null);







// -----------------------------------------------------------
// countOf
// -----------------------------------------------------------
//
// A field read as a whole count from zero up — satoshis,
// vbytes, a block's height, an output's index, the number of
// missing transactions — or null for anything else, digits
// sent as a string included. So every amount stays an exact
// integer, and one that is not known reads "?".
//
// Used by:
//   - inputOf / outputOf / transactionOf / graphOf (below)
// -----------------------------------------------------------

const countOf = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);







// -----------------------------------------------------------
// timeOf
// -----------------------------------------------------------
//
// A field read as a moment: a string a Date can read, else
// null — so a broken time leaves a block or a transaction
// without one, instead of printing "Invalid Date".
//
// Used by:
//   - transactionOf / graphOf (below)
// -----------------------------------------------------------

const timeOf = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);







// -----------------------------------------------------------
// inputOf
// -----------------------------------------------------------
//
// One input, cleaned: the outpoint it spends, and that coin's
// address and amount — both null while the server never gave
// the earlier transaction. An entry that names no outpoint (a
// txid and an output index) is no input anyone can draw or
// follow, so it comes back null and is left out; the rows and
// the edges count the inputs that remain.
//
// Used by:
//   - transactionOf (below)
// -----------------------------------------------------------

function inputOf(raw) {

  if (!isRecord(raw) || !txidOf(raw.txid) || countOf(raw.vout) === null) {
    return null;
  }

  return { txid: raw.txid, vout: raw.vout, address: textOf(raw.address), value: countOf(raw.value) };
}







// -----------------------------------------------------------
// outputOf
// -----------------------------------------------------------
//
// One output, cleaned: its address and script type, its
// amount, the input that spent it — kept only when it names a
// real txid — and whether nobody spending it is certain. An
// output is never left out, because its index is its name on
// the chain, the one inputs and edges point at; an entry of
// the wrong type becomes an output nobody knows anything
// about.
//
// Used by:
//   - transactionOf (below)
// -----------------------------------------------------------

function outputOf(raw) {

  const output = isRecord(raw) ? raw : {};
  const spender = isRecord(output.spent_by) ? output.spent_by : {};


  return {
    address: textOf(output.address),
    script_type: textOf(output.script_type),
    value: countOf(output.value),
    spent_by: txidOf(spender.txid) ? { txid: spender.txid, vin: countOf(spender.vin) } : null,
    spent_known: output.spent_known === true,
  };
}







// -----------------------------------------------------------
// transactionOf
// -----------------------------------------------------------
//
// One transaction, cleaned — or null when it cannot be shown:
// without a real txid, or without a place to be drawn in,
// which is a block's height, or null while it waits. Its
// status follows the block, so the dialog's chip always
// agrees with the box: confirmed when it has one, else
// waiting in the mempool or known to no history any more. A
// coinbase spends nothing and keeps no inputs; inputs and
// outputs that are not lists read as none.
//
// Used by:
//   - graphOf (below) — every transaction of a day
//   - useTransaction (below) — the one the dialog fetched
// -----------------------------------------------------------

function transactionOf(raw) {

  if (!isRecord(raw) || !txidOf(raw.txid) || (raw.block !== null && countOf(raw.block) === null)) {
    return null;
  }


  const coinbase = raw.coinbase === true;
  let status = raw.status === 'mempool' ? 'mempool' : 'unknown';
  if (raw.block !== null) status = 'confirmed';

  return {
    txid: raw.txid,
    status,
    block: raw.block,
    time: timeOf(raw.time),
    vsize: countOf(raw.vsize),
    fee: countOf(raw.fee),
    coinbase,
    inputs: coinbase || !Array.isArray(raw.inputs) ? [] : raw.inputs.map(inputOf).filter(Boolean),
    outputs: Array.isArray(raw.outputs) ? raw.outputs.map(outputOf) : [],
  };
}







// -----------------------------------------------------------
// namesOf
// -----------------------------------------------------------
//
// The address book, cleaned: only the entries whose name is
// text survive, so a name on screen — in a box, on a card, as
// an avatar's letter or in the name editor — is always a
// string. Anything but an object reads as an empty book.
//
// Used by:
//   - graphOf (below) — the day's names
//   - useTransaction (below) — the names a fetched one brings
// -----------------------------------------------------------

function namesOf(raw) {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, name]) => textOf(name) !== null));
}







// -----------------------------------------------------------
// graphOf
// -----------------------------------------------------------
//
// A day's whole answer, cleaned into the shape the backend
// promises before anything reads it. Each transaction is kept
// once — the first of a txid — and a waiting one only on a
// live window, since a past day has no mempool column to put
// it in. Each block is kept once, ascending, and every block
// a kept transaction sits in gets its column even when the
// list left it out: the backend builds that list from the
// transactions too. The window is live when the answer says
// so, else when the caller's guess (the day is today) does;
// `updating` holds only when it is plainly true, and the
// number of missing transactions is taken only when it is a
// count. Anything but an object reads as an empty day.
//
// Used by:
//   - useTransactionGraph (below) — every graph answer
// -----------------------------------------------------------

function graphOf(body, liveGuess) {

  const answer = isRecord(body) ? body : {};
  const live = typeof answer.live === 'boolean' ? answer.live : liveGuess;


  const seen = new Set();
  const transactions = [];
  for (const raw of Array.isArray(answer.transactions) ? answer.transactions : []) {
    const tx = transactionOf(raw);
    if (!tx || seen.has(tx.txid) || (tx.block === null && !live)) continue;
    seen.add(tx.txid);
    transactions.push(tx);
  }


  const blocks = new Map();
  for (const raw of Array.isArray(answer.blocks) ? answer.blocks : []) {
    const height = isRecord(raw) ? countOf(raw.height) : null;
    if (height !== null && !blocks.has(height)) blocks.set(height, { height, time: timeOf(raw.time) });
  }
  for (const tx of transactions) {
    if (tx.block !== null && !blocks.has(tx.block)) blocks.set(tx.block, { height: tx.block, time: tx.time });
  }


  return {
    blocks: [...blocks.values()].sort((a, b) => a.height - b.height),
    transactions,
    names: namesOf(answer.names),
    faucet_address: textOf(answer.faucet_address),
    live,
    updating: answer.updating === true,
    missing: countOf(answer.missing) ?? 0,
  };
}







// -----------------------------------------------------------
// useTransactionDays
// -----------------------------------------------------------
//
// The days the slider offers, ascending: every local day the
// faucet has a mined transaction on, plus today — always
// offered, as its mempool is live even before today's first
// block. The backend buckets the days in the browser's IANA
// zone (GET /api/utxo/<network>/transaction-days), each block
// time under its OWN date's offset, so the list matches
// rangeOfDay in every season; the zone is part of the query
// key, so a list built under one zone is never served under
// another. An entry that names no day is dropped on arrival,
// for the slider would hand it on to rangeOfDay.
// useTransactionGraph refreshes the list when a crawl lands.
//
// Used by:
//   - Page.jsx — the day slider's options
// -----------------------------------------------------------

export function useTransactionDays(network, today) {

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data } = useQuery({
    queryKey: ['utxo-tx-days', network, timeZone],
    queryFn: async () => {
      const body = (await axios.get(`/api/utxo/${network}/transaction-days`, { params: { tz: timeZone } })).data;
      return (isRecord(body) && Array.isArray(body.days) ? body.days : [])
        .map((entry) => (isRecord(entry) ? entry.day : null))
        .filter((day) => typeof day === 'string' && DAY_PATTERN.test(day));
    },
    staleTime: 60 * 1000,
  });


  return useMemo(() => {
    const used = new Set(data ?? []);
    used.add(today);
    return [...used].sort();
  }, [data, today]);
}







// -----------------------------------------------------------
// useTransaction
// -----------------------------------------------------------
//
// One transaction in the graph's shape, with the names of its
// addresses, for the dialog's links that walk past the day on
// screen (GET /api/utxo/<network>/transaction/<txid> — the
// backend fetches it from the chain when it lacks it). The
// query stays off while the day already holds the
// transaction. The answer is cleaned like the graph's, and
// one that holds no transaction counts as a failed fetch, so
// the dialog says so instead of waiting for ever. A 404 is an
// answer, not a hiccup — nothing is retried.
//
// Used by:
//   - TransactionModal.jsx — the transaction on show
// -----------------------------------------------------------

export function useTransaction(network, txid, enabled) {
  return useQuery({
    queryKey: ['utxo-tx', network, txid],
    queryFn: async ({ signal }) => {
      const body = (await axios.get(`/api/utxo/${network}/transaction/${txid}`, { signal })).data;
      const transaction = transactionOf(isRecord(body) ? body.transaction : null);
      if (!transaction) throw new Error('The backend answered without the transaction');
      return { transaction, names: namesOf(body.names) };
    },
    enabled,
    staleTime: 30 * 1000,
    retry: false,
  });
}







// -----------------------------------------------------------
// useTransactionGraph (default export)
// -----------------------------------------------------------
//
// Everything the drawing needs for one day of one network:
// `blocks`, the day's blocks ascending; `transactions`,
// parents before children and the mempool's while the window
// is live, with `byTxid` the same by txid and `edges` the
// spend links between them (edgesOf); `names`, who controls
// which address; `faucetAddress`, the faucet's own; and
// `live`, which the backend decides by the EVM rule — so for
// an hour after midnight yesterday is live too — and which,
// until it has answered, holds when the day is today.
//
// It also tells what state the day is in: `loading` until the
// window has its first answer; `error`, the last request's
// failure as a sentence, while the earlier data stays on
// screen; `updating` while the window's first crawl is still
// filling the backend's cache (later crawls are not
// announced); and `missing`, how many of the window's
// transactions the backend has met but cannot show — not
// fetched yet, or refused by its server. renameAddress stores
// a name with the backend and settles on whether it was
// saved; an empty name clears it. When a window's first crawl
// lands, the day list is asked again — it is read from what
// the crawls stored.
//
// Used by:
//   - UtxoFlowGraph.jsx
// -----------------------------------------------------------

export default function useTransactionGraph(network, day, today) {

  const queryClient = useQueryClient();
  const { from, to } = useMemo(() => rangeOfDay(day), [day]);
  const liveGuess = day === today;


  // Fast while the first crawl fills the cache, steady on a
  // live window, not at all on a past day once it has landed
  const query = useQuery({
    queryKey: ['utxo-graph', network, from, to],
    queryFn: async ({ signal }) => graphOf((await axios.get(`/api/utxo/${network}/graph`, { params: { from, to }, signal })).data, liveGuess),
    refetchInterval: (current) => {
      if (current.state.data?.updating) return POLL_CONFIG.UPDATING_MS;
      return (current.state.data?.live ?? liveGuess) ? POLL_CONFIG.LIVE_MS : false;
    },
  });
  const { data } = query;
  const updating = Boolean(data?.updating);


  // The landed first crawl may have read the faucet's history
  // for the first time — the slider's day list comes from it.
  // Whether a window was seen crawling is remembered per
  // window, and judged only by its answers: stepping away from
  // a day mid-crawl is not its crawl landing, and a day left
  // mid-crawl still counts its landing when it is shown again
  const crawling = useRef(new Set());
  useEffect(() => {
    if (!data) return;
    const windowKey = `${network} ${from} ${to}`;
    if (data.updating) {
      crawling.current.add(windowKey);
    } else if (crawling.current.delete(windowKey)) {
      queryClient.invalidateQueries({ queryKey: ['utxo-tx-days', network] });
    }
  }, [data, network, from, to, queryClient]);


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


  // The backend's own sentence when the failure carries one;
  // a proxy's page or a dropped connection has nothing a
  // student could read, so the page's sentence stands in
  const message = query.error?.response?.data?.error;
  const failure = typeof message === 'string' && message.trim() ? message : 'Nepavyko gauti transakcijų';


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
    error: query.isError ? failure : null,
    updating,
    missing: data?.missing ?? 0,
  };
}

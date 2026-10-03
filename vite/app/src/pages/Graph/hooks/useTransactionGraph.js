// -----------------------------------------------------------
//  [*] Graph — useTransactionGraph
//
//  The whole vis-network machine behind the graph. The source
//  of truth is a plain model — every address with its name,
//  kind, hub flag, level, x and last sighting, every edge with
//  its sender, receiver, summed value and transaction count —
//  and labels and icons are DERIVED from it in one place,
//  never parsed back out of vis.
//
//  The layout is ours, not vis's: every node gets an explicit
//  x (persisted or dealt slot) and y (level × LEVEL_SEPARATION)
//  and the vis layout engine is disabled, so nothing ever
//  recomputes positions behind the user's back. Nodes drag
//  horizontally only (fixed.y) and stay where they were
//  dropped — the level rows themselves never move. A newcomer
//  is dealt its slot only once the whole batch it came in is
//  merged, so a restored node of the same batch is known to
//  the dealer first and the two never land on top of each
//  other.
//
//  Sweeps keep the data fresh: every known address is
//  fetched, a few at a time (contracts and public hubs
//  excepted — expanding those would pull the whole testnet
//  in), newly discovered addresses are followed breadth-first
//  up to DISCOVERY_MAX_DEPTH hops, and the next sweep is
//  scheduled only after the previous one finished, so a slow
//  backend can never stack sweeps. The first BOOT_SWEEPS
//  sweeps run at a quick warm-up cadence — right after load
//  the backend is often still indexing, so the graph fills
//  fast. Recurring sweeps run only while live (viewing today)
//  and only while the tab is visible; a past day gets its one
//  boot discovery pass and then stands still, and a boot pass
//  that throws never keeps today's live refresh from starting.
//
//  A fetch that fails is reported (`failure`) in a sentence
//  that says what went wrong — the backend's own, or the
//  reason the request failed — so an outage never looks like a
//  quiet day; an answer that is no transfer list (a captive
//  portal's page, an emptied object, a row without its
//  addresses) is a failed fetch as much as a 500 is. A sweep,
//  an expansion or the boot that throws while drawing is told
//  the same way, in its own words. The backend's sentence on
//  a failed Etherscan refresh rides along with its answers and
//  is passed on (`refreshError`), so a refused API key or a
//  rate limit shows on the graph. Requests still in flight
//  when the graph is torn down are aborted, never merged into
//  the next one.
//
//  Split into (root last) — the store, the sweep and the
//  event wiring are plain functions with no React in them;
//  the hook owns only lifecycle and the public API:
//
//    FETCH_FAILED        — the outage notice's own sentence
//    LAST_DATA_SHOWN     — a failed fetch's notice, its close
//    MAY_BE_INCOMPLETE   — a notice's close when transfers
//                          may be missing
//    TIME_UNITS          — the units an age is counted in
//    NODE_PRESENTATION   — model kind → icon + size
//    VIS_OPTIONS         — static vis-network options
//    clamp               — the zoom range clamp
//    formatAddress       — an address shortened for a label
//    formatTransactionLabel — edge label text
//    timeSince           — how long ago, for node labels
//    parseTimestamp      — the backend's timestamp as a Date
//    nodeLabel           — the one place labels are built
//    createGraphStore    — model + vis DataSets in one object
//    mapWithLimit        — a small worker pool for fetches
//    sweepGraph          — one breadth-first refresh pass
//    createSweepScheduler— the warm-up + steady cadence
//    wireNetworkEvents   — vis events → plain callbacks
//    isTransferList      — whether an answer can be drawn
//    useTransactionGraph — lifecycle + public API
//                          (default export)
// -----------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';

import { MalformedAnswerError, requestErrorText, withNextStep } from '@/utils/requestError';

import { ZOOM_CONFIG, LAYOUT_CONFIG, TIMING_CONFIG, NODE_CONFIG, EDGE_CONFIG, IMAGES, NAME_MAX_LENGTH } from '../constants';
import useNodePositions from './useNodePositions';


// What the outage notice says when the backend gave no
// sentence of its own — requestErrorText adds the reason
const FETCH_FAILED = 'Nepavyko atnaujinti grafiko.';

// What the outage notice adds after a failed fetch's reason:
// the last answers stay drawn
const LAST_DATA_SHOWN = 'Rodomi paskutiniai gauti duomenys.';

// What a notice adds after a drawing that threw, or after the
// backend's word on a cache it could not refresh from
// Etherscan: transfers may be missing from the canvas
const MAY_BE_INCOMPLETE = 'Grafike gali trūkti transakcijų.';

// The units timeSince counts an age in, largest first, each
// with its abbreviation: years and months are counted as 365
// and 30 days
const TIME_UNITS = [
  [31536000, 'm.'],     // 365 days
  [2592000, 'mėn.'],    // 30 days
  [86400, 'd.'],
  [3600, 'val.'],
  [60, 'min.'],
];







// -----------------------------------------------------------
// NODE_PRESENTATION
// -----------------------------------------------------------
//
// Model kind → how vis renders it. The kind lives in the
// model; the icon is only its presentation.
//
// Used by:
//   - createGraphStore (below) — sync, when a node is first
//     added to the DataSet
// -----------------------------------------------------------

const NODE_PRESENTATION = {
  user:     { image: IMAGES.USER,     size: NODE_CONFIG.USER_SIZE },
  contract: { image: IMAGES.CONTRACT, size: NODE_CONFIG.USER_SIZE },
  faucet:   { image: IMAGES.FAUCET,   size: NODE_CONFIG.FAUCET_SIZE },
};







// -----------------------------------------------------------
// VIS_OPTIONS
// -----------------------------------------------------------
//
// Static vis-network options. The layout engine is fully
// disabled — vis's hierarchical mode recomputes EVERY position
// on EVERY data change (its _dataChanged listener ignores
// predefined x), which is what kept snapping dragged nodes
// back. Every node we add carries an explicit x/y instead, so
// vis only renders and never repositions anything. fixed.y
// locks dragging to the horizontal axis, keeping each node on
// its level line — faucet on top, wallets below, contracts at
// the bottom of their branch.
//
// Used by:
//   - useTransactionGraph (below) — the Network constructor
// -----------------------------------------------------------

const VIS_OPTIONS = {
  layout: {
    hierarchical: { enabled: false },
    improvedLayout: false,
  },
  interaction: {
    hover: true,
    zoomView: true,
    zoomSpeed: ZOOM_CONFIG.SCROLL_SENSITIVITY,
    // bindToWindow MUST stay false: vis's default window-wide
    // key handler eats "-", "+" and the arrows everywhere on
    // the page — it made "-" untypable in the date search box.
    // Bound to the canvas, the shortcuts work when the graph
    // itself has focus.
    keyboard: { enabled: true, bindToWindow: false },
  },
  edges: {
    width: EDGE_CONFIG.WIDTH,
    smooth: EDGE_CONFIG.SMOOTH,
    font: { ...EDGE_CONFIG.FONT, multi: 'html' },
    color: EDGE_CONFIG.COLOR,
  },
  nodes: {
    font: NODE_CONFIG.FONT,
    fixed: { x: false, y: true },
  },
  physics: false,
};







// -----------------------------------------------------------
// clamp
// -----------------------------------------------------------
//
// The zoom range clamp — every zoom path funnels through it.
//
// Used by:
//   - wireNetworkEvents (below) — the wheel listener
//   - useTransactionGraph (below) — setZoom
// -----------------------------------------------------------

const clamp = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};







// -----------------------------------------------------------
// formatAddress
// -----------------------------------------------------------
//
// An address shortened for a label: its first six and last
// four characters joined by three dots — the 0x prefix and
// enough of both ends to tell two addresses apart. Anything
// shorter than ten characters passes through untouched.
//
// Used by:
//   - nodeLabel (below)
//   - useTransactionGraph (below) — publishRows, an unnamed
//     address in the hidden table
// -----------------------------------------------------------

const formatAddress = (address) => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};







// -----------------------------------------------------------
// formatTransactionLabel
// -----------------------------------------------------------
//
// Edge label: the summed value to four decimals with the
// currency symbol, and on a second line how many transactions
// the edge stands for. The symbol is the viewed network's
// native currency from the config — every chain configured
// today uses ETH, but that's the config's call, not this
// file's.
//
// The backend sends the value and the count as JSON numbers,
// but a value that arrives as text is read as the number it
// spells, and one that is no number at all prints as a
// question mark. A label is presentation and must never throw:
// the labels are rebuilt inside an effect when the network
// list brings the currency, and a throw there would take the
// whole page down.
//
// Used by:
//   - createGraphStore (below) — sync, for edge labels
// -----------------------------------------------------------

const formatTransactionLabel = (value, count, symbol = 'ETH') => {

  // A JSON number, or text that spells one — anything else is
  // no number at all
  const readNumber = (raw) => {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
    return NaN;
  };

  const amount = readNumber(value);
  const transactions = readNumber(count);
  const amountText = Number.isFinite(amount) ? amount.toFixed(4) : '?';
  const countText = Number.isFinite(transactions) ? String(transactions) : '?';
  return `${amountText} ${symbol}\n(${countText} tx${transactions > 1 ? 's' : ''})`;
};







// -----------------------------------------------------------
// timeSince
// -----------------------------------------------------------
//
// How long ago a Date was, for a node's "Atnaujinta" line:
// "prieš" and the count of the largest whole unit that fits —
// seconds, or one of TIME_UNITS (above): minutes, hours, days,
// 30-day months or 365-day years, so a full year reads as a
// year and not as twelve months. Every unit is abbreviated, which sidesteps
// Lithuanian declension entirely. Clamped at zero: a block
// timestamp a few seconds ahead of a lagging lab clock must
// not print a negative age. `now` lets a caller labeling a
// whole graph read the clock once instead of per node.
//
// Used by:
//   - nodeLabel (below) — the "Atnaujinta: …" line
// -----------------------------------------------------------

const timeSince = (date, now = Date.now()) => {
  const seconds = Math.max(0, Math.floor((now - date) / 1000));

  for (const [size, unit] of TIME_UNITS) {
    if (seconds >= size) return `prieš ${Math.floor(seconds / size)} ${unit}`;
  }
  return `prieš ${seconds} sek.`;
};







// -----------------------------------------------------------
// parseTimestamp
// -----------------------------------------------------------
//
// The backend sends timestamps both as ISO strings and as
// unix seconds — normalize either into a Date; anything else
// falls back to "now" (and is logged).
//
// Used by:
//   - createGraphStore (below) — mergeTransaction
// -----------------------------------------------------------

const parseTimestamp = (timestamp) => {
  if (typeof timestamp === 'string' || timestamp instanceof String) {
    return new Date(timestamp);
  } else if (typeof timestamp === 'number') {
    return new Date(timestamp * 1000);
  } else {
    console.error('Unrecognized timestamp format:', timestamp);
    return new Date();
  }
};







// -----------------------------------------------------------
// nodeLabel
// -----------------------------------------------------------
//
// The single place a node label is built — nothing ever
// parses a label back apart.
//
// Used by:
//   - createGraphStore (below) — sync
// -----------------------------------------------------------

const nodeLabel = (address, node, now = Date.now()) => {
  const namePart = node.name ? `${node.name}\n` : '';
  const ago = node.updatedAt ? timeSince(node.updatedAt, now) : 'ką tik';
  return `${namePart}${formatAddress(address)}\nAtnaujinta: ${ago}`;
};







// -----------------------------------------------------------
// createGraphStore
// -----------------------------------------------------------
//
// The graph's data layer, no React and no vis events in it:
// the model Maps (the source of truth) TOGETHER WITH the two
// vis DataSets they mirror into, so nobody else can touch the
// DataSets behind the model's back. `positions` is the
// persisted address → x Map (mutated in place — the caller
// owns saving it); `nextXForLevel` deals an x slot to a
// level's newcomer; `noteX` tells the dealer where a node
// already sits, so a restored arrangement, a dragged node and
// the newcomers after them never share a slot.
//
// The store answers for one model node; seeds the faucet root
// on level 0 at its saved x; merges one fetched transaction as
// two node sightings and an edge; mirrors the model into the
// DataSets; lists the addresses a sweep may expand (everything
// but contracts and public hubs); moves a dragged node — the
// persistence map, the model and the DataSet in one step;
// renames a node, saying false for an address it does not
// know; and wipes it all.
//
// A newcomer is not given its x when it is merged. An answer,
// a sweep round or an expansion merges a whole batch, and a
// restored node listed after a newcomer on the same level
// would reach the dealer only after the newcomer had been
// dealt that very x — the two were drawn on top of each
// other. The mirror deals every newcomer its slot instead,
// in the order they were sighted, once the whole batch is in.
//
// Used by:
//   - useTransactionGraph (below) — one store per graph life
// -----------------------------------------------------------

const createGraphStore = ({ positions, nextXForLevel, noteX }) => {

  const nodes = new DataSet([]);
  const edges = new DataSet([]);

  // address → { name, kind, hub, level, x, updatedAt } and
  // edge id → { from, to, value, count }
  const model = new Map();
  const edgeModel = new Map();


  // Merge one node sighting into the model. Level is
  // first-writer-wins (the tree keeps the shape it was
  // discovered in); name and timestamp always take the fresh
  // value, so the backend stays the authority on names. The
  // hub flag and the contract kind only ever escalate — once
  // the backend marks an address as a public hub or a
  // contract it stays out of the sweeps. A restored node
  // takes its saved x at once and tells the dealer where it
  // sits; a newcomer stays without an x until the mirror
  // deals it a slot (see the banner).
  const mergeNode = (address, incoming) => {
    const existing = model.get(address);
    if (existing) {
      existing.name = incoming.name;
      existing.updatedAt = incoming.updatedAt;
      existing.hub = existing.hub || incoming.hub;
      if (existing.kind === 'user' && incoming.kind === 'contract') existing.kind = 'contract';
      return existing;
    }

    const node = { ...incoming, x: positions.get(address) };
    if (node.x !== undefined) noteX(node.level, node.x);
    model.set(address, node);
    return node;
  };


  // Deal every newcomer its slot, in the order they were
  // sighted (the model keeps insertion order). By now the
  // whole batch is merged, so every restored node in it has
  // told the dealer where it sits.
  const placeNewcomers = () => {
    model.forEach((node, address) => {
      if (node.x !== undefined) return;
      node.x = nextXForLevel(node.level);
      positions.set(address, node.x);
    });
  };


  // The backend's flags are 0/1 (NULL for an address it never
  // classified) — only an explicit 1 makes a contract
  const isContract = (flag) => parseInt(flag, 10) === 1;

  // One transaction → two node sightings and one edge. The
  // sender lands one level below the fetched address, the
  // receiver one below the sender. Both sides carry their own
  // contract flag — a contract that only ever SENDS (a relayer,
  // a proxy) must not be swept like a wallet.
  const mergeTransaction = (tx, parentLevel) => {
    const fromAddress = tx.from_address.toLowerCase();
    const toAddress = tx.to_address.toLowerCase();

    const fromNode = mergeNode(fromAddress, {
      name: tx.from_name || '',
      kind: isContract(tx.from_addr_contract) ? 'contract' : 'user',
      hub: parseInt(tx.from_addr_hub, 10) === 1,
      level: parentLevel + 1,
      updatedAt: parseTimestamp(tx.from_timestamp),
    });

    mergeNode(toAddress, {
      name: tx.to_name || '',
      kind: isContract(tx.to_addr_contract) ? 'contract' : 'user',
      hub: parseInt(tx.to_addr_hub, 10) === 1,
      level: fromNode.level + 1,
      updatedAt: parseTimestamp(tx.to_timestamp),
    });

    edgeModel.set(`${fromAddress}-${toAddress}`, {
      from: fromAddress,
      to: toAddress,
      value: tx.value,
      count: tx.count,
    });
  };


  // Mirror the model into the vis DataSets — the newcomers of
  // the batch get their slots first. Every added node carries
  // an explicit x AND y (Y = level × LEVEL_SEPARATION), so vis
  // draws it exactly where the model says — there is no
  // layout engine to move it afterwards. Label and icon
  // refreshes are in-place updates that touch nothing else;
  // the clock is read once per mirror, not once per node.
  const sync = (currencySymbol) => {
    placeNewcomers();
    const now = Date.now();

    model.forEach((node, address) => {
      const label = nodeLabel(address, node, now);
      const presentation = NODE_PRESENTATION[node.kind];
      const existing = nodes.get(address);
      if (!existing) {
        nodes.add({
          id: address,
          label,
          shape: 'image',
          image: presentation.image,
          size: presentation.size,
          x: node.x,
          y: node.level * LAYOUT_CONFIG.LEVEL_SEPARATION,
        });
      } else if (existing.label !== label || existing.image !== presentation.image) {
        nodes.update({ id: address, label, image: presentation.image, size: presentation.size });
      }
    });

    edgeModel.forEach((edge, id) => {
      const label = formatTransactionLabel(edge.value, edge.count, currencySymbol);
      const existing = edges.get(id);
      if (!existing) {
        edges.add({
          id,
          from: edge.from,
          to: edge.to,
          arrows: 'to',
          label,
          font: EDGE_CONFIG.FONT,
        });
      } else if (existing.label !== label) {
        edges.update({ id, label });
      }
    });
  };


  return {
    nodes,
    edges,
    get: (address) => model.get(address),

    // The root keeps its saved x like every other node — it is
    // the node most likely to have been dragged aside
    seedRoot: (address) => {
      const x = positions.get(address) ?? 0;
      model.set(address, { name: '', kind: 'faucet', level: 0, x, updatedAt: null });
      positions.set(address, x);
      noteX(0, x);
    },

    mergeTransaction,
    sync,

    expandableAddresses: () => [...model.keys()].filter((address) => {
      const node = model.get(address);
      return node.kind !== 'contract' && !node.hub;
    }),

    // Only X is persisted — Y stays the level line. The dragged
    // x goes to the persistence map, the model and the DataSet
    // item: three copies of one truth, kept in step here and
    // nowhere else. The dealer learns it too, so a node dropped
    // past the right end of its level never has a newcomer
    // dealt on top of it.
    moveNode: (address, x) => {
      positions.set(address, x);
      const node = model.get(address);
      if (node) {
        node.x = x;
        noteX(node.level, x);
      }
      nodes.update({ id: address, x });
    },

    setName: (address, name) => {
      const node = model.get(address);
      if (!node) return false;
      node.name = name;
      return true;
    },

    clear: () => {
      model.clear();
      edgeModel.clear();
      nodes.clear();
      edges.clear();
    },
  };
};







// -----------------------------------------------------------
// mapWithLimit
// -----------------------------------------------------------
//
// Promise.all with a worker pool: at most `limit` calls of
// `fn` in flight, results in input order. A sweep's frontier
// is the whole graph, and a lab full of tabs firing every
// address at once is the backend's busiest moment.
//
// Used by:
//   - sweepGraph (below)
// -----------------------------------------------------------

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}







// -----------------------------------------------------------
// sweepGraph
// -----------------------------------------------------------
//
// One sweep: refresh all known non-contract, non-hub
// addresses (SWEEP_CONCURRENCY at a time), then keep
// following newly discovered addresses breadth-first until a
// pass finds nothing new (bounded by DISCOVERY_MAX_DEPTH).
// `merge` folds one address's result into the model and
// `mirror` syncs the DataSets ONCE per round — a round hands
// over all its results synchronously, so per-address mirrors
// would be unobservable work. `isCancelled` is probed between
// rounds so a torn-down graph never gets late writes.
//
// Used by:
//   - useTransactionGraph (below) — the boot pass and every
//     scheduled live refresh
// -----------------------------------------------------------

async function sweepGraph({ store, fetchTransactions, merge, mirror, isCancelled }) {
  const fetched = new Set();

  for (let depth = 0; depth < TIMING_CONFIG.DISCOVERY_MAX_DEPTH; depth++) {
    const frontier = store.expandableAddresses().filter((address) => !fetched.has(address));
    if (frontier.length === 0 || isCancelled()) return;

    const results = await mapWithLimit(frontier, TIMING_CONFIG.SWEEP_CONCURRENCY, async (address) => {
      fetched.add(address);
      return { address, transactions: await fetchTransactions(address) };
    });
    if (isCancelled()) return;

    results.forEach(({ address, transactions }) => merge(transactions, address));
    mirror();
  }
}







// -----------------------------------------------------------
// createSweepScheduler
// -----------------------------------------------------------
//
// The live-refresh cadence as an object: the first BOOT_SWEEPS
// passes come at the quick warm-up interval — right after
// load the backend is often still indexing fresh
// transactions, so the graph fills in seconds instead of
// waiting out the steady cadence — then every following pass
// at UPDATE_INTERVAL. The next sweep is scheduled only after
// `runSweep` settled — resolved OR rejected, the chain always
// re-arms — so a slow backend can never stack sweeps and one
// throw can never silently end the live refresh; the throw
// goes to `onError`, so the screen can say it. A hidden tab
// keeps its place in the cadence but does no work.
// `isCancelled` stops the chain and stop() kills the pending
// timer.
//
// Used by:
//   - useTransactionGraph (below) — started after boot while
//     live, stopped in the cleanup
// -----------------------------------------------------------

function createSweepScheduler(runSweep, isCancelled, onError) {

  let timerId = null;
  let warmupRemaining = TIMING_CONFIG.BOOT_SWEEPS;

  const scheduleNext = () => {
    if (isCancelled()) return;

    const delay = warmupRemaining > 0
      ? TIMING_CONFIG.BOOT_SWEEP_INTERVAL
      : TIMING_CONFIG.UPDATE_INTERVAL;
    timerId = setTimeout(async () => {
      if (warmupRemaining > 0) warmupRemaining--;
      try {
        if (!document.hidden) await runSweep();
      } catch (err) {
        onError(err);
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  return { start: scheduleNext, stop: () => clearTimeout(timerId) };
}







// -----------------------------------------------------------
// wireNetworkEvents
// -----------------------------------------------------------
//
// The vis Network's interactions as plain callbacks: zoom is
// clamped HERE (vis has no zoom limits of its own — the
// camera is pushed back whenever the wheel oversteps) and the
// clamped value handed to onScale; double-click yields the
// node id, right-click the node id under the cursor, and a
// drag end the list of every moved node with its new x
// (possibly empty — canvas pans end drags too, and the
// caller's save must still run).
//
// Used by:
//   - useTransactionGraph (below) — once per built Network
// -----------------------------------------------------------

function wireNetworkEvents(network, { onScale, onExpand, onRightClick, onMoves }) {

  network.on('zoom', (params) => {
    if (typeof params?.scale === 'number') {
      const clamped = clamp(params.scale, ZOOM_CONFIG.MIN_SCALE, ZOOM_CONFIG.MAX_SCALE);
      if (clamped !== params.scale) {
        const pos = network.getViewPosition();
        network.moveTo({ position: pos, scale: clamped, animation: false });
      }
      onScale(clamped);
    }
  });

  network.on('doubleClick', (event) => {
    if (event.nodes.length > 0) onExpand(event.nodes[0]);
  });

  network.on('oncontext', (event) => {
    event.event.preventDefault();
    const clickedNodeId = network.getNodeAt(event.pointer.DOM);
    if (clickedNodeId) onRightClick(clickedNodeId);
  });

  network.on('dragEnd', (event) => {
    const moves = [];
    event.nodes.forEach((nodeId) => {
      const position = network.getPositions([nodeId]);
      if (position[nodeId]) moves.push({ id: nodeId, x: position[nodeId].x });
    });
    onMoves(moves);
  });
}







// -----------------------------------------------------------
// isTransferList
// -----------------------------------------------------------
//
// Whether a stored-transactions answer can be drawn: a list
// whose every row names its sender and its receiver. The
// merge places a transfer by those two addresses and nothing
// else, so anything short of that — a captive portal's page
// answered with a 200, an emptied object, a row without its
// addresses — is treated as a failed fetch, a malformed
// answer: the outage notice saying so instead of a graph that
// silently stops.
//
// Used by:
//   - useTransactionGraph (below) — fetchTransactions
// -----------------------------------------------------------

function isTransferList(rows) {

  const named = (address) => typeof address === 'string' && address !== '';
  return Array.isArray(rows) && rows.every((row) => named(row?.from_address) && named(row?.to_address));
}







// -----------------------------------------------------------
// useTransactionGraph (default export)
// -----------------------------------------------------------
//
// Lifecycle and the public API — the machinery lives in the
// plain functions above. The caller passes the faucet address
// (the root), the network, the picked day's window and its
// date, whether that day is today, the currency symbol of the
// labels and what a right-click on a node does. It gets back
// the ref for the canvas container, the zoom scale with its
// setters, the rename — which resolves once the name is
// saved and throws the failure otherwise — `failure`, the
// outage notice's sentence while the last fetch or drawing
// failed, `refreshError`, the notice's sentence while the
// backend's latest Etherscan refresh of an address still
// swept failed, and `rows`, the drawn transfers as text. The
// store (model + DataSets) exists only between boot and
// cleanup; everything outside the effect reaches it through
// storeRef and tolerates null.
//
// Used by:
//   - CryptoFlowGraph.jsx — the shell around the canvas
// -----------------------------------------------------------

export default function useTransactionGraph({ faucetAddress, network, dateRange, live, day, currencySymbol, onNodeRightClick }) {

  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const storeRef = useRef(null);

  // The drawn transfers as plain rows — the text alternative
  // the shell renders as a hidden table. Refreshed after every
  // sync, which is the one moment the DataSets change.
  const [rows, setRows] = useState([]);
  const publishRows = useCallback(() => {
    const store = storeRef.current;
    if (!store) {
      setRows([]);
      return;
    }
    const nameOf = (address) => store.get(address)?.name || formatAddress(address);
    setRows(store.edges.get().map((edge) => ({
      id: edge.id,
      from: nameOf(edge.from),
      to: nameOf(edge.to),
      label: edge.label.replace('\n', ' '),
    })));
  }, []);

  // Positions are scoped per (network, day) — each day is a
  // different graph with its own hand-arranged layout
  const { positionsRef: nodePositions, save: savePositions, setLevelNextX, noteX } = useNodePositions(`${network}:${day}`);

  // Zoom scale mirrored into React for the ZoomControls slider
  const [scale, setScale] = useState(1);

  // The last fetch's verdict — an outage must not look like a
  // quiet day, so the shell shows this notice, saying what went
  // wrong, until an answer comes back; a drawing that threw
  // lands here too
  const [failure, setFailure] = useState(null);

  // The backend's word on a failed Etherscan refresh, as the
  // notice puts it — null while none of the swept addresses
  // has one
  const [refreshError, setRefreshError] = useState(null);

  // Callbacks, the positions API and the currency symbol live
  // in refs so a parent re-render (useNodePositions
  // re-creating its functions, the symbol arriving after the
  // catalog fetch) never tears the graph down
  const onNodeRightClickRef = useRef(onNodeRightClick);
  onNodeRightClickRef.current = onNodeRightClick;

  const positionsApiRef = useRef(null);
  positionsApiRef.current = { savePositions, setLevelNextX, noteX };

  const currencySymbolRef = useRef(currencySymbol);
  currencySymbolRef.current = currencySymbol;


  // The symbol is presentation only — a cold load starts with
  // the 'ETH' placeholder and relabels in place when the
  // catalog answers, instead of rebuilding the whole graph
  useEffect(() => {
    storeRef.current?.sync(currencySymbol);
    publishRows();
  }, [currencySymbol, publishRows]);


  // Boot + steady state. Boot seeds the faucet root, builds
  // the Network from the day's transactions (the backend
  // filters by the window — nothing is filtered client-side)
  // and runs one sweep immediately so the deeper hops appear
  // without waiting. Recurring sweeps run only when LIVE
  // (viewing today), on createSweepScheduler's cadence.
  // Cleanup aborts the fetches still in flight and wipes
  // store, Network and the pending sweep timer, so a :network
  // switch or a new day window rebuilds from scratch — and a
  // late answer can never land in the next graph's layout.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    // The backend's stored-transactions endpoint, always scoped
    // to the picked day's [from, to) window; an address with no
    // history that day yields [], and so does a failed request
    // — but that one is told in `failure`, the backend's own
    // sentence or the request's reason, so the page can say
    // what went wrong. An answer that is no transfer list fails
    // here too, as a malformed answer, never further down in
    // the merge, where it would throw: a throw at boot left no
    // graph, no notice and no sweep ever after. A good answer
    // also hands over the backend's word on its Etherscan
    // refresh of the address (noteRefresh).
    const fetchTransactions = async (address) => {
      try {
        const { data } = await axios.get(`/api/evm/${network}/get-stored-transactions`, {
          params: { address, from: dateRange.from, to: dateRange.to },
          signal: controller.signal,
        });
        if (!isTransferList(data?.transactions)) throw new MalformedAnswerError();
        setFailure(null);
        noteRefresh(address, data.refresh_error);
        return data.transactions;
      } catch (err) {
        if (!axios.isCancel(err)) {
          console.error('Error fetching transactions:', err);
          setFailure(withNextStep(requestErrorText(err, FETCH_FAILED), LAST_DATA_SHOWN));
        }
        return [];
      }
    };

    // The store lives exactly as long as this effect; the
    // positions Map is useNodePositions' (reloaded in place
    // when the scope key changes, before this effect runs)
    const store = createGraphStore({
      positions: nodePositions.current,
      nextXForLevel: (level) => positionsApiRef.current.setLevelNextX(level),
      noteX: (level, x) => positionsApiRef.current.noteX(level, x),
    });
    storeRef.current = store;

    // The backend's word on its latest Etherscan refresh of each
    // address asked about: the failure sentence while that
    // refresh failed, nothing once one succeeded. The first
    // failure among the addresses still swept is shown — a
    // contract or a public hub is never asked about again, so
    // its last word would otherwise stay up for good
    const refreshErrors = new Map();
    const noteRefresh = (address, sentence) => {
      if (cancelled) return;
      if (typeof sentence === 'string' && sentence.trim()) refreshErrors.set(address, sentence.trim());
      else refreshErrors.delete(address);

      const swept = [...refreshErrors].find(([known]) => {
        const node = store.get(known);
        return !node || (node.kind !== 'contract' && !node.hub);
      });
      setRefreshError(swept ? withNextStep(swept[1], MAY_BE_INCOMPLETE) : null);
    };

    // A sweep, an expansion or the boot that throws — vis
    // refusing a node, say — had its answers but drew short of
    // them: logged, and told in the notice in the drawing's own
    // words, so a gap on the canvas has a reason next to it
    const drawingFailed = (label, err) => {
      console.error(label, err);
      if (cancelled) return;
      setFailure(withNextStep(`Nepavyko nupiešti grafiko: ${err?.message || err}`, MAY_BE_INCOMPLETE));
    };

    // Fold a fetch result into the model (`merge`) and mirror
    // the model into the DataSets (`mirror`) — sweep rounds
    // merge every result and mirror once, a double-click
    // expand does both for one address. The guards drop late
    // responses that land after the cleanup wiped everything:
    // the store is this effect's, the ref would already belong
    // to the next graph.
    const merge = (transactions, centralAddress) => {
      if (cancelled || !networkRef.current) return;

      const parentLevel = store.get(centralAddress)?.level ?? 0;
      transactions.forEach((tx) => store.mergeTransaction(tx, parentLevel));
    };

    const mirror = () => {
      if (cancelled || !networkRef.current) return;
      store.sync(currencySymbolRef.current);
      publishRows();
    };

    // Double-click: pull that address's own transactions in
    const expandAddress = async (address) => {
      const transactions = await fetchTransactions(address);
      merge(transactions, address);
      mirror();
    };

    const sweep = () => sweepGraph({
      store,
      fetchTransactions,
      merge,
      mirror,
      isCancelled: () => cancelled,
    });

    const scheduler = createSweepScheduler(sweep, () => cancelled, (err) => drawingFailed('Sweep failed:', err));

    const boot = async () => {
      const transactions = await fetchTransactions(faucetAddress);
      if (cancelled || !containerRef.current) return;

      store.seedRoot(faucetAddress);
      transactions.forEach((tx) => store.mergeTransaction(tx, 0));
      store.sync(currencySymbolRef.current);
      publishRows();

      networkRef.current = new Network(
        containerRef.current,
        { nodes: store.nodes, edges: store.edges },
        VIS_OPTIONS,
      );
      try {
        setScale(networkRef.current.getScale() || 1);
      } catch {
        // getScale can throw while the canvas is still mounting —
        // the zoom listener corrects the slider on the first zoom
      }

      wireNetworkEvents(networkRef.current, {
        onScale: setScale,

        // Contracts and public hubs are never expanded — a
        // global contract's history (a token like LINK) or a
        // community faucet's is the whole testnet's traffic,
        // not this graph's neighborhood. The sweeps skip them
        // for the same reason.
        onExpand: (nodeId) => {
          const node = store.get(nodeId);
          if (node?.kind === 'contract' || node?.hub) return;
          expandAddress(nodeId).catch((err) => drawingFailed('Expand failed:', err));
        },

        onRightClick: (nodeId) => {
          onNodeRightClickRef.current(nodeId, store.get(nodeId)?.name || '');
        },

        onMoves: (moves) => {
          moves.forEach(({ id, x }) => store.moveNode(id, x));
          positionsApiRef.current.savePositions();
        },
      });

      // The boot sweep is a head start for the live refresh,
      // never its gate: a throw in it is told like any later
      // sweep's, and today's graph is still swept on schedule
      try {
        await sweep();
      } catch (err) {
        drawingFailed('Sweep failed:', err);
      }
      if (live) scheduler.start();
    };

    boot().catch((err) => drawingFailed('Graph boot failed:', err));

    // The refresh notice belongs to this graph's addresses; the
    // outage notice stays until the next graph's first answer
    return () => {
      cancelled = true;
      controller.abort();
      scheduler.stop();
      networkRef.current?.destroy();
      networkRef.current = null;
      store.clear();
      storeRef.current = null;
      publishRows();
      setRefreshError(null);
    };
  }, [faucetAddress, network, dateRange.from, dateRange.to, live, nodePositions, publishRows]);


  // Single entry for zoom changes — slider, buttons and the
  // wheel listener all funnel here: clamp, mirror into state,
  // move the camera
  const setZoom = (value) => {
    const clamped = clamp(value, ZOOM_CONFIG.MIN_SCALE, ZOOM_CONFIG.MAX_SCALE);
    setScale(clamped);
    if (!networkRef.current) return;
    const pos = networkRef.current.getViewPosition();
    networkRef.current.moveTo({ position: pos, scale: clamped, animation: false });
  };

  const zoomIn = () => setZoom(scale + ZOOM_CONFIG.BUTTON_STEP);
  const zoomOut = () => setZoom(scale - ZOOM_CONFIG.BUTTON_STEP);


  // Rename: tell the backend and, once it agreed, update the
  // model and re-derive the label — awaited, and a save that
  // failed throws (the request's own error, or a malformed
  // answer when the backend's OK is missing), so the dialog
  // can say why instead of closing over a lost write. An EMPTY
  // name clears the label (the backend stores ''), the one way
  // to remove a label from the UI. No layout runs, so nothing
  // moves.
  const renameNode = async (address, name) => {
    if (!address) throw new Error('Nepavyko išsaugoti pavadinimo: nenurodytas adresas.');
    const trimmed = (name || '').trim().slice(0, NAME_MAX_LENGTH);

    // The URL is built by hand, not from axios params: a space
    // travels as %20, exactly what the rename always sent
    const { data } = await axios.get(
      `/api/evm/set-address-name?address=${encodeURIComponent(address)}&name=${encodeURIComponent(trimmed)}`,
    );
    if (data?.status !== 'OK') throw new MalformedAnswerError();

    // The store may have been rebuilt under the dialog (a new
    // day or network) — the name is saved either way, and the
    // next sweep brings it back
    if (storeRef.current?.setName(address, trimmed)) {
      storeRef.current.sync(currencySymbolRef.current);
      publishRows();
    }
  };


  return { containerRef, scale, setZoom, zoomIn, zoomOut, renameNode, failure, refreshError, rows };
}

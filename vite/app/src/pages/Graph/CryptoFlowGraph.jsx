// -----------------------------------------------------------
//  [*] Graph — CryptoFlowGraph
//
//  The interactive transaction-flow graph (vis-network): a
//  hierarchical tree growing down from the faucet node, one
//  node per address, one edge per from→to pair labeled with
//  the summed value and tx count. Every 15 s a sweep
//  refreshes all known addresses in parallel and follows
//  newly discovered ones breadth-first; double-click expands
//  an address on demand, right-click renames it, and dragged
//  X positions persist in localStorage per network AND per
//  viewed day — each day is a different graph, so each keeps
//  its own arrangement.
//
//  Every fetch carries the page's picked-day window
//  (dateRange, a [from, to) unix pair) — the backend filters,
//  nothing is filtered client-side. When the page views a
//  past day (live=false) the recurring sweeps don't run:
//  history is frozen, one discovery pass is enough. A
//  :network route change OR a new day window reuses this
//  component instance; the boot effect's cleanup wipes the
//  model, the DataSets and the Network, so every rebuild
//  starts from a clean canvas.
//
//  Split into (root component last):
//
//    ZOOM_BUTTON_SX      — shared look of the +/- buttons
//    NODE_PRESENTATION   — model kind → icon + size
//    VIS_OPTIONS         — static vis-network options
//    useNodePositions    — dragged-X persistence + level slots
//    useTransactionGraph — model + sweeps + the vis machine
//    ZoomControls        — floating slider + plus/minus
//    AddressDialog       — right-click name & copy dialog
//    CryptoFlowGraph     — thin shell (default export)
// -----------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';

import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';

import {
  timeSince,
  parseTimestamp,
  formatAddress,
  formatTransactionLabel,
  clamp,
  copyToClipboard,
} from './utils';
import {
  ZOOM_CONFIG,
  LAYOUT_CONFIG,
  TIMING_CONFIG,
  NODE_CONFIG,
  EDGE_CONFIG,
  DIMENSIONS,
  STORAGE_KEYS,
  IMAGES,
} from './constants';


// Shared look of the round plus/minus zoom buttons
const ZOOM_BUTTON_SX = {
  bgcolor: 'primary.main',
  color: 'common.white',
  '&:hover': { bgcolor: 'primary.dark' },
  width: 24,
  height: 24,
  borderRadius: '50%',
};


// Model kind → how vis renders it. The kind lives in the
// model; the icon is only its presentation.
const NODE_PRESENTATION = {
  user:     { image: IMAGES.USER,     size: NODE_CONFIG.USER_SIZE },
  contract: { image: IMAGES.CONTRACT, size: NODE_CONFIG.USER_SIZE },
  faucet:   { image: IMAGES.FAUCET,   size: NODE_CONFIG.FAUCET_SIZE },
};


// vis-network options. The layout engine is fully disabled —
// vis's hierarchical mode recomputes EVERY position on EVERY
// data change (its _dataChanged listener ignores predefined
// x), which is what kept snapping dragged nodes back. Every
// node we add carries an explicit x/y instead, so vis only
// renders and never repositions anything. fixed.y locks
// dragging to the horizontal axis, keeping each node on its
// level line — faucet on top, wallets below, contracts at the
// bottom of their branch.
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
// useNodePositions
// -----------------------------------------------------------
//
//   const { positionsRef, save, setLevelNextX } =
//     useNodePositions(scopeKey)
//
// Persistence for dragged nodes: an address → X map, saved
// under graphNodePositions:<network>:<day> in localStorage
// and reloaded whenever the scope changes — every viewed day
// is a different graph, so every (network, day) pair keeps
// its own arrangement. Only X survives — Y always comes from
// the hierarchical layout. setLevelNextX deals X slots left
// to right per hierarchy level so new nodes never stack.
//
// Used by:
//   - useTransactionGraph (below)
// -----------------------------------------------------------

function useNodePositions(scopeKey) {

  // address → x for placed nodes; level → last dealt x for
  // spacing the next newcomer at that level
  const positionsRef = useRef(new Map());
  const levelsRef = useRef(new Map());

  const storageKey = `${STORAGE_KEYS.NODE_POSITIONS_PREFIX}${scopeKey}`;


  const save = () => {
    try {
      const obj = {};
      positionsRef.current.forEach((x, key) => {
        if (typeof key === 'string' && typeof x === 'number') {
          obj[key] = x;
        }
      });
      localStorage.setItem(storageKey, JSON.stringify(obj));
    } catch (error) {
      console.warn('Failed to save node positions to localStorage:', error);
    }
  };


  // Load per storage key — a network switch first drops the
  // previous network's entries; bad JSON just means starting
  // with a clean slate
  useEffect(() => {
    positionsRef.current.clear();
    levelsRef.current.clear();
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const obj = JSON.parse(raw);
      Object.entries(obj).forEach(([address, xPosition]) => {
        const x = Number(xPosition);
        if (!Number.isNaN(x)) positionsRef.current.set(address, x);
      });
    } catch (error) {
      console.warn('Failed to load node positions from localStorage:', error);
    }
  }, [storageKey]);


  const setLevelNextX = (level) => {
    const lastX = levelsRef.current.get(level) || 0;
    const nextX = lastX + LAYOUT_CONFIG.NODE_HORIZONTAL_INCREMENT;
    levelsRef.current.set(level, nextX);
    return nextX;
  };


  return { positionsRef, save, setLevelNextX };
}







// -----------------------------------------------------------
// useTransactionGraph
// -----------------------------------------------------------
//
//   const { containerRef, scale, setZoom, zoomIn, zoomOut,
//           renameNode } = useTransactionGraph({
//     faucetAddress, network, dateRange, live,
//     onNodeRightClick })
//
// The whole vis-network machine behind the graph. The source
// of truth is a plain model — address → { name, kind, level,
// x, updatedAt } and edge → { from, to, value, count } — and
// labels/icons are DERIVED from it in one place, never parsed
// back out of vis.
//
// The layout is ours, not vis's: every node gets an explicit
// x (persisted or dealt slot) and y (level × LEVEL_SEPARATION)
// and the vis layout engine is disabled, so nothing ever
// recomputes positions behind the user's back. Nodes drag
// horizontally only (fixed.y) and stay where they were
// dropped — the level rows themselves never move. Sweeps keep
// the data fresh: every known non-contract address is fetched
// in parallel, newly discovered addresses are followed
// breadth-first up to DISCOVERY_MAX_DEPTH hops, and the next
// sweep is scheduled only after the previous one finished, so
// a slow backend can never stack sweeps. The first BOOT_SWEEPS
// sweeps run at a quick warm-up cadence — right after load the
// backend is often still indexing, so the graph fills fast.
// Recurring sweeps run only while live (viewing today); a past
// day gets its one boot discovery pass and then stands still.
//
// Used by:
//   - CryptoFlowGraph (below)
// -----------------------------------------------------------

function useTransactionGraph({ faucetAddress, network, dateRange, live, day, onNodeRightClick }) {

  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const nodes = useRef(new DataSet([])).current;
  const edges = useRef(new DataSet([])).current;

  // The source of truth, kept apart from what vis renders:
  // address → { name, kind, level, x, updatedAt } and
  // edge id → { from, to, value, count }
  const modelRef = useRef(new Map());
  const edgeModelRef = useRef(new Map());

  // Positions are scoped per (network, day) — each day is a
  // different graph with its own hand-arranged layout
  const { positionsRef: nodePositions, save: savePositions, setLevelNextX } = useNodePositions(`${network}:${day}`);

  // Zoom scale mirrored into React for the ZoomControls slider
  const [scale, setScale] = useState(1);

  // The callback lives in a ref so a parent re-render doesn't
  // rebuild the whole graph
  const onNodeRightClickRef = useRef(onNodeRightClick);
  onNodeRightClickRef.current = onNodeRightClick;


  // The backend's stored-transactions endpoint, always scoped
  // to the picked day's [from, to) window; an address with no
  // history that day (or a failed request) just yields []
  const fetchTransactions = async (address) => {
    try {
      const response = await fetch(
        `/api/evm/${network}/get-stored-transactions`
        + `?address=${address}&from=${dateRange.from}&to=${dateRange.to}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }
      const data = await response.json();
      return data.transactions;
    } catch (err) {
      console.error('Error fetching data:', err);
      return [];
    }
  };


  // Merge one node sighting into the model. Level and kind are
  // first-writer-wins (the tree keeps the shape it was
  // discovered in); name and timestamp always take the fresh
  // value, so the backend stays the authority on names.
  const mergeNode = (address, incoming) => {
    const existing = modelRef.current.get(address);
    if (existing) {
      existing.name = incoming.name;
      existing.updatedAt = incoming.updatedAt;
      return existing;
    }

    const x = nodePositions.current.get(address) ?? setLevelNextX(incoming.level);
    const node = { ...incoming, x };
    modelRef.current.set(address, node);
    nodePositions.current.set(address, x);
    return node;
  };


  // One transaction → two node sightings and one edge. The
  // sender lands one level below the fetched address, the
  // receiver one below the sender.
  const mergeTransaction = (tx, parentLevel) => {
    const fromAddress = tx.from_address.toLowerCase();
    const toAddress = tx.to_address.toLowerCase();

    const fromNode = mergeNode(fromAddress, {
      name: tx.from_name || '',
      kind: 'user',
      level: parentLevel + 1,
      updatedAt: parseTimestamp(tx.from_timestamp),
    });

    mergeNode(toAddress, {
      name: tx.to_name || '',
      kind: parseInt(tx.to_addr_contract, 10) === 0 ? 'user' : 'contract',
      level: fromNode.level + 1,
      updatedAt: parseTimestamp(tx.to_timestamp),
    });

    edgeModelRef.current.set(`${fromAddress}-${toAddress}`, {
      from: fromAddress,
      to: toAddress,
      value: tx.value,
      count: tx.count,
    });
  };


  // The single place a node label is built — nothing ever
  // parses a label back apart
  const nodeLabel = (address, node) => {
    const namePart = node.name ? `${node.name}\n` : '';
    const ago = node.updatedAt ? timeSince(node.updatedAt) : 'ką tik';
    return `${namePart}${formatAddress(address)}\nAtnaujinta: ${ago}`;
  };


  // Mirror the model into the vis DataSets. Every added node
  // carries an explicit x AND y (Y = level × LEVEL_SEPARATION),
  // so vis draws it exactly where the model says — there is no
  // layout engine to move it afterwards. Label refreshes are
  // in-place updates that touch nothing else.
  const syncDataSets = () => {
    modelRef.current.forEach((node, address) => {
      const label = nodeLabel(address, node);
      const existing = nodes.get(address);
      if (!existing) {
        const presentation = NODE_PRESENTATION[node.kind];
        nodes.add({
          id: address,
          label,
          shape: 'image',
          image: presentation.image,
          size: presentation.size,
          x: node.x,
          y: node.level * LAYOUT_CONFIG.LEVEL_SEPARATION,
        });
      } else if (existing.label !== label) {
        nodes.update({ id: address, label });
      }
    });

    edgeModelRef.current.forEach((edge, id) => {
      const label = formatTransactionLabel(edge.value, edge.count);
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


  // Merge a fetch result and mirror it — every live data path
  // (sweep passes, double-click expands) funnels through here.
  // The networkRef guard drops late responses that land after
  // the cleanup wiped everything.
  const ingestTransactions = (transactions, centralAddress) => {
    if (!networkRef.current) return;

    const parentLevel = modelRef.current.get(centralAddress)?.level ?? 0;
    transactions.forEach((tx) => mergeTransaction(tx, parentLevel));

    syncDataSets();
  };


  // Double-click: pull that address's own transactions in
  const expandAddress = async (address) => {
    const transactions = await fetchTransactions(address);
    ingestTransactions(transactions, address);
  };


  // Wire the Network's interactions: zoom → clamp + slider
  // sync, double-click → expand, right-click → hand the
  // address to the parent, drag end → persist the new X
  const setupEventListeners = () => {
    networkRef.current.on('zoom', (params) => {
      if (typeof params?.scale === 'number') {
        const clamped = clamp(params.scale, ZOOM_CONFIG.MIN_SCALE, ZOOM_CONFIG.MAX_SCALE);
        // vis-network has no zoom limits of its own — push the
        // camera back whenever the wheel oversteps the range
        if (clamped !== params.scale) {
          const pos = networkRef.current.getViewPosition();
          networkRef.current.moveTo({ position: pos, scale: clamped, animation: false });
        }
        setScale(clamped);
      }
    });

    networkRef.current.on('doubleClick', (event) => {
      if (event.nodes.length > 0) {
        expandAddress(event.nodes[0]);
      }
    });

    networkRef.current.on('oncontext', (event) => {
      event.event.preventDefault();
      const clickedNodeId = networkRef.current.getNodeAt(event.pointer.DOM);
      if (clickedNodeId) {
        const currentName = modelRef.current.get(clickedNodeId)?.name || '';
        onNodeRightClickRef.current(clickedNodeId, currentName);
      }
    });

    networkRef.current.on('dragEnd', (event) => {
      event.nodes.forEach((nodeId) => {
        const position = networkRef.current.getPositions([nodeId]);
        if (position[nodeId]) {
          // Only X is persisted — Y stays the level line. The
          // dragged x goes to the persistence map, the model
          // and the DataSet item: three copies of one truth,
          // kept in step.
          nodePositions.current.set(nodeId, position[nodeId].x);
          const node = modelRef.current.get(nodeId);
          if (node) node.x = position[nodeId].x;
          nodes.update({ id: nodeId, x: position[nodeId].x });
        }
      });
      savePositions();
    });
  };


  // Boot + steady state. Boot seeds the faucet root, builds
  // the Network from the day's transactions (the backend
  // filters by the window — nothing is filtered client-side)
  // and runs one sweep immediately so the deeper hops appear
  // without waiting. Recurring sweeps are scheduled only when
  // LIVE (viewing today): the next BOOT_SWEEPS come at the
  // quick warm-up cadence before settling into
  // UPDATE_INTERVAL, and each sweep re-schedules the next
  // only once it finished. Cleanup wipes model, DataSets and
  // Network, so a :network switch or a new day window
  // rebuilds from scratch.
  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    // One sweep: refresh all known non-contract addresses in
    // parallel, then keep following newly discovered addresses
    // breadth-first until a pass finds nothing new (bounded by
    // DISCOVERY_MAX_DEPTH). DataSets mirror once per pass.
    const sweep = async () => {
      const fetched = new Set();

      for (let depth = 0; depth < TIMING_CONFIG.DISCOVERY_MAX_DEPTH; depth++) {
        const frontier = [...modelRef.current.keys()].filter((address) =>
          !fetched.has(address) && modelRef.current.get(address).kind !== 'contract'
        );
        if (frontier.length === 0 || cancelled) return;

        const results = await Promise.all(frontier.map(async (address) => {
          fetched.add(address);
          return { address, transactions: await fetchTransactions(address) };
        }));
        if (cancelled) return;

        results.forEach(({ address, transactions }) => {
          ingestTransactions(transactions, address);
        });
      }
    };

    // The first sweeps come fast: right after load the backend
    // is often still indexing fresh transactions, so a short
    // burst of quick refreshes fills the graph in seconds
    // instead of waiting out the 15 s cadence
    let warmupRemaining = TIMING_CONFIG.BOOT_SWEEPS;

    const scheduleNextSweep = () => {
      if (cancelled) return;
      const delay = warmupRemaining > 0
        ? TIMING_CONFIG.BOOT_SWEEP_INTERVAL
        : TIMING_CONFIG.UPDATE_INTERVAL;
      timerId = setTimeout(async () => {
        if (warmupRemaining > 0) warmupRemaining--;
        await sweep();
        scheduleNextSweep();
      }, delay);
    };

    const boot = async () => {
      const transactions = await fetchTransactions(faucetAddress);
      if (cancelled || !containerRef.current) return;

      modelRef.current.set(faucetAddress, {
        name: '',
        kind: 'faucet',
        level: 0,
        x: 0,
        updatedAt: null,
      });
      nodePositions.current.set(faucetAddress, 0);

      transactions.forEach((tx) => mergeTransaction(tx, 0));
      syncDataSets();

      networkRef.current = new Network(containerRef.current, { nodes, edges }, VIS_OPTIONS);
      try {
        setScale(networkRef.current.getScale() || 1);
      } catch (_) {}
      setupEventListeners();

      await sweep();
      if (live) scheduleNextSweep();
    };

    boot();

    return () => {
      cancelled = true;
      clearTimeout(timerId);
      networkRef.current?.destroy();
      networkRef.current = null;
      nodes.clear();
      edges.clear();
      modelRef.current.clear();
      edgeModelRef.current.clear();
    };
  }, [faucetAddress, network, dateRange.from, dateRange.to, live]);


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


  // Rename: update the model, re-derive the label, tell the
  // backend (fire-and-forget GET — the next sweep comes back
  // with the saved name). No layout runs, so nothing moves.
  const renameNode = (address, name) => {
    const node = modelRef.current.get(address);
    const trimmed = (name || '').trim();
    if (!node || !trimmed) return;

    node.name = trimmed;
    fetch(`/api/evm/set-address-name?address=${address}&name=${encodeURIComponent(trimmed)}`);
    syncDataSets();
  };


  return { containerRef, scale, setZoom, zoomIn, zoomOut, renameNode };
}







// -----------------------------------------------------------
// ZoomControls
// -----------------------------------------------------------
//
// Floating panel in the graph's top-right corner: a vertical
// slider between round plus/minus buttons. Purely controlled —
// the scale value and every handler come from the parent.
//
// Used by:
//   - CryptoFlowGraph (below)
// -----------------------------------------------------------

function ZoomControls({ scale, min, max, step, onScaleChange, onZoomIn, onZoomOut }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        right: 12,
        top: 12,
        backgroundColor: 'rgba(255,255,255,0.9)',
        border: '1px solid #ddd',
        borderRadius: 2,
        p: 0.5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
      }}
    >
      <IconButton size="small" onClick={onZoomIn} aria-label="Priartinti" sx={ZOOM_BUTTON_SX}>
        <AddIcon fontSize="small" />
      </IconButton>

      <Slider
        orientation="vertical"
        value={scale}
        min={min}
        max={max}
        step={step}
        onChange={(_, value) => onScaleChange(Array.isArray(value) ? value[0] : value)}
        sx={{ height: DIMENSIONS.ZOOM_SLIDER_HEIGHT, mx: 0.5 }}
      />

      <IconButton size="small" onClick={onZoomOut} aria-label="Nutolinti" sx={ZOOM_BUTTON_SX}>
        <RemoveIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}







// -----------------------------------------------------------
// AddressDialog
// -----------------------------------------------------------
//
// The right-click dialog of a node: rename the address (the
// parent saves on Išsaugoti) and copy the raw address, with a
// 1 s "Nukopijuota" tooltip as feedback. The backdrop blurs
// the graph instead of dimming it.
//
// Used by:
//   - CryptoFlowGraph (below)
// -----------------------------------------------------------

function AddressDialog({ open, onClose, name, setName, address, onSave }) {

  const [copyHintOpen, setCopyHintOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      BackdropProps={{
        sx: {
          backgroundColor: 'transparent',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        },
      }}
    >
      <DialogTitle sx={{ pr: 6 }}>
        Adreso nustatymai
        <IconButton aria-label="uždaryti" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <TextField fullWidth label="Adreso pavadinimas" value={name} onChange={(e) => setName(e.target.value)} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField fullWidth label="Adresas" value={address || ''} InputProps={{ readOnly: true }} />
          <Tooltip open={copyHintOpen} title="Nukopijuota" disableHoverListener>
            <IconButton
              aria-label="copy"
              onClick={async () => {
                const success = await copyToClipboard(address);
                if (success) {
                  setCopyHintOpen(true);
                  setTimeout(() => setCopyHintOpen(false), 1000);
                }
              }}
            >
              <ContentCopyIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Atšaukti</Button>
        <Button variant="contained" onClick={onSave}>Išsaugoti</Button>
      </DialogActions>
    </Dialog>
  );
}







// -----------------------------------------------------------
// CryptoFlowGraph (default export)
// -----------------------------------------------------------
//
// A thin shell over useTransactionGraph: the canvas div, the
// zoom panel and the right-click naming dialog. All graph
// state and logic live in the hook.
//
// Used by:
//   - Page.jsx
// -----------------------------------------------------------

export default function CryptoFlowGraph({ faucetAddress, network, dateRange, live, day }) {

  // Right-click dialog: which address, and the name draft
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [tempName, setTempName] = useState('');

  const { containerRef, scale, setZoom, zoomIn, zoomOut, renameNode } = useTransactionGraph({
    faucetAddress,
    network,
    dateRange,
    live,
    day,
    onNodeRightClick: (address, currentName) => {
      setSelectedAddress(address);
      setTempName(currentName);
      setNameDialogOpen(true);
    },
  });


  const saveAddressName = () => {
    renameNode(selectedAddress, tempName);
    setNameDialogOpen(false);
  };


  return (
    // flex-1 + min-h-0: the canvas fills whatever height the
    // page's flex column has left after the date bar — sizing
    // lives in the parent, not in a hardcoded calc here
    <div className="min-h-0 flex-1">
      {/* The graph canvas with the zoom panel floating on top */}
      <Box sx={{ position: 'relative', height: '100%' }}>
        <div
          ref={containerRef}
          style={{ height: '100%', width: '100%', border: '1px solid #ddd' }}
        />

        <ZoomControls
          scale={scale}
          min={ZOOM_CONFIG.MIN_SCALE}
          max={ZOOM_CONFIG.MAX_SCALE}
          step={ZOOM_CONFIG.SLIDER_STEP}
          onScaleChange={setZoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
        />
      </Box>

      <AddressDialog
        open={nameDialogOpen}
        onClose={() => setNameDialogOpen(false)}
        name={tempName}
        setName={setTempName}
        address={selectedAddress}
        onSave={saveAddressName}
      />
    </div>
  );
}

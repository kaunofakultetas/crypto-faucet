// -----------------------------------------------------------
//  [*] Graph — constants
//
//  Every tuning knob of the transaction graph in one place:
//  zoom limits, layout spacing, refresh timing, node/edge
//  styling, storage keys and icon paths.
//
//  Used by:
//    - useTransactionGraph.js, useNodePositions.js
//    - CryptoFlowGraph.jsx, ZoomControls.jsx
// -----------------------------------------------------------







// -----------------------------------------------------------
// ZOOM_CONFIG
// -----------------------------------------------------------
//
// Zoom limits and sensitivity — the graph clamps every zoom
// path (wheel, slider, buttons) to MIN_SCALE..MAX_SCALE.
//
// Used by:
//   - useTransactionGraph.js — the zoom listener and setZoom
//   - CryptoFlowGraph.jsx — the ZoomControls props
// -----------------------------------------------------------

export const ZOOM_CONFIG = {
  MIN_SCALE: 0.2,
  MAX_SCALE: 2.0,
  BUTTON_STEP: 0.1,         // one press of the +/- buttons
  SCROLL_SENSITIVITY: 0.75, // wheel speed (vis zoomSpeed, 0-1)
  SLIDER_STEP: 0.01,
};







// -----------------------------------------------------------
// LAYOUT_CONFIG
// -----------------------------------------------------------
//
// Manual layout geometry, all in px — the vis layout engine
// is disabled, the graph computes positions itself.
//
// Used by:
//   - useTransactionGraph.js — syncDataSets (Y = level ×
//     LEVEL_SEPARATION)
//   - useNodePositions.js — X slot width
// -----------------------------------------------------------

export const LAYOUT_CONFIG = {
  LEVEL_SEPARATION: 275,          // vertical distance between levels
  NODE_HORIZONTAL_INCREMENT: 150, // X slot width dealt to new nodes
};







// -----------------------------------------------------------
// TIMING_CONFIG
// -----------------------------------------------------------
//
// Sweep pacing: how often the graph refreshes, how fast the
// boot warm-up runs and how deep one sweep may follow newly
// discovered addresses.
//
// Used by:
//   - useTransactionGraph.js — the sweep loop
// -----------------------------------------------------------

export const TIMING_CONFIG = {
  UPDATE_INTERVAL: 15000,    // ms from the end of one sweep to the next
  BOOT_SWEEPS: 5,            // quick warm-up sweeps right after load
  BOOT_SWEEP_INTERVAL: 1000, // ms between the warm-up sweeps
  DISCOVERY_MAX_DEPTH: 5,    // BFS hops a single sweep may follow
};







// -----------------------------------------------------------
// NODE_CONFIG
// -----------------------------------------------------------
//
// Node styling — the faucet root renders larger than the
// user/contract nodes.
//
// Used by:
//   - useTransactionGraph.js — NODE_PRESENTATION and
//     VIS_OPTIONS (label font)
// -----------------------------------------------------------

export const NODE_CONFIG = {
  USER_SIZE: 20,
  FAUCET_SIZE: 30,
  FONT: { size: 14, face: 'Tahoma' },
};







// -----------------------------------------------------------
// EDGE_CONFIG
// -----------------------------------------------------------
//
// Edge styling — one gentle clockwise curve per edge, grey in
// every interaction state.
//
// Used by:
//   - useTransactionGraph.js — VIS_OPTIONS and syncDataSets
//     (edge label font)
// -----------------------------------------------------------

export const EDGE_CONFIG = {
  WIDTH: 2,
  SMOOTH: {
    type: 'curvedCW',
    roundness: 0.2,
  },
  FONT: { size: 12, align: 'middle', multi: 'html' },
  COLOR: { color: '#848484', highlight: '#848484', hover: '#848484' },
};







// -----------------------------------------------------------
// DIMENSIONS
// -----------------------------------------------------------
//
// Container sizing. The graph canvas itself has no height
// constant anymore — it fills whatever the page's flex column
// leaves after the date bar.
//
// Used by:
//   - ZoomControls.jsx — the vertical slider
// -----------------------------------------------------------

export const DIMENSIONS = {
  ZOOM_SLIDER_HEIGHT: 180, // vertical slider, px
};







// -----------------------------------------------------------
// STORAGE_KEYS
// -----------------------------------------------------------
//
// localStorage key prefixes — the network name is appended,
// so each network keeps its own saved node positions.
//
// Used by:
//   - useNodePositions.js
// -----------------------------------------------------------

export const STORAGE_KEYS = {
  NODE_POSITIONS_PREFIX: 'graphNodePositions:',
};







// -----------------------------------------------------------
// IMAGES
// -----------------------------------------------------------
//
// Node icons — pure presentation; the user/contract/faucet
// distinction itself lives in the model's kind field.
//
// Used by:
//   - useTransactionGraph.js — NODE_PRESENTATION
// -----------------------------------------------------------

export const IMAGES = {
  USER: '/img/user.png',
  CONTRACT: '/img/contract.png',
  FAUCET: '/img/faucet.png',
};

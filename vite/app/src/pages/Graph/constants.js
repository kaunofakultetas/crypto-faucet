/**
 * Constants for the Graph visualization system
 * Centralized configuration for vis-network graph behavior and styling
 */

// ===== ZOOM CONFIGURATION =====
export const ZOOM_CONFIG = {
  /** Minimum zoom scale allowed in the graph */
  MIN_SCALE: 0.2,
  /** Maximum zoom scale allowed in the graph */
  MAX_SCALE: 2.0,
  /** Step size for zoom buttons (+/-) */
  BUTTON_STEP: 0.1,
  /** Zoom sensitivity for scroll wheel (0-1, lower = less sensitive) */
  SCROLL_SENSITIVITY: 0.75,
  /** Precision step for zoom slider */
  SLIDER_STEP: 0.01,
}

// ===== LAYOUT CONFIGURATION =====
export const LAYOUT_CONFIG = {
  /** Vertical separation between hierarchy levels (px) */
  LEVEL_SEPARATION: 275,
  /** Horizontal spacing between nodes at same level (px) */
  NODE_SPACING: 200,
  /** Spacing between different tree branches (px) */
  TREE_SPACING: 300,
  /** Horizontal spacing increment for nodes at same level (px) */
  NODE_HORIZONTAL_INCREMENT: 150,
  /** Default Y offset multiplier per level */
  LEVEL_Y_MULTIPLIER: 200,
}

// ===== TIMING CONFIGURATION =====
export const TIMING_CONFIG = {
  /** Interval for automatic graph updates (ms) */
  UPDATE_INTERVAL: 15000, // 15 seconds
  /** Delay for graph stabilization between updates (ms) */
  STABILIZATION_DELAY: 750,
  /** Number of stabilization cycles during initialization */
  STABILIZATION_CYCLES: 3,
  /** Delay before position restoration after name changes (ms) */
  POSITION_RESTORE_DELAY: 50,
}

// ===== NODE CONFIGURATION =====
export const NODE_CONFIG = {
  /** Default node size for user addresses */
  USER_SIZE: 20,
  /** Size for the faucet node */
  FAUCET_SIZE: 30,
  /** Font configuration for node labels */
  FONT: { size: 14, face: 'Tahoma' },
}

// ===== EDGE CONFIGURATION =====
export const EDGE_CONFIG = {
  /** Edge line width */
  WIDTH: 2,
  /** Edge smoothing configuration */
  SMOOTH: {
    type: 'curvedCW',
    roundness: 0.2,
  },
  /** Font configuration for edge labels */
  FONT: { size: 12, align: 'middle', multi: 'html' },
  /** Edge color (normal, highlight, hover) */
  COLOR: { color: '#848484', highlight: '#848484', hover: '#848484' },
}

// ===== GRAPH DIMENSIONS =====
export const DIMENSIONS = {
  /** Height calculation for graph container (CSS calc) */
  GRAPH_HEIGHT: 'calc(100dvh - 150px)',
  /** Height for zoom control slider */
  ZOOM_SLIDER_HEIGHT: 180,
}

// ===== STORAGE KEYS =====
export const STORAGE_KEYS = {
  /** Prefix for localStorage keys storing node positions */
  NODE_POSITIONS_PREFIX: 'graphNodePositions:',
}

// ===== IMAGE PATHS =====
export const IMAGES = {
  /** Icon for user address nodes */
  USER: '/img/user.png',
  /** Icon for smart contract nodes */
  CONTRACT: '/img/contract.png',
  /** Icon for faucet node */
  FAUCET: '/img/faucet.png',
}

// ===== DEFAULT TIMESCALES =====
export const TIMESCALES = {
  /** Default timescale filter in hours */
  DEFAULT: 24,
}

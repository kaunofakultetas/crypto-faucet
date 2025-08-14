# Graph Visualization Module

Interactive cryptocurrency transaction flow visualization using vis-network.

## Overview

This module provides a hierarchical graph visualization showing transaction flows from a faucet address. It features real-time updates, interactive controls, and persistent node positioning.

## Architecture

```
Graph/
├── Page.jsx                    # Main page component
├── components/
│   ├── index.js               # Component exports
│   ├── CryptoFlowGraph.jsx    # Main graph component
│   ├── ZoomControls.jsx       # Zoom control panel
│   ├── AddressDialog.jsx      # Address management dialog
│   └── useNodePositions.js    # Position persistence hook
├── constants.js               # Configuration constants
├── utils.js                   # Utility functions
├── index.js                   # Module exports
└── README.md                  # This file
```

## Key Features

### 🎯 Core Functionality
- **Hierarchical Layout**: Transactions displayed in a tree structure from faucet down
- **Real-time Updates**: Automatic refresh every 15 seconds
- **Interactive Navigation**: Double-click nodes to expand their transactions
- **Position Persistence**: Manual node arrangements saved across sessions

### 🎮 User Interactions
- **Zoom Controls**: Slider + buttons for precise zoom control
- **Right-click Menu**: Set custom names for addresses and copy to clipboard
- **Drag & Drop**: Manually position nodes, positions are automatically saved
- **Mouse Wheel**: Scroll to zoom with reduced sensitivity

### 💾 Data Management
- **localStorage Persistence**: Node positions saved per network
- **Efficient Updates**: Only updates changed data, preserves user's view
- **Error Handling**: Graceful fallbacks for API failures

## Technical Details

### Dependencies
- **vis-network**: Graph visualization engine
- **vis-data**: Data management for nodes/edges  
- **@mui/material**: UI components for controls and dialogs
- **React Router**: URL parameter handling

### Key Constants (constants.js)
- `ZOOM_CONFIG`: Zoom limits and sensitivity settings
- `LAYOUT_CONFIG`: Node spacing and hierarchy parameters
- `TIMING_CONFIG`: Update intervals and delays
- `NODE_CONFIG` & `EDGE_CONFIG`: Visual styling

### Utility Functions (utils.js)
- `timeSince()`: Human-readable time differences
- `formatAddress()`: Address truncation for display
- `parseTimestamp()`: Safe timestamp conversion
- `copyToClipboard()`: Clipboard operations

### Position Management
The `useNodePositions` hook manages:
- Loading/saving positions from localStorage
- Level-based horizontal spacing for new nodes
- Only X coordinates are persisted (Y handled by layout)

## Usage

```jsx
import { GraphPage } from './pages/Graph'

// Route: /graph/:network
<Route path="graph/:network" element={<GraphPage />} />
```

The component automatically:
1. Fetches the faucet address for the given network
2. Loads transaction data and builds the initial graph
3. Sets up periodic updates and event listeners
4. Restores any saved node positions

## Configuration

### Changing Update Frequency
```js
// In constants.js
TIMING_CONFIG.UPDATE_INTERVAL = 30000 // 30 seconds
```

### Adjusting Node Spacing
```js
// In constants.js
LAYOUT_CONFIG.NODE_SPACING = 300 // Wider spacing
```

### Modifying Zoom Limits
```js
// In constants.js
ZOOM_CONFIG.MIN_SCALE = 0.1 // Allow more zoom out
ZOOM_CONFIG.MAX_SCALE = 3.0 // Allow more zoom in
```

## Performance Notes

- **Stabilization Cycles**: Graph runs 3 update cycles on initialization for stability
- **Smart Contract Filtering**: Contracts are excluded from periodic updates (they don't initiate transactions)
- **Position Restoration**: Applied after each data update to maintain user arrangements
- **Camera Preservation**: Viewport position maintained during updates

## Future Enhancements

- [ ] Time range filtering controls
- [ ] Export/import node arrangements
- [ ] Transaction filtering by value/type
- [ ] Network comparison mode
- [ ] Performance metrics display

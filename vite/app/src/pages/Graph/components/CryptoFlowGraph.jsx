import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import Box from '@mui/material/Box';

// Components
import ZoomControls from './ZoomControls';
import AddressDialog from './AddressDialog';

// Hooks and utilities
import { useNodePositions } from './useNodePositions';
import { 
  timeSince, 
  filterTransactionsByTime, 
  parseTimestamp, 
  formatAddress, 
  formatTransactionLabel,
  extractNameFromLabel,
  preserveUpdatedSuffix,
  clamp 
} from '../utils';
import { 
  ZOOM_CONFIG, 
  LAYOUT_CONFIG, 
  TIMING_CONFIG, 
  NODE_CONFIG, 
  EDGE_CONFIG, 
  DIMENSIONS, 
  IMAGES, 
  TIMESCALES 
} from '../constants';

/**
 * CryptoFlowGraph - Interactive visualization of cryptocurrency transaction flows
 * 
 * This component renders a hierarchical graph showing transaction flows from a faucet address
 * using vis-network. Features include:
 * - Real-time transaction tracking and updates
 * - Interactive zoom controls
 * - Node position persistence across sessions
 * - Address naming and management
 * - Right-click context menu for node operations
 * 
 * @param {string} faucetAddress - The faucet address to center the graph around
 * @param {string} network - The blockchain network identifier
 * @returns {React.Component} The graph visualization component
 */
const CryptoFlowGraph = ({ faucetAddress, network }) => {
  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const nodes = useRef(new DataSet([])).current;
  const edges = useRef(new DataSet([])).current;
  const addressMap = useRef(new Map());
  const { positionsRef: nodePositions, save: savePositions, load: loadPositions, setLevelNextX } = useNodePositions(network);


  // ===== STATE MANAGEMENT =====
  /** Filter for transaction time window (hours) */
  const [timescale, setTimescale] = useState(TIMESCALES.DEFAULT);
  /** Current zoom scale of the graph */
  const [scale, setScale] = useState(1);
  
  // ===== DIALOG STATE =====
  /** Controls visibility of address naming dialog */
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  /** Currently selected address for naming */
  const [selectedAddress, setSelectedAddress] = useState(null);
  /** Temporary name being edited in dialog */
  const [tempName, setTempName] = useState('');
  /** Controls copy hint tooltip visibility */
  const [copyHintOpen, setCopyHintOpen] = useState(false);





  // ===== API FUNCTIONS =====
  /**
   * Fetches stored transactions for a specific address from the backend
   * @param {string} address - The address to fetch transactions for
   * @returns {Promise<Array>} Array of transaction objects or empty array on error
   */
  const fetchTransactions = async (address) => {
    try {
      const response = await fetch(`/api/evm/${network}/get-stored-transactions?address=${address}`);
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




  /**
   * Updates all user nodes in the graph with fresh transaction data
   * Skips smart contract nodes as they don't initiate transactions
   * Called periodically to keep the graph current
   */
  const updateAllNodes = async () => {
    const addressesToUpdate = nodes.map((node) => node.id);

    for (const address of addressesToUpdate) {
      const node = nodes.get(address);

      // Skip smart contract nodes - they don't initiate new transactions
      if (node && node.image === IMAGES.CONTRACT) {
        continue;
      }

      const newTransactions = await fetchTransactions(address);
      updateGraph(newTransactions, address);
    }
  };




  useEffect(() => {
    const initializeAndStabilizeGraph = async () => {
      await updateAllNodes();
      await new Promise(resolve => setTimeout(resolve, TIMING_CONFIG.STABILIZATION_DELAY));
      await updateAllNodes();
      await new Promise(resolve => setTimeout(resolve, TIMING_CONFIG.STABILIZATION_DELAY));
      await updateAllNodes();
    }
    
    fetchTransactions(faucetAddress).then(transactions => {
      const filteredTransactions = filterTransactionsByTime(transactions, timescale);
      createGraph(filteredTransactions);
      initializeAndStabilizeGraph();
    });



    const intervalId = setInterval(() => {
      updateAllNodes();
    }, TIMING_CONFIG.UPDATE_INTERVAL);

    return () => clearInterval(intervalId); // Cleanup on component unmount
  }, [faucetAddress, network, timescale]);




  /**
   * Gets the next horizontal position for a node at a given level
   * Ensures nodes don't overlap horizontally within the same level
   * @param {number} level - The hierarchy level
   * @returns {number} X coordinate for the next node at this level
   */
  const getNextHorizontalPosition = (level) => setLevelNextX(level);




  // ===== GRAPH BUILDING FUNCTIONS =====
  /**
   * Adds or updates nodes and edges based on transaction data
   * Handles both creation of new nodes and updating existing ones with fresh data
   * @param {Object} tx - Transaction object containing from/to addresses and metadata
   * @param {number} parentLevel - Hierarchy level of the parent node (default: 0)
   */
  const addNodeAndEdge = (tx, parentLevel = 0) => {
    const fromAddress = tx.from_address.toLowerCase();
    const fromName = tx.from_name ? `${tx.from_name}\n` : '';
    const toAddress = tx.to_address.toLowerCase();
    const toName = tx.to_name ? `${tx.to_name}\n` : '';
    const toAddressContract = parseInt(tx.to_addr_contract);

    // Parse timestamps safely using utility function
    const fromTimestampDate = parseTimestamp(tx.from_timestamp);
    const toTimestampDate = parseTimestamp(tx.to_timestamp);

    const fromLastUpdate = timeSince(fromTimestampDate);
    const toLastUpdate = timeSince(toTimestampDate);

    // Add or update fromAddress node
    let fromNode = nodes.get(fromAddress);
    if (fromNode) {
      const updatedLabel = `${fromName}${formatAddress(fromAddress)}\nUpdated: ${fromLastUpdate}`;
      if (fromNode.label !== updatedLabel) {
        nodes.update({ id: fromAddress, label: updatedLabel });
      }
    } else {
      const level = parentLevel + 1;
      const xPos = nodePositions.current.get(fromAddress) || getNextHorizontalPosition(level);
      fromNode = {
        id: fromAddress,
        label: `${fromName}${formatAddress(fromAddress)}\nUpdated: ${fromLastUpdate}`,
        shape: 'image',
        image: IMAGES.USER,
        size: NODE_CONFIG.USER_SIZE,
        x: xPos,
        level: level,
      };
      nodes.add(fromNode);
      addressMap.current.set(fromAddress, level);
      nodePositions.current.set(fromAddress, xPos);
    }

    // Add or update toAddress node
    let toNode = nodes.get(toAddress);
    if (toNode) {
      const updatedLabel = `${toName}${formatAddress(toAddress)}\nUpdated: ${toLastUpdate}`;
      if (toNode.label !== updatedLabel) {
        nodes.update({ id: toAddress, label: updatedLabel });
      }
    } else {
      const level = addressMap.current.get(fromAddress) + 1;
      const xPos = nodePositions.current.get(toAddress) || getNextHorizontalPosition(level);
      toNode = {
        id: toAddress,
        label: `${toName}${formatAddress(toAddress)}\nUpdated: ${toLastUpdate}`,
        shape: 'image',
        image: toAddressContract === 0 ? IMAGES.USER : IMAGES.CONTRACT,
        size: NODE_CONFIG.USER_SIZE,
        x: xPos,
        level: level,
      };
      nodes.add(toNode);
      addressMap.current.set(toAddress, level);
      nodePositions.current.set(toAddress, xPos);
    }

    // Add or update edge
    const edgeId = `${fromAddress}-${toAddress}`;
    const existingEdge = edges.get(edgeId);
    const updatedLabel = formatTransactionLabel(tx.value, tx.count);
    if (existingEdge) {
      if (existingEdge.label !== updatedLabel) {
        edges.update({ id: edgeId, label: updatedLabel });
      }
    } else {
              edges.add({
          id: edgeId,
          from: fromAddress,
          to: toAddress,
          arrows: 'to',
          label: updatedLabel,
          font: EDGE_CONFIG.FONT,
        });
    }
  };



  /**
   * Creates the initial graph structure with faucet node and transactions
   * Sets up the vis-network instance and applies saved positions
   * @param {Array} transactions - Array of initial transactions to display
   */
  const createGraph = (transactions) => {
    // Add faucet node as the root of the transaction tree
    if (!nodes.get(faucetAddress)) {
      nodes.add({
        id: faucetAddress,
        label: `${formatAddress(faucetAddress)}\nUpdated: Just now`,
        level: 0,
        shape: 'image',
        image: IMAGES.FAUCET,
        size: NODE_CONFIG.FAUCET_SIZE,
        x: 0,
      });
      addressMap.current.set(faucetAddress, 0);
      nodePositions.current.set(faucetAddress, 0);
    }

    transactions.forEach((tx) => {
      addNodeAndEdge(tx, 0);
    });

    const data = { nodes, edges };
    const options = {
      layout: {
        hierarchical: {
          direction: 'UD',
          sortMethod: 'hubsize',
          levelSeparation: LAYOUT_CONFIG.LEVEL_SEPARATION,
          nodeSpacing: LAYOUT_CONFIG.NODE_SPACING,
          treeSpacing: LAYOUT_CONFIG.TREE_SPACING,
          blockShifting: true,
          edgeMinimization: true,
        },
      },
      interaction: { 
        hover: true, 
        zoomView: true, 
        zoomSpeed: ZOOM_CONFIG.SCROLL_SENSITIVITY, 
        keyboard: true 
      },
      edges: {
        width: EDGE_CONFIG.WIDTH,
        smooth: EDGE_CONFIG.SMOOTH,
        font: { ...EDGE_CONFIG.FONT, multi: 'html' },
        color: EDGE_CONFIG.COLOR,
      },
      nodes: {
        font: NODE_CONFIG.FONT,
      },
      physics: false,
      minZoom: ZOOM_CONFIG.MIN_SCALE,
      maxZoom: ZOOM_CONFIG.MAX_SCALE,
    };

    if (containerRef.current) {
      networkRef.current = new Network(containerRef.current, data, options);
      try {
        setScale(networkRef.current.getScale() || 1);
      } catch (_) {}
      setupEventListeners();
      
      // Apply any persisted positions immediately after network init (like old implementation)
      nodePositions.current.forEach((x, nodeId) => {
        const node = nodes.get(nodeId);
        if (node && typeof x === 'number') {
          node.x = x;
          nodes.update(node);
        }
      });
    }
  };

  /**
   * Sets up all event listeners for the vis-network instance
   * Handles zoom changes, node interactions, and position tracking
   */
  const setupEventListeners = () => {
    networkRef.current.on('zoom', (params) => {
      if (typeof params?.scale === 'number') {
        const clamped = clamp(params.scale, ZOOM_CONFIG.MIN_SCALE, ZOOM_CONFIG.MAX_SCALE);
        setScale(clamped);
      }
    });
    networkRef.current.on('doubleClick', async (event) => {
      const { nodes: clickedNodes } = event;
      if (clickedNodes.length > 0) {
        const clickedNodeId = clickedNodes[0];
        const newTransactions = await fetchTransactions(clickedNodeId);
        updateGraph(newTransactions, clickedNodeId);
      }
    });

    networkRef.current.on('oncontext', (event) => {
      event.event.preventDefault();
      const { pointer } = event;
      const clickedNodeId = networkRef.current.getNodeAt(pointer.DOM);
              if (clickedNodeId) {
          setSelectedAddress(clickedNodeId);
          try {
            const node = nodes.get(clickedNodeId);
            const label = typeof node?.label === 'string' ? node.label : '';
            const extractedName = extractNameFromLabel(label);
            setTempName(extractedName);
          } catch (_) {
            setTempName('');
          }
          setNameDialogOpen(true);
        }
    });

    networkRef.current.on('dragEnd', (event) => {
      const { nodes: draggedNodes } = event;
      draggedNodes.forEach((nodeId) => {
        const position = networkRef.current.getPositions([nodeId]);
        if (position[nodeId]) {
          nodePositions.current.set(nodeId, position[nodeId].x); // Save the x-position only
        }
      });
      savePositions(); // Save to localStorage
    });
  };

  /**
   * Updates the graph with new transaction data while preserving user positions
   * Saves and restores camera position to maintain user's view context
   * @param {Array} newTransactions - Array of new transactions to add
   * @param {string} centralAddress - The address that initiated the update
   */
  const updateGraph = (newTransactions, centralAddress) => {
    // Save camera (viewport) position to restore after update
    const cameraPosition = networkRef.current.getViewPosition();
    const cameraScale = networkRef.current.getScale();

    const parentLevel = addressMap.current.get(centralAddress) || 0;
    newTransactions.forEach((tx) => addNodeAndEdge(tx, parentLevel));
    
    // Re-apply data so vis-network recomputes layout
    networkRef.current.setData({ nodes, edges });

    // Restore all saved positions (this is what makes positions persistent)
    nodePositions.current.forEach((x, nodeId) => {
      const node = nodes.get(nodeId);
      if (node && typeof x === 'number') {
        node.x = x;
        nodes.update(node);
      }
    });

    // Restore camera position so user doesn't lose their view
    networkRef.current.moveTo({
      position: { x: cameraPosition.x, y: cameraPosition.y },
      scale: cameraScale,
      offset: { x: 0, y: 0 },
      animation: false,
    });
  };



  const onTimescaleChange = (event) => {
    setTimescale(event.target.value);
  };



  // ===== ZOOM CONTROL FUNCTIONS =====
  /**
   * Sets the network scale/zoom level with bounds checking
   * @param {number} value - The desired zoom scale
   */
  const setNetworkScale = useCallback((value) => {
    const clamped = clamp(value, ZOOM_CONFIG.MIN_SCALE, ZOOM_CONFIG.MAX_SCALE);
    setScale(clamped);
    if (!networkRef.current) return;
    const pos = networkRef.current.getViewPosition();
    networkRef.current.moveTo({ position: pos, scale: clamped, animation: false });
  }, []);

  const handleScaleChange = useCallback((_, value) => {
    const next = Array.isArray(value) ? value[0] : value;
    setNetworkScale(next);
  }, [setNetworkScale]);

  /** Zoom in by one button step */
  const handleZoomIn = useCallback(() => {
    setNetworkScale(scale + ZOOM_CONFIG.BUTTON_STEP);
  }, [scale, setNetworkScale]);

  /** Zoom out by one button step */
  const handleZoomOut = useCallback(() => {
    setNetworkScale(scale - ZOOM_CONFIG.BUTTON_STEP);
  }, [scale, setNetworkScale]);

  // ===== RENDER =====
  return (
    <div>
      {/* Future: timescale controls could go here */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} />
      <Box sx={{ position: 'relative' }}>
        <div 
          ref={containerRef} 
          style={{ 
            height: DIMENSIONS.GRAPH_HEIGHT, 
            width: '100%', 
            border: '1px solid #ddd' 
          }} 
        />
        <ZoomControls
          scale={scale}
          min={ZOOM_CONFIG.MIN_SCALE}
          max={ZOOM_CONFIG.MAX_SCALE}
          step={ZOOM_CONFIG.SLIDER_STEP}
          onScaleChange={(v) => handleScaleChange(null, v)}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
      </Box>

      <AddressDialog
        open={nameDialogOpen}
        onClose={() => setNameDialogOpen(false)}
        name={tempName}
        setName={setTempName}
        address={selectedAddress}
        onSave={() => {
          if (!selectedAddress) return;
          const newName = (tempName || '').trim();
          if (newName) {
            // FIRST: Capture current position before any changes
            const currentPos = networkRef.current?.getPositions([selectedAddress])?.[selectedAddress];
            
            const node = nodes.get(selectedAddress);
            const label = typeof node?.label === 'string' ? node.label : '';
            const updatedSuffix = preserveUpdatedSuffix(label);
            
            // Update the backend
            fetch(`/api/evm/${network}/set-address-name?address=${selectedAddress}&name=${encodeURIComponent(newName)}`);
            
            // Simple approach: just update the label like the old implementation
            nodes.update({ 
              id: selectedAddress, 
              label: `${newName}\n${formatAddress(selectedAddress)}${updatedSuffix}`
            });
            
            // Save the current position if we have it
            if (currentPos && typeof currentPos.x === 'number') {
              nodePositions.current.set(selectedAddress, currentPos.x);
              savePositions();
            }
            
            // Trigger position restoration immediately (like updateGraph does)
            setTimeout(() => {
              nodePositions.current.forEach((x, nodeId) => {
                const node = nodes.get(nodeId);
                if (node && typeof x === 'number') {
                  node.x = x;
                  nodes.update(node);
                }
              });
            }, TIMING_CONFIG.POSITION_RESTORE_DELAY); // Small delay to let the label update settle
          }
          setNameDialogOpen(false);
        }}
      />
    </div>
  );
};

export default CryptoFlowGraph;

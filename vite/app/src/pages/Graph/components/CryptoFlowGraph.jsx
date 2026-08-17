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
//  This file is only the thin shell: the canvas div, the zoom
//  panel and the right-click naming dialog. All graph state
//  and logic live in useTransactionGraph.js (which pulls in
//  useNodePositions.js for the dragged-X persistence);
//  ZoomControls.jsx and AddressDialog.jsx render the chrome.
// -----------------------------------------------------------

import { useState } from 'react';

import Box from '@mui/material/Box';

import { ZOOM_CONFIG } from '../constants';
import useTransactionGraph from '../hooks/useTransactionGraph';
import ZoomControls from './ZoomControls';
import AddressDialog from './AddressDialog';







// -----------------------------------------------------------
// CryptoFlowGraph (default export)
// -----------------------------------------------------------
//
// Used by:
//   - Page.jsx — under the date slider bar
// -----------------------------------------------------------

export default function CryptoFlowGraph({ faucetAddress, network, dateRange, live, day, currencySymbol }) {

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
    currencySymbol,
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

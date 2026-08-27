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
//  panel, the right-click naming dialog and the notice shown
//  while the backend cannot be reached (an outage must not
//  look like a quiet day). All graph state and logic live in
//  useTransactionGraph.js (which pulls in useNodePositions.js
//  for the dragged-X persistence); ZoomControls.jsx and
//  AddressDialog.jsx render the chrome.
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

  // Right-click dialog: which address, the name draft, and
  // the save error that keeps the dialog open
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [tempName, setTempName] = useState('');
  const [saveError, setSaveError] = useState(null);

  const { containerRef, scale, setZoom, zoomIn, zoomOut, renameNode, failed } = useTransactionGraph({
    faucetAddress,
    network,
    dateRange,
    live,
    day,
    currencySymbol,
    onNodeRightClick: (address, currentName) => {
      setSelectedAddress(address);
      setTempName(currentName);
      setSaveError(null);
      setNameDialogOpen(true);
    },
  });


  const closeDialog = () => {
    setSaveError(null);
    setNameDialogOpen(false);
  };

  // The dialog closes only on a saved name — a lost write is
  // shown under the field, not swallowed
  const saveAddressName = async () => {
    const saved = await renameNode(selectedAddress, tempName);
    if (saved) {
      closeDialog();
    } else {
      setSaveError('Nepavyko išsaugoti pavadinimo. Bandykite dar kartą.');
    }
  };


  return (
    // flex-1 + min-h-0: the canvas fills whatever height the
    // page's flex column has left after the date bar — sizing
    // lives in the parent, not in a hardcoded calc here. The
    // canvas box is positioned ABSOLUTELY inside that area: a
    // flex-grown height is not "definite" for a percentage
    // child (height: 100% collapsed to nothing), while inset: 0
    // takes the laid-out size as is.
    <div className="relative min-h-0 flex-1">
      {/* The graph canvas with the zoom panel floating on top */}
      <Box sx={{ position: 'absolute', inset: 0 }}>
        <div
          ref={containerRef}
          style={{ height: '100%', width: '100%', border: '1px solid #ddd' }}
        />

        {/* Outage notice — the last fetch failed; the canvas keeps
            showing what was fetched before it */}
        {failed && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-red-200 bg-red-50 px-3 py-1 text-sm text-red-700">
            Nepavyko atnaujinti grafiko — rodomi paskutiniai gauti duomenys
          </div>
        )}

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
        onClose={closeDialog}
        name={tempName}
        setName={setTempName}
        address={selectedAddress}
        error={saveError}
        onSave={saveAddressName}
      />
    </div>
  );
}

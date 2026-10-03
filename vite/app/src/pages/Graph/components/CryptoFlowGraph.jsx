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
//  panel, the right-click naming dialog, the notices that say
//  what went wrong — the backend could not be reached or the
//  drawing failed (an outage must not look like a quiet day),
//  the backend could not refresh its transactions from
//  Etherscan — and the TEXT ALTERNATIVE: the canvas is named
//  as an image with the day and how many transfers it draws,
//  the noun agreeing with that count the Lithuanian way, and
//  a visually hidden table lists every drawn transfer (from,
//  to, amount, count), so a screen-reader user gets the same
//  facts the picture shows. All graph state and logic live in
//  useTransactionGraph.js (which pulls in useNodePositions.js
//  for the dragged-X persistence) — the notices' sentences
//  too; ZoomControls.jsx and AddressDialog.jsx render the
//  chrome.
//
//  Split into (root component last):
//
//    TRANSFERS       — the canvas's count noun
//    SAVE_FAILED     — a failed name save's own sentence
//    NOTICE_CLASSES  — the red notice box
//    GraphNotices    — the notices over the canvas
//    CryptoFlowGraph — the shell (default export)
// -----------------------------------------------------------

import { useState } from 'react';

import Box from '@mui/material/Box';

import { pluralForm } from '@/utils/plural';
import { requestErrorText } from '@/utils/requestError';

import { ZOOM_CONFIG } from '../constants';
import useTransactionGraph from '../hooks/useTransactionGraph';
import ZoomControls from './ZoomControls';
import AddressDialog from './AddressDialog';


// The canvas's count noun in its Lithuanian forms, for the
// plural categories utils/plural.js sorts a count into
const TRANSFERS = { one: 'pervedimas', few: 'pervedimai', other: 'pervedimų' };

// What a failed name save says when the backend gave no
// sentence of its own — requestErrorText adds the reason
const SAVE_FAILED = 'Nepavyko išsaugoti pavadinimo.';

// One red box per notice, the look the outage notice always
// had
const NOTICE_CLASSES = 'rounded-md border border-red-200 bg-red-50 px-3 py-1 text-center text-sm text-red-700';







// -----------------------------------------------------------
// GraphNotices
// -----------------------------------------------------------
//
// The notices floating over the top of the canvas, one under
// the other: the outage one while the last fetch or drawing
// failed, and the backend's word on a failed Etherscan
// refresh while one stands. Both sentences come whole from
// the hook; nothing renders while both are quiet. The column
// stays clear of the zoom panel in the top-right corner, and
// clicks pass through it to the graph.
//
// Used by:
//   - CryptoFlowGraph (below)
// -----------------------------------------------------------

function GraphNotices({ failure, refreshError }) {

  if (!failure && !refreshError) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 flex w-max max-w-[calc(100%-8rem)] -translate-x-1/2 flex-col items-center gap-1">
      {failure && <p className={NOTICE_CLASSES}>{failure}</p>}
      {refreshError && <p className={NOTICE_CLASSES}>{refreshError}</p>}
    </div>
  );
}







// -----------------------------------------------------------
// CryptoFlowGraph (default export)
// -----------------------------------------------------------
//
// The shell around the canvas: it holds the right-click
// dialog's state and wires the hook's graph to the zoom
// panel, the dialog, the notices and the text alternative.
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

  const { containerRef, scale, setZoom, zoomIn, zoomOut, renameNode, failure, refreshError, rows } = useTransactionGraph({
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
  // shown under the field, not swallowed: the backend's own
  // sentence, or the reason the request failed
  const saveAddressName = async () => {
    try {
      await renameNode(selectedAddress, tempName);
      closeDialog();
    } catch (error) {
      console.error('Rename failed:', error);
      setSaveError(requestErrorText(error, SAVE_FAILED));
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
          role="img"
          aria-label={`Transakcijų srauto grafikas, ${day}: ${rows.length} ${pluralForm(rows.length, TRANSFERS)}`}
          aria-describedby="graph-table"
          style={{ height: '100%', width: '100%', border: '1px solid #ddd' }}
        />

        {/* The same transfers as text — what the canvas draws.
            Hidden by a wrapper div, never on the table itself: a
            table ignores sr-only's 1px size and, invisible, would
            stretch the page sideways on a narrow screen */}
        <div className="sr-only">
          <table id="graph-table">
            <caption>Pervedimai {day} dieną</caption>
            <thead>
              <tr><th>Iš</th><th>Į</th><th>Suma ir transakcijų skaičius</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}><td>{row.from}</td><td>{row.to}</td><td>{row.label}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* What went wrong — the canvas keeps showing what was
            drawn before it */}
        <GraphNotices failure={failure} refreshError={refreshError} />

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

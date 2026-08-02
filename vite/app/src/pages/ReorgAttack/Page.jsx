// -----------------------------------------------------------
//  [*] Pages — 51% Attack Tool (route /reorgattack)
//
//  The teaching tool for chain reorganizations: two KNF Coin
//  full nodes, one public and one private. Detaching the
//  private node lets it mine a secret fork; re-attaching it
//  publishes that fork, and whichever branch accumulated more
//  work wins — the double-spend the students came to see.
//
//  The page is a thin shell: useReorgAttack holds every query
//  and mutation, ControlPanel owns its own form state, and
//  ReactFlowBlockchain draws the two chains.
//
//  The <Toaster> that the hook's action toasts land in is
//  mounted HERE rather than in the app shell — this is the
//  only page in the faucet that reports outcomes as toasts;
//  the faucet pages use their own inline FadingAlert rows.
//
//  Split into (root component last):
//
//    PANEL_WIDTH   — the side panel's width, also the page's
//                    padding when it is open
//    StatusHeader  — title + both chain tip heights
//    LoadingState  — spinner while the first poll lands
//    ErrorState    — the backend is unreachable
//    ReorgAttackPage — layout + wiring (default export)
// -----------------------------------------------------------

import { useState } from 'react';
import { Toaster } from 'react-hot-toast';

import { Box, Typography, CircularProgress, Alert } from '@mui/material';

import useReorgAttack from './useReorgAttack';
import ControlPanel from './components/ControlPanel';
import ToggleButton from './components/ToggleButton';
import ReactFlowBlockchain from './components/ReactFlowBlockchain';


// The sliding panel's width — the page pads itself by the
// same amount while the panel is open, so the diagram is
// never hidden underneath it
const PANEL_WIDTH = 350;







// -----------------------------------------------------------
// StatusHeader
// -----------------------------------------------------------
//
// The page title with both chains' current tip heights — the
// scoreboard of the attack: once the private height passes
// the public one, the fork is ready to win.
//
// Used by:
//   - ReorgAttackPage (below)
// -----------------------------------------------------------

function StatusHeader({ networkStatus }) {
  return (
    <Box sx={{ position: 'relative', mb: 1 }}>
      <Typography variant="h5" sx={{ textAlign: 'center', fontWeight: 'bold' }}>
        51% Atakos Įrankis
      </Typography>

      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1, gap: 2 }}>
        {networkStatus.publicTip && (
          <Typography variant="body2" className="bg-green-700 p-1 px-2 rounded-md text-white">
            Viešas: {networkStatus.publicTip.height ?? 'N/A'}
          </Typography>
        )}

        {networkStatus.privateTip && (
          <Typography variant="body2" className="bg-red-700 p-1 px-2 rounded-md text-white">
            Privatus: {networkStatus.privateTip.height ?? 'N/A'}
          </Typography>
        )}
      </Box>
    </Box>
  );
}







// -----------------------------------------------------------
// LoadingState
// -----------------------------------------------------------
//
// Used by:
//   - ReorgAttackPage (below) — until the first poll lands
// -----------------------------------------------------------

function LoadingState() {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '50vh',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <CircularProgress size={60} />
      <Typography variant="h6" color="text.secondary">
        Kraunami blokų grandinės duomenys…
      </Typography>
    </Box>
  );
}







// -----------------------------------------------------------
// ErrorState
// -----------------------------------------------------------
//
// Used by:
//   - ReorgAttackPage (below) — when the backend is
//     unreachable and there is nothing cached to draw
// -----------------------------------------------------------

function ErrorState({ message }) {
  return (
    <Box sx={{ p: 2 }}>
      <Alert severity="error" sx={{ mb: 2 }}>
        Nepavyko užkrauti blokų grandinės duomenų: {message}
      </Alert>
      <Typography variant="body1">
        Patikrinkite ryšį ir bandykite perkrauti puslapį.
      </Typography>
    </Box>
  );
}







// -----------------------------------------------------------
// ReorgAttackPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - main.jsx — route /reorgattack
// -----------------------------------------------------------

export default function ReorgAttackPage() {

  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const {
    chainBlocks, chainTips, transactions,
    networkStatus, isConnectedToPublic,
    isPending, isError, error,
    toggleConnection, sendRawTransaction,
    addTransaction, removeTransaction, isMutating,
  } = useReorgAttack();


  if (isPending) {
    return <LoadingState />;
  }

  if (isError && chainBlocks.length === 0) {
    return <ErrorState message={error?.message} />;
  }


  return (
    <Box
      sx={{
        p: 2,
        position: 'relative',
        paddingRight: isPanelOpen ? `${PANEL_WIDTH + 20}px` : 2,
        transition: 'padding-right 0.3s ease-in-out',
      }}
    >
      {/* Where every action's toast lands */}
      <Toaster
        position="top-center"
        containerStyle={{ top: 20 }}
        toastOptions={{ style: { textAlign: 'center' } }}
      />

      <ControlPanel
        isPanelOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        panelWidth={PANEL_WIDTH}
        isConnectedToPublic={isConnectedToPublic}
        onConnectionToggle={toggleConnection}
        onSendRawTransaction={sendRawTransaction}
        transactions={transactions}
        onAddTransaction={addTransaction}
        onRemoveTransaction={removeTransaction}
        networkStatus={networkStatus}
        busy={isMutating}
      />

      <ToggleButton isPanelOpen={isPanelOpen} onToggle={() => setIsPanelOpen(!isPanelOpen)} />

      <StatusHeader networkStatus={networkStatus} />

      <ReactFlowBlockchain
        chainBlocks={chainBlocks}
        chainTips={chainTips}
        transactions={transactions}
      />
    </Box>
  );
}

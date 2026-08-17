// -----------------------------------------------------------
//  [*] App — providers, page shell and routing
//
//  The root of the React app: the MUI style/theme stack, the
//  Navbar/Footer shell and every route. Route groups:
//    - faucets  — /faucet/evm/:network (native coins),
//                 /faucet/erc20/:token (tokens, one page per
//                 token across every chain it lives on),
//                 /faucet/utxo/:network
//    - graph    — /graph/:network (transaction flow)
//    - teaching — /sha256 (simulator), /videos
//    - dapps    — /dapps-server launcher
//  "/" redirects into the first faucet family that has
//  entries configured, EVM preferred — a family the operator
//  disabled (empty map in _CONFIG/coins.py) is skipped, the
//  same way the navbar hides it.
//
//  Split into (root component last):
//
//    DynamicDefaultRedirect — "/" → the right faucet
//    App                    — providers + shell + routes
//                             (default export)
// -----------------------------------------------------------

import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';

import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { StyledEngineProvider } from '@mui/material/styles';
import theme from '@/theme';

import Navbar, { FAUCET_TYPES, useFaucetCatalogs, faucetTargetFor } from '@/components/Navbar';
import Footer from '@/components/Footer';

// Pages
import FaucetEVM from '@/pages/Faucet_EVM/Page';
import FaucetERC20 from '@/pages/Faucet_ERC20/Page';
import FaucetSVM from '@/pages/Faucet_SVM/Page';
import FaucetUTXO from '@/pages/Faucet_UTXO/Page';
import GraphPage from '@/pages/Graph/Page';
import BlockchainSimulatorPage from '@/pages/BlockchainSimulator/Page';
import DappsServerPage from '@/pages/DappsServer/Page';
import VideosPage from '@/pages/Videos/Page';







// -----------------------------------------------------------
// DynamicDefaultRedirect
// -----------------------------------------------------------
//
// Sends "/" into the first faucet family that actually has
// entries — EVM first (the classroom default), then the rest
// in navbar order. Within the family the target is
// faucetTargetFor's pick: last used → backend default → first
// entry. Renders nothing while the catalog request is in
// flight, and nothing at all when no family is configured
// (the navbar's teaching pages still work). The catalog query
// shares its cache key with the navbar — one fetch serves
// both.
//
// Used by:
//   - App (below) — the index route
// -----------------------------------------------------------

function DynamicDefaultRedirect() {

  const { loading, families } = useFaucetCatalogs();

  // Decide on data, never on an unfinished fetch
  if (loading) return null;

  // EVM keeps its historical priority for "/"; the rest
  // follow in navbar order
  const order = [
    ...FAUCET_TYPES.filter((t) => t.key === 'evm'),
    ...FAUCET_TYPES.filter((t) => t.key !== 'evm'),
  ];

  for (const type of order) {
    const target = faucetTargetFor(families[type.key], type.key);
    if (target) return <Navigate to={`/faucet/${type.key}/${target}`} />;
  }

  return null;
}







// -----------------------------------------------------------
// App (default export)
// -----------------------------------------------------------
//
// The provider stack (style engine → theme → router) around
// the fixed shell: Navbar on top, the routed page in the grey
// middle, Footer at the bottom.
//
// Used by:
//   - main.jsx — mounted into #root
// -----------------------------------------------------------

export default function App() {
  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <Navbar />

          <Box className="bg-gray-100" style={{ minHeight: 'calc(100vh - 105px)' }}>
            <Routes>

              {/* "/" → the default EVM faucet */}
              <Route index element={<DynamicDefaultRedirect />} />

              {/* Faucets — native EVM coins, ERC-20 tokens, UTXO chains */}
              <Route path="faucet">
                <Route path="evm">
                  <Route path=":network" element={<FaucetEVM />} />
                </Route>
                <Route path="svm">
                  <Route path=":network" element={<FaucetSVM />} />
                </Route>
                {/* keyed by TOKEN — the token spans many chains */}
                <Route path="erc20">
                  <Route path=":token" element={<FaucetERC20 />} />
                </Route>
                <Route path="utxo">
                  <Route path=":network" element={<FaucetUTXO />} />
                </Route>
              </Route>

              {/* Transaction graph */}
              <Route path="graph">
                <Route path=":network" element={<GraphPage />} />
              </Route>

              {/* Teaching pages */}
              <Route path="sha256" element={<BlockchainSimulatorPage />} />
              <Route path="videos" element={<VideosPage />} />

              {/* Dapps server launcher */}
              <Route path="dapps-server" element={<DappsServerPage />} />

            </Routes>
          </Box>

          <Footer />
        </Router>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

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
//    - teaching — /sha256 (simulator), /reorgattack, /videos
//    - dapps    — /dapps-server launcher
//  "/" redirects into the last used (or default) EVM faucet.
//
//  Split into (root component last):
//
//    DynamicDefaultRedirect — "/" → the right faucet
//    App                    — providers + shell + routes
//                             (default export)
// -----------------------------------------------------------

import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { StyledEngineProvider } from '@mui/material/styles';
import theme from './theme';

import Navbar from './components/Navbar';
import Footer from './components/Footer';

// Pages
import FaucetEVM from './pages/Faucet_EVM/Page';
import FaucetERC20 from './pages/Faucet_ERC20/Page';
import FaucetUTXO from './pages/Faucet_UTXO/Page';
import GraphPage from './pages/Graph/Page';
import BlockchainSimulatorPage from './pages/BlockchainSimulator/Page';
import DappsServerPage from './pages/DappsServer/Page';
import ReorgAttackPage from './pages/ReorgAttack/Page';
import VideosPage from './pages/Videos/Page';







// -----------------------------------------------------------
// DynamicDefaultRedirect
// -----------------------------------------------------------
//
// Sends "/" to the native EVM faucet: the network the student
// used last (lastPick:evm — the key FaucetPicker saves), then
// the backend's default_network, then sepolia when even that
// fails. Renders nothing while deciding. The networks query
// shares its cache key with the navbar's EVM catalog — one
// fetch serves both.
//
// Used by:
//   - App (below) — the index route
// -----------------------------------------------------------

function DynamicDefaultRedirect() {

  let saved = null;
  try {
    saved = localStorage.getItem('lastPick:evm');
  } catch (_) {}

  const { data, isError } = useQuery({
    queryKey: ['evm-networks'],
    queryFn: async () => (await axios.get('/api/evm/networks')).data,
    staleTime: 5 * 60 * 1000,
    enabled: !saved,
  });

  if (saved) return <Navigate to={`/faucet/evm/${saved}`} />;
  if (isError) return <Navigate to="/faucet/evm/sepolia" />;
  if (data) return <Navigate to={`/faucet/evm/${data.default_network || 'sepolia'}`} />;
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
              <Route path="reorgattack" element={<ReorgAttackPage />} />
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

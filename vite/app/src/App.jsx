// -----------------------------------------------------------
//  [*] App — providers, page shell and routing
//
//  The root of the React app: the MUI style/theme stack, the
//  Navbar/Footer shell and every route. Route groups:
//    - faucets  — /faucet/evm/:network, /faucet/utxo/:network
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

import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import axios from 'axios';

import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { StyledEngineProvider } from '@mui/material/styles';
import theme from './theme';

import Navbar from './components/Navbar';
import Footer from './components/Footer';

// Pages
import FaucetEVM from './pages/Faucet_EVM/Page';
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
// Sends "/" to an EVM faucet: the network the student used
// last (lastNetwork:evm — the key NetworkPicker saves), then
// the backend's default_network, then sepolia when even that
// fails. Renders nothing while deciding.
//
// Used by:
//   - App (below) — the index route
// -----------------------------------------------------------

function DynamicDefaultRedirect() {

  const [target, setTarget] = useState(null);

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      try {
        const saved = localStorage.getItem('lastNetwork:evm');
        if (!ignore && saved) {
          setTarget(`/faucet/evm/${saved}`);
          return;
        }
        const { data } = await axios.get('/api/evm/networks');
        const def = data?.default_network;
        if (!ignore && def) setTarget(`/faucet/evm/${def}`);
      } catch (_) {
        if (!ignore) setTarget('/faucet/evm/sepolia');
      }
    };

    load();
    return () => { ignore = true; };
  }, []);

  if (!target) return null;
  return <Navigate to={target} />;
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

              {/* Faucets */}
              <Route path="faucet">
                <Route path="evm">
                  <Route path=":network" element={<FaucetEVM />} />
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

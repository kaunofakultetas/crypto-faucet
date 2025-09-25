import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

import { BrowserRouter as Router, Route, Routes, Link, Navigate } from 'react-router-dom';
import axios from 'axios'

import { ThemeProvider, CssBaseline, Box } from '@mui/material'
import { StyledEngineProvider } from '@mui/material/styles'
import theme from './theme'



import Navbar from './components/Navbar';
import Footer from './components/Footer';


import FaucetEVM from './pages/Faucet_EVM/Page';
import FaucetUTXO from './pages/Faucet_UTXO/Page';
import GraphPage from './pages/Graph/Page';




import BlockchainSimulatorPage from './pages/BlockchainSimulator/Page';
import DappsServerPage from './pages/DappsServer/Page';
import ReorgAttackPage from './pages/ReorgAttack/Page';
import VideosPage from './pages/Videos/Page';


function DynamicDefaultRedirect() {
  const [target, setTarget] = React.useState(null)

  React.useEffect(() => {
    let ignore = false
    const load = async () => {
      try {
        const saved = localStorage.getItem('lastNetwork')
        if (!ignore && saved) {
          setTarget(`/faucet/evm/${saved}`)
          return
        }
        const { data } = await axios.get('/api/evm/networks')
        const def = data?.default_network
        if (!ignore && def) setTarget(`/faucet/evm/${def}`)
      } catch (_) {
        if (!ignore) setTarget('/faucet/evm/sepolia')
      }
    }
    load()
    return () => { ignore = true }
  }, [])

  if (!target) return null
  return <Navigate to={target} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <Navbar />
          <Box className="bg-gray-100" style={{ minHeight: 'calc(100vh - 105px)' }}>
            <Routes>

              {/* Faucet Routes */}
              <Route index element={<DynamicDefaultRedirect />} />
              <Route path="faucet">
                <Route path="evm">
                  <Route path=":network" element={<FaucetEVM />} />
                </Route>
                <Route path="utxo">
                  <Route path=":network" element={<FaucetUTXO />} />
                </Route>
              </Route>

              {/* Graph explorer */}
              <Route path="graph">
                <Route path=":network" element={<GraphPage />} />
              </Route>

              {/* Blockchain Simulator */}
              <Route path="sha256" element={<BlockchainSimulatorPage />} />

              {/* Dapps Server Routes */}
              <Route path="dapps-server" element={<DappsServerPage />} />

              {/* 51% Attack Routes */}
              <Route path="reorgattack" element={<ReorgAttackPage />} />

              {/* Videos Page */}
              <Route path="videos" element={<VideosPage />} />

            </Routes>
          </Box>
          <Footer />
        </Router>
      </ThemeProvider>
    </StyledEngineProvider>
  </StrictMode>,
)

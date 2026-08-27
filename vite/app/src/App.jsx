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
//  same way the navbar hides it. A catalog that could not be
//  fetched at all is a different thing and says so. Unmatched
//  URLs (a typo, a stale bookmark, a family path with no
//  key) land on the not-found page; a render-time throw in
//  the navbar or a page is caught by an ErrorBoundary instead
//  of blanking the whole app.
//
//  The shell is a flex column the height of the viewport —
//  navbar, the routed page (flex: 1), footer — so no page
//  has to know the chrome's height.
//
//  Split into (root component last):
//
//    DynamicDefaultRedirect — "/" → the right faucet
//    CatalogUnavailable     — "/" when the catalog failed
//    PageArea               — the routes, inside a boundary
//    App                    — providers + shell + routes
//                             (default export)
// -----------------------------------------------------------

import { BrowserRouter as Router, Route, Routes, Navigate, Link, useLocation } from 'react-router-dom';

import { ThemeProvider, CssBaseline, Box, Button } from '@mui/material';
import { StyledEngineProvider } from '@mui/material/styles';
import theme from '@/theme';

import Navbar, { FAUCET_TYPES, useFaucetCatalogs, faucetTargetFor } from '@/components/Navbar';
import Footer from '@/components/Footer';
import ErrorBoundary from '@/components/ErrorBoundary';

// Pages
import FaucetEVM from '@/pages/Faucet_EVM/Page';
import FaucetERC20 from '@/pages/Faucet_ERC20/Page';
import FaucetSVM from '@/pages/Faucet_SVM/Page';
import FaucetMOVE from '@/pages/Faucet_MOVE/Page';
import FaucetUTXO from '@/pages/Faucet_UTXO/Page';
import GraphPage from '@/pages/Graph/Page';
import BlockchainSimulatorPage from '@/pages/BlockchainSimulator/Page';
import DappsServerPage from '@/pages/DappsServer/Page';
import VideosPage from '@/pages/Videos/Page';
import NotFoundPage from '@/pages/NotFound/Page';







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

  const { loading, failed, refetch, families } = useFaucetCatalogs();

  // Decide on data, never on an unfinished fetch
  if (loading) return null;

  // EVM keeps its historical priority for "/"; the rest
  // follow in navbar order
  const order = [
    ...FAUCET_TYPES.filter((t) => t.key === 'evm'),
    ...FAUCET_TYPES.filter((t) => t.key !== 'evm'),
  ];

  // A redirect is never a destination the student chose —
  // replace, or Back would bounce them straight back here
  for (const type of order) {
    const target = faucetTargetFor(families[type.key], type.key);
    if (target) return <Navigate to={`/faucet/${type.key}/${target}`} replace />;
  }

  if (failed) return <CatalogUnavailable onRetry={refetch} />;

  return null;
}







// -----------------------------------------------------------
// CatalogUnavailable
// -----------------------------------------------------------
//
// "/" when the catalog request failed and nothing is cached:
// a blank grey page looked like "every family disabled". The
// teaching pages work without the backend, so they are
// offered alongside the retry.
//
// Used by:
//   - DynamicDefaultRedirect (above)
// -----------------------------------------------------------

function CatalogUnavailable({ onRetry }) {
  return (
    <Box className="p-4">
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4 text-center">
        <p className="mb-3 text-red-600">Faucet&apos;ų sąrašas nepasiekiamas. Serveris gali būti perkraunamas.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="contained" onClick={() => onRetry()}>Bandyti dar kartą</Button>
          <Button component={Link} to="/sha256" variant="outlined">Blokų grandinės simuliatorius</Button>
          <Button component={Link} to="/videos" variant="outlined">Vaizdo įrašai</Button>
        </div>
      </div>
    </Box>
  );
}







// -----------------------------------------------------------
// PageArea
// -----------------------------------------------------------
//
// The routed page inside its own ErrorBoundary, reset on
// every route change so navigating away from a page that
// threw recovers. Family groups get an index redirect, so a
// truncated /faucet/evm lands on "/" instead of an empty
// outlet; everything unmatched is the not-found page.
//
// Used by:
//   - App (below)
// -----------------------------------------------------------

function PageArea() {

  const location = useLocation();

  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Routes>

        {/* "/" → the default EVM faucet */}
        <Route index element={<DynamicDefaultRedirect />} />

        {/* Faucets — native EVM coins, ERC-20 tokens, UTXO chains */}
        <Route path="faucet">
          <Route index element={<Navigate to="/" replace />} />
          <Route path="evm">
            <Route index element={<Navigate to="/" replace />} />
            <Route path=":network" element={<FaucetEVM />} />
          </Route>
          <Route path="svm">
            <Route index element={<Navigate to="/" replace />} />
            <Route path=":network" element={<FaucetSVM />} />
          </Route>
          <Route path="move">
            <Route index element={<Navigate to="/" replace />} />
            <Route path=":network" element={<FaucetMOVE />} />
          </Route>
          {/* keyed by TOKEN — the token spans many chains */}
          <Route path="erc20">
            <Route index element={<Navigate to="/" replace />} />
            <Route path=":token" element={<FaucetERC20 />} />
          </Route>
          <Route path="utxo">
            <Route index element={<Navigate to="/" replace />} />
            <Route path=":network" element={<FaucetUTXO />} />
          </Route>
        </Route>

        {/* Transaction graph */}
        <Route path="graph">
          <Route index element={<Navigate to="/" replace />} />
          <Route path=":network" element={<GraphPage />} />
        </Route>

        {/* Teaching pages */}
        <Route path="sha256" element={<BlockchainSimulatorPage />} />
        <Route path="videos" element={<VideosPage />} />

        {/* Dapps server launcher */}
        <Route path="dapps-server" element={<DappsServerPage />} />

        {/* Everything else */}
        <Route path="*" element={<NotFoundPage />} />

      </Routes>
    </ErrorBoundary>
  );
}







// -----------------------------------------------------------
// App (default export)
// -----------------------------------------------------------
//
// The provider stack (style engine → theme → router) around
// the shell: a viewport-high flex column — Navbar on top,
// the routed page in the grey middle taking the rest, Footer
// at the bottom. No magic chrome height anywhere: the navbar
// may wrap on a narrow window and the page still fits.
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
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>

            <ErrorBoundary>
              <Navbar />
            </ErrorBoundary>

            <Box className="bg-gray-100" sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <PageArea />
            </Box>

            <Footer />

          </Box>
        </Router>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

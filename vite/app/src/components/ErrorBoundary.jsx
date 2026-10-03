// -----------------------------------------------------------
//  [*] ErrorBoundary — the last line before a white screen
//
//  A render-time throw anywhere below an unguarded root
//  unmounts the whole app: no navbar, no message. This
//  boundary catches it and shows a card that says so, with
//  two ways out — reload, or clear the SPA's cached data and
//  reload, for the case where the throw comes from a stale
//  localStorage payload that every reload would replay.
//  `resetKey` (the route, for the page boundary) clears the
//  error when it changes, so navigating away recovers.
//
//  A class on purpose: React has no hook for
//  componentDidCatch.
//
//  Split into (root component last):
//
//    clearCachedData — forgets everything the SPA persisted
//    ErrorBoundary   — the guard and its card (default export)
//
//  Used by:
//    - App.jsx — around the Navbar and around the routes
// -----------------------------------------------------------

import { Component } from 'react';

import { Box, Button } from '@mui/material';


// Everything the SPA persists — cleared by the "clear cache"
// button, since any of it could be the stale payload that
// keeps throwing. A new localStorage key belongs here too:
// tests/core/structural.test.js compares this list with every
// key the code writes
const CACHE_KEY_PREFIXES = ['catalog:', 'lastPick:', 'favFaucetPicks', 'graphNodePositions:', 'utxo-graph-positions:'];







// -----------------------------------------------------------
// clearCachedData
// -----------------------------------------------------------
//
// Removes every key the SPA persisted, so a stale payload
// that throws on every reload is gone before the next one.
// Storage the browser blocks holds nothing to clear, so its
// refusal is swallowed rather than thrown from inside the
// error card itself.
//
// Used by:
//   - ErrorBoundary (below) — the clear-cache button
// -----------------------------------------------------------

const clearCachedData = () => {
  try {
    Object.keys(localStorage)
      .filter((key) => CACHE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => localStorage.removeItem(key));
  } catch { /* blocked storage — nothing to clear */ }
};







// -----------------------------------------------------------
// ErrorBoundary (default export)
// -----------------------------------------------------------
//
// Guards one region of the shell: a throw below it is logged
// and replaced by the card; a change of the region's reset
// key — the page area passes the route — forgets the error,
// so moving to another page recovers without a reload.
//
// Used by:
//   - App.jsx — PageArea (the routes, reset by the route) and
//     App (the Navbar)
// -----------------------------------------------------------

export default class ErrorBoundary extends Component {

  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render failed:', error, info?.componentStack);
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Box className="p-4">
        <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4 text-center">
          <p className="mb-3 text-red-600">Puslapio nepavyko atvaizduoti.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="contained" onClick={() => window.location.reload()}>
              Perkrauti
            </Button>
            <Button variant="outlined" onClick={() => { clearCachedData(); window.location.reload(); }}>
              Išvalyti įsimintus duomenis ir perkrauti
            </Button>
          </div>
        </div>
      </Box>
    );
  }
}

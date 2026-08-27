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
//  Used by:
//    - App.jsx — around the Navbar and around the routes
// -----------------------------------------------------------

import { Component } from 'react';

import { Box, Button } from '@mui/material';


// Everything the SPA persists — cleared by the "clear cache"
// button, since any of it could be the stale payload that
// keeps throwing
const CACHE_KEY_PREFIXES = ['catalog:', 'lastPick:', 'favFaucetPicks', 'graphNodePositions:'];

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
//   <ErrorBoundary resetKey={location.pathname}>…</ErrorBoundary>
//
// Used by:
//   - App.jsx — the page shell
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

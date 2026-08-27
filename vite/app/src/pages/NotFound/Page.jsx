// -----------------------------------------------------------
//  [*] Pages — Not Found (every unmatched route)
//
//  The catch-all: a mistyped URL, a stale bookmark or a
//  truncated faucet path (/faucet/evm with no network) used
//  to render an empty grey page under a fully dressed navbar.
//  This says what happened and offers the way back.
// -----------------------------------------------------------

import { Link } from 'react-router-dom';

import { Box, Button } from '@mui/material';







// -----------------------------------------------------------
// NotFoundPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - App.jsx — route "*"
// -----------------------------------------------------------

export default function NotFoundPage() {
  return (
    <Box className="p-4">
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4 text-center">
        <p className="mb-1 text-[45px] font-bold text-[#78003F]">404</p>
        <p className="mb-3 text-gray-700">Tokio puslapio nėra.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button component={Link} to="/" variant="contained">Į faucet&apos;ą</Button>
          <Button component={Link} to="/sha256" variant="outlined">Blokų grandinės simuliatorius</Button>
          <Button component={Link} to="/videos" variant="outlined">Vaizdo įrašai</Button>
        </div>
      </div>
    </Box>
  );
}

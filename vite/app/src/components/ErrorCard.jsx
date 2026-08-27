// -----------------------------------------------------------
//  [*] ErrorCard — the red card a page falls back to
//
//  Shown INSTEAD of a faucet page when there is nothing to
//  render around: the catalog fetch failed, the :network or
//  :token in the URL is unknown to the backend, a token query
//  never got an answer. One card markup for every page, so a
//  failure reads the same everywhere. A page that already
//  HAS data never comes here — a failed background poll keeps
//  the last good payload on screen instead.
//
//  Used by:
//    - pages/Faucet_EVM/Page.jsx, Faucet_SVM/Page.jsx,
//      Faucet_MOVE/Page.jsx, Faucet_UTXO/Page.jsx — catalog
//      failure / unknown network
//    - pages/Faucet_ERC20/Page.jsx — unknown token
// -----------------------------------------------------------

import { Box } from '@mui/material';







// -----------------------------------------------------------
// ErrorCard (default export)
// -----------------------------------------------------------
//
//   <ErrorCard>Nežinomas tinklas: {network}</ErrorCard>
//
// Used by:
//   - see the file header
// -----------------------------------------------------------

export default function ErrorCard({ children }) {
  return (
    <Box className="p-4">
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[640px] p-4">
        <p className="text-center text-red-600">{children}</p>
      </div>
    </Box>
  );
}

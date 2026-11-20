// -----------------------------------------------------------
//  [*] BitcoinScript — Pieces
//
//  The two small pictures that are not tiles: a coin and a
//  key pair's badge.
//
//  A coin is an unspent output, and it looks like money: a
//  disc in Bitcoin's own orange with the bitcoin sign — the
//  only orange on the page. A coin that has been spent is
//  only the empty ring it left behind, and a coin that a
//  transaction WOULD make — while no node has accepted that
//  transaction — is a dashed outline waiting to be filled.
//
//  A key pair's badge is a disc in the pair's colour with the
//  first letter of its name.
//
//  Split into:
//
//    COIN_LOOKS   — a coin's three states
//    Coin         — a coin (exported)
//    KeyBadge     — a key pair (exported)
// -----------------------------------------------------------

import { Box } from '@mui/material';
import BitcoinIcon from '@mui/icons-material/CurrencyBitcoin';

import { COLORS } from '../constants';
import { MOTION } from '../motion';


// A coin by its state: the ring, the face and the sign
const COIN_LOOKS = {
  unspent: { border: `2px solid ${COLORS.COIN}`, background: COLORS.COIN, color: '#ffffff' },
  spent: { border: '2px dashed #94a3b8', background: 'transparent', color: '#cbd5e1' },
  future: { border: `2px dashed ${COLORS.COIN}`, background: 'transparent', color: COLORS.COIN },
};







// -----------------------------------------------------------
// Coin
// -----------------------------------------------------------
//
// One coin in one of its three states (see the file header).
// `fresh` makes it pop into place — a coin a transaction has
// just made.
//
// Used by:
//   - components/Transactions.jsx — the outputs of A and B
// -----------------------------------------------------------

export function Coin({ state = 'unspent', size = 32, fresh = false }) {
  return (
    <Box
      component="span"
      data-state={state}
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      sx={{ width: size, height: size, ...COIN_LOOKS[state], ...(fresh ? MOTION.pop() : {}) }}
    >
      <BitcoinIcon sx={{ fontSize: size * 0.66 }} />
    </Box>
  );
}







// -----------------------------------------------------------
// KeyBadge
// -----------------------------------------------------------
//
// A key pair as a disc in its colour, the first letter of its
// name on it. Purely a picture — whoever shows it names the
// pair in words beside it.
//
// Used by:
//   - components/Transactions.jsx — whose a new coin is
//   - components/PieceTray.jsx — beside a key pair's name
// -----------------------------------------------------------

export function KeyBadge({ name, colour, size = 24 }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold uppercase text-white"
      style={{ width: size, height: size, background: colour, fontSize: size * 0.5 }}
    >
      {name.trim()[0] ?? '?'}
    </span>
  );
}

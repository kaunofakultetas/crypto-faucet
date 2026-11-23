// -----------------------------------------------------------
//  [*] BitcoinScript — Pieces
//
//  The two small pictures that are not tiles: a coin and a
//  key pair's badge.
//
//  A coin is an unspent output, and it looks like money: a
//  disc in its chain's colour with the chain's sign — orange
//  with the bitcoin sign on nearly every scene, silver with
//  Litecoin's for the other half of a swap between chains. A
//  coin that has been spent is only the empty ring it left
//  behind, and a coin that a transaction WOULD make — while
//  no node has accepted that transaction — is a dashed
//  outline waiting to be filled.
//
//  A key pair's badge is a disc in the pair's colour with the
//  first letter of its name.
//
//  Split into:
//
//    coinLook     — a coin's three states, in a chain's colour
//    Coin         — a coin (exported)
//    KeyBadge     — a key pair (exported)
// -----------------------------------------------------------

import { Box } from '@mui/material';
import BitcoinIcon from '@mui/icons-material/CurrencyBitcoin';

import { CHAINS } from '../constants';
import { MOTION } from '../motion';







// -----------------------------------------------------------
// coinLook
// -----------------------------------------------------------
//
// The ring, the face and the sign of a coin by its state:
// filled in the chain's colour while unspent, an outline in
// that colour while it is only promised, and a pale grey
// outline once it is spent.
//
// Used by:
//   - Coin (below)
// -----------------------------------------------------------

function coinLook(state, colour) {
  if (state === 'unspent') return { border: `2px solid ${colour}`, background: colour, color: '#ffffff' };
  if (state === 'future') return { border: `2px dashed ${colour}`, background: 'transparent', color: colour };
  return { border: '2px dashed #94a3b8', background: 'transparent', color: '#cbd5e1' };
}







// -----------------------------------------------------------
// Coin
// -----------------------------------------------------------
//
// One coin of a chain — Bitcoin's unless told otherwise — in
// one of its three states (see the file header). `fresh`
// makes it pop into place: a coin a transaction has just
// made.
//
// Used by:
//   - components/Transactions.jsx — the outputs of A and B
// -----------------------------------------------------------

export function Coin({ state = 'unspent', size = 32, fresh = false, chain = CHAINS.btc }) {
  return (
    <Box
      component="span"
      data-state={state}
      data-chain={chain.key}
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      sx={{ width: size, height: size, ...coinLook(state, chain.colour), ...(fresh ? MOTION.pop() : {}) }}
    >
      {chain.key === 'btc'
        ? <BitcoinIcon sx={{ fontSize: size * 0.66 }} />
        : <span className="font-extrabold leading-none" style={{ fontSize: size * 0.58 }}>{chain.sign}</span>}
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

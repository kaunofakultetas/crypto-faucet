// -----------------------------------------------------------
//  [*] BitcoinScript — constants
//
//  The fixed things of the script playground in one place:
//  the names and colours key pairs are given, the palette —
//  one colour per meaning — the chains a scene can stand on,
//  how fast the node's check plays by itself, and how much a
//  student may build.
//
//  Used by:
//    - model.js, examples.js
//    - the hooks and the components
// -----------------------------------------------------------







// -----------------------------------------------------------
// KEY_COLOURS
// -----------------------------------------------------------
//
// The colours key pairs are told apart by — the one thing on
// the page colour is spent on. Everything that comes from one
// key pair — its public key, that key's hash, its signature —
// carries the pair's colour wherever it goes: in a script, on
// a transaction, on the stack. Each is dark enough to be read
// as text on white, and none is near the orange of a coin or
// the green and red of the verdict.
//
// Used by:
//   - examples.js — the starting key pairs
//   - model.js — the colour of a key pair made on the page
// -----------------------------------------------------------

export const KEY_COLOURS = ['#1d4ed8', '#be185d', '#0e7490', '#9a3412', '#4d7c0f', '#a16207'];







// -----------------------------------------------------------
// FIRST_NAMES
// -----------------------------------------------------------
//
// The names of the key pairs the page starts with, in order.
// Their private keys are made from these very names
// (engine/keys.js), so the names are part of the keys and
// must not be changed lightly.
//
// Used by:
//   - examples.js — the starting key pairs
// -----------------------------------------------------------

export const FIRST_NAMES = ['Jonas', 'Gabija', 'Rokas', 'Simona'];







// -----------------------------------------------------------
// SPARE_NAMES
// -----------------------------------------------------------
//
// The names handed to key pairs made on the page, in order,
// each to the first pair that does not have it yet. A name is
// only a label and can be changed at once.
//
// Used by:
//   - model.js — naming a new key pair
// -----------------------------------------------------------

export const SPARE_NAMES = ['Eglė', 'Petras', 'Ona', 'Lukas', 'Ieva', 'Mantas', 'Rūta', 'Darius', 'Austėja', 'Kęstas'];







// -----------------------------------------------------------
// COLORS
// -----------------------------------------------------------
//
// The palette, one colour per meaning: slate for what is
// nobody's and for a claim nobody has judged yet, and green
// and red for the node's verdict alone. A coin has the colour
// of its chain (CHAINS). The page's accent is the site's
// burgundy, which the stylesheet already names.
//
// Used by:
//   - components/Tile.jsx — a value that is nobody's
//   - components/Transactions.jsx — the padlock, the arrow
//   - components/Player.jsx — the verdict and the answers
// -----------------------------------------------------------

export const COLORS = {
  INK: '#334155',
  MUTED: '#64748b',
  VALID: '#047857',
  INVALID: '#b91c1c',
};







// -----------------------------------------------------------
// CHAINS
// -----------------------------------------------------------
//
// The chains a scene can stand on. Bitcoin is the one nearly
// every scene uses; Litecoin is there for the other half of a
// swap between two chains — it runs the same Script, which is
// the whole point of such a swap. Each has its name, the unit
// its amounts are written in, how many coins there will ever
// be, and the colour and sign of its coin: Bitcoin's own
// orange, and the silver Litecoin has called itself from the
// start.
//
// Used by:
//   - model.js — the chain of a state, the most money on it
//   - components/Pieces.jsx — a coin's look
// -----------------------------------------------------------

export const CHAINS = {
  btc: { key: 'btc', name: 'Bitcoin', unit: 'BTC', coins: 21_000_000, colour: '#f7931a', sign: '₿' },
  ltc: { key: 'ltc', name: 'Litecoin', unit: 'LTC', coins: 84_000_000, colour: '#6b7280', sign: 'Ł' },
};







// -----------------------------------------------------------
// PLAY_MS
// -----------------------------------------------------------
//
// How long the node rests on one step when its check plays
// by itself — long enough for the step to play out and for
// a sentence to be read aloud.
//
// Used by:
//   - hooks/useStepper.js
// -----------------------------------------------------------

export const PLAY_MS = 1500;







// -----------------------------------------------------------
// LIMITS
// -----------------------------------------------------------
//
// How much a student may build: outputs per transaction, key
// pairs, pieces of data kept on the shelf, the letters of a
// key pair's name, and the longest script a row takes, in
// characters. The limits keep the page readable; Bitcoin's
// own are far higher.
//
// Used by:
//   - model.js — adding things
//   - tiles.js — a script's longest text
//   - components/PieceTray.jsx, Transactions.jsx — whether
//     there is room for one more
// -----------------------------------------------------------

export const LIMITS = {
  OUTPUTS: 4,
  PAYMENTS: 3,
  KEYS: 6,
  DATA: 12,
  NAME_CHARACTERS: 16,
  SCRIPT_CHARACTERS: 2000,
};







// -----------------------------------------------------------
// SATOSHIS
// -----------------------------------------------------------
//
// How many satoshis make one bitcoin — amounts are typed in
// bitcoin and kept in satoshis, the whole numbers a
// transaction holds.
//
// Used by:
//   - model.js — reading an amount, the most money on a chain
//   - narration.js — writing an amount
// -----------------------------------------------------------

export const SATOSHIS = 100_000_000;

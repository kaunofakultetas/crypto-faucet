// -----------------------------------------------------------
//  [*] Graph_UTXO — mock transactions
//
//  Hand-written sample data for the UTXO transaction graph
//  while it is a GUI mockup — nothing here comes from a chain
//  and no backend is called. The shape is the one a backend
//  endpoint would answer with later: blocks in ascending
//  height (only blocks holding one of the graph's
//  transactions, so gaps in the heights are real), and
//  transactions whose inputs already carry the spent output's
//  address and value — a raw transaction names only the
//  outpoint, the backend would resolve it. block: null means
//  still waiting in the mempool; vsize is the size in virtual
//  bytes (weight / 4) the fee rate divides by. Amounts are
//  integer satoshis.
//
//  The dates are set relative to the moment the page loads,
//  so the day slider always has a busy today and a past to
//  step back into. The story, on a btc4-like chain with a 0.1
//  chunk:
//    - three days ago, the lecturer gets coins from a public
//      testnet faucet (an address nobody in the class named)
//    - yesterday, the lecturer funds the class faucet, and a
//      student nobody named returns a leftover coin to it
//    - today, the faucet pays students in a chain (every
//      payout spends the previous payout's change — twice
//      inside one block), Jonas passes coins on, Eglė merges
//      two coins into one payment, Tomas splits his among
//      three classmates, Rūta returns her coins, the newest
//      payouts still wait unconfirmed — and Lukas pays Gabija
//      in a PayJoin, where she adds a coin of her own, so one
//      transaction's inputs belong to two people
//
//  Used by:
//    - hooks/useTransactionGraph.js — the mockup's data source
// -----------------------------------------------------------

// One faucet payout: 0.1 coin
const CHUNK = 10_000_000;

// A SegWit P2WPKH transaction's size in virtual bytes
const vsizeFor = (inputs, outputs) => inputs * 68 + outputs * 31 + 11;

// The fee every mock transaction pays — 10 sat/vB — so
// inputs minus outputs always adds up
const feeFor = (inputs, outputs) => vsizeFor(inputs, outputs) * 10;

// Total value of a list of inputs or outputs
const sum = (coins) => coins.reduce((total, coin) => total + coin.value, 0);

// The moment the sample is anchored to
const NOW = Date.now();

// ISO time `minutes` before now — today's blocks
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

// ISO time of hour:minute, local, `days` calendar days ago —
// setDate / setHours, so a DST change cannot shift the day
function daysAgoAt(days, hour, minute) {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}







// -----------------------------------------------------------
// mockChars
// -----------------------------------------------------------
//
// Deterministic pseudo-random characters (xorshift32) from a
// seed: the mock txids and addresses look real and stay the
// same on every reload.
//
// Used by:
//   - mockTxid / mockAddress (below)
// -----------------------------------------------------------

function mockChars(seed, length, alphabet) {

  let state = (seed * 2654435761) >>> 0 || 1;
  let out = '';


  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out += alphabet[state % alphabet.length];
  }


  return out;
}

// 64 hex characters, like a real txid
const mockTxid = (seed) => mockChars(seed, 64, '0123456789abcdef');

// A testnet P2WPKH-looking address (bech32 alphabet only)
const mockAddress = (seed) => `tb1q${mockChars(seed + 1000, 38, 'qpzry9x8gf2tvdw0s3jn54khce6mua7l')}`;







// -----------------------------------------------------------
// MOCK_FAUCET_ADDRESS
// -----------------------------------------------------------
//
// The faucet's address in the sample — the real btc4 faucet
// address, so the mockup reads like the real thing.
//
// Used by:
//   - hooks/useTransactionGraph.js — returned as faucetAddress
//   - the sample transactions below
// -----------------------------------------------------------

export const MOCK_FAUCET_ADDRESS = 'tb1qgc4lympfuq8wwvh563660hdsm7efh3eekmuas4';

// Everyone else in the sample
const PERSON = {
  lecturer: mockAddress(8),
  publicFaucet: mockAddress(9),   // nobody named it
  stranger: mockAddress(10),      // nobody named them either
  jonas: mockAddress(1),
  egle: mockAddress(2),
  tomas: mockAddress(3),
  ruta: mockAddress(4),
  lukas: mockAddress(5),
  gabija: mockAddress(6),
  gabija2: mockAddress(7),        // a second address of Gabija's wallet
};







// -----------------------------------------------------------
// MOCK_NAMES
// -----------------------------------------------------------
//
// address → who controls it, standing in for the names
// students give addresses on the graph (the EVM graph keeps
// its names in Graph_Addresses). Two addresses may carry one
// name — a wallet has many addresses — and some carry none.
//
// Used by:
//   - hooks/useTransactionGraph.js — the names state's start
// -----------------------------------------------------------

export const MOCK_NAMES = {
  [MOCK_FAUCET_ADDRESS]: 'Čiaupas',
  [PERSON.lecturer]: 'Dėstytojas',
  [PERSON.jonas]: 'Jonas',
  [PERSON.egle]: 'Eglė',
  [PERSON.tomas]: 'Tomas',
  [PERSON.ruta]: 'Rūta',
  [PERSON.lukas]: 'Lukas',
  [PERSON.gabija]: 'Gabija',
  [PERSON.gabija2]: 'Gabija',
};

// An input spending output `vout` of a transaction listed
// here — address and value copied from it, the way the
// backend would resolve the outpoint
const spend = (tx, vout) => ({ txid: tx.txid, vout, ...tx.outputs[vout] });







// -----------------------------------------------------------
// payment
// -----------------------------------------------------------
//
// A transaction paying `payments` ({ address, value } each)
// from `inputs`, with the rest minus the fee as the last
// output: change back to `changeTo`.
//
// Used by:
//   - payout (below) and the other sample transactions
// -----------------------------------------------------------

function payment(seed, block, inputs, payments, changeTo) {

  const change = sum(inputs) - sum(payments) - feeFor(inputs.length, payments.length + 1);


  return {
    txid: mockTxid(seed),
    block,
    vsize: vsizeFor(inputs.length, payments.length + 1),
    inputs,
    outputs: [...payments, { address: changeTo, value: change }],
  };
}

// One faucet payout: the chunk to the student, the change
// back to the faucet
const payout = (seed, block, inputs, student) =>
  payment(seed, block, inputs, [{ address: student, value: CHUNK }], MOCK_FAUCET_ADDRESS);







// -----------------------------------------------------------
// MOCK_BLOCKS
// -----------------------------------------------------------
//
// The blocks the sample transactions sit in, ascending, with
// their times (ISO, UTC — the page shows them in local time
// and files them under local days). testnet4 mines a block
// about every 20 minutes; blocks without a class transaction
// are simply not listed.
//
// Used by:
//   - hooks/useTransactionGraph.js — the days and each day's
//     columns
// -----------------------------------------------------------

export const MOCK_BLOCKS = [
  { height: 154101, time: daysAgoAt(3, 11, 12) },
  { height: 154318, time: daysAgoAt(1, 14, 5) },
  { height: 154320, time: daysAgoAt(1, 14, 47) },
  { height: 154390, time: minutesAgo(80) },
  { height: 154391, time: minutesAgo(60) },
  { height: 154393, time: minutesAgo(20) },
  { height: 154394, time: minutesAgo(1) },
];

// Coins from outside the sample — outputs of transactions
// nobody here made
const PUBLIC_FAUCET_COIN = { txid: mockTxid(80), vout: 0, address: PERSON.publicFaucet, value: 90_000_000_000 };
const STRANGER_COIN = { txid: mockTxid(81), vout: 1, address: PERSON.stranger, value: 5_000_000 };

// Three days ago: the lecturer tops up from a public faucet
const LECTURER_TOPUP = payment(20, 154101, [PUBLIC_FAUCET_COIN],
  [{ address: PERSON.lecturer, value: 80_000_000_000 }], PERSON.publicFaucet);

// Yesterday: the lecturer funds the class faucet, and a
// student nobody named returns a leftover coin to it
const FAUCET_FUNDING = payment(21, 154318, [spend(LECTURER_TOPUP, 0)],
  [{ address: MOCK_FAUCET_ADDRESS, value: 75_000_000_000 }], PERSON.lecturer);
const LEFTOVER_RETURN = payment(22, 154320, [STRANGER_COIN],
  [{ address: MOCK_FAUCET_ADDRESS, value: 998_900 }], PERSON.stranger);

// Today — the faucet chain: each payout spends the previous
// change
const PAYOUT_1 = payout(1, 154390, [spend(FAUCET_FUNDING, 0)], PERSON.jonas);
const PAYOUT_2 = payout(2, 154390, [spend(PAYOUT_1, 1)], PERSON.egle);
const PAYOUT_3 = payout(3, 154391, [spend(PAYOUT_2, 1)], PERSON.tomas);

// Jonas passes half of his coin to Eglė
const JONAS_TO_EGLE = payment(4, 154391, [spend(PAYOUT_1, 0)], [{ address: PERSON.egle, value: 5_000_000 }], PERSON.jonas);

// The faucet also sweeps the coin returned yesterday
const PAYOUT_4 = payout(5, 154393, [spend(PAYOUT_3, 1), spend(LEFTOVER_RETURN, 0)], PERSON.ruta);

// Eglė merges her two coins into one payment to Tomas
const EGLE_TO_TOMAS = payment(6, 154393, [spend(PAYOUT_2, 0), spend(JONAS_TO_EGLE, 0)],
  [{ address: PERSON.tomas, value: 12_000_000 }], PERSON.egle);

// Tomas splits his coins among three classmates
const TOMAS_SPLITS = payment(7, 154394, [spend(PAYOUT_3, 0), spend(EGLE_TO_TOMAS, 0)], [
  { address: PERSON.lukas, value: 5_000_000 },
  { address: PERSON.gabija, value: 5_000_000 },
  { address: PERSON.ruta, value: 5_000_000 },
], PERSON.tomas);

// Still unconfirmed: two chained payouts and Rūta's return
const PAYOUT_5 = payout(8, null, [spend(PAYOUT_4, 1)], PERSON.lukas);
const PAYOUT_6 = payout(9, null, [spend(PAYOUT_5, 1)], PERSON.gabija);
const RUTA_RETURNS = {
  txid: mockTxid(10),
  block: null,
  vsize: vsizeFor(1, 1),
  inputs: [spend(PAYOUT_4, 0)],
  outputs: [{ address: MOCK_FAUCET_ADDRESS, value: CHUNK - feeFor(1, 1) }],
};

// A PayJoin: Lukas pays Gabija 0.03 and Gabija adds a coin of
// her own — the inputs belong to TWO people. Her coin comes
// back to her with the payment, on her second address
const LUKAS_PAYJOIN_TO_GABIJA = payment(11, null, [spend(TOMAS_SPLITS, 0), spend(TOMAS_SPLITS, 1)],
  [{ address: PERSON.gabija2, value: 5_000_000 + 3_000_000 }], PERSON.lukas);







// -----------------------------------------------------------
// MOCK_TRANSACTIONS
// -----------------------------------------------------------
//
// Every sample transaction, all days. Within a block the
// order is the order they stack in at first layout — the
// faucet's own payouts first.
//
// Used by:
//   - hooks/useTransactionGraph.js — the day's transactions,
//     and every transaction for the dialog's links
// -----------------------------------------------------------

export const MOCK_TRANSACTIONS = [
  LECTURER_TOPUP,
  FAUCET_FUNDING,
  LEFTOVER_RETURN,
  PAYOUT_1,
  PAYOUT_2,
  PAYOUT_3,
  JONAS_TO_EGLE,
  PAYOUT_4,
  EGLE_TO_TOMAS,
  TOMAS_SPLITS,
  PAYOUT_5,
  PAYOUT_6,
  RUTA_RETURNS,
  LUKAS_PAYJOIN_TO_GABIJA,
];

// -----------------------------------------------------------
//  [*] Test support — UTXO transactions to draw
//
//  Builders for transactions in the backend's graph shape,
//  for the tests that need a day the shared fixture does not
//  have (a CoinJoin, a coinbase in the day, an input whose
//  earlier transaction the server never gave, a p2pk output,
//  a status nobody knows …). Every builder returns a fresh
//  object; the shared fixture is never touched.
//
//    spend           — an input
//    coin            — an output
//    transaction     — one transaction
//    dayOf           — a whole graph answer
//    dayTransactions — the fixture day's T1…T5, copied
//
//  Used by:
//    - tests/pages/graph-utxo/*
// -----------------------------------------------------------

import * as f from '../backend/fixtures';


export const T = f.UTXO_TXIDS;

// Txids for the made-up transactions, in the fixture's style
export const X = {
  JOIN: 'c1'.repeat(32),
  MINED: 'd1'.repeat(32),
  LOST: 'e1'.repeat(32),
  PK: 'f1'.repeat(32),
};







// -----------------------------------------------------------
// spend / coin / transaction
// -----------------------------------------------------------
//
// An input spending one output of an earlier transaction (its
// address and value may be null — the server never gave that
// earlier transaction); an output with its script type
// (p2wpkh unless told otherwise) and its spend state —
// spentBy names the transaction and the input that spent it,
// spentKnown turned off marks an address nobody has read; a
// transaction mined in `block` (null: the mempool), with a
// fee and a size unless told otherwise.
// -----------------------------------------------------------

export const spend = (txid, vout, address, value) => ({ txid, vout, address, value });

export const coin = (address, value, { spentBy = null, spentKnown = true, scriptType = 'p2wpkh' } = {}) => ({
  address, script_type: scriptType, value, spent_by: spentBy, spent_known: spentBy ? true : spentKnown,
});

export function transaction({
  txid, block = 154390, status, time = '2026-09-29T10:18:29Z', vsize = 150, fee = 1500, coinbase = false, inputs = [], outputs = [],
}) {
  return {
    txid,
    status: status ?? (block === null ? 'mempool' : 'confirmed'),
    block,
    time: block === null ? null : time,
    vsize,
    fee,
    coinbase,
    inputs,
    outputs,
  };
}







// -----------------------------------------------------------
// dayOf / dayTransactions
// -----------------------------------------------------------
//
// A graph answer holding the transactions given, the
// fixture's blocks (plus any block a transaction names that
// the list lacks) and names — live unless the changes a test
// spreads over it say otherwise. dayTransactions is a fresh
// copy of the fixture day's transactions, the mempool's T5
// included.
// -----------------------------------------------------------

export function dayOf(transactions, changes = {}) {
  const blocks = [...f.utxoBlocks];
  for (const tx of transactions) {
    if (tx.block !== null && !blocks.some((block) => block.height === tx.block)) {
      blocks.push({ height: tx.block, time: tx.time });
    }
  }
  blocks.sort((a, b) => a.height - b.height);
  return {
    blocks,
    faucet_address: f.FAUCET_UTXO,
    live: true,
    missing: 0,
    names: { ...f.utxoNames },
    transactions,
    updating: false,
    ...changes,
  };
}

export const dayTransactions = () => f.utxoGraph({ live: true }).transactions;

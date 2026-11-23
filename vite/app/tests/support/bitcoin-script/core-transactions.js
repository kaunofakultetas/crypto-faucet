// -----------------------------------------------------------
//  [*] Test support — Bitcoin Core's lock-time transactions
//
//  The two opcodes that tie a coin to time — one to a block
//  the chain must have reached, one to the age of the coin
//  itself — cannot be judged from scripts alone: what they
//  answer depends on the transaction that spends the coin.
//  So the reference implementation tests them with whole
//  transactions, and the playground's engine is held against
//  those same ones: core-locktime-tx-tests.json beside this
//  file holds the "CHECKLOCKTIMEVERIFY tests" and
//  "CHECKSEQUENCEVERIFY tests" sections of Bitcoin Core
//  v27.0's src/test/data/tx_valid.json and tx_invalid.json,
//  every row as it stands there (MIT licence, copyright The
//  Bitcoin Core developers).
//
//  A row is the coins a transaction spends — each named by
//  the transaction and output it came from, with its lock in
//  Core's test notation — the spending transaction in bytes,
//  and a list of rules. For a valid transaction the list is
//  the rules it would break, were they switched on; for an
//  invalid one, the rules that make it invalid. This file
//  reads the bytes back into a transaction and puts every
//  input through the playground's own engine.
//
//  Split into:
//
//    VALID, INVALID — the vectors, each with its comment
//    readTransaction — a transaction from its bytes
//    runTransaction — every input of one vector through the
//                     engine
//
//  Used by:
//    - pages/bitcoin-script/engine-node.test.js
// -----------------------------------------------------------

import rows from './core-locktime-tx-tests.json';
import { scriptBytes } from './core-vectors';
import { reverseBytes } from '@/pages/BitcoinScript/engine/bytes';
import { evaluateSpend } from '@/pages/BitcoinScript/engine/interpreter';
import { checkerFor } from '@/pages/BitcoinScript/engine/node';
import { readScript } from '@/pages/BitcoinScript/engine/script';


// The vectors of one list, each with the comment that stands
// above it in Core's file
const withComments = (list) => {
  let comment = '';
  return list.flatMap((row) => {
    if (row.length === 1) {
      [comment] = row;
      return [];
    }
    const [coins, hex, flags] = row;
    return [{ comment, coins, hex, flags: flags.split(',').filter((flag) => flag && flag !== 'NONE') }];
  });
};







// -----------------------------------------------------------
// VALID, INVALID
// -----------------------------------------------------------
//
// The vectors as objects: the comment above the row, the
// coins spent, the transaction's bytes and the list of rules
// — those the transaction would break (valid), or those that
// make it invalid.
// -----------------------------------------------------------

export const VALID = withComments(rows.valid);

export const INVALID = withComments(rows.invalid);







// -----------------------------------------------------------
// readTransaction
// -----------------------------------------------------------
//
// A transaction in the original serialization, read back from
// its bytes into the shape the engine works with: version,
// inputs — the transaction and output each spends, its
// unlocking script and sequence number — outputs and lock
// time. Numbers are read lowest byte first; the id of the
// transaction an input names is turned the way ids are
// written.
// -----------------------------------------------------------

export function readTransaction(hex) {
  let at = 0;
  const take = (bytes) => hex.slice(at, (at += bytes * 2));
  const number = (bytes) => Number(BigInt(`0x${reverseBytes(take(bytes))}`));
  const count = () => {
    const first = number(1);
    return first < 0xfd ? first : number(first === 0xfd ? 2 : first === 0xfe ? 4 : 8);
  };

  const version = number(4);
  const inputs = Array.from({ length: count() }, () => ({ txid: reverseBytes(take(32)), vout: number(4), script: take(count()), sequence: number(4) }));
  const outputs = Array.from({ length: count() }, () => ({ value: number(8), script: take(count()) }));
  const lockTime = number(4);

  if (at !== hex.length) throw new Error('bytes left over after the transaction');
  return { version, inputs, outputs, lockTime };
}







// -----------------------------------------------------------
// runTransaction
// -----------------------------------------------------------
//
// One vector through the engine: every input's unlocking
// script against the lock of the coin it names. Hands back
// whether all of them are accepted and, when one is not, the
// engine's error for it.
// -----------------------------------------------------------

export function runTransaction({ coins, hex }) {
  const transaction = readTransaction(hex);

  for (const [index, input] of transaction.inputs.entries()) {
    const coin = coins.find(([txid, vout]) => txid === input.txid && vout === input.vout);
    if (!coin) return { ok: false, error: 'no-such-coin' };

    const lockHex = scriptBytes(coin[2]);
    const unlock = readScript(input.script);
    const lock = readScript(lockHex);
    const run = evaluateSpend({
      unlock: { items: unlock.items, hex: input.script },
      lock: { items: lock.items, hex: lockHex },
      checker: checkerFor(transaction, index),
    });

    if (!run.ok || unlock.broken || lock.broken) return { ok: false, error: run.error?.code ?? 'broken', why: run.error?.why ?? null };
  }
  return { ok: true, error: null };
}

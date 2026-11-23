// -----------------------------------------------------------
//  [*] Test support — Bitcoin Core's script vectors
//
//  The playground's script machine is checked against the
//  test vectors the reference implementation itself is tested
//  with: core-script-tests.json beside this file is Bitcoin
//  Core v27.0's src/test/data/script_tests.json, unchanged
//  (MIT licence, copyright The Bitcoin Core developers).
//
//  A vector is an unlocking script, a locking script, the
//  rules switched on for it, and what a node must answer —
//  "OK", or the name of the error. A vector for a witness
//  program starts with one thing more: the witness, item by
//  item, and the amount of the coin, which its signatures
//  sign. The scripts are written in
//  Core's own test notation, which is not the playground's:
//  whole numbers, raw bytes behind 0x that go into the script
//  as they are, text in single quotes, and opcode names. This
//  file turns that notation into bytes and runs a vector the
//  way Core's test does — a crediting transaction that holds
//  the lock, a spending transaction that carries the unlocking
//  script — through the playground's own engine.
//
//  Split into:
//
//    VECTORS      — the vectors that are run
//    scriptBytes  — Core's test notation as a script's bytes
//    runVector    — one vector through the engine
//
//  Used by:
//    - pages/bitcoin-script/engine-machine.test.js
// -----------------------------------------------------------

import vectors from './core-script-tests.json';
import { textToHex, uintLE } from '@/pages/BitcoinScript/engine/bytes';
import { evaluateSpend } from '@/pages/BitcoinScript/engine/interpreter';
import { checkerFor } from '@/pages/BitcoinScript/engine/node';
import { opcodeNamed } from '@/pages/BitcoinScript/engine/opcodes';
import { numberHex, pushOf, readScript } from '@/pages/BitcoinScript/engine/script';
import { transactionId } from '@/pages/BitcoinScript/engine/transaction';







// -----------------------------------------------------------
// VECTORS
// -----------------------------------------------------------
//
// The vectors that are run, each as an object: the two
// scripts in Core's notation, the witness as its items and
// the coin's amount in satoshis — none and nothing for most —
// the list of rules switched on, the expected answer and the
// vector's comment. The file's one-element rows are comments;
// a row that starts with a list carries a witness and, last
// in that list, the amount in whole coins.
// -----------------------------------------------------------

export const VECTORS = vectors
  .filter((row) => row.length >= 4)
  .map((row) => (Array.isArray(row[0]) ? row : [[0], ...row]))
  .map(([carried, scriptSig, scriptPubKey, flags, expected, comment = '']) => ({
    scriptSig,
    scriptPubKey,
    witness: carried.slice(0, -1),
    amount: Math.round(carried.at(-1) * 100_000_000),
    flags: flags.split(',').filter(Boolean),
    expected,
    comment,
  }));







// -----------------------------------------------------------
// scriptBytes
// -----------------------------------------------------------
//
// A script in Core's test notation as its bytes: a number
// from minus one to sixteen is its opcode and any other
// number a push, bytes behind 0x go in exactly as written,
// quoted text is pushed, and everything else is an opcode's
// name.
// -----------------------------------------------------------

export function scriptBytes(text) {
  let hex = '';

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (/^-?\d+$/.test(word)) {
      const value = Number(word);
      hex += value === -1 || (value >= 1 && value <= 16) ? uintLE(value + 0x50, 1) : pushOf(numberHex(value));
    } else if (/^0x[0-9a-fA-F]+$/.test(word)) {
      hex += word.slice(2).toLowerCase();
    } else if (/^'.*'$/.test(word)) {
      hex += pushOf(textToHex(word.slice(1, -1)));
    } else {
      const opcode = opcodeNamed(word);
      if (!opcode) throw new Error(`a word the engine does not know: ${word}`);
      hex += uintLE(opcode.code, 1);
    }
  }
  return hex;
}







// -----------------------------------------------------------
// runVector
// -----------------------------------------------------------
//
// One vector through the engine, the way Core's own test
// runs it: the lock goes into the output of a crediting
// transaction, with the vector's amount; the unlocking script
// and the witness go into the input of a transaction that
// spends it and passes the same amount on; and the engine
// decides. Hands
// back whether the spend is accepted and, when it is not, the
// engine's error code. A script whose bytes cannot be read to
// the end is refused, as a node refuses it.
// -----------------------------------------------------------

export function runVector({ scriptSig, scriptPubKey, witness = [], amount = 0 }) {
  const unlockHex = scriptBytes(scriptSig);
  const lockHex = scriptBytes(scriptPubKey);
  const credit = {
    version: 1,
    inputs: [{ txid: '00'.repeat(32), vout: 0xffffffff, script: '0000', sequence: 0xffffffff }],
    outputs: [{ value: amount, script: lockHex }],
    lockTime: 0,
  };
  const spend = {
    version: 1,
    inputs: [{ txid: transactionId(credit), vout: 0, script: unlockHex, sequence: 0xffffffff, witness }],
    outputs: [{ value: amount, script: '' }],
    lockTime: 0,
  };

  const unlock = readScript(unlockHex);
  const lock = readScript(lockHex);
  const run = evaluateSpend({
    unlock: { items: unlock.items, hex: unlockHex },
    lock: { items: lock.items, hex: lockHex },
    witness,
    checker: checkerFor(spend, 0, [{ value: amount, script: lockHex }]),
  });

  const broken = unlock.broken || lock.broken;
  return { ok: run.ok && !broken, error: run.error?.code ?? (broken ? 'broken' : null), lockHex };
}

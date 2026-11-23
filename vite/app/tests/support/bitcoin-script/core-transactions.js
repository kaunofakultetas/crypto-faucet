// -----------------------------------------------------------
//  [*] Test support — Bitcoin Core's transactions
//
//  Much of what a node decides cannot be judged from two
//  scripts alone: a signature signs the transaction around
//  it, a lock-time opcode asks about that transaction, and a
//  witness program is opened by what travels beside it. So
//  the reference implementation tests those with whole
//  transactions, and the playground's engine is held against
//  the same ones. Three files beside this one hold them (MIT
//  licence, copyright The Bitcoin Core developers):
//
//    - core-tx-valid.json and core-tx-invalid.json are
//      Bitcoin Core v27.0's src/test/data/tx_valid.json and
//      tx_invalid.json, unchanged
//    - core-taproot-assets.json is a sample of the cases
//      Core's own Taproot test (test/functional/
//      feature_taproot.py) writes out for its script_assets
//      test, as published in bitcoin-core/qa-assets
//      (unit_test_data/script_assets_test.json): of each of
//      its 161 scenarios the case that says most — judged
//      with Taproot switched on, with a spend that must fail
//      beside the one that must pass — and of those the
//      smallest. Two scenarios whose smallest case is larger
//      than 20 000 bytes are left out. The whole file, 2244
//      cases, agreed with the engine when the sample was cut
//
//  A row of the first two is the coins a transaction spends —
//  each named by the transaction and output it came from,
//  with its lock in Core's test notation and, where the lock
//  needs it, its amount — the spending transaction in bytes,
//  and a list of rules. For a valid transaction the list is
//  the rules it would break, were they switched on; for an
//  invalid one, the rules that make it invalid. A case of the
//  third is a transaction, every coin it spends as bytes, the
//  number of the input under test, the rules it is judged by,
//  and one or two ways to fill that input in: one that must
//  open the coin, one that must not.
//
//  Split into:
//
//    VALID, INVALID — the transactions, each with its comment
//    ASSETS         — the Taproot cases
//    readTransaction — a transaction from its bytes
//    runTransaction — every input of one transaction through
//                     the engine
//    runAsset       — one way of filling in a Taproot case's
//                     input through the engine
//
//  Used by:
//    - pages/bitcoin-script/engine-node.test.js
//    - pages/bitcoin-script/engine-taproot.test.js
// -----------------------------------------------------------

import assets from './core-taproot-assets.json';
import invalid from './core-tx-invalid.json';
import valid from './core-tx-valid.json';
import { scriptBytes } from './core-vectors';
import { reverseBytes } from '@/pages/BitcoinScript/engine/bytes';
import { evaluateSpend } from '@/pages/BitcoinScript/engine/interpreter';
import { checkerFor } from '@/pages/BitcoinScript/engine/node';
import { readScript } from '@/pages/BitcoinScript/engine/script';


// The transactions of one file, each with the comment that
// stands above it there — a row that starts with text is a
// comment
const withComments = (list) => {
  let comment = '';
  return list.flatMap((row) => {
    if (typeof row[0] === 'string') {
      [comment] = row;
      return [];
    }
    const [coins, hex, flags] = row;
    return [{ comment, coins, hex, flags: flags.split(',').filter((flag) => flag && flag !== 'NONE') }];
  });
};

// One input of a transaction through the engine: whether it
// opens its coin and, when it does not, the engine's error
const runInput = (transaction, index, spent) => {
  const input = transaction.inputs[index];
  const lockHex = spent[index].script;
  const unlock = readScript(input.script);
  const lock = readScript(lockHex);
  const run = evaluateSpend({
    unlock: { items: unlock.items, hex: input.script },
    lock: { items: lock.items, hex: lockHex },
    witness: input.witness,
    checker: checkerFor(transaction, index, spent),
  });

  if (run.ok && !unlock.broken && !lock.broken) return { ok: true, error: null };
  return { ok: false, error: run.error?.code ?? 'broken', why: run.error?.why ?? null };
};







// -----------------------------------------------------------
// VALID, INVALID
// -----------------------------------------------------------
//
// The transactions as objects: the comment above the row, the
// coins spent, the transaction's bytes and the list of rules
// — those the transaction would break (valid), or those that
// make it invalid.
// -----------------------------------------------------------

export const VALID = withComments(valid);

export const INVALID = withComments(invalid);







// -----------------------------------------------------------
// ASSETS
// -----------------------------------------------------------
//
// The Taproot cases, as they stand in the file: `tx` and
// `prevouts` in bytes, `index`, `flags` as one text, the
// scenario's name in `comment`, `final` where the spend that
// must pass passes under any rules, and `success` and
// `failure` — each an unlocking script and a witness.
// -----------------------------------------------------------

export const ASSETS = assets;







// -----------------------------------------------------------
// readTransaction
// -----------------------------------------------------------
//
// A transaction read back from its bytes into the shape the
// engine works with: version, inputs — the transaction and
// output each spends, its unlocking script, its sequence
// number and its witness — outputs and lock time. Both
// serializations are read: the original one, and the one with
// two marker bytes after the version and the witnesses in
// front of the lock time. Numbers are read lowest byte first;
// the id of the transaction an input names is turned the way
// ids are written.
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
  const marked = hex.slice(at, at + 4) === '0001';
  if (marked) take(2);

  const inputs = Array.from({ length: count() }, () => ({ txid: reverseBytes(take(32)), vout: number(4), script: take(count()), sequence: number(4), witness: [] }));
  const outputs = Array.from({ length: count() }, () => ({ value: number(8), script: take(count()) }));
  if (marked) {
    for (const input of inputs) input.witness = Array.from({ length: count() }, () => take(count()));
  }
  const lockTime = number(4);

  if (at !== hex.length) throw new Error('bytes left over after the transaction');
  return { version, inputs, outputs, lockTime };
}







// -----------------------------------------------------------
// runTransaction
// -----------------------------------------------------------
//
// One transaction of VALID or INVALID through the engine:
// every input's unlocking script and witness against the lock
// of the coin it names — a coin's amount is the fourth thing
// a row says of it, where its lock needs one, and Core's file
// writes the output number of a coin that is none as minus
// one. Hands back whether all of them are accepted and, when
// one is not, the engine's error for it.
// -----------------------------------------------------------

export function runTransaction({ coins, hex }) {
  const transaction = readTransaction(hex);
  const named = transaction.inputs.map((input) => coins.find(([txid, vout]) => txid === input.txid && (vout === input.vout || (vout === -1 && input.vout === 0xffffffff))));
  if (named.includes(undefined)) return { ok: false, error: 'no-such-coin' };

  const spent = named.map(([, , lock, value = 0]) => ({ value, script: scriptBytes(lock) }));

  for (const index of transaction.inputs.keys()) {
    const result = runInput(transaction, index, spent);
    if (!result.ok) return result;
  }
  return { ok: true, error: null };
}







// -----------------------------------------------------------
// runAsset
// -----------------------------------------------------------
//
// One way of filling in the input of a Taproot case — its
// `success` or its `failure` — through the engine: the
// unlocking script and the witness go into the input under
// test, the coins are read from their bytes, and the engine
// decides on that input alone, as Core's test does.
// -----------------------------------------------------------

export function runAsset({ tx, prevouts, index }, { scriptSig, witness }) {
  const read = readTransaction(tx);
  const transaction = { ...read, inputs: read.inputs.map((input, at) => (at === index ? { ...input, script: scriptSig, witness } : input)) };
  const spent = prevouts.map((hex) => {
    const sized = hex.slice(16, 18) === 'fd' ? 22 : 18;
    return { value: Number(BigInt(`0x${reverseBytes(hex.slice(0, 16))}`)), script: hex.slice(sized) };
  });

  return runInput(transaction, index, spent);
}

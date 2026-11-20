// -----------------------------------------------------------
//  [*] BitcoinScript — a transaction as bytes
//
//  A transaction is a version, a list of inputs, a list of
//  outputs and a lock time. An input names the coin it spends
//  — an earlier transaction's id and the number of one of its
//  outputs — and carries the script that unlocks it; an
//  output is an amount in satoshis and the script that locks
//  it. This file writes that down byte for byte as the
//  network does (the original format, without witness data),
//  and derives the two hashes everything else hangs on:
//
//    - the id, the double SHA-256 of those bytes, shown back
//      to front as every explorer shows it. Change one byte
//      of a transaction and it is another transaction, and
//      whoever spends its coins must name the new id
//    - the signature hash, the message OP_CHECKSIG checks a
//      signature against. It is the double SHA-256 of a COPY
//      of the spending transaction in which the input being
//      signed carries the script it has to satisfy and every
//      other input carries none — a signature cannot sign
//      itself, so the unlocking scripts are left out — with
//      the signature's type written after it. Everything
//      else is in: which coin is spent, where the money goes
//      and how much, and the lock time. That is why a signed
//      transaction cannot be changed.
//
//  Only the type that signs all of the transaction
//  (SIGHASH_ALL) is built here; it is the one wallets use.
//
//  Split into:
//
//    SIGHASH_ALL          — the signature type built here
//    serializeTransaction — the bytes of a transaction
//    transactionId        — its id, as shown
//    signatureHash        — the message a signature signs
// -----------------------------------------------------------

import { byteLength, compactSize, reverseBytes, uintLE } from './bytes';
import { hash256 } from './hashes';







// -----------------------------------------------------------
// SIGHASH_ALL
// -----------------------------------------------------------
//
// The type byte of a signature that commits to every input
// and every output of its transaction.
//
// Used by:
//   - signatureHash (below)
//   - node.js — the one type a signature may carry here
// -----------------------------------------------------------

export const SIGHASH_ALL = 0x01;







// -----------------------------------------------------------
// serializeTransaction
// -----------------------------------------------------------
//
// The bytes of a transaction: every number lowest byte
// first, every list and every script behind its length, and
// the id of each spent coin's transaction turned round from
// the way it is shown.
//
// Used by:
//   - transactionId, signatureHash (below)
//   - model.js — the raw transactions the page shows
// -----------------------------------------------------------

export function serializeTransaction({ version, inputs, outputs, lockTime }) {
  const script = (hex) => `${compactSize(byteLength(hex))}${hex}`;

  return [
    uintLE(version, 4),
    compactSize(inputs.length),
    ...inputs.map((input) => `${reverseBytes(input.txid)}${uintLE(input.vout, 4)}${script(input.script)}${uintLE(input.sequence, 4)}`),
    compactSize(outputs.length),
    ...outputs.map((output) => `${uintLE(output.value, 8)}${script(output.script)}`),
    uintLE(lockTime, 4),
  ].join('');
}







// -----------------------------------------------------------
// transactionId
// -----------------------------------------------------------
//
// A transaction's id: the double SHA-256 of its bytes, in the
// order people read it.
//
// Used by:
//   - model.js — both transactions' ids
// -----------------------------------------------------------

export const transactionId = (transaction) => reverseBytes(hash256(serializeTransaction(transaction)));







// -----------------------------------------------------------
// signatureHash
// -----------------------------------------------------------
//
// The 32 bytes a signature of one input signs (see the file
// header): the transaction with that input's script replaced
// by the script it must satisfy, the other inputs' scripts
// emptied, and the signature type after the lock time.
//
// Used by:
//   - model.js — what the page's people sign
//   - node.js — what OP_CHECKSIG checks a signature against
// -----------------------------------------------------------

export function signatureHash(transaction, inputIndex, scriptCodeHex) {
  const copy = {
    ...transaction,
    inputs: transaction.inputs.map((input, index) => ({ ...input, script: index === inputIndex ? scriptCodeHex : '' })),
  };
  return hash256(`${serializeTransaction(copy)}${uintLE(SIGHASH_ALL, 4)}`);
}

// -----------------------------------------------------------
//  [*] BitcoinScript — a transaction as bytes
//
//  A transaction is a version, a list of inputs, a list of
//  outputs and a lock time. An input names the coin it spends
//  — an earlier transaction's id and the number of one of its
//  outputs — and carries the script that unlocks it; an
//  output is an amount in satoshis and the script that locks
//  it. Since 2017 an input may also carry a witness: a list
//  of plain byte strings that travels beside the transaction
//  and is where the newer kinds of lock look for what opens
//  them. This file writes all of that down byte for byte as
//  the network does — with the witnesses or, as the original
//  format has it, without — and derives the hashes
//  everything else hangs on:
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
//  The id never covers the witnesses — which is the point of
//  keeping them apart: a signature can no longer change the
//  id of the transaction it signs. A second id, over all the
//  bytes, tells two copies with different witnesses apart.
//
//  The newer locks sign a message of their own. The one for
//  the first version of witness programs (BIP 143) hashes the
//  spent coins, the sequence numbers and the outputs once for
//  the whole transaction, and adds what the old message could
//  not hold: the amount of the coin being spent. Taproot's
//  (BIP 341) goes further and covers the amounts and the
//  locks of every coin the transaction spends, says whether
//  the coin is opened by its key or by a script, and — for a
//  script — which one.
//
//  A signature says, in its last byte, how much of the
//  transaction it signs. Nearly every signature signs all of
//  it (SIGHASH_ALL; Taproot's default type signs the same and
//  costs one byte less), and those are the only ones the page
//  itself makes. The other types are here because a node has
//  to read them: a signature may leave the outputs out
//  (NONE), sign only the output that stands at its own
//  input's place (SINGLE), and — with either, or with ALL —
//  sign its own input alone and let anybody add more
//  (ANYONECANPAY).
//
//  Split into:
//
//    SIGHASH_ALL … SIGHASH_ANYONECANPAY — the signature types
//    serializeTransaction — the bytes of a transaction
//    transactionId        — its id, as shown
//    witnessId            — its id with the witnesses in
//    signatureHash        — the message a signature signs
//    witnessSignatureHash — the same, for a witness program
//                           of version 0
//    taprootSignatureHash — the same, for Taproot
// -----------------------------------------------------------

import { byteLength, compactSize, reverseBytes, uintLE } from './bytes';
import { hash256, sha256Hex, taggedHash } from './hashes';







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
// SIGHASH_DEFAULT
// -----------------------------------------------------------
//
// Taproot's own type for the same thing: a signature without
// a type byte at all commits to every input and every output.
//
// Used by:
//   - taprootSignatureHash (below)
//   - node.js — the type of a 64-byte Schnorr signature
// -----------------------------------------------------------

export const SIGHASH_DEFAULT = 0x00;







// -----------------------------------------------------------
// SIGHASH_NONE
// -----------------------------------------------------------
//
// The type of a signature that signs the inputs and none of
// the outputs: whoever holds it may send the money anywhere.
//
// Used by:
//   - signatureHash, witnessSignatureHash,
//     taprootSignatureHash (below)
// -----------------------------------------------------------

export const SIGHASH_NONE = 0x02;







// -----------------------------------------------------------
// SIGHASH_SINGLE
// -----------------------------------------------------------
//
// The type of a signature that signs, of the outputs, only
// the one with the same number as its own input.
//
// Used by:
//   - signatureHash, witnessSignatureHash,
//     taprootSignatureHash (below)
// -----------------------------------------------------------

export const SIGHASH_SINGLE = 0x03;







// -----------------------------------------------------------
// SIGHASH_ANYONECANPAY
// -----------------------------------------------------------
//
// The bit that, added to any of the types, makes a signature
// sign its own input alone — other inputs can be added to the
// transaction without breaking it.
//
// Used by:
//   - signatureHash, witnessSignatureHash,
//     taprootSignatureHash (below)
// -----------------------------------------------------------

export const SIGHASH_ANYONECANPAY = 0x80;







// -----------------------------------------------------------
// serializeTransaction
// -----------------------------------------------------------
//
// The bytes of a transaction: every number lowest byte
// first, every list and every script behind its length, and
// the id of each spent coin's transaction turned round from
// the way it is shown. Asked for the witnesses too, and when
// an input has one, the bytes are the newer form: two marker
// bytes after the version, and every input's witness — the
// count of its items, then each behind its length — in front
// of the lock time.
//
// Used by:
//   - transactionId, witnessId, signatureHash (below)
//   - model.js — the raw transactions the page shows
// -----------------------------------------------------------

export function serializeTransaction({ version, inputs, outputs, lockTime }, { witnesses = false } = {}) {
  const script = (hex) => `${compactSize(byteLength(hex))}${hex}`;
  const carried = witnesses && inputs.some((input) => (input.witness ?? []).length > 0);

  return [
    uintLE(version, 4),
    carried ? '0001' : '',
    compactSize(inputs.length),
    ...inputs.map((input) => `${reverseBytes(input.txid)}${uintLE(input.vout, 4)}${script(input.script)}${uintLE(input.sequence, 4)}`),
    compactSize(outputs.length),
    ...outputs.map((output) => `${uintLE(output.value, 8)}${script(output.script)}`),
    ...(carried ? inputs.map((input) => `${compactSize((input.witness ?? []).length)}${(input.witness ?? []).map(script).join('')}`) : []),
    uintLE(lockTime, 4),
  ].join('');
}







// -----------------------------------------------------------
// transactionId
// -----------------------------------------------------------
//
// A transaction's id: the double SHA-256 of its bytes without
// any witness, in the order people read it.
//
// Used by:
//   - model.js — both transactions' ids
// -----------------------------------------------------------

export const transactionId = (transaction) => reverseBytes(hash256(serializeTransaction(transaction)));







// -----------------------------------------------------------
// witnessId
// -----------------------------------------------------------
//
// A transaction's second id: the double SHA-256 of all of its
// bytes, witnesses included. Without a witness it is the id.
//
// Used by:
//   - model.js — transaction B's id with its witness
// -----------------------------------------------------------

export const witnessId = (transaction) => reverseBytes(hash256(serializeTransaction(transaction, { witnesses: true })));







// -----------------------------------------------------------
// signatureHash
// -----------------------------------------------------------
//
// The 32 bytes a signature of one input signs (see the file
// header): the transaction with that input's script replaced
// by the script it must satisfy, the other inputs' scripts
// emptied, and the signature type after the lock time.
//
// The type changes the copy. With NONE it has no outputs;
// with SINGLE only the outputs up to this input's own, the
// earlier ones blanked; with either, the other inputs' own
// sequence numbers are zeroed, so they may still change.
// With ANYONECANPAY this input is the copy's only one. And a
// SINGLE signature in an input that has no output of its own
// number signs the number one — a slip of the first Bitcoin
// program that every node has repeated ever since.
//
// Used by:
//   - model.js — what the page's people sign
//   - node.js — what OP_CHECKSIG checks a signature against
// -----------------------------------------------------------

export function signatureHash(transaction, inputIndex, scriptCodeHex, type = SIGHASH_ALL) {
  const outputs = type & 0x1f;
  const quiet = outputs === SIGHASH_NONE || outputs === SIGHASH_SINGLE;
  if (outputs === SIGHASH_SINGLE && inputIndex >= transaction.outputs.length) return `01${'00'.repeat(31)}`;

  const copy = {
    ...transaction,
    inputs: transaction.inputs
      .map((input, index) => ({ ...input, script: index === inputIndex ? scriptCodeHex : '', sequence: quiet && index !== inputIndex ? 0 : input.sequence }))
      .filter((_, index) => !(type & SIGHASH_ANYONECANPAY) || index === inputIndex),
    outputs: outputs === SIGHASH_NONE ? []
      : outputs === SIGHASH_SINGLE ? transaction.outputs.slice(0, inputIndex + 1).map((output, index) => (index === inputIndex ? output : { value: -1, script: '' }))
        : transaction.outputs,
  };
  return hash256(`${serializeTransaction(copy)}${uintLE(type, 4)}`);
}







// -----------------------------------------------------------
// witnessSignatureHash
// -----------------------------------------------------------
//
// The 32 bytes a signature signs when the coin is locked to a
// witness program of version 0 (BIP 143): the version, one
// hash of every spent coin's name, one of every sequence
// number, then this input — its coin's name, the script it
// has to satisfy, the AMOUNT of its coin, its sequence number
// — one hash of every output, the lock time and the
// signature's type. What a type leaves unsigned is a run of
// zeros in the place of its hash: the coins' names with
// ANYONECANPAY, the sequence numbers with that or with NONE
// or SINGLE, the outputs with NONE — and with SINGLE the hash
// is of this input's own output alone, or zeros when there is
// none.
//
// Used by:
//   - model.js — what the page's people sign
//   - node.js — what OP_CHECKSIG checks a signature against
// -----------------------------------------------------------

export function witnessSignatureHash(transaction, inputIndex, scriptCodeHex, amount, type = SIGHASH_ALL) {
  const coinOf = (input) => `${reverseBytes(input.txid)}${uintLE(input.vout, 4)}`;
  const sized = (hex) => `${compactSize(byteLength(hex))}${hex}`;
  const written = (output) => `${uintLE(output.value, 8)}${sized(output.script)}`;
  const nothing = '00'.repeat(32);

  const input = transaction.inputs[inputIndex];
  const outputs = type & 0x1f;
  const alone = Boolean(type & SIGHASH_ANYONECANPAY);
  const whole = outputs !== SIGHASH_NONE && outputs !== SIGHASH_SINGLE;

  return hash256([
    uintLE(transaction.version, 4),
    alone ? nothing : hash256(transaction.inputs.map(coinOf).join('')),
    alone || !whole ? nothing : hash256(transaction.inputs.map((each) => uintLE(each.sequence, 4)).join('')),
    coinOf(input),
    sized(scriptCodeHex),
    uintLE(amount, 8),
    uintLE(input.sequence, 4),
    whole ? hash256(transaction.outputs.map(written).join(''))
      : outputs === SIGHASH_SINGLE && inputIndex < transaction.outputs.length ? hash256(written(transaction.outputs[inputIndex])) : nothing,
    uintLE(transaction.lockTime, 4),
    uintLE(type, 4),
  ].join(''));
}







// -----------------------------------------------------------
// taprootSignatureHash
// -----------------------------------------------------------
//
// The 32 bytes a Schnorr signature signs for a Taproot coin
// (BIP 341). `spent` is every coin the transaction spends, in
// the order of its inputs — amount and lock each. The message
// holds the signature's type, the version and lock time, one
// hash each of the spent coins' names, their amounts, their
// locks, the sequence numbers and the outputs, then how the
// coin is opened — by its key, or by a script, and whether an
// annex rides along — and the number of the input. For a
// script it ends with the leaf's hash and the place of the
// last OP_CODESEPARATOR that was run. All of it is hashed
// under the name "TapSighash".
//
// The types leave things out rather than zero them: with
// ANYONECANPAY the four hashes over all inputs go, and this
// input's own coin — name, amount, lock, sequence number —
// stands in the place of its number; with NONE or SINGLE the
// hash of the outputs goes, and SINGLE ends with the hash of
// this input's own output. A type Taproot does not know, and
// SINGLE without such an output, give no message at all.
//
// Used by:
//   - model.js — what the page's people sign
//   - node.js — what a Taproot spend's signatures are checked
//     against
// -----------------------------------------------------------

export function taprootSignatureHash(transaction, inputIndex, spent, { hashType = SIGHASH_DEFAULT, annex = null, leaf = null, separator = 0xffffffff } = {}) {
  const sized = (hex) => `${compactSize(byteLength(hex))}${hex}`;
  const coinOf = (input) => `${reverseBytes(input.txid)}${uintLE(input.vout, 4)}`;
  const written = (output) => `${uintLE(output.value, 8)}${sized(output.script)}`;

  const outputs = hashType === SIGHASH_DEFAULT ? SIGHASH_ALL : hashType & 0x03;
  const alone = Boolean(hashType & SIGHASH_ANYONECANPAY);
  const input = transaction.inputs[inputIndex];
  if (![0x00, 0x01, 0x02, 0x03, 0x81, 0x82, 0x83].includes(hashType)) return null;
  if (outputs === SIGHASH_SINGLE && inputIndex >= transaction.outputs.length) return null;

  return taggedHash('TapSighash', [
    '00',
    uintLE(hashType, 1),
    uintLE(transaction.version, 4),
    uintLE(transaction.lockTime, 4),
    ...(alone ? [] : [
      sha256Hex(transaction.inputs.map(coinOf).join('')),
      sha256Hex(spent.map((coin) => uintLE(coin.value, 8)).join('')),
      sha256Hex(spent.map((coin) => sized(coin.script)).join('')),
      sha256Hex(transaction.inputs.map((each) => uintLE(each.sequence, 4)).join('')),
    ]),
    outputs === SIGHASH_ALL ? sha256Hex(transaction.outputs.map(written).join('')) : '',
    uintLE((leaf ? 2 : 0) + (annex ? 1 : 0), 1),
    alone ? `${coinOf(input)}${uintLE(spent[inputIndex].value, 8)}${sized(spent[inputIndex].script)}${uintLE(input.sequence, 4)}` : uintLE(inputIndex, 4),
    annex ? sha256Hex(sized(annex)) : '',
    outputs === SIGHASH_SINGLE ? sha256Hex(written(transaction.outputs[inputIndex])) : '',
    leaf ? `${leaf}00${uintLE(separator, 4)}` : '',
  ].join(''));
}

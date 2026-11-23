// -----------------------------------------------------------
//  [*] BitcoinScript — what a full node checks
//
//  A node that is handed a transaction does not ask who sent
//  it. It asks four things of every input, in this order, and
//  stops at the first no — the cheap questions first, the
//  scripts last:
//
//    1. the coin    — is the output the input names in the
//                     node's set of unspent outputs: does it
//                     exist, and has nobody spent it yet
//    2. the amounts — do the outputs give away no more than
//                     the coin holds; what is left over is
//                     the miner's fee
//    3. the time    — may the transaction be in the next
//                     block at all, or does its lock time
//                     still hold it back — the absolute one,
//                     a block the chain must have reached,
//                     or the relative one, an age the coin
//                     must have reached
//    4. the script  — does the input's unlocking script open
//                     the coin's lock (interpreter.js)
//
//  The answer is a timeline: one entry per question asked,
//  every step of the script run in between, and a verdict at
//  the end that names the question the transaction fell at.
//  The page plays the timeline back; nothing is decided
//  anywhere else.
//
//  The script machine itself knows no transaction. The three
//  things it has to ask one — a signature, a lock time and a
//  relative lock time — are answered here (checkerFor), with
//  the network's rules: a signature must be DER or the script
//  is broken, an empty one simply does not sign, and only
//  signatures of the whole transaction are understood; a lock
//  time in a script is compared with the transaction's own,
//  of the same kind, in an input that has not switched lock
//  times off; and a relative lock time in a script is
//  compared with the sequence number of the very input that
//  spends the coin, again of the same kind.
//
//  A relative lock time works in two layers. The script only
//  demands that the input's sequence number promises a wait
//  of at least so many blocks; the node then holds the
//  transaction to that promise — it stays out of a block
//  until the coin is that many blocks old. A coin's age is
//  counted in confirmations: the block that holds it is the
//  first.
//
//  Only lock times that count blocks are handled. One that
//  names a date, or a relative one that counts seconds, is
//  turned away as such — the playground has no clock.
//
//  Split into:
//
//    MAX_MONEY, LOCKTIME_THRESHOLD, FINAL_SEQUENCE
//                 — the network's three magic numbers
//    SEQUENCE     — how a sequence number holds a relative
//                   lock time
//    hasBit       — whether a number has one of those bits
//    checkerFor   — what the script machine asks of the
//                   spending transaction
//    verifySpend  — the four questions, as a timeline
// -----------------------------------------------------------

import { evaluateSpend } from './interpreter';
import { isPublicKey, isStrictDer, verifyDigest } from './secp256k1';
import { SIGHASH_ALL, signatureHash } from './transaction';







// -----------------------------------------------------------
// MAX_MONEY
// -----------------------------------------------------------
//
// All the bitcoin there will ever be, in satoshis. No output
// and no sum of outputs may exceed it.
//
// Used by:
//   - verifySpend (below)
//   - model.js — the largest amount a field may hold
// -----------------------------------------------------------

export const MAX_MONEY = 21_000_000 * 100_000_000;







// -----------------------------------------------------------
// LOCKTIME_THRESHOLD
// -----------------------------------------------------------
//
// Where a lock time stops counting blocks and starts being a
// date: below it a block height, from it on seconds since
// 1970.
//
// Used by:
//   - checkerFor, verifySpend (below)
//   - model.js — the lock time field's limit
// -----------------------------------------------------------

export const LOCKTIME_THRESHOLD = 500_000_000;







// -----------------------------------------------------------
// FINAL_SEQUENCE
// -----------------------------------------------------------
//
// The sequence number of an input that takes no part in lock
// times. A transaction whose inputs all carry it is final
// whatever its lock time says.
//
// Used by:
//   - checkerFor, verifySpend (below)
//   - model.js — the sequence of the spending input
// -----------------------------------------------------------

export const FINAL_SEQUENCE = 0xffffffff;







// -----------------------------------------------------------
// SEQUENCE
// -----------------------------------------------------------
//
// How an input's sequence number holds a relative lock time:
// the bit that switches it off altogether, the bit that says
// it counts 512-second steps instead of blocks, and how many
// values the count itself has — it is the number's lowest
// sixteen bits.
//
// Used by:
//   - checkerFor, verifySpend (below)
//   - model.js — what a typed sequence number means
// -----------------------------------------------------------

export const SEQUENCE = { DISABLED: 2 ** 31, SECONDS: 2 ** 22, COUNTS: 2 ** 16 };







// -----------------------------------------------------------
// hasBit
// -----------------------------------------------------------
//
// Whether a whole number that is not negative has one bit —
// given as that bit's own value — set. Done with division:
// the number a script hands over may be longer than the
// thirty-two bits the language's own bit operators keep.
//
// Used by:
//   - checkerFor, verifySpend (below)
//   - model.js — what a typed sequence number means
// -----------------------------------------------------------

export const hasBit = (value, bit) => Math.floor(value / bit) % 2 === 1;







// -----------------------------------------------------------
// checkerFor
// -----------------------------------------------------------
//
// The three answers the script machine needs from the
// spending transaction, for one of its inputs.
//
// A signature check says whether the signature is valid and,
// when it is not, why: empty, a public key that is no key,
// or simply not this key's signature of this transaction. It
// also hands back the message that was checked, for the page
// to show. Bytes that are no DER signature, and a signature
// of a type other than "all", are not a no but a fault — the
// script stops there.
//
// A lock time check hands back the transaction's lock time
// and, when the script's demand is not met, why not.
//
// A relative lock time check hands back the input's sequence
// number and, when the demand is not met, why not: a negative
// wait, a transaction of the first version, an input that has
// switched relative lock times off, a wait counted in the
// other kind of unit, or a sequence number that promises too
// short a wait. A demand that itself has the switched-off bit
// set asks nothing — the check then says it stood idle.
//
// Used by:
//   - verifySpend (below)
// -----------------------------------------------------------

export function checkerFor(transaction, inputIndex) {
  return {
    checkSignature(signature, publicKey, scriptCode) {
      if (signature === '') return { valid: false, why: 'empty-signature' };

      const type = parseInt(signature.slice(-2), 16);
      const der = signature.slice(0, -2);
      if (!isStrictDer(der)) return { fault: { code: 'signature-encoding' } };
      if (type !== SIGHASH_ALL) return { fault: { code: 'signature-type', type } };

      const digest = signatureHash(transaction, inputIndex, scriptCode);
      if (!isPublicKey(publicKey)) return { valid: false, digest, why: 'bad-public-key' };

      const valid = verifyDigest(der, digest, publicKey);
      return { valid, digest, why: valid ? null : 'wrong-signature' };
    },

    checkLockTime(required) {
      const { lockTime } = transaction;
      const sameKind = (required < LOCKTIME_THRESHOLD) === (lockTime < LOCKTIME_THRESHOLD);

      if (required < 0) return { lockTime, why: 'negative' };
      if (!sameKind) return { lockTime, why: 'different-kind' };
      if (required > lockTime) return { lockTime, why: 'too-early' };
      if (transaction.inputs[inputIndex].sequence === FINAL_SEQUENCE) return { lockTime, why: 'final-sequence' };
      return { lockTime, why: null };
    },

    checkSequence(required) {
      const { sequence } = transaction.inputs[inputIndex];

      if (required < 0) return { sequence, why: 'negative' };
      if (hasBit(required, SEQUENCE.DISABLED)) return { sequence, why: null, idle: true };
      if (transaction.version < 2) return { sequence, why: 'old-version' };
      if (hasBit(sequence, SEQUENCE.DISABLED)) return { sequence, why: 'switched-off' };
      if (hasBit(required, SEQUENCE.SECONDS) !== hasBit(sequence, SEQUENCE.SECONDS)) return { sequence, why: 'different-kind' };
      if (required % SEQUENCE.COUNTS > sequence % SEQUENCE.COUNTS) return { sequence, why: 'too-early' };
      return { sequence, why: null };
    },
  };
}







// -----------------------------------------------------------
// verifySpend
// -----------------------------------------------------------
//
// Puts a spending transaction's input through the node's
// four questions (see the file header) and hands back the
// timeline and the outcome. The caller says what the node
// knows: the coin the input names — whether it is in the set
// of unspent outputs, its amount, its lock and the height of
// the block that holds it — the unlocking script as items and
// bytes, how high the chain stands, and the most money there
// can be on this chain. A coin that is not there has no
// amount and no lock; the timeline ends at the first
// question.
//
// The third question has two halves, asked in this order: the
// transaction's own lock time, and — for a transaction of the
// second version whose input has not switched it off — the
// relative lock time in the input's sequence number, which
// the coin's age has to have reached. The next block is the
// one the transaction would go into, so a coin that is in the
// chain's last block has one confirmation.
//
// Used by:
//   - model.js — the verification the page plays back
// -----------------------------------------------------------

export function verifySpend({ transaction, inputIndex = 0, coin, unlock, height, maxMoney = MAX_MONEY }) {
  const timeline = [];
  const outpoint = { txid: transaction.inputs[inputIndex].txid, vout: transaction.inputs[inputIndex].vout };

  const reject = (stage, error, stack = []) => {
    timeline.push({ stage: 'verdict', ok: false, failed: stage, error, stack });
    return { timeline, valid: false, failed: stage, error };
  };

  // 1. The coin
  const unspent = coin.found && !coin.spent;
  const coinError = unspent ? null : { code: coin.found ? 'already-spent' : 'no-such-coin' };
  timeline.push({ stage: 'coin', ok: unspent, outpoint, error: coinError });
  if (!unspent) return reject('coin', coinError);

  // 2. The amounts
  const spent = transaction.outputs.reduce((sum, output) => sum + output.value, 0);
  const tooMuch = [coin.value, spent, ...transaction.outputs.map((output) => output.value)].some((value) => value > maxMoney);
  const amountsError = tooMuch ? { code: 'too-much-money' } : spent > coin.value ? { code: 'overspend' } : null;
  timeline.push({ stage: 'amounts', ok: amountsError === null, input: coin.value, output: spent, fee: coin.value - spent, error: amountsError });
  if (amountsError) return reject('amounts', amountsError);

  // 3. The time: a height that the next block has passed, or
  // inputs that have all switched lock times off
  const { lockTime } = transaction;
  const switchedOff = transaction.inputs.every((input) => input.sequence === FINAL_SEQUENCE);
  const why = lockTime === 0 ? 'none'
    : switchedOff ? 'switched-off'
      : lockTime >= LOCKTIME_THRESHOLD ? 'a-date'
        : lockTime <= height ? 'reached' : 'too-early';
  const lockTimeError = why === 'a-date' || why === 'too-early' ? { code: `locktime-${why}` } : null;

  // ... and the coin's age, when the input asks for one
  const { sequence } = transaction.inputs[inputIndex];
  const relative = transaction.version >= 2 && !hasBit(sequence, SEQUENCE.DISABLED);
  const wait = relative ? sequence % SEQUENCE.COUNTS : 0;
  const confirmations = relative ? height - coin.height + 1 : null;
  const age = !relative ? 'none' : hasBit(sequence, SEQUENCE.SECONDS) ? 'seconds' : wait <= confirmations ? 'reached' : 'too-early';
  const ageError = age === 'seconds' ? { code: 'sequence-seconds' } : age === 'too-early' ? { code: 'sequence-too-early', wait, confirmations } : null;

  const finalityError = lockTimeError ?? ageError;
  timeline.push({ stage: 'finality', ok: finalityError === null, lockTime, height, why, sequence, wait, confirmations, age, error: finalityError });
  if (finalityError) return reject('finality', finalityError);

  // 4. The script
  const run = evaluateSpend({ unlock, lock: coin.lock, checker: checkerFor(transaction, inputIndex) });
  for (const step of run.steps.slice(0, -1)) timeline.push({ stage: 'script', ...step });
  if (!run.ok) return reject('script', run.error, run.steps.at(-1).stack);

  timeline.push({ stage: 'verdict', ok: true, failed: null, error: null, stack: run.steps.at(-1).stack });
  return { timeline, valid: true, failed: null, error: null };
}

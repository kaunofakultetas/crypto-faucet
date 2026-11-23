// -----------------------------------------------------------
//  [*] BitcoinScript — the stack machine
//
//  What a full node does with the two scripts of a spend, one
//  item at a time, and a record of every step of it — the
//  page plays that record back; it never runs anything itself.
//
//  The node runs the unlocking script first, on an empty
//  stack. Whatever that leaves is carried over, and the
//  locking script runs on it. A coin is unlocked when nothing
//  failed on the way and the stack ends with a true value on
//  top. For one shape of lock — pay to script hash — there is
//  a third act: the lock only compared a hash, so the node
//  goes back to the stack as the unlocking script left it,
//  takes the top item off as a script in its own right (the
//  redeem script), runs that on the rest, and asks for a true
//  top once more.
//
//  Since 2017 a lock may be a witness program instead: a
//  version and a few bytes, which the node does not run but
//  reads. What opens such a lock travels beside the
//  transaction, in the input's witness — a list of plain byte
//  strings — and the unlocking script must stay empty. The
//  version says what the bytes are and what happens next:
//
//    - version 0, twenty bytes: a public key's hash. The
//      witness is a signature and a key, and the node builds
//      the old pay-to-key-hash script itself and runs it on
//      them
//    - version 0, thirty-two bytes: a script's SHA-256. The
//      last item of the witness is that script; the items in
//      front of it are the stack it is run on
//    - version 1, thirty-two bytes: a Taproot key. One item
//      in the witness is a signature for that key, checked
//      with no script at all. More items end in a script and
//      a control block — the proof that the script is hidden
//      in the key (taproot.js) — and the script is run on the
//      rest, by rules of its own
//    - anything else is a program nobody has given rules yet:
//      it is accepted as it stands, so that a later upgrade
//      can give it some
//
//  A witness program may also sit behind a script hash, as a
//  redeem script — the form old wallets could pay to — and is
//  then read the same way once the hash has matched; Taproot
//  alone has no such form. A script run from a witness must
//  end with exactly one item, a true one, and a witness
//  nobody asked for fails the spend.
//
//  The rules a script is run by depend on where it came from.
//  The original rules hold for everything outside a witness.
//  A script of a version-0 program is run by the same rules,
//  and only its signatures sign a different message. A
//  Taproot script — tapscript — changes more: signatures are
//  Schnorr signatures; OP_CHECKMULTISIG is gone and
//  OP_CHECKSIGADD counts signatures in its place; a wrong
//  signature ends the script at once, and only an empty one
//  is a plain "no"; OP_IF takes nothing but an empty value or
//  a single one; the opcodes that were switched off or never
//  given a meaning make a script that contains one succeed
//  outright, each a door for a later upgrade; and the old
//  limits on a script's size and on how many operations it
//  runs give way to a budget of signature checks that grows
//  with the size of the witness.
//
//  The machine knows nothing about transactions. The
//  questions that need one — does this signature sign the
//  spending transaction, is its lock time late enough, and
//  does its input promise a long enough wait — it puts to a
//  checker the caller hands in (node.js builds it from the
//  transaction).
//
//  The rules are the network's own: Script's numbers and its
//  idea of true; opcodes that fail a script by merely being
//  in it; the limits on a script's size, on one push, on how
//  many operations run and how deep the stacks grow; the
//  empty item OP_CHECKMULTISIG takes one too many of.
//
//  Two of them decide which script a signature is checked
//  against, and both are older than anybody's use for them.
//  OP_CODESEPARATOR moves the beginning of that script to the
//  place it stands at, so a signature signs only what comes
//  after the last one that was run — in a tapscript the
//  signature signs the number of that place instead. And
//  under the original rules every push of the signature
//  itself is taken out of the script first: a signature
//  cannot sign bytes that hold it.
//
//  Every step holds the stack as it stood AFTER it — or, for
//  the step that failed, as it stood before, untouched — so
//  the page can move back and forth through a run freely. A
//  failure is a code and the pieces a sentence about it
//  needs; the sentences are the page's (narration.js).
//
//  Split into:
//
//    LIMITS, TRUE, FALSE — the network's limits, Script's
//                          two truth values
//    SIGNATURE_WEIGHT — what one signature costs a tapscript
//    Fault        — what stops a script
//    verdictOn    — the last look at the top of the stack
//    isOpSuccess  — the opcodes that end a tapscript well
//    witnessSize  — a witness's size in a transaction
//    runScript    — one script, item by item
//    evaluateSpend — the unlocking script, the lock, and
//                    whatever script stands behind a hash, in
//                    a witness or in a Taproot key
// -----------------------------------------------------------

import { byteLength, compactSize } from './bytes';
import { hash160, hash256, ripemd160Hex, sha1Hex, sha256Hex } from './hashes';
import { PAY_TO_SCRIPT_HASH, isPushOnly, isTrue, numberHex, numberOf, pushOf, readScript, withoutPush, witnessProgramOf } from './script';
import { TAPSCRIPT, readControlBlock } from './taproot';


// The network's limits on a script: its size and one push in
// bytes, how many opcodes beyond the pushes it may hold, how
// many items the two stacks may hold together, and how many
// keys one OP_CHECKMULTISIG may name
const LIMITS = { script: 10_000, push: 520, operations: 201, stack: 1000, keys: 20 };

// What every signature a tapscript checks takes out of its
// budget — which starts at the size of the witness in bytes
// and this much more
const SIGNATURE_WEIGHT = 50;

// What a tapscript's signatures sign in the place of an
// OP_CODESEPARATOR's number while none has been run
const NO_SEPARATOR = 0xffffffff;

// What a comparison that holds leaves on the stack: the
// number one
const TRUE = '01';

// What one that does not hold leaves: no bytes at all
const FALSE = '';

// The opcodes that open, turn and close a branch — looked at
// even inside a branch that is being skipped
const BRANCHING = new Set(['OP_IF', 'OP_NOTIF', 'OP_ELSE', 'OP_ENDIF']);

// The hashing opcodes and the function behind each
const HASHES = {
  OP_RIPEMD160: ripemd160Hex,
  OP_SHA1: sha1Hex,
  OP_SHA256: sha256Hex,
  OP_HASH160: hash160,
  OP_HASH256: hash256,
};

// The opcodes that take one number and leave one
const UNARY = {
  OP_1ADD: (a) => a + 1,
  OP_1SUB: (a) => a - 1,
  OP_NEGATE: (a) => -a,
  OP_ABS: (a) => Math.abs(a),
  OP_NOT: (a) => a === 0,
  OP_0NOTEQUAL: (a) => a !== 0,
};

// The opcodes that take two numbers — the lower one first —
// and leave a number or a truth value
const BINARY = {
  OP_ADD: (a, b) => a + b,
  OP_SUB: (a, b) => a - b,
  OP_BOOLAND: (a, b) => a !== 0 && b !== 0,
  OP_BOOLOR: (a, b) => a !== 0 || b !== 0,
  OP_NUMEQUAL: (a, b) => a === b,
  OP_NUMEQUALVERIFY: (a, b) => a === b,
  OP_NUMNOTEQUAL: (a, b) => a !== b,
  OP_LESSTHAN: (a, b) => a < b,
  OP_GREATERTHAN: (a, b) => a > b,
  OP_LESSTHANOREQUAL: (a, b) => a <= b,
  OP_GREATERTHANOREQUAL: (a, b) => a >= b,
  OP_MIN: (a, b) => Math.min(a, b),
  OP_MAX: (a, b) => Math.max(a, b),
};







// -----------------------------------------------------------
// Fault
// -----------------------------------------------------------
//
// What stops a script in the middle of an opcode: a code and
// the details a sentence about it needs. Thrown and caught
// inside this file only — to the caller a failed step is
// data, never an exception.
//
// Used by:
//   - runScript (below)
// -----------------------------------------------------------

class Fault extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}







// -----------------------------------------------------------
// verdictOn
// -----------------------------------------------------------
//
// The node's last look at a stack a script has finished on:
// nothing is wrong when there is something on it and the top
// is true; otherwise the answer names which of the two it
// was.
//
// Used by:
//   - evaluateSpend (below)
// -----------------------------------------------------------

function verdictOn(stack) {
  if (stack.length === 0) return { code: 'empty-stack' };
  return isTrue(stack.at(-1)) ? null : { code: 'false-on-top' };
}







// -----------------------------------------------------------
// isOpSuccess
// -----------------------------------------------------------
//
// Whether a byte is one of the opcodes that make a tapscript
// succeed by merely being in it: the ones the original rules
// switched off or never gave a meaning, and every byte past
// OP_CHECKSIGADD but the last. They are kept for upgrades —
// a later rule can give any of them a meaning without
// breaking a script that already uses it.
//
// Used by:
//   - evaluateSpend (below) — before a tapscript is run
// -----------------------------------------------------------

function isOpSuccess(code) {
  return code === 80 || code === 98 || (code >= 126 && code <= 129) || (code >= 131 && code <= 134)
    || (code >= 137 && code <= 138) || (code >= 141 && code <= 142) || (code >= 149 && code <= 153) || (code >= 187 && code <= 254);
}







// -----------------------------------------------------------
// witnessSize
// -----------------------------------------------------------
//
// How many bytes a witness takes in a transaction: the count
// of its items, and each item behind its length.
//
// Used by:
//   - evaluateSpend (below) — a tapscript's signature budget
// -----------------------------------------------------------

function witnessSize(witness) {
  return byteLength(compactSize(witness.length)) + witness.reduce((sum, item) => sum + byteLength(compactSize(byteLength(item))) + byteLength(item), 0);
}







// -----------------------------------------------------------
// runScript
// -----------------------------------------------------------
//
// Runs one script on the stacks it is given, appending a
// step to the record for every item — run, skipped inside a
// branch that was not taken, or failed. Hands back nothing
// when the script ran to its end, and the failure otherwise.
// A failed step leaves both stacks exactly as they were
// before it.
//
// `rules` says which rules the script is run by (see the file
// header): the original ones, those of a version-0 witness
// program, or tapscript. A tapscript also comes with the hash
// of its leaf, the annex if the witness had one, and its
// budget of signature checks.
//
// Used by:
//   - evaluateSpend (below) — once per script of a spend
// -----------------------------------------------------------

function runScript({ phase, items, hex, stack, alt, checker, steps, rules = 'legacy', leaf = null, annex = null, weight = 0 }) {
  const tapscript = rules === 'tapscript';
  if (!tapscript && byteLength(hex) > LIMITS.script) return { code: 'script-too-large', size: byteLength(hex), limit: LIMITS.script };

  const branches = [];
  let operations = 0;
  let budget = weight;
  // Where the script a signature is checked against begins,
  // in bytes, and the number of the item that moved it there
  let begins = 0;
  let separator = NO_SEPARATOR;

  const need = (count) => {
    if (stack.length < count) throw new Fault('stack-underflow', { needed: count, have: stack.length });
  };
  const pop = () => {
    need(1);
    return stack.pop();
  };
  const number = (bytes, maxBytes = 4) => {
    const value = numberOf(bytes, maxBytes);
    if (value === null) throw new Fault('number-too-long', { bytes: byteLength(bytes), limit: maxBytes });
    return value;
  };
  const leave = (value) => stack.push(typeof value === 'boolean' ? (value ? TRUE : FALSE) : numberHex(value));
  // A tapscript's signature check: a signature that is there
  // is paid for out of the budget first; no key at all breaks
  // the script; an empty signature is a plain no; a key that
  // is not thirty-two bytes is of a kind a later upgrade may
  // define, and passes; and a signature that does not fit its
  // key ends the script at once
  const askSchnorr = (signature, publicKey) => {
    if (signature !== '') {
      budget -= SIGNATURE_WEIGHT;
      if (budget < 0) throw new Fault('tapscript-budget');
    }
    if (publicKey === '') throw new Fault('tapscript-empty-key');
    if (signature === '') return { valid: false, digest: null, why: 'empty-signature' };
    if (byteLength(publicKey) !== 32) return { valid: true, digest: null, why: null };

    const answer = checker.checkSchnorr(signature, publicKey, { leaf, annex, separator });
    if (answer.fault) throw new Fault(answer.fault.code, answer.fault);
    return answer;
  };
  // The script the signatures of one opcode are checked
  // against: from the last OP_CODESEPARATOR on and, under the
  // original rules, without any push of those signatures
  const codeFor = (signatures) => {
    const code = hex.slice(begins * 2);
    return rules === 'legacy' ? signatures.reduceRight((kept, signature) => withoutPush(kept, signature), code) : code;
  };
  const ask = (signature, publicKey, code) => {
    if (tapscript) return askSchnorr(signature, publicKey);

    const answer = checker.checkSignature(signature, publicKey, code, rules);
    if (answer.fault) throw new Fault(answer.fault.code, answer.fault);
    return answer;
  };

  // One opcode on the stacks. Sets the step's effect — what a
  // sentence about it needs — before anything can fail, so a
  // failed comparison still says what it compared
  const run = (opcode, step, executing) => {
    const { name, code } = opcode;

    if (BRANCHING.has(name)) {
      if (name === 'OP_IF' || name === 'OP_NOTIF') {
        const chosen = executing ? pop() : FALSE;
        if (tapscript && executing && chosen !== FALSE && chosen !== TRUE) throw new Fault('tapscript-minimal-if');
        branches.push(executing && isTrue(chosen) === (name === 'OP_IF'));
      } else if (branches.length === 0) {
        throw new Fault('unbalanced-conditional');
      } else if (name === 'OP_ELSE') {
        branches.push(!branches.pop());
      } else {
        branches.pop();
      }
      const outer = name === 'OP_ENDIF' ? branches : branches.slice(0, -1);
      step.skipped = !outer.every(Boolean);
      step.effect = { type: 'branch', running: branches.every(Boolean) };
      return;
    }

    if (opcode.state === 'reserved') throw new Fault('reserved-opcode');
    if (opcode.only === 'tapscript' && !tapscript) throw new Fault('tapscript-only');

    if (code === 0x00) stack.push(FALSE);
    else if (code === 0x4f) leave(-1);
    else if (code >= 0x51 && code <= 0x60) leave(code - 0x50);
    else if (name === 'OP_NOP' || /^OP_NOP\d+$/.test(name)) step.effect = { type: 'nothing' };

    else if (name === 'OP_VERIFY') {
      need(1);
      if (!isTrue(stack.at(-1))) throw new Fault('verify-failed');
      stack.pop();
    } else if (name === 'OP_RETURN') {
      throw new Fault('op-return');
    }

    else if (name === 'OP_TOALTSTACK') alt.push(pop());
    else if (name === 'OP_FROMALTSTACK') {
      if (alt.length === 0) throw new Fault('alt-stack-underflow');
      stack.push(alt.pop());
    }
    else if (name === 'OP_2DROP') { need(2); stack.splice(-2, 2); }
    else if (name === 'OP_2DUP') { need(2); stack.push(...stack.slice(-2)); }
    else if (name === 'OP_3DUP') { need(3); stack.push(...stack.slice(-3)); }
    else if (name === 'OP_2OVER') { need(4); stack.push(...stack.slice(-4, -2)); }
    else if (name === 'OP_2ROT') { need(6); stack.push(...stack.splice(-6, 2)); }
    else if (name === 'OP_2SWAP') { need(4); stack.push(...stack.splice(-4, 2)); }
    else if (name === 'OP_IFDUP') { need(1); if (isTrue(stack.at(-1))) stack.push(stack.at(-1)); }
    else if (name === 'OP_DEPTH') leave(stack.length);
    else if (name === 'OP_DROP') pop();
    else if (name === 'OP_DUP') { need(1); stack.push(stack.at(-1)); }
    else if (name === 'OP_NIP') { need(2); stack.splice(-2, 1); }
    else if (name === 'OP_OVER') { need(2); stack.push(stack.at(-2)); }
    else if (name === 'OP_PICK' || name === 'OP_ROLL') {
      need(2);
      const depth = number(stack.pop());
      if (depth < 0 || depth >= stack.length) throw new Fault('index-out-of-range', { index: depth, have: stack.length });
      const at = stack.length - 1 - depth;
      stack.push(name === 'OP_ROLL' ? stack.splice(at, 1)[0] : stack[at]);
    }
    else if (name === 'OP_ROT') { need(3); stack.push(...stack.splice(-3, 1)); }
    else if (name === 'OP_SWAP') { need(2); stack.push(...stack.splice(-2, 1)); }
    else if (name === 'OP_TUCK') { need(2); stack.splice(-2, 0, stack.at(-1)); }
    else if (name === 'OP_SIZE') { need(1); leave(byteLength(stack.at(-1))); }

    else if (name === 'OP_EQUAL' || name === 'OP_EQUALVERIFY') {
      need(2);
      const right = stack.pop();
      const left = stack.pop();
      step.effect = { type: 'compare', left, right, equal: left === right };
      if (name === 'OP_EQUAL') leave(left === right);
      else if (left !== right) throw new Fault('verify-failed');
    }

    else if (UNARY[name]) {
      need(1);
      const input = number(stack.pop());
      const result = UNARY[name](input);
      step.effect = { type: 'numbers', inputs: [input], result };
      leave(result);
    } else if (BINARY[name]) {
      need(2);
      const second = number(stack.pop());
      const first = number(stack.pop());
      const result = BINARY[name](first, second);
      step.effect = { type: 'numbers', inputs: [first, second], result };
      if (name !== 'OP_NUMEQUALVERIFY') leave(result);
      else if (!result) throw new Fault('verify-failed');
    } else if (name === 'OP_WITHIN') {
      need(3);
      const upper = number(stack.pop());
      const lower = number(stack.pop());
      const value = number(stack.pop());
      const result = lower <= value && value < upper;
      step.effect = { type: 'numbers', inputs: [value, lower, upper], result };
      leave(result);
    }

    else if (HASHES[name]) {
      const input = pop();
      const output = HASHES[name](input);
      step.effect = { type: 'hash', input, output };
      stack.push(output);
    }

    else if (name === 'OP_CODESEPARATOR') {
      begins = readScript(hex).items[step.index].until;
      separator = step.index;
      step.effect = { type: 'separator' };
    }

    else if (name === 'OP_CHECKSIG' || name === 'OP_CHECKSIGVERIFY') {
      need(2);
      const publicKey = stack.pop();
      const signature = stack.pop();
      const answer = ask(signature, publicKey, tapscript ? null : codeFor([signature]));
      step.effect = { type: 'signature', signature, publicKey, digest: answer.digest ?? null, valid: answer.valid, why: answer.why ?? null };
      if (name === 'OP_CHECKSIG') leave(answer.valid);
      else if (!answer.valid) throw new Fault('verify-failed');
    } else if (name === 'OP_CHECKSIGADD') {
      need(3);
      const publicKey = stack.pop();
      const count = number(stack.pop());
      const signature = stack.pop();
      const answer = ask(signature, publicKey, null);
      step.effect = { type: 'signature', signature, publicKey, digest: answer.digest ?? null, valid: answer.valid, why: answer.why ?? null, counted: count + (answer.valid ? 1 : 0) };
      leave(count + (answer.valid ? 1 : 0));
    } else if (name === 'OP_CHECKMULTISIG' || name === 'OP_CHECKMULTISIGVERIFY') {
      if (tapscript) throw new Fault('tapscript-checkmultisig');

      const total = number(pop());
      if (total < 0 || total > LIMITS.keys) throw new Fault('key-count', { count: total, limit: LIMITS.keys });
      operations += total;
      if (operations > LIMITS.operations) throw new Fault('too-many-operations', { limit: LIMITS.operations });
      need(total);
      const publicKeys = stack.splice(stack.length - total, total);

      const required = number(pop());
      if (required < 0 || required > total) throw new Fault('signature-count', { count: required, total });
      need(required);
      const signatures = stack.splice(stack.length - required, required);

      // The famous one item too many: the opcode has always
      // taken it, and the network now insists it is empty
      if (pop() !== FALSE) throw new Fault('null-dummy');

      // From the last signature and the last key backwards:
      // a key that does not fit is passed over for good, so
      // the signatures must come in the order of their keys
      const code = codeFor(signatures);
      const tries = [];
      let signaturesLeft = required;
      let keysLeft = total;
      let valid = true;
      while (valid && signaturesLeft > 0) {
        const signature = signatures[signaturesLeft - 1];
        const publicKey = publicKeys[keysLeft - 1];
        const fits = ask(signature, publicKey, code).valid;
        tries.push({ signature, publicKey, valid: fits });
        if (fits) signaturesLeft -= 1;
        keysLeft -= 1;
        if (signaturesLeft > keysLeft) valid = false;
      }

      step.effect = { type: 'multisig', required, total, publicKeys, signatures, tries, valid };
      if (name === 'OP_CHECKMULTISIG') leave(valid);
      else if (!valid) throw new Fault('verify-failed');
    }

    else if (name === 'OP_CHECKLOCKTIMEVERIFY') {
      need(1);
      const required = number(stack.at(-1), 5);
      const answer = checker.checkLockTime(required);
      step.effect = { type: 'locktime', required, lockTime: answer.lockTime, why: answer.why ?? null };
      if (answer.why) throw new Fault('locktime', { why: answer.why, required, lockTime: answer.lockTime });
    }

    else if (name === 'OP_CHECKSEQUENCEVERIFY') {
      need(1);
      const required = number(stack.at(-1), 5);
      const answer = checker.checkSequence(required);
      step.effect = { type: 'sequence', required, sequence: answer.sequence, idle: Boolean(answer.idle), why: answer.why ?? null };
      if (answer.why) throw new Fault('sequence', { why: answer.why, required, sequence: answer.sequence });
    }

    else throw new Fault('reserved-opcode');
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const executing = branches.every(Boolean);
    const step = { kind: 'item', phase, index, item, skipped: false, ok: true, error: null, effect: null };
    const before = { stack: [...stack], alt: [...alt] };

    try {
      if (item.type === 'push') {
        if (byteLength(item.hex) > LIMITS.push) throw new Fault('push-too-large', { size: byteLength(item.hex), limit: LIMITS.push });
        if (executing) stack.push(item.hex);
        else step.skipped = true;
      } else {
        // Counted, and refused when switched off, wherever it
        // stands — a branch that is skipped is still read
        if (item.opcode.code > 0x60 && !tapscript) operations += 1;
        if (operations > LIMITS.operations) throw new Fault('too-many-operations', { limit: LIMITS.operations });
        if (item.opcode.state === 'disabled') throw new Fault('disabled-opcode');

        if (executing || BRANCHING.has(item.opcode.name)) run(item.opcode, step, executing);
        else step.skipped = true;
      }
      if (stack.length + alt.length > LIMITS.stack) throw new Fault('stack-too-large', { limit: LIMITS.stack });
    } catch (fault) {
      if (!(fault instanceof Fault)) throw fault;
      stack.splice(0, stack.length, ...before.stack);
      alt.splice(0, alt.length, ...before.alt);
      step.ok = false;
      step.error = { code: fault.code, ...fault.details };
    }

    steps.push({ ...step, stack: [...stack], alt: [...alt] });
    if (!step.ok) return step.error;
  }

  return branches.length > 0 ? { code: 'unbalanced-conditional' } : null;
}







// -----------------------------------------------------------
// evaluateSpend
// -----------------------------------------------------------
//
// Decides whether an input opens a lock, the way a node does
// (see the file header), and hands back the whole record: a
// step for every item of every script that was run, a step
// where the stack is carried from the unlocking script to the
// lock, a step where a redeem script is taken off the stack,
// a step where the node turns to the witness — which says
// what kind of program it found and, for a script, shows the
// script — and a verdict at the end, the last step always,
// whether the run got that far or broke on the way. Each
// script is given as its items and its bytes, the witness as
// its items in order.
//
// The stack the verdict shows is the one the last script
// left. Where no script was run — a Taproot coin opened by
// its key, a program without rules — it is what a node keeps
// of the lock's own two pushes: the first.
//
// Used by:
//   - node.js — the last and longest of a node's checks
// -----------------------------------------------------------

export function evaluateSpend({ unlock, lock, witness = [], checker }) {
  const steps = [];
  const stack = [];
  const alt = [];

  const finish = (error) => {
    steps.push({ kind: 'verdict', ok: error === null, error, stack: [...stack], alt: [] });
    return { steps, ok: error === null, error };
  };
  const play = (phase, script) => runScript({ phase, items: script.items, hex: script.hex, stack, alt, checker, steps });
  const turnTo = (flavour, details, items = []) => {
    stack.splice(0, stack.length, ...items);
    alt.length = 0;
    steps.push({ kind: 'witness', flavour, ok: true, ...details, stack: [...stack], alt: [] });
  };

  // A script out of the witness: no item on its stack may be
  // larger than a push may be, and it has to end with exactly
  // one item, a true one
  const playFromWitness = (phase, script, rules, more = {}) => {
    const large = stack.find((item) => byteLength(item) > LIMITS.push);
    if (large !== undefined) return { code: 'push-too-large', size: byteLength(large), limit: LIMITS.push };

    const error = runScript({ phase, items: script.items, hex: script.hex, stack, alt, checker, steps, rules, ...more });
    if (error) return error;
    if (stack.length !== 1) return { code: 'witness-unclean-stack', left: stack.length };
    return isTrue(stack[0]) ? null : { code: 'false-on-top' };
  };

  // A Taproot key: one signature for the key itself, or a
  // script with the proof that the key hides it
  const openTaproot = (key) => {
    if (witness.length === 0) return { code: 'witness-empty' };

    const items = [...witness];
    const annex = items.length >= 2 && items.at(-1).startsWith('50') ? items.pop() : null;
    const kept = stack.slice(0, 1);

    if (items.length === 1) {
      const answer = checker.checkSchnorr(items[0], key, { annex });
      const effect = { type: 'signature', signature: items[0], publicKey: key, digest: answer.digest ?? answer.fault?.digest ?? null, valid: !answer.fault, why: answer.fault?.code ?? null };
      turnTo('keypath', { version: 1, program: key, ok: !answer.fault, error: answer.fault ?? null, effect }, kept);
      return answer.fault ?? null;
    }

    const control = items.pop();
    const hex = items.pop();
    const proof = readControlBlock(control, hex, key);
    if (!proof) return { code: 'taproot-control-size', size: byteLength(control) };
    if (!proof.committed) return { code: 'taproot-mismatch' };

    if (proof.version !== TAPSCRIPT) {
      turnTo('future-leaf', { version: 1, program: key, hex, proof }, kept);
      return null;
    }

    const script = readScript(hex);
    const door = script.items.find((item) => item.type === 'op' && isOpSuccess(item.opcode.code));
    if (door) {
      turnTo('op-success', { version: 1, program: key, hex, items: script.items, proof, opcode: door.opcode }, kept);
      return null;
    }
    if (script.broken) return { code: 'witness-script-broken' };
    if (items.length > LIMITS.stack) return { code: 'stack-too-large', limit: LIMITS.stack };

    turnTo('tapscript', { version: 1, program: key, hex, items: script.items, proof }, items);
    return playFromWitness('leaf', { items: script.items, hex }, 'tapscript', { leaf: proof.leaf, annex, weight: witnessSize(witness) + SIGNATURE_WEIGHT });
  };

  // A witness program, bare or behind a script hash: what its
  // version and its size say it is decides what the witness
  // has to hold
  const openProgram = ({ version, program }, behindHash) => {
    const size = byteLength(program);

    if (version === 0 && size === 32) {
      if (witness.length === 0) return { code: 'witness-empty' };

      const hex = witness.at(-1);
      if (sha256Hex(hex) !== program) return { code: 'witness-script-mismatch' };

      const script = readScript(hex);
      turnTo('p2wsh', { version, program, hex, items: script.items }, witness.slice(0, -1));
      if (script.broken) return { code: 'witness-script-broken' };
      return playFromWitness('witnessScript', { items: script.items, hex }, 'witness0');
    }

    if (version === 0 && size === 20) {
      if (witness.length !== 2) return { code: 'witness-key-mismatch', count: witness.length };

      const hex = `76a914${program}88ac`;
      const script = readScript(hex);
      turnTo('p2wpkh', { version, program, hex, items: script.items }, witness);
      return playFromWitness('program', { items: script.items, hex }, 'witness0');
    }

    if (version === 0) return { code: 'witness-wrong-length', size };
    if (version === 1 && size === 32 && !behindHash) return openTaproot(program);

    turnTo('unknown', { version, program }, stack.slice(0, 1));
    return null;
  };

  let error = play('unlock', unlock);
  if (error) return finish(error);

  // The stack is carried over; the helper stack is not
  const carried = [...stack];
  alt.length = 0;
  steps.push({ kind: 'handover', stack: [...stack], alt: [] });

  error = play('lock', lock) ?? verdictOn(stack);
  if (error) return finish(error);

  const bare = witnessProgramOf(lock.hex);
  if (bare) {
    if (unlock.hex !== '') return finish({ code: 'witness-with-unlock' });
    return finish(openProgram(bare, false));
  }

  if (PAY_TO_SCRIPT_HASH.test(lock.hex)) {
    if (!isPushOnly(unlock.items)) return finish({ code: 'unlock-not-push-only' });

    // Back to the stack as the unlocking script left it: its
    // top item is the script the lock's hash stood for
    stack.splice(0, stack.length, ...carried);
    alt.length = 0;
    const hex = stack.pop();
    const { items, broken } = readScript(hex);
    steps.push({ kind: 'redeem', hex, items, stack: [...stack], alt: [] });
    if (broken) return finish({ code: 'redeem-broken' });

    error = play('redeem', { items, hex }) ?? verdictOn(stack);
    if (error) return finish(error);

    // A witness program as the redeem script: the unlocking
    // script may then hold that one push and nothing else
    const wrapped = witnessProgramOf(hex);
    if (wrapped) {
      if (unlock.hex !== pushOf(hex)) return finish({ code: 'witness-with-unlock-p2sh' });
      return finish(openProgram(wrapped, true));
    }
  }

  if (witness.length > 0) return finish({ code: 'witness-unexpected' });
  return finish(null);
}

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
//  The machine knows nothing about transactions. The three
//  questions that need one — does this signature sign the
//  spending transaction, is its lock time late enough, and
//  does its input promise a long enough wait — it puts to a
//  checker the caller hands in (node.js builds it from the
//  transaction).
//
//  The rules are the network's own, as they stand for the
//  original script system: Script's numbers and its idea of
//  true; opcodes that fail a script by merely being in it;
//  the limits on a script's size, on one push, on how many
//  operations run and how deep the stacks grow; the empty
//  item OP_CHECKMULTISIG takes one too many of. What the
//  machine cannot do it refuses by name instead of guessing:
//  OP_CODESEPARATOR.
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
//    Fault        — what stops a script
//    verdictOn    — the last look at the top of the stack
//    runScript    — one script, item by item
//    evaluateSpend — the unlocking script, the lock and, for
//                    pay to script hash, the redeem script
// -----------------------------------------------------------

import { byteLength } from './bytes';
import { hash160, hash256, ripemd160Hex, sha1Hex, sha256Hex } from './hashes';
import { PAY_TO_SCRIPT_HASH, isPushOnly, isTrue, numberHex, numberOf, readScript } from './script';


// The network's limits on a script: its size and one push in
// bytes, how many opcodes beyond the pushes it may hold, how
// many items the two stacks may hold together, and how many
// keys one OP_CHECKMULTISIG may name
const LIMITS = { script: 10_000, push: 520, operations: 201, stack: 1000, keys: 20 };

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
// Used by:
//   - evaluateSpend (below) — once per script of a spend
// -----------------------------------------------------------

function runScript({ phase, items, hex, stack, alt, checker, steps }) {
  if (byteLength(hex) > LIMITS.script) return { code: 'script-too-large', size: byteLength(hex), limit: LIMITS.script };

  const branches = [];
  let operations = 0;

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
  const ask = (signature, publicKey) => {
    const answer = checker.checkSignature(signature, publicKey, hex);
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
        const taken = executing && isTrue(pop()) === (name === 'OP_IF');
        branches.push(taken);
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

    if (opcode.state === 'unsupported') throw new Fault('unsupported-opcode');
    if (opcode.state === 'reserved') throw new Fault('reserved-opcode');

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

    else if (name === 'OP_CHECKSIG' || name === 'OP_CHECKSIGVERIFY') {
      need(2);
      const publicKey = stack.pop();
      const signature = stack.pop();
      const answer = ask(signature, publicKey);
      step.effect = { type: 'signature', signature, publicKey, digest: answer.digest ?? null, valid: answer.valid, why: answer.why ?? null };
      if (name === 'OP_CHECKSIG') leave(answer.valid);
      else if (!answer.valid) throw new Fault('verify-failed');
    } else if (name === 'OP_CHECKMULTISIG' || name === 'OP_CHECKMULTISIGVERIFY') {
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
      const tries = [];
      let signaturesLeft = required;
      let keysLeft = total;
      let valid = true;
      while (valid && signaturesLeft > 0) {
        const signature = signatures[signaturesLeft - 1];
        const publicKey = publicKeys[keysLeft - 1];
        const fits = ask(signature, publicKey).valid;
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
        if (item.opcode.code > 0x60) operations += 1;
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
// Decides whether an unlocking script opens a lock, the way a
// node does (see the file header), and hands back the whole
// record: a step for every item of every script, a step
// where the stack is carried from the unlocking script to
// the lock, a step where a redeem script is taken off the
// stack, and a verdict at the end — the last step always,
// whether the run got that far or broke on the way. Each
// script is given as its items and its bytes.
//
// Used by:
//   - node.js — the last and longest of a node's checks
// -----------------------------------------------------------

export function evaluateSpend({ unlock, lock, checker }) {
  const steps = [];
  const stack = [];
  const alt = [];

  const finish = (error) => {
    steps.push({ kind: 'verdict', ok: error === null, error, stack: [...stack], alt: [] });
    return { steps, ok: error === null, error };
  };
  const play = (phase, script) => runScript({ phase, items: script.items, hex: script.hex, stack, alt, checker, steps });

  let error = play('unlock', unlock);
  if (error) return finish(error);

  // The stack is carried over; the helper stack is not
  const carried = [...stack];
  alt.length = 0;
  steps.push({ kind: 'handover', stack: [...stack], alt: [] });

  error = play('lock', lock) ?? verdictOn(stack);
  if (error) return finish(error);

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
  }

  return finish(null);
}

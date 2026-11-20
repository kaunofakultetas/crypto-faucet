// -----------------------------------------------------------
//  [*] Tests — Bitcoin script playground: the stack machine
//
//  What a node does with the scripts of a spend
//  (engine/interpreter.js), in two parts.
//
//  The first runs small scripts and looks at the record the
//  machine keeps — the page plays that record back, so its
//  shape is the machine's contract: a step per word, the
//  stack after every step, a failed step that leaves the
//  stack alone, the hand-over between the two scripts, the
//  third act of a pay-to-script-hash coin, and the verdict.
//
//  The second holds the machine against Bitcoin Core's own
//  script vectors (support/bitcoin-script/core-vectors.js).
//  The machine has ONE fixed set of rules, while every vector
//  names its own, so they cannot all agree — but every
//  difference must be one of the rule choices listed here,
//  each counted. A difference of any other kind, or a count
//  that moves, is a change in what the machine accepts.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { VECTORS, runVector } from '../../support/bitcoin-script/core-vectors';
import { hash160 } from '@/pages/BitcoinScript/engine/hashes';
import { evaluateSpend } from '@/pages/BitcoinScript/engine/interpreter';
import { PAY_TO_SCRIPT_HASH, parseScript, serializeScript } from '@/pages/BitcoinScript/engine/script';


// A checker for scripts that ask nothing of a transaction:
// "aa" signs for the key "02aa" and nothing else does; the
// transaction's lock time is 100
const checker = {
  checkSignature: (signature, publicKey) => ({ valid: `02${signature}` === publicKey, digest: '00'.repeat(32), why: `02${signature}` === publicKey ? null : 'wrong-signature' }),
  checkLockTime: (required) => ({ lockTime: 100, why: required > 100 ? 'too-early' : null }),
};

// A script from its words, as the machine takes it
const script = (text) => {
  const { items } = parseScript(text);
  return { items, hex: serializeScript(items) };
};

// A spend run to its end
const spend = (unlock, lock) => evaluateSpend({ unlock: script(unlock), lock: script(lock), checker });

// The steps of a run as short readable lines
const told = (run) => run.steps.map((step) => (step.kind === 'item'
  ? `${step.phase} ${step.item.type === 'op' ? step.item.opcode.name : step.item.hex}${step.skipped ? ' skipped' : ''}${step.ok ? '' : ` FAILED ${step.error.code}`} [${step.stack.join(' ')}]`
  : `${step.kind}${step.ok === false ? ` FAILED ${step.error.code}` : ''} [${step.stack.join(' ')}]`));







// -----------------------------------------------------------
// The record of a run
// -----------------------------------------------------------

describe('the record of a run', () => {

  it('keeps a step per word with the stack after it, the hand-over between the scripts, and the verdict', () => {
    const run = spend('2 3', 'OP_ADD 5 OP_EQUAL');

    expect(run.ok).toBe(true);
    expect(told(run)).toEqual([
      'unlock OP_2 [02]',
      'unlock OP_3 [02 03]',
      'handover [02 03]',
      'lock OP_ADD [05]',
      'lock OP_5 [05 05]',
      'lock OP_EQUAL [01]',
      'verdict [01]',
    ]);
  });


  it('says what an opcode came to', () => {
    const run = spend('2 3', 'OP_ADD 5 OP_EQUAL');

    expect(run.steps[3].effect).toEqual({ type: 'numbers', inputs: [2, 3], result: 5 });
    expect(run.steps[5].effect).toEqual({ type: 'compare', left: '05', right: '05', equal: true });
  });


  it('leaves the stack as it was at the step that failed, and stops there', () => {
    const run = spend('2 4', 'OP_ADD 5 OP_EQUALVERIFY 1');

    expect(run.ok).toBe(false);
    expect(run.error).toEqual({ code: 'verify-failed' });
    expect(told(run).slice(-2)).toEqual(['lock OP_EQUALVERIFY FAILED verify-failed [06 05]', 'verdict FAILED verify-failed [06 05]']);
    expect(run.steps.at(-2).effect).toEqual({ type: 'compare', left: '06', right: '05', equal: false });
  });


  it('turns a spend down when the scripts end on false, or on nothing', () => {
    expect(spend('2 4', 'OP_ADD 5 OP_EQUAL').error).toEqual({ code: 'false-on-top' });
    expect(spend('', '').error).toEqual({ code: 'empty-stack' });
    expect(spend('1', 'OP_DROP').error).toEqual({ code: 'empty-stack' });
  });


  it('skips the branch not taken, and marks the words it passed over', () => {
    const taken = spend('1', 'OP_IF 7 OP_ELSE 8 OP_ENDIF 7 OP_EQUAL');
    const other = spend('0', 'OP_IF 7 OP_ELSE 8 OP_ENDIF 8 OP_EQUAL');

    expect(taken.ok).toBe(true);
    expect(taken.steps.filter((step) => step.skipped).map((step) => step.item.opcode.name)).toEqual(['OP_8']);
    expect(other.ok).toBe(true);
    expect(other.steps.filter((step) => step.skipped).map((step) => step.item.opcode.name)).toEqual(['OP_7']);
  });


  it('refuses an IF that is never closed, and an ELSE without one', () => {
    expect(spend('1', 'OP_IF 1').error).toEqual({ code: 'unbalanced-conditional' });
    expect(spend('1', 'OP_ELSE 1').error).toEqual({ code: 'unbalanced-conditional' });
  });


  it('fails on a switched-off word even in a branch it never runs', () => {
    expect(spend('0', 'OP_IF OP_CAT OP_ENDIF 1').error).toEqual({ code: 'disabled-opcode' });
  });


  it('fails on a word without a meaning only when it reaches it', () => {
    expect(spend('0', 'OP_IF OP_RESERVED OP_ENDIF 1').ok).toBe(true);
    expect(spend('1', 'OP_IF OP_RESERVED OP_ENDIF 1').error).toEqual({ code: 'reserved-opcode' });
  });


  it('says by name what it does not run', () => {
    expect(spend('1', 'OP_CHECKSEQUENCEVERIFY').error).toEqual({ code: 'unsupported-opcode' });
    expect(spend('1', 'OP_CODESEPARATOR').error).toEqual({ code: 'unsupported-opcode' });
  });


  it('never spends a coin locked with OP_RETURN', () => {
    expect(spend('1', 'OP_RETURN').error).toEqual({ code: 'op-return' });
  });


  it('says how many values a word wanted and how many there were', () => {
    expect(spend('1', 'OP_ADD').error).toEqual({ code: 'stack-underflow', needed: 2, have: 1 });
    expect(spend('', 'OP_FROMALTSTACK').error).toEqual({ code: 'alt-stack-underflow' });
  });


  it('does arithmetic on four bytes only', () => {
    expect(spend('2147483647 1', 'OP_ADD OP_DROP 1').ok).toBe(true);
    expect(spend('2147483648 1', 'OP_ADD').error).toEqual({ code: 'number-too-long', bytes: 5, limit: 4 });
  });


  it('moves values to the helper stack and back, and forgets it between the scripts', () => {
    expect(spend('5', 'OP_TOALTSTACK 1 OP_FROMALTSTACK 5 OP_EQUALVERIFY').ok).toBe(true);
    expect(spend('5 OP_TOALTSTACK', 'OP_FROMALTSTACK').error).toEqual({ code: 'alt-stack-underflow' });
  });


  it('reaches into the stack by a counted depth', () => {
    expect(spend('7 8 9', '2 OP_PICK 7 OP_EQUALVERIFY OP_DEPTH 3 OP_EQUAL').ok).toBe(true);
    expect(spend('7 8 9', '2 OP_ROLL 7 OP_EQUALVERIFY OP_DEPTH 2 OP_EQUAL').ok).toBe(true);
    expect(spend('7', '3 OP_PICK').error).toEqual({ code: 'index-out-of-range', index: 3, have: 1 });
  });


  it('refuses a piece of data longer than 520 bytes', () => {
    expect(spend(`0x${'ab'.repeat(520)}`, 'OP_DROP 1').ok).toBe(true);
    expect(spend(`0x${'ab'.repeat(521)}`, 'OP_DROP 1').error).toEqual({ code: 'push-too-large', size: 521, limit: 520 });
  });
});







// -----------------------------------------------------------
// Signatures, lock times and scripts behind a hash
// -----------------------------------------------------------

describe('what the machine asks of a transaction', () => {

  it('puts a signature and a key to the checker, and leaves its answer on the stack', () => {
    const run = spend('0xaa', '0x02aa OP_CHECKSIG');

    expect(run.ok).toBe(true);
    expect(run.steps.at(-2).effect).toMatchObject({ type: 'signature', signature: 'aa', publicKey: '02aa', valid: true });
    expect(spend('0xbb', '0x02aa OP_CHECKSIG').error).toEqual({ code: 'false-on-top' });
    expect(spend('0xbb', '0x02aa OP_CHECKSIGVERIFY 1').error).toEqual({ code: 'verify-failed' });
  });


  it('matches the signatures of a shared account to its keys in order, and takes the one value too many', () => {
    const lock = '2 0x02aa 0x02bb 0x02cc 3 OP_CHECKMULTISIG';

    expect(spend('0 0xaa 0xcc', lock).ok).toBe(true);
    expect(spend('0 0xbb 0xcc', lock).ok).toBe(true);
    expect(spend('0 0xcc 0xaa', lock).error).toEqual({ code: 'false-on-top' });
    expect(spend('0 0xaa 0xaa', lock).error).toEqual({ code: 'false-on-top' });
    expect(spend('1 0xaa 0xcc', lock).error).toEqual({ code: 'null-dummy' });
    expect(spend('0xaa 0xcc', lock).error).toMatchObject({ code: 'stack-underflow' });
  });


  it('lists every pairing a shared account tried', () => {
    const run = spend('0 0xaa 0xcc', '2 0x02aa 0x02bb 0x02cc 3 OP_CHECKMULTISIG');

    expect(run.steps.at(-2).effect.tries).toEqual([
      { signature: 'cc', publicKey: '02cc', valid: true },
      { signature: 'aa', publicKey: '02bb', valid: false },
      { signature: 'aa', publicKey: '02aa', valid: true },
    ]);
  });


  it('holds a coin back until the transaction says a late enough lock time, and leaves the stack alone', () => {
    const run = spend('1', '100 OP_CHECKLOCKTIMEVERIFY OP_DROP');

    expect(run.ok).toBe(true);
    expect(run.steps[2].stack).toEqual(['01', '64']);
    expect(spend('1', '101 OP_CHECKLOCKTIMEVERIFY OP_DROP').error).toEqual({ code: 'locktime', why: 'too-early', required: 101, lockTime: 100 });
  });


  it('runs the script behind a hash once the hash has matched', () => {
    const redeem = serializeScript(parseScript('OP_ADD 5 OP_EQUAL').items);
    const lock = `OP_HASH160 0x${hash160(redeem)} OP_EQUAL`;
    const run = spend(`2 3 0x${redeem}`, lock);

    expect(PAY_TO_SCRIPT_HASH.test(script(lock).hex)).toBe(true);
    expect(run.ok).toBe(true);
    expect(told(run).slice(-5)).toEqual([
      'redeem [02 03]',
      'redeem OP_ADD [05]',
      'redeem OP_5 [05 05]',
      'redeem OP_EQUAL [01]',
      'verdict [01]',
    ]);
  });


  it('turns down a script behind a hash that does not hold, or is not the one hashed', () => {
    const redeem = serializeScript(parseScript('OP_ADD 5 OP_EQUAL').items);
    const lock = `OP_HASH160 0x${hash160(redeem)} OP_EQUAL`;

    expect(spend(`2 4 0x${redeem}`, lock).error).toEqual({ code: 'false-on-top' });
    expect(spend(`2 3 0x${redeem}00`, lock).error).toEqual({ code: 'false-on-top' });
    expect(spend(`2 3 OP_DUP OP_DROP 0x${redeem}`, lock).error).toEqual({ code: 'unlock-not-push-only' });
  });
});







// -----------------------------------------------------------
// Bitcoin Core's vectors
// -----------------------------------------------------------
//
// The machine's rules are fixed: pay-to-script-hash, strict
// DER signatures, the empty extra item of OP_CHECKMULTISIG
// and OP_CHECKLOCKTIMEVERIFY are always on; only signatures
// of the whole transaction are understood;
// OP_CHECKSEQUENCEVERIFY and OP_CODESEPARATOR are not run;
// and the relay-only rules Core calls policy are not applied.
// `excuse` names the rule behind a difference, or nothing —
// and nothing fails the test.
// -----------------------------------------------------------

describe("Bitcoin Core's script vectors", () => {

  // A rule Core applies for the vector and the machine never
  // does, by the error Core expects
  const NOT_APPLIED = {
    MINIMALDATA: 'MINIMALDATA',
    UNKNOWN_ERROR: 'MINIMALDATA',
    DISCOURAGE_UPGRADABLE_NOPS: 'DISCOURAGE_UPGRADABLE_NOPS',
    PUBKEYTYPE: 'STRICTENC',
    NULLFAIL: 'NULLFAIL',
    CLEANSTACK: 'CLEANSTACK',
    SIG_HIGH_S: 'LOW_S',
    SIG_PUSHONLY: 'SIGPUSHONLY',
  };

  const excuse = (vector, result) => {
    const has = (flag) => vector.flags.includes(flag);
    const words = `${vector.scriptSig} ${vector.scriptPubKey}`;

    if (result.ok) {
      const rule = NOT_APPLIED[vector.expected];
      return rule && has(rule) ? `not applied: ${rule}` : null;
    }
    if (result.error === 'unsupported-opcode') return 'not run: CHECKSEQUENCEVERIFY, CODESEPARATOR';
    if (result.error === 'signature-type') return 'only signatures of the whole transaction';
    if (result.error === 'signature-encoding' && !has('DERSIG') && !has('STRICTENC') && !has('LOW_S')) return 'always on: DERSIG';
    if (result.error === 'null-dummy' && !has('NULLDUMMY')) return 'always on: NULLDUMMY';
    if (!has('CHECKLOCKTIMEVERIFY') && /CHECKLOCKTIMEVERIFY|NOP2/.test(words)) return 'always on: CHECKLOCKTIMEVERIFY';
    if (!has('P2SH') && PAY_TO_SCRIPT_HASH.test(result.lockHex)) return 'always on: P2SH';
    return null;
  };

  it('agrees with every vector but the ones its fixed rules decide otherwise', () => {
    const counts = {};
    const unexplained = [];
    let agreed = 0;

    for (const vector of VECTORS) {
      const result = runVector(vector);
      if (result.ok === (vector.expected === 'OK')) {
        agreed += 1;
        continue;
      }
      const reason = excuse(vector, result);
      if (reason) counts[reason] = (counts[reason] ?? 0) + 1;
      else unexplained.push(`Core: ${vector.expected}, the machine: ${result.ok ? 'OK' : result.error} — ${vector.scriptSig} | ${vector.scriptPubKey} [${vector.flags}] ${vector.comment}`);
    }

    expect(unexplained).toEqual([]);
    expect(VECTORS).toHaveLength(1077);
    expect(agreed).toBe(949);
    expect(counts).toEqual({
      'not applied: MINIMALDATA': 75,
      'not applied: DISCOURAGE_UPGRADABLE_NOPS': 10,
      'not applied: STRICTENC': 4,
      'not applied: NULLFAIL': 3,
      'not applied: CLEANSTACK': 2,
      'not applied: LOW_S': 1,
      'not applied: SIGPUSHONLY': 1,
      'always on: DERSIG': 17,
      'always on: NULLDUMMY': 4,
      'always on: CHECKLOCKTIMEVERIFY': 3,
      'always on: P2SH': 2,
      'only signatures of the whole transaction': 3,
      'not run: CHECKSEQUENCEVERIFY, CODESEPARATOR': 3,
    });
  });
});

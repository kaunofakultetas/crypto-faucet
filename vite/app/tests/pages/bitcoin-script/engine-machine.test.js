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
//  third act of a pay-to-script-hash coin, the turn to the
//  witness of a witness program, and the verdict. The
//  machine's questions go to a stand-in checker here, which
//  also remembers what it was asked — which script a
//  signature is checked against is the machine's own doing.
//  Taproot needs real keys and has a file of its own
//  (engine-taproot.test.js).
//
//  The second holds the machine against Bitcoin Core's own
//  script vectors (support/bitcoin-script/core-vectors.js).
//  The machine has ONE fixed set of rules, while every vector
//  names its own, so they cannot all agree — but every
//  difference must be one of the rule choices listed here,
//  each counted. A difference of any other kind, or a count
//  that moves, is a change in what the machine accepts.
// -----------------------------------------------------------

import { beforeEach, describe, it, expect } from 'vitest';
import { VECTORS, runVector } from '../../support/bitcoin-script/core-vectors';
import { hash160, sha256Hex } from '@/pages/BitcoinScript/engine/hashes';
import { evaluateSpend } from '@/pages/BitcoinScript/engine/interpreter';
import { PAY_TO_SCRIPT_HASH, parseScript, pushOf, serializeScript } from '@/pages/BitcoinScript/engine/script';


// Every signature the stand-in checker was asked about since
// the test began: the script it came with and the rules
const asked = [];

// A checker for scripts that ask nothing of a transaction:
// "aa" signs for the key "02aa" and nothing else does; the
// transaction's lock time is 100 and its input promises to
// wait 10 blocks
const checker = {
  checkSignature: (signature, publicKey, code, rules) => {
    asked.push({ signature, code, rules });
    return { valid: `02${signature}` === publicKey, digest: '00'.repeat(32), why: `02${signature}` === publicKey ? null : 'wrong-signature' };
  },
  checkLockTime: (required) => ({ lockTime: 100, why: required > 100 ? 'too-early' : null }),
  checkSequence: (required) => ({ sequence: 10, why: required > 10 ? 'too-early' : null }),
};

// A script from its words, as the machine takes it
const script = (text) => {
  const { items } = parseScript(text);
  return { items, hex: serializeScript(items) };
};

// A spend run to its end
const spend = (unlock, lock, witness = []) => evaluateSpend({ unlock: script(unlock), lock: script(lock), witness, checker });

beforeEach(() => {
  asked.length = 0;
});

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


  it('runs OP_CODESEPARATOR as a word that leaves the stack alone', () => {
    const run = spend('1', 'OP_CODESEPARATOR');

    expect(run.ok).toBe(true);
    expect(run.steps.at(-2)).toMatchObject({ effect: { type: 'separator' }, stack: ['01'] });
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


  it('holds a coin back until the input promises a long enough wait, and leaves the stack alone', () => {
    const run = spend('1', '10 OP_CHECKSEQUENCEVERIFY OP_DROP');

    expect(run.ok).toBe(true);
    expect(run.steps[3].stack).toEqual(['01', '0a']);
    expect(run.steps[3].effect).toEqual({ type: 'sequence', required: 10, sequence: 10, idle: false, why: null });
    expect(spend('1', '11 OP_CHECKSEQUENCEVERIFY OP_DROP').error).toEqual({ code: 'sequence', why: 'too-early', required: 11, sequence: 10 });
  });


  it('needs a number for a wait, of no more than five bytes', () => {
    expect(spend('', 'OP_CHECKSEQUENCEVERIFY').error).toMatchObject({ code: 'stack-underflow' });
    expect(spend('0x000000000000', 'OP_CHECKSEQUENCEVERIFY').error).toMatchObject({ code: 'number-too-long', bytes: 6, limit: 5 });
    expect(spend('0x0000000000', 'OP_CHECKSEQUENCEVERIFY 1').ok).toBe(true);
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
// The script a signature is checked against
// -----------------------------------------------------------

describe('the script a signature is checked against', () => {

  it('is the whole script the signature check stands in, not the unlocking script before it', () => {
    spend('0xaa', '0x02aa OP_CHECKSIG');

    expect(asked).toEqual([{ signature: 'aa', code: '0202aaac', rules: 'legacy' }]);
  });


  it('begins after the last OP_CODESEPARATOR that was run', () => {
    spend('0xaa', 'OP_1 OP_CODESEPARATOR OP_DROP OP_CODESEPARATOR 0x02aa OP_CHECKSIG');
    spend('0xaa', '0 OP_IF OP_CODESEPARATOR OP_ENDIF 0x02aa OP_CHECKSIG');
    spend('0xaa', 'OP_CODESEPARATOR 0x02aa OP_CHECKSIGVERIFY OP_CODESEPARATOR 0xaa 0x02aa OP_CHECKSIG');

    expect(asked.map((question) => question.code)).toEqual([
      '0202aaac',
      '0063ab680202aaac',
      '0202aaadab0202aaac',
      '0202aaac',
    ]);
  });


  it('has every push of the signature itself taken out, and nothing that only looks like one', () => {
    spend('', '0xaa 0xaa OP_DROP 0x02aa OP_CHECKSIG');
    spend('0xaa', '0x01aa OP_DROP 0x02aa OP_CHECKSIG');

    expect(asked.map((question) => question.code)).toEqual(['750202aaac', '0201aa750202aaac']);
  });


  it('has the signatures of a shared account all taken out before the first is checked', () => {
    const run = spend('0', '0xaa 0xbb 2 0x02aa 0x02bb 2 OP_CHECKMULTISIG');

    expect(run.ok).toBe(true);
    expect(asked).toEqual([
      { signature: 'bb', code: '520202aa0202bb52ae', rules: 'legacy' },
      { signature: 'aa', code: '520202aa0202bb52ae', rules: 'legacy' },
    ]);
  });


  it('keeps the signature where the script comes from a witness', () => {
    const witnessScript = script('0xaa 0x02aa OP_CHECKSIG').hex;
    const run = spend('', `0 0x${sha256Hex(witnessScript)}`, [witnessScript]);

    expect(run.ok).toBe(true);
    expect(asked).toEqual([{ signature: 'aa', code: witnessScript, rules: 'witness0' }]);
  });
});







// -----------------------------------------------------------
// Witness programs
// -----------------------------------------------------------

describe('a lock that is a witness program', () => {

  const KEY_HASH = hash160('02aa');
  const SUM = script('OP_ADD 5 OP_EQUAL').hex;
  const flavours = (run) => run.steps.filter((step) => step.kind === 'witness').map((step) => step.flavour);

  it('builds the pay-to-key-hash script itself for twenty bytes, and runs it on the two items of the witness', () => {
    const run = spend('', `0 0x${KEY_HASH}`, ['aa', '02aa']);

    expect(run.ok).toBe(true);
    expect(told(run)).toEqual([
      'handover []',
      'lock OP_0 []',
      `lock ${KEY_HASH} [ ${KEY_HASH}]`,
      'witness [aa 02aa]',
      'program OP_DUP [aa 02aa 02aa]',
      `program OP_HASH160 [aa 02aa ${KEY_HASH}]`,
      `program ${KEY_HASH} [aa 02aa ${KEY_HASH} ${KEY_HASH}]`,
      'program OP_EQUALVERIFY [aa 02aa]',
      'program OP_CHECKSIG [01]',
      'verdict [01]',
    ]);
    expect(run.steps[3]).toMatchObject({ flavour: 'p2wpkh', version: 0, program: KEY_HASH, hex: `76a914${KEY_HASH}88ac` });
    expect(asked).toEqual([{ signature: 'aa', code: `76a914${KEY_HASH}88ac`, rules: 'witness0' }]);
  });


  it('wants exactly a signature and a key for twenty bytes, and the key the hash was made of', () => {
    expect(spend('', `0 0x${KEY_HASH}`, ['aa']).error).toEqual({ code: 'witness-key-mismatch', count: 1 });
    expect(spend('', `0 0x${KEY_HASH}`, ['aa', '02aa', '02aa']).error).toEqual({ code: 'witness-key-mismatch', count: 3 });
    expect(spend('', `0 0x${KEY_HASH}`, ['bb', '02bb']).error).toEqual({ code: 'verify-failed' });
    expect(spend('', `0 0x${KEY_HASH}`, ['bb', '02aa']).error).toEqual({ code: 'false-on-top' });
  });


  it('takes the last item of the witness as the script for thirty-two bytes, and runs it on the rest', () => {
    const run = spend('', `0 0x${sha256Hex(SUM)}`, ['02', '03', SUM]);

    expect(run.ok).toBe(true);
    expect(told(run).slice(3)).toEqual([
      'witness [02 03]',
      'witnessScript OP_ADD [05]',
      'witnessScript OP_5 [05 05]',
      'witnessScript OP_EQUAL [01]',
      'verdict [01]',
    ]);
    expect(run.steps[3]).toMatchObject({ flavour: 'p2wsh', version: 0, hex: SUM });
    expect(run.steps[3].items.map((item) => item.text)).toEqual(['OP_ADD', 'OP_5', 'OP_EQUAL']);
  });


  it('turns down a witness script that is not the one hashed, that ends on false, or that leaves more than its answer', () => {
    const lock = `0 0x${sha256Hex(SUM)}`;

    expect(spend('', lock, []).error).toEqual({ code: 'witness-empty' });
    expect(spend('', lock, ['02', '03', `${SUM}61`]).error).toEqual({ code: 'witness-script-mismatch' });
    expect(spend('', lock, ['02', '04', SUM]).error).toEqual({ code: 'false-on-top' });
    expect(spend('', lock, ['07', '02', '03', SUM]).error).toEqual({ code: 'witness-unclean-stack', left: 2 });
  });


  it('turns down a witness script that cannot be read to its end, and an item too large to be pushed', () => {
    const cut = '5102aa';
    const drop = script('OP_DROP 1').hex;

    expect(spend('', `0 0x${sha256Hex(cut)}`, [cut]).error).toEqual({ code: 'witness-script-broken' });
    expect(spend('', `0 0x${sha256Hex(drop)}`, ['00'.repeat(521), drop]).error).toEqual({ code: 'push-too-large', size: 521, limit: 520 });
    expect(spend('', `0 0x${sha256Hex(drop)}`, ['00'.repeat(520), drop]).ok).toBe(true);
  });


  it('lets nothing stand in the unlocking script of a witness program', () => {
    expect(spend('1', `0 0x${KEY_HASH}`, ['aa', '02aa']).error).toEqual({ code: 'witness-with-unlock' });
  });


  it('reads a witness program behind a script hash the same way, once the hash has matched', () => {
    const program = `0014${KEY_HASH}`;
    const lock = `OP_HASH160 0x${hash160(program)} OP_EQUAL`;
    const run = spend(`0x${program}`, lock, ['aa', '02aa']);

    expect(run.ok).toBe(true);
    expect(run.steps.filter((step) => step.kind !== 'item').map((step) => step.kind)).toEqual(['handover', 'redeem', 'witness', 'verdict']);
    expect(flavours(run)).toEqual(['p2wpkh']);
    expect(spend(`1 0x${program}`, lock, ['aa', '02aa']).error).toEqual({ code: 'witness-with-unlock-p2sh' });
    expect(spend(`0x${pushOf(program)}`, `OP_HASH160 0x${hash160(pushOf(program))} OP_EQUAL`, []).ok).toBe(true);
  });


  it('refuses version 0 with any other length, and accepts every version nobody has given rules', () => {
    expect(spend('', `0 0x${'aa'.repeat(21)}`, ['aa']).error).toEqual({ code: 'witness-wrong-length', size: 21 });
    expect(flavours(spend('', `2 0x${'aa'.repeat(32)}`, ['whatever'].map(() => 'ff')))).toEqual(['unknown']);
    expect(spend('', `2 0x${'aa'.repeat(32)}`, []).ok).toBe(true);
    expect(spend('', `16 0x${'aa'.repeat(40)}`, []).ok).toBe(true);
    expect(spend('', '1 0x4e73', [])).toMatchObject({ ok: true });
    expect(spend('', '1 0x4e73', []).steps.at(-1).stack).toEqual(['01']);
  });


  it('does not take for a witness program what is one byte too short or too long, or has a word after it', () => {
    expect(flavours(spend('', '1 0xaa', []))).toEqual([]);
    expect(flavours(spend('', `1 0x${'aa'.repeat(41)}`, []))).toEqual([]);
    expect(flavours(spend('', `1 0x${'aa'.repeat(32)} OP_NOP`, []))).toEqual([]);
  });


  it('fails a spend that brings a witness nobody asked for', () => {
    expect(spend('2 3', 'OP_ADD 5 OP_EQUAL', ['aa']).error).toEqual({ code: 'witness-unexpected' });
    expect(spend('2 3', 'OP_ADD 5 OP_EQUAL', []).ok).toBe(true);
  });
});







// -----------------------------------------------------------
// Bitcoin Core's vectors
// -----------------------------------------------------------
//
// The machine's rules are fixed: pay-to-script-hash, strict
// DER signatures, the empty extra item of OP_CHECKMULTISIG,
// the two lock-time opcodes — OP_CHECKLOCKTIMEVERIFY and
// OP_CHECKSEQUENCEVERIFY — and witness programs are always
// on, and the relay-only rules Core calls policy are not
// applied.
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
    SIG_HASHTYPE: 'STRICTENC',
    WITNESS_PUBKEYTYPE: 'WITNESS_PUBKEYTYPE',
    MINIMALIF: 'MINIMALIF',
    DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM: 'DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM',
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
    if (vector.witness.length > 0 && !has('WITNESS')) return 'always on: WITNESS';
    if (result.error === 'signature-encoding' && !has('DERSIG') && !has('STRICTENC') && !has('LOW_S')) return 'always on: DERSIG';
    if (result.error === 'null-dummy' && !has('NULLDUMMY')) return 'always on: NULLDUMMY';
    if (!has('CHECKLOCKTIMEVERIFY') && /CHECKLOCKTIMEVERIFY|NOP2/.test(words)) return 'always on: CHECKLOCKTIMEVERIFY';
    if (!has('CHECKSEQUENCEVERIFY') && /CHECKSEQUENCEVERIFY|NOP3/.test(words)) return 'always on: CHECKSEQUENCEVERIFY';
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
    expect(VECTORS).toHaveLength(1207);
    expect(agreed).toBe(1059);
    expect(counts).toEqual({
      'not applied: MINIMALDATA': 75,
      'not applied: DISCOURAGE_UPGRADABLE_NOPS': 10,
      'not applied: STRICTENC': 6,
      'not applied: WITNESS_PUBKEYTYPE': 10,
      'not applied: MINIMALIF': 6,
      'not applied: DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM': 1,
      'not applied: NULLFAIL': 3,
      'not applied: CLEANSTACK': 2,
      'not applied: LOW_S': 1,
      'not applied: SIGPUSHONLY': 1,
      'always on: DERSIG': 17,
      'always on: NULLDUMMY': 4,
      'always on: CHECKLOCKTIMEVERIFY': 3,
      'always on: CHECKSEQUENCEVERIFY': 1,
      'always on: P2SH': 2,
      'always on: WITNESS': 6,
    });
  });
});

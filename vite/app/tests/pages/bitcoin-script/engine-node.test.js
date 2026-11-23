// -----------------------------------------------------------
//  [*] Tests — Bitcoin script playground: what a full node
//  checks
//
//  The node's four questions in their order (engine/node.js)
//  and the timeline they leave — the page plays that timeline
//  back, so its shape is the node's contract: an entry per
//  question asked, every step of the scripts between them, a
//  verdict at the end, and nothing after the first no.
//
//  Then the three things the script machine has to ask a
//  transaction — is this a signature of it, is its lock time
//  late enough, does its input promise a long enough wait —
//  answered with real keys and the real bytes of a
//  transaction.
//
//  Last, the two lock-time opcodes are held against the whole
//  transactions Bitcoin Core tests them with
//  (support/bitcoin-script/core-transactions.js): every one
//  of them must fare here as it does there, but for the one
//  that only passes without a rule the engine always applies.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { INVALID, VALID, runTransaction } from '../../support/bitcoin-script/core-transactions';
import { keyFrom, seedKey, signWith } from '@/pages/BitcoinScript/engine/keys';
import { FINAL_SEQUENCE, LOCKTIME_THRESHOLD, MAX_MONEY, SEQUENCE, checkerFor, hasBit, verifySpend } from '@/pages/BitcoinScript/engine/node';
import { parseScript, serializeScript } from '@/pages/BitcoinScript/engine/script';
import { signatureHash } from '@/pages/BitcoinScript/engine/transaction';


// A script from its words, as the node takes it
const script = (text) => {
  const { items } = parseScript(text);
  return { items, hex: serializeScript(items) };
};

// A coin anybody who can count may spend, and the script that
// spends it
const LOCK = script('OP_ADD 5 OP_EQUAL');
const UNLOCK = script('2 3');

// A transaction that spends the coin, with what a test changes
const spending = ({ outputs = [4000], lockTime = 0, sequence = FINAL_SEQUENCE, unlock = UNLOCK, version = 2 } = {}) => ({
  version,
  inputs: [{ txid: 'aa'.repeat(32), vout: 1, script: unlock.hex, sequence }],
  outputs: outputs.map((value) => ({ value, script: '51' })),
  lockTime,
});

// The node's check of that transaction, with what a test changes
const check = ({ coin = {}, height = 850000, unlock = UNLOCK, ...transaction } = {}) => verifySpend({
  transaction: spending({ unlock, ...transaction }),
  coin: { found: true, spent: false, value: 5000, lock: LOCK, ...coin },
  unlock,
  height,
});

// The stages of a timeline, in order
const stagesOf = (result) => result.timeline.map((entry) => entry.stage);







// -----------------------------------------------------------
// The four questions
// -----------------------------------------------------------

describe('the four questions', () => {

  it('asks them in order and ends with the verdict', () => {
    const result = check();

    expect(result).toMatchObject({ valid: true, failed: null, error: null });
    expect(stagesOf(result)).toEqual(['coin', 'amounts', 'finality', 'script', 'script', 'script', 'script', 'script', 'script', 'verdict']);
    expect(result.timeline[0]).toMatchObject({ ok: true, outpoint: { txid: 'aa'.repeat(32), vout: 1 } });
    expect(result.timeline[1]).toMatchObject({ ok: true, input: 5000, output: 4000, fee: 1000 });
    expect(result.timeline.at(-1)).toMatchObject({ ok: true, stack: ['01'] });
  });


  it('stops at the first question when the coin is not there', () => {
    const result = check({ coin: { found: false } });

    expect(result).toMatchObject({ valid: false, failed: 'coin', error: { code: 'no-such-coin' } });
    expect(stagesOf(result)).toEqual(['coin', 'verdict']);
  });


  it('stops at the first question when the coin was already spent', () => {
    const result = check({ coin: { spent: true } });

    expect(result).toMatchObject({ valid: false, failed: 'coin', error: { code: 'already-spent' } });
    expect(stagesOf(result)).toEqual(['coin', 'verdict']);
  });


  it('stops at the amounts when the outputs hand out more than the coin holds', () => {
    const result = check({ outputs: [3000, 2001] });

    expect(result).toMatchObject({ valid: false, failed: 'amounts', error: { code: 'overspend' } });
    expect(result.timeline[1]).toMatchObject({ ok: false, input: 5000, output: 5001, fee: -1 });
    expect(stagesOf(result)).toEqual(['coin', 'amounts', 'verdict']);
  });


  it('lets a transaction leave the miner nothing', () => {
    expect(check({ outputs: [5000] }).valid).toBe(true);
  });


  it('turns down more money than there will ever be', () => {
    const result = check({ coin: { value: MAX_MONEY + 2 }, outputs: [MAX_MONEY + 1] });

    expect(result).toMatchObject({ valid: false, failed: 'amounts', error: { code: 'too-much-money' } });
  });


  it('stops at the scripts when the unlocking script does not open the lock', () => {
    const result = check({ unlock: script('2 4') });

    expect(result).toMatchObject({ valid: false, failed: 'script', error: { code: 'false-on-top' } });
    expect(result.timeline.at(-1)).toMatchObject({ stage: 'verdict', ok: false, failed: 'script', stack: [''] });
  });
});







// -----------------------------------------------------------
// The time
// -----------------------------------------------------------

describe('the time', () => {

  const timeOf = (result) => result.timeline.find((entry) => entry.stage === 'finality');

  it('lets a transaction without a lock time into any block', () => {
    expect(timeOf(check())).toMatchObject({ ok: true, why: 'none' });
  });


  it('ignores a lock time when every input has switched lock times off', () => {
    expect(timeOf(check({ lockTime: 900000, height: 1 }))).toMatchObject({ ok: true, why: 'switched-off' });
  });


  it('lets a locked transaction in once the chain stands at its block', () => {
    const lockTime = 840000;
    const sequence = FINAL_SEQUENCE - 1;

    expect(timeOf(check({ lockTime, sequence, height: 840000 }))).toMatchObject({ ok: true, why: 'reached' });
    expect(timeOf(check({ lockTime, sequence, height: 850000 }))).toMatchObject({ ok: true, why: 'reached' });
  });


  it('holds a locked transaction back while the chain is below its block', () => {
    const result = check({ lockTime: 840000, sequence: FINAL_SEQUENCE - 1, height: 839999 });

    expect(result).toMatchObject({ valid: false, failed: 'finality', error: { code: 'locktime-too-early' } });
    expect(stagesOf(result)).toEqual(['coin', 'amounts', 'finality', 'verdict']);
  });


  it('turns away a lock time that names a date', () => {
    const result = check({ lockTime: LOCKTIME_THRESHOLD, sequence: FINAL_SEQUENCE - 1 });

    expect(result).toMatchObject({ valid: false, failed: 'finality', error: { code: 'locktime-a-date' } });
  });


  it('asks nothing of a coin\'s age while the input has switched relative lock times off', () => {
    expect(timeOf(check())).toMatchObject({ ok: true, age: 'none', wait: 0, confirmations: null });
    expect(timeOf(check({ lockTime: 840000, sequence: FINAL_SEQUENCE - 1 }))).toMatchObject({ ok: true, age: 'none' });
  });


  it('lets a transaction in once the coin is as old as its input promises to wait', () => {
    expect(timeOf(check({ sequence: 144, coin: { height: 849857 } }))).toMatchObject({ ok: true, age: 'reached', sequence: 144, wait: 144, confirmations: 144 });
    expect(timeOf(check({ sequence: 144, coin: { height: 800000 } }))).toMatchObject({ ok: true, age: 'reached', confirmations: 50001 });
  });


  it('holds a transaction back while the coin is younger than that', () => {
    const result = check({ sequence: 144, coin: { height: 849858 } });

    expect(result).toMatchObject({ valid: false, failed: 'finality', error: { code: 'sequence-too-early', wait: 144, confirmations: 143 } });
    expect(stagesOf(result)).toEqual(['coin', 'amounts', 'finality', 'verdict']);
  });


  it('counts the block that holds the coin as its first confirmation', () => {
    expect(timeOf(check({ sequence: 1, coin: { height: 850000 } }))).toMatchObject({ ok: true, confirmations: 1 });
    expect(timeOf(check({ sequence: 2, coin: { height: 850000 } }))).toMatchObject({ ok: false, confirmations: 1 });
    expect(timeOf(check({ sequence: 0, coin: { height: 850000 } }))).toMatchObject({ ok: true, age: 'reached', wait: 0 });
  });


  it('reads the wait from the lowest sixteen bits of the sequence number', () => {
    expect(timeOf(check({ sequence: 2 ** 16 + 5, coin: { height: 849996 } }))).toMatchObject({ ok: true, wait: 5, confirmations: 5 });
    expect(timeOf(check({ sequence: 2 ** 16 + 5, coin: { height: 849997 } }))).toMatchObject({ ok: false, wait: 5, confirmations: 4 });
  });


  it('turns away a wait counted in seconds', () => {
    expect(check({ sequence: SEQUENCE.SECONDS + 1, coin: { height: 800000 } })).toMatchObject({ valid: false, failed: 'finality', error: { code: 'sequence-seconds' } });
  });


  it('does not hold a transaction of the first version to its sequence number', () => {
    expect(timeOf(check({ version: 1, sequence: 144, coin: { height: 850000 } }))).toMatchObject({ ok: true, age: 'none' });
  });


  it('asks about the transaction\'s own lock time before the coin\'s age', () => {
    const result = check({ lockTime: 860000, sequence: 144, coin: { height: 850000 } });

    expect(result.error).toEqual({ code: 'locktime-too-early' });
  });
});







// -----------------------------------------------------------
// What the script machine asks
// -----------------------------------------------------------

describe('what the script machine asks of the transaction', () => {

  const jonas = keyFrom(seedKey('Jonas'));
  const gabija = keyFrom(seedKey('Gabija'));
  const scriptCode = `21${jonas.publicKey}ac`;
  const transaction = spending({ lockTime: 840000, sequence: FINAL_SEQUENCE - 1 });
  const digest = signatureHash(transaction, 0, scriptCode);
  const signature = signWith(jonas.privateKey, digest);
  const checker = checkerFor(transaction, 0);

  it('accepts the signature of the transaction by the key that made it', () => {
    expect(checker.checkSignature(signature, jonas.publicKey, scriptCode)).toEqual({ valid: true, digest, why: null });
  });


  it('says why a signature does not pass', () => {
    expect(checker.checkSignature(signature, gabija.publicKey, scriptCode)).toMatchObject({ valid: false, why: 'wrong-signature' });
    expect(checker.checkSignature(signature, jonas.publicKey, `21${gabija.publicKey}ac`)).toMatchObject({ valid: false, why: 'wrong-signature' });
    expect(checker.checkSignature(signature, 'abcd', scriptCode)).toMatchObject({ valid: false, why: 'bad-public-key' });
    expect(checker.checkSignature('', jonas.publicKey, scriptCode)).toEqual({ valid: false, why: 'empty-signature' });
  });


  it('no longer accepts a signature once the transaction has changed', () => {
    const changed = checkerFor(spending({ lockTime: 840000, sequence: FINAL_SEQUENCE - 1, outputs: [3999] }), 0);

    expect(changed.checkSignature(signature, jonas.publicKey, scriptCode)).toMatchObject({ valid: false, why: 'wrong-signature' });
  });


  it('breaks the script on bytes that are no signature, and on one that signs only a part', () => {
    expect(checker.checkSignature('abcdef01', jonas.publicKey, scriptCode)).toEqual({ fault: { code: 'signature-encoding' } });
    expect(checker.checkSignature(`${signature.slice(0, -2)}03`, jonas.publicKey, scriptCode)).toEqual({ fault: { code: 'signature-type', type: 3 } });
  });


  it('answers a lock time demand from the transaction lock time', () => {
    expect(checker.checkLockTime(840000)).toEqual({ lockTime: 840000, why: null });
    expect(checker.checkLockTime(1)).toEqual({ lockTime: 840000, why: null });
    expect(checker.checkLockTime(840001)).toEqual({ lockTime: 840000, why: 'too-early' });
    expect(checker.checkLockTime(-1)).toEqual({ lockTime: 840000, why: 'negative' });
    expect(checker.checkLockTime(LOCKTIME_THRESHOLD)).toEqual({ lockTime: 840000, why: 'different-kind' });
  });


  it('does not meet a lock time demand in an input that has switched lock times off', () => {
    const final = checkerFor(spending({ lockTime: 840000 }), 0);

    expect(final.checkLockTime(840000)).toEqual({ lockTime: 840000, why: 'final-sequence' });
  });


  it('answers a demand for a wait from the sequence number of the input', () => {
    const waiting = checkerFor(spending({ sequence: 144 }), 0);

    expect(waiting.checkSequence(144)).toEqual({ sequence: 144, why: null });
    expect(waiting.checkSequence(1)).toEqual({ sequence: 144, why: null });
    expect(waiting.checkSequence(145)).toEqual({ sequence: 144, why: 'too-early' });
    expect(waiting.checkSequence(-1)).toEqual({ sequence: 144, why: 'negative' });
    expect(waiting.checkSequence(SEQUENCE.SECONDS + 1)).toEqual({ sequence: 144, why: 'different-kind' });
  });


  it('does not meet a demand for a wait in an input that promises none, or in a transaction of the first version', () => {
    expect(checkerFor(spending(), 0).checkSequence(1)).toEqual({ sequence: FINAL_SEQUENCE, why: 'switched-off' });
    expect(checkerFor(spending({ sequence: FINAL_SEQUENCE - 1 }), 0).checkSequence(0)).toEqual({ sequence: FINAL_SEQUENCE - 1, why: 'switched-off' });
    expect(checkerFor(spending({ sequence: 144, version: 1 }), 0).checkSequence(144)).toEqual({ sequence: 144, why: 'old-version' });
  });


  it('stands idle for a demand that itself has the switched-off bit set', () => {
    expect(checkerFor(spending(), 0).checkSequence(SEQUENCE.DISABLED)).toEqual({ sequence: FINAL_SEQUENCE, why: null, idle: true });
    expect(checkerFor(spending({ version: 1 }), 0).checkSequence(SEQUENCE.DISABLED + 7)).toMatchObject({ why: null, idle: true });
  });


  it('tells the bits of a number longer than thirty-two bits apart', () => {
    expect(hasBit(2 ** 31, SEQUENCE.DISABLED)).toBe(true);
    expect(hasBit(2 ** 32, SEQUENCE.DISABLED)).toBe(false);
    expect(hasBit(3 * 2 ** 31, SEQUENCE.DISABLED)).toBe(true);
    expect(hasBit(2 ** 22 + 2 ** 35, SEQUENCE.SECONDS)).toBe(true);
    expect(hasBit(2 ** 22 - 1, SEQUENCE.SECONDS)).toBe(false);
  });
});







// -----------------------------------------------------------
// Bitcoin Core's lock-time transactions
// -----------------------------------------------------------
//
// The engine always applies pay-to-script-hash, strict DER
// signatures, the empty extra item of OP_CHECKMULTISIG and
// both lock-time opcodes. A transaction Core calls valid only
// with one of those switched off is therefore refused here —
// there is one, and it must be refused for that very rule.
// -----------------------------------------------------------

describe("Bitcoin Core's lock-time transactions", () => {

  const ALWAYS_ON = ['P2SH', 'DERSIG', 'NULLDUMMY', 'CHECKLOCKTIMEVERIFY', 'CHECKSEQUENCEVERIFY'];
  const breaksAFixedRule = (vector) => vector.flags.some((flag) => ALWAYS_ON.includes(flag));

  it('holds all of them: 44 valid and 39 invalid', () => {
    expect(VALID).toHaveLength(44);
    expect(INVALID).toHaveLength(39);
    expect(VALID.filter((vector) => /CHECKSEQUENCEVERIFY/.test(vector.comment) || vector.coins.some((coin) => coin[2].includes('CHECKSEQUENCEVERIFY'))).length).toBeGreaterThan(25);
  });


  it('accepts every valid transaction that breaks none of the rules it always applies', () => {
    const refused = VALID.filter((vector) => !breaksAFixedRule(vector)).filter((vector) => !runTransaction(vector).ok);

    expect(refused.map((vector) => `${vector.comment}: ${vector.coins[0][2]}`)).toEqual([]);
    expect(VALID.filter((vector) => !breaksAFixedRule(vector))).toHaveLength(43);
  });


  it('refuses the one valid transaction that needs lax signatures, and for its signature', () => {
    const excused = VALID.filter(breaksAFixedRule);

    expect(excused.map((vector) => [vector.comment, vector.flags])).toEqual([['A transaction with a non-standard DER signature.', ['DERSIG', 'LOW_S', 'STRICTENC']]]);
    expect(runTransaction(excused[0])).toMatchObject({ ok: false, error: 'signature-encoding' });
  });


  it('refuses every invalid transaction, each of them by a rule it applies', () => {
    const accepted = INVALID.filter((vector) => runTransaction(vector).ok);

    expect(accepted.map((vector) => `${vector.comment}: ${vector.coins[0][2]}`)).toEqual([]);
    expect(INVALID.every((vector) => vector.flags.every((flag) => ALWAYS_ON.includes(flag)))).toBe(true);
  });


  it.each([
    ['By-height locks, with argument just beyond txin.nSequence', 'sequence', 'too-early'],
    ['Argument negative with by-blockheight txin.nSequence=0', 'sequence', 'negative'],
    ['Argument/tx height/time mismatch, both versions', 'sequence', 'different-kind'],
    ['Failure due to insufficient tx.nVersion (<2)', 'sequence', 'old-version'],
    ['By-height locks, with argument just beyond tx nLockTime', 'locktime', 'too-early'],
    ['Input locked', 'locktime', 'final-sequence'],
  ])('refuses the transactions under "%s" for the reason Core gives', (comment, error, why) => {
    const vectors = INVALID.filter((vector) => vector.comment === comment && vector.coins.some((coin) => /VERIFY/.test(coin[2])));

    expect(vectors.length).toBeGreaterThan(0);
    for (const vector of vectors) {
      if (comment.startsWith('Argument/tx') && !vector.coins[0][2].includes(error === 'sequence' ? 'SEQUENCE' : 'LOCKTIME')) continue;
      expect(runTransaction(vector)).toMatchObject({ ok: false, error, why });
    }
  });
});

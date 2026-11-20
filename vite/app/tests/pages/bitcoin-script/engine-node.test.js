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
//  Then the two things the script machine has to ask a
//  transaction — is this a signature of it, is its lock time
//  late enough — answered with real keys and the real bytes
//  of a transaction.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { keyFrom, seedKey, signWith } from '@/pages/BitcoinScript/engine/keys';
import { FINAL_SEQUENCE, LOCKTIME_THRESHOLD, MAX_MONEY, checkerFor, verifySpend } from '@/pages/BitcoinScript/engine/node';
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
const spending = ({ outputs = [4000], lockTime = 0, sequence = FINAL_SEQUENCE, unlock = UNLOCK } = {}) => ({
  version: 2,
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
});

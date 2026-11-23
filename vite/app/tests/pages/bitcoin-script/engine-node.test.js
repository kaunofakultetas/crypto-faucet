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
//  A signature says how much of the transaction it signs, so
//  the messages of every signature type are checked next:
//  against the examples the proposal for witness signatures
//  (BIP 143) works through, and by changing the parts of a
//  transaction a type leaves unsigned.
//
//  Last, the engine is held against the whole transactions
//  Bitcoin Core is tested with
//  (support/bitcoin-script/core-transactions.js): every one
//  of them must fare here as its rules say — and the only
//  rules the engine does not go by are the ones Core applies
//  to what it relays and never to a block.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { INVALID, VALID, readTransaction, runTransaction } from '../../support/bitcoin-script/core-transactions';
import { keyFrom, seedKey, signWith } from '@/pages/BitcoinScript/engine/keys';
import { FINAL_SEQUENCE, LOCKTIME_THRESHOLD, MAX_MONEY, SEQUENCE, checkerFor, hasBit, verifySpend } from '@/pages/BitcoinScript/engine/node';
import { parseScript, serializeScript } from '@/pages/BitcoinScript/engine/script';
import { signDigest, verifyDigest } from '@/pages/BitcoinScript/engine/secp256k1';
import { SIGHASH_ALL, SIGHASH_ANYONECANPAY, SIGHASH_NONE, SIGHASH_SINGLE, signatureHash, witnessSignatureHash } from '@/pages/BitcoinScript/engine/transaction';


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


  it('breaks the script on bytes that are no signature', () => {
    expect(checker.checkSignature('abcdef01', jonas.publicKey, scriptCode)).toEqual({ fault: { code: 'signature-encoding' } });
  });


  it('reads from the last byte of a signature how much it signs, and checks it against that', () => {
    const relabelled = `${signature.slice(0, -2)}03`;
    const single = `${signDigest(jonas.privateKey, signatureHash(transaction, 0, scriptCode, SIGHASH_SINGLE))}03`;

    expect(checker.checkSignature(relabelled, jonas.publicKey, scriptCode)).toMatchObject({ valid: false, why: 'wrong-signature' });
    expect(checker.checkSignature(single, jonas.publicKey, scriptCode)).toMatchObject({ valid: true, digest: signatureHash(transaction, 0, scriptCode, SIGHASH_SINGLE) });
  });


  it('checks a signature for a witness program against a message with the amount of the coin in it', () => {
    const coins = [{ value: 5000, script: scriptCode }];
    const digest = witnessSignatureHash(transaction, 0, scriptCode, 5000);
    const witnessed = `${signDigest(jonas.privateKey, digest)}01`;

    expect(checkerFor(transaction, 0, coins).checkSignature(witnessed, jonas.publicKey, scriptCode, 'witness0')).toMatchObject({ valid: true, digest });
    expect(checkerFor(transaction, 0, [{ value: 5001, script: scriptCode }]).checkSignature(witnessed, jonas.publicKey, scriptCode, 'witness0')).toMatchObject({ valid: false });
    expect(checkerFor(transaction, 0, coins).checkSignature(witnessed, jonas.publicKey, scriptCode)).toMatchObject({ valid: false });
  });


  it('leaves every OP_CODESEPARATOR out of the script an original signature signs, and none out of a witness one', () => {
    const marked = `ab${scriptCode}ab`;
    const coins = [{ value: 5000, script: scriptCode }];

    expect(checker.checkSignature(signature, jonas.publicKey, marked)).toMatchObject({ valid: true });
    expect(checkerFor(transaction, 0, coins).checkSignature(signature, jonas.publicKey, marked, 'witness0').digest).toBe(witnessSignatureHash(transaction, 0, marked, 5000));
    expect(witnessSignatureHash(transaction, 0, marked, 5000)).not.toBe(witnessSignatureHash(transaction, 0, scriptCode, 5000));
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
// how much a signature signs
// -----------------------------------------------------------
//
// The same transaction with two inputs and two outputs, and
// one part of it changed at a time: a signature type is told
// by which changes its message does not notice.
// -----------------------------------------------------------

describe('how much a signature signs', () => {

  const CODE = '76a914751e76e8199196d454941c45d1b3a323f1433bd688ac';
  const AMOUNT = 600_000_000;
  const base = {
    version: 2,
    inputs: [
      { txid: 'aa'.repeat(32), vout: 0, script: '', sequence: 0xfffffffe },
      { txid: 'bb'.repeat(32), vout: 1, script: '', sequence: 0xfffffffd },
    ],
    outputs: [{ value: 1000, script: '51' }, { value: 2000, script: '52' }],
    lockTime: 0,
  };

  // The transaction with one part changed
  const CHANGES = {
    'the other input': { ...base, inputs: [{ ...base.inputs[0], vout: 7 }, base.inputs[1]] },
    "the other input's sequence number": { ...base, inputs: [{ ...base.inputs[0], sequence: 5 }, base.inputs[1]] },
    'its own output': { ...base, outputs: [base.outputs[0], { value: 2001, script: '52' }] },
    'the other output': { ...base, outputs: [{ value: 999, script: '51' }, base.outputs[1]] },
    'an output added': { ...base, outputs: [...base.outputs, { value: 1, script: '53' }] },
    'an input added': { ...base, inputs: [...base.inputs, { txid: 'cc'.repeat(32), vout: 0, script: '', sequence: 0xffffffff }] },
    'its own sequence number': { ...base, inputs: [base.inputs[0], { ...base.inputs[1], sequence: 9 }] },
    'the lock time': { ...base, lockTime: 1 },
  };

  // The two messages of the second input, each as a function
  // of the transaction and the type
  const MESSAGES = {
    original: (transaction, type) => signatureHash(transaction, 1, CODE, type),
    witness: (transaction, type) => witnessSignatureHash(transaction, 1, CODE, AMOUNT, type),
  };

  // The changes a signature of a type does not notice
  const unnoticed = (message, type) => Object.keys(CHANGES).filter((change) => message(CHANGES[change], type) === message(base, type));

  it.each(Object.keys(MESSAGES))('lets nothing change under a signature of everything (%s message)', (kind) => {
    expect(unnoticed(MESSAGES[kind], SIGHASH_ALL)).toEqual([]);
  });


  it.each(Object.keys(MESSAGES))('lets the outputs and the other sequence numbers change under SIGHASH_NONE (%s message)', (kind) => {
    expect(unnoticed(MESSAGES[kind], SIGHASH_NONE)).toEqual(["the other input's sequence number", 'its own output', 'the other output', 'an output added']);
  });


  it.each(Object.keys(MESSAGES))('holds only its own output under SIGHASH_SINGLE (%s message)', (kind) => {
    expect(unnoticed(MESSAGES[kind], SIGHASH_SINGLE)).toEqual(["the other input's sequence number", 'the other output', 'an output added']);
  });


  it.each(Object.keys(MESSAGES))('lets other inputs come and go under ANYONECANPAY (%s message)', (kind) => {
    expect(unnoticed(MESSAGES[kind], SIGHASH_ALL + SIGHASH_ANYONECANPAY)).toEqual(['the other input', "the other input's sequence number", 'an input added']);
    expect(unnoticed(MESSAGES[kind], SIGHASH_NONE + SIGHASH_ANYONECANPAY)).toEqual(['the other input', "the other input's sequence number", 'its own output', 'the other output', 'an output added', 'an input added']);
  });


  it('signs the number one where a SIGHASH_SINGLE signature has no output of its own, by the original rules alone', () => {
    const short = { ...base, outputs: [base.outputs[0]] };

    expect(signatureHash(short, 1, CODE, SIGHASH_SINGLE)).toBe(`01${'00'.repeat(31)}`);
    expect(signatureHash(short, 1, CODE, SIGHASH_SINGLE + SIGHASH_ANYONECANPAY)).toBe(`01${'00'.repeat(31)}`);
    expect(witnessSignatureHash(short, 1, CODE, AMOUNT, SIGHASH_SINGLE)).not.toBe(`01${'00'.repeat(31)}`);
  });


  it('puts the type itself into the message', () => {
    expect(new Set([0x01, 0x02, 0x03, 0x81, 0x82, 0x83, 0x41].map((type) => signatureHash(base, 1, CODE, type))).size).toBe(7);
    expect(new Set([0x01, 0x02, 0x03, 0x81, 0x82, 0x83, 0x41].map((type) => witnessSignatureHash(base, 1, CODE, AMOUNT, type))).size).toBe(7);
  });


  it('gives the message BIP 143 works out for a coin paid to a witness key hash', () => {
    const unsigned = readTransaction('0100000002fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f0000000000eeffffffef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a0100000000ffffffff02202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac11000000');
    const digest = witnessSignatureHash(unsigned, 1, '76a9141d0f172a0ecb48aee1be1f2687d2963ae33f71a188ac', 600_000_000);

    expect(digest).toBe('c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670');
    expect(verifyDigest('304402203609e17b84f6a7d30c80bfa610b5b4542f32a8a0d5447a12fb1366d7f01cc44a0220573a954c4518331561406f90300e8f3358f51928d43c212a8caed02de67eebee', digest, '025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357')).toBe(true);
  });


  it('gives the message BIP 143 works out for a witness key hash behind a script hash', () => {
    const unsigned = readTransaction('0100000001db6b1b20aa0fd7b23880be2ecbd4a98130974cf4748fb66092ac4d3ceb1a54770100000000feffffff02b8b4eb0b000000001976a914a457b684d7f0d539a46a45bbc043f35b59d0d96388ac0008af2f000000001976a914fd270b1ee6abcaea97fea7ad0402e8bd8ad6d77c88ac92040000');

    expect(witnessSignatureHash(unsigned, 0, '76a91479091972186c449eb1ded22b78e40d009bdf008988ac', 1_000_000_000)).toBe('64f3b0f4dd2bb3aa1ce8566d220cc74dda9df97d8490cc81d89d735c92e59fb6');
  });


  it.each([
    [0x01, '185c0be5263dce5b4bb50a047973c1b6272bfbd0103a89444597dc40b248ee7c'],
    [0x02, 'e9733bc60ea13c95c6527066bb975a2ff29a925e80aa14c213f686cbae5d2f36'],
    [0x03, '1e1f1c303dc025bd664acb72e583e933fae4cff9148bf78c157d1e8f78530aea'],
    [0x81, '2a67f03e63a6a422125878b40b82da593be8d4efaafe88ee528af6e5a9955c6e'],
    [0x82, '781ba15f3779d5542ce8ecb5c18716733a5ee42a6f51488ec96154934e2c890a'],
    [0x83, '511e8e52ed574121fc1b654970395502128263f62662e076dc6baf05c2e6a99b'],
  ])('gives the message BIP 143 works out for a six-of-six witness script signed with type %i', (type, expected) => {
    const unsigned = readTransaction('010000000136641869ca081e70f394c6948e8af409e18b619df2ed74aa106c1ca29787b96e0100000000ffffffff0200e9a435000000001976a914389ffce9cd9ae88dcc0631e88a821ffdbe9bfe2688acc0832f05000000001976a9147480a33f950689af511e6e84c138dbbd3c3ee41588ac00000000');
    const witnessScript = '56210307b8ae49ac90a048e9b53357a2354b3334e9c8bee813ecb98e99a7e07e8c3ba32103b28f0c28bfab54554ae8c658ac5c3e0ce6e79ad336331f78c428dd43eea8449b21034b8113d703413d57761b8b9781957b8c0ac1dfe69f492580ca4195f50376ba4a21033400f6afecb833092a9a21cfdf1ed1376e58c5d1f47de74683123987e967a8f42103a6d48b1131e94ba04d9737d61acdaa1322008af9602b3b14862c07a1789aac162102d8b661b0b3302ee2f162b09e07a55ad5dfbe673a9f01d9f0c19617681024306b56ae';

    expect(witnessSignatureHash(unsigned, 0, witnessScript, 987_654_321, type)).toBe(expected);
  });
});







// -----------------------------------------------------------
// Bitcoin Core's transactions
// -----------------------------------------------------------
//
// The engine goes by the rules every block is held to, all of
// them, always: pay-to-script-hash, strict DER signatures,
// the empty extra item of OP_CHECKMULTISIG, both lock-time
// opcodes, witness programs and Taproot. A transaction Core
// calls valid only with one of those switched off must
// therefore be refused here, and an invalid one that breaks
// only those must be refused too. What the engine does not go
// by is named in the tests: the rules Core applies to what it
// relays, and the checks of a transaction's own shape, which
// are not a matter of scripts.
// -----------------------------------------------------------

describe("Bitcoin Core's transactions", () => {

  const ALWAYS_ON = ['P2SH', 'DERSIG', 'NULLDUMMY', 'CHECKLOCKTIMEVERIFY', 'CHECKSEQUENCEVERIFY', 'WITNESS', 'TAPROOT'];
  const breaksAFixedRule = (vector) => vector.flags.some((flag) => ALWAYS_ON.includes(flag));
  const brokenOnlyByFixedRules = (vector) => vector.flags.every((flag) => ALWAYS_ON.includes(flag));
  const tally = (list) => list.reduce((counts, key) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 }), {});

  it('holds all of them: 120 valid and 93 invalid', () => {
    expect(VALID).toHaveLength(120);
    expect(INVALID).toHaveLength(93);
  });


  it('accepts every valid transaction that breaks none of the rules it always applies', () => {
    const refused = VALID.filter((vector) => !breaksAFixedRule(vector)).filter((vector) => !runTransaction(vector).ok);

    expect(refused.map((vector) => `${vector.comment}: ${runTransaction(vector).error}`)).toEqual([]);
    expect(VALID.filter((vector) => !breaksAFixedRule(vector))).toHaveLength(113);
  });


  it('refuses every valid transaction that only passes with one of those rules switched off, and for that rule', () => {
    const excused = VALID.filter(breaksAFixedRule);

    expect(excused.filter((vector) => runTransaction(vector).ok).map((vector) => vector.comment)).toEqual([]);
    expect(tally(excused.map((vector) => `${vector.flags.filter((flag) => ALWAYS_ON.includes(flag))}: ${runTransaction(vector).error}`))).toEqual({
      'DERSIG: signature-encoding': 4,
      'DERSIG,NULLDUMMY: null-dummy': 3,
    });
  });


  it('refuses every invalid transaction that breaks a rule it applies', () => {
    const accepted = INVALID.filter(brokenOnlyByFixedRules).filter((vector) => runTransaction(vector).ok);

    expect(accepted.map((vector) => `${vector.comment}: ${vector.coins[0][2]}`)).toEqual([]);
    expect(INVALID.filter(brokenOnlyByFixedRules)).toHaveLength(70);
  });


  it('lets through only what a relay rule or a check of the transaction itself would stop', () => {
    const accepted = INVALID.filter((vector) => runTransaction(vector).ok);

    expect(tally(accepted.map((vector) => vector.flags.filter((flag) => !ALWAYS_ON.includes(flag)).join(',')))).toEqual({
      BADTX: 5,
      CONST_SCRIPTCODE: 12,
      DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM: 2,
    });
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

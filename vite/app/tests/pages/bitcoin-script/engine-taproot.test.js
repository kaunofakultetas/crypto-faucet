// -----------------------------------------------------------
//  [*] Tests — Bitcoin script playground: Taproot
//
//  The newest kind of lock (engine/taproot.js, and the
//  Taproot half of engine/interpreter.js and engine/node.js),
//  held against answers that do not come from the playground:
//
//    - the wallet test vectors of BIP 341
//      (support/bitcoin-script/bip341-wallet-vectors.json,
//      unchanged from the proposal): trees of scripts with
//      the key each gives, the control block of every leaf,
//      and a transaction whose inputs are signed with every
//      signature type Taproot knows
//    - a sample of the cases Bitcoin Core's own Taproot test
//      writes out (support/bitcoin-script/
//      core-transactions.js says how it was cut)
//
//  Between the two, small coins are locked and opened with
//  the playground's own keys, one rule of BIP 341 and BIP 342
//  at a time: the key path, the script path and its proof,
//  and what a script may do differently once it is a
//  tapscript.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import vectors from '../../support/bitcoin-script/bip341-wallet-vectors.json';
import { ASSETS, readTransaction, runAsset } from '../../support/bitcoin-script/core-transactions';
import { hash160 } from '@/pages/BitcoinScript/engine/hashes';
import { evaluateSpend } from '@/pages/BitcoinScript/engine/interpreter';
import { seedKey } from '@/pages/BitcoinScript/engine/keys';
import { checkerFor } from '@/pages/BitcoinScript/engine/node';
import { parseScript, pushOf, readScript, serializeScript } from '@/pages/BitcoinScript/engine/script';
import { signSchnorr, tweakPrivateKey, tweakPublicKey, xOnlyOf } from '@/pages/BitcoinScript/engine/secp256k1';
import { TAPSCRIPT, branchHash, controlBlockOf, leafHash, outputKeyOf, readControlBlock, rootOf, tweakOf } from '@/pages/BitcoinScript/engine/taproot';
import { SIGHASH_ALL, SIGHASH_ANYONECANPAY, SIGHASH_NONE, SIGHASH_SINGLE, taprootSignatureHash } from '@/pages/BitcoinScript/engine/transaction';


// The private keys of three of the playground's people, and
// the 32-byte key of each
const JONAS = seedKey('Jonas');
const GABIJA = seedKey('Gabija');
const ROKAS = seedKey('Rokas');
const [JONAS_KEY, GABIJA_KEY, ROKAS_KEY] = [JONAS, GABIJA, ROKAS].map(xOnlyOf);

// A script's bytes from its words
const bytesOf = (text) => serializeScript(parseScript(text).items);

// A transaction that spends one coin, and the lock of a coin
// as the node knows it
const TRANSACTION = {
  version: 2,
  inputs: [{ txid: 'aa'.repeat(32), vout: 0, script: '', sequence: 0xfffffffd }],
  outputs: [{ value: 4000, script: '51' }],
  lockTime: 0,
};
const coinOf = (lockHex) => [{ value: 5000, script: lockHex }];

// A Taproot coin: Jonas's key with a tree of scripts behind
// it, the lock that gives, and what opens it
const coin = (leaves) => {
  const lock = `5120${outputKeyOf(JONAS_KEY, leaves).key}`;
  const message = (options) => taprootSignatureHash(TRANSACTION, 0, coinOf(lock), options);

  return {
    lock,
    message,
    // The owner's signature for the key itself
    keySignature: (options) => signSchnorr(tweakPrivateKey(JONAS, tweakOf(JONAS_KEY, rootOf(leaves))), message(options)),
    // A person's signature for one leaf
    leafSignature: (privateKey, shown, options = {}) => signSchnorr(privateKey, message({ leaf: leafHash(leaves[shown]), ...options })),
    // The end of a witness that shows one leaf
    shown: (index) => [leaves[index], controlBlockOf(JONAS_KEY, leaves, index)],
    open: (witness) => {
      const read = readScript(lock);
      return evaluateSpend({ unlock: { items: [], hex: '' }, lock: { items: read.items, hex: lock }, witness, checker: checkerFor(TRANSACTION, 0, coinOf(lock)) });
    },
  };
};

// The step where the node turns to the witness
const turn = (run) => run.steps.find((step) => step.kind === 'witness');

// The two leaves most tests hang behind the key: Gabija's
// signature, or two numbers that add up to five
const GABIJA_SIGNS = bytesOf(`0x${GABIJA_KEY} OP_CHECKSIG`);
const SUM = bytesOf('OP_ADD 5 OP_EQUAL');







// -----------------------------------------------------------
// The tree behind a key
// -----------------------------------------------------------

describe('the tree behind a Taproot key', () => {

  // The leaves of a vector's tree in the order of their ids,
  // each with the hashes beside its path to the root
  const leavesOf = (tree) => {
    if (tree === null) return [];
    if (!Array.isArray(tree)) return [{ ...tree, hash: leafHash(tree.script, tree.leafVersion), path: [] }];

    const [left, right] = tree.map(leavesOf);
    const top = (leaves) => leaves.reduce((hash, leaf) => (hash === null ? leaf.path.reduce(branchHash, leaf.hash) : hash), null);
    return [
      ...left.map((leaf) => ({ ...leaf, path: [...leaf.path, top(right)] })),
      ...right.map((leaf) => ({ ...leaf, path: [...leaf.path, top(left)] })),
    ].sort((one, other) => one.id - other.id);
  };

  it.each(vectors.scriptPubKey.map((vector, index) => [index, vector]))('gives tree %i of BIP 341 the root, the tweak, the key and the lock the proposal gives', (_index, { given, intermediary, expected }) => {
    const leaves = leavesOf(given.scriptTree);
    const root = leaves.length === 0 ? '' : leaves[0].path.reduce(branchHash, leaves[0].hash);
    const tweak = tweakOf(given.internalPubkey, root);

    expect(leaves.map((leaf) => leaf.hash)).toEqual(intermediary.leafHashes ?? []);
    expect(root).toBe(intermediary.merkleRoot ?? '');
    expect(tweak).toBe(intermediary.tweak);
    expect(tweakPublicKey(given.internalPubkey, tweak).key).toBe(intermediary.tweakedPubkey);
    expect(`5120${tweakPublicKey(given.internalPubkey, tweak).key}`).toBe(expected.scriptPubKey);
  });


  it.each(vectors.scriptPubKey.map((vector, index) => [index, vector]))('walks every control block of tree %i back to its key', (_index, { given, intermediary, expected }) => {
    const leaves = leavesOf(given.scriptTree);
    const odd = tweakPublicKey(given.internalPubkey, intermediary.tweak).odd;

    expect(leaves.map((leaf) => `${(leaf.leafVersion + (odd ? 1 : 0)).toString(16)}${given.internalPubkey}${leaf.path.join('')}`)).toEqual(expected.scriptPathControlBlocks ?? []);
    for (const [index, leaf] of leaves.entries()) {
      const proof = readControlBlock(expected.scriptPathControlBlocks[index], leaf.script, intermediary.tweakedPubkey);

      expect(proof).toMatchObject({ version: leaf.leafVersion, internalKey: given.internalPubkey, leaf: leaf.hash, root: intermediary.merkleRoot, committed: true });
      expect(readControlBlock(expected.scriptPathControlBlocks[index], `${leaf.script}61`, intermediary.tweakedPubkey).committed).toBe(false);
    }
  });


  it('builds the playground\'s own small trees the way the proposal builds them', () => {
    const small = vectors.scriptPubKey.filter(({ given }) => leavesOf(given.scriptTree).length <= 2 && leavesOf(given.scriptTree).every((leaf) => leaf.leafVersion === TAPSCRIPT));

    expect(small.map(({ given }) => leavesOf(given.scriptTree).length)).toEqual([0, 1, 1, 2]);
    for (const { given, intermediary, expected } of small) {
      const scripts = leavesOf(given.scriptTree).map((leaf) => leaf.script);

      expect(rootOf(scripts)).toBe(intermediary.merkleRoot ?? '');
      expect(outputKeyOf(given.internalPubkey, scripts).key).toBe(intermediary.tweakedPubkey);
      expect(scripts.map((_, index) => controlBlockOf(given.internalPubkey, scripts, index))).toEqual(expected.scriptPathControlBlocks ?? []);
    }
  });


  it('hashes two branches the same whichever comes first', () => {
    const [one, other] = [leafHash(GABIJA_SIGNS), leafHash(SUM)];

    expect(branchHash(one, other)).toBe(branchHash(other, one));
    expect(rootOf([GABIJA_SIGNS, SUM])).toBe(rootOf([SUM, GABIJA_SIGNS]));
  });


  it('takes for a control block only an internal key and whole hashes after it', () => {
    const { lock } = coin([GABIJA_SIGNS, SUM]);
    const control = controlBlockOf(JONAS_KEY, [GABIJA_SIGNS, SUM], 0);

    expect(readControlBlock(control, GABIJA_SIGNS, lock.slice(4)).committed).toBe(true);
    expect(readControlBlock(control.slice(0, -2), GABIJA_SIGNS, lock.slice(4))).toBeNull();
    expect(readControlBlock(control.slice(0, 64), GABIJA_SIGNS, lock.slice(4))).toBeNull();
    expect(readControlBlock(`${(parseInt(control.slice(0, 2), 16) ^ 1).toString(16)}${control.slice(2)}`, GABIJA_SIGNS, lock.slice(4)).committed).toBe(false);
  });
});







// -----------------------------------------------------------
// Signing for a key
// -----------------------------------------------------------

describe('signing for a Taproot key', () => {

  const [spending] = vectors.keyPathSpending;
  const transaction = readTransaction(spending.given.rawUnsignedTx);
  const spent = spending.given.utxosSpent.map((coinSpent) => ({ value: coinSpent.amountSats, script: coinSpent.scriptPubKey }));

  it('holds the seven inputs of BIP 341, one for every signature type Taproot knows', () => {
    expect(spending.inputSpending.map(({ given }) => given.hashType).sort((one, other) => one - other)).toEqual([0x00, 0x01, 0x02, 0x03, 0x81, 0x82, 0x83]);
  });


  it.each(spending.inputSpending.map((input) => [input.given.txinIndex, input.given.hashType, input]))('signs input %i with type %i as the proposal does: the tweaked key, the message, the signature', (index, hashType, { given, intermediary, expected }) => {
    const tweak = tweakOf(xOnlyOf(given.internalPrivkey), given.merkleRoot ?? '');
    const tweaked = tweakPrivateKey(given.internalPrivkey, tweak);
    const message = taprootSignatureHash(transaction, index, spent, { hashType });

    expect(xOnlyOf(given.internalPrivkey)).toBe(intermediary.internalPubkey);
    expect(tweak).toBe(intermediary.tweak);
    expect(tweaked).toBe(intermediary.tweakedPrivkey);
    expect(message).toBe(intermediary.sigHash);
    expect([`${signSchnorr(tweaked, message)}${hashType === 0 ? '' : hashType.toString(16).padStart(2, '0')}`]).toEqual(expected.witness);
  });


  it('has no message for a type Taproot does not know, or for SIGHASH_SINGLE without an output of its own', () => {
    expect(taprootSignatureHash(transaction, 0, spent, { hashType: 0x04 })).toBeNull();
    expect(taprootSignatureHash(transaction, 0, spent, { hashType: 0x80 })).toBeNull();
    expect(taprootSignatureHash(transaction, 0, spent, { hashType: 0x84 })).toBeNull();
    expect(transaction.outputs).toHaveLength(2);
    expect(taprootSignatureHash(transaction, 2, spent, { hashType: SIGHASH_SINGLE })).toBeNull();
    expect(taprootSignatureHash(transaction, 2, spent, { hashType: SIGHASH_SINGLE + SIGHASH_ANYONECANPAY })).toBeNull();
    expect(taprootSignatureHash(transaction, 2, spent, { hashType: SIGHASH_NONE })).toHaveLength(64);
  });


  it('signs the amount and the lock of every coin the transaction spends', () => {
    const richer = spent.map((coinSpent, index) => (index === 5 ? { ...coinSpent, value: coinSpent.value + 1 } : coinSpent));
    const relocked = spent.map((coinSpent, index) => (index === 5 ? { ...coinSpent, script: '51' } : coinSpent));
    const message = (coins, hashType) => taprootSignatureHash(transaction, 0, coins, { hashType });

    expect(message(richer, SIGHASH_ALL)).not.toBe(message(spent, SIGHASH_ALL));
    expect(message(relocked, SIGHASH_ALL)).not.toBe(message(spent, SIGHASH_ALL));
    expect(message(richer, SIGHASH_ALL + SIGHASH_ANYONECANPAY)).toBe(message(spent, SIGHASH_ALL + SIGHASH_ANYONECANPAY));
  });
});







// -----------------------------------------------------------
// A Taproot coin in the machine
// -----------------------------------------------------------

describe('opening a Taproot coin', () => {

  const both = coin([GABIJA_SIGNS, SUM]);

  it('opens with one signature for the key itself, and runs no script at all', () => {
    const run = both.open([both.keySignature()]);

    expect(run.ok).toBe(true);
    expect(run.steps.map((step) => step.kind)).toEqual(['handover', 'item', 'item', 'witness', 'verdict']);
    expect(turn(run)).toMatchObject({ flavour: 'keypath', version: 1, program: both.lock.slice(4), ok: true, effect: { type: 'signature', valid: true, digest: both.message() } });
  });


  it('wants the signature of the tweaked key: the owner\'s own key does not sign for the coin', () => {
    const run = both.open([signSchnorr(JONAS, both.message())]);

    expect(run.error).toMatchObject({ code: 'schnorr-signature' });
    expect(turn(run)).toMatchObject({ flavour: 'keypath', ok: false, effect: { valid: false, why: 'schnorr-signature' } });
  });


  it('takes a signature type from a sixty-fifth byte, and no byte that says the default', () => {
    const typed = `${both.keySignature({ hashType: SIGHASH_NONE })}02`;

    expect(both.open([typed]).ok).toBe(true);
    expect(both.open([`${both.keySignature()}00`]).error).toMatchObject({ code: 'schnorr-type' });
    expect(both.open([`${both.keySignature()}04`]).error).toMatchObject({ code: 'schnorr-type' });
    expect(both.open([both.keySignature().slice(2)]).error).toMatchObject({ code: 'schnorr-size', size: 63 });
    expect(both.open([]).error).toEqual({ code: 'witness-empty' });
  });


  it('opens with a script of the tree and the proof that the key hides it', () => {
    const run = both.open(['02', '03', ...both.shown(1)]);

    expect(run.ok).toBe(true);
    expect(turn(run)).toMatchObject({ flavour: 'tapscript', hex: SUM, stack: ['02', '03'], proof: { committed: true, internalKey: JONAS_KEY, leaf: leafHash(SUM), path: [leafHash(GABIJA_SIGNS)] } });
    expect(run.steps.filter((step) => step.kind === 'item' && step.phase === 'leaf').map((step) => step.item.text)).toEqual(['OP_ADD', 'OP_5', 'OP_EQUAL']);
  });


  it('opens the other leaf with the signature of the key that leaf names', () => {
    expect(both.open([both.leafSignature(GABIJA, 0), ...both.shown(0)]).ok).toBe(true);
    expect(both.open([both.leafSignature(GABIJA, 1), ...both.shown(0)]).error).toMatchObject({ code: 'schnorr-signature' });
    expect(both.open([both.keySignature(), ...both.shown(0)]).error).toMatchObject({ code: 'schnorr-signature' });
  });


  it('turns down a script the key does not hide, and a proof of a wrong size', () => {
    const [, control] = both.shown(1);

    expect(both.open(['02', '03', bytesOf('OP_ADD 6 OP_EQUAL'), control]).error).toEqual({ code: 'taproot-mismatch' });
    expect(both.open(['02', '03', SUM, both.shown(0)[1]]).error).toEqual({ code: 'taproot-mismatch' });
    expect(both.open(['02', '03', SUM, control.slice(0, -2)]).error).toEqual({ code: 'taproot-control-size', size: 64 });
  });


  it('asks a script from the witness for exactly one true item at the end', () => {
    expect(both.open(['02', '04', ...both.shown(1)]).error).toEqual({ code: 'false-on-top' });
    expect(both.open(['07', '02', '03', ...both.shown(1)]).error).toEqual({ code: 'witness-unclean-stack', left: 2 });
  });


  it('accepts a leaf of a version nobody has given rules, whatever it holds', () => {
    const made = tweakPublicKey(JONAS_KEY, tweakOf(JONAS_KEY, leafHash('6a', 0xc2)));
    const lock = `5120${made.key}`;
    const read = readScript(lock);
    const run = evaluateSpend({
      unlock: { items: [], hex: '' },
      lock: { items: read.items, hex: lock },
      witness: ['6a', `${(0xc2 + (made.odd ? 1 : 0)).toString(16)}${JONAS_KEY}`],
      checker: checkerFor(TRANSACTION, 0, coinOf(lock)),
    });

    expect(run.ok).toBe(true);
    expect(turn(run)).toMatchObject({ flavour: 'future-leaf', proof: { version: 0xc2 } });
    expect(run.steps.filter((step) => step.kind === 'item' && step.phase === 'leaf')).toEqual([]);
  });


  it('signs the annex when the witness ends with one', () => {
    const annex = '50aabb';
    const without = both.keySignature();
    const withAnnex = both.keySignature({ annex });

    expect(both.open([withAnnex, annex]).ok).toBe(true);
    expect(both.open([without, annex]).error).toMatchObject({ code: 'schnorr-signature' });
    expect(both.open(['02', '03', ...both.shown(1), annex]).ok).toBe(true);
    expect(both.open([both.leafSignature(GABIJA, 0, { annex }), ...both.shown(0), annex]).ok).toBe(true);
  });


  it('has no form behind a script hash: there the program is one nobody has given rules', () => {
    const lock = bytesOf(`OP_HASH160 0x${hash160(both.lock)} OP_EQUAL`);
    const unlock = pushOf(both.lock);
    const run = evaluateSpend({
      unlock: { items: readScript(unlock).items, hex: unlock },
      lock: { items: readScript(lock).items, hex: lock },
      witness: ['ff'],
      checker: checkerFor({ ...TRANSACTION, inputs: [{ ...TRANSACTION.inputs[0], script: unlock }] }, 0, coinOf(lock)),
    });

    expect(run.ok).toBe(true);
    expect(turn(run)).toMatchObject({ flavour: 'unknown', version: 1 });
  });
});







// -----------------------------------------------------------
// The rules of a tapscript
// -----------------------------------------------------------

describe('what a script may do once it is a tapscript', () => {

  // A coin with one leaf, opened with that leaf and the items
  // the test puts in front of it
  const leafCoin = (text) => {
    const made = coin([bytesOf(text)]);
    return { ...made, run: (...items) => made.open([...items, ...made.shown(0)]) };
  };

  it('counts signatures with OP_CHECKSIGADD: an empty one counts nothing, and two of three are enough', () => {
    const twoOfThree = leafCoin(`0x${JONAS_KEY} OP_CHECKSIG 0x${GABIJA_KEY} OP_CHECKSIGADD 0x${ROKAS_KEY} OP_CHECKSIGADD 2 OP_NUMEQUAL`);
    const [jonas, gabija, rokas] = [JONAS, GABIJA, ROKAS].map((key) => twoOfThree.leafSignature(key, 0));
    const run = twoOfThree.run(rokas, '', jonas);

    expect(run.ok).toBe(true);
    expect(run.steps.filter((step) => step.effect?.type === 'signature').map((step) => [step.effect.valid, step.effect.counted])).toEqual([[true, undefined], [false, 1], [true, 2]]);
    expect(twoOfThree.run('', gabija, jonas).ok).toBe(true);
    expect(twoOfThree.run('', '', jonas).error).toEqual({ code: 'false-on-top' });
    expect(twoOfThree.run(rokas, gabija, jonas).error).toEqual({ code: 'false-on-top' });
  });


  it('ends the script at once on a signature that does not fit — only an empty one is a plain no', () => {
    const lock = leafCoin(`0x${GABIJA_KEY} OP_CHECKSIG OP_NOT`);

    expect(lock.run('').ok).toBe(true);
    expect(lock.run(lock.leafSignature(JONAS, 0)).error).toMatchObject({ code: 'schnorr-signature' });
  });


  it('breaks on an empty key, and passes a key of a size nobody has given rules', () => {
    expect(leafCoin('0 OP_CHECKSIG').run('aa').error).toEqual({ code: 'tapscript-empty-key' });
    expect(leafCoin('0x02aa OP_CHECKSIG').run('aa').ok).toBe(true);
    expect(leafCoin('0x02aa OP_CHECKSIG').run('').error).toEqual({ code: 'false-on-top' });
  });


  it('has no OP_CHECKMULTISIG, and takes OP_CHECKSIGADD nowhere else', () => {
    expect(leafCoin(`0 2 0x${JONAS_KEY} 0x${GABIJA_KEY} 2 OP_CHECKMULTISIG`).run('', '').error).toEqual({ code: 'tapscript-checkmultisig' });

    const legacy = { items: parseScript('0 0 0x02aa OP_CHECKSIGADD').items, hex: bytesOf('0 0 0x02aa OP_CHECKSIGADD') };
    expect(evaluateSpend({ unlock: { items: [], hex: '' }, lock: legacy, checker: checkerFor(TRANSACTION, 0, coinOf(legacy.hex)) }).error).toEqual({ code: 'tapscript-only' });
  });


  it('lets OP_IF choose by nothing but an empty item or a single one', () => {
    const lock = leafCoin('OP_IF 1 OP_ELSE 1 OP_ENDIF');

    expect(lock.run('01').ok).toBe(true);
    expect(lock.run('').ok).toBe(true);
    expect(lock.run('02').error).toEqual({ code: 'tapscript-minimal-if' });
    expect(lock.run('0100').error).toEqual({ code: 'tapscript-minimal-if' });
  });


  it('succeeds outright on a word kept for an upgrade, wherever it stands', () => {
    const run = leafCoin('0 OP_VERIFY OP_CAT').run();
    const door = turn(run);

    expect(run.ok).toBe(true);
    expect(door).toMatchObject({ flavour: 'op-success', opcode: { name: 'OP_CAT' } });
    expect(run.steps.filter((step) => step.kind === 'item' && step.phase === 'leaf')).toEqual([]);
    expect(leafCoin('0 OP_IF OP_RESERVED OP_ENDIF 0').run().ok).toBe(true);
    expect(leafCoin('0 OP_IF OP_VERIF OP_ENDIF 1').run().error).toEqual({ code: 'disabled-opcode' });
  });


  it('signs the place of the last OP_CODESEPARATOR that was run', () => {
    const lock = leafCoin(`OP_CODESEPARATOR OP_NOP OP_CODESEPARATOR 0x${GABIJA_KEY} OP_CHECKSIG`);

    expect(lock.run(lock.leafSignature(GABIJA, 0, { separator: 2 })).ok).toBe(true);
    expect(lock.run(lock.leafSignature(GABIJA, 0, { separator: 0 })).error).toMatchObject({ code: 'schnorr-signature' });
    expect(lock.run(lock.leafSignature(GABIJA, 0)).error).toMatchObject({ code: 'schnorr-signature' });
  });


  it('pays for every signature check out of a budget the witness\'s size sets', () => {
    const repeated = (times) => leafCoin(`0x${GABIJA_KEY} ${'OP_2DUP OP_CHECKSIGVERIFY '.repeat(times)}OP_2DROP 1`);
    const three = repeated(3);
    const four = repeated(4);

    const annex = `50${'00'.repeat(20)}`;

    expect(three.run(three.leafSignature(GABIJA, 0)).ok).toBe(true);
    expect(four.run(four.leafSignature(GABIJA, 0)).error).toEqual({ code: 'tapscript-budget' });
    expect(four.open([four.leafSignature(GABIJA, 0, { annex }), ...four.shown(0), annex]).ok).toBe(true);
  });


  it('knows no limit of 201 operations and none of 10 000 bytes', () => {
    expect(leafCoin(`${'OP_NOP '.repeat(250)}1`).run().ok).toBe(true);
    expect(leafCoin(`${`0x${'aa'.repeat(500)} OP_DROP `.repeat(21)}1`).run().ok).toBe(true);
  });


  it('still holds a push to 520 bytes and the stacks to a thousand items', () => {
    expect(leafCoin(`0x${'aa'.repeat(521)} OP_DROP 1`).run().error).toMatchObject({ code: 'push-too-large' });
    expect(leafCoin(`${'1 '.repeat(1001)}`).run().error).toMatchObject({ code: 'stack-too-large' });
    expect(pushOf('aa'.repeat(521)).startsWith('4d0902')).toBe(true);
  });
});







// -----------------------------------------------------------
// Bitcoin Core's Taproot cases
// -----------------------------------------------------------
//
// A case's spend that must fail must fail under the rules the
// case names and under any more — so always here, where every
// rule of a block is on. Its spend that must pass must pass
// under the rules the case names and under any fewer: that
// binds the engine when the case is judged with Taproot
// switched on, or says it holds under any rules at all.
// -----------------------------------------------------------

describe("Bitcoin Core's Taproot cases", () => {

  const binding = (test) => test.final === true || test.flags.split(',').includes('TAPROOT');

  it('holds one case of every scenario but the two largest: 159', () => {
    expect(ASSETS).toHaveLength(159);
    expect(new Set(ASSETS.map((test) => test.comment)).size).toBe(159);
    expect(ASSETS.filter((test) => test.success && binding(test))).toHaveLength(154);
    expect(ASSETS.filter((test) => test.failure)).toHaveLength(149);
  });


  it('opens every coin a case says must open', () => {
    const refused = ASSETS.filter((test) => test.success && binding(test)).filter((test) => !runAsset(test, test.success).ok);

    expect(refused.map((test) => `${test.comment}: ${runAsset(test, test.success).error}`)).toEqual([]);
  });


  it('opens no coin a case says must stay shut', () => {
    const opened = ASSETS.filter((test) => test.failure).filter((test) => runAsset(test, test.failure).ok);

    expect(opened.map((test) => test.comment)).toEqual([]);
  });
});

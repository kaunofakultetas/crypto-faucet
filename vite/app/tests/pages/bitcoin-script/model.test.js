// -----------------------------------------------------------
//  [*] Tests — Bitcoin script playground: the model
//
//  Everything the page shows is worked out from its state in
//  one place (model.js); these tests are about that working
//  out.
//
//    - the scenes: each builds, the node's verdict on it is
//      the one the scene is there to show, and each brings
//      only the key pairs it uses
//    - the bytes: transaction A, its id, the lock and the
//      message B's signatures sign agree with what an
//      independent Bitcoin library (embit) makes of the same
//      transactions — reference.json — and that library's own
//      signatures pass the playground's check
//    - the words: every step of every scene can be told, and
//      a value is called what it is
//    - the reducer: every change a student can make — key
//      pairs, data, outputs, payments — and what it must not
//      allow
//    - signatures kept as they were go stale when the
//      transaction changes
//    - what cannot be read stops the check and is listed
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import reference from '../../support/bitcoin-script/reference.json';
import { KEY_COLOURS, LIMITS, SPARE_NAMES } from '@/pages/BitcoinScript/constants';
import { freshKey } from '@/pages/BitcoinScript/engine/keys';
import { verifyDigest } from '@/pages/BitcoinScript/engine/secp256k1';
import { EXAMPLES, FIRST_EXAMPLE } from '@/pages/BitcoinScript/examples';
import { PREVIOUS_ID, buildModel, payTo, readAmount, readWhole, reduce, signEveryone } from '@/pages/BitcoinScript/model';
import { itemLabel, labelOf, lockName, narrate } from '@/pages/BitcoinScript/narration';


// A scene's state, by its id
const stateOf = (id) => EXAMPLES.find((example) => example.id === id).state;

// A state after some actions
const after = (state, ...actions) => actions.reduce(reduce, state);

// The numbers of the four starting key pairs, by name
const [JONAS, GABIJA, ROKAS, SIMONA] = [1, 2, 3, 4];

// The starting key pairs as every scene must know them
const STARTING = [[JONAS, 'Jonas', KEY_COLOURS[0]], [GABIJA, 'Gabija', KEY_COLOURS[1]], [ROKAS, 'Rokas', KEY_COLOURS[2]], [SIMONA, 'Simona', KEY_COLOURS[3]]];







// -----------------------------------------------------------
// The scenes
// -----------------------------------------------------------

describe('the scenes', () => {

  it.each(EXAMPLES.filter((example) => !['theft', 'burned'].includes(example.id)))('opens the lock of "$label"', ({ state }) => {
    const model = buildModel(state);

    expect(model.problems).toEqual([]);
    expect(model.verification.valid).toBe(true);
  });


  it('stops the thief where the hash of the wrong key does not match', () => {
    const { verification } = buildModel(stateOf('theft'));
    const broke = verification.timeline.find((entry) => entry.ok === false);

    expect(verification).toMatchObject({ valid: false, failed: 'script', error: { code: 'verify-failed' } });
    expect(broke.item.opcode.name).toBe('OP_EQUALVERIFY');
  });


  it('never spends the burned coin', () => {
    expect(buildModel(stateOf('burned')).verification).toMatchObject({ valid: false, failed: 'script', error: { code: 'op-return' } });
  });


  it.each(EXAMPLES)('leaves "$label" locked once its unlocking script is emptied', ({ state }) => {
    const model = buildModel(after(state, { type: 'unlock', text: '' }));

    expect(model.problems).toEqual([]);
    expect(model.verification).toMatchObject({ valid: false, failed: 'script' });
  });


  it.each([
    ['sum', '1 4'],
    ['sum', '5 0'],
    ['password', "'satoshi'"],
    ['two-ways', '8 0'],
    ['multisig', `0 <sig:${GABIJA}> <sig:${ROKAS}>`],
  ])('lets %s be opened another way, with %s', (id, unlock) => {
    expect(buildModel(after(stateOf(id), { type: 'unlock', text: unlock })).verification.valid).toBe(true);
  });


  it('opens on the everyday lock, already opened', () => {
    expect(FIRST_EXAMPLE.id).toBe('p2pkh');
    expect(buildModel(FIRST_EXAMPLE.state).verification.valid).toBe(true);
  });


  it('puts a word or two on every scene\'s button and one short text under it', () => {
    for (const { label, about } of EXAMPLES) {
      expect(label.split(' ').length).toBeLessThanOrEqual(2);
      expect(about.length).toBeGreaterThan(40);
      expect(about.length).toBeLessThan(170);
    }
    expect(new Set(EXAMPLES.map((example) => example.label)).size).toBe(EXAMPLES.length);
  });


  it('brings only key pairs the scene uses, always the same ones under the same numbers', () => {
    for (const { state } of EXAMPLES) {
      const numbers = state.keys.map((key) => key.id);
      const scripts = [state.unlock, state.redeem, ...state.outputs.map((output) => output.lock)].join(' ');
      const named = [...scripts.matchAll(/<\w+:(\d+)>/g)].map((match) => Number(match[1]));
      const used = [...named, ...state.payments.map((payment) => payment.to)];

      for (const key of state.keys) expect(STARTING).toContainEqual([key.id, key.name, key.colour]);
      for (const number of used) expect(numbers).toContain(number);
      for (const number of numbers) expect(used).toContain(number);
    }
  });


  it('gives everything in a scene a number of its own', () => {
    for (const { state } of EXAMPLES) {
      const numbers = [...state.keys, ...state.outputs, ...state.payments, ...state.data].map((entry) => entry.id);

      expect(new Set(numbers).size).toBe(numbers.length);
      expect(Math.max(...numbers)).toBeLessThan(state.nextId);
    }
  });


  it('calls the hash in the password lock by the password it was made from', () => {
    const model = buildModel(stateOf('password'));

    expect(itemLabel(model.b.spends.script.items[1], model.lexicon)).toMatchObject({ kind: 'hash', short: 'SHA-256', name: '„satoshi“' });
  });
});







// -----------------------------------------------------------
// The bytes
// -----------------------------------------------------------

describe('the bytes', () => {

  it.each(Object.entries(reference.cases))('builds the %s transactions the reference library builds', (id, expected) => {
    const model = buildModel(stateOf(id));

    expect(model.a.hex).toBe(expected.a_raw);
    expect(model.a.id).toBe(expected.a_txid);
    expect(model.b.spends.script.hex).toBe(expected.lock);
    expect(model.signing.digest).toBe(expected.sighash);
  });


  it.each(Object.entries(reference.cases))('accepts the signatures the reference library made for %s', (id, expected) => {
    const model = buildModel(stateOf(id));
    const signatures = expected.signatures ?? { [model.keys.find((key) => String(key.id) === model.signing.signers[0]).name]: expected.signature };

    for (const [name, signature] of Object.entries(signatures)) {
      const { publicKey } = model.keys.find((key) => key.name === name);
      expect(signature.endsWith('01')).toBe(true);
      expect(verifyDigest(signature.slice(0, -2), model.signing.digest, publicKey)).toBe(true);
    }
  });


  it('hashes the redeem script into the lock, and signs the redeem script', () => {
    const model = buildModel(stateOf('p2sh'));

    expect(model.b.redeem.hex).toBe(reference.cases.p2sh.redeem);
    expect(model.b.spends.lock).toEqual({ kind: 'p2sh', hash: reference.cases.p2sh.script_hash });
    expect(model.signing.covers).toBe('redeem');
  });


  it('spends a coin of a transaction that is not part of the page', () => {
    expect(PREVIOUS_ID).toBe(reference.previous_txid);
  });


  it('gives transaction B a new id whenever anything it carries changes', () => {
    const start = stateOf('p2pkh');
    const before = buildModel(start);
    const moved = buildModel(after(start, { type: 'payment/amount', index: 0, text: '0.4' }));

    expect(moved.b.id).not.toBe(before.b.id);
    expect(moved.signing.digest).not.toBe(before.signing.digest);
    expect(moved.a.id).toBe(before.a.id);
    expect(moved.verification.valid).toBe(true);
  });


  it('counts the fee as what the coin holds beyond what B hands out', () => {
    expect(buildModel(stateOf('p2pkh')).b).toMatchObject({ paid: 49990000, fee: 10000 });
    expect(buildModel(after(stateOf('p2pkh'), { type: 'payment/amount', index: 0, text: '0.6' })).b.fee).toBe(-10000000);
  });
});







// -----------------------------------------------------------
// The words
// -----------------------------------------------------------

describe('the words', () => {

  it.each(EXAMPLES)('can tell every step of "$label"', ({ state }) => {
    const model = buildModel(state);

    for (const entry of model.verification.timeline) {
      const { heading, lines } = narrate(entry, model);
      expect(heading.length).toBeGreaterThan(3);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of [heading, ...lines]) expect(line).not.toMatch(/undefined|null|NaN|\[object/);
    }
  });


  it('calls a value what it is, in the colour of its key pair', () => {
    const model = buildModel(stateOf('p2pkh'));
    const jonas = model.keys[0];

    expect(labelOf(jonas.publicKey, model.lexicon)).toMatchObject({ kind: 'pubkey', short: 'pubKey', name: 'Jonas', colour: KEY_COLOURS[0], text: 'viešasis raktas „Jonas“' });
    expect(labelOf(jonas.publicKeyHash, model.lexicon)).toMatchObject({ kind: 'pubkeyhash', short: 'pubKeyHash', text: 'rakto maiša „Jonas“' });
    expect(labelOf(model.b.unlock.items[0].hex, model.lexicon)).toMatchObject({ kind: 'sig', short: 'sig', text: 'parašas „Jonas“' });
  });


  it('reads a value nobody owns the way Script reads it', () => {
    expect(labelOf('', null)).toMatchObject({ kind: 'false', text: '0 (FALSE)' });
    expect(labelOf('01', null)).toMatchObject({ kind: 'true', text: '1 (TRUE)' });
    expect(labelOf('40d10c', null)).toMatchObject({ kind: 'number', text: '840000' });
    expect(labelOf('80', null)).toMatchObject({ kind: 'number', text: '0 (FALSE)' });
    expect(labelOf('7361746f736869', null)).toMatchObject({ kind: 'text', text: '„satoshi“' });
    expect(labelOf('00'.repeat(20), null)).toMatchObject({ kind: 'bytes', text: '00000000…000000 (20 B)' });
  });


  it('shows a value the way it was written, wherever it turns up', () => {
    const model = buildModel(after(stateOf('sum'), { type: 'unlock', text: '"ab" 0xa1b2 70000 2 3' }));

    expect(labelOf('6162', model.lexicon)).toMatchObject({ kind: 'text', text: '„ab“' });
    expect(labelOf('a1b2', model.lexicon)).toMatchObject({ kind: 'bytes', text: '0xa1b2' });
    expect(labelOf('701101', model.lexicon)).toMatchObject({ kind: 'number', text: '70000' });
    expect(labelOf('6162', null)).toMatchObject({ kind: 'number', text: '25185' });
  });


  it('follows a key pair through a change of its name', () => {
    const model = buildModel(after(stateOf('p2pkh'), { type: 'key/rename', id: JONAS, name: 'Petras' }));

    expect(itemLabel(model.b.unlock.items[1], model.lexicon).text).toBe('viešasis raktas „Petras“');
    expect(lockName(model.b.spends.lock, model.lexicon)).toBe('adresas „Petras“ (P2PKH)');
    expect(model.verification.valid).toBe(true);
  });


  it.each([
    ['p2pkh', 'adresas „Jonas“ (P2PKH)'],
    ['p2pk', 'viešasis raktas „Jonas“ (P2PK)'],
    ['multisig', '2 iš 3 raktų (multisig)'],
    ['p2sh', 'skripto maiša (P2SH)'],
    ['burned', 'duomenys, neišleidžiama (OP_RETURN)'],
    ['sum', 'savas skriptas'],
  ])('names the lock of %s', (id, name) => {
    const model = buildModel(stateOf(id));

    expect(lockName(model.b.spends.lock, model.lexicon)).toBe(name);
  });


  it('says of a script that ran to its end and left a false what its last word found', () => {
    const model = buildModel(after(stateOf('p2pkh'), { type: 'unlock', text: `<sig:${GABIJA}> <pubkey:${JONAS}>` }));
    const { lines } = narrate(model.verification.timeline.at(-1), model);

    expect(lines[0]).toBe('Skriptai įvykdyti iki galo; paskutinis žodis — OP_CHECKSIG.');
    expect(lines[1]).toMatch(/^Tikrinama: parašas „Gabija“, viešasis raktas „Jonas“ ir transakcijos B santrauka /);
    expect(lines.slice(2)).toEqual([
      'Parašas netinka: arba pasirašyta kitu raktu, arba pasirašyta kita transakcija — ši pakeista po pasirašymo.',
      'Skriptas baigtas, bet steko viršuje — FALSE.',
      'Moneta lieka neišleista, o transakcijos mazgas niekam nepersiunčia.',
    ]);
  });


  it('names a refusal by the word it broke at and by what that word found', () => {
    const model = buildModel(stateOf('theft'));

    expect(narrate(model.verification.timeline.at(-1), model)).toEqual({
      heading: 'Transakcija B atmesta',
      lines: [
        'Mazgas sustojo užrakto skripte, ties žodžiu OP_EQUALVERIFY.',
        'Lyginama: rakto maiša „Rokas“ ir rakto maiša „Jonas“ — nesutampa.',
        'Patikra nepavyko — skriptas iškart žlunga.',
        'Moneta lieka neišleista, o transakcijos mazgas niekam nepersiunčia.',
      ],
    });
  });
});







// -----------------------------------------------------------
// The reducer: key pairs and data
// -----------------------------------------------------------

describe('key pairs and data', () => {

  const start = stateOf('p2pkh');

  it('adds a key pair with the first spare name and colour, and a number of its own', () => {
    const privateKey = freshKey();
    const state = after(start, { type: 'key/add', privateKey });
    const added = state.keys.at(-1);

    expect(added).toEqual({ id: start.nextId, name: SPARE_NAMES[0], colour: KEY_COLOURS[2], privateKey });
    expect(state.nextId).toBe(start.nextId + 1);
    expect(buildModel(state).keys.at(-1).publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
  });


  it('lets the new key pair lock and unlock a coin', () => {
    const added = after(start, { type: 'key/add', privateKey: freshKey() });
    const id = added.keys.at(-1).id;
    const state = after(added, { type: 'output/lock', index: 0, text: payTo(id) }, { type: 'unlock', text: `<sig:${id}> <pubkey:${id}>` });

    expect(buildModel(state).verification.valid).toBe(true);
  });


  it('adds no more key pairs than the page has room for', () => {
    let state = start;
    for (let count = 0; count < 10; count += 1) state = reduce(state, { type: 'key/add', privateKey: freshKey() });

    expect(state.keys).toHaveLength(LIMITS.KEYS);
    expect(new Set(state.keys.map((key) => key.colour)).size).toBe(LIMITS.KEYS);
    expect(new Set(state.keys.map((key) => key.name)).size).toBe(LIMITS.KEYS);
  });


  it('cuts a name that is too long', () => {
    const state = after(start, { type: 'key/rename', id: GABIJA, name: 'x'.repeat(40) });

    expect(state.keys[1].name).toBe('x'.repeat(LIMITS.NAME_CHARACTERS));
  });


  it('gives a removed key pair\'s coins in B to the first pair left', () => {
    const state = after(start, { type: 'key/remove', id: GABIJA });

    expect(state.keys.map((key) => key.id)).toEqual([JONAS]);
    expect(state.payments[0].to).toBe(JONAS);
  });


  it('keeps a script word that names a removed key pair, and reads it as a problem', () => {
    const model = buildModel(after(start, { type: 'key/remove', id: JONAS }));

    expect(model.verification).toBeNull();
    expect(model.problems.map((problem) => [problem.where, problem.code])).toEqual(
      expect.arrayContaining([['lock', 'unknown-person'], ['unlock', 'unknown-person']]),
    );
  });


  it('never removes the last key pair', () => {
    const one = after(start, { type: 'key/remove', id: GABIJA });

    expect(one.keys).toHaveLength(1);
    expect(reduce(one, { type: 'key/remove', id: JONAS })).toBe(one);
  });


  it('keeps a piece of data once, and takes it off the shelf when asked', () => {
    const state = after(start, { type: 'data/add', word: '840000' }, { type: 'data/add', word: '"labas"' }, { type: 'data/add', word: '840000' });

    expect(state.data.map((piece) => piece.word)).toEqual(['840000', '"labas"']);
    expect(after(state, { type: 'data/remove', id: state.data[0].id }).data.map((piece) => piece.word)).toEqual(['"labas"']);
  });


  it('makes room on a full shelf by dropping the oldest piece', () => {
    let state = start;
    for (let number = 100; number < 100 + LIMITS.DATA + 3; number += 1) state = reduce(state, { type: 'data/add', word: String(number) });

    expect(state.data).toHaveLength(LIMITS.DATA);
    expect(state.data[0].word).toBe('103');
  });


  it('calls a hash made on the shelf by how it was made, wherever its bytes turn up', () => {
    const word = '0x6b88c087247aa2f07ee1c5956b8e1a9f4c7f892a70e324f1bb3d161e05ca107b';
    const model = buildModel(after(start, { type: 'data/add', word, made: { algorithm: 'SHA-256', source: '„bitcoin“' } }));

    expect(labelOf(word.slice(2), model.lexicon)).toMatchObject({ kind: 'hash', short: 'SHA-256', name: '„bitcoin“', text: 'SHA-256 maiša („bitcoin“)' });
  });
});







// -----------------------------------------------------------
// The reducer: the two transactions
// -----------------------------------------------------------

describe('the two transactions', () => {

  const start = stateOf('p2pkh');

  it('adds an output locked to a key pair that has none yet, or to the first pair when all have one', () => {
    const state = after(start, { type: 'output/add' });
    expect(state.outputs).toHaveLength(3);
    expect(state.outputs[2]).toMatchObject({ amount: '0.1', lock: payTo(JONAS) });

    const withSpare = after(start, { type: 'key/add', privateKey: freshKey() }, { type: 'output/add' });
    expect(withSpare.outputs[2].lock).toBe(payTo(start.nextId));
  });


  it('adds no more outputs than the page has room for', () => {
    let state = start;
    for (let count = 0; count < 10; count += 1) state = reduce(state, { type: 'output/add' });

    expect(state.outputs).toHaveLength(LIMITS.OUTPUTS);
  });


  it('follows the spent coin when an earlier output is removed', () => {
    const state = after(start, { type: 'spend', index: 1 }, { type: 'output/remove', index: 0 });

    expect(state.outputs).toHaveLength(1);
    expect(state.spent).toBe(0);
    expect(state.outputs[0].lock).toBe(payTo(GABIJA));
  });


  it('moves to the first output when the spent one is removed, and never removes the last', () => {
    const state = after(start, { type: 'spend', index: 1 }, { type: 'output/remove', index: 1 });

    expect(state.spent).toBe(0);
    expect(reduce(state, { type: 'output/remove', index: 0 })).toBe(state);
  });


  it('changes the id of A, and with it every signature of B, when an amount in A changes', () => {
    const before = buildModel(start);
    const model = buildModel(after(start, { type: 'output/amount', index: 1, text: '0.31' }));

    expect(model.a.id).not.toBe(before.a.id);
    expect(model.b.unlock.items[0].hex).not.toBe(before.b.unlock.items[0].hex);
    expect(model.verification.valid).toBe(true);
  });


  it('adds a payment to a key pair that gets nothing yet, up to the limit, and keeps the last one', () => {
    let state = after(start, { type: 'payment/add' });
    expect(state.payments.map((payment) => payment.to)).toEqual([GABIJA, JONAS]);

    for (let count = 0; count < 10; count += 1) state = reduce(state, { type: 'payment/add' });
    expect(state.payments).toHaveLength(LIMITS.PAYMENTS);

    const one = after(state, { type: 'payment/remove', index: 0 }, { type: 'payment/remove', index: 0 });
    expect(one.payments).toHaveLength(1);
    expect(reduce(one, { type: 'payment/remove', index: 0 })).toBe(one);
  });


  it('pays the key pair a payment is turned to', () => {
    const model = buildModel(after(start, { type: 'payment/to', index: 0, id: JONAS }));

    expect(model.b.payments[0].key.name).toBe('Jonas');
    expect(lockName(model.b.payments[0].lock, model.lexicon)).toBe('adresas „Jonas“ (P2PKH)');
    expect(model.verification.valid).toBe(true);
  });


  it('lets the node see the coin as already spent', () => {
    expect(buildModel(after(start, { type: 'coin-spent', value: true })).verification).toMatchObject({ valid: false, failed: 'coin', error: { code: 'already-spent' } });
  });


  it('holds the frozen coin back while the chain is too low or B says too early a lock time', () => {
    const start = stateOf('timelock');

    expect(buildModel(after(start, { type: 'height', text: '839999' })).verification).toMatchObject({ valid: false, failed: 'finality' });
    expect(buildModel(after(start, { type: 'lock-time', text: '839999' })).verification).toMatchObject({ valid: false, failed: 'script', error: { code: 'locktime', why: 'too-early' } });
    expect(buildModel(after(start, { type: 'lock-time', text: '0' })).verification).toMatchObject({ valid: false, failed: 'script', error: { code: 'locktime' } });
  });
});







// -----------------------------------------------------------
// Signatures kept, and things that cannot be read
// -----------------------------------------------------------

describe('signatures kept, and what cannot be read', () => {

  const start = stateOf('p2pkh');

  it('lets signatures kept as they were go stale when the transaction changes, and signs anew when thawed', () => {
    const first = buildModel(start);
    const frozen = after(start, { type: 'freeze', signatures: signEveryone(first.keys, first.signing.digest) });
    expect(buildModel(frozen)).toMatchObject({ signing: { frozen: true, stale: [] }, verification: { valid: true } });

    const changed = after(frozen, { type: 'payment/amount', index: 0, text: '0.4' });
    const stale = buildModel(changed);
    expect(stale.signing.stale).toEqual([String(JONAS)]);
    expect(stale.verification).toMatchObject({ valid: false, failed: 'script' });
    expect(labelOf(stale.b.unlock.items[0].hex, stale.lexicon)).toMatchObject({ stale: true, text: 'parašas „Jonas“ (senas)' });

    expect(buildModel(after(changed, { type: 'thaw' }))).toMatchObject({ signing: { frozen: false, stale: [] }, verification: { valid: true } });
  });


  it.each([
    [{ type: 'unlock', text: 'OP_NOPE' }, 'unlock', 'unknown-word'],
    [{ type: 'output/lock', index: 0, text: `<sig:${JONAS}> OP_DROP` }, 'lock', 'signature-outside-unlock'],
    [{ type: 'unlock', text: '<redeemScript>' }, 'unlock', 'no-redeem-script'],
    [{ type: 'output/amount', index: 1, text: '' }, 'output-amount', 'amount-empty'],
    [{ type: 'payment/amount', index: 0, text: 'daug' }, 'payment-amount', 'amount-unreadable'],
    [{ type: 'lock-time', text: '-1' }, 'lock-time', 'whole-unreadable'],
    [{ type: 'height', text: '600000000' }, 'height', 'whole-too-large'],
  ])('gives no verdict after %o, and says where the problem is', (action, where, code) => {
    const model = buildModel(after(start, action));

    expect(model.verification).toBeNull();
    expect(model.problems.map((problem) => [problem.where, problem.code])).toContainEqual([where, code]);
  });


  it('keeps every word of a script in its place, read or not', () => {
    const model = buildModel(after(start, { type: 'unlock', text: `<sig:${JONAS}> OP_NOPE 7` }));

    expect(model.b.unlock.words.map((word) => [word.text, Boolean(word.item), word.problem?.code ?? null])).toEqual([
      [`<sig:${JONAS}>`, true, null], ['OP_NOPE', false, 'unknown-word'], ['7', true, null],
    ]);
  });


  it('reads an amount as whole satoshis, a comma for the point', () => {
    expect(readAmount('0.5')).toEqual({ value: 50000000, problem: null });
    expect(readAmount(' 0,00000001 ')).toEqual({ value: 1, problem: null });
    expect(readAmount('21000000')).toEqual({ value: 2100000000000000, problem: null });
    expect(readAmount('21000000.00000001').problem).toBe('amount-too-large');
    expect(readAmount('0.123456789').problem).toBe('amount-unreadable');
    expect(readAmount('-1').problem).toBe('amount-unreadable');
    expect(readAmount('').problem).toBe('amount-empty');
  });


  it('reads a whole number up to its limit', () => {
    expect(readWhole(' 840000 ', 499999999)).toEqual({ value: 840000, problem: null });
    expect(readWhole('1.5', 10).problem).toBe('whole-unreadable');
    expect(readWhole('11', 10).problem).toBe('whole-too-large');
  });
});

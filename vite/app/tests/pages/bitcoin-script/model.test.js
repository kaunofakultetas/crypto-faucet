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
//    - Lightning and the swaps: every way through each of
//      their scripts, what time does to them, and the two
//      chains of one swap
//    - the bytes: transaction A, its id, the lock and the
//      message B's signatures sign agree with what an
//      independent Bitcoin library (embit) makes of the same
//      transactions — reference.json — that library's own
//      signatures pass the playground's check, and with them
//      in place transaction B is the library's, byte for byte
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
import { byteLength, textToHex } from '@/pages/BitcoinScript/engine/bytes';
import { freshKey } from '@/pages/BitcoinScript/engine/keys';
import { FINAL_SEQUENCE } from '@/pages/BitcoinScript/engine/node';
import { verifyDigest } from '@/pages/BitcoinScript/engine/secp256k1';
import { EXAMPLES, FIRST_EXAMPLE, GROUPS } from '@/pages/BitcoinScript/examples';
import { PREVIOUS_ID, buildModel, payTo, readAmount, readSequence, readWhole, reduce, signEveryone } from '@/pages/BitcoinScript/model';
import { ageText, formatAmount, itemLabel, labelOf, lockName, narrate, problemText, sequenceMeaning } from '@/pages/BitcoinScript/narration';


// A scene's state, by its id
const stateOf = (id) => EXAMPLES.find((example) => example.id === id).state;

// A state after some actions
const after = (state, ...actions) => actions.reduce(reduce, state);

// The numbers of the four starting key pairs, by name
const [JONAS, GABIJA, ROKAS, SIMONA] = [1, 2, 3, 4];

// The number of the revocation key of the Lightning scenes
const REVOCATION = 5;

// The starting key pairs as every scene must know them
const STARTING = [[JONAS, 'Jonas', KEY_COLOURS[0]], [GABIJA, 'Gabija', KEY_COLOURS[1]], [ROKAS, 'Rokas', KEY_COLOURS[2]], [SIMONA, 'Simona', KEY_COLOURS[3]], [REVOCATION, 'Atšaukimas', KEY_COLOURS[4]]];







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
      expect(about.length).toBeLessThan(200);
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


  it('sorts the scenes into three groups, the locks first', () => {
    expect(GROUPS.map((group) => group.title)).toEqual(['Užraktai', 'Lightning', 'Atominiai mainai']);
    expect(GROUPS.map((group) => EXAMPLES.filter((example) => example.group === group.key).map((example) => example.label))).toEqual([
      ['Suma', 'Slaptažodis', 'P2PK', 'P2PKH', 'Multisig', 'P2SH', 'Laiko užraktas', 'Du keliai', 'Vagystė', 'OP_RETURN'],
      ['to_local', 'Bauda', 'HTLC siūlomas', 'HTLC gautas'],
      ['Mainas LTC', 'Mainas BTC', 'Grąžinimas', 'Submarine'],
    ]);
  });
});







// -----------------------------------------------------------
// Lightning and the swaps
// -----------------------------------------------------------
//
// A script with several ways through is only shown opened one
// way; here every way is walked, and the ways that must stay
// shut are tried. The unlocking scripts are the witnesses the
// specifications give, item for item.
// -----------------------------------------------------------

describe('the outputs of a Lightning commitment transaction', () => {

  const verdict = (id, ...actions) => buildModel(after(stateOf(id), ...actions)).verification;
  const timeOf = (verification) => verification.timeline.find((entry) => entry.stage === 'finality');
  const secret = '"lightning mokėjimo slaptažodis"';

  it('lets the holder take his own share once the coin is 144 blocks old and his input says so', () => {
    const verification = verdict('ln-to-local');

    expect(verification.valid).toBe(true);
    expect(timeOf(verification)).toMatchObject({ age: 'reached', sequence: 144, wait: 144, confirmations: 201 });
  });


  it('holds the holder back while the coin is younger than his input promises to wait', () => {
    expect(verdict('ln-to-local', { type: 'mined', text: '849900' })).toMatchObject({ valid: false, failed: 'finality', error: { code: 'sequence-too-early', wait: 144, confirmations: 101 } });
    expect(verdict('ln-to-local', { type: 'mined', text: '849857' }).valid).toBe(true);
    expect(verdict('ln-to-local', { type: 'mined', text: '849858' }).valid).toBe(false);
  });


  it('does not let the holder promise a shorter wait than the script demands, or none', () => {
    expect(verdict('ln-to-local', { type: 'sequence', text: '143' })).toMatchObject({ valid: false, failed: 'script', error: { code: 'sequence', why: 'too-early', required: 144, sequence: 143 } });
    expect(verdict('ln-to-local', { type: 'sequence', text: '' })).toMatchObject({ valid: false, failed: 'script', error: { code: 'sequence', why: 'switched-off', sequence: FINAL_SEQUENCE } });
  });


  it('takes a longer promise as well, and then holds the transaction to it', () => {
    expect(verdict('ln-to-local', { type: 'sequence', text: '0x90' }).valid).toBe(true);
    expect(verdict('ln-to-local', { type: 'sequence', text: '201' }).valid).toBe(true);
    expect(verdict('ln-to-local', { type: 'sequence', text: '202' })).toMatchObject({ valid: false, failed: 'finality' });
  });


  it('gives the other side the holder\'s share at once with the revocation key, and with no other', () => {
    const verification = verdict('ln-penalty');

    expect(verification.valid).toBe(true);
    expect(timeOf(verification)).toMatchObject({ age: 'none' });
    expect(verdict('ln-penalty', { type: 'unlock', text: `<sig:${GABIJA}> 1` })).toMatchObject({ valid: false, error: { code: 'false-on-top' } });
    expect(verdict('ln-penalty', { type: 'unlock', text: `<sig:${JONAS}> 1` })).toMatchObject({ valid: false, error: { code: 'false-on-top' } });
  });


  it('keeps the holder waiting on a transaction that has only just been mined', () => {
    const waiting = verdict('ln-penalty', { type: 'unlock', text: `<sig:${JONAS}> 0` }, { type: 'sequence', text: '144' });

    expect(waiting).toMatchObject({ valid: false, failed: 'finality', error: { code: 'sequence-too-early', wait: 144, confirmations: 3 } });
  });


  it.each([
    ['the other side with the payment\'s secret', `<sig:${GABIJA}> ${secret}`],
    ['the revocation key', `<sig:${REVOCATION}> <pubkey:${REVOCATION}>`],
    ['both signatures and nothing for a secret, as the timeout transaction carries them', `0 <sig:${GABIJA}> <sig:${JONAS}> 0`],
  ])('opens a payment the holder offers by %s', (_way, unlock) => {
    expect(verdict('ln-htlc-offered', { type: 'unlock', text: unlock }).valid).toBe(true);
  });


  it.each([
    ['a secret of the right size that is not the secret', `<sig:${GABIJA}> 0x${'11'.repeat(32)}`, 'verify-failed'],
    ['a secret that is too short', `<sig:${GABIJA}> "per trumpas"`, 'stack-underflow'],
    ['the holder alone with the secret', `<sig:${JONAS}> ${secret}`, 'false-on-top'],
    ['one signature where the timeout takes two', `0 <sig:${JONAS}> 0`, 'stack-underflow'],
    ['somebody else\'s key in place of the revocation key', `<sig:${GABIJA}> <pubkey:${GABIJA}>`, 'stack-underflow'],
  ])('keeps a payment the holder offers shut to %s', (_way, unlock, code) => {
    expect(verdict('ln-htlc-offered', { type: 'unlock', text: unlock })).toMatchObject({ valid: false, failed: 'script', error: { code } });
  });


  it.each([
    ['the other side alone, once the payment has timed out', `<sig:${GABIJA}> 0`],
    ['the revocation key', `<sig:${REVOCATION}> <pubkey:${REVOCATION}>`],
    ['both signatures with the secret, as the success transaction carries them', `0 <sig:${GABIJA}> <sig:${JONAS}> ${secret}`],
  ])('opens a payment the holder is offered by %s', (_way, unlock) => {
    expect(verdict('ln-htlc-received', { type: 'unlock', text: unlock }).valid).toBe(true);
  });


  it('does not let the other side take a payment back before it has timed out', () => {
    expect(verdict('ln-htlc-received', { type: 'lock-time', text: '850039' })).toMatchObject({ valid: false, failed: 'script', error: { code: 'locktime', why: 'too-early' } });
    expect(verdict('ln-htlc-received', { type: 'lock-time', text: '0' })).toMatchObject({ valid: false, failed: 'script', error: { code: 'locktime' } });
    expect(verdict('ln-htlc-received', { type: 'height', text: '850039' }, { type: 'mined', text: '850010' })).toMatchObject({ valid: false, failed: 'finality', error: { code: 'locktime-too-early' } });
  });


  it('lays a commitment transaction\'s outputs out smallest first, as the specification orders them', () => {
    for (const id of ['ln-to-local', 'ln-penalty', 'ln-htlc-offered', 'ln-htlc-received']) {
      const amounts = buildModel(stateOf(id)).a.outputs.map((output) => output.amount.value);
      expect(amounts).toEqual([...amounts].sort((one, other) => one - other));
    }
  });


  it('uses a payment secret of exactly the 32 bytes its scripts ask for', () => {
    expect(byteLength(textToHex(secret.slice(1, -1)))).toBe(32);
    expect(labelOf(textToHex(secret.slice(1, -1)), null)).toMatchObject({ kind: 'text', text: '„lightning mo…žodis“ (32 B)' });
  });
});







describe('swaps between chains', () => {

  const verdict = (id, ...actions) => buildModel(after(stateOf(id), ...actions)).verification;
  const secret = '"Jono ir Gabijos mainų paslaptis"';
  const refund = (who) => `<sig:${who}> <pubkey:${who}> 0 <redeemScript>`;
  const claim = (who, shown = secret) => `<sig:${who}> <pubkey:${who}> ${shown} 1 <redeemScript>`;

  it('hangs both contracts of a swap on one secret, with the two sides changing places', () => {
    const [litecoin, bitcoin] = ['swap-ltc', 'swap-btc'].map((id) => buildModel(stateOf(id)));
    const words = (model) => model.b.redeem.words.map((word) => word.text);

    expect(words(litecoin)[5]).toBe(words(bitcoin)[5]);
    expect(words(litecoin)[5]).toMatch(/^0x[0-9a-f]{64}$/);
    expect([words(litecoin)[9], words(litecoin)[16]]).toEqual([`<pubkeyhash:${JONAS}>`, `<pubkeyhash:${GABIJA}>`]);
    expect([words(bitcoin)[9], words(bitcoin)[16]]).toEqual([`<pubkeyhash:${GABIJA}>`, `<pubkeyhash:${JONAS}>`]);
    expect(stateOf('swap-ltc').unlock.includes(secret) && stateOf('swap-btc').unlock.includes(secret)).toBe(true);
    expect(byteLength(textToHex(secret.slice(1, -1)))).toBe(32);
  });


  it('gives the side that is to end first half the time of the other, counted in each chain\'s own blocks', () => {
    const [litecoin, bitcoin] = ['swap-ltc', 'swap-btc'].map((id) => buildModel(stateOf(id)));
    const limit = (model) => Number(model.b.redeem.words[11].text);

    expect(limit(bitcoin) - bitcoin.height.value).toBe(288);
    expect(limit(litecoin) - litecoin.height.value).toBe(576);
  });


  it('counts the Litecoin side in LTC, on Litecoin\'s chain', () => {
    const model = buildModel(stateOf('swap-ltc'));
    const amounts = model.verification.timeline.find((entry) => entry.stage === 'amounts');

    expect(model.chain).toMatchObject({ name: 'Litecoin', unit: 'LTC' });
    expect(narrate(amounts, model).lines[0]).toBe('Moneta verta 1 LTC, o transakcijos B išvestys išdalija 0.9999 LTC.');
    expect(buildModel(stateOf('swap-btc')).chain.unit).toBe('BTC');
  });


  it('lets a chain hold as many coins as it will ever have, and says so in its own words', () => {
    const tooMany = (id, text) => buildModel(after(stateOf(id), { type: 'output/amount', index: 0, text })).problems.map(problemText);

    expect(tooMany('swap-ltc', '30000000')).toEqual([]);
    expect(tooMany('swap-ltc', '84000001')).toEqual(['Tiek laitkoinų nebus niekada — jų iš viso 84 milijonai.']);
    expect(tooMany('swap-btc', '30000000')).toEqual(['Tiek bitkoinų nebus niekada — jų iš viso 21 milijonas.']);
  });


  it.each([
    ['a secret of the right size that is not the secret', claim(GABIJA, `0x${'22'.repeat(32)}`), 6],
    ['a secret of another size', claim(GABIJA, '"per trumpa"'), 3],
    ['the right secret in the wrong hands', claim(JONAS), 18],
  ])('keeps the Bitcoin contract shut to %s', (_way, unlock, index) => {
    const verification = verdict('swap-btc', { type: 'unlock', text: unlock });
    const broke = verification.timeline.find((entry) => entry.ok === false);

    expect(verification).toMatchObject({ valid: false, failed: 'script', error: { code: 'verify-failed' } });
    expect(broke).toMatchObject({ phase: 'redeem', index, item: { opcode: { name: 'OP_EQUALVERIFY' } } });
  });


  it('does not hand the coin back before the contract\'s time limit', () => {
    expect(verdict('swap-btc', { type: 'unlock', text: refund(JONAS) })).toMatchObject({ valid: false, failed: 'script', error: { code: 'locktime', why: 'too-early' } });
    expect(verdict('swap-btc', { type: 'unlock', text: refund(JONAS) }, { type: 'lock-time', text: '850288' })).toMatchObject({ valid: false, failed: 'finality', error: { code: 'locktime-too-early' } });
  });


  it('hands it back to its owner from the limit on — to him and to nobody else', () => {
    expect(verdict('swap-refund').valid).toBe(true);
    expect(verdict('swap-refund', { type: 'unlock', text: refund(GABIJA) })).toMatchObject({ valid: false, failed: 'script', error: { code: 'verify-failed' } });
  });


  it('leaves the way with the secret open even past the limit — whoever is first takes the coin', () => {
    expect(verdict('swap-refund', { type: 'unlock', text: claim(GABIJA) }).valid).toBe(true);
  });


  it('opens a submarine swap for the one who paid the Lightning invoice, and for its owner after the limit', () => {
    const back = `<sig:${JONAS}> 0 <redeemScript>`;

    expect(verdict('submarine').valid).toBe(true);
    expect(verdict('submarine', { type: 'unlock', text: back })).toMatchObject({ valid: false, error: { code: 'locktime' } });
    expect(verdict('submarine', { type: 'unlock', text: back }, { type: 'lock-time', text: '850144' }, { type: 'height', text: '850200' }).valid).toBe(true);
    expect(verdict('submarine', { type: 'unlock', text: `<sig:${JONAS}> "lightning mokėjimo slaptažodis" <redeemScript>` })).toMatchObject({ valid: false, error: { code: 'false-on-top' } });
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


  // The library's signatures are not always the playground's:
  // a wallet may sign again until a signature comes out a byte
  // shorter, and both are signatures of the same message. So
  // the whole of transaction B is compared with the library's
  // signatures carried in place of the playground's own
  it.each(Object.entries(reference.cases))('builds transaction B of %s to the last byte once it carries the reference library\'s signatures, and accepts it', (id, expected) => {
    const start = stateOf(id);
    const { keys, signing } = buildModel(start);
    const byName = expected.signatures ?? { [keys.find((key) => String(key.id) === signing.signers[0]).name]: expected.signature };
    const signatures = Object.fromEntries(Object.entries(byName).map(([name, signature]) => [keys.find((key) => key.name === name).id, signature]));
    const model = buildModel(after(start, { type: 'freeze', signatures }));

    expect(model.b.unlock.hex).toBe(expected.script_sig);
    expect(model.b.hex).toBe(expected.raw);
    expect(model.b.id).toBe(expected.txid);
    expect(model.verification.valid).toBe(true);
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


  it('reads a sequence number in decimal or hex, and an empty one as "whatever the transaction needs"', () => {
    expect(readSequence('')).toEqual({ value: null, problem: null });
    expect(readSequence(' 144 ')).toEqual({ value: 144, problem: null });
    expect(readSequence('0xFFFFFFFE')).toEqual({ value: FINAL_SEQUENCE - 1, problem: null });
    expect(readSequence('4294967295')).toEqual({ value: FINAL_SEQUENCE, problem: null });
    for (const typed of ['4294967296', '-1', '1.5', '0x', '0x123456789', 'daug']) expect(readSequence(typed).problem).toBe('sequence-unreadable');
  });


  it('gives an input the sequence number its transaction needs unless one is typed', () => {
    expect(buildModel(start).b.sequence).toBe(FINAL_SEQUENCE);
    expect(buildModel(stateOf('timelock')).b.sequence).toBe(FINAL_SEQUENCE - 1);
    expect(buildModel(after(start, { type: 'sequence', text: '7' })).b.sequence).toBe(7);
    expect(buildModel(after(start, { type: 'sequence', text: 'septyni' }))).toMatchObject({ verification: null, problems: [{ where: 'sequence', code: 'sequence-unreadable' }] });
  });


  it('signs the sequence number too: change it and every signature changes', () => {
    const before = buildModel(start);
    const model = buildModel(after(start, { type: 'sequence', text: '0' }));

    expect(model.signing.digest).not.toBe(before.signing.digest);
    expect(model.verification.valid).toBe(true);
  });


  it('counts a coin\'s confirmations from the block that holds it, and does not know a coin the chain has not reached', () => {
    expect(buildModel(start).confirmations).toBe(50001);
    expect(buildModel(after(start, { type: 'mined', text: '850000' })).confirmations).toBe(1);
    expect(buildModel(after(start, { type: 'mined', text: '850001' })).verification).toMatchObject({ valid: false, failed: 'coin', error: { code: 'no-such-coin' } });
    expect(buildModel(after(start, { type: 'mined', text: 'vakar' })).problems).toEqual([{ where: 'mined', code: 'whole-unreadable' }]);
  });


  it('says in a few words what a sequence number promises and how old a coin is', () => {
    expect(sequenceMeaning(FINAL_SEQUENCE)).toBe('santykinio užrakto nėra, nLockTime negalioja');
    expect(sequenceMeaning(FINAL_SEQUENCE - 1)).toBe('santykinio užrakto nėra');
    expect(sequenceMeaning(144)).toBe('moneta turi būti 144 blokų senumo');
    expect(sequenceMeaning(1)).toBe('moneta turi būti 1 bloko senumo');
    expect(sequenceMeaning(2 ** 22 + 3)).toBe('laukimas sekundėmis — čia neskaičiuojamas');
    expect(ageText(201)).toBe('moneta turi 201 patvirtinimą');
    expect(ageText(3)).toBe('moneta turi 3 patvirtinimus');
    expect(ageText(12)).toBe('moneta turi 12 patvirtinimų');
    expect(ageText(0)).toBe('grandinė šio bloko dar nepasiekė — mazgas monetos nežino');
  });


  it('writes an amount in the unit it is told, Bitcoin\'s unless told otherwise', () => {
    expect(formatAmount(49990000)).toBe('0.4999 BTC');
    expect(formatAmount(100000000, 'LTC')).toBe('1 LTC');
    expect(formatAmount(-10000000, 'LTC')).toBe('−0.1 LTC');
  });
});

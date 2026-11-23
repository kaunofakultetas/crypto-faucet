// -----------------------------------------------------------
//  [*] BitcoinScript — from what is built to two transactions
//
//  The playground's state is only what a student can make or
//  press: the key pairs — a name, a colour and a private key
//  each — the pieces of data put on the shelf, the outputs of
//  transaction A — an amount and a locking script each —
//  which of them transaction B spends, B's unlocking script
//  and the witness of its input, the scripts a lock may only
//  hold the hash of — a redeem script, a witness script — and
//  the two scripts a Taproot key may hide, B's own outputs as
//  "this much to that key", B's lock time and the sequence
//  number of its input, how high the node's chain stands and
//  which of its blocks holds transaction A, and two switches.
//  A scene also says which chain all of it stands on.
//
//  Everything else is worked out from it here, in one pass and
//  with nothing remembered between passes (buildModel): the
//  public keys, their hashes and addresses, the scripts read
//  and turned into bytes, the Taproot keys the tree of scripts
//  gives, both transactions serialized, their ids, the
//  messages B's signatures sign, the signatures themselves,
//  and the full node's verdict on B with every step of how it
//  got there. The page shows the result; it computes nothing
//  itself.
//
//  A script is kept as a line of words. A word that stands
//  for something of a key pair names the pair by its number —
//  never by its name, which is only a label the student may
//  change at any moment.
//
//  The order matters, because the pieces hang on each other
//  the way they do on the chain. The scripts behind a hash or
//  a key come first: a lock may name a script's hash, and a
//  Taproot key is made from its scripts. A's bytes give A's
//  id; B's input names that id; B's signatures sign B, with
//  the coin it spends, its outputs and its lock time — so
//  changing an amount in A changes every signature in B.
//
//  What exactly a signature signs depends on where the node
//  will check it: against which script, by which rules, for a
//  Taproot key or for one of its scripts. Nobody tells the
//  model that — a student may build any lock — so it finds
//  out the way a wallet cannot afford to but a playground
//  can: it lets a node run the spend once with stand-ins in
//  the signatures' places, notes what the node asks of each,
//  and then signs exactly that (askedOf).
//
//  By default the keys sign again whenever anything changes.
//  Switching that off freezes the moment of signing: the
//  state keeps transaction B as it stood then, and from then
//  on the keys sign that transaction, whatever B has become
//  since — signatures of a transaction that no longer exists,
//  which is exactly why a signed transaction cannot be
//  altered.
//
//  While anything built cannot be read — a word nobody knows,
//  an amount that is no amount — the model still builds what
//  it can for the drawing, lists the problems, and gives no
//  verdict: a node cannot be handed half a transaction.
//
//  Split into:
//
//    PREVIOUS_ID    — the coin A spends
//    payTo          — the standard lock to a key pair, as text
//    readAmount     — a typed amount as satoshis
//    readWhole      — a typed whole number
//    readSequence   — a typed sequence number
//    remembered     — a costly answer, worked out once
//    signatureOf    — a signature, remembered
//    fill           — a script's text to words, items, bytes
//    carried        — a witness: its words as plain items
//    askedOf        — what a node asks of every signature
//    messageOf      — the message one such question is about
//    buildModel     — the state to everything the page shows
//    reduce         — every change a student can make
// -----------------------------------------------------------

import { CHAINS, KEY_COLOURS, LIMITS, SATOSHIS, SPARE_NAMES } from './constants';
import { textToHex, uintLE } from './engine/bytes';
import { hash160, sha256Hex } from './engine/hashes';
import { evaluateSpend } from './engine/interpreter';
import { keyFrom, signWith } from './engine/keys';
import { FINAL_SEQUENCE, LOCKTIME_THRESHOLD, checkerFor, verifySpend } from './engine/node';
import { PAY_TO_SCRIPT_HASH, describeLock, numberHex, parseScript, resolveScript, serializeScript, withoutSeparators, witnessProgramOf, wordsOf } from './engine/script';
import { signSchnorr, tweakPrivateKey } from './engine/secp256k1';
import { controlBlockOf, leafHash, outputKeyOf, rootOf, tweakOf } from './engine/taproot';
import { serializeTransaction, signatureHash, taprootSignatureHash, transactionId, witnessId, witnessSignatureHash } from './engine/transaction';


// Signatures made so far, by key and message — a model is
// rebuilt on every change, most of them far from anything a
// signature covers
const SIGNED = new Map();

// Taproot keys made so far, by the key and the tree behind it
const TWEAKED = new Map();

// How many answers of a kind are remembered before the oldest
// go
const REMEMBERED = 200;

// How many times the scripts behind a hash or a key are read
// over: a Taproot key may stand in a witness script, whose
// hash may stand in a redeem script — three steps at most
const ROUNDS = 3;

// The sizes of the stand-ins a signature's place holds while
// the node is asked what it wants there: a Schnorr signature
// is sixty-four bytes, a DER one with its type about this many
const STAND_IN = { schnorr: 64, der: 72 };







// -----------------------------------------------------------
// PREVIOUS_ID
// -----------------------------------------------------------
//
// The id of the transaction whose coin transaction A spends.
// That transaction is not part of the playground — A has to
// spend something to be a transaction at all — so its id is
// simply the hash of a fixed sentence.
//
// Used by:
//   - buildModel (below)
// -----------------------------------------------------------

export const PREVIOUS_ID = sha256Hex(textToHex('VU KNF Bitcoin script playground: previous transaction'));







// -----------------------------------------------------------
// payTo
// -----------------------------------------------------------
//
// The everyday lock — pay to a public key's hash — to one of
// the key pairs, as the words of a script.
//
// Used by:
//   - buildModel, reduce (below)
//   - examples.js
// -----------------------------------------------------------

export const payTo = (id) => `OP_DUP OP_HASH160 <pubkeyhash:${id}> OP_EQUALVERIFY OP_CHECKSIG`;







// -----------------------------------------------------------
// readAmount
// -----------------------------------------------------------
//
// A typed amount of coins as satoshis — the whole number a
// transaction holds — or the reason it is no amount: nothing
// typed, not a number with at most eight decimals (a comma
// is taken for the point), or more than all the coins there
// will ever be on the chain — Bitcoin's twenty-one million
// unless told otherwise. The digits are read as text; an
// amount never passes through a fraction that might round.
//
// Used by:
//   - buildModel (below)
// -----------------------------------------------------------

export function readAmount(text, coins = CHAINS.btc.coins) {
  const typed = text.trim();
  if (typed === '') return { value: null, problem: 'amount-empty' };

  const parts = /^(\d+)(?:[.,](\d{1,8}))?$/.exec(typed);
  if (!parts) return { value: null, problem: 'amount-unreadable' };

  const value = Number(parts[1]) * SATOSHIS + Number((parts[2] ?? '').padEnd(8, '0'));
  return value > coins * SATOSHIS ? { value: null, problem: 'amount-too-large' } : { value, problem: null };
}







// -----------------------------------------------------------
// readWhole
// -----------------------------------------------------------
//
// A typed whole number from zero up to a limit, or the reason
// it is none.
//
// Used by:
//   - buildModel (below) — the lock time and the chain height
// -----------------------------------------------------------

export function readWhole(text, limit) {
  const typed = text.trim();
  if (!/^\d+$/.test(typed)) return { value: null, problem: 'whole-unreadable' };

  const value = Number(typed);
  return value > limit ? { value: null, problem: 'whole-too-large' } : { value, problem: null };
}







// -----------------------------------------------------------
// readSequence
// -----------------------------------------------------------
//
// A typed sequence number: nothing typed means "whatever the
// transaction needs" and reads as no number at all; otherwise
// a whole number up to the thirty-two bits the field holds,
// written in decimal or, behind 0x, in hex — or the reason it
// is none.
//
// Used by:
//   - buildModel (below)
// -----------------------------------------------------------

export function readSequence(text) {
  const typed = text.trim();
  if (typed === '') return { value: null, problem: null };

  const value = /^\d+$/.test(typed) ? Number(typed) : /^0x[0-9a-f]{1,8}$/i.test(typed) ? parseInt(typed, 16) : NaN;
  return Number.isNaN(value) || value > FINAL_SEQUENCE ? { value: null, problem: 'sequence-unreadable' } : { value, problem: null };
}







// -----------------------------------------------------------
// remembered
// -----------------------------------------------------------
//
// An answer that takes curve arithmetic to work out, worked
// out once and then kept under a name: the same question
// always has the same answer, and a change on the page should
// not wait for it twice. The oldest answers make room.
//
// Used by:
//   - signatureOf, buildModel (below)
// -----------------------------------------------------------

function remembered(store, name, make) {
  if (!store.has(name)) {
    if (store.size >= REMEMBERED) store.delete(store.keys().next().value);
    store.set(name, make());
  }
  return store.get(name);
}







// -----------------------------------------------------------
// signatureOf
// -----------------------------------------------------------
//
// A key's signature over a message, as a transaction carries
// it: a DER signature with the sign-everything byte behind
// it, or — where the node will check a Schnorr signature —
// the sixty-four bytes of one. A Taproot coin opened by its
// key is signed with the private key tweaked the way the
// public one was; `tweak` is that number, or nothing.
//
// Used by:
//   - buildModel (below)
// -----------------------------------------------------------

function signatureOf({ privateKey, digest, schnorr, tweak }) {
  return remembered(SIGNED, `${schnorr}:${tweak}:${privateKey}:${digest}`, () => {
    if (!schnorr) return signWith(privateKey, digest);
    return signSchnorr(tweak === null ? privateKey : tweakPrivateKey(privateKey, tweak), digest);
  });
}







// -----------------------------------------------------------
// fill
// -----------------------------------------------------------
//
// A read script with its references filled in and turned
// into bytes: its text, its items, its problems — those of
// the reading and those of the filling together — and its
// bytes. A reference that could not be filled is left out of
// the items and the bytes; it stays among the problems.
//
// The script's words ride along as well, every one of them:
// each with the item it was read as, or none, and with what
// is wrong with it, or nothing. That is what the page lays
// out as tiles — a word that could not be read still has its
// place in the row, and can be taken out of it.
//
// Used by:
//   - buildModel (below)
// -----------------------------------------------------------

function fill(text, parsed, values) {
  const resolved = resolveScript(parsed.items, values);
  const items = resolved.items.filter((item) => item.type === 'op' || item.hex !== null);
  const problems = [...parsed.problems, ...resolved.problems];
  const words = wordsOf(text).map((word) => ({
    ...word,
    item: resolved.items.find((item) => item.start === word.start) ?? null,
    problem: problems.find((problem) => problem.start === word.start) ?? null,
  }));
  return { text, items, problems, hex: serializeScript(items), words };
}







// -----------------------------------------------------------
// carried
// -----------------------------------------------------------
//
// A filled row of words as a witness: the list of plain byte
// strings an input carries beside its script. A witness is
// not run, so it holds no opcodes — but the tiles for the
// small numbers are the natural way to write an empty item
// or a one, and stand for the value they would have put on
// the stack. Any other opcode is a problem of its word.
//
// Used by:
//   - buildModel (below)
// -----------------------------------------------------------

function carried(filled) {
  const stack = [];
  const problems = [...filled.problems];

  for (const item of filled.items) {
    if (item.type === 'push') stack.push(item.hex);
    else if (item.opcode.group === 'constants') stack.push(item.opcode.code === 0x00 ? '' : numberHex(item.opcode.code === 0x4f ? -1 : item.opcode.code - 0x50));
    else problems.push({ code: 'witness-opcode', text: item.text, start: item.start, end: item.end });
  }

  const words = filled.words.map((word) => ({ ...word, problem: problems.find((problem) => problem.start === word.start) ?? null }));
  return { ...filled, problems, words, stack };
}







// -----------------------------------------------------------
// askedOf
// -----------------------------------------------------------
//
// What a node asks of every signature a spend carries, found
// by letting it run the spend with stand-ins where the
// signatures will go. `signers` says whose signature each
// stand-in holds the place of. The answer gives, by stand-in,
// the question the node put to it: an old signature check
// with the script it is checked against and the rules, or a
// Schnorr check — for the Taproot key itself, or for a leaf,
// with the annex and the place of the last OP_CODESEPARATOR.
//
// While it runs, a stand-in counts as a valid signature
// exactly where its key pair's key is the one it is checked
// against — the plain key, the 32-byte one in a Taproot
// script, the Taproot key the pair's own key would give — so
// the run takes the turns the real spend will take. A
// stand-in tried against several keys, as OP_CHECKMULTISIG
// does, is noted where it fits. Signatures that are no
// stand-ins — bytes somebody wrote — are checked for real.
//
// Used by:
//   - buildModel (below)
// -----------------------------------------------------------

function askedOf({ transaction, coins, unlock, lock, witness, signers }) {
  const real = checkerFor(transaction, 0, coins);
  const asked = new Map();
  const note = (signature, fits, question) => {
    if (fits || !asked.has(signature)) asked.set(signature, question);
  };

  evaluateSpend({
    unlock: { items: unlock.items, hex: unlock.hex },
    lock: { items: lock.items, hex: lock.hex },
    witness,
    checker: {
      ...real,
      checkSignature(signature, publicKey, code, rules) {
        const signer = signers.get(signature);
        if (!signer) return real.checkSignature(signature, publicKey, code, rules);

        const fits = publicKey === signer.publicKey;
        note(signature, fits, { schnorr: false, code, rules });
        return { valid: fits, digest: null, why: fits ? null : 'wrong-signature' };
      },
      checkSchnorr(signature, key, { leaf = null, annex = null, separator } = {}) {
        const signer = signers.get(signature);
        if (!signer) return real.checkSchnorr(signature, key, { leaf, annex, separator });

        const fits = key === (leaf ? signer.xOnlyKey : signer.outputKey);
        note(signature, fits, { schnorr: true, leaf, annex, separator });
        return fits ? { valid: true, digest: null, why: null } : { fault: { code: 'schnorr-signature' } };
      },
    },
  });

  return asked;
}







// -----------------------------------------------------------
// messageOf
// -----------------------------------------------------------
//
// The thirty-two bytes a signature has to sign to answer one
// of the node's questions (see askedOf), for a transaction
// and the coin it spends: the Taproot message, the message of
// a version-0 witness program, or the original one — whose
// script goes in without its OP_CODESEPARATORs.
//
// Used by:
//   - buildModel (below)
// -----------------------------------------------------------

function messageOf(question, transaction, coins) {
  if (question.schnorr) return taprootSignatureHash(transaction, 0, coins, question);
  if (question.rules === 'witness0') return witnessSignatureHash(transaction, 0, question.code, coins[0].value);
  return signatureHash(transaction, 0, withoutSeparators(question.code));
}







// -----------------------------------------------------------
// buildModel
// -----------------------------------------------------------
//
// Everything the page shows, from the state (see the file
// header for the order and why). Hands back the chain; the
// key pairs with all that follows from their private keys;
// both transactions — their parts, bytes and ids; the block
// that holds A and how many confirmations that makes; which
// witness program B's input is judged by, if any, and which
// Taproot script its witness shows; what B's signatures sign
// and whether the ones it carries still sign it; a lexicon
// that names what is worth naming — a key pair by its number,
// and a run of bytes by what it is: someone's public key, its
// hash, a 32-byte key, a Taproot key, a signature, a script
// that stands behind a hash or a key and that hash, a control
// block, a hash made on the shelf, bytes a scene has given a
// name, or simply the number, text or bytes somebody wrote;
// the list of what cannot be read; and the node's
// verification, or none while that list is not empty.
//
// The sequence number of B's input is the typed one. When
// none is typed it is the number that switches every lock
// time off — or, for a transaction with a lock time of its
// own, the one just below it, which lets that lock time
// count. A coin in a block the chain has not reached yet is
// a coin the node does not know.
//
// The Taproot tree is the scripts A and B that are written
// and can be read, in that order. A Taproot key stands for a
// key pair's own key tweaked with that tree; the control
// block of a script is made for the key pair the coin's lock
// names with such a key.
//
// Used by:
//   - hooks/usePlayground.js — once per change of the state
// -----------------------------------------------------------

export function buildModel(state) {
  const chain = CHAINS[state.chain];
  const keys = state.keys.map((key) => {
    const made = keyFrom(key.privateKey);
    return { ...key, ...made, xOnlyKey: made.publicKey.slice(2) };
  });
  const numbers = keys.map((key) => String(key.id));
  const keyOf = (number) => keys.find((key) => String(key.id) === number);
  const read = (text) => parseScript(text, numbers);
  const byNumber = (pick) => Object.fromEntries(keys.map((key) => [key.id, pick(key)]));
  const written = (text) => text.trim() !== '';
  const bytesOf = (text, script) => (written(text) && script.problems.length === 0 ? script.hex : null);
  const taprootKey = (key, tree) => remembered(TWEAKED, `${key.xOnlyKey}:${rootOf(tree)}`, () => outputKeyOf(key.xOnlyKey, tree)?.key ?? null);

  // The scripts that stand behind a hash or a key come first.
  // They may name each other's hashes and keys, so they are
  // read over until every name that can be filled is filled
  const parsed = { redeem: read(state.redeem), witnessScript: read(state.witnessScript), leaves: state.leaves.map(read) };
  let known = { publicKeys: byNumber((key) => key.publicKey), publicKeyHashes: byNumber((key) => key.publicKeyHash), xOnlyKeys: byNumber((key) => key.xOnlyKey) };
  let behind = null;
  for (let round = 0; round < ROUNDS; round += 1) {
    const leaves = state.leaves.map((text, index) => fill(text, parsed.leaves[index], known));
    const witnessScript = fill(state.witnessScript, parsed.witnessScript, known);
    const redeem = fill(state.redeem, parsed.redeem, known);
    const leafHexes = leaves.map((leaf, index) => bytesOf(state.leaves[index], leaf));
    const tree = leafHexes.filter((hex) => hex !== null);
    const witnessHex = bytesOf(state.witnessScript, witnessScript);
    const redeemHex = bytesOf(state.redeem, redeem);

    behind = { leaves, witnessScript, redeem, leafHexes, tree, witnessHex, redeemHex };
    known = {
      publicKeys: known.publicKeys,
      publicKeyHashes: known.publicKeyHashes,
      xOnlyKeys: known.xOnlyKeys,
      outputKeys: byNumber((key) => taprootKey(key, tree)),
      leaves: leafHexes,
      witnessScript: witnessHex,
      witnessHash: witnessHex === null ? null : sha256Hex(witnessHex),
      redeemScript: redeemHex,
      scriptHash: redeemHex === null ? null : hash160(redeemHex),
    };
  }
  const { tree, redeemHex, witnessHex } = behind;

  // Transaction A: its outputs, its bytes, its id
  const outputs = state.outputs.map((output, index) => {
    const script = fill(output.lock, read(output.lock), known);
    return { id: output.id, index, amount: readAmount(output.amount, chain.coins), script, lock: describeLock(script.hex) };
  });
  const a = {
    version: 2,
    inputs: [{ txid: PREVIOUS_ID, vout: 0, script: '', sequence: FINAL_SEQUENCE }],
    outputs: outputs.map((output) => ({ value: output.amount.value ?? 0, script: output.script.hex })),
    lockTime: 0,
  };
  const aId = transactionId(a);
  const coin = outputs[state.spent];
  const coins = [{ value: coin.amount.value ?? 0, script: coin.script.hex }];

  // Transaction B without what unlocks the coin — what is signed
  const lockTime = readWhole(state.lockTime, LOCKTIME_THRESHOLD - 1);
  const height = readWhole(state.height, LOCKTIME_THRESHOLD - 1);
  const mined = readWhole(state.mined, LOCKTIME_THRESHOLD - 1);
  const typedSequence = readSequence(state.sequence);
  const sequence = typedSequence.value ?? (lockTime.value > 0 ? FINAL_SEQUENCE - 1 : FINAL_SEQUENCE);
  const payments = state.payments.map((payment, index) => {
    const script = fill(payTo(payment.to), read(payTo(payment.to)), known);
    return {
      id: payment.id,
      index,
      to: payment.to,
      key: keys.find((key) => key.id === payment.to) ?? null,
      amount: readAmount(payment.amount, chain.coins),
      script,
      lock: describeLock(script.hex),
    };
  });
  const unsigned = {
    version: 2,
    inputs: [{ txid: aId, vout: coin.index, script: '', sequence }],
    outputs: payments.map((payment) => ({ value: payment.amount.value ?? 0, script: payment.script.hex })),
    lockTime: lockTime.value ?? 0,
  };

  // The witness program the input is judged by: the lock
  // itself, or the redeem script behind a script hash. Taproot
  // has no form behind a hash
  const behindHash = PAY_TO_SCRIPT_HASH.test(coin.script.hex) && redeemHex !== null;
  const bare = witnessProgramOf(coin.script.hex);
  const found = bare ?? (behindHash ? witnessProgramOf(redeemHex) : null);
  const kindOf = ({ version, program: bytes }) => (version === 0 && bytes.length === 40 ? 'p2wpkh'
    : version === 0 && bytes.length === 64 ? 'p2wsh'
      : version === 1 && bytes.length === 64 && bare ? 'p2tr' : 'unknown');
  const program = found ? { ...found, wrapped: !bare, kind: kindOf(found) } : null;

  // The proofs of the tree's scripts, for the key pair whose
  // Taproot key the lock holds
  const owner = read(state.outputs[state.spent].lock).items.find((item) => item.ref?.what === 'tapkey')?.ref.who ?? null;
  const controls = behind.leafHexes.map((hex) => (hex === null || owner === null ? null : controlBlockOf(keyOf(owner).xOnlyKey, tree, tree.indexOf(hex))));

  // Every place B asks for a signature, the unlocking script's
  // first, and B's input filled in with a list of signatures —
  // one per place
  const reads = { unlock: read(state.unlock), witness: read(state.witness) };
  const places = ['unlock', 'witness'].flatMap((row) => reads[row].items.filter((item) => item.ref?.what === 'sig').map((item) => ({ row, start: item.start, who: item.ref.who })));
  const at = (row, list) => Object.fromEntries(places.flatMap((place, index) => (place.row === row ? [[place.start, list[index]]] : [])));
  const inputWith = (list) => ({
    unlock: fill(state.unlock, reads.unlock, { ...known, controls, signatures: at('unlock', list) }),
    witness: carried(fill(state.witness, reads.witness, { ...known, controls, signatures: at('witness', list) })),
  });

  // What the node will ask of each of them (see askedOf) —
  // and, for a signature the node never gets to, what it would
  // ask of a signature standing there in the usual spend
  const standIns = places.map((_, index) => `${'5a'.repeat((program?.kind === 'p2tr' ? STAND_IN.schnorr : STAND_IN.der) - 2)}${uintLE(index, 2)}`);
  const draft = inputWith(standIns);
  const asked = places.length === 0 ? new Map() : askedOf({
    transaction: unsigned,
    coins,
    unlock: draft.unlock,
    lock: coin.script,
    witness: draft.witness.stack,
    signers: new Map(places.map((place, index) => [standIns[index], { ...keyOf(place.who), outputKey: taprootKey(keyOf(place.who), tree) }])),
  });
  const usual = (row) => {
    if (row === 'unlock' || !program) return { schnorr: false, rules: 'legacy', code: behindHash ? redeemHex : coin.script.hex };
    if (program.kind === 'p2wpkh') return { schnorr: false, rules: 'witness0', code: `76a914${program.program}88ac` };
    if (program.kind !== 'p2tr') return { schnorr: false, rules: 'witness0', code: draft.witness.stack.at(-1) ?? '' };

    const { stack } = draft.witness;
    const annex = stack.length >= 2 && stack.at(-1).startsWith('50') ? stack.at(-1) : null;
    const rest = annex === null ? stack : stack.slice(0, -1);
    return { schnorr: true, leaf: rest.length >= 2 ? leafHash(rest.at(-2)) : null, annex };
  };
  const covers = (question) => (question.schnorr ? (question.leaf ? 'leaf' : 'key')
    : question.rules === 'witness0' ? (program?.kind === 'p2wpkh' ? 'program' : 'witnessScript')
      : behindHash ? 'redeem' : 'lock');

  // The signatures: of B as it stands now, and — while the
  // moment of signing is frozen — of B as it stood then
  const questions = places.map((place, index) => asked.get(standIns[index]) ?? usual(place.row));
  const signedFor = (moment) => places.map((place, index) => {
    const question = questions[index];
    const key = keyOf(place.who);
    const digest = messageOf(question, moment.transaction, moment.coins);
    const tweak = question.schnorr && !question.leaf ? tweakOf(key.xOnlyKey, rootOf(tree)) : null;
    return { ...place, covers: covers(question), digest, signature: signatureOf({ privateKey: key.privateKey, digest, schnorr: question.schnorr, tweak }) };
  });
  const now = { transaction: unsigned, coins };
  const fresh = signedFor(now);
  const signatures = (state.frozen ? signedFor(state.frozen) : fresh).map((signed, index) => ({ ...signed, stale: signed.signature !== fresh[index].signature }));
  const signers = [...new Set(places.map((place) => place.who))];
  const stale = signers.filter((number) => signatures.some((signed) => signed.who === number && signed.stale));

  const { unlock, witness } = inputWith(signatures.map((signed) => signed.signature));
  const b = { ...unsigned, inputs: [{ ...unsigned.inputs[0], script: unlock.hex, witness: witness.stack }] };

  // The script the node builds itself for a coin paid to a
  // witness key hash, and the Taproot script the witness shows
  const impliedText = program?.kind === 'p2wpkh' ? `OP_DUP OP_HASH160 0x${program.program} OP_EQUALVERIFY OP_CHECKSIG` : null;
  const implied = impliedText === null ? null : fill(impliedText, read(impliedText), known);
  const shownScript = program?.kind === 'p2tr' ? witness.stack.filter((item, index, all) => !(index === all.length - 1 && all.length >= 2 && item.startsWith('50'))).at(-2) : undefined;
  const shown = shownScript === undefined ? -1 : behind.leafHexes.indexOf(shownScript);

  // What a key pair's number, and a run of bytes, stand for.
  // First what the scripts and the shelf spell out, each the
  // way it was written — a text stays a text and bytes stay
  // bytes wherever they turn up, on the stack too. The pieces
  // of a key pair go in last: bytes that are someone's key are
  // called that, whatever else they match
  const lexicon = { keys: new Map(keys.map((key) => [String(key.id), key])), values: new Map() };
  const spelled = [
    ...outputs.flatMap((output) => output.script.items),
    ...unlock.items,
    ...witness.items,
    ...behind.redeem.items,
    ...behind.witnessScript.items,
    ...behind.leaves.flatMap((leaf) => leaf.items),
    ...state.data.flatMap((piece) => read(piece.word).items),
  ];
  for (const item of spelled) {
    if (item.literal && item.hex !== '') lexicon.values.set(item.hex, { what: item.literal });
  }
  for (const piece of state.data) {
    if (piece.made) lexicon.values.set(piece.word.slice(2), { what: 'hash', ...piece.made });
    else if (piece.name) lexicon.values.set(piece.word.slice(2), { what: 'named', name: piece.name });
  }
  for (const [index, what] of ['leafA', 'leafB'].entries()) {
    if (behind.leafHexes[index] !== null) lexicon.values.set(behind.leafHexes[index], { what });
    if (controls[index] !== null) lexicon.values.set(controls[index], { what: index === 0 ? 'controlA' : 'controlB' });
  }
  if (witnessHex !== null) {
    lexicon.values.set(witnessHex, { what: 'witnessScript' });
    lexicon.values.set(known.witnessHash, { what: 'witnessHash' });
  }
  if (redeemHex !== null) {
    lexicon.values.set(redeemHex, { what: 'redeemScript' });
    lexicon.values.set(known.scriptHash, { what: 'scriptHash' });
  }
  for (const key of keys) {
    const number = String(key.id);
    lexicon.values.set(key.xOnlyKey, { what: 'xonly', who: number });
    if (known.outputKeys[key.id] !== null) lexicon.values.set(known.outputKeys[key.id], { what: 'tapkey', who: number });
    lexicon.values.set(key.publicKey, { what: 'pubkey', who: number });
    lexicon.values.set(key.publicKeyHash, { what: 'pubkeyhash', who: number });
  }
  for (const signed of signatures) lexicon.values.set(signed.signature, { what: 'sig', who: signed.who, stale: signed.stale });

  const problems = [
    ...outputs.flatMap((output) => [
      ...(output.amount.problem ? [{ where: 'output-amount', index: output.index, code: output.amount.problem, chain: chain.key }] : []),
      ...output.script.problems.map((problem) => ({ where: 'lock', index: output.index, ...problem })),
    ]),
    ...unlock.problems.map((problem) => ({ where: 'unlock', ...problem })),
    ...witness.problems.map((problem) => ({ where: 'witness', ...problem })),
    ...behind.redeem.problems.map((problem) => ({ where: 'redeem', ...problem })),
    ...behind.witnessScript.problems.map((problem) => ({ where: 'witness-script', ...problem })),
    ...behind.leaves.flatMap((leaf, index) => leaf.problems.map((problem) => ({ where: 'leaf', index, ...problem }))),
    ...payments.flatMap((payment) => [
      ...(payment.amount.problem ? [{ where: 'payment-amount', index: payment.index, code: payment.amount.problem, chain: chain.key }] : []),
      ...(payment.key ? [] : [{ where: 'payment-key', index: payment.index, code: 'unknown-key' }]),
    ]),
    ...(lockTime.problem ? [{ where: 'lock-time', code: lockTime.problem }] : []),
    ...(typedSequence.problem ? [{ where: 'sequence', code: typedSequence.problem }] : []),
    ...(height.problem ? [{ where: 'height', code: height.problem }] : []),
    ...(mined.problem ? [{ where: 'mined', code: mined.problem }] : []),
  ];

  const paid = payments.reduce((sum, payment) => sum + (payment.amount.value ?? 0), 0);
  const verification = problems.length > 0 ? null : verifySpend({
    transaction: b,
    coin: { found: mined.value <= height.value, spent: state.coinSpent, value: coin.amount.value, height: mined.value, lock: { items: coin.script.items, hex: coin.script.hex } },
    unlock: { items: unlock.items, hex: unlock.hex },
    witness: witness.stack,
    height: height.value,
    maxMoney: chain.coins * SATOSHIS,
  });

  return {
    chain,
    keys,
    a: { id: aId, hex: serializeTransaction(a), outputs },
    b: {
      id: transactionId(b),
      witnessId: witnessId(b),
      hex: serializeTransaction(b, { witnesses: true }),
      spends: coin,
      unlock,
      witness,
      redeem: { ...behind.redeem, written: written(state.redeem), hex: redeemHex },
      witnessScript: { ...behind.witnessScript, written: written(state.witnessScript), hex: witnessHex },
      leaves: behind.leaves.map((leaf, index) => ({ ...leaf, written: written(state.leaves[index]), hex: behind.leafHexes[index] })),
      implied,
      program,
      shown: shown === -1 ? null : shown,
      payments,
      paid,
      fee: coin.amount.value === null ? null : coin.amount.value - paid,
      lockTime,
      sequence,
      typedSequence,
    },
    signing: {
      digest: signatures[0]?.digest ?? messageOf(usual('unlock'), unsigned, coins),
      covers: signatures[0]?.covers ?? covers(usual('unlock')),
      signatures,
      signers,
      stale,
      frozen: state.frozen !== null,
      now,
    },
    height,
    mined,
    confirmations: height.value === null || mined.value === null ? null : height.value - mined.value + 1,
    lexicon,
    problems,
    verification,
  };
}







// -----------------------------------------------------------
// reduce
// -----------------------------------------------------------
//
// Every change a student can make, as the next state.
//
// A new key pair takes the first colour and the first spare
// name no pair has yet; its private key comes with the action
// — drawing one at random is not this function's to do. The
// last key pair cannot be removed, and a removed pair's coins
// in transaction B go to the first pair left; a script that
// still names the removed pair keeps the word, which then
// reads as a problem.
//
// A piece of data is kept once, and the shelf holds only so
// many — the oldest makes room. A transaction keeps at least
// one output and at most a few (LIMITS); the output B spends
// follows its coin when an earlier output is removed, and
// moves to the first one when its own coin goes. Freezing
// keeps transaction B as it is handed over — what the keys
// sign from then on. Loading replaces everything.
//
// Used by:
//   - hooks/usePlayground.js — the reducer
// -----------------------------------------------------------

export function reduce(state, action) {
  const patch = (list, index, changes) => list.map((entry, at) => (at === index ? { ...entry, ...changes } : entry));
  const unused = (taken) => (state.keys.find((key) => !taken.includes(key.id)) ?? state.keys[0]).id;

  switch (action.type) {
    case 'load':
      return action.state;

    case 'key/add': {
      if (state.keys.length >= LIMITS.KEYS) return state;
      const colour = KEY_COLOURS.find((candidate) => !state.keys.some((key) => key.colour === candidate)) ?? KEY_COLOURS[0];
      const name = SPARE_NAMES.find((candidate) => !state.keys.some((key) => key.name === candidate)) ?? `Raktas ${state.nextId}`;
      return { ...state, nextId: state.nextId + 1, keys: [...state.keys, { id: state.nextId, name, colour, privateKey: action.privateKey }] };
    }
    case 'key/rename':
      return { ...state, keys: state.keys.map((key) => (key.id === action.id ? { ...key, name: action.name.slice(0, LIMITS.NAME_CHARACTERS) } : key)) };
    case 'key/remove': {
      if (state.keys.length <= 1) return state;
      const keys = state.keys.filter((key) => key.id !== action.id);
      return { ...state, keys, payments: state.payments.map((payment) => (payment.to === action.id ? { ...payment, to: keys[0].id } : payment)) };
    }

    case 'data/add': {
      if (state.data.some((piece) => piece.word === action.word)) return state;
      const data = [...state.data, { id: state.nextId, word: action.word, made: action.made ?? null, name: null }].slice(-LIMITS.DATA);
      return { ...state, nextId: state.nextId + 1, data };
    }
    case 'data/remove':
      return { ...state, data: state.data.filter((piece) => piece.id !== action.id) };

    case 'output/add': {
      if (state.outputs.length >= LIMITS.OUTPUTS) return state;
      const owner = unused(state.outputs.map((output) => Number(/<pubkeyhash:(\d+)>/i.exec(output.lock)?.[1])));
      return { ...state, nextId: state.nextId + 1, outputs: [...state.outputs, { id: state.nextId, amount: '0.1', lock: payTo(owner) }] };
    }
    case 'output/remove': {
      if (state.outputs.length <= 1) return state;
      const spent = action.index === state.spent ? 0 : state.spent - (action.index < state.spent ? 1 : 0);
      return { ...state, spent, outputs: state.outputs.filter((_, index) => index !== action.index) };
    }
    case 'output/amount':
      return { ...state, outputs: patch(state.outputs, action.index, { amount: action.text }) };
    case 'output/lock':
      return { ...state, outputs: patch(state.outputs, action.index, { lock: action.text }) };
    case 'spend':
      return { ...state, spent: action.index };

    case 'unlock':
      return { ...state, unlock: action.text };
    case 'redeem':
      return { ...state, redeem: action.text };
    case 'witness':
      return { ...state, witness: action.text };
    case 'witness-script':
      return { ...state, witnessScript: action.text };
    case 'leaf':
      return { ...state, leaves: state.leaves.map((text, index) => (index === action.index ? action.text : text)) };

    case 'payment/add': {
      if (state.payments.length >= LIMITS.PAYMENTS) return state;
      const to = unused(state.payments.map((payment) => payment.to));
      return { ...state, nextId: state.nextId + 1, payments: [...state.payments, { id: state.nextId, amount: '0.1', to }] };
    }
    case 'payment/remove':
      return state.payments.length <= 1 ? state : { ...state, payments: state.payments.filter((_, index) => index !== action.index) };
    case 'payment/amount':
      return { ...state, payments: patch(state.payments, action.index, { amount: action.text }) };
    case 'payment/to':
      return { ...state, payments: patch(state.payments, action.index, { to: action.id }) };

    case 'lock-time':
      return { ...state, lockTime: action.text };
    case 'sequence':
      return { ...state, sequence: action.text };
    case 'height':
      return { ...state, height: action.text };
    case 'mined':
      return { ...state, mined: action.text };
    case 'freeze':
      return { ...state, frozen: action.signed };
    case 'thaw':
      return { ...state, frozen: null };
    case 'coin-spent':
      return { ...state, coinSpent: action.value };

    default:
      return state;
  }
}

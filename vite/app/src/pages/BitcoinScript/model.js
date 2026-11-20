// -----------------------------------------------------------
//  [*] BitcoinScript — from what is built to two transactions
//
//  The playground's state is only what a student can make or
//  press: the key pairs — a name, a colour and a private key
//  each — the pieces of data put on the shelf, the outputs of
//  transaction A — an amount and a locking script each —
//  which of them transaction B spends, B's unlocking script,
//  an optional redeem script, B's own outputs as "this much
//  to that key", B's lock time, how high the node's chain
//  stands, and two switches.
//
//  Everything else is worked out from it here, in one pass and
//  with nothing remembered between passes (buildModel): the
//  public keys, their hashes and addresses, the scripts read
//  and turned into bytes, both transactions serialized, their
//  ids, the message B's signatures sign, the signatures
//  themselves, and the full node's verdict on B with every
//  step of how it got there. The page shows the result; it
//  computes nothing itself.
//
//  A script is kept as a line of words. A word that stands
//  for something of a key pair names the pair by its number —
//  never by its name, which is only a label the student may
//  change at any moment.
//
//  The order matters, because the pieces hang on each other
//  the way they do on the chain. A's bytes give A's id; B's
//  input names that id; B's signatures sign B, with the coin
//  it spends, its outputs and its lock time — so changing an
//  amount in A changes every signature in B. By default the
//  keys sign again whenever that happens. Switching that off
//  freezes the signatures as they are (the state keeps them),
//  and then any later change leaves B carrying signatures of
//  a transaction that no longer exists — which is exactly why
//  a signed transaction cannot be altered.
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
//    readAmount     — typed bitcoin as satoshis
//    readWhole      — a typed whole number
//    signatureOf    — a signature, remembered
//    signEveryone   — every key pair's signature at once
//    fill           — a script's text to words, items, bytes
//    buildModel     — the state to everything the page shows
//    reduce         — every change a student can make
// -----------------------------------------------------------

import { KEY_COLOURS, LIMITS, SATOSHIS, SPARE_NAMES } from './constants';
import { textToHex } from './engine/bytes';
import { hash160, sha256Hex } from './engine/hashes';
import { keyFrom, signWith } from './engine/keys';
import { FINAL_SEQUENCE, LOCKTIME_THRESHOLD, MAX_MONEY, verifySpend } from './engine/node';
import { PAY_TO_SCRIPT_HASH, describeLock, parseScript, resolveScript, serializeScript, wordsOf } from './engine/script';
import { serializeTransaction, signatureHash, transactionId } from './engine/transaction';


// Signatures made so far, by key and message — a model is
// rebuilt on every change, most of them far from anything a
// signature covers
const SIGNED = new Map();

// How many signatures are remembered before the oldest go
const SIGNED_LIMIT = 200;







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
// A typed amount of bitcoin as satoshis — the whole number a
// transaction holds — or the reason it is no amount: nothing
// typed, not a number with at most eight decimals (a comma
// is taken for the point), or more than all the bitcoin
// there will ever be. The digits are read as text; an amount
// never passes through a fraction that might round.
//
// Used by:
//   - buildModel (below)
// -----------------------------------------------------------

export function readAmount(text) {
  const typed = text.trim();
  if (typed === '') return { value: null, problem: 'amount-empty' };

  const parts = /^(\d+)(?:[.,](\d{1,8}))?$/.exec(typed);
  if (!parts) return { value: null, problem: 'amount-unreadable' };

  const value = Number(parts[1]) * SATOSHIS + Number((parts[2] ?? '').padEnd(8, '0'));
  return value > MAX_MONEY ? { value: null, problem: 'amount-too-large' } : { value, problem: null };
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
// signatureOf
// -----------------------------------------------------------
//
// A key's signature over a message, made once and then
// remembered: the same key signing the same message always
// gives the same bytes, and the curve arithmetic behind them
// takes milliseconds a change should not wait for.
//
// Used by:
//   - buildModel, signEveryone (below)
// -----------------------------------------------------------

function signatureOf(privateKey, digest) {
  const key = `${privateKey}:${digest}`;
  if (!SIGNED.has(key)) {
    if (SIGNED.size >= SIGNED_LIMIT) SIGNED.delete(SIGNED.keys().next().value);
    SIGNED.set(key, signWith(privateKey, digest));
  }
  return SIGNED.get(key);
}







// -----------------------------------------------------------
// signEveryone
// -----------------------------------------------------------
//
// Every key pair's signature over one message, by the pair's
// number — what is put aside when signing is switched from
// "always fresh" to "frozen as it is now".
//
// Used by:
//   - hooks/usePlayground.js — the freeze
// -----------------------------------------------------------

export const signEveryone = (keys, digest) => Object.fromEntries(keys.map((key) => [key.id, signatureOf(key.privateKey, digest)]));







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
// buildModel
// -----------------------------------------------------------
//
// Everything the page shows, from the state (see the file
// header for the order and why). Hands back the key pairs
// with all that follows from their private keys; both
// transactions — their parts, bytes and ids; the message B's
// signatures sign and whether the signatures B carries still
// sign it; a lexicon that names what is worth naming — a
// key pair by its number, and a run of bytes by what it is:
// someone's public key, its hash, a signature, the redeem
// script and its hash, a hash made on the shelf, or simply
// the number, text or bytes somebody wrote; the list of what
// cannot be read; and the node's verification, or none while
// that list is not empty.
//
// Used by:
//   - hooks/usePlayground.js — once per change of the state
// -----------------------------------------------------------

export function buildModel(state) {
  const keys = state.keys.map((key) => ({ ...key, ...keyFrom(key.privateKey) }));
  const numbers = keys.map((key) => String(key.id));
  const read = (text) => parseScript(text, numbers);
  const known = {
    publicKeys: Object.fromEntries(keys.map((key) => [key.id, key.publicKey])),
    publicKeyHashes: Object.fromEntries(keys.map((key) => [key.id, key.publicKeyHash])),
  };

  // The redeem script comes first: a lock may name its hash
  const redeemWritten = state.redeem.trim() !== '';
  const redeem = fill(state.redeem, read(state.redeem), known);
  const redeemHex = redeemWritten && redeem.problems.length === 0 ? redeem.hex : null;
  const scriptHash = redeemHex === null ? null : hash160(redeemHex);
  const withRedeem = { ...known, redeemScript: redeemHex, scriptHash };

  // Transaction A: its outputs, its bytes, its id
  const outputs = state.outputs.map((output, index) => {
    const script = fill(output.lock, read(output.lock), withRedeem);
    return { id: output.id, index, amount: readAmount(output.amount), script, lock: describeLock(script.hex) };
  });
  const a = {
    version: 2,
    inputs: [{ txid: PREVIOUS_ID, vout: 0, script: '', sequence: FINAL_SEQUENCE }],
    outputs: outputs.map((output) => ({ value: output.amount.value ?? 0, script: output.script.hex })),
    lockTime: 0,
  };
  const aId = transactionId(a);
  const coin = outputs[state.spent];

  // Transaction B without its unlocking script — what is signed
  const lockTime = readWhole(state.lockTime, LOCKTIME_THRESHOLD - 1);
  const height = readWhole(state.height, LOCKTIME_THRESHOLD - 1);
  const payments = state.payments.map((payment, index) => {
    const script = fill(payTo(payment.to), read(payTo(payment.to)), known);
    return {
      id: payment.id,
      index,
      to: payment.to,
      key: keys.find((key) => key.id === payment.to) ?? null,
      amount: readAmount(payment.amount),
      script,
      lock: describeLock(script.hex),
    };
  });
  const unsigned = {
    version: 2,
    inputs: [{ txid: aId, vout: coin.index, script: '', sequence: lockTime.value > 0 ? FINAL_SEQUENCE - 1 : FINAL_SEQUENCE }],
    outputs: payments.map((payment) => ({ value: payment.amount.value ?? 0, script: payment.script.hex })),
    lockTime: lockTime.value ?? 0,
  };

  // A signature covers the script it has to satisfy: the lock
  // itself, or — when the lock only names a script's hash —
  // that script
  const signsRedeem = PAY_TO_SCRIPT_HASH.test(coin.script.hex) && redeemHex !== null;
  const digest = signatureHash(unsigned, 0, signsRedeem ? redeemHex : coin.script.hex);

  const unlockRead = read(state.unlock);
  const signers = [...new Set(unlockRead.items.filter((item) => item.ref?.what === 'sig').map((item) => item.ref.who))];
  const fresh = Object.fromEntries(signers.map((number) => [number, signatureOf(keys.find((key) => String(key.id) === number).privateKey, digest)]));
  const signatures = Object.fromEntries(signers.map((number) => [number, state.frozen?.[number] ?? fresh[number]]));
  const stale = signers.filter((number) => signatures[number] !== fresh[number]);

  const unlock = fill(state.unlock, unlockRead, { ...withRedeem, signatures });
  const b = { ...unsigned, inputs: [{ ...unsigned.inputs[0], script: unlock.hex }] };

  // What a key pair's number, and a run of bytes, stand for.
  // First what the scripts and the shelf spell out, each the
  // way it was written — a text stays a text and bytes stay
  // bytes wherever they turn up, on the stack too. The pieces
  // of a key pair go in last: bytes that are someone's key are
  // called that, whatever else they match
  const lexicon = { keys: new Map(keys.map((key) => [String(key.id), key])), values: new Map() };
  const written = [...outputs.flatMap((output) => output.script.items), ...unlock.items, ...redeem.items, ...state.data.flatMap((piece) => read(piece.word).items)];
  for (const item of written) {
    if (item.literal && item.hex !== '') lexicon.values.set(item.hex, { what: item.literal });
  }
  for (const piece of state.data) {
    if (piece.made) lexicon.values.set(piece.word.slice(2), { what: 'hash', ...piece.made });
  }
  if (redeemHex !== null) {
    lexicon.values.set(redeemHex, { what: 'redeemScript' });
    lexicon.values.set(scriptHash, { what: 'scriptHash' });
  }
  for (const key of keys) {
    const number = String(key.id);
    lexicon.values.set(key.publicKey, { what: 'pubkey', who: number });
    lexicon.values.set(key.publicKeyHash, { what: 'pubkeyhash', who: number });
    if (signers.includes(number)) lexicon.values.set(signatures[number], { what: 'sig', who: number, stale: stale.includes(number) });
  }

  const problems = [
    ...outputs.flatMap((output) => [
      ...(output.amount.problem ? [{ where: 'output-amount', index: output.index, code: output.amount.problem }] : []),
      ...output.script.problems.map((problem) => ({ where: 'lock', index: output.index, ...problem })),
    ]),
    ...unlock.problems.map((problem) => ({ where: 'unlock', ...problem })),
    ...(redeemWritten ? redeem.problems.map((problem) => ({ where: 'redeem', ...problem })) : []),
    ...payments.flatMap((payment) => [
      ...(payment.amount.problem ? [{ where: 'payment-amount', index: payment.index, code: payment.amount.problem }] : []),
      ...(payment.key ? [] : [{ where: 'payment-key', index: payment.index, code: 'unknown-key' }]),
    ]),
    ...(lockTime.problem ? [{ where: 'lock-time', code: lockTime.problem }] : []),
    ...(height.problem ? [{ where: 'height', code: height.problem }] : []),
  ];

  const paid = payments.reduce((sum, payment) => sum + (payment.amount.value ?? 0), 0);
  const verification = problems.length > 0 ? null : verifySpend({
    transaction: b,
    coin: { found: true, spent: state.coinSpent, value: coin.amount.value, lock: { items: coin.script.items, hex: coin.script.hex } },
    unlock: { items: unlock.items, hex: unlock.hex },
    height: height.value,
  });

  return {
    keys,
    a: { id: aId, hex: serializeTransaction(a), outputs },
    b: {
      id: transactionId(b),
      hex: serializeTransaction(b),
      spends: coin,
      unlock,
      redeem: { ...redeem, written: redeemWritten, hex: redeemHex },
      payments,
      paid,
      fee: coin.amount.value === null ? null : coin.amount.value - paid,
      lockTime,
      sequence: unsigned.inputs[0].sequence,
    },
    signing: { digest, covers: signsRedeem ? 'redeem' : 'lock', signers, stale, frozen: state.frozen !== null },
    height,
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
// moves to the first one when its own coin goes. Loading
// replaces everything.
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
      const frozen = state.frozen && Object.fromEntries(Object.entries(state.frozen).filter(([number]) => number !== String(action.id)));
      return { ...state, keys, frozen, payments: state.payments.map((payment) => (payment.to === action.id ? { ...payment, to: keys[0].id } : payment)) };
    }

    case 'data/add': {
      if (state.data.some((piece) => piece.word === action.word)) return state;
      const data = [...state.data, { id: state.nextId, word: action.word, made: action.made ?? null }].slice(-LIMITS.DATA);
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
    case 'height':
      return { ...state, height: action.text };
    case 'freeze':
      return { ...state, frozen: action.signatures };
    case 'thaw':
      return { ...state, frozen: null };
    case 'coin-spent':
      return { ...state, coinSpent: action.value };

    default:
      return state;
  }
}

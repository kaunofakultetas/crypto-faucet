// -----------------------------------------------------------
//  [*] BitcoinScript — a script as text, as items, as bytes
//
//  A script lives in three forms here, and this file moves it
//  between them.
//
//  What a student types is text: opcode names, with or without
//  the OP_; whole numbers; bytes behind 0x; words in quotes;
//  and references in angle brackets to things the playground
//  works out itself — a person's public key, that key's hash,
//  a person's signature of the spending transaction, the
//  redeem script and its hash, and their counterparts in the
//  newer kinds of lock: the witness script and its hash, a
//  person's 32-byte key and the Taproot output key made from
//  it, the two scripts of the Taproot tree and the control
//  block that proves each. Reading the text gives a list
//  of items, each either an opcode or a push of some bytes,
//  and a list of what could not be read, by where it stands
//  in the text.
//
//  A reference is a push whose bytes are not known yet. They
//  are filled in afterwards (resolveScript), because some of
//  them depend on the rest of the page: a signature signs the
//  spending transaction, which holds the very script being
//  written. A signature is therefore only allowed where the
//  caller hands signatures over — in a script that unlocks.
//
//  Items become the bytes a transaction carries, each push
//  with the shortest length marker that fits, and a run of
//  bytes — a redeem script taken off the stack — is read back
//  into items the same way a node reads it.
//
//  Numbers follow Script's own rules: lowest byte first, the
//  sign in the top bit of the last byte, no byte more than
//  needed — so zero is no bytes at all, and "true" is any
//  bytes that are not a zero.
//
//  Problems are reported as codes with the pieces a sentence
//  needs; the Lithuanian sentences live with the page's other
//  words (narration.js).
//
//  Split into:
//
//    WORD, REFERENCE, KINDS — how the text is cut and read
//    UNFILLED       — why a reference has no bytes, as a code
//    NUMBER_LIMIT   — the largest number a script may hold
//    PAY_TO_SCRIPT_HASH — the one lock a node reads twice
//    witnessProgramOf — a lock that is a witness program
//    wordsOf        — a typed script cut into its words
//    numberHex      — a number as Script writes it
//    numberOf       — a number as Script reads it
//    isTrue         — whether bytes count as true
//    pushOf         — the bytes that push some bytes
//    parseScript    — text to items and problems
//    resolveScript  — references filled in
//    serializeScript — items to bytes
//    readScript     — bytes back to items
//    withoutPush    — a script with one push taken out
//    withoutSeparators — a script without its separators
//    isPushOnly     — whether a script only puts data down
//    describeLock   — which well-known lock a script is
// -----------------------------------------------------------

import { bytesOf, byteLength, hexOf, isHex, textToHex, uintLE } from './bytes';
import { opcodeAt, opcodeNamed } from './opcodes';


// One word of a typed script: a text in double or single
// quotes, a reference in angle brackets, or anything else up
// to the next space
const WORD = /"[^"]*"|'[^']*'|<[^<>]*>|\S+/g;

// A reference's inside: what is meant, and whose
const REFERENCE = /^<\s*([a-z]+)\s*(?::\s*([^\s:]+)\s*)?>$/i;

// What a reference may ask for, by its lower-case word: the
// name it is written under, and whether it belongs to a person
const KINDS = {
  sig: { what: 'sig', personal: true },
  pubkey: { what: 'pubkey', personal: true },
  pubkeyhash: { what: 'pubkeyhash', personal: true },
  xonly: { what: 'xonly', personal: true },
  tapkey: { what: 'tapkey', personal: true },
  redeemscript: { what: 'redeemScript', personal: false },
  scripthash: { what: 'scriptHash', personal: false },
  witnessscript: { what: 'witnessScript', personal: false },
  witnesshash: { what: 'witnessHash', personal: false },
  leafa: { what: 'leafA', personal: false },
  leafb: { what: 'leafB', personal: false },
  controla: { what: 'controlA', personal: false },
  controlb: { what: 'controlB', personal: false },
};

// The code a reference gets when its bytes cannot be had, by
// what it refers to
const UNFILLED = {
  sig: 'signature-outside-unlock',
  redeemScript: 'no-redeem-script',
  scriptHash: 'no-redeem-script',
  witnessScript: 'no-witness-script',
  witnessHash: 'no-witness-script',
  leafA: 'no-leaf',
  leafB: 'no-leaf',
  controlA: 'no-control-block',
  controlB: 'no-control-block',
  tapkey: 'no-taproot-key',
  xonly: 'no-taproot-key',
};

// The opcodes whose only job is to announce a push — never
// typed: the data is typed, and the announcement follows
const PUSH_WORDS = /^(OP_)?PUSHDATA[124]$/i;







// -----------------------------------------------------------
// NUMBER_LIMIT
// -----------------------------------------------------------
//
// The largest whole number, either side of zero, a typed
// script may contain: what five bytes hold. Arithmetic only
// takes four, a lock time takes the fifth.
//
// Used by:
//   - parseScript (below)
//   - tiles.js — a number typed as a piece of data
// -----------------------------------------------------------

export const NUMBER_LIMIT = 2 ** 39 - 1;







// -----------------------------------------------------------
// PAY_TO_SCRIPT_HASH
// -----------------------------------------------------------
//
// The exact bytes of a pay-to-script-hash lock: hash the top
// of the stack, compare with these twenty bytes. A node that
// sees this shape goes on to run the script that was hashed.
//
// Used by:
//   - interpreter.js — the second run
//   - describeLock (below)
// -----------------------------------------------------------

export const PAY_TO_SCRIPT_HASH = /^a914([0-9a-f]{40})87$/;







// -----------------------------------------------------------
// witnessProgramOf
// -----------------------------------------------------------
//
// Whether a script is a witness program, and which: a version
// — zero, or one to sixteen — followed by ONE push of two to
// forty bytes and nothing else. A script of that shape is not
// run for what it says; a node reads the version and the
// bytes and goes to the witness. Hands back both, or nothing.
//
// Used by:
//   - interpreter.js — a lock, or a redeem script, that hands
//     the spend over to the witness
//   - describeLock (below)
//   - model.js — which kind of signature a spend needs
// -----------------------------------------------------------

export function witnessProgramOf(hex) {
  const shape = /^(00|5[1-9a-f]|60)([0-9a-f]{2})((?:[0-9a-f]{2})*)$/.exec(hex);
  if (!shape) return null;

  const size = parseInt(shape[2], 16);
  if (size < 2 || size > 40 || shape[3].length !== size * 2) return null;
  return { version: shape[1] === '00' ? 0 : parseInt(shape[1], 16) - 0x50, program: shape[3] };
}







// -----------------------------------------------------------
// wordsOf
// -----------------------------------------------------------
//
// A typed script cut into its words, each with where it
// stands in the text: a quoted text and a reference in angle
// brackets are one word whatever spaces they hold, everything
// else ends at the next space. Nothing is judged here — a
// word no script knows is still a word.
//
// Used by:
//   - parseScript (below)
//   - model.js — a script's words, read or not
//   - tiles.js — putting a word in, taking one out
//   - hooks/useTileDrag.js — the end of a row
// -----------------------------------------------------------

export const wordsOf = (text) => [...text.matchAll(WORD)].map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }));







// -----------------------------------------------------------
// numberHex
// -----------------------------------------------------------
//
// A whole number as Script keeps it on the stack: its size
// lowest byte first, the sign in the top bit of the last
// byte, and a further byte for the sign alone when that bit
// is already taken by the size. Zero is no bytes.
//
// Used by:
//   - parseScript (below) — a typed number
//   - interpreter.js — every result of the arithmetic
//   - tiles.js — the bytes a typed number is hashed as
// -----------------------------------------------------------

export function numberHex(value) {
  const bytes = [];
  for (let rest = BigInt(Math.abs(value)); rest > 0n; rest >>= 8n) bytes.push(Number(rest & 0xffn));
  if (bytes.length === 0) return '';

  if (bytes.at(-1) & 0x80) bytes.push(value < 0 ? 0x80 : 0x00);
  else if (value < 0) bytes[bytes.length - 1] |= 0x80;
  return hexOf(bytes);
}







// -----------------------------------------------------------
// numberOf
// -----------------------------------------------------------
//
// The whole number some bytes stand for, or nothing when they
// are longer than the opcode asking will take — four bytes
// for arithmetic. A "negative zero" is zero.
//
// Used by:
//   - interpreter.js — every opcode that takes a number
//   - narration.js — a value shown as the number it holds
// -----------------------------------------------------------

export function numberOf(hex, maxBytes = 4) {
  const bytes = bytesOf(hex);
  if (bytes.length > maxBytes) return null;

  let size = 0n;
  bytes.forEach((byte, index) => {
    size |= BigInt(index === bytes.length - 1 ? byte & 0x7f : byte) << BigInt(8 * index);
  });
  const negative = bytes.length > 0 && Boolean(bytes.at(-1) & 0x80);
  return negative && size !== 0n ? -Number(size) : Number(size);
}







// -----------------------------------------------------------
// isTrue
// -----------------------------------------------------------
//
// Whether bytes count as true: any byte that is not zero —
// except a lone sign bit in the last byte, which is only a
// zero with a minus in front.
//
// Used by:
//   - interpreter.js — OP_IF, OP_VERIFY, and the last look at
//     the top of the stack
//   - narration.js — a number that counts as false
// -----------------------------------------------------------

export const isTrue = (hex) => bytesOf(hex).some((byte, index, all) => byte !== 0 && !(index === all.length - 1 && byte === 0x80));







// -----------------------------------------------------------
// pushOf
// -----------------------------------------------------------
//
// The bytes of a script that put some bytes on the stack: the
// data behind the shortest announcement of its length — the
// length itself up to 75 bytes, a marker and a wider length
// above that. No bytes at all are pushed by the opcode for
// zero.
//
// Used by:
//   - serializeScript (below)
// -----------------------------------------------------------

export function pushOf(hex) {
  const length = byteLength(hex);
  if (length === 0) return '00';
  if (length <= 75) return `${uintLE(length, 1)}${hex}`;
  if (length <= 0xff) return `4c${uintLE(length, 1)}${hex}`;
  if (length <= 0xffff) return `4d${uintLE(length, 2)}${hex}`;
  return `4e${uintLE(length, 4)}${hex}`;
}







// -----------------------------------------------------------
// parseScript
// -----------------------------------------------------------
//
// Reads a typed script into its items, word by word, and
// lists what it could not read. An item is an opcode or a
// push; a push holds its bytes, or — for a reference — what
// it refers to, the bytes still to come. The numbers Script
// has an opcode for, from minus one to sixteen, become that
// opcode, as a wallet would write them. Every item and every
// problem remembers where in the text it stands. `people` are
// the names a reference may name, as they are spelled.
//
// Used by:
//   - model.js — every script on the page
// -----------------------------------------------------------

export function parseScript(text, people = []) {
  const items = [];
  const problems = [];

  for (const place of wordsOf(text)) {
    const word = place.text;
    const fail = (code, details = {}) => problems.push({ code, ...details, ...place });

    if (word[0] === '"' || word[0] === "'") {
      if (word.length < 2 || word.at(-1) !== word[0]) fail('open-quote');
      else items.push({ type: 'push', literal: 'text', hex: textToHex(word.slice(1, -1)), ...place });
    } else if (word[0] === '<') {
      const reference = REFERENCE.exec(word);
      const kind = reference && KINDS[reference[1].toLowerCase()];
      const who = reference?.[2] && people.find((name) => name.toLowerCase() === reference[2].toLowerCase());

      if (word.at(-1) !== '>') fail('open-reference');
      else if (!kind) fail('unknown-reference');
      else if (kind.personal && !reference[2]) fail('reference-needs-name', { what: kind.what });
      else if (kind.personal && !who) fail('unknown-person', { name: reference[2] });
      else items.push({ type: 'push', hex: null, ref: kind.personal ? { what: kind.what, who } : { what: kind.what }, ...place });
    } else if (/^0x/i.test(word)) {
      if (!isHex(word.slice(2))) fail('bad-hex');
      else items.push({ type: 'push', literal: 'hex', hex: word.slice(2).toLowerCase(), ...place });
    } else if (/^-?\d+$/.test(word)) {
      const value = Number(word);
      if (Math.abs(value) > NUMBER_LIMIT) fail('number-too-large');
      else if (value >= -1 && value <= 16) items.push({ type: 'op', opcode: opcodeNamed(value === -1 ? 'OP_1NEGATE' : `OP_${value}`), ...place });
      else items.push({ type: 'push', literal: 'number', hex: numberHex(value), ...place });
    } else if (PUSH_WORDS.test(word)) {
      fail('pushdata-word');
    } else {
      const opcode = opcodeNamed(word);
      if (opcode) items.push({ type: 'op', opcode, ...place });
      else fail('unknown-word');
    }
  }

  return { items, problems };
}







// -----------------------------------------------------------
// resolveScript
// -----------------------------------------------------------
//
// Fills in the bytes of every reference from the values the
// page has worked out — public keys, their hashes, 32-byte
// keys and Taproot output keys by name, the redeem script and
// the witness script with their hashes, the Taproot tree's
// scripts and control blocks — and lists the references it
// could not fill: a signature where none can be made, a
// script nobody wrote, a proof for a tree that has no lock.
// A signature is not looked up by name but by the place of
// its word in the text: what a signature signs depends on
// where it stands, so the same key pair's two signatures in
// one script may differ. Items that are not references pass
// through as they are.
//
// Used by:
//   - model.js — every script on the page
// -----------------------------------------------------------

export function resolveScript(items, values) {
  const problems = [];

  const bytesFor = ({ what, who }, start) => {
    if (what === 'pubkey') return values.publicKeys?.[who] ?? null;
    if (what === 'pubkeyhash') return values.publicKeyHashes?.[who] ?? null;
    if (what === 'xonly') return values.xOnlyKeys?.[who] ?? null;
    if (what === 'tapkey') return values.outputKeys?.[who] ?? null;
    if (what === 'sig') return values.signatures?.[start] ?? null;
    if (what === 'leafA' || what === 'leafB') return values.leaves?.[what === 'leafA' ? 0 : 1] ?? null;
    if (what === 'controlA' || what === 'controlB') return values.controls?.[what === 'controlA' ? 0 : 1] ?? null;
    return values[what] ?? null;
  };

  const resolved = items.map((item) => {
    if (!item.ref) return item;

    const hex = bytesFor(item.ref, item.start);
    if (hex === null) problems.push({ code: UNFILLED[item.ref.what], text: item.text, start: item.start, end: item.end });
    return { ...item, hex };
  });

  return { items: resolved, problems };
}







// -----------------------------------------------------------
// serializeScript
// -----------------------------------------------------------
//
// The bytes of a list of items, as a transaction carries a
// script: an opcode is its byte, a push is its announcement
// and its data.
//
// Used by:
//   - model.js — every script that goes into a transaction
//   - interpreter.js — a script's size
// -----------------------------------------------------------

export const serializeScript = (items) => items.map((item) => (item.type === 'op' ? uintLE(item.opcode.code, 1) : pushOf(item.hex))).join('');







// -----------------------------------------------------------
// readScript
// -----------------------------------------------------------
//
// A script's bytes read back into items — what a node does
// with the redeem script it takes off the stack. A byte no
// opcode was given becomes a nameless opcode that fails when
// it is reached, as it does in a node. A push that announces
// more bytes than the script has left ends the reading, and
// the answer says so: such a script is broken. Every item
// remembers the byte it ends at.
//
// Used by:
//   - interpreter.js — a script that arrives as bytes: a
//     redeem script, a witness script, a Taproot leaf
//   - withoutPush, withoutSeparators, describeLock (below)
// -----------------------------------------------------------

export function readScript(hex) {
  const bytes = bytesOf(hex);
  const items = [];
  let at = 0;

  while (at < bytes.length) {
    const code = bytes[at];
    at += 1;

    if (code >= 0x01 && code <= 0x4e) {
      const widths = { 0x4c: 1, 0x4d: 2, 0x4e: 4 };
      const width = widths[code] ?? 0;
      if (at + width > bytes.length) return { items, broken: true };

      const length = width === 0 ? code : bytes.slice(at, at + width).reduce((sum, byte, index) => sum + byte * 256 ** index, 0);
      at += width;
      if (at + length > bytes.length) return { items, broken: true };

      const data = hex.slice(2 * at, 2 * (at + length));
      at += length;
      items.push({ type: 'push', literal: 'hex', hex: data, text: `0x${data}`, until: at });
    } else {
      const opcode = opcodeAt(code) ?? { name: `0x${uintLE(code, 1)}`, code, state: 'reserved', about: '' };
      items.push({ type: 'op', opcode, text: opcode.name, until: at });
    }
  }

  return { items, broken: false };
}







// -----------------------------------------------------------
// withoutPush
// -----------------------------------------------------------
//
// A script's bytes with every push of some bytes taken out —
// what the original rules do to a script before a signature
// found in it is checked against it: a signature cannot sign
// itself. Only a push that stands where an item begins is
// taken; the same bytes inside another item's data stay. A
// script that cannot be read to its end keeps its unread
// tail.
//
// Used by:
//   - interpreter.js — the script a signature is checked
//     against, under the original rules
// -----------------------------------------------------------

export function withoutPush(hex, dataHex) {
  const push = pushOf(dataHex);
  const next = new Map();
  let begins = 0;
  for (const item of readScript(hex).items) {
    next.set(begins, item.until * 2);
    begins = item.until * 2;
  }

  let kept = '';
  let from = 0;
  let at = 0;
  for (;;) {
    kept += hex.slice(from, at);
    while (hex.startsWith(push, at)) at += push.length;
    from = at;
    if (!next.has(at)) break;
    at = next.get(at);
  }
  return kept + hex.slice(from);
}







// -----------------------------------------------------------
// withoutSeparators
// -----------------------------------------------------------
//
// A script's bytes without its OP_CODESEPARATOR opcodes — the
// form the original rules hash a script in. A script that
// cannot be read to its end keeps its unread tail.
//
// Used by:
//   - node.js — the script inside the message a signature
//     signs, under the original rules
// -----------------------------------------------------------

export function withoutSeparators(hex) {
  let kept = '';
  let from = 0;

  for (const item of readScript(hex).items) {
    if (item.type === 'op' && item.opcode.code === 0xab) {
      kept += hex.slice(from, item.until * 2 - 2);
      from = item.until * 2;
    }
  }
  return kept + hex.slice(from);
}







// -----------------------------------------------------------
// isPushOnly
// -----------------------------------------------------------
//
// Whether a script does nothing but put data on the stack —
// pushes and the number opcodes. A node insists on that for
// the script that unlocks a pay-to-script-hash coin.
//
// Used by:
//   - interpreter.js — before the redeem script is run
// -----------------------------------------------------------

export const isPushOnly = (items) => items.every((item) => item.type === 'push' || item.opcode.code <= 0x60);







// -----------------------------------------------------------
// describeLock
// -----------------------------------------------------------
//
// Which of the well-known locks a locking script is, with
// the pieces that make it that one: pay to a public key, pay
// to a public key's hash, pay to a script's hash, a bare
// m-of-n multisig, data that can never be spent, an empty
// script; the witness programs — to a key's hash, to a
// script's hash, to a Taproot key, the anchor anybody may
// spend, and one of a version nobody has given rules yet —
// or none of them, a lock of the student's own.
//
// Used by:
//   - model.js — the label on an output
// -----------------------------------------------------------

export function describeLock(hex) {
  if (hex === '') return { kind: 'empty' };

  const witness = witnessProgramOf(hex);
  if (witness?.version === 0 && witness.program.length === 40) return { kind: 'p2wpkh', hash: witness.program };
  if (witness?.version === 0 && witness.program.length === 64) return { kind: 'p2wsh', hash: witness.program };
  if (witness?.version === 1 && witness.program.length === 64) return { kind: 'p2tr', key: witness.program };
  if (witness?.version === 1 && witness.program === '4e73') return { kind: 'anchor' };
  if (witness) return { kind: 'witness', version: witness.version, program: witness.program };

  const keyHash = /^76a914([0-9a-f]{40})88ac$/.exec(hex);
  if (keyHash) return { kind: 'p2pkh', hash: keyHash[1] };

  const key = /^(?:21(0[23][0-9a-f]{64})|41(04[0-9a-f]{128}))ac$/.exec(hex);
  if (key) return { kind: 'p2pk', publicKey: key[1] ?? key[2] };

  const scriptHash = PAY_TO_SCRIPT_HASH.exec(hex);
  if (scriptHash) return { kind: 'p2sh', hash: scriptHash[1] };

  if (hex.startsWith('6a')) return { kind: 'data' };

  const { items, broken } = readScript(hex);
  const count = (item) => (item?.type === 'op' && item.opcode.code >= 0x51 && item.opcode.code <= 0x60 ? item.opcode.code - 0x50 : null);
  const keys = items.slice(1, -2);
  const required = count(items[0]);
  const total = count(items.at(-2));
  const isMultisig = !broken && items.length >= 4 && items.at(-1).opcode?.name === 'OP_CHECKMULTISIG'
    && required !== null && total === keys.length && required <= total
    && keys.every((item) => item.type === 'push' && [33, 65].includes(byteLength(item.hex)));
  if (isMultisig) return { kind: 'multisig', required, total, publicKeys: keys.map((item) => item.hex) };

  return { kind: 'custom' };
}

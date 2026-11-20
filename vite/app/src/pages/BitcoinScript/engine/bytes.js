// -----------------------------------------------------------
//  [*] BitcoinScript — bytes as hex text
//
//  Everything the playground's engine handles — keys, hashes,
//  signatures, scripts, whole transactions — is a run of
//  bytes, and here a run of bytes is always a lowercase hex
//  string. A string can be shown to a student as it is,
//  compared with ===, cut with slice and joined with +, and
//  never changes under the code that holds it; the price is
//  that every length is counted in pairs of digits.
//
//  The helpers below are the few conversions the rest of the
//  engine needs: text to bytes and back, a byte order turned
//  round, and the two ways Bitcoin writes a whole number into
//  a transaction — at a fixed width with the lowest byte
//  first, and as the compact size in front of every list and
//  every script.
//
//  Used by:
//    - every other file under engine/
//    - the page's components, for what they show of a value
// -----------------------------------------------------------







// -----------------------------------------------------------
// isHex
// -----------------------------------------------------------
//
// Whether a text is a run of whole bytes written in hex —
// digits in pairs, in either letter case; the empty text is
// the empty run.
//
// Used by:
//   - script.js — a typed 0x… literal
// -----------------------------------------------------------

export const isHex = (text) => typeof text === 'string' && text.length % 2 === 0 && /^[0-9a-f]*$/i.test(text);







// -----------------------------------------------------------
// byteLength
// -----------------------------------------------------------
//
// How many bytes a hex string holds.
//
// Used by:
//   - script.js, interpreter.js, transaction.js — every
//     length written in front of a run of bytes, and every
//     limit a script must keep
// -----------------------------------------------------------

export const byteLength = (hex) => hex.length / 2;







// -----------------------------------------------------------
// bytesOf
// -----------------------------------------------------------
//
// The bytes of a hex string as numbers, in order.
//
// Used by:
//   - secp256k1.js — reading a signature's encoding
//   - script.js — reading a script byte by byte
//   - hexToText (below)
// -----------------------------------------------------------

export const bytesOf = (hex) => (hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16));







// -----------------------------------------------------------
// hexOf
// -----------------------------------------------------------
//
// The hex string of a run of byte values — bytesOf, back.
//
// Used by:
//   - textToHex (below)
//   - script.js — a script number's bytes
// -----------------------------------------------------------

export const hexOf = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');







// -----------------------------------------------------------
// reverseBytes
// -----------------------------------------------------------
//
// The same bytes in the opposite order. A transaction's id
// is shown to people back to front from how it sits inside
// the next transaction's input.
//
// Used by:
//   - transaction.js — an id as shown, an id as serialized
// -----------------------------------------------------------

export const reverseBytes = (hex) => (hex.match(/../g) ?? []).reverse().join('');







// -----------------------------------------------------------
// textToHex
// -----------------------------------------------------------
//
// A text as its UTF-8 bytes — how a word typed in quotes goes
// onto the stack.
//
// Used by:
//   - script.js — a quoted literal
//   - secp256k1.js — a persona's key, made from a sentence
// -----------------------------------------------------------

export const textToHex = (text) => hexOf(new TextEncoder().encode(text));







// -----------------------------------------------------------
// hexToText
// -----------------------------------------------------------
//
// The text a run of bytes spells, when it spells one: valid
// UTF-8 with nothing in it a screen cannot show. Anything
// else — a hash, a key, a number — is no text, and the answer
// is nothing, so the caller shows the bytes instead.
//
// Used by:
//   - the page's value labels — a pushed word is shown as the
//     word
// -----------------------------------------------------------

export function hexToText(hex) {
  if (hex.length === 0) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytesOf(hex)));
    return /^[^\p{Cc}\p{Cn}\p{Co}\p{Cs}]+$/u.test(text) ? text : null;
  } catch {
    return null;
  }
}







// -----------------------------------------------------------
// uintLE
// -----------------------------------------------------------
//
// A whole number at a fixed width, lowest byte first — the
// way a transaction writes its version, its amounts, its
// output indexes and its lock time. The number may be a
// BigInt: an amount in satoshis takes eight bytes.
//
// Used by:
//   - transaction.js — every fixed-width field
//   - compactSize (below)
// -----------------------------------------------------------

export function uintLE(value, width) {
  let rest = BigInt(value);
  let hex = '';
  for (let i = 0; i < width; i += 1) {
    hex += (rest & 0xffn).toString(16).padStart(2, '0');
    rest >>= 8n;
  }
  return hex;
}







// -----------------------------------------------------------
// compactSize
// -----------------------------------------------------------
//
// A count or a length the way a transaction writes it in
// front of a list or a script: one byte while it fits, a
// marker byte and a wider number when it does not.
//
// Used by:
//   - transaction.js — the input and output counts, and the
//     length in front of every script
// -----------------------------------------------------------

export function compactSize(count) {
  if (count < 0xfd) return uintLE(count, 1);
  if (count <= 0xffff) return `fd${uintLE(count, 2)}`;
  if (count <= 0xffffffff) return `fe${uintLE(count, 4)}`;
  return `ff${uintLE(count, 8)}`;
}

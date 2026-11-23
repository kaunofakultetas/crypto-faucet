// -----------------------------------------------------------
//  [*] BitcoinScript — the hash functions of Bitcoin Script
//
//  The five hashes a script can ask for, each over a run of
//  bytes given as hex and answered as hex: SHA-1, SHA-256 and
//  RIPEMD-160 on their own, and the two Bitcoin builds from
//  them — HASH160 (RIPEMD-160 of the SHA-256, which is what
//  an address is made of) and HASH256 (SHA-256 twice, which
//  is what a transaction's id and a signature's message are).
//  HMAC-SHA-256 is here for the signing code alone: the
//  number a signature is made with is derived from the key
//  and the message with it, so signing the same thing twice
//  gives the same signature.
//
//  Taproot hashes with SHA-256 too, but never bare: every
//  hash it takes starts with the name of what is being hashed
//  (taggedHash), so that a hash made for one purpose can
//  never be passed off as a hash made for another.
//
//  The work is crypto-js's, one module per function — the
//  same library the block simulator hashes with — because
//  everything on this page is computed while the student
//  types, and the browser's own hashing only answers later.
//
//  Used by:
//    - secp256k1.js — the deterministic signing nonce, the
//      hashes inside a Schnorr signature
//    - transaction.js — ids and signature hashes
//    - interpreter.js — the hashing opcodes
//    - script.js — a script's hash, a key's hash
//    - taproot.js — the hashes of a tree of scripts
// -----------------------------------------------------------

import sha1 from 'crypto-js/sha1';
import sha256 from 'crypto-js/sha256';
import ripemd160 from 'crypto-js/ripemd160';
import hmacSha256 from 'crypto-js/hmac-sha256';
import Hex from 'crypto-js/enc-hex';







// -----------------------------------------------------------
// sha1Hex
// -----------------------------------------------------------
//
// SHA-1 of the bytes — broken for anything that matters, and
// still an opcode.
//
// Used by:
//   - interpreter.js — OP_SHA1
// -----------------------------------------------------------

export const sha1Hex = (hex) => sha1(Hex.parse(hex)).toString(Hex);







// -----------------------------------------------------------
// sha256Hex
// -----------------------------------------------------------
//
// SHA-256 of the bytes.
//
// Used by:
//   - interpreter.js — OP_SHA256
//   - secp256k1.js — a persona's private key
//   - hash160, hash256 (below)
// -----------------------------------------------------------

export const sha256Hex = (hex) => sha256(Hex.parse(hex)).toString(Hex);







// -----------------------------------------------------------
// ripemd160Hex
// -----------------------------------------------------------
//
// RIPEMD-160 of the bytes.
//
// Used by:
//   - interpreter.js — OP_RIPEMD160
//   - hash160 (below)
// -----------------------------------------------------------

export const ripemd160Hex = (hex) => ripemd160(Hex.parse(hex)).toString(Hex);







// -----------------------------------------------------------
// hash160
// -----------------------------------------------------------
//
// RIPEMD-160 of the SHA-256 of the bytes: twenty bytes that
// stand for a public key in an address, and for a whole
// script in a pay-to-script-hash output.
//
// Used by:
//   - interpreter.js — OP_HASH160
//   - script.js — what <pubkeyhash:…> and <scriptHash> put
//     into a script
//   - secp256k1.js — a persona's address
// -----------------------------------------------------------

export const hash160 = (hex) => ripemd160Hex(sha256Hex(hex));







// -----------------------------------------------------------
// hash256
// -----------------------------------------------------------
//
// SHA-256 of the SHA-256 of the bytes — Bitcoin's hash for
// everything it identifies or signs.
//
// Used by:
//   - interpreter.js — OP_HASH256
//   - transaction.js — a transaction's id, the message a
//     signature is made over
//   - secp256k1.js — an address's check digits
// -----------------------------------------------------------

export const hash256 = (hex) => sha256Hex(sha256Hex(hex));







// -----------------------------------------------------------
// hmacSha256Hex
// -----------------------------------------------------------
//
// HMAC-SHA-256 of the bytes under a key, both as hex.
//
// Used by:
//   - secp256k1.js — the signing nonce (RFC 6979)
// -----------------------------------------------------------

export const hmacSha256Hex = (keyHex, hex) => hmacSha256(Hex.parse(hex), Hex.parse(keyHex)).toString(Hex);







// -----------------------------------------------------------
// taggedHash
// -----------------------------------------------------------
//
// A SHA-256 that says what it is a hash of: the bytes are
// hashed behind the SHA-256 of a tag — a short name, written
// twice. Taproot and Schnorr signatures take every hash this
// way, each under its own name.
//
// Used by:
//   - secp256k1.js — the three hashes of a Schnorr signature
//   - taproot.js — a leaf, a branch, a tweak
//   - transaction.js — the message a Taproot signature signs
// -----------------------------------------------------------

export function taggedHash(tag, hex) {
  const name = sha256(tag).toString(Hex);
  return sha256Hex(`${name}${name}${hex}`);
}

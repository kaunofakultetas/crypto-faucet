// -----------------------------------------------------------
//  [*] BitcoinScript — key pairs
//
//  Everything the playground does with keys: a private key —
//  one of the few it starts with, or a new one drawn at
//  random — the public key that belongs to it, that key's
//  hash, the address made from the hash, and a signature.
//  They are real keys on Bitcoin's curve, so a signature in a
//  script is a real signature and OP_CHECKSIG really checks
//  it.
//
//  The key pairs the page starts with are the same on every
//  visit and in every browser: each private key is the
//  SHA-256 of a fixed sentence ending in a name, so a script
//  a lecturer shows on the screen looks the same on the
//  students' laptops. That makes these private keys public —
//  anyone can read the sentence here. A key pair made on the
//  page is drawn from the browser's own random numbers; it is
//  shown on the screen all the same, and gone with the tab.
//  All of them are toys. The addresses are written the way
//  the test network writes them, so that nobody takes one for
//  a place to send real coins.
//
//  Split into:
//
//    KEY_SENTENCE — what a starting private key is made from
//    addressOf    — a key hash as a test-network address
//    seedKey      — a starting private key, by its name
//    freshKey     — a new private key, at random
//    keyFrom      — a private key's public key, hash, address
//    signWith     — a signature over a message
// -----------------------------------------------------------

import bs58 from 'bs58';

import { bytesOf, hexOf, textToHex } from './bytes';
import { hash160, hash256, sha256Hex } from './hashes';
import { isPrivateKey, publicKeyOf, signDigest } from './secp256k1';


// The sentence a name is added to; its SHA-256 is the private
// key of the starting key pair of that name
const KEY_SENTENCE = 'VU KNF Bitcoin script playground: ';

// The byte in front of a test-network pay-to-public-key-hash
// address — it is why such an address starts with m or n
const TESTNET_ADDRESS = '6f';

// What was worked out so far, by private key: the curve
// arithmetic for one public key takes a few milliseconds, and
// a page asks for the same few keys over and over
const KNOWN = new Map();







// -----------------------------------------------------------
// addressOf
// -----------------------------------------------------------
//
// A public key's hash as an address: the network's byte, the
// twenty bytes of the hash and four check bytes — the start
// of their own double SHA-256, which catches a mistyped
// character — written in Base58.
//
// Used by:
//   - keyFrom (below)
// -----------------------------------------------------------

export function addressOf(publicKeyHashHex) {
  const payload = `${TESTNET_ADDRESS}${publicKeyHashHex}`;
  return bs58.encode(Uint8Array.from(bytesOf(`${payload}${hash256(payload).slice(0, 8)}`)));
}







// -----------------------------------------------------------
// seedKey
// -----------------------------------------------------------
//
// The private key of a starting key pair: the SHA-256 of the
// fixed sentence with the pair's name at its end.
//
// Used by:
//   - examples.js — the key pairs every example starts with
// -----------------------------------------------------------

export const seedKey = (name) => sha256Hex(textToHex(`${KEY_SENTENCE}${name}`));







// -----------------------------------------------------------
// freshKey
// -----------------------------------------------------------
//
// A new private key: 32 bytes from the browser's random
// number generator, drawn again in the all but impossible
// case that they cannot be a key.
//
// Used by:
//   - hooks/usePlayground.js — a key pair made on the page
// -----------------------------------------------------------

export function freshKey() {
  for (;;) {
    const drawn = hexOf(crypto.getRandomValues(new Uint8Array(32)));
    if (isPrivateKey(drawn)) return drawn;
  }
}







// -----------------------------------------------------------
// keyFrom
// -----------------------------------------------------------
//
// Everything a private key stands for in a script: the public
// key as a script carries it, the public key's hash and the
// address made from that hash. Worked out once per key.
//
// Used by:
//   - model.js — the key pairs of the page
// -----------------------------------------------------------

export function keyFrom(privateKey) {
  if (!KNOWN.has(privateKey)) {
    const publicKey = publicKeyOf(privateKey);
    const publicKeyHash = hash160(publicKey);
    KNOWN.set(privateKey, { privateKey, publicKey, publicKeyHash, address: addressOf(publicKeyHash) });
  }
  return KNOWN.get(privateKey);
}







// -----------------------------------------------------------
// signWith
// -----------------------------------------------------------
//
// A signature over a 32-byte message, as a script carries it:
// the DER signature and, after it, the one byte that says
// what of the transaction was signed — here always all of it
// (SIGHASH_ALL).
//
// Used by:
//   - model.js — the signatures of the spending transaction
// -----------------------------------------------------------

export const signWith = (privateKey, digestHex) => `${signDigest(privateKey, digestHex)}01`;

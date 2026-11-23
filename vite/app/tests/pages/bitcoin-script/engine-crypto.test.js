// -----------------------------------------------------------
//  [*] Tests — Bitcoin script playground: hashes, keys and
//  signatures
//
//  The cryptography the playground writes out itself
//  (engine/hashes.js, secp256k1.js, keys.js), held against
//  answers that do not come from it:
//
//    - reference.json beside the support files — keys,
//      hashes and signatures worked out by an independent
//      Bitcoin library (embit), for the very keys the
//      playground starts with
//    - the generator point's multiples and the RFC 6979
//      signature every secp256k1 library is checked with
//    - bip340-vectors.csv beside the support files — the
//      test vectors of the proposal for Schnorr signatures
//      (BIP 340), unchanged: keys, messages and signatures,
//      and the forgeries a check must turn away
//
//  A signature is checked both ways: the reference library's
//  signatures pass the playground's check, and what the
//  playground signs is deterministic, low, DER, and checks
//  against the right key and message only.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import schnorrVectors from '../../support/bitcoin-script/bip340-vectors.csv?raw';
import reference from '../../support/bitcoin-script/reference.json';
import { textToHex } from '@/pages/BitcoinScript/engine/bytes';
import { hash160, hash256, hmacSha256Hex, ripemd160Hex, sha1Hex, sha256Hex, taggedHash } from '@/pages/BitcoinScript/engine/hashes';
import { addressOf, freshKey, keyFrom, seedKey, signWith } from '@/pages/BitcoinScript/engine/keys';
import {
  isPrivateKey, isPublicKey, isStrictDer, isXOnlyKey, publicKeyOf, signDigest, signSchnorr, tweakPrivateKey, tweakPublicKey, verifyDigest, verifySchnorr, xOnlyOf,
} from '@/pages/BitcoinScript/engine/secp256k1';


// The number of points on the curve, and half of it
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// A private key that is a small number
const small = (number) => number.toString(16).padStart(64, '0');

// The second number of a DER signature
const sOf = (der) => {
  const rLength = parseInt(der.slice(6, 8), 16);
  return BigInt(`0x${der.slice(8 + 2 * rLength + 4)}`);
};







// -----------------------------------------------------------
// Hashes
// -----------------------------------------------------------

describe('hashes', () => {

  it('gives the five hashes of a script the values the reference library gives', () => {
    const { text, sha256, hash256: double, hash160: address, ripemd160, sha1, empty_hash160: empty } = reference.hashes;
    const bytes = textToHex(text);

    expect(sha256Hex(bytes)).toBe(sha256);
    expect(hash256(bytes)).toBe(double);
    expect(hash160(bytes)).toBe(address);
    expect(ripemd160Hex(bytes)).toBe(ripemd160);
    expect(sha1Hex(bytes)).toBe(sha1);
    expect(hash160('')).toBe(empty);
  });


  it('keys a message hash the way RFC 4231 says', () => {
    const key = '0b'.repeat(20);

    expect(hmacSha256Hex(key, textToHex('Hi There'))).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });
});







// -----------------------------------------------------------
// Keys
// -----------------------------------------------------------

describe('keys', () => {

  it('multiplies the generator point right', () => {
    expect(publicKeyOf(small(1n))).toBe('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
    expect(publicKeyOf(small(2n))).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
    expect(publicKeyOf('18e14a7b6a307f426a94f8114701e7c8e774e7f9a47e2c2035db29a206321725')).toBe('0250863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352');
  });


  it.each(Object.entries(reference.keys))('gives %s the keys, hash and address the reference library gives', (name, expected) => {
    const pair = keyFrom(seedKey(name));

    expect(pair.privateKey).toBe(expected.private);
    expect(pair.publicKey).toBe(expected.public);
    expect(pair.publicKeyHash).toBe(expected.hash160);
    expect(pair.address).toBe(expected.address_test);
    expect(publicKeyOf(expected.private, { compressed: false })).toBe(expected.public_uncompressed);
  });


  it('makes the starting private keys from the sentence the reference was made from', () => {
    expect(seedKey('Jonas')).toBe(sha256Hex(textToHex(`${reference.label}Jonas`)));
  });


  it('writes a test-network address: the letters m or n in front', () => {
    expect(addressOf('00'.repeat(20))).toMatch(/^[mn]/);
    expect(addressOf(reference.keys.Gabija.hash160)).toBe(reference.keys.Gabija.address_test);
  });


  it('takes as a private key only a number the curve has a point for', () => {
    expect(isPrivateKey(small(1n))).toBe(true);
    expect(isPrivateKey(small(ORDER - 1n))).toBe(true);
    expect(isPrivateKey(small(0n))).toBe(false);
    expect(isPrivateKey(small(ORDER))).toBe(false);
    expect(isPrivateKey('ff'.repeat(32))).toBe(false);
    expect(isPrivateKey('12')).toBe(false);
  });


  it('draws a new private key that is a key, and another one each time', () => {
    const first = freshKey();
    const second = freshKey();

    expect(isPrivateKey(first)).toBe(true);
    expect(isPrivateKey(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(keyFrom(first).publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
  });


  it('knows a public key from bytes that are none', () => {
    const { public: compressed, public_uncompressed: full } = reference.keys.Rokas;

    expect(isPublicKey(compressed)).toBe(true);
    expect(isPublicKey(full)).toBe(true);
    expect(isPublicKey(`06${full.slice(2)}`) || isPublicKey(`07${full.slice(2)}`)).toBe(true);
    expect(isPublicKey(`02${'ff'.repeat(32)}`)).toBe(false);
    expect(isPublicKey(compressed.slice(0, 40))).toBe(false);
    expect(isPublicKey('')).toBe(false);
  });
});







// -----------------------------------------------------------
// Signatures
// -----------------------------------------------------------

describe('signatures', () => {

  it('signs the vector every secp256k1 library is checked with', () => {
    const signature = signDigest(small(1n), sha256Hex(textToHex('Satoshi Nakamoto')));

    expect(signature).toBe('3045022100934b1ea10a4b3c1757e2b0c017d0b6143ce3c9a7e6a4a49860d7a6ab210ee3d802202442ce9d2b916064108014783e923ec36b49743e2ffa1c4496f01a512aafd9e5');
  });


  it.each(Object.entries(reference.keys))('accepts the signature the reference library made for %s', (_name, expected) => {
    expect(verifyDigest(expected.der, expected.digest, expected.public)).toBe(true);
    expect(verifyDigest(expected.der, expected.digest, expected.public_uncompressed)).toBe(true);
  });


  it.each(Object.entries(reference.keys))('signs for %s a signature that checks against that key and that message only', (name, expected) => {
    const signature = signDigest(expected.private, expected.digest);
    const stranger = Object.entries(reference.keys).find(([other]) => other !== name)[1];

    expect(isStrictDer(signature)).toBe(true);
    expect(sOf(signature) <= ORDER / 2n).toBe(true);
    expect(signDigest(expected.private, expected.digest)).toBe(signature);
    expect(verifyDigest(signature, expected.digest, expected.public)).toBe(true);
    expect(verifyDigest(signature, sha256Hex(expected.digest), expected.public)).toBe(false);
    expect(verifyDigest(signature, expected.digest, stranger.public)).toBe(false);
  });


  it('puts the sign-everything byte behind a signature a script carries', () => {
    const { private: privateKey, digest } = reference.keys.Simona;

    expect(signWith(privateKey, digest)).toBe(`${signDigest(privateKey, digest)}01`);
  });


  it('answers no, and never throws, for bytes that are no signature or no key', () => {
    const { der, digest, public: publicKey } = reference.keys.Jonas;

    expect(verifyDigest('', digest, publicKey)).toBe(false);
    expect(verifyDigest('3006020101020101', digest, publicKey)).toBe(false);
    expect(verifyDigest(der.slice(0, -2), digest, publicKey)).toBe(false);
    expect(verifyDigest(der, digest, '02')).toBe(false);
    expect(verifyDigest(der, digest, `02${'ff'.repeat(32)}`)).toBe(false);
  });


  it('tells strict DER from the encodings BIP 66 turns away', () => {
    const good = '3006020101020101';

    expect(isStrictDer(good)).toBe(true);
    expect(isStrictDer('')).toBe(false);
    expect(isStrictDer('3106020101020101')).toBe(false);
    expect(isStrictDer('3007020101020101')).toBe(false);
    expect(isStrictDer('300702020001020101')).toBe(false);
    expect(isStrictDer('3006020181020101')).toBe(false);
    expect(isStrictDer('3006030101020101')).toBe(false);
    expect(isStrictDer('3005020001020101'.slice(0, 14))).toBe(false);
    expect(isStrictDer(`${good}00`)).toBe(false);
  });
});







// -----------------------------------------------------------
// Schnorr signatures
// -----------------------------------------------------------

describe('Schnorr signatures', () => {

  // The rows of the proposal's file, the heading left out
  const ROWS = schnorrVectors.trim().split('\n').slice(1).map((line) => {
    const [index, secret, publicKey, auxiliary, message, signature, result, comment = ''] = line.split(',');
    return { index: Number(index), secret: secret.toLowerCase(), publicKey: publicKey.toLowerCase(), auxiliary: auxiliary.toLowerCase(), message: message.toLowerCase(), signature: signature.toLowerCase(), valid: result === 'TRUE', comment };
  });

  it('holds all nineteen vectors of BIP 340', () => {
    expect(ROWS.map((row) => row.index)).toEqual(Array.from({ length: 19 }, (_, index) => index));
    expect(ROWS.filter((row) => row.valid)).toHaveLength(9);
  });


  it.each(ROWS.map((row) => [row.index, row.valid ? 'accepts' : 'turns away', row]))('vector %i: %s the signature', (_index, _verb, row) => {
    expect(verifySchnorr(row.signature, row.message, row.publicKey)).toBe(row.valid);
  });


  it.each(ROWS.filter((row) => row.secret).map((row) => [row.index, row]))('vector %i: signs the very signature the proposal gives', (_index, row) => {
    expect(xOnlyOf(row.secret)).toBe(row.publicKey);
    expect(signSchnorr(row.secret, row.message, row.auxiliary)).toBe(row.signature);
  });


  it('signs the same bytes every time, and other bytes with other randomness', () => {
    const secret = seedKey('Jonas');
    const message = sha256Hex(textToHex('žinutė'));

    expect(signSchnorr(secret, message)).toBe(signSchnorr(secret, message));
    expect(signSchnorr(secret, message)).toBe(signSchnorr(secret, message, '00'.repeat(32)));
    expect(signSchnorr(secret, message, '01'.repeat(32))).not.toBe(signSchnorr(secret, message));
    expect(verifySchnorr(signSchnorr(secret, message, '01'.repeat(32)), message, xOnlyOf(secret))).toBe(true);
  });


  it('takes as a 32-byte key only the first coordinate of a point', () => {
    expect(isXOnlyKey(xOnlyOf(seedKey('Jonas')))).toBe(true);
    expect(isXOnlyKey('00'.repeat(32))).toBe(false);
    expect(isXOnlyKey('ff'.repeat(32))).toBe(false);
    expect(isXOnlyKey(xOnlyOf(seedKey('Jonas')).slice(2))).toBe(false);
  });


  it('hashes under a name: the name\'s own hash twice in front of the bytes', () => {
    const name = sha256Hex(textToHex('TapLeaf'));

    expect(taggedHash('TapLeaf', 'c001ac')).toBe(sha256Hex(`${name}${name}c001ac`));
    expect(taggedHash('TapLeaf', 'c001ac')).not.toBe(taggedHash('TapBranch', 'c001ac'));
  });


  it.each(['Jonas', 'Gabija', 'Rokas', 'Simona', 'Atšaukimas'])('tweaks the private key of %s to the key its tweaked public key belongs to', (name) => {
    const secret = seedKey(name);
    const tweak = sha256Hex(textToHex(`pakeitimas ${name}`));
    const made = tweakPublicKey(xOnlyOf(secret), tweak);
    const message = '11'.repeat(32);

    expect(xOnlyOf(tweakPrivateKey(secret, tweak))).toBe(made.key);
    expect(verifySchnorr(signSchnorr(tweakPrivateKey(secret, tweak), message), message, made.key)).toBe(true);
    expect(verifySchnorr(signSchnorr(secret, message), message, made.key)).toBe(false);
  });


  it('makes no key from a tweak the curve has no number for', () => {
    expect(tweakPublicKey(xOnlyOf(seedKey('Jonas')), 'ff'.repeat(32))).toBeNull();
    expect(tweakPublicKey('00'.repeat(32), '01'.repeat(32))).toBeNull();
  });
});

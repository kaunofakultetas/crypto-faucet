// -----------------------------------------------------------
//  [*] BitcoinScript — keys and signatures (secp256k1, ECDSA)
//
//  The elliptic-curve arithmetic behind OP_CHECKSIG, written
//  out with the browser's big integers: a public key from a
//  private one, a signature over a 32-byte message, and the
//  check a full node makes of that signature. Nothing here is
//  borrowed from a library — the playground signs and checks
//  for real, and the page that explains a signature should
//  not hide one behind an import.
//
//  It is a classroom implementation and nothing more: it
//  takes as long as it takes, and that time gives a key away
//  to anyone who can measure it. The keys it is used with are
//  toys whose private halves are printed in the page's own
//  source (keys.js).
//
//  A signature is made the way wallets make one. The secret
//  number of each signature comes from the key and the
//  message themselves (RFC 6979), so the same transaction
//  signed twice carries the same signature and nothing on the
//  page flickers; and of the two signatures every message
//  has, the one with the smaller second half is the one
//  given, as the network's relay rules ask. It is written in
//  DER, the encoding a transaction carries.
//
//  A check answers yes or no and never throws: a public key
//  that is no point of the curve, or bytes that are no DER
//  signature, simply check as no. Whether bytes are DER at
//  all is a separate question a node asks first (isStrictDer)
//  — to a node a mangled signature is a broken script, not a
//  wrong one.
//
//  Split into:
//
//    P, N, G, INFINITY — the curve: its field, its order,
//                        its starting point, the point at
//                        infinity
//    mod               — a remainder that is never negative
//    inverse           — division, as multiplying
//    power             — a power, for the square root
//    double, add       — the two ways points combine
//    multiply          — a point added to itself many times
//    affine            — a point back in plain coordinates
//    pointOf           — a public key's bytes as a point
//    isPublicKey       — whether bytes are a public key
//    isPrivateKey      — whether bytes can be a private key
//    publicKeyOf       — the public key of a private one
//    nonces            — the secret numbers of a signature
//    derOf, numbersOf  — two numbers as DER, and back
//    isStrictDer       — whether bytes are a DER signature
//    signDigest        — a signature over a message
//    verifyDigest      — a full node's check of one
// -----------------------------------------------------------

import { bytesOf } from './bytes';
import { hmacSha256Hex } from './hashes';


// The prime the curve's coordinates are counted modulo
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

// The number of points on the curve — what private keys and
// both halves of a signature are counted modulo
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// The point every public key is a multiple of. Points are
// kept as three numbers (Jacobian coordinates), which lets
// two of them be added without a division
const G = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
  1n,
];

// The point at infinity: the curve's zero, what a point and
// its mirror image add up to
const INFINITY = [0n, 1n, 0n];







// -----------------------------------------------------------
// mod
// -----------------------------------------------------------
//
// The remainder of a division, always between zero and the
// modulus — JavaScript's own keeps the sign of a negative
// number.
//
// Used by:
//   - every function below
// -----------------------------------------------------------

function mod(value, modulus) {
  const rest = value % modulus;
  return rest >= 0n ? rest : rest + modulus;
}







// -----------------------------------------------------------
// inverse
// -----------------------------------------------------------
//
// The number that multiplies a value to one, modulo a prime —
// division in a world of remainders — found with Euclid's
// extended algorithm.
//
// Used by:
//   - affine, signDigest, verifyDigest (below)
// -----------------------------------------------------------

function inverse(value, modulus) {
  let [remainder, next] = [mod(value, modulus), modulus];
  let [factor, nextFactor] = [1n, 0n];

  while (next !== 0n) {
    const quotient = remainder / next;
    [remainder, next] = [next, remainder - quotient * next];
    [factor, nextFactor] = [nextFactor, factor - quotient * nextFactor];
  }
  return mod(factor, modulus);
}







// -----------------------------------------------------------
// power
// -----------------------------------------------------------
//
// A value raised to an exponent, modulo a number, by squaring.
//
// Used by:
//   - pointOf (below) — the square root that turns half a
//     public key into a whole one
// -----------------------------------------------------------

function power(value, exponent, modulus) {
  let result = 1n;
  let square = mod(value, modulus);

  for (let rest = exponent; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = mod(result * square, modulus);
    square = mod(square * square, modulus);
  }
  return result;
}







// -----------------------------------------------------------
// double
// -----------------------------------------------------------
//
// A point added to itself.
//
// Used by:
//   - add, multiply (below)
// -----------------------------------------------------------

function double([x, y, z]) {
  if (z === 0n || y === 0n) return INFINITY;

  const ySquared = mod(y * y, P);
  const s = mod(4n * x * ySquared, P);
  const m = mod(3n * x * x, P);
  const nextX = mod(m * m - 2n * s, P);

  return [nextX, mod(m * (s - nextX) - 8n * ySquared * ySquared, P), mod(2n * y * z, P)];
}







// -----------------------------------------------------------
// add
// -----------------------------------------------------------
//
// The sum of two points: infinity changes nothing, a point
// and itself is a doubling, a point and its mirror image is
// infinity.
//
// Used by:
//   - multiply, verifyDigest (below)
// -----------------------------------------------------------

function add(first, second) {
  if (first[2] === 0n) return second;
  if (second[2] === 0n) return first;

  const [x1, y1, z1] = first;
  const [x2, y2, z2] = second;
  const z1Squared = mod(z1 * z1, P);
  const z2Squared = mod(z2 * z2, P);
  const u1 = mod(x1 * z2Squared, P);
  const u2 = mod(x2 * z1Squared, P);
  const s1 = mod(y1 * z2 * z2Squared, P);
  const s2 = mod(y2 * z1 * z1Squared, P);

  if (u1 === u2) return s1 === s2 ? double(first) : INFINITY;

  const h = mod(u2 - u1, P);
  const r = mod(s2 - s1, P);
  const hSquared = mod(h * h, P);
  const hCubed = mod(h * hSquared, P);
  const v = mod(u1 * hSquared, P);
  const nextX = mod(r * r - hCubed - 2n * v, P);

  return [nextX, mod(r * (v - nextX) - s1 * hCubed, P), mod(h * z1 * z2, P)];
}







// -----------------------------------------------------------
// multiply
// -----------------------------------------------------------
//
// A point added to itself a given number of times, by
// doubling: the one-way street of the whole scheme. Going
// from the count to the point is this loop; going back is
// not known to be possible.
//
// Used by:
//   - publicKeyOf, signDigest, verifyDigest (below)
// -----------------------------------------------------------

function multiply(count, point) {
  let result = INFINITY;
  let addend = point;

  for (let rest = count; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = add(result, addend);
    addend = double(addend);
  }
  return result;
}







// -----------------------------------------------------------
// affine
// -----------------------------------------------------------
//
// A point back in its two plain coordinates, or nothing for
// the point at infinity, which has none.
//
// Used by:
//   - publicKeyOf, signDigest, verifyDigest (below)
// -----------------------------------------------------------

function affine([x, y, z]) {
  if (z === 0n) return null;

  const zInverse = inverse(z, P);
  const zInverseSquared = mod(zInverse * zInverse, P);
  return [mod(x * zInverseSquared, P), mod(y * zInverseSquared * zInverse, P)];
}







// -----------------------------------------------------------
// pointOf
// -----------------------------------------------------------
//
// The point a public key's bytes stand for, or nothing when
// they stand for none. A key travels in one of two forms: the
// full one, both coordinates behind an 04, and the compressed
// one, the first coordinate behind an 02 or 03 that says
// which of the two possible second coordinates is meant —
// that one is worked out here, as a square root. Either way
// the point must really lie on the curve. A third form is as
// old as Bitcoin, used by nobody and still accepted by every
// node: both coordinates behind an 06 or 07, which must agree
// with the second coordinate being even or odd.
//
// Used by:
//   - isPublicKey, verifyDigest (below)
// -----------------------------------------------------------

function pointOf(publicKeyHex) {
  const full = /^0([467])([0-9a-f]{64})([0-9a-f]{64})$/.exec(publicKeyHex);
  const compressed = /^0([23])([0-9a-f]{64})$/.exec(publicKeyHex);
  if (!full && !compressed) return null;

  const x = BigInt(`0x${(full ?? compressed)[2]}`);
  if (x >= P) return null;
  const ySquared = mod(x * x * x + 7n, P);

  if (full) {
    const y = BigInt(`0x${full[3]}`);
    const fitsItsMarker = full[1] === '4' || (full[1] === '7') === Boolean(y & 1n);
    return y < P && mod(y * y, P) === ySquared && fitsItsMarker ? [x, y] : null;
  }

  const root = power(ySquared, (P + 1n) / 4n, P);
  if (mod(root * root, P) !== ySquared) return null;
  const odd = compressed[1] === '3';
  return [x, (root & 1n) === (odd ? 1n : 0n) ? root : P - root];
}







// -----------------------------------------------------------
// isPublicKey
// -----------------------------------------------------------
//
// Whether bytes are a public key at all — a point of the
// curve in one of its two written forms. A check against a
// key that is none fails for that reason alone, and the page
// says so instead of blaming the signature.
//
// Used by:
//   - node.js — why a signature check said no
// -----------------------------------------------------------

export const isPublicKey = (publicKeyHex) => pointOf(publicKeyHex) !== null;







// -----------------------------------------------------------
// isPrivateKey
// -----------------------------------------------------------
//
// Whether 32 bytes can serve as a private key: a number from
// one up to one less than the count of the curve's points.
// Almost every 32 bytes can — but zero cannot, and neither
// can the few numbers at the very top.
//
// Used by:
//   - keys.js — a freshly drawn key
// -----------------------------------------------------------

export function isPrivateKey(privateKeyHex) {
  if (!/^[0-9a-f]{64}$/.test(privateKeyHex)) return false;

  const number = BigInt(`0x${privateKeyHex}`);
  return number > 0n && number < N;
}







// -----------------------------------------------------------
// publicKeyOf
// -----------------------------------------------------------
//
// The public key of a private key — the starting point
// multiplied by it — as the bytes a script carries:
// compressed unless the caller asks for the full form the
// first years of Bitcoin used.
//
// Used by:
//   - keys.js — a key pair's public half
// -----------------------------------------------------------

export function publicKeyOf(privateKeyHex, { compressed = true } = {}) {
  const [x, y] = affine(multiply(BigInt(`0x${privateKeyHex}`), G));
  const xHex = x.toString(16).padStart(64, '0');

  if (!compressed) return `04${xHex}${y.toString(16).padStart(64, '0')}`;
  return `${y & 1n ? '03' : '02'}${xHex}`;
}







// -----------------------------------------------------------
// nonces
// -----------------------------------------------------------
//
// The secret numbers a signature may be made with, one after
// the other, derived from the private key and the message
// alone (RFC 6979) — never from chance, so nothing depends on
// how good the browser's dice are, and never the same for two
// different messages, which would give the key away. The
// first one does, in every case anyone will ever see.
//
// Used by:
//   - signDigest (below)
// -----------------------------------------------------------

function* nonces(privateKeyHex, digestHex) {
  const key = privateKeyHex.padStart(64, '0');
  const message = mod(BigInt(`0x${digestHex}`), N).toString(16).padStart(64, '0');

  let v = '01'.repeat(32);
  let k = '00'.repeat(32);
  k = hmacSha256Hex(k, `${v}00${key}${message}`);
  v = hmacSha256Hex(k, v);
  k = hmacSha256Hex(k, `${v}01${key}${message}`);
  v = hmacSha256Hex(k, v);

  for (;;) {
    v = hmacSha256Hex(k, v);
    const candidate = BigInt(`0x${v}`);
    if (candidate >= 1n && candidate < N) yield candidate;

    k = hmacSha256Hex(k, `${v}00`);
    v = hmacSha256Hex(k, v);
  }
}







// -----------------------------------------------------------
// derOf
// -----------------------------------------------------------
//
// The two numbers of a signature in DER: a sequence of two
// whole numbers, each as short as it can be and never looking
// negative — a number whose first byte has its top bit set
// gets a zero byte in front.
//
// Used by:
//   - signDigest (below)
// -----------------------------------------------------------

function derOf(r, s) {
  const integer = (value) => {
    const digits = value.toString(16);
    const even = digits.length % 2 ? `0${digits}` : digits;
    const bytes = parseInt(even.slice(0, 2), 16) & 0x80 ? `00${even}` : even;
    return `02${(bytes.length / 2).toString(16).padStart(2, '0')}${bytes}`;
  };

  const body = `${integer(r)}${integer(s)}`;
  return `30${(body.length / 2).toString(16).padStart(2, '0')}${body}`;
}







// -----------------------------------------------------------
// isStrictDer
// -----------------------------------------------------------
//
// Whether bytes are a signature in DER exactly as a node
// demands it (BIP 66): the right markers, lengths that add
// up, and both numbers positive and without padding. The
// byte that names the signature's type is not part of what
// is asked about.
//
// Used by:
//   - numbersOf (below)
//   - node.js — a signature that is no signature at all
//     breaks the script instead of merely failing the check
// -----------------------------------------------------------

export function isStrictDer(derHex) {
  const bytes = bytesOf(derHex);
  if (bytes.length < 8 || bytes.length > 72) return false;
  if (bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) return false;

  const rLength = bytes[3];
  if (5 + rLength >= bytes.length) return false;
  const sLength = bytes[5 + rLength];
  if (rLength + sLength + 6 !== bytes.length) return false;

  if (bytes[2] !== 0x02 || rLength === 0) return false;
  if (bytes[4] & 0x80) return false;
  if (rLength > 1 && bytes[4] === 0x00 && !(bytes[5] & 0x80)) return false;

  if (bytes[rLength + 4] !== 0x02 || sLength === 0) return false;
  if (bytes[rLength + 6] & 0x80) return false;
  if (sLength > 1 && bytes[rLength + 6] === 0x00 && !(bytes[rLength + 7] & 0x80)) return false;

  return true;
}







// -----------------------------------------------------------
// numbersOf
// -----------------------------------------------------------
//
// The two numbers inside a DER signature, or nothing when the
// bytes are no such thing.
//
// Used by:
//   - verifyDigest (below)
// -----------------------------------------------------------

function numbersOf(derHex) {
  if (!isStrictDer(derHex)) return null;

  const rLength = parseInt(derHex.slice(6, 8), 16);
  const rEnd = 8 + 2 * rLength;
  return [BigInt(`0x${derHex.slice(8, rEnd)}`), BigInt(`0x${derHex.slice(rEnd + 4)}`)];
}







// -----------------------------------------------------------
// signDigest
// -----------------------------------------------------------
//
// A signature of a 32-byte message with a private key, in
// DER. Its first number is where a secret multiple of the
// starting point lands; its second ties that number, the
// message and the private key together — and is swapped for
// its mirror image when it is the larger of the two, so the
// signature is the one form of itself the network relays.
//
// Used by:
//   - keys.js — a persona signing the spending transaction
// -----------------------------------------------------------

export function signDigest(privateKeyHex, digestHex) {
  const key = BigInt(`0x${privateKeyHex}`);
  const message = BigInt(`0x${digestHex}`);

  for (const nonce of nonces(privateKeyHex, digestHex)) {
    const r = mod(affine(multiply(nonce, G))[0], N);
    const s = mod(inverse(nonce, N) * (message + r * key), N);
    if (r !== 0n && s !== 0n) return derOf(r, s > N / 2n ? N - s : s);
  }
  return null;
}







// -----------------------------------------------------------
// verifyDigest
// -----------------------------------------------------------
//
// What a full node does at OP_CHECKSIG: from the message, the
// signature's two numbers and the public key it rebuilds the
// point the signer's secret number led to, and says yes when
// that point is the one the signature names. Only the public
// key is needed — that is the whole trick. Bytes that are no
// signature, numbers out of range and a key that is no point
// all answer no.
//
// Used by:
//   - node.js — every signature a script asks about
// -----------------------------------------------------------

export function verifyDigest(derHex, digestHex, publicKeyHex) {
  const numbers = numbersOf(derHex);
  const point = pointOf(publicKeyHex);
  if (!numbers || !point) return false;

  const [r, s] = numbers;
  if (r < 1n || r >= N || s < 1n || s >= N) return false;

  const sInverse = inverse(s, N);
  const fromMessage = multiply(mod(BigInt(`0x${digestHex}`) * sInverse, N), G);
  const fromKey = multiply(mod(r * sInverse, N), [point[0], point[1], 1n]);
  const rebuilt = affine(add(fromMessage, fromKey));

  return rebuilt !== null && mod(rebuilt[0], N) === r;
}

// -----------------------------------------------------------
//  [*] BitcoinScript — a Taproot output's hidden tree
//
//  A Taproot output shows the chain one thing only: a 32-byte
//  key. Behind it may stand a whole tree of scripts, and
//  nobody can tell. The key is made in two steps (BIP 341):
//
//    - every script is a leaf, and a leaf's hash covers its
//      version and its bytes; two hashes side by side are
//      hashed into the one above them — the smaller of the
//      two always first, so no proof ever has to say left or
//      right — up to a single root
//    - the owner's own key, the internal key, is then tweaked
//      with a hash of itself and that root. The result is the
//      output's key
//
//  A coin locked that way opens in two ways. Its owner signs
//  with the tweaked private key, and the spend looks like any
//  payment to a key. Or a script of the tree is shown, and
//  with it the control block: the leaf's version, the
//  internal key, and the hashes that lead from the leaf up to
//  the root. From those a node walks to the root, tweaks the
//  internal key as the owner did, and must arrive at the very
//  key the output holds — whether the point behind it had an
//  odd second coordinate is the one bit the control block
//  adds, in its first byte.
//
//  The playground's tree is small: no script, one, or two.
//
//  Split into:
//
//    TAPSCRIPT    — the version of a leaf that is a script
//    leafHash     — a script's hash as a leaf
//    branchHash   — the hash above two hashes
//    rootOf       — the root of the playground's tree
//    outputKeyOf  — the key an output is locked to
//    tweakOf      — the number that key was tweaked with
//    controlBlockOf — the proof a shown script carries
//    readControlBlock — that proof, taken apart and walked
// -----------------------------------------------------------

import { byteLength, compactSize, uintLE } from './bytes';
import { taggedHash } from './hashes';
import { tweakPublicKey } from './secp256k1';







// -----------------------------------------------------------
// TAPSCRIPT
// -----------------------------------------------------------
//
// The leaf version that says "this leaf is a script, run it
// by the tapscript rules" (BIP 342). A leaf of any other
// version is one a later upgrade may give a meaning; until
// then it can be spent by anything.
//
// Used by:
//   - leafHash, controlBlockOf (below)
//   - interpreter.js — which rules a shown leaf is run by
// -----------------------------------------------------------

export const TAPSCRIPT = 0xc0;







// -----------------------------------------------------------
// leafHash
// -----------------------------------------------------------
//
// The hash of a script as a leaf of the tree: its version,
// its length and its bytes, under the name "TapLeaf".
//
// Used by:
//   - rootOf, readControlBlock (below)
//   - model.js — the leaf a signature inside a script signs
// -----------------------------------------------------------

export const leafHash = (scriptHex, version = TAPSCRIPT) => taggedHash('TapLeaf', `${uintLE(version, 1)}${compactSize(byteLength(scriptHex))}${scriptHex}`);







// -----------------------------------------------------------
// branchHash
// -----------------------------------------------------------
//
// The hash above two hashes of the tree: the two side by
// side, the smaller first, under the name "TapBranch".
//
// Used by:
//   - rootOf, readControlBlock (below)
// -----------------------------------------------------------

export const branchHash = (one, other) => taggedHash('TapBranch', one < other ? `${one}${other}` : `${other}${one}`);







// -----------------------------------------------------------
// rootOf
// -----------------------------------------------------------
//
// The root of the playground's tree, from the bytes of its
// leaves — nothing at all for no leaf, the leaf's own hash
// for one, the hash above the two for two.
//
// Used by:
//   - outputKeyOf, controlBlockOf (below)
// -----------------------------------------------------------

export function rootOf(scripts) {
  if (scripts.length === 0) return '';
  return scripts.map((script) => leafHash(script)).reduce(branchHash);
}







// -----------------------------------------------------------
// tweakOf
// -----------------------------------------------------------
//
// The number an internal key is tweaked with: the hash of the
// key and the tree's root, under the name "TapTweak". With no
// tree the key is hashed alone — the output then provably has
// no script path at all.
//
// Used by:
//   - outputKeyOf, readControlBlock (below)
//   - model.js — the private key that signs for the output
// -----------------------------------------------------------

export const tweakOf = (internalKey, root) => taggedHash('TapTweak', `${internalKey}${root}`);







// -----------------------------------------------------------
// outputKeyOf
// -----------------------------------------------------------
//
// The key a Taproot output is locked to, from the internal
// key and the scripts of the tree: the 32 bytes, and whether
// the point behind them has an odd second coordinate.
//
// Used by:
//   - controlBlockOf (below)
//   - model.js — the key in a Taproot lock
// -----------------------------------------------------------

export const outputKeyOf = (internalKey, scripts) => tweakPublicKey(internalKey, tweakOf(internalKey, rootOf(scripts)));







// -----------------------------------------------------------
// controlBlockOf
// -----------------------------------------------------------
//
// The control block that goes with one script of the tree
// when it is shown: the leaf version with the output key's
// odd-or-even bit in it, the internal key, and the hashes
// beside the path from the leaf to the root — for the
// playground's tree, the other leaf's hash when there is
// another leaf.
//
// Used by:
//   - model.js — the proof a script-path spend carries
// -----------------------------------------------------------

export function controlBlockOf(internalKey, scripts, shown) {
  const output = outputKeyOf(internalKey, scripts);
  if (!output) return null;

  const beside = scripts.filter((_, index) => index !== shown).map((script) => leafHash(script));
  return `${uintLE(TAPSCRIPT + (output.odd ? 1 : 0), 1)}${internalKey}${beside.join('')}`;
}







// -----------------------------------------------------------
// readControlBlock
// -----------------------------------------------------------
//
// A control block taken apart and walked, for the script it
// came with: the leaf's version, the leaf's hash, the root
// the path leads to, and the output key that root gives the
// internal key — with whether that key is the one the output
// holds, odd-or-even bit included. A control block of a wrong
// size is none.
//
// Used by:
//   - interpreter.js — a script-path spend of a Taproot coin
// -----------------------------------------------------------

export function readControlBlock(control, scriptHex, outputKey) {
  const size = byteLength(control);
  if (size < 33 || size > 33 + 32 * 128 || (size - 33) % 32 !== 0) return null;

  const first = parseInt(control.slice(0, 2), 16);
  const version = first & 0xfe;
  const internalKey = control.slice(2, 66);
  const path = control.slice(66).match(/.{64}/g) ?? [];

  const leaf = leafHash(scriptHex, version);
  const root = path.reduce(branchHash, leaf);
  const made = tweakPublicKey(internalKey, tweakOf(internalKey, root));

  return { version, internalKey, path, leaf, root, key: made?.key ?? null, committed: Boolean(made) && made.key === outputKey && made.odd === Boolean(first & 1) };
}

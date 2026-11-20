// -----------------------------------------------------------
//  [*] BitcoinScript — a script as a row of tiles
//
//  On this page a script is built, not typed: every word of
//  it is a tile that is put into a row, taken out of it or
//  moved along it. Underneath, a script stays what it always
//  was — a line of words (model.js reads it) — so a tile is
//  simply a word of that line, and this file is where rows of
//  tiles and lines of words are turned into each other:
//
//    - a word put in at a place, taken out, or moved to
//      another place gives the script's next text
//    - what a student types to make a piece of data — a
//      number, a text or raw bytes, as it is or hashed —
//      becomes the word that stands for it, or the reason it
//      cannot
//    - what the tray of pieces offers: the few words a first
//      lock is built from, the smallest numbers, and — behind
//      one press — every opcode by its family, with a search
//
//  Nothing here knows what a word means; that is the engine's
//  business (engine/script.js) once the text is read.
//
//  Split into:
//
//    COMMON_WORDS — the words a first lock is built from
//    SMALL_NUMBERS — the numbers kept at hand
//    HASHES       — the hashes a piece of data can be made with
//    DRAWERS      — every opcode, family by family
//    textsOf      — a script's words as plain strings
//    drawersWith  — the families, narrowed by a search
//    withWord     — a script with one more word
//    withoutWord  — a script with a word taken out
//    withWordMoved — a script with a word moved along
//    readTyped    — what was typed, read as a piece of data
//    makeWord     — what was typed, as a word
//    makeHash     — what was typed, hashed, as a word
//    keyWords     — the three words that are a key pair's
// -----------------------------------------------------------

import { LIMITS } from './constants';
import { isHex, textToHex } from './engine/bytes';
import { hash160, hash256, ripemd160Hex, sha1Hex, sha256Hex } from './engine/hashes';
import { GROUPS, OPCODES } from './engine/opcodes';
import { NUMBER_LIMIT, numberHex, wordsOf } from './engine/script';
import { shortHex } from './narration';







// -----------------------------------------------------------
// COMMON_WORDS
// -----------------------------------------------------------
//
// The opcodes a first lock is built from, in the order they
// are usually met. These, and no more, lie open in the tray:
// a short list is read at a glance, and every other opcode is
// one press away.
//
// Used by:
//   - components/PieceTray.jsx — the opcodes always on show
// -----------------------------------------------------------

export const COMMON_WORDS = ['OP_DUP', 'OP_HASH160', 'OP_EQUALVERIFY', 'OP_CHECKSIG', 'OP_EQUAL', 'OP_CHECKMULTISIG', 'OP_ADD', 'OP_SHA256'];







// -----------------------------------------------------------
// SMALL_NUMBERS
// -----------------------------------------------------------
//
// The numbers kept beside the common opcodes — the ones the
// classic locks use.
//
// Used by:
//   - components/PieceTray.jsx — the numbers always on show
// -----------------------------------------------------------

export const SMALL_NUMBERS = ['0', '1', '2', '3'];







// -----------------------------------------------------------
// HASHES
// -----------------------------------------------------------
//
// The hash functions a piece of data can be made with, by the
// name each goes by — the same five a script has an opcode
// for.
//
// Used by:
//   - makeHash (below)
//   - components/PieceTray.jsx — the list to choose from
// -----------------------------------------------------------

export const HASHES = {
  'SHA-256': sha256Hex,
  HASH160: hash160,
  'RIPEMD-160': ripemd160Hex,
  HASH256: hash256,
  'SHA-1': sha1Hex,
};







// -----------------------------------------------------------
// DRAWERS
// -----------------------------------------------------------
//
// Every opcode, sorted into its family, in the engine's
// order. The numbers Script has an opcode for are offered as
// the numbers themselves — that is how they are written.
//
// Used by:
//   - drawersWith (below)
// -----------------------------------------------------------

export const DRAWERS = GROUPS.map((group) => ({
  key: group.key,
  title: group.title,
  words: OPCODES
    .filter((opcode) => opcode.group === group.key)
    .map((opcode) => (group.key === 'constants' ? String(opcode.code === 0x4f ? -1 : Math.max(opcode.code - 0x50, 0)) : opcode.name)),
}));







// -----------------------------------------------------------
// textsOf
// -----------------------------------------------------------
//
// The words of a script's text, as plain strings.
//
// Used by:
//   - withWord, withoutWord, withWordMoved (below)
// -----------------------------------------------------------

const textsOf = (script) => wordsOf(script).map((word) => word.text);







// -----------------------------------------------------------
// withWord
// -----------------------------------------------------------
//
// A script's text with one more word, standing at the given
// place among its words — at the end when the place is past
// it. A script that would grow longer than a row may be is
// handed back as it was.
//
// Used by:
//   - hooks/useScriptRows.js — a tile pressed in the tray
//   - hooks/useTileDrag.js — a tile dropped into a row
// -----------------------------------------------------------

export function withWord(script, index, word) {
  const words = textsOf(script);
  words.splice(Math.max(0, Math.min(index, words.length)), 0, word);

  const next = words.join(' ');
  return next.length > LIMITS.SCRIPT_CHARACTERS ? script : next;
}







// -----------------------------------------------------------
// withoutWord
// -----------------------------------------------------------
//
// A script's text with the word at a place taken out.
//
// Used by:
//   - components/ScriptLine.jsx — a tile taken out of a row
//   - hooks/useTileDrag.js — a tile carried to another row
// -----------------------------------------------------------

export const withoutWord = (script, index) => textsOf(script).filter((_, at) => at !== index).join(' ');







// -----------------------------------------------------------
// withWordMoved
// -----------------------------------------------------------
//
// A script's text with one word moved along it. The target
// is a gap, counted before anything moves: gap zero is in
// front of the first word, the last gap behind the last one.
// The two gaps on either side of the word itself leave the
// script as it was.
//
// Used by:
//   - components/ScriptLine.jsx — a tile nudged with the keys
//   - hooks/useTileDrag.js — a tile dropped in its own row
// -----------------------------------------------------------

export function withWordMoved(script, from, gap) {
  const words = textsOf(script);
  if (from < 0 || from >= words.length) return script;

  const [word] = words.splice(from, 1);
  const target = Math.max(0, Math.min(gap > from ? gap - 1 : gap, words.length));
  words.splice(target, 0, word);
  return words.join(' ');
}







// -----------------------------------------------------------
// readTyped
// -----------------------------------------------------------
//
// What a student typed, read as one piece of data: the word a
// script writes it with, the bytes that word puts on the
// stack, and the way the page shows it — or the code of why
// it is no data (narration.js has the sentences). What is
// typed says by itself what it is: digits alone are a whole
// number, anything behind 0x is bytes, and everything else is
// a text, whose quotes may be typed or left out. A text is
// written inside double quotes unless it holds them itself.
//
// Used by:
//   - makeWord, makeHash (below)
// -----------------------------------------------------------

function readTyped(typed) {
  const value = typed.trim();
  const refuse = (code, text = value) => ({ word: null, hex: null, shown: null, problem: { code, text } });

  if (value === '') return refuse('maker-empty');

  if (/^-?\d+$/.test(value)) {
    if (Math.abs(Number(value)) > NUMBER_LIMIT) return refuse('number-too-large');
    const number = Number(value) || 0;
    return { word: String(number), hex: numberHex(number), shown: String(number), problem: null };
  }

  if (/^0x/i.test(value)) {
    const hex = value.slice(2).toLowerCase();
    if (hex === '' || !isHex(hex)) return refuse('bad-hex', `0x${hex}`);
    return { word: `0x${hex}`, hex, shown: `0x${shortHex(hex)}`, problem: null };
  }

  const text = /^(["']).+\1$/s.test(value) ? value.slice(1, -1) : value;
  const quote = !text.includes('"') ? '"' : !text.includes("'") ? "'" : null;
  if (quote === null) return refuse('text-quotes');
  return { word: `${quote}${text}${quote}`, hex: textToHex(text), shown: `„${text}“`, problem: null };
}







// -----------------------------------------------------------
// makeWord
// -----------------------------------------------------------
//
// What a student typed to make a piece of data, as the word a
// script writes it with — or the code of why there is none.
//
// Used by:
//   - components/PieceTray.jsx — a piece of data being made
// -----------------------------------------------------------

export function makeWord(typed) {
  const { word, problem } = readTyped(typed);
  return { word, problem };
}







// -----------------------------------------------------------
// makeHash
// -----------------------------------------------------------
//
// The hash of what a student typed, as a piece of data: the
// bytes of the hash behind 0x, and beside them how they were
// made — which hash, of what — so the page can call the bytes
// by that instead of showing forty or sixty-four hex digits.
// What is hashed is exactly what the typed word would put on
// the stack, so the opcode of the same hash, run on that
// word, gives these very bytes.
//
// Used by:
//   - components/PieceTray.jsx — a hash being made
// -----------------------------------------------------------

export function makeHash(algorithm, typed) {
  const { hex, shown, problem } = readTyped(typed);
  if (problem) return { word: null, made: null, problem };

  return { word: `0x${HASHES[algorithm](hex)}`, made: { algorithm, source: shown }, problem: null };
}







// -----------------------------------------------------------
// keyWords
// -----------------------------------------------------------
//
// The three words that stand for what is a key pair's: a
// signature of the spending transaction, the public key, and
// that key's hash. A key pair is named by its number.
//
// Used by:
//   - components/PieceTray.jsx — a key pair's tiles
// -----------------------------------------------------------

export const keyWords = (id) => [`<sig:${id}>`, `<pubkey:${id}>`, `<pubkeyhash:${id}>`];







// -----------------------------------------------------------
// drawersWith
// -----------------------------------------------------------
//
// The families of opcodes with only the words a search
// matches — any part of the name, in either letter case, the
// OP_ in front counting or not — and without the families
// left empty. An empty search matches everything.
//
// Used by:
//   - components/PieceTray.jsx — the list of all opcodes
// -----------------------------------------------------------

export function drawersWith(search) {
  const wanted = search.trim().toUpperCase().replace(/^OP_/, '');

  return DRAWERS
    .map((drawer) => ({ ...drawer, words: drawer.words.filter((word) => word.toUpperCase().includes(wanted)) }))
    .filter((drawer) => drawer.words.length > 0);
}

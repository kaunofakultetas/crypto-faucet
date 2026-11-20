// -----------------------------------------------------------
//  [*] Tests — Bitcoin script playground: tiles and playback
//
//  The two small modules between the model and the screen.
//
//  tiles.js turns rows of tiles into the words of a script
//  and back: a word put in, taken out, moved; what a student
//  types read as a piece of data — plain or hashed — or
//  refused; and the opcodes the tray offers, the few at hand
//  and all of them by family, narrowed by a search.
//
//  playback.js works out what is seen of the node's check
//  with the cursor at one place: which steps are worth a
//  stop, the state of transaction B, the answer each of the
//  node's questions got, where the node stands in a script,
//  and what a step did to the stack.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { LIMITS } from '@/pages/BitcoinScript/constants';
import { sha256Hex } from '@/pages/BitcoinScript/engine/hashes';
import { OPCODES, opcodeNamed } from '@/pages/BitcoinScript/engine/opcodes';
import { EXAMPLES } from '@/pages/BitcoinScript/examples';
import { buildModel, reduce } from '@/pages/BitcoinScript/model';
import { checksOf, stackAt, stackChange, stopsOf, tapeOf, verdictOf } from '@/pages/BitcoinScript/playback';
import { COMMON_WORDS, DRAWERS, HASHES, SMALL_NUMBERS, drawersWith, keyWords, makeHash, makeWord, withWord, withWordMoved, withoutWord } from '@/pages/BitcoinScript/tiles';


// A scene's state and its model, by its id
const stateOf = (id) => EXAMPLES.find((example) => example.id === id).state;
const modelOf = (id) => buildModel(stateOf(id));

// The marks of a row of tiles, as one word each
const marksOf = (tape) => tape.map((tile) => tile.step);

// The opcode that hashes the way a hash of the tray does
const HASH_OPCODES = { 'SHA-256': 'OP_SHA256', HASH160: 'OP_HASH160', 'RIPEMD-160': 'OP_RIPEMD160', HASH256: 'OP_HASH256', 'SHA-1': 'OP_SHA1' };







// -----------------------------------------------------------
// A script as a row of tiles
// -----------------------------------------------------------

describe('a script as a row of tiles', () => {

  it('puts a word in at a place, and at the end when the place is past it', () => {
    expect(withWord('a b c', 0, 'x')).toBe('x a b c');
    expect(withWord('a b c', 2, 'x')).toBe('a b x c');
    expect(withWord('a b c', Infinity, 'x')).toBe('a b c x');
    expect(withWord('', 0, 'x')).toBe('x');
  });


  it('keeps a quoted text and a reference whole, and tidies the spaces', () => {
    expect(withWord('"du žodžiai"   <sig:1>', 1, 'OP_DUP')).toBe('"du žodžiai" OP_DUP <sig:1>');
  });


  it('hands a script back as it was when one more word would make it too long', () => {
    const full = 'OP_DUP '.repeat(Math.floor(LIMITS.SCRIPT_CHARACTERS / 7)).trim();

    expect(withWord(full, Infinity, 'OP_HASH160')).toBe(full);
  });


  it('takes the word at a place out', () => {
    expect(withoutWord('a b c', 1)).toBe('a c');
    expect(withoutWord('a', 0)).toBe('');
    expect(withoutWord('a b', 5)).toBe('a b');
  });


  it('moves a word to a gap counted before anything moves', () => {
    expect(withWordMoved('a b c d', 0, 4)).toBe('b c d a');
    expect(withWordMoved('a b c d', 3, 0)).toBe('d a b c');
    expect(withWordMoved('a b c d', 1, 3)).toBe('a c b d');
    expect(withWordMoved('a b c d', 2, 1)).toBe('a c b d');
  });


  it('leaves a script as it was when a word is dropped beside itself', () => {
    expect(withWordMoved('a b c', 1, 1)).toBe('a b c');
    expect(withWordMoved('a b c', 1, 2)).toBe('a b c');
    expect(withWordMoved('a b c', 7, 0)).toBe('a b c');
  });


  it('names the three things of a key pair by the pair\'s number', () => {
    expect(keyWords(3)).toEqual(['<sig:3>', '<pubkey:3>', '<pubkeyhash:3>']);
  });
});







// -----------------------------------------------------------
// Data made by typing
// -----------------------------------------------------------

describe('data made by typing', () => {

  it.each([
    [' 840000 ', '840000'],
    ['-7', '-7'],
    ['007', '7'],
    ['-0', '0'],
    ['0xA1b2', '0xa1b2'],
    [' labas rytas ', '"labas rytas"'],
    ['sako "taip"', "'sako \"taip\"'"],
    ['1.5', '"1.5"'],
    ['A1B2', '"A1B2"'],
  ])('reads "%s" by what it looks like, as the word %s', (typed, word) => {
    expect(makeWord(typed)).toEqual({ word, problem: null });
  });


  it('takes digits for a text once they are typed inside quotes', () => {
    expect(makeWord('"5"')).toEqual({ word: '"5"', problem: null });
    expect(makeWord("'840000'")).toEqual({ word: '"840000"', problem: null });
  });


  it.each([
    ['', 'maker-empty'],
    ['   ', 'maker-empty'],
    ['549755813888', 'number-too-large'],
    [`ir " ir '`, 'text-quotes'],
    ['0xabc', 'bad-hex'],
    ['0xzz', 'bad-hex'],
    ['0x', 'bad-hex'],
  ])('makes nothing out of "%s"', (typed, code) => {
    const made = makeWord(typed);

    expect(made.word).toBeNull();
    expect(made.problem.code).toBe(code);
  });


  it('hashes a text, and remembers how the hash was made', () => {
    expect(makeHash('SHA-256', 'bitcoin')).toEqual({
      word: '0x6b88c087247aa2f07ee1c5956b8e1a9f4c7f892a70e324f1bb3d161e05ca107b',
      made: { algorithm: 'SHA-256', source: '„bitcoin“' },
      problem: null,
    });
  });


  it('hashes the bytes the typed word would put on the stack — a number as a number, a text as a text', () => {
    expect(makeHash('SHA-256', '5')).toMatchObject({ word: `0x${sha256Hex('05')}`, made: { source: '5' } });
    expect(makeHash('SHA-256', '"5"')).toMatchObject({ word: `0x${sha256Hex('35')}`, made: { source: '„5“' } });
    expect(makeHash('SHA-256', '0')).toMatchObject({ word: `0x${sha256Hex('')}`, made: { source: '0' } });
    expect(makeHash('SHA-256', '0x626974636f696e').word).toBe(makeHash('SHA-256', 'bitcoin').word);
    expect(makeHash('SHA-256', '0x626974636f696e').made.source).toBe('0x626974636f696e');
  });


  it.each(Object.keys(HASHES).flatMap((algorithm) => ['840000', '5', '0', '-7', 'labas rytas', '0xa1b2'].map((typed) => [algorithm, typed])))(
    'makes a %s hash of "%s" that the opcode of that hash agrees with',
    (algorithm, typed) => {
      // Not "hash, compare" alone: with HASH160 those are the
      // very bytes of a pay-to-script-hash lock, and a node
      // would go on to run the unlocking data as a script
      const lock = `${HASH_OPCODES[algorithm]} ${makeHash(algorithm, typed).word} OP_EQUALVERIFY 1`;
      const state = [{ type: 'output/lock', index: 0, text: lock }, { type: 'unlock', text: makeWord(typed).word }].reduce(reduce, stateOf('sum'));

      expect(buildModel(state).verification.valid).toBe(true);
    },
  );


  it('offers the five hashes a script has an opcode for', () => {
    expect(Object.keys(HASHES)).toEqual(Object.keys(HASH_OPCODES));
    expect(makeHash('HASH160', 'x').word).toMatch(/^0x[0-9a-f]{40}$/);
    expect(makeHash('HASH256', 'x').word).toMatch(/^0x[0-9a-f]{64}$/);
  });


  it('hashes nothing that is no data', () => {
    expect(makeHash('SHA-256', '  ')).toEqual({ word: null, made: null, problem: { code: 'maker-empty', text: '' } });
    expect(makeHash('SHA-256', '0xabc')).toMatchObject({ word: null, made: null, problem: { code: 'bad-hex' } });
  });
});







// -----------------------------------------------------------
// The opcodes the tray offers
// -----------------------------------------------------------

describe('the opcodes the tray offers', () => {

  it('keeps at hand the words the everyday lock is built from, and the smallest numbers', () => {
    expect(COMMON_WORDS).toEqual(expect.arrayContaining(['OP_DUP', 'OP_HASH160', 'OP_EQUALVERIFY', 'OP_CHECKSIG']));
    expect(COMMON_WORDS.length).toBeLessThanOrEqual(8);
    for (const word of COMMON_WORDS) expect(opcodeNamed(word)).not.toBeNull();
    expect(SMALL_NUMBERS).toEqual(['0', '1', '2', '3']);
  });


  it('holds every opcode exactly once in its families', () => {
    const offered = DRAWERS.flatMap((drawer) => drawer.words);

    expect(offered).toHaveLength(OPCODES.length);
    expect(new Set(offered).size).toBe(OPCODES.length);
  });


  it('offers the numbers a script has opcodes for as the numbers themselves', () => {
    expect(DRAWERS.find((drawer) => drawer.key === 'constants').words).toEqual(['0', '-1', ...Array.from({ length: 16 }, (_, index) => String(index + 1))]);
  });


  it('names the families in Lithuanian', () => {
    expect(DRAWERS.map((drawer) => drawer.title)).toEqual(['Skaičiai', 'Stekas', 'Palyginimas', 'Aritmetika', 'Kriptografija', 'Sąlygos ir pabaiga', 'Laikas', 'Išjungti', 'Rezervuoti']);
  });


  it('narrows the families by any part of a name, whatever the letter case, with or without OP_', () => {
    expect(drawersWith('')).toEqual(DRAWERS);
    expect(drawersWith('  OP_  ')).toEqual(DRAWERS);
    expect(drawersWith('checksig').flatMap((drawer) => drawer.words)).toEqual(['OP_CHECKSIG', 'OP_CHECKSIGVERIFY']);
    expect(drawersWith('op_dup').flatMap((drawer) => drawer.words)).toEqual(expect.arrayContaining(['OP_DUP', 'OP_2DUP', 'OP_IFDUP']));
    expect(drawersWith('16').map((drawer) => [drawer.key, drawer.words])).toEqual(expect.arrayContaining([['constants', ['16']]]));
  });


  it('leaves out the families a search empties, and all of them when nothing matches', () => {
    expect(drawersWith('checksig').map((drawer) => drawer.key)).toEqual(['crypto']);
    expect(drawersWith('tokio nėra')).toEqual([]);
  });
});







// -----------------------------------------------------------
// A check, as far as the cursor has got
// -----------------------------------------------------------

describe('a check, as far as the cursor has got', () => {

  const model = modelOf('p2pkh');
  const { timeline } = model.verification;
  const stops = stopsOf(timeline);
  const tape = (entry) => marksOf(tapeOf('lock', model.b.spends.script, model.lexicon, timeline, entry));

  it('stops at every word of the scripts and at the verdict, and nowhere else', () => {
    expect(stops.map((entry) => entry.phase ?? entry.stage)).toEqual(['unlock', 'unlock', 'lock', 'lock', 'lock', 'lock', 'lock', 'verdict']);
    expect(stops.at(-1)).toBe(timeline.at(-1));
  });


  it('stops where the node takes a redeem script off the stack', () => {
    const kinds = stopsOf(modelOf('p2sh').verification.timeline).map((entry) => entry.kind ?? entry.stage);

    expect(kinds.filter((kind) => kind === 'redeem')).toHaveLength(1);
    expect(kinds).not.toContain('handover');
    expect(kinds.at(-1)).toBe('verdict');
  });


  it('has only the verdict to stop at when the node says no before any script is run', () => {
    const spent = buildModel({ ...stateOf('p2pkh'), coinSpent: true }).verification.timeline;

    expect(stopsOf(spent)).toEqual([spent.at(-1)]);
  });


  it('says what the node has made of transaction B so far', () => {
    expect(verdictOf(null, { started: false, finished: false })).toBe('blocked');
    expect(verdictOf(model.verification, { started: false, finished: false })).toBe('unchecked');
    expect(verdictOf(model.verification, { started: true, finished: false })).toBe('checking');
    expect(verdictOf(model.verification, { started: true, finished: true })).toBe('valid');
    expect(verdictOf(modelOf('theft').verification, { started: true, finished: true })).toBe('invalid');
  });


  it('gives each of the node\'s four questions its answer', () => {
    const answers = (steps) => checksOf(steps).map((check) => check.state);
    const overspent = buildModel(reduce(stateOf('p2pkh'), { type: 'payment/amount', index: 0, text: '0.6' })).verification.timeline;
    const spent = buildModel({ ...stateOf('p2pkh'), coinSpent: true }).verification.timeline;

    expect(checksOf(timeline).map((check) => check.name)).toEqual(['Moneta', 'Sumos', 'Laikas', 'Skriptai']);
    expect(answers(timeline)).toEqual(['passed', 'passed', 'passed', 'passed']);
    expect(answers(modelOf('theft').verification.timeline)).toEqual(['passed', 'passed', 'passed', 'failed']);
    expect(answers(overspent)).toEqual(['passed', 'failed', 'unasked', 'unasked']);
    expect(answers(spent)).toEqual(['failed', 'unasked', 'unasked', 'unasked']);
  });


  it('shows where the node stands in a script while it is stepped through', () => {
    expect(tape(null)).toEqual(['todo', 'todo', 'todo', 'todo', 'todo']);
    expect(tape(stops[1])).toEqual(['todo', 'todo', 'todo', 'todo', 'todo']);
    expect(tape(stops[2])).toEqual(['current', 'todo', 'todo', 'todo', 'todo']);
    expect(tape(stops[4])).toEqual(['done', 'done', 'current', 'todo', 'todo']);
  });


  it('shows a finished script as plain as an unrun one', () => {
    expect(tape(stops.at(-1))).toEqual(['todo', 'todo', 'todo', 'todo', 'todo']);
  });


  it('keeps the word a script broke at marked, while stepping and once the check has ended', () => {
    const theft = modelOf('theft');
    const steps = stopsOf(theft.verification.timeline);
    const marks = (entry) => marksOf(tapeOf('lock', theft.b.spends.script, theft.lexicon, theft.verification.timeline, entry));

    expect(marks(steps.at(-2))).toEqual(['done', 'done', 'done', 'failed', 'todo']);
    expect(marks(steps.at(-1))).toEqual(['todo', 'todo', 'todo', 'failed', 'todo']);
  });


  it('keeps the words of a branch not taken struck out', () => {
    const branches = modelOf('two-ways');
    const steps = branches.verification.timeline;

    expect(marksOf(tapeOf('lock', branches.b.spends.script, branches.lexicon, steps, steps.at(-1)))).toEqual(['todo', 'todo', 'todo', 'todo', 'skipped', 'skipped', 'skipped', 'skipped', 'todo']);
  });


  it('gives every word of a script a tile, even while there is no check', () => {
    const tiles = tapeOf('unlock', model.b.unlock, model.lexicon, null, null);

    expect(tiles.map((tile) => [tile.label.text, tile.step])).toEqual([['parašas „Jonas“', 'todo'], ['viešasis raktas „Jonas“', 'todo']]);
  });


  it('follows the node through the redeem script as well', () => {
    const p2sh = modelOf('p2sh');
    const steps = p2sh.verification.timeline;
    const third = steps.find((entry) => entry.kind === 'item' && entry.phase === 'redeem' && entry.index === 2);
    const tiles = tapeOf('redeem', p2sh.b.redeem, p2sh.lexicon, steps, third);

    expect(tiles.map((tile) => tile.label.text)).toEqual(['2', 'viešasis raktas „Jonas“', 'viešasis raktas „Gabija“', '2', 'OP_CHECKMULTISIG']);
    expect(marksOf(tiles)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
  });


  it('reads the two stacks as a step left them, both empty before the first step', () => {
    expect(stackAt(null)).toEqual({ stack: [], alt: [] });
    expect(stackAt(stops[0]).stack).toHaveLength(1);
    expect(stackAt(stops[1]).stack).toHaveLength(2);
    expect(stackAt(stops.at(-1))).toEqual({ stack: ['01'], alt: [] });
  });


  it('tells what a step kept, took and put', () => {
    expect(stackChange(['a', 'b'], ['a', 'b', 'b'])).toEqual({ kept: 2, taken: [], put: ['b'] });
    expect(stackChange(['a', 'b'], ['a', 'c'])).toEqual({ kept: 1, taken: ['b'], put: ['c'] });
    expect(stackChange(['a', 'b'], ['b', 'a'])).toEqual({ kept: 0, taken: ['a', 'b'], put: ['b', 'a'] });
    expect(stackChange(['a', 'b'], [])).toEqual({ kept: 0, taken: ['a', 'b'], put: [] });
    expect(stackChange([], [])).toEqual({ kept: 0, taken: [], put: [] });
  });
});

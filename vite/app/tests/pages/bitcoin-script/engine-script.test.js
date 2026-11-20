// -----------------------------------------------------------
//  [*] Tests — Bitcoin script playground: a script as words,
//  items and bytes
//
//  The three forms a script lives in and the ways between
//  them (engine/script.js, opcodes.js): Script's own numbers
//  — held against the reference library's — the words a
//  script is written in, the items they are read as, what
//  could not be read and why, the bytes a transaction
//  carries, those bytes read back, and the well-known locks
//  told apart.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import reference from '../../support/bitcoin-script/reference.json';
import { OPCODES, opcodeAt, opcodeNamed } from '@/pages/BitcoinScript/engine/opcodes';
import {
  NUMBER_LIMIT, describeLock, isPushOnly, isTrue, numberHex, numberOf, parseScript, pushOf, readScript, resolveScript, serializeScript, wordsOf,
} from '@/pages/BitcoinScript/engine/script';


// A script's items as short readable words
const told = (items) => items.map((item) => (item.type === 'op' ? item.opcode.name : item.ref ? `<${item.ref.what}${item.ref.who ? `:${item.ref.who}` : ''}>` : `push ${item.hex}`));

// A script's bytes from its words, nothing to fill in
const bytesOf = (text) => serializeScript(parseScript(text).items);







// -----------------------------------------------------------
// Numbers and truth
// -----------------------------------------------------------

describe('numbers and truth', () => {

  it.each(Object.entries(reference.numbers))('writes %s the way the reference library does, and reads it back', (number, hex) => {
    expect(numberHex(Number(number))).toBe(hex);
    expect(numberOf(hex, 5)).toBe(Number(number));
  });


  it('reads a zero with a minus in front as zero', () => {
    expect(numberOf('80')).toBe(0);
    expect(numberOf('0080')).toBe(0);
  });


  it('refuses a number longer than the opcode asking will take', () => {
    expect(numberOf('0000000001')).toBeNull();
    expect(numberOf('0000000001', 5)).toBe(2 ** 32);
  });


  it('counts as true any bytes that are not a zero', () => {
    expect(isTrue('01')).toBe(true);
    expect(isTrue('0001')).toBe(true);
    expect(isTrue('ff')).toBe(true);
    expect(isTrue('')).toBe(false);
    expect(isTrue('00')).toBe(false);
    expect(isTrue('0000')).toBe(false);
    expect(isTrue('80')).toBe(false);
    expect(isTrue('0080')).toBe(false);
    expect(isTrue('8000')).toBe(true);
  });
});







// -----------------------------------------------------------
// Words to items
// -----------------------------------------------------------

describe('reading a script', () => {

  it('cuts a script into words: a quoted text and a reference are one word each', () => {
    expect(wordsOf('OP_DUP  "du žodžiai"\n<sig:1> 0xab').map((word) => word.text)).toEqual(['OP_DUP', '"du žodžiai"', '<sig:1>', '0xab']);
    expect(wordsOf('ab  cd')[1]).toEqual({ text: 'cd', start: 4, end: 6 });
    expect(wordsOf('   ')).toEqual([]);
  });


  it('knows an opcode by its name, with the OP_ or without, in any letter case, and by its second name', () => {
    expect(opcodeNamed('OP_DUP').code).toBe(0x76);
    expect(opcodeNamed('dup').code).toBe(0x76);
    expect(opcodeNamed('Op_HASH160').code).toBe(0xa9);
    expect(opcodeNamed('OP_TRUE').name).toBe('OP_1');
    expect(opcodeNamed('OP_CLTV').name).toBe('OP_CHECKLOCKTIMEVERIFY');
    expect(opcodeNamed('OP_NOP3').name).toBe('OP_CHECKSEQUENCEVERIFY');
    expect(opcodeNamed('OP_NOPE')).toBeNull();
    expect(opcodeAt(0xac).name).toBe('OP_CHECKSIG');
    expect(opcodeAt(0xff)).toBeNull();
  });


  it('gives every opcode a byte of its own and a sentence', () => {
    expect(new Set(OPCODES.map((opcode) => opcode.code)).size).toBe(OPCODES.length);
    expect(new Set(OPCODES.map((opcode) => opcode.name)).size).toBe(OPCODES.length);
    expect(OPCODES.every((opcode) => opcode.about.length > 10)).toBe(true);
  });


  it('reads numbers, bytes, texts, opcodes and references', () => {
    const { items, problems } = parseScript('0 -1 16 17 0xA1b2 "labas" \'x y\' op_dup <sig:1> <pubkey:2> <PubKeyHash:1> <redeemScript> <scriptHash>', ['1', '2']);

    expect(problems).toEqual([]);
    expect(told(items)).toEqual([
      'OP_0', 'OP_1NEGATE', 'OP_16', 'push 11', 'push a1b2', 'push 6c61626173', 'push 782079', 'OP_DUP',
      '<sig:1>', '<pubkey:2>', '<pubkeyhash:1>', '<redeemScript>', '<scriptHash>',
    ]);
  });


  it('remembers where in the text every item stands', () => {
    const [first, second] = parseScript('OP_DUP  0xab').items;

    expect([first.text, first.start, first.end]).toEqual(['OP_DUP', 0, 6]);
    expect([second.text, second.start, second.end]).toEqual(['0xab', 8, 12]);
  });


  it.each([
    ['OP_NOPE', 'unknown-word'],
    ['OP_PUSHDATA1', 'pushdata-word'],
    ['0xabc', 'bad-hex'],
    ['0xzz', 'bad-hex'],
    [String(NUMBER_LIMIT + 1), 'number-too-large'],
    ['"begalo', 'open-quote'],
    ['<sig:1', 'open-reference'],
    ['<raktas:1>', 'unknown-reference'],
    ['<sig>', 'reference-needs-name'],
    ['<pubkey:9>', 'unknown-person'],
  ])('says why it cannot read %s', (word, code) => {
    const { items, problems } = parseScript(`OP_DUP ${word}`, ['1']);

    expect(told(items)).toEqual(['OP_DUP']);
    expect(problems.map((problem) => [problem.code, problem.start])).toEqual([[code, 7]]);
  });


  it('fills references in from what the page knows, and says which it could not', () => {
    const { items } = parseScript('<sig:1> <pubkey:1> <redeemScript>', ['1']);
    const filled = resolveScript(items, { publicKeys: { 1: '02aa' }, signatures: {} });

    expect(filled.items.map((item) => item.hex)).toEqual([null, '02aa', null]);
    expect(filled.problems.map((problem) => problem.code)).toEqual(['signature-outside-unlock', 'no-redeem-script']);
  });
});







// -----------------------------------------------------------
// Items to bytes, and back
// -----------------------------------------------------------

describe('a script as bytes', () => {

  it('announces a push by the shortest length that fits', () => {
    expect(pushOf('')).toBe('00');
    expect(pushOf('ab')).toBe('01ab');
    expect(pushOf('ab'.repeat(75)).slice(0, 2)).toBe('4b');
    expect(pushOf('ab'.repeat(76)).slice(0, 4)).toBe('4c4c');
    expect(pushOf('ab'.repeat(255)).slice(0, 4)).toBe('4cff');
    expect(pushOf('ab'.repeat(256)).slice(0, 6)).toBe('4d0001');
  });


  it('writes the everyday lock as the bytes every wallet writes', () => {
    const { items } = resolveScript(
      parseScript('OP_DUP OP_HASH160 <pubkeyhash:1> OP_EQUALVERIFY OP_CHECKSIG', ['1']).items,
      { publicKeyHashes: { 1: reference.keys.Jonas.hash160 } },
    );

    expect(serializeScript(items)).toBe(reference.cases.p2pkh.lock);
  });


  it('reads bytes back into the items they were written from', () => {
    const hex = bytesOf('2 0xa1b2 OP_DUP "labas" OP_CHECKSIG');
    const { items, broken } = readScript(hex);

    expect(broken).toBe(false);
    expect(told(items)).toEqual(['OP_2', 'push a1b2', 'OP_DUP', 'push 6c61626173', 'OP_CHECKSIG']);
    expect(serializeScript(items)).toBe(hex);
  });


  it('says a script is broken when a push announces more bytes than are left', () => {
    expect(readScript('05abcd')).toEqual({ items: [], broken: true });
    expect(readScript('4c').broken).toBe(true);
    expect(readScript('764d0500ab').broken).toBe(true);
  });


  it('turns a byte no opcode was given into a word that fails when reached', () => {
    const [item] = readScript('ff').items;

    expect(item.opcode.state).toBe('reserved');
  });


  it('tells a script that only puts data down from one that does something', () => {
    expect(isPushOnly(parseScript('0 16 0xabcd "x"').items)).toBe(true);
    expect(isPushOnly(parseScript('0 OP_DUP').items)).toBe(false);
    expect(isPushOnly([])).toBe(true);
  });
});







// -----------------------------------------------------------
// The well-known locks
// -----------------------------------------------------------

describe('telling locks apart', () => {

  const { public: publicKey, public_uncompressed: fullKey, hash160: keyHash } = reference.keys.Jonas;
  const other = reference.keys.Gabija.public;

  it.each([
    ['', { kind: 'empty' }],
    [`76a914${keyHash}88ac`, { kind: 'p2pkh', hash: keyHash }],
    [`21${publicKey}ac`, { kind: 'p2pk', publicKey }],
    [`41${fullKey}ac`, { kind: 'p2pk', publicKey: fullKey }],
    [`a914${keyHash}87`, { kind: 'p2sh', hash: keyHash }],
    ['6a0548656c6c6f', { kind: 'data' }],
    [`5221${publicKey}21${other}52ae`, { kind: 'multisig', required: 2, total: 2, publicKeys: [publicKey, other] }],
    ['935587', { kind: 'custom' }],
    [`5321${publicKey}21${other}52ae`, { kind: 'custom' }],
  ])('names the lock %s', (hex, expected) => {
    expect(describeLock(hex)).toEqual(expected);
  });
});

// -----------------------------------------------------------
//  [*] BitcoinScript — the scenes
//
//  What the playground can be set to with one press. A scene
//  is a whole state — the key pairs it needs, the outputs of
//  transaction A, the one B spends, B's scripts and payments
//  — with a word or two for its button and one sentence on
//  what it shows.
//
//  The scenes go from the simplest lock to the hardest: two
//  numbers that must add up, a password, a signature, an
//  address, a shared account, a script behind its hash, a
//  coin frozen until a block, a lock with two ways through —
//  and two that cannot be opened, one by the wrong key and
//  one by anything. Each comes already opened by the right
//  unlocking script, so it can be played at once; emptying
//  the unlocking script turns any of them into a puzzle.
//
//  A scene brings only the key pairs it uses — one for a
//  lock that needs no key, four for a shared account — so the
//  tray of pieces is never longer than the scene needs. The
//  key pairs are always the same ones, with the same numbers,
//  so a script a lecturer shows looks the same on every
//  laptop. The password is hashed here, when the page loads,
//  so the text of this file states it and the lock holds only
//  its hash — as on the chain. The page still calls that hash
//  by what it was made of: the scene puts it on the shelf of
//  data as a piece made on the page.
//
//  Split into:
//
//    JONAS … SIMONA — the starting key pairs' numbers
//    STARTING_KEYS — the four key pairs a scene picks from
//    DEFAULTS     — what every scene starts from
//    TWO_WAYS     — the lock with two ways through
//    EXAMPLES     — the scenes, in order (exported)
//    FIRST_EXAMPLE — the scene the page opens on (exported)
//    scene        — a whole state from the parts that differ
//    hashOf       — a password's SHA-256, as a script writes it
// -----------------------------------------------------------

import { FIRST_NAMES, KEY_COLOURS } from './constants';
import { textToHex } from './engine/bytes';
import { sha256Hex } from './engine/hashes';
import { seedKey } from './engine/keys';
import { payTo } from './model';


// The numbers of the four starting key pairs, by name — a
// script names a key pair by its number
const [JONAS, GABIJA, ROKAS, SIMONA] = [1, 2, 3, 4];

// The key pairs a scene picks from
const STARTING_KEYS = FIRST_NAMES.map((name, index) => ({ id: index + 1, name, colour: KEY_COLOURS[index], privateKey: seedKey(name) }));

// What a scene has unless it says otherwise: nothing on the
// shelf, nothing unlocked yet, no redeem script, no lock
// time, a chain well past the year 2024, keys that sign
// afresh, a coin nobody has spent
const DEFAULTS = { data: [], spent: 0, unlock: '', redeem: '', lockTime: '0', height: '850000', frozen: null, coinSpent: false };

// The lock with two ways through
const TWO_WAYS = `OP_IF <pubkey:${GABIJA}> OP_CHECKSIG OP_ELSE 2 OP_ADD 10 OP_EQUAL OP_ENDIF`;







// -----------------------------------------------------------
// EXAMPLES
// -----------------------------------------------------------
//
// The scenes, in the order their buttons stand: from the
// simplest lock to the hardest. Each has the word on its
// button, one sentence on what it shows, and the state it
// sets.
//
// Used by:
//   - FIRST_EXAMPLE (below)
//   - hooks/usePlayground.js — loading one
//   - components/SceneBar.jsx — the buttons
// -----------------------------------------------------------

export const EXAMPLES = [
  {
    id: 'sum',
    label: 'Suma',
    about: 'Monetą atrakina du skaičiai, kurių suma lygi 5 — jokių raktų. Užraktas juos sudeda ir palygina.',
    state: scene({
      keys: [SIMONA],
      outputs: [['0.1', 'OP_ADD 5 OP_EQUAL']],
      unlock: '2 3',
      payments: [['0.0999', SIMONA]],
    }),
  },
  {
    id: 'password',
    label: 'Slaptažodis',
    about: 'Monetą atrakina žodis, kurio SHA-256 maiša įrašyta užrakte. Parašo nereikia — todėl paskelbtą slaptažodį gali nusirašyti bet kas.',
    state: scene({
      keys: [GABIJA],
      data: [[hashOf('satoshi'), { algorithm: 'SHA-256', source: '„satoshi“' }]],
      outputs: [['0.5', `OP_SHA256 ${hashOf('satoshi')} OP_EQUAL`]],
      unlock: '"satoshi"',
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'p2pk',
    label: 'P2PK',
    about: 'Užrakte — viešasis raktas, atrakina jo savininko parašas. Taip atrodė pirmosios Bitcoin transakcijos 2009 metais.',
    state: scene({
      keys: [JONAS, GABIJA],
      outputs: [['0.5', `<pubkey:${JONAS}> OP_CHECKSIG`]],
      unlock: `<sig:${JONAS}>`,
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'p2pkh',
    label: 'P2PKH',
    about: 'Įprasčiausias užraktas: viešojo rakto maiša, tai yra adresas. Atrakina viešasis raktas, atitinkantis maišą, ir jo parašas.',
    state: scene({
      keys: [JONAS, GABIJA],
      outputs: [['0.5', payTo(JONAS)], ['0.3', payTo(GABIJA)]],
      unlock: `<sig:${JONAS}> <pubkey:${JONAS}>`,
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'multisig',
    label: 'Multisig',
    about: 'Bendra sąskaita: reikia dviejų parašų iš trijų, ta pačia eile kaip raktai užrakte. Nulis pradžioje — sena Bitcoin klaida.',
    state: scene({
      keys: [JONAS, GABIJA, ROKAS, SIMONA],
      outputs: [['0.5', `2 <pubkey:${JONAS}> <pubkey:${GABIJA}> <pubkey:${ROKAS}> 3 OP_CHECKMULTISIG`]],
      unlock: `0 <sig:${JONAS}> <sig:${ROKAS}>`,
      payments: [['0.4999', SIMONA]],
    }),
  },
  {
    id: 'p2sh',
    label: 'P2SH',
    about: 'Užrakte tik skripto maiša. Patį skriptą parodo tas, kas monetą išleidžia — mazgas patikrina maišą, o tada įvykdo ir jį.',
    state: scene({
      keys: [JONAS, GABIJA, ROKAS],
      outputs: [['0.5', 'OP_HASH160 <scriptHash> OP_EQUAL']],
      redeem: `2 <pubkey:${JONAS}> <pubkey:${GABIJA}> 2 OP_CHECKMULTISIG`,
      unlock: `0 <sig:${JONAS}> <sig:${GABIJA}> <redeemScript>`,
      payments: [['0.4999', ROKAS]],
    }),
  },
  {
    id: 'timelock',
    label: 'Laiko užraktas',
    about: 'Moneta užšaldyta iki 840000 bloko: transakcijos B nLockTime turi būti bent toks, o grandinė — jau tiek užaugusi.',
    state: scene({
      keys: [JONAS],
      outputs: [['0.5', `840000 OP_CHECKLOCKTIMEVERIFY OP_DROP ${payTo(JONAS)}`]],
      unlock: `<sig:${JONAS}> <pubkey:${JONAS}>`,
      payments: [['0.4999', JONAS]],
      lockTime: '840000',
    }),
  },
  {
    id: 'two-ways',
    label: 'Du keliai',
    about: 'Užraktas su šakomis: vienu keliu atrakina parašas, kitu — išspręstas uždavinys. Šaką renkasi steko viršus.',
    state: scene({
      keys: [GABIJA],
      outputs: [['0.5', TWO_WAYS]],
      unlock: `<sig:${GABIJA}> 1`,
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'theft',
    label: 'Vagystė',
    about: 'Svetimą monetą bandoma išleisti savo raktu ir savo parašu. Parašas tikras, tik raktas ne tas — žiūrėk, kur mazgas sustoja.',
    state: scene({
      keys: [JONAS, ROKAS],
      outputs: [['0.5', payTo(JONAS)]],
      unlock: `<sig:${ROKAS}> <pubkey:${ROKAS}>`,
      payments: [['0.4999', ROKAS]],
    }),
  },
  {
    id: 'burned',
    label: 'OP_RETURN',
    about: 'OP_RETURN užrakto neatrakina niekas ir niekada. Tokia išvestis skirta duomenims įrašyti, o suma joje prarasta visiems laikams.',
    state: scene({
      keys: [GABIJA],
      outputs: [['0.001', 'OP_RETURN "VU KNF"']],
      unlock: '1',
      payments: [['0.0009', GABIJA]],
    }),
  },
];







// -----------------------------------------------------------
// FIRST_EXAMPLE
// -----------------------------------------------------------
//
// The scene the page opens on: the everyday lock, opened and
// ready to be played.
//
// Used by:
//   - hooks/usePlayground.js — the opening state
// -----------------------------------------------------------

export const FIRST_EXAMPLE = EXAMPLES.find((example) => example.id === 'p2pkh');







// -----------------------------------------------------------
// scene
// -----------------------------------------------------------
//
// A whole state from the parts a scene names: the numbers of
// the key pairs it uses, A's outputs as amount and lock, B's
// payments as amount and the number of the key pair that
// gets it, the pieces of data on the shelf as word and how it
// was made, and whatever else differs from DEFAULTS. Every
// output, payment and piece of data gets a number of its own
// after the key pairs', and the state remembers where the
// numbering stands — the page keeps numbering from there.
//
// Used by:
//   - EXAMPLES (above)
// -----------------------------------------------------------

function scene({ keys, outputs, payments, data = [], ...rest }) {
  const first = STARTING_KEYS.length + 1;
  const numbered = (list, from) => list.map((entry, index) => ({ id: from + index, ...entry }));
  return {
    ...DEFAULTS,
    ...rest,
    keys: STARTING_KEYS.filter((key) => keys.includes(key.id)),
    outputs: numbered(outputs.map(([amount, lock]) => ({ amount, lock })), first),
    payments: numbered(payments.map(([amount, to]) => ({ amount, to })), first + outputs.length),
    data: numbered(data.map(([word, made]) => ({ word, made })), first + outputs.length + payments.length),
    nextId: first + outputs.length + payments.length + data.length,
  };
}







// -----------------------------------------------------------
// hashOf
// -----------------------------------------------------------
//
// The SHA-256 of a password, as the bytes a lock compares
// against.
//
// Used by:
//   - EXAMPLES (above)
// -----------------------------------------------------------

function hashOf(password) {
  return `0x${sha256Hex(textToHex(password))}`;
}

// -----------------------------------------------------------
//  [*] BitcoinScript — the scenes
//
//  What the playground can be set to with one press. A scene
//  is a whole state — the key pairs it needs, the outputs of
//  transaction A, the one B spends, B's scripts and payments
//  — with a word or two for its button and one or two
//  sentences on what it shows. Each comes already opened by
//  the right unlocking script, so it can be played at once;
//  emptying the unlocking script turns any of them into a
//  puzzle.
//
//  The scenes come in groups.
//
//  The locks go from the simplest to the hardest: no lock at
//  all, two numbers that must add up, a password, two puzzles
//  that were really on the chain — a coin locked to the hash
//  of Bitcoin's first block, and a bounty for breaking SHA-1
//  — then a signature, an address, a shared account, a script
//  behind its hash, a lock with two ways through — and two
//  that cannot be opened, one by the wrong key and one by
//  anything.
//
//  Time holds the locks that wait: until a block, for a
//  number of blocks since the coin was made, and the two put
//  to use — a coin that passes to an heir if its owner leaves
//  it alone for a year.
//
//  SegWit holds the locks that are not scripts but witness
//  programs, in the four forms wallets have used since 2017:
//  to a key's hash and to a script's hash, each bare and each
//  wrapped in a script hash so that an old wallet can pay to
//  it. What opens them travels in the witness.
//
//  Taproot holds the newest lock, a single key that may hide
//  a tree of scripts: opened by the key alone; opened by one
//  of two hidden scripts, with the proof that the key hides
//  it; a shared account whose script counts signatures the
//  Taproot way; and the two-byte program nobody has given
//  rules, which Lightning uses as an anchor for fees.
//
//  Lightning holds the outputs of a channel's commitment
//  transaction, as the network's own specification writes
//  them (BOLT 3, in the form without anchors): the holder's
//  own share, which he can take only after a delay and the
//  other side can take at once with the revocation key; and
//  the two kinds of payment in flight, each with its three
//  ways out. Every one of these scripts stands behind its
//  hash, as a witness script, and what opens it travels in
//  the witness; the other side's share is a plain payment to
//  a witness key hash. Transaction A is the commitment
//  transaction of Jonas, with its outputs in the order the
//  specification puts them in. The page has one witness
//  script at a time, so in a scene about a payment the
//  holder's own share shows only the hash it is locked to.
//
//  The swaps are contracts that exist: the one the Decred
//  project's atomicswap tool writes — the same script on
//  both chains of a swap, here Bitcoin and Litecoin, hanging
//  on one secret — and the script of a submarine swap as the
//  Boltz exchange builds it, which trades a coin on the chain
//  for a payment on Lightning. One thing is told differently
//  from the tool: it writes a contract's time limit as a
//  date, and the playground, which has no clock, as a block.
//
//  A scene brings only the key pairs it uses — one for a
//  lock that needs no key, four for a shared account — so the
//  tray of pieces is never longer than the scene needs. The
//  key pairs are always the same ones, with the same numbers,
//  so a script a lecturer shows looks the same on every
//  laptop. A password or a secret is hashed here, when the
//  page loads, so the text of this file states it and the
//  lock holds only its hash — as on the chain. The page still
//  calls that hash by what it was made of: the scene puts it
//  on the shelf of data as a piece made on the page.
//
//  Split into:
//
//    JONAS … REVOCATION — the starting key pairs' numbers
//    STARTING_KEYS — the key pairs a scene picks from
//    DEFAULTS     — what every scene starts from
//    TWO_WAYS     — the lock with two ways through
//    PREIMAGE, SWAP_SECRET — the two thirty-two byte secrets
//    COLLISION_BOUNTY … INHERITANCE — the longer of the locks
//    TWO_OF_THREE, TAP_GABIJA, TAP_PASSWORD, COUNTED — the
//                   scripts behind a hash or a Taproot key
//    TO_LOCAL … SUBMARINE — the scripts of Lightning and swaps
//    GROUPS       — the groups, in order (exported)
//    EXAMPLES     — the scenes, in order (exported)
//    FIRST_EXAMPLE — the scene the page opens on (exported)
//    scene        — a whole state from the parts that differ
//    hashedLock   — the lock to a script's hash, written out
//    hashOf       — a text's hash, as a script writes it
//    madeFrom     — how such a hash was made, for the shelf
//    named        — bytes with a name, for the shelf
// -----------------------------------------------------------

import { GENESIS_HEADER, SHA1_COLLISION } from './chaindata';
import { FIRST_NAMES, KEY_COLOURS } from './constants';
import { textToHex } from './engine/bytes';
import { hash160, hash256, sha256Hex } from './engine/hashes';
import { keyFrom, seedKey } from './engine/keys';
import { parseScript, resolveScript, serializeScript } from './engine/script';
import { payTo } from './model';
import { quote } from './narration';


// The numbers of the starting key pairs, by name — a script
// names a key pair by its number. The fifth is no person: it
// is the revocation key of a Lightning channel
const [JONAS, GABIJA, ROKAS, SIMONA, REVOCATION] = [1, 2, 3, 4, 5];

// The key pairs a scene picks from
const STARTING_KEYS = [...FIRST_NAMES, 'Atšaukimas'].map((name, index) => ({ id: index + 1, name, colour: KEY_COLOURS[index], privateKey: seedKey(name) }));

// What a scene has unless it says otherwise: Bitcoin's chain,
// nothing on the shelf, nothing unlocked yet and no witness,
// no script behind a hash or a Taproot key, no lock time,
// whatever sequence number the transaction needs, a chain
// well past the year 2024 with transaction A deep inside it,
// keys that sign afresh, a coin nobody has spent
const DEFAULTS = {
  chain: 'btc', data: [], spent: 0, unlock: '', witness: '', redeem: '', witnessScript: '', leaves: ['', ''], lockTime: '0', sequence: '', height: '850000', mined: '800000', frozen: null, coinSpent: false,
};

// The lock with two ways through
const TWO_WAYS = `OP_IF <pubkey:${GABIJA}> OP_CHECKSIG OP_ELSE 2 OP_ADD 10 OP_EQUAL OP_ENDIF`;

// The secret of a Lightning payment — thirty-two bytes, as
// its scripts demand, written as words a student can read
const PREIMAGE = 'lightning mokėjimo slaptažodis';

// The secret of the swap between two chains, thirty-two bytes
// as well
const SWAP_SECRET = 'Jono ir Gabijos mainų paslaptis';

// The bounty for two pieces of data with one SHA-1 hash: they
// must differ, and their hashes must not
const COLLISION_BOUNTY = 'OP_2DUP OP_EQUAL OP_NOT OP_VERIFY OP_SHA1 OP_SWAP OP_SHA1 OP_EQUAL';

// A coin its owner can spend at any time, and an heir once it
// has lain still for 52560 blocks — about a year
const INHERITANCE = `OP_IF <pubkey:${JONAS}> OP_ELSE 52560 OP_CHECKSEQUENCEVERIFY OP_DROP <pubkey:${GABIJA}> OP_ENDIF OP_CHECKSIG`;

// The shared account the SegWit scenes put behind a hash: two
// signatures out of three keys
const TWO_OF_THREE = `2 <pubkey:${JONAS}> <pubkey:${GABIJA}> <pubkey:${ROKAS}> 3 OP_CHECKMULTISIG`;

// The first of the two scripts hidden in Jonas's Taproot key:
// Gabija's signature
const TAP_GABIJA = `<xonly:${GABIJA}> OP_CHECKSIG`;

// The second: a password, and Rokas's signature
const TAP_PASSWORD = `OP_SHA256 ${hashOf(sha256Hex, 'taproot')} OP_EQUALVERIFY <xonly:${ROKAS}> OP_CHECKSIG`;

// A shared account the Taproot way: every key in turn adds
// one to a count if its signature is there, and the count has
// to come to two
const COUNTED = `<xonly:${JONAS}> OP_CHECKSIG <xonly:${GABIJA}> OP_CHECKSIGADD <xonly:${ROKAS}> OP_CHECKSIGADD 2 OP_NUMEQUAL`;

// A commitment transaction's output to its own holder: the
// other side with the revocation key at once, or the holder
// after 144 blocks
const TO_LOCAL = `OP_IF <pubkey:${REVOCATION}> OP_ELSE 144 OP_CHECKSEQUENCEVERIFY OP_DROP <pubkey:${JONAS}> OP_ENDIF OP_CHECKSIG`;

// A payment the holder offers: the revocation key, or the
// other side with the payment's secret, or both signatures
// once the payment has timed out
const HTLC_OFFERED = [
  `OP_DUP OP_HASH160 <pubkeyhash:${REVOCATION}> OP_EQUAL`,
  'OP_IF OP_CHECKSIG',
  `OP_ELSE <pubkey:${GABIJA}> OP_SWAP OP_SIZE 32 OP_EQUAL`,
  `OP_NOTIF OP_DROP 2 OP_SWAP <pubkey:${JONAS}> 2 OP_CHECKMULTISIG`,
  `OP_ELSE OP_HASH160 ${hashOf(hash160, PREIMAGE)} OP_EQUALVERIFY OP_CHECKSIG`,
  'OP_ENDIF OP_ENDIF',
].join(' ');

// A payment the holder is offered: the revocation key, or
// both signatures with the payment's secret, or the other
// side alone from block 850040 on
const HTLC_RECEIVED = [
  `OP_DUP OP_HASH160 <pubkeyhash:${REVOCATION}> OP_EQUAL`,
  'OP_IF OP_CHECKSIG',
  `OP_ELSE <pubkey:${GABIJA}> OP_SWAP OP_SIZE 32 OP_EQUAL`,
  `OP_IF OP_HASH160 ${hashOf(hash160, PREIMAGE)} OP_EQUALVERIFY 2 OP_SWAP <pubkey:${JONAS}> 2 OP_CHECKMULTISIG`,
  'OP_ELSE OP_DROP 850040 OP_CHECKLOCKTIMEVERIFY OP_DROP OP_CHECKSIG',
  'OP_ENDIF OP_ENDIF',
].join(' ');

// The swap contract on Bitcoin: Gabija with the secret, or
// Jonas again from block 850288 on
const SWAP_BTC = [
  `OP_IF OP_SIZE 32 OP_EQUALVERIFY OP_SHA256 ${hashOf(sha256Hex, SWAP_SECRET)} OP_EQUALVERIFY OP_DUP OP_HASH160 <pubkeyhash:${GABIJA}>`,
  `OP_ELSE 850288 OP_CHECKLOCKTIMEVERIFY OP_DROP OP_DUP OP_HASH160 <pubkeyhash:${JONAS}>`,
  'OP_ENDIF OP_EQUALVERIFY OP_CHECKSIG',
].join(' ');

// The same contract on Litecoin, the two of them changing
// places: Jonas with the secret, or Gabija again from block
// 3200576 on
const SWAP_LTC = [
  `OP_IF OP_SIZE 32 OP_EQUALVERIFY OP_SHA256 ${hashOf(sha256Hex, SWAP_SECRET)} OP_EQUALVERIFY OP_DUP OP_HASH160 <pubkeyhash:${JONAS}>`,
  `OP_ELSE 3200576 OP_CHECKLOCKTIMEVERIFY OP_DROP OP_DUP OP_HASH160 <pubkeyhash:${GABIJA}>`,
  'OP_ENDIF OP_EQUALVERIFY OP_CHECKSIG',
].join(' ');

// The script of a submarine swap: Simona with the secret of
// the Lightning payment she made, or Jonas again from block
// 850144 on
const SUBMARINE = `OP_HASH160 ${hashOf(hash160, PREIMAGE)} OP_EQUAL OP_IF <pubkey:${SIMONA}> OP_ELSE 850144 OP_CHECKLOCKTIMEVERIFY OP_DROP <pubkey:${JONAS}> OP_ENDIF OP_CHECKSIG`;







// -----------------------------------------------------------
// GROUPS
// -----------------------------------------------------------
//
// The groups the scenes come in, in the order their names
// stand above the scenes' buttons.
//
// Used by:
//   - components/SceneBar.jsx — the groups to choose from
// -----------------------------------------------------------

export const GROUPS = [
  { key: 'locks', title: 'Užraktai' },
  { key: 'time', title: 'Laikas' },
  { key: 'segwit', title: 'SegWit' },
  { key: 'taproot', title: 'Taproot' },
  { key: 'lightning', title: 'Lightning' },
  { key: 'swaps', title: 'Atominiai mainai' },
];







// -----------------------------------------------------------
// EXAMPLES
// -----------------------------------------------------------
//
// The scenes, in the order their buttons stand, group after
// group. Each has its group, the word on its button, what it
// shows in a sentence or two, and the state it sets.
//
// Used by:
//   - FIRST_EXAMPLE (below)
//   - hooks/usePlayground.js — loading one
//   - components/SceneBar.jsx — the buttons
// -----------------------------------------------------------

export const EXAMPLES = [
  {
    id: 'anyone',
    group: 'locks',
    label: 'OP_TRUE',
    about: 'Užraktas, kuris nieko neklausia: monetą pasiima bet kas, kas pirmas paskelbia transakciją, o atrakinimo skriptas lieka tuščias. Seniems mazgams taip atrodo ir SegWit išvestys.',
    state: scene({
      keys: [SIMONA],
      outputs: [['0.01', '1']],
      payments: [['0.0099', SIMONA]],
    }),
  },
  {
    id: 'sum',
    group: 'locks',
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
    group: 'locks',
    label: 'Slaptažodis',
    about: 'Monetą atrakina žodis, kurio SHA-256 maiša įrašyta užrakte. Parašo nereikia — todėl paskelbtą slaptažodį gali nusirašyti bet kas.',
    state: scene({
      keys: [GABIJA],
      data: [madeFrom('SHA-256', sha256Hex, 'satoshi')],
      outputs: [['0.5', `OP_SHA256 ${hashOf(sha256Hex, 'satoshi')} OP_EQUAL`]],
      unlock: '"satoshi"',
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'genesis',
    group: 'locks',
    label: 'Genesis galvosūkis',
    about: 'Užrakte — pirmojo Bitcoin bloko maiša. Atrakina duomenys, kurių dviguba SHA-256 ją duoda: paties bloko antraštė, 80 baitų. Tikra 2012 metų transakcija — parašo jai nereikėjo.',
    state: scene({
      keys: [ROKAS],
      data: [named(GENESIS_HEADER, 'bloko Nr. 0 antraštė'), [`0x${hash256(GENESIS_HEADER)}`, { algorithm: 'HASH256', source: 'bloko Nr. 0 antraštė' }]],
      outputs: [['1', `OP_HASH256 0x${hash256(GENESIS_HEADER)} OP_EQUAL`]],
      unlock: `0x${GENESIS_HEADER}`,
      payments: [['0.9999', ROKAS]],
      height: '212032',
      mined: '211997',
    }),
  },
  {
    id: 'collision',
    group: 'locks',
    label: 'SHA-1 kolizija',
    about: '2013 metais užrakinta premija tam, kas parodys du skirtingus duomenis su ta pačia SHA-1 maiša. 2017-aisiais, paskelbus „SHAttered“ ataką, ją atrakino šie du 320 baitų gabalai.',
    state: scene({
      keys: [GABIJA],
      data: [named(SHA1_COLLISION[0], 'pirmas PDF'), named(SHA1_COLLISION[1], 'antras PDF')],
      outputs: [['2.48', 'OP_HASH160 <scriptHash> OP_EQUAL']],
      redeem: COLLISION_BOUNTY,
      unlock: `0x${SHA1_COLLISION[0]} 0x${SHA1_COLLISION[1]} <redeemScript>`,
      payments: [['2.4799', GABIJA]],
      height: '454315',
      mined: '257665',
    }),
  },
  {
    id: 'p2pk',
    group: 'locks',
    label: 'P2PK',
    about: 'Užrakte — viešasis raktas, atrakina jo savininko parašas. Taip atrodė pirmosios Bitcoin transakcijos 2009 metais, tik raktai tada buvo nesuglaudinti — 65 baitų.',
    state: scene({
      keys: [JONAS, GABIJA],
      outputs: [['0.5', `<pubkey:${JONAS}> OP_CHECKSIG`]],
      unlock: `<sig:${JONAS}>`,
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'p2pkh',
    group: 'locks',
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
    group: 'locks',
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
    group: 'locks',
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
    id: 'two-ways',
    group: 'locks',
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
    group: 'locks',
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
    group: 'locks',
    label: 'OP_RETURN',
    about: 'OP_RETURN užrakto neatrakina niekas ir niekada. Tokia išvestis skirta duomenims įrašyti, o suma joje prarasta visiems laikams.',
    state: scene({
      keys: [GABIJA],
      outputs: [['0.001', 'OP_RETURN "VU KNF"']],
      unlock: '1',
      payments: [['0.0009', GABIJA]],
    }),
  },
  {
    id: 'timelock',
    group: 'time',
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
    id: 'relative',
    group: 'time',
    label: 'Santykinis užraktas',
    about: 'Moneta užšaldyta ne iki kurio nors bloko, o tam tikram laikui nuo jos pačios patekimo į grandinę: įvesties nSequence turi būti bent 144, o moneta — bent tiek blokų senumo.',
    state: scene({
      keys: [JONAS],
      outputs: [['0.5', `144 OP_CHECKSEQUENCEVERIFY OP_DROP ${payTo(JONAS)}`]],
      unlock: `<sig:${JONAS}> <pubkey:${JONAS}>`,
      payments: [['0.4999', JONAS]],
      sequence: '144',
      mined: '849800',
    }),
  },
  {
    id: 'inheritance',
    group: 'time',
    label: 'Paveldėjimas',
    about: 'Jonas savo monetą gali išleisti bet kada. Jei ji nepajuda 52560 blokų — maždaug metus, — ją gali pasiimti Gabija. Kol Jonas monetą kartkartėmis perkelia, laikas skaičiuojamas iš naujo.',
    state: scene({
      keys: [JONAS, GABIJA],
      outputs: [['0.5', INHERITANCE]],
      unlock: `<sig:${GABIJA}> 0`,
      payments: [['0.4999', GABIJA]],
      sequence: '52560',
      mined: '790000',
    }),
  },
  {
    id: 'p2wpkh',
    group: 'segwit',
    label: 'P2WPKH',
    about: 'Tas pats mokėjimas rakto maišai, tik užrakte liko vien maiša, o parašas ir viešasis raktas iškelti į witness — atskirą transakcijos dalį. Įprastą P2PKH skriptą mazgas sudaro pats.',
    state: scene({
      keys: [JONAS, GABIJA],
      outputs: [['0.5', `0 <pubkeyhash:${JONAS}>`]],
      witness: `<sig:${JONAS}> <pubkey:${JONAS}>`,
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'p2wsh',
    group: 'segwit',
    label: 'P2WSH',
    about: 'Užrakte — skripto SHA-256 maiša. Pats skriptas (witness script) keliauja witness gale, o prieš jį — tai, kas jį atrakina. Ta pati sąskaita „2 iš 3“, tik grandinėje matyti vien maiša.',
    state: scene({
      keys: [JONAS, GABIJA, ROKAS, SIMONA],
      outputs: [['0.5', '0 <witnessHash>']],
      witnessScript: TWO_OF_THREE,
      witness: `0 <sig:${JONAS}> <sig:${ROKAS}> <witnessScript>`,
      payments: [['0.4999', SIMONA]],
    }),
  },
  {
    id: 'p2sh-p2wpkh',
    group: 'segwit',
    label: 'P2SH-P2WPKH',
    about: 'Witness program, įvyniota į seną P2SH adresą, kad monetą atsiųstų ir SegWit nepažįstanti piniginė. Atrakinimo skripte lieka tik ji pati, o parašas ir raktas keliauja į witness.',
    state: scene({
      keys: [JONAS, GABIJA],
      outputs: [['0.5', 'OP_HASH160 <scriptHash> OP_EQUAL']],
      redeem: `0 <pubkeyhash:${JONAS}>`,
      unlock: '<redeemScript>',
      witness: `<sig:${JONAS}> <pubkey:${JONAS}>`,
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'p2sh-p2wsh',
    group: 'segwit',
    label: 'P2SH-P2WSH',
    about: 'Trys sluoksniai: P2SH maiša slepia witness program, o ši — skripto maišą. Mazgas atidaro juos iš eilės — išpirkimo skriptą, tada witness script.',
    state: scene({
      keys: [JONAS, GABIJA, ROKAS, SIMONA],
      outputs: [['0.5', 'OP_HASH160 <scriptHash> OP_EQUAL']],
      redeem: '0 <witnessHash>',
      witnessScript: TWO_OF_THREE,
      unlock: '<redeemScript>',
      witness: `0 <sig:${GABIJA}> <sig:${ROKAS}> <witnessScript>`,
      payments: [['0.4999', SIMONA]],
    }),
  },
  {
    id: 'p2tr-key',
    group: 'taproot',
    label: 'P2TR raktu',
    about: 'Užrakte — vienas 32 baitų raktas (output key), witness — vienas Schnorr parašas. Skripto nėra: mazgas tikrina parašą pačiam raktui, ir grandinėje tokia transakcija atrodo kaip bet kuri kita.',
    state: scene({
      keys: [JONAS, GABIJA],
      outputs: [['0.5', `1 <tapkey:${JONAS}>`]],
      witness: `<sig:${JONAS}>`,
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'p2tr-script',
    group: 'taproot',
    label: 'P2TR skriptu',
    about: 'Rakte slypi du skriptai: Gabijos parašas — arba slaptažodis ir Roko parašas. Parodomas tik naudojamas, su control block — įrodymu, kad jis ten yra. Palik witness vien Jono parašą — skriptų nereikės.',
    state: scene({
      keys: [JONAS, GABIJA, ROKAS],
      data: [madeFrom('SHA-256', sha256Hex, 'taproot')],
      outputs: [['0.5', `1 <tapkey:${JONAS}>`]],
      leaves: [TAP_GABIJA, TAP_PASSWORD],
      witness: `<sig:${ROKAS}> "taproot" <leafB> <controlB>`,
      payments: [['0.4999', ROKAS]],
    }),
  },
  {
    id: 'p2tr-counted',
    group: 'taproot',
    label: 'CHECKSIGADD',
    about: 'Simona šią monetą gali išleisti viena, savo raktu. Be jos — bet kurie du iš trijų: skripte parašai skaičiuojami žodžiu OP_CHECKSIGADD, o tuščias witness elementas reiškia „šis nepasirašo“.',
    state: scene({
      keys: [JONAS, GABIJA, ROKAS, SIMONA],
      outputs: [['0.5', `1 <tapkey:${SIMONA}>`]],
      leaves: [COUNTED, ''],
      witness: `<sig:${ROKAS}> 0 <sig:${JONAS}> <leafA> <controlA>`,
      payments: [['0.4999', GABIJA]],
    }),
  },
  {
    id: 'p2a',
    group: 'taproot',
    label: 'Anchor (P2A)',
    about: 'Witness program iš versijos 1 ir dviejų baitų. Taisyklių jai nėra, todėl ją išleidžia bet kas, be parašo. Tokį anchor Lightning deda į kanalo transakciją, kad prie jo galėtų prikabinti mokestį.',
    state: scene({
      keys: [SIMONA],
      outputs: [['0.0000024', '1 0x4e73']],
      payments: [['0.000001', SIMONA]],
    }),
  },
  {
    id: 'ln-to-local',
    group: 'lightning',
    label: 'to_local',
    about: 'Jono dalis jo paties paskelbtoje kanalo transakcijoje, užrakinta skripto maišai. Atsiimti ją jis gali tik po 144 blokų: įvesties nSequence turi būti 144, o moneta — bent tiek blokų senumo.',
    state: scene({
      keys: [JONAS, GABIJA, REVOCATION],
      outputs: [['0.02', `0 <pubkeyhash:${GABIJA}>`], ['0.03', '0 <witnessHash>']],
      spent: 1,
      witnessScript: TO_LOCAL,
      witness: `<sig:${JONAS}> 0 <witnessScript>`,
      payments: [['0.0299', JONAS]],
      sequence: '144',
      mined: '849800',
    }),
  },
  {
    id: 'ln-penalty',
    group: 'lightning',
    label: 'Bauda',
    about: 'Jonas paskelbė seną, jau atšauktą kanalo būseną. Gabija žino atšaukimo raktą ir pasiima jo dalį iškart — kol Jonas dar laukia savo 144 blokų.',
    state: scene({
      keys: [JONAS, GABIJA, REVOCATION],
      outputs: [['0.02', `0 <pubkeyhash:${GABIJA}>`], ['0.03', '0 <witnessHash>']],
      spent: 1,
      witnessScript: TO_LOCAL,
      witness: `<sig:${REVOCATION}> 1 <witnessScript>`,
      payments: [['0.0299', GABIJA]],
      mined: '849998',
    }),
  },
  {
    id: 'ln-htlc-offered',
    group: 'lightning',
    label: 'HTLC siūlomas',
    about: 'Jonas per kanalą siunčia mokėjimą. Gabija pasiima monetą parodžiusi 32 baitų mokėjimo slaptažodį; kiti du keliai — atšaukimo raktas arba abiejų parašai, kai mokėjimo laikas baigiasi.',
    state: scene({
      keys: [JONAS, GABIJA, REVOCATION],
      data: [madeFrom('HASH160', hash160, PREIMAGE)],
      outputs: [['0.001', '0 <witnessHash>'], ['0.02', `0 <pubkeyhash:${GABIJA}>`], ['0.029', hashedLock(TO_LOCAL)]],
      witnessScript: HTLC_OFFERED,
      witness: `<sig:${GABIJA}> "${PREIMAGE}" <witnessScript>`,
      payments: [['0.0009', GABIJA]],
      mined: '849998',
    }),
  },
  {
    id: 'ln-htlc-received',
    group: 'lightning',
    label: 'HTLC gautas',
    about: 'Mokėjimas atėjo Jonui, bet slaptažodžio jis neparodė. Nuo 850040 bloko Gabija atsiima monetą viena; su slaptažodžiu ją būtų paėmęs Jonas — abiejų parašais.',
    state: scene({
      keys: [JONAS, GABIJA, REVOCATION],
      data: [madeFrom('HASH160', hash160, PREIMAGE)],
      outputs: [['0.001', '0 <witnessHash>'], ['0.02', `0 <pubkeyhash:${GABIJA}>`], ['0.029', hashedLock(TO_LOCAL)]],
      witnessScript: HTLC_RECEIVED,
      witness: `<sig:${GABIJA}> 0 <witnessScript>`,
      payments: [['0.0009', GABIJA]],
      lockTime: '850040',
      height: '850100',
      mined: '850010',
    }),
  },
  {
    id: 'swap-ltc',
    group: 'swaps',
    label: 'Mainas LTC',
    about: 'Jonas keičia BTC į Gabijos LTC. Litecoin grandinėje jis pasiima jos monetą parodydamas paslaptį, kurios maiša įrašyta abiejų grandinių sutartyse, — ir taip paslaptį paskelbia.',
    state: scene({
      chain: 'ltc',
      keys: [JONAS, GABIJA],
      data: [madeFrom('SHA-256', sha256Hex, SWAP_SECRET)],
      outputs: [['1', 'OP_HASH160 <scriptHash> OP_EQUAL']],
      redeem: SWAP_LTC,
      unlock: `<sig:${JONAS}> <pubkey:${JONAS}> "${SWAP_SECRET}" 1 <redeemScript>`,
      payments: [['0.9999', JONAS]],
      height: '3200000',
      mined: '3199990',
    }),
  },
  {
    id: 'swap-btc',
    group: 'swaps',
    label: 'Mainas BTC',
    about: 'Antroji tų pačių mainų pusė, jau Bitcoin grandinėje: paslaptį, kurią Jonas ką tik paskelbė Litecoin grandinėje, Gabija panaudoja jo BTC pasiimti. Sutartis ta pati, tik vaidmenys sukeisti.',
    state: scene({
      keys: [JONAS, GABIJA],
      data: [madeFrom('SHA-256', sha256Hex, SWAP_SECRET)],
      outputs: [['0.001', 'OP_HASH160 <scriptHash> OP_EQUAL']],
      redeem: SWAP_BTC,
      unlock: `<sig:${GABIJA}> <pubkey:${GABIJA}> "${SWAP_SECRET}" 1 <redeemScript>`,
      payments: [['0.0009', GABIJA]],
      mined: '849990',
    }),
  },
  {
    id: 'swap-refund',
    group: 'swaps',
    label: 'Grąžinimas',
    about: 'Mainai neįvyko: paslapties niekas neparodė. Nuo 850288 bloko — maždaug po 48 valandų — Jonas atsiima savo BTC pats. Gabijos sutartis Litecoin grandinėje baigiasi perpus anksčiau.',
    state: scene({
      keys: [JONAS, GABIJA],
      data: [madeFrom('SHA-256', sha256Hex, SWAP_SECRET)],
      outputs: [['0.001', 'OP_HASH160 <scriptHash> OP_EQUAL']],
      redeem: SWAP_BTC,
      unlock: `<sig:${JONAS}> <pubkey:${JONAS}> 0 <redeemScript>`,
      payments: [['0.0009', JONAS]],
      lockTime: '850288',
      height: '850300',
      mined: '849990',
    }),
  },
  {
    id: 'submarine',
    group: 'swaps',
    label: 'Submarine',
    about: 'Mainai tarp grandinės ir Lightning: Jonas užrakina BTC, Simona apmoka jo Lightning sąskaitą ir taip sužino jos slaptažodį — juo pasiima monetą. Neapmokėjus Jonas nuo 850144 bloko ją atsiima.',
    state: scene({
      keys: [JONAS, SIMONA],
      data: [madeFrom('HASH160', hash160, PREIMAGE)],
      outputs: [['0.002', 'OP_HASH160 <scriptHash> OP_EQUAL']],
      redeem: SUBMARINE,
      unlock: `<sig:${SIMONA}> "${PREIMAGE}" <redeemScript>`,
      payments: [['0.0019', SIMONA]],
      mined: '849995',
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
// gets it, the pieces of data on the shelf as word, how it
// was made and, for bytes that are no hash, their name, and
// whatever else differs from DEFAULTS. Every
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
    data: numbered(data.map(([word, made, name = null]) => ({ word, made, name })), first + outputs.length + payments.length),
    nextId: first + outputs.length + payments.length + data.length,
  };
}







// -----------------------------------------------------------
// hashedLock
// -----------------------------------------------------------
//
// The lock that pays to the hash of a script — a witness
// program of version 0 with the script's SHA-256 — as the
// words of a script, the hash written out. It is for an
// output a scene shows but is not about: the page's one
// witness script belongs to the coin being spent, and this
// output's script is another. The script's key pairs are the
// starting ones.
//
// Used by:
//   - EXAMPLES (above) — the holder's own share beside a
//     Lightning payment
// -----------------------------------------------------------

function hashedLock(script) {
  const made = STARTING_KEYS.map((key) => ({ id: key.id, ...keyFrom(key.privateKey) }));
  const { items } = resolveScript(parseScript(script, made.map((key) => String(key.id))).items, {
    publicKeys: Object.fromEntries(made.map((key) => [key.id, key.publicKey])),
    publicKeyHashes: Object.fromEntries(made.map((key) => [key.id, key.publicKeyHash])),
  });
  return `0 0x${sha256Hex(serializeScript(items))}`;
}







// -----------------------------------------------------------
// hashOf
// -----------------------------------------------------------
//
// The hash of a text by one of the engine's hash functions,
// as the bytes a lock compares against.
//
// Used by:
//   - the scripts and EXAMPLES (above)
//   - madeFrom (below)
// -----------------------------------------------------------

function hashOf(hash, text) {
  return `0x${hash(textToHex(text))}`;
}







// -----------------------------------------------------------
// madeFrom
// -----------------------------------------------------------
//
// A hash as a piece of data on a scene's shelf: the word a
// script writes it with, and how it was made — the name the
// hash goes by and the text it is the hash of — so the page
// calls the bytes by that wherever they turn up.
//
// Used by:
//   - EXAMPLES (above)
// -----------------------------------------------------------

function madeFrom(algorithm, hash, text) {
  return [hashOf(hash, text), { algorithm, source: quote(text) }];
}







// -----------------------------------------------------------
// named
// -----------------------------------------------------------
//
// Bytes too long to read as a piece of data on a scene's
// shelf, under a name: the word a script writes them with,
// and the name the page calls them by wherever they turn up.
//
// Used by:
//   - EXAMPLES (above)
// -----------------------------------------------------------

function named(hex, name) {
  return [`0x${hex}`, null, name];
}

// -----------------------------------------------------------
//  [*] BitcoinScript — the playground's words
//
//  The engine answers in codes and bytes; this file turns
//  them into what a student reads, in Lithuanian. One place
//  for all of it, so the same thing is called the same way on
//  the transactions, in the scripts, on the stack and in the
//  explanation of a step:
//
//    - a value is named for what it is — a key pair's public
//      key, that key's hash, its signature — whenever the
//      page knows (the model's lexicon), and otherwise shown
//      as the number, the word or the shortened bytes it
//      holds
//    - a lock is named by its kind and, where there is one,
//      the key pair it belongs to
//    - every problem in what was built and every reason a
//      node can turn a transaction down has its sentence
//    - every step of the node's check is told: what the node
//      asks at this point, what the opcode does, what came
//      of it
//
//  A key pair's name is whatever the student calls it, so no
//  sentence here bends it: the name always stands in quotes
//  after the thing it owns — parašas „Jonas“ — and on a tile
//  it stands beside the short word every Bitcoin text uses
//  for the thing: sig, pubKey, pubKeyHash.
//
//  The unlocking script is never called a key, apt as that
//  would be for something that opens a lock: on this page
//  "raktas" already means a public or a private key, and the
//  two must not be mixed up. The scripts go by "užraktas" and
//  "atrakinimas".
//
//  Split into:
//
//    STAGES, PHASES    — the node's questions, the scripts' names
//    formatAmount      — satoshis as an amount
//    shortHex          — long bytes, shortened
//    quote             — a text in quotes, shortened when long
//    sequenceMeaning   — what a sequence number promises
//    ageText           — a coin's age, in confirmations
//    labelOf           — a value's name
//    itemLabel         — a script item's name
//    wordLabel         — the name of a word in a script's row
//    looseLabel        — the name of a word not in a script yet
//    lockName          — a lock's name
//    problemText       — why something built cannot be read
//    whereText         — where on the page a problem sits
//    errorText         — why a node says no
//    effectLines       — what an opcode came to, told
//    narrate           — one step of the node's check, told
// -----------------------------------------------------------

import { pluralForm } from '@/utils/plural';

import { SATOSHIS } from './constants';
import { byteLength, hexToText } from './engine/bytes';
import { FINAL_SEQUENCE, SEQUENCE, hasBit } from './engine/node';
import { isTrue, numberOf, parseScript } from './engine/script';


// How a counted stack item is declined after "reikia"
const ITEMS_NEEDED = { one: 'steko elemento', few: 'steko elementų', other: 'steko elementų' };

// How a counted byte is declined after a number
const BYTES = { one: 'baitas', few: 'baitai', other: 'baitų' };

// The same, as what something takes up
const BYTES_TAKEN = { one: 'baitą', few: 'baitus', other: 'baitų' };

// How counted signatures are declined after "reikia"
const SIGNATURES_NEEDED = { one: 'tinkamo parašo', few: 'tinkamų parašų', other: 'tinkamų parašų' };

// How counted keys are declined after "iš"
const KEYS_OUT_OF = { one: 'rakto', few: 'raktų', other: 'raktų' };

// How counted blocks are declined in front of "senumo"
const BLOCKS_OLD = { one: 'bloko', few: 'blokų', other: 'blokų' };

// How counted confirmations are declined after "turi"
const CONFIRMATIONS_HAD = { one: 'patvirtinimą', few: 'patvirtinimus', other: 'patvirtinimų' };

// How long a text may be before a tile shows only its two ends
const LONG_TEXT = 24;

// What a named value is, by its kind: in a sentence, in the
// short word Bitcoin texts use for it, and explained
const KINDS = {
  sig: { name: 'parašas', short: 'sig', about: 'Parašas privačiu raktu — juo pasirašoma transakcija B.' },
  pubkey: { name: 'viešasis raktas', short: 'pubKey', about: 'Viešasis raktas — juo tikrinami parašai.' },
  pubkeyhash: { name: 'rakto maiša', short: 'pubKeyHash', about: 'Viešojo rakto maiša (HASH160) — iš jos sudarytas adresas.' },
  redeemScript: { name: 'išpirkimo skriptas', short: 'redeemScript', about: 'Išpirkimo skriptas — tas, kurio maiša užrakinta moneta.' },
  scriptHash: { name: 'išpirkimo skripto maiša', short: 'scriptHash', about: 'Išpirkimo skripto maiša (HASH160) — ja užrakinama P2SH moneta.' },
};

// Why a signature did not pass, by the checker's reason
const SIGNATURE_REASONS = {
  'empty-signature': 'Parašo vietoje — tuščia reikšmė; ji nieko nepasirašo.',
  'bad-public-key': 'Tai ne viešasis raktas: tokiais baitais parašo patikrinti neįmanoma.',
  'wrong-signature': 'Parašas netinka: arba pasirašyta kitu raktu, arba pasirašyta kita transakcija — ši pakeista po pasirašymo.',
};

// Why a lock time demand was not met, by the checker's reason
const LOCKTIME_REASONS = {
  negative: 'Skriptas reikalauja neigiamo laiko — tokio nėra.',
  'different-kind': 'Skriptas skaičiuoja blokais, o transakcijos nLockTime — data (arba atvirkščiai): jų palyginti negalima.',
  'too-early': 'Transakcijos nLockTime mažesnis, nei reikalauja skriptas — monetai dar ne laikas.',
  'final-sequence': 'Įvestis išjungusi laiko užraktus (sequence = 0xffffffff), todėl nLockTime negalioja ir reikalavimas netenkinamas.',
};

// Why a demand for a wait was not met, by the checker's reason
const SEQUENCE_REASONS = {
  negative: 'Skriptas reikalauja neigiamo laukimo — tokio nėra.',
  'old-version': 'Transakcijos versija mažesnė už 2, o santykiniai užraktai galioja tik nuo antrosios versijos.',
  'switched-off': 'Įvestis santykinį užraktą išjungusi (nSequence aukščiausias bitas nustatytas), todėl reikalavimas netenkinamas.',
  'different-kind': 'Skriptas skaičiuoja blokais, o įvesties nSequence — sekundėmis (arba atvirkščiai): jų palyginti negalima.',
  'too-early': 'Įvesties nSequence mažesnis, nei reikalauja skriptas — transakcija B nepažadėjo laukti tiek, kiek reikia.',
};

// Why an amount is more than a chain will ever hold, by chain
const TOO_MANY_COINS = {
  btc: 'Tiek bitkoinų nebus niekada — jų iš viso 21 milijonas.',
  ltc: 'Tiek laitkoinų nebus niekada — jų iš viso 84 milijonai.',
};







// -----------------------------------------------------------
// STAGES
// -----------------------------------------------------------
//
// The node's four questions and its verdict, in the order it
// goes through them: a short name for the row of checks, and
// the question as the node would put it.
//
// Used by:
//   - narrate (below)
//   - playback.js — how far each question has got
// -----------------------------------------------------------

export const STAGES = [
  { key: 'coin', name: 'Moneta', question: 'Ar tokia moneta yra ir dar neišleista?' },
  { key: 'amounts', name: 'Sumos', question: 'Ar išdalijama ne daugiau, nei yra?' },
  { key: 'finality', name: 'Laikas', question: 'Ar transakcijai jau laikas?' },
  { key: 'script', name: 'Skriptai', question: 'Ar atrakinimo skriptas atrakina užraktą?' },
  { key: 'verdict', name: 'Sprendimas', question: 'Ar transakcija priimama?' },
];







// -----------------------------------------------------------
// PHASES
// -----------------------------------------------------------
//
// The three scripts a node may run for one input: the full
// name, the name Bitcoin texts know it by, where the script
// comes from, and how a sentence says "in it".
//
// Used by:
//   - narrate (below)
//   - components/ScriptLine.jsx — the scripts' headings, and
//     what Bitcoin texts call each
// -----------------------------------------------------------

export const PHASES = {
  unlock: { name: 'Atrakinimo skriptas', known: 'scriptSig', from: 'transakcijos B įvestis', where: 'atrakinimo skripte' },
  lock: { name: 'Užrakto skriptas', known: 'scriptPubKey', from: 'transakcijos A išvestis', where: 'užrakto skripte' },
  redeem: { name: 'Išpirkimo skriptas', known: 'redeem script', from: 'jo maiša užrakinta P2SH moneta', where: 'išpirkimo skripte' },
};







// -----------------------------------------------------------
// formatAmount
// -----------------------------------------------------------
//
// An amount of satoshis as whole coins in the chain's unit,
// without the zeros a whole eight-decimal number would trail,
// and with a true minus sign for the amount a transaction is
// short of.
//
// Used by:
//   - narrate (below)
//   - components/Transactions.jsx — the amounts on the cards
// -----------------------------------------------------------

export function formatAmount(satoshis, unit = 'BTC') {
  const size = Math.abs(satoshis);
  const decimals = String(size % SATOSHIS).padStart(8, '0').replace(/0+$/, '');
  return `${satoshis < 0 ? '−' : ''}${Math.floor(size / SATOSHIS)}${decimals ? `.${decimals}` : ''} ${unit}`;
}







// -----------------------------------------------------------
// shortHex
// -----------------------------------------------------------
//
// Bytes too long to read, as their beginning and their end.
//
// Used by:
//   - labelOf, narrate (below)
//   - tiles.js — bytes a hash was made of
// -----------------------------------------------------------

export const shortHex = (hex, head = 8, tail = 6) => (hex.length > head + tail + 2 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex);







// -----------------------------------------------------------
// quote
// -----------------------------------------------------------
//
// A text between Lithuanian quotation marks. A long one — a
// thirty-two letter secret, say — keeps only its beginning
// and its end, so the tile it stands on stays a tile.
//
// Used by:
//   - labelOf (below)
//   - tiles.js — what a hash was made of
//   - examples.js — the same, for a scene's own hashes
// -----------------------------------------------------------

export const quote = (text) => (text.length > LONG_TEXT ? `„${text.slice(0, 12)}…${text.slice(-5)}“` : `„${text}“`);







// -----------------------------------------------------------
// sequenceMeaning
// -----------------------------------------------------------
//
// What an input's sequence number promises, in a few words:
// no wait at all — and, for the one number that also switches
// the transaction's own lock time off, that too — a wait in
// seconds, which the playground does not count, or how old
// the coin has to be, in blocks.
//
// Used by:
//   - components/More.jsx — under the sequence number's field
// -----------------------------------------------------------

export function sequenceMeaning(sequence) {
  if (sequence === FINAL_SEQUENCE) return 'santykinio užrakto nėra, nLockTime negalioja';
  if (hasBit(sequence, SEQUENCE.DISABLED)) return 'santykinio užrakto nėra';
  if (hasBit(sequence, SEQUENCE.SECONDS)) return 'laukimas sekundėmis — čia neskaičiuojamas';

  const wait = sequence % SEQUENCE.COUNTS;
  return `moneta turi būti ${wait} ${pluralForm(wait, BLOCKS_OLD)} senumo`;
}







// -----------------------------------------------------------
// ageText
// -----------------------------------------------------------
//
// A coin's age as its count of confirmations — or, for a coin
// in a block the chain has not reached, that the node does
// not know it yet.
//
// Used by:
//   - components/More.jsx — under the field of the coin's
//     block
// -----------------------------------------------------------

export const ageText = (confirmations) => (confirmations >= 1
  ? `moneta turi ${confirmations} ${pluralForm(confirmations, CONFIRMATIONS_HAD)}`
  : 'grandinė šio bloko dar nepasiekė — mazgas monetos nežino');







// -----------------------------------------------------------
// labelOf
// -----------------------------------------------------------
//
// What to call some bytes — on the stack or pushed by a
// script. Bytes the lexicon knows are called what they are:
// a key pair's piece by its kind and the pair's name, with
// the pair's colour; a hash made on the shelf by its
// algorithm and what was hashed; and what somebody wrote as a
// number, a text or bytes, as that. The rest — what the
// opcodes themselves make — are read as Script itself would
// read them: no bytes as zero and false, up to
// four bytes as the number they hold, bytes that spell a word
// as that word — a long one by its two ends and its length —
// and anything longer as shortened hex with its length. The kind lets the page give each its own look; the
// bytes ride along for a tooltip — behind a sentence on what
// the value is, when the page knows. `written` says how the
// bytes were written by whoever asks — as a text, a number
// or bytes — for bytes the lexicon has not met: a piece of
// data still lying in the tray.
//
// Used by:
//   - itemLabel, narrate (below)
//   - components/StackView.jsx — the values on the stack
//   - components/PieceTray.jsx — a hash on offer
// -----------------------------------------------------------

export function labelOf(hex, lexicon, written = null) {
  const length = byteLength(hex);
  const full = length === 0 ? 'tuščia reikšmė (0 baitų)' : `0x${shortHex(hex, 20, 12)} (${length} ${pluralForm(length, BYTES)})`;

  const worded = (text) => (text.length > LONG_TEXT
    ? { kind: 'text', text: `${quote(text)} (${length} B)`, full: `„${text}“. ${full}` }
    : { kind: 'text', text: quote(text), full });

  const known = lexicon?.values.get(hex) ?? (written ? { what: written } : undefined);
  if (known?.what === 'text') return worded(hexToText(hex) ?? '');
  if (known?.what === 'number') return { kind: 'number', text: String(numberOf(hex, 8)), full };
  if (known?.what === 'hex') return { kind: 'bytes', text: length <= 8 ? `0x${hex}` : `${shortHex(hex)} (${length} B)`, full };
  if (known?.what === 'hash') {
    return { kind: 'hash', short: known.algorithm, name: known.source, colour: null, text: `${known.algorithm} maiša (${known.source})`, full: `${known.algorithm} maiša, padaryta iš ${known.source}. ${full}` };
  }
  if (known) {
    const key = known.who ? lexicon.keys.get(known.who) : null;
    return {
      kind: known.what,
      short: KINDS[known.what].short,
      name: key?.name ?? null,
      colour: key?.colour ?? null,
      stale: Boolean(known.stale),
      text: `${KINDS[known.what].name}${key ? ` „${key.name}“` : ''}${known.stale ? ' (senas)' : ''}`,
      full: `${KINDS[known.what].about} ${full}`,
    };
  }

  if (length === 0) return { kind: 'false', text: '0 (FALSE)', full };
  if (hex === '01') return { kind: 'true', text: '1 (TRUE)', full };
  if (length <= 4) return { kind: 'number', text: `${numberOf(hex)}${isTrue(hex) ? '' : ' (FALSE)'}`, full };

  const word = length <= 80 ? hexToText(hex) : null;
  if (word !== null && /\p{L}/u.test(word)) return worded(word);

  return { kind: 'bytes', text: `${shortHex(hex)} (${length} B)`, full };
}







// -----------------------------------------------------------
// itemLabel
// -----------------------------------------------------------
//
// What to call one item of a script. An opcode goes by its
// name, with its sentence for a tooltip — except the opcodes
// that only put a small number down, which go by the number,
// as they are written; a push is named like the value it
// pushes, the way it was written when the item says how. A reference whose bytes are not known — a signature
// before there is a transaction to sign, a key pair that has
// been removed — is named for what it refers to.
//
// Used by:
//   - wordLabel, looseLabel, narrate (below)
// -----------------------------------------------------------

export function itemLabel(item, lexicon) {
  if (item.type === 'push' && item.hex === null) {
    const key = item.ref.who ? lexicon?.keys.get(item.ref.who) : null;
    return {
      kind: item.ref.what,
      short: KINDS[item.ref.what].short,
      name: key?.name ?? null,
      colour: key?.colour ?? null,
      text: `${KINDS[item.ref.what].name}${key ? ` „${key.name}“` : ''}`,
      full: KINDS[item.ref.what].about,
    };
  }
  if (item.type === 'push') return labelOf(item.hex, lexicon, item.literal ?? null);

  const { opcode } = item;
  if (opcode.group === 'constants') {
    const number = opcode.code === 0x4f ? '-1' : String(Math.max(opcode.code - 0x50, 0));
    return { kind: 'op', group: opcode.group, state: null, text: number, full: `${opcode.about} Skripte tai opkodas ${opcode.name}.` };
  }
  return { kind: 'op', group: opcode.group, state: opcode.state ?? null, text: opcode.name, full: opcode.about };
}







// -----------------------------------------------------------
// wordLabel
// -----------------------------------------------------------
//
// What to call a word standing in a script's row (the words
// model.js keeps for every script). A word that was read is
// named like its item; one that could not be read keeps its
// own letters and is marked as unknown. Whatever is wrong
// with the word rides along as a sentence, so the row can
// mark the tile and say why.
//
// Used by:
//   - playback.js — the scripts as rows of tiles
// -----------------------------------------------------------

export function wordLabel(word, lexicon) {
  const problem = word.problem ? problemText(word.problem) : null;
  if (!word.item) return { kind: 'unknown', text: word.text, full: problem ?? 'Šito perskaityti nepavyko.', problem };

  const label = itemLabel(word.item, lexicon);
  return problem ? { ...label, full: problem, problem } : label;
}







// -----------------------------------------------------------
// looseLabel
// -----------------------------------------------------------
//
// What to call a word that stands in no script yet — a tile
// lying in the tray. It is read on its own, as a script of
// one word, and named like the item it would become; the
// tooltip says what the thing is rather than which bytes it
// holds, since outside a transaction a signature has none. A
// hash made on the shelf is named for how it was made.
//
// Used by:
//   - components/PieceTray.jsx — everything the tray offers
//   - components/ScriptLine.jsx — the redeem script's own
//     two pieces
// -----------------------------------------------------------

export function looseLabel(text, lexicon) {
  const { items } = parseScript(text, lexicon ? [...lexicon.keys.keys()] : []);
  if (items.length !== 1) return { kind: 'unknown', text, full: 'Šito perskaityti nepavyko.' };

  const [item] = items;
  return item.type === 'push' && item.ref ? itemLabel({ ...item, hex: null }, lexicon) : itemLabel(item, lexicon);
}







// -----------------------------------------------------------
// lockName
// -----------------------------------------------------------
//
// What to call a lock on a transaction, in plain words: what
// the coin is locked to — and to which key pair, where the
// lexicon knows whose key or hash the lock holds — with the
// letters every Bitcoin text knows the lock by behind it.
//
// Used by:
//   - components/Transactions.jsx — what a coin is locked to
// -----------------------------------------------------------

export function lockName(lock, lexicon) {
  const owner = (hex) => {
    const key = lexicon.keys.get(lexicon.values.get(hex)?.who);
    return key ? `„${key.name}“` : 'nežinomas';
  };

  if (lock.kind === 'p2pkh') return `adresas ${owner(lock.hash)} (P2PKH)`;
  if (lock.kind === 'p2pk') return `viešasis raktas ${owner(lock.publicKey)} (P2PK)`;
  if (lock.kind === 'p2sh') return 'skripto maiša (P2SH)';
  if (lock.kind === 'multisig') return `${lock.required} iš ${lock.total} raktų (multisig)`;
  if (lock.kind === 'data') return 'duomenys, neišleidžiama (OP_RETURN)';
  if (lock.kind === 'empty') return 'be užrakto';
  return 'savas skriptas';
}







// -----------------------------------------------------------
// problemText
// -----------------------------------------------------------
//
// Why something built or typed cannot be read: a word of a
// script, an amount, a number. The sentence quotes the word
// where that helps to find it.
//
// Used by:
//   - wordLabel (above) — a tile's tooltip
//   - components/Player.jsx — why there is nothing to check
//   - components/PieceTray.jsx — a piece of data that cannot
//     be made
//   - components/More.jsx — a number that is none
// -----------------------------------------------------------

export function problemText(problem) {
  const typed = problem.text ? `„${problem.text}“` : '';

  switch (problem.code) {
    case 'unknown-word': return `Nežinomas žodis ${typed}.`;
    case 'pushdata-word': return `${typed} rašyti nereikia: duomenis rašyk tiesiai — skaičių, tekstą kabutėse arba baitus po 0x.`;
    case 'bad-hex': return `${typed} — ne baitai: po 0x turi eiti lyginis šešioliktainių skaitmenų skaičius.`;
    case 'number-too-large': return `Skaičius ${problem.text} per didelis skriptui.`;
    case 'open-quote': return `Neuždarytos kabutės: ${problem.text}`;
    case 'open-reference': return `Neuždaryta nuoroda: ${problem.text}`;
    case 'unknown-reference': return `Nežinoma nuoroda ${problem.text}.`;
    case 'reference-needs-name': return `Nuorodai ${problem.text} trūksta raktų poros numerio.`;
    case 'unknown-person': return 'Šios detalės raktų poros nebėra — ji pašalinta.';
    case 'unknown-key': return 'Raktų poros, kuriai skirta ši išvestis, nebėra.';
    case 'signature-outside-unlock': return 'Parašui čia ne vieta: parašu pasirašoma transakcija, kuri monetą išleidžia, todėl jis gali būti tik atrakinimo skripte.';
    case 'no-redeem-script': return 'Ši detalė rodo į išpirkimo skriptą, o jo dar nėra — sudėk jį išpirkimo skripto eilutėje.';
    case 'amount-empty': return 'Įrašyk sumą.';
    case 'amount-unreadable': return 'Suma turi būti skaičius, ne daugiau kaip 8 skaitmenys po kablelio.';
    case 'amount-too-large': return TOO_MANY_COINS[problem.chain] ?? TOO_MANY_COINS.btc;
    case 'sequence-unreadable': return 'nSequence turi būti sveikasis skaičius nuo 0 iki 4294967295 — dešimtainis arba šešioliktainis po 0x.';
    case 'maker-empty': return 'Įrašyk reikšmę.';
    case 'text-quotes': return 'Tekste negali būti ir viengubų, ir dvigubų kabučių kartu.';
    case 'script-full': return 'Skriptas per ilgas — daugiau detalių netelpa.';
    case 'whole-unreadable': return 'Čia turi būti sveikasis skaičius.';
    case 'whole-too-large': return 'Skaičius per didelis: šioje aikštelėje laikas skaičiuojamas tik blokais.';
    default: return 'Šito perskaityti nepavyko.';
  }
}







// -----------------------------------------------------------
// whereText
// -----------------------------------------------------------
//
// Where on the page a problem sits, for a list that names
// every problem with its place: which script, whose amount,
// which number.
//
// Used by:
//   - components/Player.jsx — why there is nothing to check
// -----------------------------------------------------------

export function whereText(problem) {
  switch (problem.where) {
    case 'lock': return `Užrakto skriptas (transakcijos A išvestis #${problem.index})`;
    case 'unlock': return 'Atrakinimo skriptas';
    case 'redeem': return 'Išpirkimo skriptas';
    case 'output-amount': return `Transakcijos A išvesties #${problem.index} suma`;
    case 'payment-amount': return `Transakcijos B išvesties #${problem.index} suma`;
    case 'payment-key': return `Transakcijos B išvestis #${problem.index}`;
    case 'lock-time': return 'nLockTime';
    case 'sequence': return 'Įvesties nSequence';
    case 'mined': return 'Transakcijos A blokas';
    default: return 'Grandinės aukštis';
  }
}







// -----------------------------------------------------------
// errorText
// -----------------------------------------------------------
//
// Why a node says no, in one sentence: the reason a check
// failed, a script broke or the stack ended wrong.
//
// Used by:
//   - narrate (below)
// -----------------------------------------------------------

export function errorText(error) {
  switch (error.code) {
    case 'no-such-coin': return 'Tokios monetos mazgas nežino — jos nėra neišleistų monetų rinkinyje.';
    case 'already-spent': return 'Šios monetos mazgo rinkinyje nebėra: ją jau išleido kita transakcija. Tos pačios monetos dukart išleisti negalima.';
    case 'overspend': return 'Išvestys išdalija daugiau, nei verta moneta. Pinigų iš nieko sukurti negalima.';
    case 'too-much-money': return 'Suma viršija visus kada nors būsiančius bitkoinus.';
    case 'locktime-too-early': return 'Transakcijai dar ne laikas: grandinė dar nepasiekė bloko, kurį nurodo nLockTime.';
    case 'locktime-a-date': return 'nLockTime čia nurodo datą, o ši aikštelė laiką skaičiuoja tik blokais.';
    case 'sequence-too-early': return `Monetai dar ne laikas: įvesties nSequence reikalauja, kad ji būtų bent ${error.wait} ${pluralForm(error.wait, BLOCKS_OLD)} senumo, o ji turi tik ${error.confirmations} ${pluralForm(error.confirmations, CONFIRMATIONS_HAD)}.`;
    case 'sequence-seconds': return 'Įvesties nSequence čia skaičiuoja laukimą sekundėmis, o ši aikštelė monetos amžių skaičiuoja tik blokais.';

    case 'stack-underflow': return `Šiam žodžiui reikia ${error.needed} ${pluralForm(error.needed, ITEMS_NEEDED)}, o steke yra ${error.have}.`;
    case 'alt-stack-underflow': return 'Pagalbinis stekas tuščias — iš jo nėra ko grąžinti.';
    case 'verify-failed': return 'Patikra nepavyko — skriptas iškart žlunga.';
    case 'op-return': return 'OP_RETURN visada žlugdo skriptą: ši moneta neišleidžiama niekuo.';
    case 'disabled-opcode': return 'Šis žodis išjungtas: skriptas, kuriame jis yra, negalioja.';
    case 'unsupported-opcode': return 'Šio žodžio ši aikštelė nevykdo — jam reikia daugiau, nei čia modeliuojama.';
    case 'reserved-opcode': return 'Šis žodis neturi reikšmės — jį pasiekęs skriptas žlunga.';
    case 'unbalanced-conditional': return 'OP_IF, OP_ELSE ir OP_ENDIF nesuporuoti: kiekvienam OP_IF reikia savo OP_ENDIF.';
    case 'number-too-long': return `Skaičius užima ${error.bytes} ${pluralForm(error.bytes, BYTES_TAKEN)}, o šis žodis priima ne daugiau kaip ${error.limit}.`;
    case 'index-out-of-range': return `Steke nėra elemento Nr. ${error.index}, skaičiuojant nuo viršaus (viršutinis — Nr. 0).`;
    case 'key-count': return `Raktų skaičius ${error.count} netinkamas: jų gali būti nuo 0 iki ${error.limit}.`;
    case 'signature-count': return `Reikalaujamų parašų skaičius ${error.count} netinkamas: raktų tėra ${error.total}.`;
    case 'null-dummy': return 'Perteklinis elementas, kurį nuima OP_CHECKMULTISIG, turi būti tuščias — padėk pradžioje OP_0.';
    case 'push-too-large': return `Vienas duomenų gabalas — ${error.size} ${pluralForm(error.size, BYTES)}, o leidžiama ne daugiau kaip ${error.limit}.`;
    case 'too-many-operations': return `Skripte per daug veiksmų: mazgai vykdo ne daugiau kaip ${error.limit}.`;
    case 'stack-too-large': return `Steke per daug elementų: mazgai leidžia ne daugiau kaip ${error.limit}.`;
    case 'script-too-large': return `Skriptas per ilgas — ${error.size} ${pluralForm(error.size, BYTES)}, o leidžiama ne daugiau kaip ${error.limit}.`;
    case 'signature-encoding': return 'Tai ne parašas: baitai neatitinka DER formato, kuriuo parašai užrašomi.';
    case 'signature-type': return 'Šio parašo tipas — ne SIGHASH_ALL. Ši aikštelė tikrina tik visą transakciją pasirašančius parašus.';
    case 'locktime': return LOCKTIME_REASONS[error.why];
    case 'sequence': return SEQUENCE_REASONS[error.why];
    case 'empty-stack': return 'Skriptas baigtas, bet stekas tuščias — o viršuje turėjo likti TRUE.';
    case 'false-on-top': return 'Skriptas baigtas, bet steko viršuje — FALSE.';
    case 'unlock-not-push-only': return 'P2SH monetos atrakinimo skripte gali būti tik duomenys — jokių veiksmų.';
    case 'redeem-broken': return 'Išpirkimo skripto baitų neįmanoma perskaityti kaip skripto.';
    default: return 'Mazgas transakcijos nepriima.';
  }
}







// -----------------------------------------------------------
// effectLines
// -----------------------------------------------------------
//
// What an opcode came to: what was compared and whether it
// matched, what was hashed into what, which numbers gave
// which result, which way a branch turned, how a signature
// fared against which key — for OP_CHECKMULTISIG every
// pairing that was tried, in the order the node tries them.
// An opcode that only moves the stack about has nothing to
// add to its own sentence.
//
// Used by:
//   - narrate (below) — at the step itself, and again at the
//     verdict when that step was the one that failed
// -----------------------------------------------------------

function effectLines(effect, name) {
  const truth = (value) => (typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value));

  switch (effect?.type) {
    case 'compare':
      return [`Lyginama: ${name(effect.left)} ir ${name(effect.right)} — ${effect.equal ? 'sutampa.' : 'nesutampa.'}`];
    case 'hash':
      return [`Maišoma: ${name(effect.input)}. Gauta: ${name(effect.output)}.`];
    case 'numbers':
      return [`${effect.inputs.join(' ir ')} → ${truth(effect.result)}`];
    case 'branch':
      return [effect.running ? 'Toliau esantys žodžiai vykdomi.' : 'Toliau esantys žodžiai praleidžiami.'];
    case 'locktime':
      return effect.why ? [] : [`Skriptas reikalauja, kad nLockTime būtų bent ${effect.required}; transakcijos B nLockTime — ${effect.lockTime}. Tinka.`];
    case 'sequence':
      if (effect.why) return [];
      return effect.idle
        ? ['Skaičiaus aukščiausias bitas nustatytas, todėl šis žodis nieko netikrina.']
        : [`Skriptas reikalauja, kad įvesties nSequence būtų bent ${effect.required}; transakcijos B įvesties nSequence — ${effect.sequence}. Tinka.`];
    case 'signature':
      return [
        ...(effect.digest ? [`Tikrinama: ${name(effect.signature)}, ${name(effect.publicKey)} ir transakcijos B santrauka ${shortHex(effect.digest)} — į ją įeina, kuri moneta išleidžiama, kam ir kiek.`] : []),
        effect.valid
          ? 'Parašas tikras: jį galėjo sukurti tik šio viešojo rakto privataus rakto turėtojas, ir pasirašyta būtent ši transakcija.'
          : SIGNATURE_REASONS[effect.why],
      ];
    case 'multisig':
      return [
        `Reikia ${effect.required} ${pluralForm(effect.required, SIGNATURES_NEEDED)} iš ${effect.total} ${pluralForm(effect.total, KEYS_OUT_OF)}. Mazgas eina nuo paskutinio parašo ir paskutinio rakto atgal:`,
        ...effect.tries.map((attempt) => `${name(attempt.signature)} ir ${name(attempt.publicKey)} — ${attempt.valid ? 'tinka.' : 'netinka, imamas kitas raktas.'}`),
        effect.valid ? 'Visi parašai rado savo raktus.' : 'Raktų nebeužteko likusiems parašams.',
      ];
    default:
      return [];
  }
}







// -----------------------------------------------------------
// narrate
// -----------------------------------------------------------
//
// One entry of the node's timeline, told: a heading that says
// where the node is, and the sentences that say what it does
// there and what came of it — the last of them, when the
// entry failed, being why. A refusal names the very word the
// scripts broke at — or, when they ran to their end and left
// a false, the last word — and repeats what that word came
// to, so the verdict can be read without stepping back. The
// model is needed for the names of values, for the unit of
// the amounts the first questions are about, and for the step
// a refusal points back to.
//
// Used by:
//   - components/Player.jsx — the sentences beside the stack
// -----------------------------------------------------------

export function narrate(entry, model) {
  const name = (hex) => labelOf(hex, model.lexicon).text;
  const amount = (satoshis) => formatAmount(satoshis, model.chain.unit);
  const stage = STAGES.find(({ key }) => key === entry.stage);

  if (entry.stage === 'coin') {
    return {
      heading: stage.question,
      lines: [
        `Transakcijos B įvestis rodo į transakcijos ${shortHex(entry.outpoint.txid)} išvestį #${entry.outpoint.vout}. Mazgas ieško jos savo neišleistų monetų rinkinyje (UTXO).`,
        entry.ok ? 'Moneta ten yra: ji egzistuoja ir jos dar niekas neišleido.' : errorText(entry.error),
      ],
    };
  }

  if (entry.stage === 'amounts') {
    const fee = entry.fee > 0
      ? `Likutis — ${amount(entry.fee)} — atitenka kasėjui kaip mokestis.`
      : 'Kasėjui nelieka nieko — taisyklių tai nepažeidžia, bet tokią transakciją vargu ar kas įtrauks į bloką.';
    return {
      heading: stage.question,
      lines: [
        `Moneta verta ${amount(entry.input)}, o transakcijos B išvestys išdalija ${amount(entry.output)}.`,
        entry.ok ? fee : errorText(entry.error),
      ],
    };
  }

  if (entry.stage === 'finality') {
    const told = {
      none: 'Transakcijos B nLockTime lygus 0 — ji gali patekti į bet kurį bloką.',
      'switched-off': 'Transakcijos B įvestys laiko užraktus išjungusios, todėl nLockTime negalioja.',
      reached: `Transakcijos B nLockTime — ${entry.lockTime}: ji gali patekti į bloką ${entry.lockTime + 1} ar vėlesnį. Grandinė jau pasiekė ${entry.height} bloką — laikas atėjo.`,
      'too-early': `Transakcijos B nLockTime — ${entry.lockTime}, o grandinė pasiekė tik ${entry.height} bloką.`,
      'a-date': `Transakcijos B nLockTime — ${entry.lockTime}.`,
    };
    const aged = entry.age === 'none' ? []
      : entry.age === 'reached' ? [`Įvesties nSequence — ${entry.sequence}: moneta turi būti bent ${entry.wait} ${pluralForm(entry.wait, BLOCKS_OLD)} senumo. Ji turi ${entry.confirmations} ${pluralForm(entry.confirmations, CONFIRMATIONS_HAD)} — laikas atėjo.`]
        : [`Įvesties nSequence — ${entry.sequence}.`];
    return { heading: stage.question, lines: [told[entry.why], ...aged, ...(entry.ok ? [] : [errorText(entry.error)])] };
  }

  if (entry.stage === 'verdict') {
    if (entry.ok) {
      return {
        heading: 'Transakcija B priimta',
        lines: [
          'Skriptai įvykdyti, steko viršuje — TRUE: užraktas atrakintas.',
          'Mazgas išbraukia išleistą monetą iš neišleistų monetų rinkinio, įrašo ten transakcijos B išvestis ir persiunčia transakciją kitiems mazgams.',
        ],
      };
    }

    const where = STAGES.find(({ key }) => key === entry.failed);
    const broke = model.verification.timeline.findLast((step) => step.stage === 'script' && step.kind === 'item' && !step.ok);
    const last = model.verification.timeline.findLast((step) => step.stage === 'script' && step.kind === 'item' && !step.skipped);
    const how = entry.failed !== 'script' ? [`Mazgas sustojo ties klausimu „${where.question}“`]
      : broke ? [`Mazgas sustojo ${PHASES[broke.phase].where}, ties žodžiu ${itemLabel(broke.item, model.lexicon).text}.`, ...effectLines(broke.effect, name)]
        : last ? [`Skriptai įvykdyti iki galo; paskutinis žodis — ${itemLabel(last.item, model.lexicon).text}.`, ...effectLines(last.effect, name)]
          : ['Skriptai tušti — vykdyti nebuvo ko.'];
    return {
      heading: 'Transakcija B atmesta',
      lines: [...how, errorText(entry.error), 'Moneta lieka neišleista, o transakcijos mazgas niekam nepersiunčia.'],
    };
  }

  if (entry.kind === 'handover') {
    return {
      heading: 'Nuo atrakinimo prie užrakto',
      lines: [
        'Atrakinimo skriptas baigtas. Stekas lieka toks, koks yra — ant jo dabar vykdomas užrakto skriptas iš transakcijos A.',
        'Taip du skirtingų transakcijų skriptai tampa viena programa: atrakinimas padeda duomenis, užraktas juos patikrina.',
      ],
    };
  }

  if (entry.kind === 'redeem') {
    return {
      heading: 'Atidaromas išpirkimo skriptas',
      lines: [
        'Užraktas tik palygino maišą — ir ji sutapo: pateiktas būtent tas skriptas, kuriam moneta užrakinta.',
        'Mazgas grįžta prie steko, koks jis buvo po atrakinimo skripto, nuima nuo viršaus išpirkimo skriptą ir vykdo jį patį.',
        ...(entry.items.length === 0 ? ['Išpirkimo skriptas tuščias.'] : []),
      ],
    };
  }

  // A step of a script: one item, run, skipped or failed
  const { item } = entry;
  const label = itemLabel(item, model.lexicon);
  const heading = `${PHASES[entry.phase].name}: ${label.text}`;

  if (entry.skipped) return { heading, lines: ['Praleidžiama — šaka, kurioje stovi šis žodis, nevykdoma.'] };

  return {
    heading,
    lines: [
      item.type === 'push' ? `Ant steko dedama: ${label.text}.` : item.opcode.about,
      ...effectLines(entry.effect, name),
      ...(entry.ok ? [] : [errorText(entry.error)]),
    ],
  };
}

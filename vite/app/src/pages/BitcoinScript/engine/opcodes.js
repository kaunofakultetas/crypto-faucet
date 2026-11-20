// -----------------------------------------------------------
//  [*] BitcoinScript — the words of Bitcoin Script
//
//  Every opcode of Bitcoin Script the playground knows by
//  name: its byte, the group it is offered under and one
//  Lithuanian sentence saying what it does to the stack — the
//  sentence a student reads on the opcode's tile and again
//  when the node reaches the opcode.
//
//  Not every word works. Some were switched off in 2010 and a
//  script that contains one fails wherever it stands; some
//  were never given a meaning and fail when they are reached;
//  and two the playground itself does not run — both need
//  more of a transaction than it models — and says so. All of
//  them are listed anyway, with their state: a student who
//  types OP_CAT should learn why it does not work, not that
//  the word is unknown.
//
//  Split into:
//
//    GROUPS   — the families the opcodes are offered in
//    OPCODES  — every opcode: byte, group, state, sentence
//    ALIASES  — second names some opcodes go by
//    opcodeNamed — an opcode by a typed word
//    opcodeAt    — an opcode by its byte
// -----------------------------------------------------------

// The state of an opcode switched off in 2010: a script that
// merely contains it fails
const DISABLED = 'disabled';

// The state of an opcode nobody gave a meaning: a script
// fails when it reaches it
const RESERVED = 'reserved';

// The state of an opcode the playground itself does not run
const UNSUPPORTED = 'unsupported';

// The sentence every switched-off opcode shares
const SWITCHED_OFF = 'Išjungtas dar 2010 m. — skriptas, kuriame jis yra, žlunga, net jei iki jo neprieinama.';

// The sentence of the opcodes nobody ever gave a meaning to
const NO_MEANING = 'Rezervuotas žodis be reikšmės — jį pasiekęs skriptas žlunga.';

// The sentence of the do-nothing opcodes kept for upgrades
const SPARE = 'Nieko nedaro — atsarginis žodis būsimiems protokolo atnaujinimams.';

// The opcodes that put a small number on the stack, 1 to 16
const SMALL_NUMBERS = Array.from({ length: 16 }, (_, index) => ({
  name: `OP_${index + 1}`,
  code: 0x51 + index,
  group: 'constants',
  about: index === 0 ? 'Padeda ant steko skaičių 1 — jis reiškia ir TRUE.' : `Padeda ant steko skaičių ${index + 1}.`,
}));







// -----------------------------------------------------------
// GROUPS
// -----------------------------------------------------------
//
// The families the tray of pieces sorts the opcodes into, in
// the order they are shown, each with its Lithuanian heading.
// The last two hold what does not work — offered apart, so
// they are found by those who look for them.
//
// Used by:
//   - tiles.js — every opcode, family by family
// -----------------------------------------------------------

export const GROUPS = [
  { key: 'constants', title: 'Skaičiai' },
  { key: 'stack', title: 'Stekas' },
  { key: 'logic', title: 'Palyginimas' },
  { key: 'arithmetic', title: 'Aritmetika' },
  { key: 'crypto', title: 'Kriptografija' },
  { key: 'flow', title: 'Sąlygos ir pabaiga' },
  { key: 'time', title: 'Laikas' },
  { key: 'disabled', title: 'Išjungti' },
  { key: 'reserved', title: 'Rezervuoti' },
];







// -----------------------------------------------------------
// OPCODES
// -----------------------------------------------------------
//
// The table itself. An opcode without a state is run as its
// sentence says; one with a state fails the script, and the
// state says which way (see the file header).
//
// Used by:
//   - opcodeNamed, opcodeAt (below)
//   - tiles.js — every opcode, family by family
// -----------------------------------------------------------

export const OPCODES = [
  { name: 'OP_0', code: 0x00, group: 'constants', about: 'Padeda ant steko tuščią reikšmę — nulį, kuris reiškia ir FALSE.' },
  { name: 'OP_1NEGATE', code: 0x4f, group: 'constants', about: 'Padeda ant steko skaičių −1.' },
  ...SMALL_NUMBERS,

  { name: 'OP_NOP', code: 0x61, group: 'flow', about: 'Nieko nedaro.' },
  { name: 'OP_IF', code: 0x63, group: 'flow', about: 'Nuima viršutinį elementą: jei jis TRUE, vykdoma tai, kas eina toliau iki OP_ELSE ar OP_ENDIF; jei FALSE — tai praleidžiama.' },
  { name: 'OP_NOTIF', code: 0x64, group: 'flow', about: 'Nuima viršutinį elementą: jei jis FALSE, vykdoma tai, kas eina toliau iki OP_ELSE ar OP_ENDIF; jei TRUE — tai praleidžiama.' },
  { name: 'OP_ELSE', code: 0x67, group: 'flow', about: 'Apverčia sąlygą: jei iki čia buvo vykdoma, toliau praleidžiama, ir atvirkščiai.' },
  { name: 'OP_ENDIF', code: 0x68, group: 'flow', about: 'Užbaigia sąlygos bloką — toliau vėl vykdoma kaip prieš OP_IF.' },
  { name: 'OP_VERIFY', code: 0x69, group: 'flow', about: 'Nuima viršutinį elementą; jei jis ne TRUE, skriptas iškart žlunga.' },
  { name: 'OP_RETURN', code: 0x6a, group: 'flow', about: 'Iškart žlugdo skriptą — taip užrakintos monetos niekas niekada neišleis. Naudojamas duomenims į grandinę įrašyti.' },

  { name: 'OP_TOALTSTACK', code: 0x6b, group: 'stack', about: 'Perkelia viršutinį elementą į pagalbinį steką.' },
  { name: 'OP_FROMALTSTACK', code: 0x6c, group: 'stack', about: 'Grąžina viršutinį pagalbinio steko elementą į pagrindinį steką.' },
  { name: 'OP_2DROP', code: 0x6d, group: 'stack', about: 'Išmeta du viršutinius elementus.' },
  { name: 'OP_2DUP', code: 0x6e, group: 'stack', about: 'Nukopijuoja du viršutinius elementus.' },
  { name: 'OP_3DUP', code: 0x6f, group: 'stack', about: 'Nukopijuoja tris viršutinius elementus.' },
  { name: 'OP_2OVER', code: 0x70, group: 'stack', about: 'Nukopijuoja į viršų trečią ir ketvirtą nuo viršaus elementus.' },
  { name: 'OP_2ROT', code: 0x71, group: 'stack', about: 'Perkelia į viršų penktą ir šeštą nuo viršaus elementus.' },
  { name: 'OP_2SWAP', code: 0x72, group: 'stack', about: 'Sukeičia dvi viršutines elementų poras vietomis.' },
  { name: 'OP_IFDUP', code: 0x73, group: 'stack', about: 'Nukopijuoja viršutinį elementą, jei jis ne nulis.' },
  { name: 'OP_DEPTH', code: 0x74, group: 'stack', about: 'Padeda ant steko jo elementų skaičių.' },
  { name: 'OP_DROP', code: 0x75, group: 'stack', about: 'Išmeta viršutinį steko elementą.' },
  { name: 'OP_DUP', code: 0x76, group: 'stack', about: 'Nukopijuoja viršutinį steko elementą.' },
  { name: 'OP_NIP', code: 0x77, group: 'stack', about: 'Išmeta antrą nuo viršaus elementą.' },
  { name: 'OP_OVER', code: 0x78, group: 'stack', about: 'Nukopijuoja į viršų antrą nuo viršaus elementą.' },
  { name: 'OP_PICK', code: 0x79, group: 'stack', about: 'Nuima skaičių n ir nukopijuoja į viršų elementą, esantį n vietų žemiau viršaus.' },
  { name: 'OP_ROLL', code: 0x7a, group: 'stack', about: 'Nuima skaičių n ir perkelia į viršų elementą, esantį n vietų žemiau viršaus.' },
  { name: 'OP_ROT', code: 0x7b, group: 'stack', about: 'Perkelia į viršų trečią nuo viršaus elementą.' },
  { name: 'OP_SWAP', code: 0x7c, group: 'stack', about: 'Sukeičia du viršutinius elementus vietomis.' },
  { name: 'OP_TUCK', code: 0x7d, group: 'stack', about: 'Įterpia viršutinio elemento kopiją po antruoju nuo viršaus.' },
  { name: 'OP_SIZE', code: 0x82, group: 'stack', about: 'Padeda ant steko viršutinio elemento ilgį baitais; pats elementas lieka.' },

  { name: 'OP_EQUAL', code: 0x87, group: 'logic', about: 'Nuima du elementus ir padeda TRUE, jei jie sutampa baitas į baitą, kitaip — FALSE.' },
  { name: 'OP_EQUALVERIFY', code: 0x88, group: 'logic', about: 'Nuima du elementus; jei jie nesutampa baitas į baitą, skriptas iškart žlunga.' },

  { name: 'OP_1ADD', code: 0x8b, group: 'arithmetic', about: 'Prideda 1 prie viršutinio skaičiaus.' },
  { name: 'OP_1SUB', code: 0x8c, group: 'arithmetic', about: 'Atima 1 iš viršutinio skaičiaus.' },
  { name: 'OP_NEGATE', code: 0x8f, group: 'arithmetic', about: 'Pakeičia viršutinio skaičiaus ženklą.' },
  { name: 'OP_ABS', code: 0x90, group: 'arithmetic', about: 'Pakeičia viršutinį skaičių jo moduliu.' },
  { name: 'OP_NOT', code: 0x91, group: 'arithmetic', about: 'Nulį pakeičia vienetu, bet kurį kitą skaičių — nuliu.' },
  { name: 'OP_0NOTEQUAL', code: 0x92, group: 'arithmetic', about: 'Nulį palieka nuliu, bet kurį kitą skaičių pakeičia vienetu.' },
  { name: 'OP_ADD', code: 0x93, group: 'arithmetic', about: 'Nuima du skaičius ir padeda jų sumą.' },
  { name: 'OP_SUB', code: 0x94, group: 'arithmetic', about: 'Nuima du skaičius ir padeda skirtumą: antrasis nuo viršaus minus viršutinis.' },
  { name: 'OP_BOOLAND', code: 0x9a, group: 'arithmetic', about: 'Nuima du skaičius ir padeda 1, jei nė vienas jų nėra nulis, kitaip — 0.' },
  { name: 'OP_BOOLOR', code: 0x9b, group: 'arithmetic', about: 'Nuima du skaičius ir padeda 1, jei bent vienas jų nėra nulis, kitaip — 0.' },
  { name: 'OP_NUMEQUAL', code: 0x9c, group: 'arithmetic', about: 'Nuima du skaičius ir padeda 1, jei jie lygūs, kitaip — 0.' },
  { name: 'OP_NUMEQUALVERIFY', code: 0x9d, group: 'arithmetic', about: 'Nuima du skaičius; jei jie nelygūs, skriptas iškart žlunga.' },
  { name: 'OP_NUMNOTEQUAL', code: 0x9e, group: 'arithmetic', about: 'Nuima du skaičius ir padeda 1, jei jie nelygūs, kitaip — 0.' },
  { name: 'OP_LESSTHAN', code: 0x9f, group: 'arithmetic', about: 'Nuima du skaičius ir padeda 1, jei antrasis nuo viršaus mažesnis už viršutinį.' },
  { name: 'OP_GREATERTHAN', code: 0xa0, group: 'arithmetic', about: 'Nuima du skaičius ir padeda 1, jei antrasis nuo viršaus didesnis už viršutinį.' },
  { name: 'OP_LESSTHANOREQUAL', code: 0xa1, group: 'arithmetic', about: 'Nuima du skaičius ir padeda 1, jei antrasis nuo viršaus ne didesnis už viršutinį.' },
  { name: 'OP_GREATERTHANOREQUAL', code: 0xa2, group: 'arithmetic', about: 'Nuima du skaičius ir padeda 1, jei antrasis nuo viršaus ne mažesnis už viršutinį.' },
  { name: 'OP_MIN', code: 0xa3, group: 'arithmetic', about: 'Nuima du skaičius ir padeda mažesnįjį.' },
  { name: 'OP_MAX', code: 0xa4, group: 'arithmetic', about: 'Nuima du skaičius ir padeda didesnįjį.' },
  { name: 'OP_WITHIN', code: 0xa5, group: 'arithmetic', about: 'Nuima tris skaičius — reikšmę, apatinę ir viršutinę ribą — ir padeda 1, jei reikšmė ne mažesnė už apatinę ir mažesnė už viršutinę.' },

  { name: 'OP_RIPEMD160', code: 0xa6, group: 'crypto', about: 'Pakeičia viršutinį elementą jo RIPEMD-160 maiša.' },
  { name: 'OP_SHA1', code: 0xa7, group: 'crypto', about: 'Pakeičia viršutinį elementą jo SHA-1 maiša.' },
  { name: 'OP_SHA256', code: 0xa8, group: 'crypto', about: 'Pakeičia viršutinį elementą jo SHA-256 maiša.' },
  { name: 'OP_HASH160', code: 0xa9, group: 'crypto', about: 'Pakeičia viršutinį elementą jo maiša RIPEMD-160(SHA-256(x)) — tokia maiša iš viešojo rakto padaro adresą.' },
  { name: 'OP_HASH256', code: 0xaa, group: 'crypto', about: 'Pakeičia viršutinį elementą jo dviguba SHA-256 maiša.' },
  { name: 'OP_CHECKSIG', code: 0xac, group: 'crypto', about: 'Nuima viešąjį raktą ir parašą; padeda TRUE, jei parašas šiuo raktu patvirtina būtent šią transakciją, kitaip — FALSE.' },
  { name: 'OP_CHECKSIGVERIFY', code: 0xad, group: 'crypto', about: 'Nuima viešąjį raktą ir parašą; jei parašas netinka, skriptas iškart žlunga.' },
  { name: 'OP_CHECKMULTISIG', code: 0xae, group: 'crypto', about: 'Nuima n viešųjų raktų ir m parašų; padeda TRUE, jei kiekvienas parašas tinka kuriam nors raktui, ta pačia eile. Dėl senos klaidos nuima dar vieną, nenaudojamą elementą.' },
  { name: 'OP_CHECKMULTISIGVERIFY', code: 0xaf, group: 'crypto', about: 'Kaip OP_CHECKMULTISIG, bet netikę parašai iškart žlugdo skriptą.' },

  { name: 'OP_CHECKLOCKTIMEVERIFY', code: 0xb1, group: 'time', about: 'Žlugdo skriptą, jei transakcijos nLockTime mažesnis už skaičių steko viršuje — moneta lieka užšaldyta iki to bloko. Steko nekeičia.' },
  { name: 'OP_CHECKSEQUENCEVERIFY', code: 0xb2, group: 'time', state: UNSUPPORTED, about: 'Užšaldo monetą tam tikram blokų skaičiui nuo jos sukūrimo. Ši aikštelė monetos amžiaus neskaičiuoja, todėl šio žodžio nevykdo.' },

  { name: 'OP_CAT', code: 0x7e, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_SUBSTR', code: 0x7f, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_LEFT', code: 0x80, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_RIGHT', code: 0x81, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_INVERT', code: 0x83, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_AND', code: 0x84, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_OR', code: 0x85, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_XOR', code: 0x86, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_2MUL', code: 0x8d, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_2DIV', code: 0x8e, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_MUL', code: 0x95, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_DIV', code: 0x96, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_MOD', code: 0x97, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_LSHIFT', code: 0x98, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },
  { name: 'OP_RSHIFT', code: 0x99, group: 'disabled', state: DISABLED, about: SWITCHED_OFF },

  { name: 'OP_RESERVED', code: 0x50, group: 'reserved', state: RESERVED, about: NO_MEANING },
  { name: 'OP_VER', code: 0x62, group: 'reserved', state: RESERVED, about: NO_MEANING },
  { name: 'OP_VERIF', code: 0x65, group: 'reserved', state: DISABLED, about: 'Rezervuotas žodis — skriptas, kuriame jis yra, žlunga, net jei iki jo neprieinama.' },
  { name: 'OP_VERNOTIF', code: 0x66, group: 'reserved', state: DISABLED, about: 'Rezervuotas žodis — skriptas, kuriame jis yra, žlunga, net jei iki jo neprieinama.' },
  { name: 'OP_RESERVED1', code: 0x89, group: 'reserved', state: RESERVED, about: NO_MEANING },
  { name: 'OP_RESERVED2', code: 0x8a, group: 'reserved', state: RESERVED, about: NO_MEANING },
  { name: 'OP_CODESEPARATOR', code: 0xab, group: 'reserved', state: UNSUPPORTED, about: 'Pažymi vietą, nuo kurios skriptas įeina į parašo pranešimą. Beveik nenaudojamas — ši aikštelė jo nevykdo.' },
  { name: 'OP_NOP1', code: 0xb0, group: 'reserved', about: SPARE },
  ...[4, 5, 6, 7, 8, 9, 10].map((number) => ({ name: `OP_NOP${number}`, code: 0xb3 + number - 4, group: 'reserved', about: SPARE })),
];







// -----------------------------------------------------------
// ALIASES
// -----------------------------------------------------------
//
// The second names some opcodes are written under: the two
// truth words, and the spare opcodes two later upgrades gave
// a meaning to.
//
// Used by:
//   - opcodeNamed (below)
// -----------------------------------------------------------

export const ALIASES = {
  OP_FALSE: 'OP_0',
  OP_TRUE: 'OP_1',
  OP_NOP2: 'OP_CHECKLOCKTIMEVERIFY',
  OP_NOP3: 'OP_CHECKSEQUENCEVERIFY',
  OP_CLTV: 'OP_CHECKLOCKTIMEVERIFY',
  OP_CSV: 'OP_CHECKSEQUENCEVERIFY',
};

// The table by name
const BY_NAME = new Map(OPCODES.map((opcode) => [opcode.name, opcode]));

// The table by byte
const BY_CODE = new Map(OPCODES.map((opcode) => [opcode.code, opcode]));







// -----------------------------------------------------------
// opcodeNamed
// -----------------------------------------------------------
//
// The opcode a typed word names, or nothing: in either letter
// case, with the OP_ in front or without it, under its own
// name or a second one.
//
// Used by:
//   - script.js — reading a typed script
// -----------------------------------------------------------

export function opcodeNamed(word) {
  const upper = word.toUpperCase();
  const name = upper.startsWith('OP_') ? upper : `OP_${upper}`;
  return BY_NAME.get(ALIASES[name] ?? name) ?? null;
}







// -----------------------------------------------------------
// opcodeAt
// -----------------------------------------------------------
//
// The opcode a byte of a script stands for, or nothing for a
// byte no opcode was ever given.
//
// Used by:
//   - script.js — reading a script back from its bytes
// -----------------------------------------------------------

export const opcodeAt = (code) => BY_CODE.get(code) ?? null;

// -----------------------------------------------------------
//  [*] BitcoinScript — bytes taken from the chain
//
//  Two of the scenes are transactions that really happened,
//  and what opened their locks is too long to be made up or
//  typed: the header of Bitcoin's first block, and the two
//  pieces of data that were the first to share one SHA-1
//  hash. They are kept here, exactly as they stand in the
//  transactions that spent those coins, so the scenes can
//  show the real thing.
//
//  Used by:
//    - examples.js — the scenes of the two puzzles
// -----------------------------------------------------------







// -----------------------------------------------------------
// GENESIS_HEADER
// -----------------------------------------------------------
//
// The eighty bytes of the header of block 0, mined on 3
// January 2009. Their double SHA-256 is the hash every later
// block builds on. In block 212033 these bytes opened a coin
// locked to that hash (transaction
// 09f691b2263260e71f363d1db51ff3100d285956a40cc0e4f8c8c2c4a80559b1).
//
// Used by:
//   - examples.js — what opens the genesis puzzle
// -----------------------------------------------------------

export const GENESIS_HEADER = [
  '0100000000000000000000000000000000000000000000000000000000000000',
  '000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa',
  '4b1e5e4a29ab5f49ffff001d1dac2b7c',
].join('');







// -----------------------------------------------------------
// SHA1_COLLISION
// -----------------------------------------------------------
//
// Two pieces of 320 bytes each that differ and yet have the
// same SHA-1 hash — the beginnings of the two PDF files of
// the "SHAttered" attack, published on 23 February 2017. The
// same day they were used to take a bounty that had been
// locked since 2013 for whoever would find such a pair
// (transaction
// 8d31992805518fd62daa3bdd2a5c4fd2cd3054c9b3dca1d78055e9528cff6adc,
// block 454316).
//
// Used by:
//   - examples.js — what opens the collision bounty
// -----------------------------------------------------------

export const SHA1_COLLISION = [
  [
    '255044462d312e330a25e2e3cfd30a0a0a312030206f626a0a3c3c2f57696474',
    '682032203020522f4865696768742033203020522f547970652034203020522f',
    '537562747970652035203020522f46696c7465722036203020522f436f6c6f72',
    '53706163652037203020522f4c656e6774682038203020522f42697473506572',
    '436f6d706f6e656e7420383e3e0a73747265616d0affd8fffe00245348412d31',
    '20697320646561642121212121852fec092339759c39b1a1c63c4c97e1fffe01',
    '7f46dc93a6b67e013b029aaa1db2560b45ca67d688c7f84b8c4c791fe02b3df6',
    '14f86db1690901c56b45c1530afedfb76038e972722fe7ad728f0e4904e046c2',
    '30570fe9d41398abe12ef5bc942be33542a4802d98b5d70f2a332ec37fac3514',
    'e74ddc0f2cc1a874cd0c78305a21566461309789606bd0bf3f98cda8044629a1',
  ].join(''),
  [
    '255044462d312e330a25e2e3cfd30a0a0a312030206f626a0a3c3c2f57696474',
    '682032203020522f4865696768742033203020522f547970652034203020522f',
    '537562747970652035203020522f46696c7465722036203020522f436f6c6f72',
    '53706163652037203020522f4c656e6774682038203020522f42697473506572',
    '436f6d706f6e656e7420383e3e0a73747265616d0affd8fffe00245348412d31',
    '20697320646561642121212121852fec092339759c39b1a1c63c4c97e1fffe01',
    '7346dc9166b67e118f029ab621b2560ff9ca67cca8c7f85ba84c79030c2b3de2',
    '18f86db3a90901d5df45c14f26fedfb3dc38e96ac22fe7bd728f0e45bce046d2',
    '3c570feb141398bb552ef5a0a82be331fea48037b8b5d71f0e332edf93ac3500',
    'eb4ddc0decc1a864790c782c76215660dd309791d06bd0af3f98cda4bc4629b1',
  ].join(''),
];

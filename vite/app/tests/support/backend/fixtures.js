// -----------------------------------------------------------
//  [*] Test support — canonical backend answers
//
//  One realistic body per endpoint the SPA calls, in the exact
//  shape the backend answers with — taken from the live
//  backend's answers (trimmed to a few networks; people's
//  names replaced by neutral ones) and, for the endpoints a
//  test must never trigger live (payouts, renames), from the
//  backend code's return statements. The answers agree with
//  each other: the catalog lists the same networks the
//  per-family /networks endpoints do, the faucet addresses are
//  the same everywhere, and the UTXO day's inputs point at
//  outputs of the transactions before them.
//
//  handlers.js serves these by default; a test that needs a
//  variation copies a fixture and edits the copy rather than
//  changing a fixture other tests share.
//
//  Used by:
//    - handlers.js — the default handlers
//    - page and component tests — the values they assert on
// -----------------------------------------------------------

// The faucet's own addresses, per family (the live ones —
// public, and what every balance answer names)
export const FAUCET_EVM = '0x87efe7dfb3b49162385bbe36ec0f3e5f3b41ed7d';
export const FAUCET_UTXO = 'tb1qgc4lympfuq8wwvh563660hdsm7efh3eekmuas4';
export const FAUCET_SVM = 'DGvWVvGUt92p1YiffQ69Ba75stvSRMjCo6KdUtkWayC8';
export const FAUCET_MOVE = '0x0dddd360675c2e52ce731c87f993c9588bb2ede1c067b4bc58ee86aad9a91dbc';

// Students' addresses — valid on their chains (the UTXO ones
// are real testnet4 bech32 addresses; the hub is BIP-173's
// testnet vector)
export const STUDENT_EVM = '0xb3fa7be6763ee3bcd32e9c6d90237c0a1a2d57d9';
export const JONAS = 'tb1qxc2wlcxvzcph96p4q9xn9hqpua7l3fv9ufxek8';
export const EGLE = 'tb1q3gq3qmj6efm2frmwu9gkm9hq7kcc3yuamvn6kkwv26rxepf4q2hshun05n';
export const PETRAS = 'tb1qvrzfhju72hv677g74ma5lwh4nyu50e4nsmssky';
export const HUB = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';







// -----------------------------------------------------------
// The catalog and the per-family network lists
// -----------------------------------------------------------

export const evmNetworksMap = {
  sepolia: { block_explorer_urls: ['https://sepolia.etherscan.io'], chain_id: 11155111, chain_name: 'Sepolia', full_name: 'Ethereum Sepolia', has_explorer: true, icon: '/api/icons/evm/sepolia', id: 1, native_currency: { decimals: 18, name: 'Ethereum', symbol: 'SepETH' }, rpc_urls: ['https://rpc.sepolia.org'], short_name: 'SepETH' },
  hoodi: { block_explorer_urls: ['https://light-hoodi.beaconcha.in'], chain_id: 560048, chain_name: 'Ethereum Hoodi', full_name: 'Ethereum Hoodi', has_explorer: true, icon: '/api/icons/evm/hoodi', id: 6, native_currency: { decimals: 18, name: 'Ethereum', symbol: 'ETH' }, rpc_urls: ['https://rpc.hoodi.ethpandaops.io'], short_name: 'ETH' },
  arbitrumSepolia: { block_explorer_urls: ['https://sepolia.arbiscan.io'], chain_id: 421614, chain_name: 'Arbitrum Sepolia', full_name: 'Arbitrum Sepolia', has_explorer: false, icon: '/api/icons/evm/arbitrumSepolia', id: 7, native_currency: { decimals: 18, name: 'Ethereum', symbol: 'ETH' }, rpc_urls: ['https://sepolia.arbitrum.io/rpc'], short_name: 'ETH' },
};

export const erc20TokensMap = {
  FOLD: { chunk_size: 5.0, decimals: 18, icon: '/api/icons/erc20/FOLD', name: 'Interfold', networks: ['sepolia'], symbol: 'FOLD' },
  LINK: { chunk_size: 5.0, decimals: 18, icon: '/api/icons/erc20/LINK', name: 'Chainlink', networks: ['sepolia'], symbol: 'LINK' },
};

export const utxoNetworksMap = {
  btc4: { block_explorer: 'https://mempool.space/testnet4', chain: 'testnet', chain_id: 0, chunk_size: 0.1, full_name: 'Bitcoin Testnet4', icon: '/api/icons/utxo/btc4', id: 4, short_name: 'tBTC4' },
  knf: { block_explorer: 'https://knfcoin.knf.vu.lt/explorer', chain: 'mainnet', chain_id: 0, chunk_size: 1000.0, full_name: 'KNF Coin', icon: '/api/icons/utxo/knf', id: 1, short_name: 'KNF' },
  ltc4: { block_explorer: 'https://litecoinspace.org/testnet', chain: 'testnet', chain_id: 0, chunk_size: 1000.0, full_name: 'Litecoin Testnet4', icon: '/api/icons/utxo/ltc4', id: 2, short_name: 'tLTC4' },
};

export const svmNetworksMap = {
  solanaDevnet: { block_explorer_urls: ['https://explorer.solana.com/?cluster=devnet'], chunk_size: 5.0, cluster: 'devnet', decimals: 9, full_name: 'Solana Devnet', icon: '/api/icons/svm/solanaDevnet', id: 1, rpc_urls: ['https://api.devnet.solana.com'], short_name: 'devSOL', symbol: 'SOL' },
};

export const moveNetworksMap = {
  suiTestnet: { block_explorer_urls: ['https://suiscan.xyz/testnet'], chunk_size: 0.5, coin_type: '0x2::sui::SUI', decimals: 9, full_name: 'Sui Testnet', icon: '/api/icons/move/suiTestnet', id: 1, network: 'testnet', rpc_urls: ['https://graphql.testnet.sui.io/graphql'], short_name: 'tSUI', symbol: 'SUI' },
};


export const evmNetworks = { default_network: 'sepolia', networks: evmNetworksMap };
export const utxoNetworks = { default_network: 'btc4', networks: utxoNetworksMap };
export const svmNetworks = { default_network: 'solanaDevnet', networks: svmNetworksMap };
export const moveNetworks = { default_network: 'suiTestnet', networks: moveNetworksMap };


// GET /api/faucet/catalog — every family in one answer
export const catalog = {
  erc20: { default_token: 'LINK', tokens: erc20TokensMap },
  evm: evmNetworks,
  move: moveNetworks,
  svm: svmNetworks,
  utxo: utxoNetworks,
};







// -----------------------------------------------------------
// Balances — GET /api/<family>/<network>/faucet-balance
// -----------------------------------------------------------

export const evmBalance = () => ({ address: FAUCET_EVM, balance: 41.603571384332014, chunk_size: 0.2 });
export const utxoBalance = () => ({ address: FAUCET_UTXO, balance: 1250.6045856, balance_confirmed: 1250.605438, balance_unconfirmed: -0.0008524, chunk_size: 0.1 });
export const svmBalance = () => ({ address: FAUCET_SVM, balance: 498.25007884, chunk_size: 5.0, symbol: 'SOL' });
export const moveBalance = () => ({ address: FAUCET_MOVE, balance: 531.0, chunk_size: 0.5, symbol: 'SUI' });

// The student's own balance, as the public chain endpoints
// answer it (smallest units): 1.5 SOL, 2.25 SUI
export const STUDENT_SVM_LAMPORTS = 1500000000;
export const STUDENT_SUI_MIST = 2250000000;


// GET /api/erc20/token/<symbol>[?address=] — the token and its
// deployments; wallet_native_wei is the asking wallet's gas
// money on each chain (null without ?address=), and each
// balance that could not be read comes with the backend's
// sentence saying why (null when it was read)
export const erc20Token = (symbol = 'LINK', address = null) => ({
  deployments: erc20TokensMap[symbol].networks.map((network) => ({
    balance: symbol === 'LINK' ? 145.0 : 200.0,
    balance_error: null,
    block_explorer_urls: evmNetworksMap[network].block_explorer_urls,
    chain_id: evmNetworksMap[network].chain_id,
    chain_name: evmNetworksMap[network].chain_name,
    contract_address: symbol === 'LINK' ? '0x779877A7B0D9E8603169DdbD7836e478b4624789' : '0x9752444A6a955D420402EaFf5f818afCddb9c340',
    full_name: evmNetworksMap[network].full_name,
    icon: evmNetworksMap[network].icon,
    min_native_wei: '100000000000000000',
    native_currency: evmNetworksMap[network].native_currency,
    network,
    rpc_urls: evmNetworksMap[network].rpc_urls,
    short_name: evmNetworksMap[network].short_name,
    wallet_native_wei: address ? '41603571384332010457' : null,
    wallet_native_error: null,
  })),
  faucet_address: FAUCET_EVM,
  token: {
    chunk_size: erc20TokensMap[symbol].chunk_size,
    decimals: erc20TokensMap[symbol].decimals,
    icon: erc20TokensMap[symbol].icon,
    name: erc20TokensMap[symbol].name,
    symbol,
  },
});







// -----------------------------------------------------------
// Payouts — the success answers (never called live)
// -----------------------------------------------------------

export const evmPayout = () => ({ message: 'ETH sent successfully', transaction_hash: `0x${'ab'.repeat(32)}`, amount: 0.2 });
export const erc20Payout = (symbol = 'LINK', network = 'sepolia') => ({ message: `${symbol} sent successfully`, transaction_hash: `0x${'cd'.repeat(32)}`, amount: 5.0, token: symbol, network });
export const utxoPayout = (network = 'btc4') => ({ message: 'Cryptocurrency sent successfully', transaction_id: 'ef'.repeat(32), amount: utxoNetworksMap[network]?.chunk_size ?? 0.1, from_address: FAUCET_UTXO, network });
export const svmPayout = () => ({ message: 'SOL sent successfully', transaction_id: '5'.repeat(88), amount: 5.0, from_address: FAUCET_SVM, network: 'solanaDevnet' });
export const movePayout = () => ({ message: 'SUI sent successfully', transaction_id: 'Dg'.repeat(22), amount: 0.5, from_address: FAUCET_MOVE, network: 'suiTestnet' });

// The backend's refusals the pages must show as they are
export const COOLDOWN_MESSAGE = 'Kriptovaliuta jums jau išsiųsta. Daugiau galėsite pasiimti už 3500 sek.';
export const EMPTY_FAUCET_MESSAGE = 'Čiaupas nebeturi kriptovaliutos. Praneškite dėstytojui.';







// -----------------------------------------------------------
// The EVM transaction graph
// -----------------------------------------------------------

// GET /api/evm/<network>/transaction-days?address=&tz=
export const evmTransactionDays = () => ({
  days: [
    { count: 3, day: '2026-09-25' },
    { count: 1, day: '2026-09-28' },
    { count: 2, day: '2026-09-29' },
  ],
});

// GET /api/evm/<network>/get-stored-transactions?address=&from=&to=
// — refresh_error is the sentence of the address' latest
// failed Etherscan refresh, null while none failed
export const evmStoredTransactions = () => ({
  refresh_error: null,
  transactions: [
    { count: 1, from_addr_contract: 0, from_addr_hub: null, from_address: FAUCET_EVM, from_name: 'KNF Faucet', from_timestamp: 1789034000, to_addr_contract: 0, to_addr_hub: null, to_address: STUDENT_EVM, to_name: 'Jonas', to_timestamp: 1789034000, value: 0.2 },
    { count: 1, from_addr_contract: 0, from_addr_hub: null, from_address: STUDENT_EVM, from_name: 'Jonas', from_timestamp: 1789034568, to_addr_contract: 0, to_addr_hub: null, to_address: FAUCET_EVM, to_name: 'KNF Faucet', to_timestamp: 1789034568, value: 0.199752074200623 },
  ],
});







// -----------------------------------------------------------
// The UTXO transaction graph — one btc4 day
// -----------------------------------------------------------
//
//   T1  block 154390  Jonas returns 0.01 to the faucet
//   T2  block 154391  the faucet pays Eglė 0.1 (spends T1's
//                     output and an older coin of its own)
//   T3  block 154395  Eglė returns her coin to the faucet
//   T4  block 154395  the faucet pays Jonas 0.1 — spending T2's
//                     change AND T3's output: a chain inside one
//                     block
//   T5  mempool       Jonas pays a public hub (whose history
//                     nobody reads — "unknown"), writes an
//                     OP_RETURN, keeps his change (unspent)
//
// plus, outside the day (the dialog's links reach them through
// GET /api/utxo/<network>/transaction/<txid>): T0 the payout
// that gave Jonas his coin, and a coinbase.

const txid = (pair) => pair.repeat(32);

export const UTXO_TXIDS = {
  T0: txid('a0'), T1: txid('a1'), T2: txid('a2'), T3: txid('a3'), T4: txid('a4'), T5: txid('a5'),
  COINBASE: txid('cb'), OLD_FAUCET_COIN: txid('0f'),
};

const ids = UTXO_TXIDS;

export const utxoBlocks = [
  { height: 154390, time: '2026-09-29T10:18:29Z' },
  { height: 154391, time: '2026-09-29T10:38:30Z' },
  { height: 154395, time: '2026-09-29T11:02:16Z' },
];

const out = (address, value, spentBy = null, { spentKnown = true, scriptType = 'p2wpkh' } = {}) => ({
  address, script_type: scriptType, value, spent_by: spentBy, spent_known: spentBy ? true : spentKnown,
});

const utxoDayTransactions = [
  {
    txid: ids.T1, status: 'confirmed', block: 154390, time: utxoBlocks[0].time, vsize: 110, fee: 1100, coinbase: false,
    inputs: [{ txid: ids.T0, vout: 0, address: JONAS, value: 1000000 }],
    outputs: [out(FAUCET_UTXO, 998900, { txid: ids.T2, vin: 1 })],
  },
  {
    txid: ids.T2, status: 'confirmed', block: 154391, time: utxoBlocks[1].time, vsize: 208, fee: 4360, coinbase: false,
    inputs: [
      { txid: ids.OLD_FAUCET_COIN, vout: 1, address: FAUCET_UTXO, value: 74992995110 },
      { txid: ids.T1, vout: 0, address: FAUCET_UTXO, value: 998900 },
    ],
    outputs: [out(EGLE, 10000000, { txid: ids.T3, vin: 0 }, { scriptType: 'p2wsh' }), out(FAUCET_UTXO, 74983989650, { txid: ids.T4, vin: 0 })],
  },
  {
    txid: ids.T3, status: 'confirmed', block: 154395, time: utxoBlocks[2].time, vsize: 138, fee: 1380, coinbase: false,
    inputs: [{ txid: ids.T2, vout: 0, address: EGLE, value: 10000000 }],
    outputs: [out(FAUCET_UTXO, 9998620, { txid: ids.T4, vin: 1 })],
  },
  {
    txid: ids.T4, status: 'confirmed', block: 154395, time: utxoBlocks[2].time, vsize: 254, fee: 2540, coinbase: false,
    inputs: [
      { txid: ids.T2, vout: 1, address: FAUCET_UTXO, value: 74983989650 },
      { txid: ids.T3, vout: 0, address: FAUCET_UTXO, value: 9998620 },
    ],
    outputs: [out(JONAS, 10000000, { txid: ids.T5, vin: 0 }), out(FAUCET_UTXO, 74983985730)],
  },
  {
    txid: ids.T5, status: 'mempool', block: null, time: null, vsize: 172, fee: 1400, coinbase: false,
    inputs: [{ txid: ids.T4, vout: 0, address: JONAS, value: 10000000 }],
    outputs: [
      out(HUB, 5000000, null, { spentKnown: false }),
      out(null, 0, null, { scriptType: 'op_return' }),
      out(JONAS, 4998600),
    ],
  },
];

export const utxoNames = { [FAUCET_UTXO]: "Faucet'as", [JONAS]: 'Jonas', [EGLE]: 'Eglė' };

// GET /api/utxo/<network>/graph?from=&to= — the mempool (T5)
// only on a live window, like the backend; the two failure
// sentences (why the last crawl failed, why transactions are
// missing) null on a day that had no failure
export const utxoGraph = ({ live = true } = {}) => {
  const transactions = utxoDayTransactions.filter((tx) => live || tx.status !== 'mempool');
  return {
    blocks: utxoBlocks,
    crawl_error: null,
    faucet_address: FAUCET_UTXO,
    live,
    missing: 0,
    missing_error: null,
    names: { ...utxoNames },
    transactions: structuredClone(transactions),
    updating: false,
  };
};

// Transactions reachable only through the single-transaction
// endpoint — outside the day on screen
const utxoOtherTransactions = [
  {
    txid: ids.T0, status: 'confirmed', block: 154300, time: '2026-09-28T09:00:00Z', vsize: 141, fee: 1410, coinbase: false,
    inputs: [{ txid: ids.OLD_FAUCET_COIN, vout: 0, address: FAUCET_UTXO, value: 5000000000 }],
    outputs: [out(JONAS, 1000000, { txid: ids.T1, vin: 0 }), out(FAUCET_UTXO, 4998998590)],
  },
  {
    txid: ids.COINBASE, status: 'confirmed', block: 154000, time: '2026-09-27T09:00:00Z', vsize: 120, fee: null, coinbase: true,
    inputs: [],
    outputs: [out(FAUCET_UTXO, 5000000000, { txid: ids.OLD_FAUCET_COIN, vin: 0 }), out(null, 0, null, { scriptType: 'op_return' })],
  },
];

// GET /api/utxo/<network>/transaction/<txid> — null for a
// txid nobody knows (the handler answers 404 then)
export const utxoTransaction = (wanted) => {
  const tx = [...utxoDayTransactions, ...utxoOtherTransactions].find((candidate) => candidate.txid === wanted);
  if (!tx) return null;
  const addresses = new Set([...tx.inputs, ...tx.outputs].map((coin) => coin.address).filter(Boolean));
  const names = Object.fromEntries(Object.entries(utxoNames).filter(([address]) => addresses.has(address)));
  return { transaction: structuredClone(tx), names };
};

// GET /api/utxo/<network>/transaction-days?tz=
export const utxoTransactionDays = () => ({
  days: [
    { count: 6, day: '2025-08-13' },
    { count: 3, day: '2025-10-29' },
    { count: 5, day: '2026-09-29' },
  ],
});







// -----------------------------------------------------------
// The blockchain simulator — GET /api/get-example-blockchain
// -----------------------------------------------------------

export const exampleBlockchain = [
  { height: '0', data: '1) Nauja kriptovaliuta ---> Satoshi (50BTC)', previousHash: '0', nonce: '227969571629', hash: '0000000000c8d30df00df761f0d73e814b19a0dc7bece5dc620eab5551f0f5db' },
  { height: '1', data: '1) Nauja kriptovaliuta ---> Jonas (50BTC)\n2) Satoshi ---> Saulius (2BTC)', previousHash: '0000000000c8d30df00df761f0d73e814b19a0dc7bece5dc620eab5551f0f5db', nonce: '913766198743', hash: '0000000000ac4a3f4f45417e3befc780c496176e3c0468c92ca37e743790ccf0' },
  { height: '2', data: '1) Nauja kriptovaliuta ---> Gabija (50BTC)\n2) Saulius ---> Jonas (2BTC)', previousHash: '0000000000ac4a3f4f45417e3befc780c496176e3c0468c92ca37e743790ccf0', nonce: '67054785720', hash: '000000000013a018ec584889625adf3ddda1bdbaa41bec232bb78dcebd42da0e' },
  { height: '3', data: '1) Nauja kriptovaliuta ---> Agnė (50BTC)\n2) Gabija ---> Jonas (8BTC)\n3) Jonas ---> Agnė (2BTC)', previousHash: '000000000013a018ec584889625adf3ddda1bdbaa41bec232bb78dcebd42da0e', nonce: '77902282117', hash: '0000000000454e22a166a17b9cb2c09163f9a90686b50ca835fe910f01d02a1b' },
  { height: '4', data: '1) Nauja kriptovaliuta ---> Rokas (50BTC)\n2) Agnė ---> Mantas (3BTC)\n3) Jonas ---> Mantas (10BTC)', previousHash: '0000000000454e22a166a17b9cb2c09163f9a90686b50ca835fe910f01d02a1b', nonce: '749962019361', hash: '000000000083ad99f39346981a5a9be26ef7e4abd8c2559faa7f31a11fe05143' },
  { height: '5', data: '1) Nauja kriptovaliuta ---> Mantas (50BTC)', previousHash: '000000000083ad99f39346981a5a9be26ef7e4abd8c2559faa7f31a11fe05143', nonce: '506281792967', hash: '0000000000f7564d08e4c5b8189da2f0115108ae56cc61d33df9b14daf74e68b' },
  { height: '6', data: '1) Nauja kriptovaliuta ---> Gabija (50BTC)\n2) Mantas ---> Agnė (5BTC)', previousHash: '0000000000f7564d08e4c5b8189da2f0115108ae56cc61d33df9b14daf74e68b', nonce: '571892833284', hash: '00000000008d6ac78b0e03d17cc024edadad2de194b3bf60ed0b6a2066df056b' },
  { height: '7', data: '1) Nauja kriptovaliuta ---> Rokas (50BTC)\n2) Agnė ---> Simona (5BTC)', previousHash: '00000000008d6ac78b0e03d17cc024edadad2de194b3bf60ed0b6a2066df056b', nonce: '543053658674', hash: '00000000003881046cd5c6070356e1960010405e5eee387bbf6e7d8346aa0edd' },
  { height: '8', data: '1) Nauja kriptovaliuta ---> Simona (50BTC)', previousHash: '00000000003881046cd5c6070356e1960010405e5eee387bbf6e7d8346aa0edd', nonce: '640000152443', hash: '000000000033a7f6f11b4c5b2aef87417056a1cd1dc7f4bfd56882b5bfd05af0' },
  { height: '9', data: '1) Nauja kriptovaliuta ---> Mantas (50BTC)\n2) Rokas ---> Saulius (2BTC)\n3) Simona ---> Agnė (5BTC)\n4) Mantas ---> Gabija (3BTC)\n5) Simona ---> Agnė (4BTC)', previousHash: '000000000033a7f6f11b4c5b2aef87417056a1cd1dc7f4bfd56882b5bfd05af0', nonce: '1291810786235', hash: '0000000000eae5d5c2d12b30cb84d7bbcde31de5a16a82ed41b350a1434b0130' },
];

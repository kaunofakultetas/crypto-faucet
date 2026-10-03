// -----------------------------------------------------------
//  [*] Test support — default handlers for every UI endpoint
//
//  The happy path of the whole backend as the SPA sees it: one
//  msw handler per endpoint the code under src/ calls,
//  answering the fixtures. The handlers behave like the
//  backend where a page depends on it: an unknown network or
//  token is the backend's 400 with its Lithuanian message, the
//  UTXO graph leaves the mempool out of a window that is not
//  live (it ends more than an hour ago), an unknown txid is a
//  404, a payout without an address is a 400. The two public
//  chain endpoints the SVM and MOVE pages read the student's
//  own balance from (Solana JSON-RPC, Sui GraphQL — straight
//  from the browser, not through the backend) are answered
//  too, in their protocols' shapes.
//
//  Keep this in step with the SPA: the structural test
//  (tests/core/structural.test.js) extracts every axios / fetch
//  call from src/ and fails when one has no handler here — the
//  double must never fall behind the frontend it stands in
//  for.
//
//  Used by:
//    - server.js — the msw server starts from these handlers
// -----------------------------------------------------------

import { http, HttpResponse } from 'msw';
import * as f from './fixtures';
import { TEST_ORIGIN } from '../location';


const abs = (path) => `${TEST_ORIGIN}${path}`;
const json = (body) => () => HttpResponse.json(body);
const refuse = (message, status = 400) => HttpResponse.json({ error: message }, { status });

// A family's networks by key — an unknown key answers like the
// backend does
const knownNetwork = (map, network) => Object.hasOwn(map, network);
const unknownNetwork = (network) => refuse(`Nepalaikomas tinklas: ${network}`);
const addressOf = (request) => new URL(request.url).searchParams.get('address');

// A window whose end lies more than an hour back is not live
// (the backend's LIVE_WINDOW_S rule)
const isLiveWindow = (request) => {
  const to = Number(new URL(request.url).searchParams.get('to'));
  return !Number.isFinite(to) || to > Date.now() / 1000 - 3600;
};







// -----------------------------------------------------------
// defaultHandlers
// -----------------------------------------------------------
//
// Grouped by family, like the backend's route files: the
// catalog, EVM (+ its graph), ERC-20, UTXO (+ its graph), SVM,
// MOVE, the blockchain simulator. Param handlers compute their
// answer from the path.
//
// Used by:
//   - server.js
// -----------------------------------------------------------

export const defaultHandlers = [

  // The navbar's catalog of every family
  http.get(abs('/api/faucet/catalog'), json(f.catalog)),

  // EVM native coins
  http.get(abs('/api/evm/networks'), json(f.evmNetworks)),
  http.get(abs('/api/evm/:network/faucet-balance'), ({ params }) => (
    knownNetwork(f.evmNetworksMap, params.network) ? HttpResponse.json(f.evmBalance()) : unknownNetwork(params.network)
  )),
  http.get(abs('/api/evm/:network/request'), ({ params, request }) => {
    if (!knownNetwork(f.evmNetworksMap, params.network)) return unknownNetwork(params.network);
    if (!addressOf(request)) return refuse('Nenurodytas adresas');
    return HttpResponse.json(f.evmPayout());
  }),

  // The EVM transaction graph
  http.get(abs('/api/evm/:network/transaction-days'), json(f.evmTransactionDays())),
  http.get(abs('/api/evm/:network/get-stored-transactions'), json(f.evmStoredTransactions())),
  http.get(abs('/api/evm/set-address-name'), json({ status: 'OK' })),

  // ERC-20 tokens
  http.get(abs('/api/erc20/token/:symbol'), ({ params, request }) => (
    Object.hasOwn(f.erc20TokensMap, params.symbol)
      ? HttpResponse.json(f.erc20Token(params.symbol, addressOf(request)))
      : refuse(`Nepalaikomas žetonas: ${params.symbol}`)
  )),
  http.get(abs('/api/erc20/:network/:symbol/request'), ({ params, request }) => {
    if (!Object.hasOwn(f.erc20TokensMap, params.symbol)) return refuse(`Nepalaikomas žetonas: ${params.symbol}`);
    if (!addressOf(request)) return refuse('Nenurodytas adresas');
    return HttpResponse.json(f.erc20Payout(params.symbol, params.network));
  }),

  // UTXO chains
  http.get(abs('/api/utxo/networks'), json(f.utxoNetworks)),
  http.get(abs('/api/utxo/:network/faucet-balance'), ({ params }) => (
    knownNetwork(f.utxoNetworksMap, params.network) ? HttpResponse.json(f.utxoBalance()) : unknownNetwork(params.network)
  )),
  http.get(abs('/api/utxo/:network/request-btc'), ({ params, request }) => {
    if (!knownNetwork(f.utxoNetworksMap, params.network)) return unknownNetwork(params.network);
    if (!addressOf(request)) return refuse('Nenurodytas adresas');
    return HttpResponse.json(f.utxoPayout(params.network));
  }),

  // The UTXO transaction graph
  http.get(abs('/api/utxo/:network/graph'), ({ params, request }) => (
    knownNetwork(f.utxoNetworksMap, params.network)
      ? HttpResponse.json(f.utxoGraph({ live: isLiveWindow(request) }))
      : unknownNetwork(params.network)
  )),
  http.get(abs('/api/utxo/:network/transaction-days'), ({ params }) => (
    knownNetwork(f.utxoNetworksMap, params.network) ? HttpResponse.json(f.utxoTransactionDays()) : unknownNetwork(params.network)
  )),
  http.get(abs('/api/utxo/:network/transaction/:txid'), ({ params }) => {
    const found = f.utxoTransaction(params.txid);
    return found ? HttpResponse.json(found) : refuse('Transakcija nerasta: tinklo mazgas jos neturi nei blokuose, nei tinklo eilėje (No such mempool or blockchain transaction).', 404);
  }),
  http.get(abs('/api/utxo/:network/set-address-name'), ({ request }) => (
    addressOf(request) ? HttpResponse.json({ status: 'OK' }) : refuse('Trūksta adreso')
  )),

  // SVM (Solana)
  http.get(abs('/api/svm/networks'), json(f.svmNetworks)),
  http.get(abs('/api/svm/:network/faucet-balance'), ({ params }) => (
    knownNetwork(f.svmNetworksMap, params.network) ? HttpResponse.json(f.svmBalance()) : unknownNetwork(params.network)
  )),
  http.get(abs('/api/svm/:network/request'), ({ params, request }) => {
    if (!knownNetwork(f.svmNetworksMap, params.network)) return unknownNetwork(params.network);
    if (!addressOf(request)) return refuse('Nenurodytas adresas');
    return HttpResponse.json(f.svmPayout());
  }),

  // The student's own SOL — Solana JSON-RPC getBalance, public
  http.post(f.svmNetworksMap.solanaDevnet.rpc_urls[0], async ({ request }) => {
    const { id } = await request.json();
    return HttpResponse.json({ jsonrpc: '2.0', id, result: { context: { slot: 412345678 }, value: f.STUDENT_SVM_LAMPORTS } });
  }),

  // MOVE (Sui)
  http.get(abs('/api/move/networks'), json(f.moveNetworks)),
  http.get(abs('/api/move/:network/faucet-balance'), ({ params }) => (
    knownNetwork(f.moveNetworksMap, params.network) ? HttpResponse.json(f.moveBalance()) : unknownNetwork(params.network)
  )),
  http.get(abs('/api/move/:network/request'), ({ params, request }) => {
    if (!knownNetwork(f.moveNetworksMap, params.network)) return unknownNetwork(params.network);
    if (!addressOf(request)) return refuse('Nenurodytas adresas');
    return HttpResponse.json(f.movePayout());
  }),

  // The student's own SUI — Sui GraphQL, public
  http.post(f.moveNetworksMap.suiTestnet.rpc_urls[0], () => (
    HttpResponse.json({ data: { address: { balance: { totalBalance: String(f.STUDENT_SUI_MIST) } } } })
  )),

  // The blockchain simulator's example chain
  http.get(abs('/api/get-example-blockchain'), json(f.exampleBlockchain)),
];

// -----------------------------------------------------------
//  [*] Hooks — useEvmNetworks
//
//  The EVM network list (GET /api/evm/networks) as the one
//  query every page that reads it shares. The EVM faucet page
//  takes its chain ids, names and MetaMask's add-chain data
//  from it; the transaction graph takes its root — the
//  faucet's own address, which the backend reads off the
//  faucet key, so the graph stands while a network's RPC is
//  down — with the currency symbol and the explorer flag.
//
//  Both pages read the same cache entry, so both must accept
//  the same answers: a page checking more strictly would fail
//  on what the other one cached, or cache what the other one
//  refuses. The rule lives here once — an object with a
//  networks map; what a page needs from its own network's
//  entry, it checks itself.
//
//  Split into:
//
//    isEvmCatalog   — the shape rule
//    useEvmNetworks — the shared query (default export)
// -----------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { MalformedAnswerError } from '@/utils/requestError';







// -----------------------------------------------------------
// isEvmCatalog
// -----------------------------------------------------------
//
// Whether an /api/evm/networks answer can drive a page: an
// object whose networks map holds an entry per network.
// Anything else — a proxy's empty body, a list, the map
// missing — is a malformed answer. The query refuses one, and
// the pages check again on the way out of the cache, which a
// test or an older build may have filled without the rule.
//
// Used by:
//   - useEvmNetworks (below) — the query's check
//   - pages/Faucet_EVM/Page.jsx — useFaucetInfo's cache read
//   - pages/Graph/Page.jsx — GraphPage's cache read
// -----------------------------------------------------------

export function isEvmCatalog(body) {

  const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  return isPlainObject(body) && isPlainObject(body.networks);
}







// -----------------------------------------------------------
// useEvmNetworks (default export)
// -----------------------------------------------------------
//
// The network list under its shared cache key: the answer
// once it passed isEvmCatalog, a MalformedAnswerError when it
// did not, the request's own error when it failed. Kept fresh
// for five minutes — the list changes only with the backend's
// config — so moving between the faucet and the graph asks
// for it once.
//
// Used by:
//   - pages/Faucet_EVM/Page.jsx — useFaucetInfo
//   - pages/Graph/Page.jsx — GraphPage
// -----------------------------------------------------------

export default function useEvmNetworks() {

  return useQuery({
    queryKey: ['evm-networks'],
    queryFn: async () => {
      const body = (await axios.get('/api/evm/networks')).data;
      if (!isEvmCatalog(body)) throw new MalformedAnswerError();
      return body;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// -----------------------------------------------------------
//  [*] useMetamaskWallet — MetaMask on EVM chains
//
//  The EVM-family pages' wallet hook — MetaMask's OWN
//  provider (resolved via EIP-6963, never bare
//  window.ethereum) plus one Web3 instance, with account and
//  chain kept fresh through MetaMask's events. The returned
//  `step` is the single source of truth:
//  0 install → 1 connect → 2 switch network → 3 ready.
//
//  Split into (root last) — the MetaMask conversations are
//  plain functions, the hook wires their results into state:
//
//    WALLET_REFRESH_MS   — balance repoll cadence
//    getMetamaskProvider — MetaMask's provider, nobody else's
//    connectMetamask     — the connect conversation
//    requestChainHop     — the switch/add-chain conversation
//    signClaimMessage    — the ownership-proof conversation
//    useMetamaskWallet   — state wiring + balance + step
//                          (default export)
//
//  Used by:
//    - pages/Faucet_EVM/Page.jsx
//    - pages/Faucet_ERC20/Page.jsx
// -----------------------------------------------------------

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Web3 from 'web3';


// How often the user's balance repolls — fast, so students
// see it tick up right after a claim
const WALLET_REFRESH_MS = 1000;







// -----------------------------------------------------------
// getMetamaskProvider
// -----------------------------------------------------------
//
// THE MetaMask provider — never bare window.ethereum, which
// is contested territory: Phantom injects an EVM provider
// there too, with isMetaMask set to true, so with both
// extensions installed every "MetaMask" call was answered by
// Phantom's popup. EIP-6963 discovery settles it — installed
// wallets announce themselves synchronously on request, and
// rdns io.metamask* is an identity, not a flag anyone can
// fake in the same way. null = treat MetaMask as not
// installed rather than talk to a stranger.
//
// Cached after the first hit — the winner cannot change
// within a page load; a miss is retried on every call, so a
// late-injecting extension still gets picked up.
//
// Used by:
//   - connectMetamask / requestChainHop (below)
//   - useMetamaskWallet (below) — the detection effect
//   - pages/Faucet_ERC20/Page.jsx — wallet_watchAsset
// -----------------------------------------------------------

let cachedProvider = null;

export const getMetamaskProvider = () => {
  if (cachedProvider) return cachedProvider;
  if (typeof window === 'undefined') return null;

  const onAnnounce = (event) => {
    if (event.detail?.info?.rdns?.startsWith('io.metamask')) {
      cachedProvider = event.detail.provider;
    }
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  window.removeEventListener('eip6963:announceProvider', onAnnounce);

  return cachedProvider;
};







// -----------------------------------------------------------
// connectMetamask
// -----------------------------------------------------------
//
// The connect conversation: ask MetaMask for the accounts
// and hand back the first, or null when none arrive.
// MetaMask's own rejection error is passed through — the
// pages display e.message.
//
// Used by:
//   - useMetamaskWallet (below) — connect()
// -----------------------------------------------------------

async function connectMetamask() {
  const provider = getMetamaskProvider();
  if (!provider) throw new Error('MetaMask dar neįkelta. Bandykite dar kartą.');

  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  return accounts[0] ?? null;
}







// -----------------------------------------------------------
// requestChainHop
// -----------------------------------------------------------
//
// The chain-hop conversation: switch MetaMask to the
// faucet's chain. A chain it doesn't know (error 4902) is
// added first from the network config, and the landing is
// verified afterwards, because MetaMask can silently stay
// put. Throws a ready-to-display Lithuanian message. Touches
// no state — the chainChanged event reports the outcome.
//
// Used by:
//   - useMetamaskWallet (below) — switchNetwork()
// -----------------------------------------------------------

async function requestChainHop(networkInfo) {
  const provider = getMetamaskProvider();
  if (!provider) throw new Error('MetaMask dar neįkelta. Bandykite dar kartą.');

  const chainIdHex = `0x${networkInfo.chain_id.toString(16)}`;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    // 4902 = MetaMask doesn't know the chain yet. Newer builds
    // sometimes wrap it inside an internal error instead of
    // answering with it at the top level.
    const chainUnknown = err?.code === 4902
      || err?.data?.originalError?.code === 4902;
    if (!chainUnknown) {
      throw new Error(`Nepavyko persijungti į tinklą: ${err.message}`);
    }

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainIdHex,
        // chain_name is the config's metamask-section name —
        // the one the wallet STORES; full_name is only the
        // faucet UI's display name
        chainName: networkInfo.chain_name || networkInfo.full_name,
        nativeCurrency: networkInfo.native_currency,
        rpcUrls: networkInfo.rpc_urls,
        blockExplorerUrls: networkInfo.block_explorer_urls,
      }],
    }).catch((addErr) => {
      throw new Error(`Nepavyko pridėti tinklo: ${addErr.message}`);
    });
  }

  const landedOn = await provider.request({ method: 'eth_chainId' });
  if (landedOn !== chainIdHex) {
    throw new Error('Nepavyko persijungti į reikiamą tinklą. Patikrinkite MetaMask nustatymus.');
  }
}







// -----------------------------------------------------------
// signClaimMessage
// -----------------------------------------------------------
//
// The ownership-proof conversation: a fresh nonce inside the
// fixed message, signed in MetaMask via personal_sign. The
// wording must match the EVM backend's verification byte for
// byte — this is the only place it is written, so the EVM
// and ERC-20 pages can never drift apart.
//
// Used by:
//   - useMetamaskWallet (below) — signMessage()
// -----------------------------------------------------------

async function signClaimMessage(web3, account) {
  if (!web3 || !account) {
    throw new Error('Metamask piniginė neprijungta.');
  }

  const nonce = Date.now().toString();
  const message = `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;
  const signature = await web3.eth.personal.sign(message, account, '');

  return { nonce, signature };
}







// -----------------------------------------------------------
// useMetamaskWallet (default export)
// -----------------------------------------------------------
//
//   const { web3, installed, account, chainId, balance, step,
//           connect, switchNetwork, signMessage } =
//     useMetamaskWallet(expectedChainId)
//
// expectedChainId is the faucet network's chain id; the
// balance is only fetched while the wallet is actually on it,
// so a wrong-chain wallet shows "not connected" instead of a
// number from somewhere else. Pass nothing on pages that are
// chain-agnostic (the ERC-20 faucet spans many chains at
// once) — then a connected wallet is already step 3 and no
// balance is polled. connect/switchNetwork/signMessage all
// reject with a ready-to-display message.
//
// Used by:
//   - both faucet pages (see the file header)
// -----------------------------------------------------------

export default function useMetamaskWallet(expectedChainId) {

  const [web3, setWeb3] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);


  // Detect MetaMask once — its OWN provider, so another
  // wallet squatting on window.ethereum is never mistaken for
  // it; the listeners keep account/chain in step with what
  // the student does inside the extension
  useEffect(() => {
    const provider = getMetamaskProvider();
    if (!provider) return;

    setInstalled(true);
    const w3 = new Web3(provider);
    setWeb3(w3);

    const handleAccountsChanged = (acc) => setAccount(acc[0] ?? null);
    const handleChainChanged = (id) => setChainId(parseInt(id, 16));

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);

    w3.eth.getAccounts().then(handleAccountsChanged);
    w3.eth.getChainId().then((id) => setChainId(Number(id)));

    return () => {
      provider.removeListener('accountsChanged', handleAccountsChanged);
      provider.removeListener('chainChanged', handleChainChanged);
    };
  }, []);


  // Balance repoll — TanStack Query owns the timer and the
  // stale-response handling. The chain is re-checked on every
  // tick because the student can switch networks in MetaMask
  // at any moment; a wrong-chain wallet reports null so pages
  // never show a number from somewhere else.
  const { data: balance = null } = useQuery({
    queryKey: ['wallet-balance', account, expectedChainId],
    enabled: Boolean(web3 && account && expectedChainId),
    refetchInterval: WALLET_REFRESH_MS,
    retry: false,
    queryFn: async () => {
      const currentId = await web3.eth.getChainId();
      if (Number(currentId) !== Number(expectedChainId)) return null;
      return await web3.eth.getBalance(account);
    },
  });


  // The actions are the MetaMask conversations at the top of
  // the file — the wrappers translate their results into state
  const connect = () => connectMetamask().then((acc) => {
    if (acc) setAccount(acc);
  });

  // The hop is VERIFIED inside requestChainHop (it read
  // eth_chainId after switching), so record the landing
  // directly: per-dapp MetaMask builds switch an
  // already-permitted chain silently and do not reliably emit
  // chainChanged — waiting for the event froze the stepper on
  // the switch step after a successful hop
  const switchNetwork = async (networkInfo) => {
    await requestChainHop(networkInfo);
    setChainId(Number(networkInfo.chain_id));
  };

  const signMessage = () => signClaimMessage(web3, account);


  // 0 install → 1 connect → 2 switch network → 3 ready. With
  // no expectedChainId there is no chain to be wrong about, so
  // a connected wallet goes straight to ready.
  const step = !installed ? 0
    : !account ? 1
    : (expectedChainId && chainId !== expectedChainId) ? 2
    : 3;


  return { web3, installed, account, chainId, balance, step, connect, switchNetwork, signMessage };
}

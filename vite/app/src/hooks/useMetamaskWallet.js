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
//    onMetamaskProvider  — called back when it announces late
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
// getMetamaskProvider / onMetamaskProvider
// -----------------------------------------------------------
//
// THE MetaMask provider — never bare window.ethereum, which
// is contested territory: Phantom injects an EVM provider
// there too, with isMetaMask set to true, so with both
// extensions installed every "MetaMask" call was answered by
// Phantom's popup. EIP-6963 discovery settles it — installed
// wallets announce themselves on request, and rdns
// io.metamask* is an identity, not a flag anyone can fake in
// the same way. null = treat MetaMask as not installed rather
// than talk to a stranger.
//
// Discovery is EVENT-DRIVEN and lives for the whole page: the
// announce listener stays registered (wallets also announce
// on their own, and some answer a request from a later tick
// — a listener removed right after the request misses them),
// the request is re-issued once the page has loaded, and a
// hook that found nothing at mount is called back the moment
// a provider shows up (onMetamaskProvider). The first
// announcement wins, except that the stable io.metamask
// build outranks flask / mmi — with two builds installed the
// student gets the one they mean.
//
// Used by:
//   - connectMetamask / requestChainHop (below)
//   - useMetamaskWallet (below) — the detection effect
//   - pages/Faucet_ERC20/Page.jsx — wallet_watchAsset
// -----------------------------------------------------------

let cachedProvider = null;
let cachedRdns = null;
const waiters = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (event) => {
    const rdns = event.detail?.info?.rdns;
    if (!rdns?.startsWith('io.metamask')) return;
    // First one wins — unless the stable build announces after
    // a flask / mmi build did
    if (cachedProvider && (cachedRdns === 'io.metamask' || rdns !== 'io.metamask')) return;
    cachedProvider = event.detail.provider;
    cachedRdns = rdns;
    waiters.forEach((notify) => notify(cachedProvider));
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  window.addEventListener('load', () => window.dispatchEvent(new Event('eip6963:requestProvider')));
}

export const getMetamaskProvider = () => cachedProvider;

export const onMetamaskProvider = (notify) => {
  waiters.add(notify);
  return () => waiters.delete(notify);
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
// added first from the network config — and switched to
// again afterwards, because adding does not necessarily
// switch (MetaMask asks twice, and a declined second prompt
// still resolves the add). The landing is verified at the
// end, because MetaMask can silently stay put. Throws a
// ready-to-display Lithuanian message. Touches no state —
// the caller records the verified landing.
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

    // Adding does not necessarily switch — ask again now that
    // the chain is known; a rejection here is the student
    // declining, which the landing check below reports
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    }).catch(() => {});
  }

  const landedOn = await provider.request({ method: 'eth_chainId' });
  if (landedOn !== chainIdHex) {
    throw new Error('Tinklas dar neįjungtas — paspauskite mygtuką dar kartą arba perjunkite tinklą MetaMask lange.');
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
//   const { web3, installed, account, chainId, balance,
//           balanceFailed, step, connect, switchNetwork,
//           signMessage } = useMetamaskWallet(expectedChainId)
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


  // Detect MetaMask — its OWN provider, so another wallet
  // squatting on window.ethereum is never mistaken for it. A
  // provider that announces AFTER mount (a cold browser start,
  // an extension that just updated) is wired the moment it
  // arrives, so the install step can't stick on a wallet that
  // is really there. The listeners keep account/chain in step
  // with what the student does inside the extension; the two
  // bootstrap reads can reject while the extension port is
  // briefly down — the balance tick below writes the chain
  // back, so nothing stays wrong for long.
  useEffect(() => {
    let alive = true;
    let detach = () => {};

    const wire = (provider) => {
      setInstalled(true);
      const w3 = new Web3(provider);
      setWeb3(w3);

      const handleAccountsChanged = (acc) => setAccount(acc[0] ?? null);
      const handleChainChanged = (id) => setChainId(parseInt(id, 16));

      provider.on('accountsChanged', handleAccountsChanged);
      provider.on('chainChanged', handleChainChanged);

      w3.eth.getAccounts()
        .then((acc) => { if (alive) handleAccountsChanged(acc); })
        .catch((e) => console.warn('[metamask] eth_accounts failed', e));
      w3.eth.getChainId()
        .then((id) => { if (alive) setChainId(Number(id)); })
        .catch((e) => console.warn('[metamask] eth_chainId failed', e));

      detach = () => {
        provider.removeListener('accountsChanged', handleAccountsChanged);
        provider.removeListener('chainChanged', handleChainChanged);
      };
    };

    const provider = getMetamaskProvider();
    if (provider) {
      wire(provider);
    } else {
      const forget = onMetamaskProvider((late) => {
        forget();
        if (alive) wire(late);
      });
      detach = forget;
    }

    return () => {
      alive = false;
      detach();
    };
  }, []);


  // Balance repoll — TanStack Query owns the timer and the
  // stale-response handling. The chain is re-checked on every
  // tick because the student can switch networks in MetaMask
  // at any moment, and the read is written BACK: chainChanged
  // is not reliably emitted (see switchNetwork), so this tick
  // is what keeps the stepper honest. A wrong-chain wallet
  // reports null so pages never show a number from somewhere
  // else. A poll that FAILS (MetaMask's own RPC rejecting
  // eth_getBalance) is reported as balanceFailed, so a page
  // shows a dash instead of "Loading…" forever.
  const { data: balance = null, isError: balanceFailed } = useQuery({
    queryKey: ['wallet-balance', account, expectedChainId],
    enabled: Boolean(web3 && account && expectedChainId),
    refetchInterval: WALLET_REFRESH_MS,
    retry: false,
    queryFn: async () => {
      const currentId = Number(await web3.eth.getChainId());
      setChainId(currentId);
      if (currentId !== Number(expectedChainId)) return null;
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


  return { web3, installed, account, chainId, balance, balanceFailed, step, connect, switchNetwork, signMessage };
}

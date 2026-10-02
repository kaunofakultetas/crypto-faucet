// -----------------------------------------------------------
//  [*] useMetamaskWallet — MetaMask on EVM chains
//
//  The EVM-family pages' wallet hook — MetaMask's OWN
//  provider (resolved via EIP-6963, never bare
//  window.ethereum), with account and chain kept fresh
//  through MetaMask's events. The returned `step` is the
//  single source of truth:
//  0 install → 1 connect → 2 switch network → 3 ready.
//
//  The page talks to ONE provider at a time: the module picks
//  it, every conversation asks the module for it when it
//  starts, and the hook moves its listeners and reads over
//  the moment the pick changes. Connecting, switching, signing
//  and the account on screen can never belong to two
//  different MetaMask builds — the signature request used to
//  go to a build that had never been connected and refused.
//
//  Every call goes straight through provider.request —
//  MetaMask answers the account, chain, balance, signature
//  and chain-switch requests itself, so no wallet library is
//  bundled for them. Hex answers are decoded here: chain ids
//  to numbers, the balance to a BigInt of wei.
//
//  Split into (root last) — the MetaMask conversations are
//  plain functions, the hook wires their results into state:
//
//    WALLET_REFRESH_MS   — balance and chain repoll cadence
//    utf8ToHex           — personal_sign's message encoding
//    getMetamaskProvider — MetaMask's provider, nobody else's
//    onMetamaskProvider  — called back whenever the pick changes
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


// How often the user's balance repolls — fast, so students
// see it tick up right after a claim; a page with no chain
// to expect re-reads only the chain on the same cadence
const WALLET_REFRESH_MS = 1000;

// The module's pick — the provider every conversation uses —
// and its rdns, so the stable build can outrank the one
// already picked
let cachedProvider = null;
let cachedRdns = null;

// The hooks following the pick, told whenever it changes
const waiters = new Set();

// The claim message as personal_sign wants it: the UTF-8
// bytes, hex-encoded. Sent as a plain string MetaMask would
// guess the encoding; hex is unambiguous, and the backend
// recovers the signer from the very same bytes.
const utf8ToHex = (text) =>
  '0x' + Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('');







// -----------------------------------------------------------
// getMetamaskProvider
// -----------------------------------------------------------
//
// THE MetaMask provider — never bare window.ethereum, which
// is contested territory: Phantom injects an EVM provider
// there too, with isMetaMask set to true, so with both
// extensions installed every "MetaMask" call was answered by
// Phantom's popup. EIP-6963 discovery settles it — installed
// wallets announce themselves on request, and rdns
// io.metamask* is an identity, not a flag anyone can fake in
// the same way. No provider means MetaMask is treated as not
// installed rather than talking to a stranger.
//
// Discovery is EVENT-DRIVEN and lives for the whole page: the
// announce listener stays registered (wallets also announce
// on their own, and some answer a request from a later tick
// — a listener removed right after the request misses them),
// and the request is re-issued once the page has loaded. The
// first announcement wins, except that the stable io.metamask
// build outranks flask / mmi — with two builds installed the
// student gets the one they mean, even when it announces
// last. Every change of the pick is passed on to the hooks
// following it (onMetamaskProvider, below).
//
// Used by:
//   - connectMetamask / requestChainHop / signClaimMessage
//     (below)
//   - useMetamaskWallet (below) — the detection effect
//   - pages/Faucet_ERC20/Page.jsx — wallet_watchAsset
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// onMetamaskProvider
// -----------------------------------------------------------
//
// Lets a mounted hook follow the module's pick: the listener
// is handed the new provider every time the pick changes — a
// first announcement that comes late, or the stable build
// taking over from flask — until the function handed back
// stops it. A hook listens for as long as it is mounted, so a
// page never goes on talking to a build the module has left.
//
// Used by:
//   - useMetamaskWallet (below) — the detection effect
// -----------------------------------------------------------

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
// fixed message, signed in MetaMask via personal_sign — by
// the provider the module has picked, the same one the
// account came from. The wording must match the EVM
// backend's verification byte for byte — this is the only
// place it is written, so the EVM and ERC-20 pages can never
// drift apart.
//
// Used by:
//   - useMetamaskWallet (below) — signMessage()
// -----------------------------------------------------------

async function signClaimMessage(account) {
  const provider = getMetamaskProvider();
  if (!provider || !account) {
    throw new Error('MetaMask piniginė neprijungta.');
  }

  const nonce = Date.now().toString();
  const message = `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;
  const signature = await provider.request({
    method: 'personal_sign',
    params: [utf8ToHex(message), account],
  });

  return { nonce, signature };
}







// -----------------------------------------------------------
// useMetamaskWallet (default export)
// -----------------------------------------------------------
//
// Everything a page shows and does with MetaMask: whether it
// is installed, the connected account, the chain the wallet
// sits on, the account's balance there (a BigInt of wei, null
// while unknown) with a flag for a balance read that failed,
// the step of the ladder, and the three actions — connect,
// switchNetwork and signMessage — which all reject with a
// ready-to-display message.
//
// The page passes the chain its faucet pays on. The balance
// is only fetched while the wallet actually sits there, so a
// wrong-chain wallet shows "not connected" instead of a
// number from somewhere else. A page that spans many chains
// (the ERC-20 faucet) passes none: a connected wallet is
// then ready on any chain and no balance is polled, but the
// chain itself is still re-read on the same cadence, so a
// lost first read or a silent switch is repaired there too.
//
// Used by:
//   - both faucet pages (see the file header)
// -----------------------------------------------------------

export default function useMetamaskWallet(expectedChainId) {

  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const installed = provider !== null;


  // Detect MetaMask — its OWN provider, so another wallet
  // squatting on window.ethereum is never mistaken for it —
  // and follow the module's pick for as long as the page is
  // up. A provider that announces AFTER mount (a cold browser
  // start, an extension that just updated) is wired the moment
  // it arrives, and the stable build replaces a flask build
  // wired before it. A replacement starts from scratch: the
  // account and chain on screen belonged to the build left
  // behind, and that build's answers still in flight are
  // dropped. The listeners keep account/chain in step with
  // what the student does inside the extension; the two
  // bootstrap reads can reject while the extension port is
  // briefly down — the ticks below write the chain back, so
  // nothing stays wrong for long.
  useEffect(() => {
    let wired = null;
    let unwire = () => {};

    const wire = (next) => {
      if (next === wired) return;
      unwire();
      wired = next;

      setProvider(next);
      setAccount(null);
      setChainId(null);

      const handleAccountsChanged = (acc) => {
        if (wired === next) setAccount(acc[0] ?? null);
      };
      const handleChainChanged = (id) => {
        if (wired === next) setChainId(parseInt(id, 16));
      };

      next.on('accountsChanged', handleAccountsChanged);
      next.on('chainChanged', handleChainChanged);

      next.request({ method: 'eth_accounts' })
        .then(handleAccountsChanged)
        .catch((e) => console.warn('[metamask] eth_accounts failed', e));
      next.request({ method: 'eth_chainId' })
        .then(handleChainChanged)
        .catch((e) => console.warn('[metamask] eth_chainId failed', e));

      unwire = () => {
        next.removeListener('accountsChanged', handleAccountsChanged);
        next.removeListener('chainChanged', handleChainChanged);
      };
    };

    const stopFollowing = onMetamaskProvider(wire);
    const found = getMetamaskProvider();
    if (found) wire(found);

    return () => {
      stopFollowing();
      unwire();
      wired = null;
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
  // shows a dash instead of "Kraunama…" forever.
  const { data: balance = null, isError: balanceFailed } = useQuery({
    queryKey: ['wallet-balance', account, expectedChainId],
    enabled: Boolean(provider && account && expectedChainId),
    refetchInterval: WALLET_REFRESH_MS,
    retry: false,
    queryFn: async () => {
      const currentId = parseInt(await provider.request({ method: 'eth_chainId' }), 16);
      setChainId(currentId);
      if (currentId !== Number(expectedChainId)) return null;
      const wei = await provider.request({ method: 'eth_getBalance', params: [account, 'latest'] });
      return BigInt(wei);
    },
  });


  // The same repair without a chain to expect: no balance to
  // poll, so nothing re-read the chain, and a first read lost
  // while the extension port was down — or a switch inside
  // MetaMask that emitted no chainChanged — stayed wrong for
  // good (the ERC-20 page kept asking to switch to the chain
  // the wallet was already on). The chain alone is re-read on
  // the balance's cadence; the first re-read waits a full
  // tick, and a failed one simply waits for the next.
  useEffect(() => {
    if (!provider || !account || expectedChainId) return undefined;

    let stopped = false;
    const tick = setInterval(() => {
      provider.request({ method: 'eth_chainId' })
        .then((id) => {
          if (!stopped) setChainId(parseInt(id, 16));
        })
        .catch(() => {});
    }, WALLET_REFRESH_MS);

    return () => {
      stopped = true;
      clearInterval(tick);
    };
  }, [provider, account, expectedChainId]);


  // The actions are the MetaMask conversations at the top of
  // the file — each asks the module for the provider when it
  // starts, the one the detection effect follows — and the
  // wrappers translate their results into state
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

  const signMessage = () => signClaimMessage(account);


  // 0 install → 1 connect → 2 switch network → 3 ready. With
  // no expectedChainId there is no chain to be wrong about, so
  // a connected wallet goes straight to ready.
  const step = !installed ? 0
    : !account ? 1
    : (expectedChainId && chainId !== expectedChainId) ? 2
    : 3;


  return { installed, account, chainId, balance, balanceFailed, step, connect, switchNetwork, signMessage };
}

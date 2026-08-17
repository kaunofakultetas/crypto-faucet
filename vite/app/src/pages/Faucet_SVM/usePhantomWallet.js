// -----------------------------------------------------------
//  [*] usePhantomWallet — Phantom on Solana
//
//  The SVM page's wallet hook — window.phantom.solana in the
//  role window.ethereum plays for the EVM hook. The returned
//  `step` is the single source of truth:
//  0 install → 1 connect → 2 cluster → 3 ready.
//
//  Phantom's one big quirk: it cannot reliably hop clusters
//  and never reports the one it is showing, so the cluster
//  step is a remembered click ('confirmed' / 'assumed'), not
//  live state — details in requestClusterHop.
//
//  Split into (root last) — the Phantom conversations are
//  plain functions, the hook wires their results into state:
//
//    CLUSTER_GENESIS    — cluster name → genesis hash
//    getPhantomProvider — the injected provider, Phantom only
//    addressOf          — publicKey (string or object) → base58
//    isMethodMissing    — "this build has no changeNetwork"
//    connectPhantom     — the connect conversation
//    requestClusterHop  — the changeNetwork conversation
//    signClaimMessage   — the ownership-proof conversation
//    usePhantomWallet   — state wiring + step (default export)
//
//  Used by:
//    - pages/Faucet_SVM/Page.jsx
// -----------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import bs58 from 'bs58';







// -----------------------------------------------------------
// CLUSTER_GENESIS
// -----------------------------------------------------------
//
// Solana cluster → genesis hash, the identifier Phantom's
// changeNetwork accepts. Each is a base58-encoded 32 BYTES
// (43-44 characters) — a truncated one is silently rejected.
//
// Used by:
//   - requestClusterHop (below)
// -----------------------------------------------------------

const CLUSTER_GENESIS = {
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};







// -----------------------------------------------------------
// getPhantomProvider
// -----------------------------------------------------------
//
// The injected provider, or null. Prefers
// window.phantom.solana so we do not pick up Brave (or
// another wallet) sitting on the legacy window.solana slot.
// Re-resolved on every use rather than cached — the extension
// injects on its own schedule.
//
// Used by:
//   - connectPhantom / requestClusterHop / signClaimMessage
//     (below)
//   - usePhantomWallet (below) — the detection effect
// -----------------------------------------------------------

const getPhantomProvider = () => {
  if (typeof window === 'undefined') return null;
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solana?.isPhantom) return window.solana;
  return null;
};







// -----------------------------------------------------------
// addressOf
// -----------------------------------------------------------
//
// publicKey → base58 string, or null. Phantom's publicKey is
// sometimes a string, sometimes a PublicKey-like object with
// toBase58/toString — this smooths the difference over.
//
// Used by:
//   - connectPhantom (below)
//   - usePhantomWallet (below) — the account event handlers
// -----------------------------------------------------------

const addressOf = (publicKey) => {
  if (!publicKey) return null;
  if (typeof publicKey === 'string') return publicKey;
  if (typeof publicKey.toBase58 === 'function') return publicKey.toBase58();
  if (typeof publicKey.toString === 'function') return publicKey.toString();
  return null;
};







// -----------------------------------------------------------
// isMethodMissing
// -----------------------------------------------------------
//
// "This build has no changeNetwork": such builds answer
// -32601, but the wording varies by version, so the message
// is matched too.
//
// Used by:
//   - requestClusterHop (below)
// -----------------------------------------------------------

const isMethodMissing = (e) =>
  e?.code === -32601
  || /method not found|not implemented|unsupported/i.test(String(e?.message || ''));







// -----------------------------------------------------------
// connectPhantom
// -----------------------------------------------------------
//
// The connect conversation: ask Phantom for the account and
// unwrap the base58 address. Throws a ready-to-display
// Lithuanian message on refusal or a missing account.
//
// Used by:
//   - usePhantomWallet (below) — connect()
// -----------------------------------------------------------

async function connectPhantom() {
  const provider = getPhantomProvider();
  if (!provider) throw new Error('Phantom dar neįkelta. Bandykite dar kartą.');

  try {
    const resp = await provider.connect();
    const addr = addressOf(resp?.publicKey) ?? addressOf(provider.publicKey);
    if (!addr) throw new Error('Phantom negrąžino Solana paskyros.');
    return addr;
  } catch (e) {
    if (e?.code === 4001) throw new Error('Prijungimas atmestas Phantom lange.');
    throw new Error(e.message || 'Nepavyko prijungti Phantom.');
  }
}







// -----------------------------------------------------------
// requestClusterHop
// -----------------------------------------------------------
//
// The cluster-hop conversation: hand Phantom's changeNetwork
// the cluster's genesis hash. A build that ships the method
// answers → 'confirmed'; one that does not leaves the hop to
// the student's own clicks → 'assumed' (the page then keeps
// the Testnet Mode instructions visible). A refusal or a
// real failure throws a ready-to-display message.
//
// Used by:
//   - usePhantomWallet (below) — switchNetwork()
// -----------------------------------------------------------

async function requestClusterHop(cluster) {
  const provider = getPhantomProvider();
  if (!provider) throw new Error('Phantom dar neįkelta. Bandykite dar kartą.');

  const genesisHash = CLUSTER_GENESIS[cluster];
  if (!genesisHash) throw new Error('Nežinomas SVM tinklas.');

  if (typeof provider.request === 'function') {
    try {
      await provider.request({ method: 'changeNetwork', params: { genesisHash } });
      return 'confirmed';
    } catch (e) {
      if (e?.code === 4001) throw new Error('Persijungimas atmestas Phantom lange.');
      if (!isMethodMissing(e)) throw new Error(`Nepavyko persijungti į tinklą: ${e.message}`);
    }
  }

  return 'assumed';
}







// -----------------------------------------------------------
// signClaimMessage
// -----------------------------------------------------------
//
// The ownership-proof conversation: a fresh nonce inside the
// fixed message, signed in Phantom, base58-encoded for the
// backend. The wording must match svm_faucet.request_sol
// byte for byte — this is the only place it is written.
//
// Used by:
//   - usePhantomWallet (below) — signMessage()
// -----------------------------------------------------------

async function signClaimMessage(address) {
  const provider = getPhantomProvider();
  if (!provider || !address) {
    throw new Error('Phantom piniginė neprijungta.');
  }

  const nonce = Date.now().toString();
  const message = `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;
  const bytes = new TextEncoder().encode(message);

  let result;
  try {
    result = await provider.signMessage(bytes, 'utf8');
  } catch (e) {
    if (e?.code === 4001) throw new Error('Pasirašymas atmestas Phantom lange.');
    throw new Error(e.message || 'Nepavyko pasirašyti žinutės.');
  }

  // The backend verifies a base58 signature; Phantom hands
  // back raw bytes (older builds, the array itself)
  const signatureBytes = result?.signature ?? result;
  if (!signatureBytes) throw new Error('Phantom negrąžino parašo.');

  return { nonce, signature: bs58.encode(Uint8Array.from(signatureBytes)) };
}







// -----------------------------------------------------------
// usePhantomWallet (default export)
// -----------------------------------------------------------
//
//   const { installed, address, step, clusterConfirmed,
//           connect, switchNetwork, signMessage } =
//     usePhantomWallet(expectedCluster)
//
// expectedCluster is the faucet network's flavour ('devnet' |
// 'testnet' | 'mainnet'); with none there is no cluster to be
// wrong about and a connected wallet is already step 3.
// clusterConfirmed is false when the student passed the
// cluster step on a build that could not confirm the hop — the
// page then keeps showing the manual instructions. Balance
// polling stays on the page: the wallet owns no RPC.
// connect / switchNetwork / signMessage reject with a
// ready-to-display Lithuanian message.
//
// Used by:
//   - Page.jsx — FaucetSVM
// -----------------------------------------------------------

export default function usePhantomWallet(expectedCluster) {

  const [installed, setInstalled] = useState(false);
  const [address, setAddress] = useState(null);

  // null = still on the cluster step, 'confirmed' = Phantom
  // accepted the hop, 'assumed' = the build could not tell us
  const [clusterStatus, setClusterStatus] = useState(null);


  // Detect Phantom once; the listeners keep the address in
  // step with what the student does inside the extension
  useEffect(() => {

    const provider = getPhantomProvider();
    if (!provider) return undefined;

    setInstalled(true);

    const handleConnect = (publicKey) => {
      setAddress(addressOf(publicKey) ?? addressOf(provider.publicKey));
    };
    const handleDisconnect = () => {
      setAddress(null);
      setClusterStatus(null);
    };
    const handleAccountChanged = (publicKey) => {
      if (publicKey) {
        setAddress(addressOf(publicKey));
        return;
      }
      // New account is not yet trusted for this origin —
      // Phantom docs: reconnect so the student is not stranded
      setAddress(null);
      provider.connect().catch(() => {});
    };

    provider.on('connect', handleConnect);
    provider.on('disconnect', handleDisconnect);
    provider.on('accountChanged', handleAccountChanged);

    if (provider.isConnected && provider.publicKey) {
      setAddress(addressOf(provider.publicKey));
    } else {
      // Eager reconnect: no popup when this origin is already
      // a Trusted App; 4001 is swallowed on purpose
      provider.connect({ onlyIfTrusted: true }).catch(() => {});
    }

    return () => {
      if (typeof provider.off === 'function') {
        provider.off('connect', handleConnect);
        provider.off('disconnect', handleDisconnect);
        provider.off('accountChanged', handleAccountChanged);
      } else if (typeof provider.removeListener === 'function') {
        provider.removeListener('connect', handleConnect);
        provider.removeListener('disconnect', handleDisconnect);
        provider.removeListener('accountChanged', handleAccountChanged);
      }
    };
  }, []);


  // A different network's page means a different cluster to
  // confirm — the remembered hop was for the OLD one. Unlike
  // the EVM hook, whose chainId is live state, this gate is
  // only a memory of a click, so it must be invalidated here.
  useEffect(() => {
    setClusterStatus(null);
  }, [expectedCluster]);


  // The three actions are the Phantom conversations at the
  // top of the file — these wrappers only translate their
  // results into state
  const connect = useCallback(async () => {
    const addr = await connectPhantom();
    setAddress(addr);
    return addr;
  }, []);

  const switchNetwork = useCallback(async () => {
    setClusterStatus(await requestClusterHop(expectedCluster));
  }, [expectedCluster]);

  const signMessage = useCallback(() => signClaimMessage(address), [address]);


  const step = !installed ? 0
    : !address ? 1
    : (expectedCluster && !clusterStatus) ? 2
    : 3;


  return {
    installed,
    address,
    step,
    clusterConfirmed: clusterStatus === 'confirmed',
    connect,
    switchNetwork,
    signMessage,
  };
}

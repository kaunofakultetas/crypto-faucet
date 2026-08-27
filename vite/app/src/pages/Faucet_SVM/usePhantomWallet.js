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
//    PHANTOM_DETECT_MS  — how long a mount keeps looking
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

// Phantom injects on its own schedule (no announce event, unlike
// EIP-6963) — a mount that finds nothing keeps looking this long,
// in 250 ms ticks, before settling on "not installed"
const PHANTOM_DETECT_MS = 5000;







// -----------------------------------------------------------
// getPhantomProvider
// -----------------------------------------------------------
//
// The injected provider, or null — ONLY window.phantom.solana,
// Phantom's own reserved namespace, the same identity-based
// discipline as the MetaMask hook's EIP-6963 resolution. The
// legacy shared window.solana slot is deliberately not read:
// it is guarded only by a flag any wallet can fake (Brave and
// friends have squatted it). Re-resolved on every use rather
// than cached — the extension injects on its own schedule.
//
// Used by:
//   - connectPhantom / requestClusterHop / signClaimMessage
//     (below)
//   - usePhantomWallet (below) — the detection effect
// -----------------------------------------------------------

const getPhantomProvider = () => {
  if (typeof window === 'undefined') return null;
  return window.phantom?.solana?.isPhantom ? window.phantom.solana : null;
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
//   - connectPhantom / signClaimMessage (below)
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
// The cluster-hop conversation. VERIFIED (2026-08, Phantom's
// own phantom-connect-sdk source): Phantom has NO programmatic
// Solana cluster switch — the official SDK's injected-path
// switchNetwork is literally a no-op ("Wallet Standard does
// not support network switching"), unlike its EVM side, which
// has switchChain. The cluster is the student's Testnet Mode
// setting, full stop.
//
// changeNetwork({ genesisHash }) is the OKX-style provider
// API, kept as cheap future-proofing: a wallet that ships it
// answers → 'confirmed'; Phantom answers method-not-found →
// 'assumed', and the page keeps the Testnet Mode instructions
// visible. A refusal or a real failure throws a
// ready-to-display message.
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
// Phantom signs with whatever account it has SELECTED, and
// the student can change that inside the approval popup —
// the backend would refuse the mismatch with an opaque 403,
// so it is caught here with a message that says what to do.
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
  // back raw bytes (older builds, the array itself). An empty
  // array-like would encode to '' and fail server-side, so
  // the length is checked, not just truthiness.
  const signatureBytes = result?.signature ?? result;
  if (!signatureBytes || signatureBytes.length === 0) {
    throw new Error('Phantom negrąžino parašo.');
  }

  const signer = addressOf(result?.publicKey) ?? addressOf(provider.publicKey) ?? address;
  if (signer !== address) {
    throw new Error('Phantom pasirašė kita paskyra. Perjunkite paskyrą ir bandykite dar kartą.');
  }

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


  // Detect Phantom — the extension injects on its own
  // schedule, so a miss at mount keeps looking for a few
  // seconds instead of sticking the page on "install" for a
  // wallet that is really there; the listeners keep the
  // address in step with what the student does inside the
  // extension
  useEffect(() => {
    let alive = true;
    let detach = () => {};

    const wire = (provider) => {
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

      detach = () => {
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
    };

    const provider = getPhantomProvider();
    if (provider) {
      wire(provider);
    } else {
      const started = Date.now();
      const poll = setInterval(() => {
        const late = getPhantomProvider();
        if (late) {
          clearInterval(poll);
          if (alive) wire(late);
        } else if (Date.now() - started > PHANTOM_DETECT_MS) {
          clearInterval(poll);
        }
      }, 250);
      detach = () => clearInterval(poll);
    }

    return () => {
      alive = false;
      detach();
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

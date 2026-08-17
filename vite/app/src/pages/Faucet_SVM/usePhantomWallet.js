// -----------------------------------------------------------
//  [*] usePhantomWallet — Phantom on Solana
//
//  Everything the SVM faucet page needs from the browser
//  wallet, talking to the injected provider the same way the
//  EVM hook talks to window.ethereum:
//
//    window.phantom.solana.connect()        — connect()
//    provider.request({ changeNetwork })    — switchNetwork()
//    provider.signMessage(bytes, 'utf8')    — signMessage()
//
//  Phantom has no dependable equivalent of MetaMask's
//  wallet_switchEthereumChain: changeNetwork ships only on
//  some builds, and no API reports which cluster the extension
//  is actually showing (account.chains still starts with
//  solana:mainnet in Testnet Mode). So switchNetwork() reports
//  whether the hop was CONFIRMED, and the page keeps the
//  manual Testnet Mode instructions on screen while it wasn't
//  — the alternative is a step the student can never pass.
//
//  signMessage() owns the Lithuanian nonce wording the backend
//  verifies, so this page cannot drift from
//  svm_faucet.request_sol.
//
//  The returned `step` is the single source of truth:
//  0 install → 1 connect → 2 cluster → 3 ready.
//
//  Split into (root last):
//
//    CLUSTER_GENESIS    — cluster name → genesis hash
//    getPhantomProvider — the injected provider, Phantom only
//    addressOf          — publicKey (string or object) → base58
//    isMethodMissing    — "this build has no changeNetwork"
//    usePhantomWallet   — the hook (default export)
//
//  Used by:
//    - pages/Faucet_SVM/Page.jsx
// -----------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import bs58 from 'bs58';


// Solana cluster → genesis hash, the identifier Phantom's
// changeNetwork accepts. Each is a base58-encoded 32 BYTES
// (43-44 characters) — a truncated one is silently rejected
const CLUSTER_GENESIS = {
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};


// Prefer window.phantom.solana so we do not pick up Brave (or
// another wallet) sitting on the legacy window.solana slot
const getPhantomProvider = () => {
  if (typeof window === 'undefined') return null;
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solana?.isPhantom) return window.solana;
  return null;
};


// Phantom's publicKey is sometimes a string, sometimes a
// PublicKey-like object with toBase58/toString
const addressOf = (publicKey) => {
  if (!publicKey) return null;
  if (typeof publicKey === 'string') return publicKey;
  if (typeof publicKey.toBase58 === 'function') return publicKey.toBase58();
  if (typeof publicKey.toString === 'function') return publicKey.toString();
  return null;
};


// Builds without changeNetwork answer -32601, but the wording
// varies by version, so the message is matched too
const isMethodMissing = (e) =>
  e?.code === -32601
  || /method not found|not implemented|unsupported/i.test(String(e?.message || ''));







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


  const connect = useCallback(async () => {
    const provider = getPhantomProvider();
    if (!provider) throw new Error('Phantom dar neįkelta. Bandykite dar kartą.');

    try {
      const resp = await provider.connect();
      const addr = addressOf(resp?.publicKey) ?? addressOf(provider.publicKey);
      if (!addr) throw new Error('Phantom negrąžino Solana paskyros.');
      setAddress(addr);
      return addr;
    } catch (e) {
      if (e?.code === 4001) throw new Error('Prijungimas atmestas Phantom lange.');
      throw new Error(e.message || 'Nepavyko prijungti Phantom.');
    }
  }, []);


  // Ask Phantom to hop clusters. A build that ships
  // changeNetwork answers and the step is confirmed; one that
  // does not leaves the hop to the student's own clicks, so
  // the step passes 'assumed' and the page keeps the Testnet
  // Mode instructions visible.
  const switchNetwork = useCallback(async () => {
    const provider = getPhantomProvider();
    if (!provider) throw new Error('Phantom dar neįkelta. Bandykite dar kartą.');

    const genesisHash = CLUSTER_GENESIS[expectedCluster];
    if (!genesisHash) throw new Error('Nežinomas SVM tinklas.');

    if (typeof provider.request === 'function') {
      try {
        await provider.request({ method: 'changeNetwork', params: { genesisHash } });
        setClusterStatus('confirmed');
        return;
      } catch (e) {
        if (e?.code === 4001) throw new Error('Persijungimas atmestas Phantom lange.');
        if (!isMethodMissing(e)) throw new Error(`Nepavyko persijungti į tinklą: ${e.message}`);
      }
    }

    setClusterStatus('assumed');
  }, [expectedCluster]);


  // The proof of wallet ownership every payout needs: a fresh
  // nonce inside a fixed message, signed in Phantom. The
  // wording must match svm_faucet.request_sol byte for byte.
  const signMessage = useCallback(async () => {
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
  }, [address]);


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

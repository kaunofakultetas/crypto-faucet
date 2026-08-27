// -----------------------------------------------------------
//  [*] useSuiWallet — any Sui wallet, via the Wallet Standard
//
//  The MOVE page's wallet hook. Sui wallets don't inject a
//  window object — they announce themselves through the
//  Wallet Standard window events and hand the page a feature
//  object to talk through. The hook keeps EVERY wallet with
//  Sui signing support the browser announces (Slush, Suiet, a
//  Sui-capable Phantom — whatever the student has), talks to
//  the first one until the page offers a choice, reports its
//  real name for the UI, and restores an already-authorised
//  session without a popup.
//
//  A Sui ADDRESS is the same on every network, so there is no
//  network hop to perform — `step` jumps from 1 (connect)
//  straight to 3 (ready). The wallet UI still has a network
//  selector, though, and the claim pays on the network in
//  the URL: `chains` is what the account advertises, so the
//  page can tell the student which network to select. Same
//  contract shape as the other wallet hooks, so WalletFlow's
//  pieces work unchanged.
//
//  Split into (root last) — the conversations are plain
//  functions, the hook wires their results into state:
//
//    SLUSH_NAME / SLUSH_URL — the install suggestion
//    isSuiWallet        — the discovery filter
//    suiAccountOf       — first sui:* account of a list
//    suiChainsOf        — the sui:* chains an account claims
//    connectSuiWallet   — the connect conversation
//    signClaimMessage   — the ownership-proof conversation
//    useSuiWallet       — discovery + state wiring + step
//                         (default export)
//
//  Used by:
//    - pages/Faucet_MOVE/Page.jsx
// -----------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';


// What the install step suggests when NO Sui wallet was
// discovered — Slush is Sui's own wallet (ex "Sui Wallet")
const SLUSH_NAME = 'Slush';
const SLUSH_URL = 'https://slush.app';







// -----------------------------------------------------------
// isSuiWallet
// -----------------------------------------------------------
//
// The discovery filter: of all the Wallet Standard wallets a
// browser announces, keep those that can CONNECT and SIGN a
// Sui personal message — the two features the claim needs.
// Brand-agnostic on purpose: any Sui-capable wallet works,
// and the page shows the one it actually found.
//
// Used by:
//   - useSuiWallet (below) — the discovery effect
// -----------------------------------------------------------

const isSuiWallet = (wallet) =>
  Boolean(wallet?.features?.['standard:connect'])
  && Boolean(wallet?.features?.['sui:signPersonalMessage']);







// -----------------------------------------------------------
// suiAccountOf
// -----------------------------------------------------------
//
// The first Sui account of a Wallet Standard account list,
// or null. A multichain wallet may expose accounts for other
// chains in the same list — only sui:* ones can sign our
// claim.
//
// Used by:
//   - connectSuiWallet (below)
//   - useSuiWallet (below) — the change events
// -----------------------------------------------------------

const suiAccountOf = (accounts) =>
  (accounts || []).find((account) =>
    (account.chains || []).some((chain) => chain.startsWith('sui:'))) ?? null;

// The sui:* chains an account advertises ('sui:testnet', …) —
// a wallet honest about its selected network lists one, a
// wallet that supports them all lists every one
const suiChainsOf = (account) =>
  (account?.chains || []).filter((chain) => chain.startsWith('sui:'));







// -----------------------------------------------------------
// connectSuiWallet
// -----------------------------------------------------------
//
// The connect conversation: standard:connect, then pick the
// Sui account out of the answer. Throws a ready-to-display
// Lithuanian message.
//
// Used by:
//   - useSuiWallet (below) — connect()
// -----------------------------------------------------------

async function connectSuiWallet(wallet) {
  let accounts;
  try {
    ({ accounts } = await wallet.features['standard:connect'].connect());
  } catch (e) {
    if (e?.code === 4001 || /reject|denied/i.test(String(e?.message || ''))) {
      throw new Error(`Prijungimas atmestas ${wallet.name} lange.`);
    }
    throw new Error(e.message || `Nepavyko prijungti ${wallet.name}.`);
  }

  const account = suiAccountOf(accounts);
  if (!account) {
    throw new Error(`${wallet.name} negrąžino Sui paskyros.`);
  }
  return account;
}







// -----------------------------------------------------------
// signClaimMessage
// -----------------------------------------------------------
//
// The ownership-proof conversation: a fresh nonce inside the
// fixed message, signed via the sui:signPersonalMessage
// feature (which needs the ACCOUNT OBJECT, not the address).
// The wallet answers with the ALREADY-serialized base64
// signature (flag || sig || pubkey) — exactly what the
// backend verifies, no re-encoding here. The wording must
// match move_faucet.request_move byte for byte.
//
// Used by:
//   - useSuiWallet (below) — signMessage()
// -----------------------------------------------------------

async function signClaimMessage(wallet, account) {
  if (!wallet || !account) {
    throw new Error('Sui piniginė neprijungta.');
  }

  const nonce = Date.now().toString();
  const message = `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;

  let result;
  try {
    result = await wallet.features['sui:signPersonalMessage'].signPersonalMessage({
      account,
      message: new TextEncoder().encode(message),
    });
  } catch (e) {
    if (e?.code === 4001 || /reject|denied/i.test(String(e?.message || ''))) {
      throw new Error(`Pasirašymas atmestas ${wallet.name} lange.`);
    }
    throw new Error(e.message || 'Nepavyko pasirašyti žinutės.');
  }

  const signature = result?.signature;
  if (!signature) throw new Error(`${wallet.name} negrąžino parašo.`);

  return { nonce, signature };
}







// -----------------------------------------------------------
// useSuiWallet (default export)
// -----------------------------------------------------------
//
//   const { installed, walletName, installUrl, address,
//           chains, wallets, selectWallet, step, connect,
//           signMessage } = useSuiWallet()
//
// step is 0 install → 1 connect → 3 ready (there IS no
// step 2 — Sui wallets need no network hop). walletName is
// the DISCOVERED wallet's own name, or Slush as the install
// suggestion when none was found; wallets lists every
// Sui-capable one the browser announced and selectWallet
// picks another. chains is what the connected account
// advertises ('sui:testnet', …), for the page's network
// note. connect / signMessage reject with a ready-to-display
// Lithuanian message.
//
// Used by:
//   - Page.jsx — FaucetMOVE
// -----------------------------------------------------------

export default function useSuiWallet() {

  // The Wallet Standard wallet OBJECTS (their features are the
  // API) — every one announced, and the one in use — and the
  // connected Sui account object: sui:signPersonalMessage
  // wants the account, not its address
  const [wallets, setWallets] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [account, setAccount] = useState(null);


  // Wallet Standard discovery, both directions: catch wallets
  // that register after us (the register-wallet event), and
  // announce ourselves to wallets that registered before us
  // (the app-ready dispatch). Every Sui-capable wallet is
  // kept; the first one announced is used until the page
  // picks another. The unregister a wallet gets back really
  // forgets it — an extension disabled mid-session must not
  // stay selected as a dead object.
  useEffect(() => {

    const api = {
      register: (...announced) => {
        const found = announced.filter(isSuiWallet);
        if (found.length) {
          setWallets((previous) => [...previous, ...found.filter((w) => !previous.includes(w))]);
          setWallet((previous) => previous ?? found[0]);
        }
        return () => {
          setWallets((previous) => previous.filter((w) => !found.includes(w)));
          setWallet((previous) => (found.includes(previous) ? null : previous));
        };
      },
    };

    const handleRegister = (event) => {
      try { event.detail(api); } catch { /* a foreign wallet's bad announce is not our problem */ }
    };

    window.addEventListener('wallet-standard:register-wallet', handleRegister);
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));

    return () => window.removeEventListener('wallet-standard:register-wallet', handleRegister);
  }, []);


  // Restore an already-authorised session without a popup —
  // the wallet's own account list first, then the standard's
  // silent connect; a wallet that has not authorised this
  // origin rejects, and the student stays on the connect step.
  // The sibling hooks do the same (eth_accounts, onlyIfTrusted).
  useEffect(() => {
    if (!wallet) return undefined;
    let alive = true;

    const existing = suiAccountOf(wallet.accounts);
    if (existing) {
      setAccount(existing);
      return undefined;
    }

    wallet.features['standard:connect']
      .connect({ silent: true })
      .then(({ accounts }) => { if (alive) setAccount(suiAccountOf(accounts)); })
      .catch(() => {});

    return () => { alive = false; };
  }, [wallet]);


  // The standard change event keeps the account in step with
  // what the student does inside the extension — an empty
  // account list is the Wallet Standard's disconnect
  useEffect(() => {
    if (!wallet) return undefined;

    const events = wallet.features['standard:events'];
    if (!events) return undefined;

    return events.on('change', ({ accounts }) => {
      if (accounts) setAccount(suiAccountOf(accounts));
    });
  }, [wallet]);


  // The actions are the conversations at the top of the file
  // — these wrappers only translate their results into state
  const connect = useCallback(async () => {
    if (!wallet) throw new Error('Sui piniginė dar neįkelta. Bandykite dar kartą.');
    const acc = await connectSuiWallet(wallet);
    setAccount(acc);
    return acc.address;
  }, [wallet]);

  const signMessage = useCallback(() => signClaimMessage(wallet, account), [wallet, account]);

  // Another announced wallet: its session (if any) is restored
  // by the effect above, so the account is reset here
  const selectWallet = useCallback((candidate) => {
    setWallet(candidate);
    setAccount(null);
  }, []);


  // No step 2: a Sui address is the same on every network, so
  // a connected wallet is already ready — the network the
  // wallet SHOWS is the page's note to make, not a step
  const step = !wallet ? 0
    : !account ? 1
    : 3;


  return {
    installed: Boolean(wallet),
    walletName: wallet?.name ?? SLUSH_NAME,
    installUrl: SLUSH_URL,
    address: account?.address ?? null,
    chains: suiChainsOf(account),
    wallets,
    selectWallet,
    step,
    connect,
    signMessage,
  };
}

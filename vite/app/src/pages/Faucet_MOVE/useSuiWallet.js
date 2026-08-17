// -----------------------------------------------------------
//  [*] useSuiWallet — any Sui wallet, via the Wallet Standard
//
//  The MOVE page's wallet hook. Sui wallets don't inject a
//  window object — they announce themselves through the
//  Wallet Standard window events and hand the page a feature
//  object to talk through. The hook takes the FIRST wallet
//  with Sui signing support (Slush, Suiet, a Sui-capable
//  Phantom — whatever the student has) and reports its real
//  name for the UI.
//
//  Sui wallets are chain-scoped, so there is NO network step
//  at all — `step` jumps from 1 (connect) straight to
//  3 (ready). Same contract shape as the other wallet hooks,
//  so WalletFlow's pieces work unchanged.
//
//  Split into (root last) — the conversations are plain
//  functions, the hook wires their results into state:
//
//    SLUSH_NAME / SLUSH_URL — the install suggestion
//    isSuiWallet        — the discovery filter
//    suiAccountOf       — first sui:* account of a list
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
//           step, connect, signMessage } = useSuiWallet()
//
// step is 0 install → 1 connect → 3 ready (there IS no
// step 2 — Sui wallets need no network hop). walletName is
// the DISCOVERED wallet's own name, or Slush as the install
// suggestion when none was found. connect / signMessage
// reject with a ready-to-display Lithuanian message.
//
// Used by:
//   - Page.jsx — FaucetMOVE
// -----------------------------------------------------------

export default function useSuiWallet() {

  // The Wallet Standard wallet OBJECT (its features are the
  // API), and the connected Sui account object —
  // sui:signPersonalMessage wants the account, not its address
  const [wallet, setWallet] = useState(null);
  const [account, setAccount] = useState(null);


  // Wallet Standard discovery, both directions: catch wallets
  // that register after us (the register-wallet event), and
  // announce ourselves to wallets that registered before us
  // (the app-ready dispatch). First Sui-capable wallet wins.
  useEffect(() => {

    const api = {
      register: (...wallets) => {
        const found = wallets.find(isSuiWallet);
        if (found) setWallet((previous) => previous ?? found);
        return () => {};
      },
    };

    const handleRegister = (event) => {
      try { event.detail(api); } catch { /* a foreign wallet's bad announce is not our problem */ }
    };

    window.addEventListener('wallet-standard:register-wallet', handleRegister);
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));

    return () => window.removeEventListener('wallet-standard:register-wallet', handleRegister);
  }, []);


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


  // No step 2: Sui wallets are chain-scoped, so a connected
  // wallet is already ready
  const step = !wallet ? 0
    : !account ? 1
    : 3;


  return {
    installed: Boolean(wallet),
    walletName: wallet?.name ?? SLUSH_NAME,
    installUrl: SLUSH_URL,
    address: account?.address ?? null,
    step,
    connect,
    signMessage,
  };
}

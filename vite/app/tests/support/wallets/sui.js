// -----------------------------------------------------------
//  [*] Test support — the Sui wallet double (Wallet Standard)
//
//  Stands in for a Sui wallet extension (Slush, Suiet, a
//  Sui-capable Phantom …) the MOVE faucet discovers
//  (Faucet_MOVE/useSuiWallet.js). Sui wallets inject no window
//  global: they announce themselves through the Wallet
//  Standard's two window events, and install does exactly
//  what the standard's registerWallet does —
//
//    - dispatches 'wallet-standard:register-wallet' with a
//      callback, for an app already listening (the wallet
//      loaded AFTER the page)
//    - listens for 'wallet-standard:app-ready', for an app
//      that mounts later (the wallet loaded BEFORE the page);
//      the listener is removed when the test finishes
//
//  — so in a test, the order of installing the wallet and
//  rendering the page is the order the browser loaded them
//  in. The wallet object carries the features the hook talks
//  through:
//
//    standard:connect         the popup — approve, reject or
//                             an error — and its silent form
//                             with no popup: the standard's
//                             empty answer for an origin not
//                             yet authorised, or a reject, or
//                             an approval
//    standard:events          listens for 'change' and hands
//                             back the function that stops
//                             listening; change plays the
//                             student switching or
//                             disconnecting the account inside
//                             the extension
//    sui:signPersonalMessage  signs an account's message and
//                             answers the message in base64
//                             with the signature, already
//                             serialized base64 (the flag, the
//                             signature and the public key)
//
//  Every call is recorded in `calls`, with its method and its
//  arguments. Nothing here imports the code under test.
//
//  Used by:
//    - hooks/use-sui-wallet.test.jsx
//    - pages/faucet-move.test.jsx
// -----------------------------------------------------------

import { onTestFinished } from 'vitest';


// Students' Sui addresses — 0x + 64 hex, the same on every
// Sui network
export const STUDENT_SUI = '0x7d20dcdb2bca4f508ea9613994683eb4e76e9c4ed371169677c1be02aaf0b58e';
export const OTHER_SUI = '0xf1e2d3c4b5a6978899aabbccddeeff00112233445566778899aabbccddeeff01';

// A serialized Sui signature: flag (0x00, Ed25519) || 64
// signature bytes || 32 public-key bytes, base64 — chosen so
// the text carries '+', '/' and '=' padding, the characters a
// careless query string would mangle
const SIGNATURE_BYTES = Uint8Array.from([
  0x00, 0xfb, 0xef, 0xbe, 0xff, 0xff,
  ...Array.from({ length: 59 }, (_, i) => (i * 29 + 11) % 256),
  ...new Array(32).fill(7),
]);

export const SUI_SIGNATURE = btoa(String.fromCharCode(...SIGNATURE_BYTES));

// Every Sui network a wallet can speak
export const ALL_SUI_CHAINS = ['sui:mainnet', 'sui:testnet', 'sui:devnet', 'sui:localnet'];







// -----------------------------------------------------------
// suiAccount / walletError / rejected
// -----------------------------------------------------------
//
// A Wallet Standard account (address, publicKey, the chains
// it advertises — a wallet honest about its selected network
// lists one), and the errors wallets throw: most say
// "rejected" in words, some carry the EIP-1193-style 4001.
//
// Used by:
//   - createSuiWallet (below), the tests' account lists
// -----------------------------------------------------------

export const suiAccount = (address = STUDENT_SUI, chains = ['sui:testnet']) => ({
  address,
  publicKey: new Uint8Array(32).fill(7),
  chains,
  features: ['sui:signPersonalMessage', 'sui:signTransaction'],
  label: 'Account 1',
});

export const walletError = (message, code) => Object.assign(new Error(message), code === undefined ? {} : { code });

export const rejected = () => walletError('User rejected the request');







// -----------------------------------------------------------
// createSuiWallet
// -----------------------------------------------------------
//
// Builds the double without announcing it, for the tests
// that announce late or several wallets at once: install
// announces it (registerWallet's two paths), unregister makes
// the extension go away (every unregister the apps handed
// back is called), change fires the 'change' event with the
// account list updated, and emitChange fires a raw 'change'
// event with whatever properties the test gives.
//
// Every option may be left out. name is the wallet's own
// name, Slush unless given. accounts is what the wallet
// already lists — an origin authorised in an earlier visit;
// none by default — and accountsOnConnect what the connect
// popup answers, one suiAccount unless given. silent is how a
// silent connect answers: 'empty' (the default) hands back
// the accounts already listed, none for an origin not yet
// authorised, as the standard does; or 'reject', 'approve',
// or a function of the connect's input. connect is the
// popup's answer: 'approve' (the default), 'reject', an
// Error, or a function of the input. sign answers the
// signature the same way, with 'no-signature' besides — an
// answer that carries none. signature is what an approved
// signature answers, SUI_SIGNATURE unless given. events and
// sui offer standard:events and sui:signPersonalMessage, both
// on by default; a wallet without sui:signPersonalMessage is
// one for another chain.
//
// Beside the wallet object and the call record, the double
// reads back the arguments of every call to one method
// (callsTo), the number of 'change' listeners (listening) and
// what the page asked the wallet to sign, as text
// (signedTexts).
//
// Used by:
//   - installSuiWallet (below), tests that announce late or
//     several wallets at once
// -----------------------------------------------------------

export function createSuiWallet(options = {}) {

  const {
    name = 'Slush',
    accounts = [],
    accountsOnConnect = [suiAccount()],
    silent = 'empty',
    connect = 'approve',
    sign = 'approve',
    signature = SUI_SIGNATURE,
    events = true,
    sui = true,
  } = options;

  const state = { accounts: [...accounts] };
  const calls = [];
  const listeners = new Set();
  const unregisters = [];

  const record = (method, args) => { calls.push({ method, args }); };

  const grant = (granted) => {
    state.accounts = [...granted];
    return { accounts: [...granted] };
  };

  const answerConnect = (input) => {
    if (input?.silent) {
      if (typeof silent === 'function') return silent(input);
      if (silent === 'reject') throw walletError('Not authorized');
      if (silent === 'approve') return grant(accountsOnConnect);
      return { accounts: [...state.accounts] };
    }
    if (typeof connect === 'function') return connect(input);
    if (connect instanceof Error) throw connect;
    if (connect === 'reject') throw rejected();
    return grant(accountsOnConnect);
  };

  const answerSign = (input) => {
    if (typeof sign === 'function') return sign(input);
    if (sign instanceof Error) throw sign;
    if (sign === 'reject') throw rejected();
    if (sign === 'no-signature') return { bytes: btoa(String.fromCharCode(...input.message)) };
    return { bytes: btoa(String.fromCharCode(...input.message)), signature };
  };


  const features = {
    'standard:connect': {
      version: '1.0.0',
      connect: async (input) => {
        record('connect', [input]);
        return answerConnect(input);
      },
    },
  };

  if (events) {
    features['standard:events'] = {
      version: '1.0.0',
      on: (event, listener) => {
        record('on', [event]);
        if (event === 'change') listeners.add(listener);
        return () => {
          record('off', [event]);
          listeners.delete(listener);
        };
      },
    };
  }

  if (sui) {
    features['sui:signPersonalMessage'] = {
      version: '1.1.0',
      signPersonalMessage: async (input) => {
        record('signPersonalMessage', [input]);
        return answerSign(input);
      },
    };
  }


  const wallet = {
    version: '1.0.0',
    name,
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    chains: sui ? [...ALL_SUI_CHAINS] : ['solana:devnet'],
    get accounts() { return [...state.accounts]; },
    features,
  };


  const double = {
    wallet,
    calls,

    callsTo: (method) => calls.filter((call) => call.method === method).map((call) => call.args),
    listening: () => listeners.size,

    // The account list changed inside the extension — an empty
    // list is the standard's disconnect
    change(nextAccounts) {
      state.accounts = [...nextAccounts];
      double.emitChange({ accounts: [...nextAccounts] });
    },

    // A raw 'change' event, as a wallet may send it (only the
    // properties that changed — say, its chains alone)
    emitChange(properties) {
      for (const listener of [...listeners]) listener(properties);
    },

    // What the page asked the wallet to sign, as text
    signedTexts: () => double.callsTo('signPersonalMessage').map(([input]) => new TextDecoder().decode(input.message)),

    install() {
      const callback = (api) => { unregisters.push(api.register(wallet)); };
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: callback }));
      const onAppReady = (event) => callback(event.detail);
      window.addEventListener('wallet-standard:app-ready', onAppReady);
      onTestFinished(() => window.removeEventListener('wallet-standard:app-ready', onAppReady));
      return double;
    },

    unregister() {
      for (const off of unregisters.splice(0)) off();
    },
  };

  return double;
}







// -----------------------------------------------------------
// installSuiWallet
// -----------------------------------------------------------
//
// One wallet, created and announced at once.
//
// Used by:
//   - hooks/use-sui-wallet.test.jsx
//   - pages/faucet-move.test.jsx
// -----------------------------------------------------------

export const installSuiWallet = (options) => createSuiWallet(options).install();

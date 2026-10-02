// -----------------------------------------------------------
//  [*] Test support — the MetaMask double (EIP-1193 + EIP-6963)
//
//  The EVM-family pages never meet a real wallet in this suite.
//  installMetamask puts an EIP-1193 provider — its request
//  method, on and removeListener — where the app looks for
//  MetaMask, and answers like the extension wherever a page
//  depends on it:
//
//    - FOUND like MetaMask: announced through EIP-6963 under
//      rdns io.metamask on install, and again on every
//      eip6963:requestProvider; it also sits on window.ethereum
//      (vi.stubGlobal) like the real extension — which the app
//      must never trust on its own (Phantom squats there too,
//      installPhantomEvm)
//    - accounts: eth_accounts answers an empty list until the
//      site is connected; eth_requestAccounts is the popup —
//      approved by default (accountsChanged fires), declined
//      (4001), or left open (hold / hang — a second request
//      meanwhile is MetaMask's -32002 "already pending")
//    - chains: eth_chainId in hex; wallet_switchEthereumChain
//      to a chain the wallet does not know is 4902 (optionally
//      wrapped the way newer builds do);
//      wallet_addEthereumChain makes it known WITHOUT switching,
//      like current builds
//    - personal_sign decodes the hex message (UTF-8) into
//      `signed` and answers SIGNATURE; eth_getBalance answers
//      the current chain's balance in hex wei;
//      wallet_watchAsset records the token in `watched`
//    - any other method is -32601, so a page calling something
//      new shows up in the call record instead of passing
//
//  Every call lands in wallet.calls. Any method can be made to
//  fail, to be declined, to hang, to wait for the test (hold,
//  then release or decline) or to answer something else; what
//  the student does inside the extension is changeAccounts /
//  changeChain / emit. Nothing here knows React — tests wrap
//  the moves that update state in act.
//
//  The app caches the first MetaMask it hears for the life of
//  its module, so the test files re-import the code under test
//  (vi.resetModules) before every test, and a double stops
//  answering discovery requests once its test has finished;
//  the stubbed window.ethereum is undone by setup.js.
//
//  Used by:
//    - hooks/use-metamask-wallet.test.jsx
//    - pages/faucet-evm.test.jsx, pages/faucet-erc20.test.jsx
// -----------------------------------------------------------

import { onTestFinished, vi } from 'vitest';
import { STUDENT_EVM, evmNetworksMap } from '../backend/fixtures';


// Chain ids the tests move between — the fixtures' networks
// plus Ethereum mainnet, which every wallet knows
export const MAINNET = 1;
export const SEPOLIA = evmNetworksMap.sepolia.chain_id;
export const HOODI = evmNetworksMap.hoodi.chain_id;
export const ARBITRUM_SEPOLIA = evmNetworksMap.arbitrumSepolia.chain_id;

// A second account in the same wallet (the student switches)
export const OTHER_ACCOUNT = '0x5c7f2a6b4e8d9c0f1a2b3c4d5e6f708192a3b4c5';

// One ether in wei, and the signature personal_sign answers
export const ETH = 10n ** 18n;
export const SIGNATURE = `0x${'5a'.repeat(65)}`;

// What MetaMask says when the student presses "Cancel"
export const USER_REJECTED = 'User rejected the request.';

export const hexChain = (id) => `0x${Number(id).toString(16)}`;

// The methods whose popup MetaMask refuses to open twice
const PROMPT_TYPES = { eth_requestAccounts: 'wallet_requestPermissions' };

const WALLET_ICON = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';

let walletSerial = 0;







// -----------------------------------------------------------
// rpcError / userRejected
// -----------------------------------------------------------
//
// MetaMask's errors: an Error carrying the EIP-1193 `code`
// (and `data` when there is any) — the pages display
// e.message, the hook reads e.code.
//
// Used by:
//   - installEvmWallet (below), tests that script a failure
// -----------------------------------------------------------

export function rpcError(code, message, data) {
  const error = new Error(message);
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}

export const userRejected = () => rpcError(4001, USER_REJECTED);







// -----------------------------------------------------------
// decodeMessage
// -----------------------------------------------------------
//
// personal_sign's first param back to text: 0x-hex is decoded
// as UTF-8 (strictly — bytes that are not UTF-8 make the
// wallet refuse, so a page that encoded wrong fails loudly);
// anything else is taken as the text itself, like MetaMask.
//
// Used by:
//   - installEvmWallet (below) — personal_sign
// -----------------------------------------------------------

function decodeMessage(data) {
  const text = String(data);
  if (!/^0x([0-9a-f]{2})*$/i.test(text)) return text;
  const bytes = Uint8Array.from(text.slice(2).match(/../g) ?? [], (pair) => parseInt(pair, 16));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}







// -----------------------------------------------------------
// installEvmWallet
// -----------------------------------------------------------
//
// Any EIP-1193 wallet — installMetamask / installPhantomEvm
// below fill in who it claims to be: its rdns, its name and
// the flags on its provider. Every other option has a default
// a test may change.
//
// The wallet holds the student's address (STUDENT_EVM) and
// the site is not yet permitted. It sits on Sepolia and knows
// Ethereum mainnet and Sepolia — always with the chain it
// sits on among them — and has 1.5 ETH, in wei, on every
// chain. It announces itself through EIP-6963 at once and on
// every request ('on-request': only when asked; false: not
// until the test calls announce), and it also sits on
// window.ethereum unless onWindow is turned off.
//
// A switch fires chainChanged and a granted connect fires
// accountsChanged unless emitsChainChanged /
// emitsAccountsChanged are turned off; wraps4902 puts the
// unknown chain's 4902 inside a -32603 error's data, the way
// newer builds do; switchesOnAdd makes adding a chain switch
// to it as well.
//
// The handle it returns keeps the record: the provider and
// its EIP-6963 info, every call, the signed messages, the
// watched tokens, the added chains, and the wallet's chain,
// the accounts the site can see and the connection as they
// stand — with readers for the methods called, the calls to
// one method and the listeners of one event. It plays what
// the student does inside the extension: emit an event,
// announce, change the accounts, change the chain (silently
// if asked), set a chain's balance.
//
// And it scripts deviations per method: fail with an error
// (an internal JSON-RPC error unless the test brings its
// own), decline, hang, answer through a function of the
// params, or hold the call until the test releases it — with
// the real answer or one of its own — or declines it. A hang
// stays until restore brings the real answers back, and so do
// fail, decline and answer unless limited to the next call
// (once); a hold catches only the next call and tells whether
// it came and with what params.
//
// Used by:
//   - installMetamask / installPhantomEvm (below)
// -----------------------------------------------------------

export function installEvmWallet({
  rdns,
  name,
  flags = {},
  accounts = [STUDENT_EVM],
  connected = false,
  chainId = SEPOLIA,
  chains = [MAINNET, SEPOLIA],
  balance = (3n * ETH) / 2n,
  announce = true,
  onWindow = true,
  emitsChainChanged = true,
  emitsAccountsChanged = true,
  wraps4902 = false,
  switchesOnAdd = false,
} = {}) {

  const state = {
    accounts: accounts.map((a) => a.toLowerCase()),
    connected,
    chainId,
    known: new Set([...chains, chainId]),
    balances: new Map(),
    defaultBalance: BigInt(balance),
  };

  const calls = [];
  const signed = [];
  const watched = [];
  const added = [];
  const listeners = new Map();
  const overrides = new Map();
  const pendingPrompts = new Set();


  // The extension's side: events, chain moves, the answers
  const emit = (event, payload) => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
  };

  const visibleAccounts = () => (state.connected ? [...state.accounts] : []);

  const moveTo = (id, { silently }) => {
    if (id === state.chainId) return;
    state.chainId = id;
    if (!silently) emit('chainChanged', hexChain(id));
  };

  const unknownChain = (hex) => {
    const message = `Unrecognized chain ID "${hex}". Try adding the chain using wallet_addEthereumChain first.`;
    return wraps4902
      ? rpcError(-32603, 'Internal JSON-RPC error.', { originalError: { code: 4902, message } })
      : rpcError(4902, message);
  };

  const answers = {
    eth_accounts: () => visibleAccounts(),

    eth_requestAccounts: () => {
      if (!state.connected && state.accounts.length) {
        state.connected = true;
        if (emitsAccountsChanged) emit('accountsChanged', visibleAccounts());
      }
      return visibleAccounts();
    },

    eth_chainId: () => hexChain(state.chainId),

    eth_getBalance: () => `0x${(state.balances.get(state.chainId) ?? state.defaultBalance).toString(16)}`,

    personal_sign: ([data, address] = []) => {
      if (!state.connected || !state.accounts.includes(String(address).toLowerCase())) {
        throw rpcError(4100, 'The requested account and/or method has not been authorized by the user.');
      }
      signed.push({ message: decodeMessage(data), raw: data, address });
      return SIGNATURE;
    },

    wallet_switchEthereumChain: ([{ chainId: hex }] = [{}]) => {
      const id = parseInt(hex, 16);
      if (!state.known.has(id)) throw unknownChain(hex);
      moveTo(id, { silently: !emitsChainChanged });
      return null;
    },

    wallet_addEthereumChain: ([chain] = []) => {
      added.push(chain);
      const id = parseInt(chain.chainId, 16);
      state.known.add(id);
      if (switchesOnAdd) moveTo(id, { silently: !emitsChainChanged });
      return null;
    },

    wallet_watchAsset: (params) => {
      watched.push(params);
      return true;
    },
  };

  const answer = (method, params) => {
    if (!answers[method]) throw rpcError(-32601, `The method "${method}" does not exist / is not available.`);
    return answers[method](params);
  };


  // A scripted deviation for one method: fail, hang, hold,
  // answer — `once` ones are used up by the next call
  const push = (method, override) => {
    overrides.set(method, [...(overrides.get(method) ?? []), override]);
  };

  const run = (override, method, params) => {
    if (override.kind === 'fail') throw override.error;
    if (override.kind === 'answer') return override.fn(params);
    if (PROMPT_TYPES[method]) pendingPrompts.add(method);
    if (override.kind === 'hang') return new Promise(() => {});
    return override.begin(params);
  };

  async function request({ method, params } = {}) {
    calls.push({ method, params });
    if (PROMPT_TYPES[method] && pendingPrompts.has(method)) {
      throw rpcError(-32002, `Request of type '${PROMPT_TYPES[method]}' already pending for origin ${window.location.origin}. Please wait.`);
    }
    const queue = overrides.get(method);
    const override = queue?.[0];
    if (override?.once) queue.shift();
    if (override) return run(override, method, params);
    return answer(method, params);
  }


  const provider = {
    ...flags,
    request,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return provider;
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
      return provider;
    },
  };
  provider.addListener = provider.on;
  provider.off = provider.removeListener;


  // EIP-6963: announce now and on every request — until the
  // test is over, so the next test starts with no wallet
  const info = Object.freeze({
    uuid: `00000000-0000-4000-8000-${String((walletSerial += 1)).padStart(12, '0')}`,
    name,
    icon: WALLET_ICON,
    rdns,
  });
  const announceProvider = () => {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  };
  let listening = false;
  const listen = () => {
    if (listening) return;
    window.addEventListener('eip6963:requestProvider', announceProvider);
    listening = true;
  };
  const announceWallet = () => {
    listen();
    announceProvider();
  };
  onTestFinished(() => window.removeEventListener('eip6963:requestProvider', announceProvider));


  const wallet = {
    provider,
    info,
    calls,
    signed,
    watched,
    added,

    get chainId() { return state.chainId; },
    get accounts() { return visibleAccounts(); },
    get connected() { return state.connected; },

    methods: () => calls.map((call) => call.method),
    callsTo: (method) => calls.filter((call) => call.method === method),
    listenerCount: (event) => listeners.get(event)?.size ?? 0,

    emit,
    announce: announceWallet,

    // The student's own moves inside the extension
    changeAccounts(next) {
      state.accounts = next.map((a) => a.toLowerCase());
      state.connected = next.length > 0;
      emit('accountsChanged', visibleAccounts());
    },
    changeChain(id, { silently = false } = {}) {
      state.known.add(id);
      moveTo(id, { silently });
    },
    setBalance(wei, id = state.chainId) {
      state.balances.set(id, BigInt(wei));
    },

    // Scripted deviations
    fail(method, error = rpcError(-32603, 'Internal JSON-RPC error.'), { once = false } = {}) {
      push(method, { kind: 'fail', error, once });
      return wallet;
    },
    decline(method, { once = false } = {}) {
      return wallet.fail(method, userRejected(), { once });
    },
    hang(method) {
      push(method, { kind: 'hang', once: false });
      return wallet;
    },
    hold(method) {
      let settle = null;
      const held = {
        called: false,
        params: undefined,
        release(value) {
          if (!settle) throw new Error(`${method} was never called — nothing to release`);
          settle('release', value);
        },
        decline(error = userRejected()) {
          if (!settle) throw new Error(`${method} was never called — nothing to decline`);
          settle('decline', error);
        },
      };
      push(method, {
        kind: 'hold',
        once: true,
        begin: (params) => new Promise((resolve, reject) => {
          held.called = true;
          held.params = params;
          settle = (how, value) => {
            pendingPrompts.delete(method);
            if (how === 'decline') {
              reject(value);
              return;
            }
            try {
              resolve(value === undefined ? answer(method, params) : value);
            } catch (error) {
              reject(error);
            }
          };
        }),
      });
      return held;
    },
    answer(method, fn, { once = false } = {}) {
      push(method, { kind: 'answer', fn, once });
      return wallet;
    },
    restore(method) {
      overrides.delete(method);
      pendingPrompts.delete(method);
      return wallet;
    },
  };


  if (onWindow) vi.stubGlobal('ethereum', provider);
  if (announce === 'on-request') listen();
  else if (announce) announceWallet();

  return wallet;
}







// -----------------------------------------------------------
// installMetamask / installPhantomEvm
// -----------------------------------------------------------
//
// installMetamask is the stable MetaMask build (rdns
// io.metamask); the other builds are the same double with
// their own rdns passed as an option — io.metamask.flask,
// io.metamask.mmi.
//
// installPhantomEvm is Phantom's EVM provider: it announces as
// app.phantom but, on window.ethereum, claims to be MetaMask
// through its isMetaMask flag — the squatter the app must not
// mistake for MetaMask.
//
// Used by:
//   - the EVM-family hook and page tests
// -----------------------------------------------------------

export const installMetamask = (options = {}) => installEvmWallet({
  rdns: 'io.metamask',
  name: 'MetaMask',
  flags: { isMetaMask: true },
  ...options,
});

export const installPhantomEvm = (options = {}) => installEvmWallet({
  rdns: 'app.phantom',
  name: 'Phantom',
  flags: { isMetaMask: true, isPhantom: true },
  ...options,
});

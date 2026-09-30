// -----------------------------------------------------------
//  [*] Test support — the Phantom wallet double
//
//  Stands in for the Phantom extension the SVM faucet talks to
//  (Faucet_SVM/usePhantomWallet.js): a provider object at
//  window.phantom.solana, installed with vi.stubGlobal so
//  setup.js' vi.unstubAllGlobals removes it after every test.
//  It behaves the way the extension does where the hook
//  depends on it:
//
//    - isPhantom, isConnected and publicKey (a PublicKey-like
//      object with toBase58, or a plain string on builds that
//      hand one out)
//    - connect() answers the popup — approve / reject (4001) /
//      no account / an error — and connect({ onlyIfTrusted })
//      answers silently: approved only for a trusted origin
//    - a successful connect EMITS 'connect', like Phantom (the
//      hook's eager reconnect reads the event, not the promise)
//    - on / off (or removeListener) for 'connect',
//      'disconnect' and 'accountChanged'; emit() and
//      changeAccount() play what the student does inside the
//      extension
//    - request({ method: 'changeNetwork' }) answers like
//      Phantom (-32601, it has no Solana cluster switch) unless
//      told otherwise — or is absent altogether
//    - signMessage(bytes, display) signs with the SELECTED
//      account: { signature, publicKey }, the bare bytes (older
//      builds), an empty signature, another account, a refusal
//
//  Every call is recorded in `calls` ({ method, args }).
//  Nothing here imports the code under test.
//
//  Used by:
//    - hooks/use-phantom-wallet.test.jsx
//    - pages/faucet-svm.test.jsx
// -----------------------------------------------------------

import { vi } from 'vitest';
import bs58 from 'bs58';


// Students' Solana accounts — base58 Ed25519 public keys
// (32 bytes each; base58 is case-SENSITIVE)
export const STUDENT_SOL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
export const OTHER_SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

// What every approved signMessage answers with — 64 bytes,
// an Ed25519 signature's length
export const SOL_SIGNATURE = Uint8Array.from({ length: 64 }, (_, i) => (i * 13 + 7) % 256);







// -----------------------------------------------------------
// phantomError / rejected / methodMissing
// -----------------------------------------------------------
//
// The errors Phantom throws: an Error carrying a numeric
// `code` — 4001 when the student closes or refuses a popup,
// -32601 when the build has no such method (worded so the
// hook's message fallback does NOT match: the code alone must
// do it).
//
// Used by:
//   - createPhantom (below), the tests' custom answers
// -----------------------------------------------------------

export const phantomError = (code, message) => Object.assign(new Error(message), { code });

export const rejected = () => phantomError(4001, 'User rejected the request.');

export const methodMissing = () => phantomError(-32601, 'The method "changeNetwork" does not exist / is not available.');







// -----------------------------------------------------------
// publicKeyOf
// -----------------------------------------------------------
//
// An address as Phantom hands it out: 'object' — the
// PublicKey-like object (toBase58 / toString / toBytes),
// 'string' — the bare base58 string, 'toString' — an object
// with nothing but toString.
//
// Used by:
//   - createPhantom (below), tests that emit their own keys
// -----------------------------------------------------------

export function publicKeyOf(address, as = 'object') {
  if (address == null) return null;
  if (as === 'string') return address;
  if (as === 'toString') return { toString: () => address };
  return { toBase58: () => address, toString: () => address, toBytes: () => bs58.decode(address) };
}







// -----------------------------------------------------------
// createPhantom
// -----------------------------------------------------------
//
//   const phantom = createPhantom({ ...options })
//   phantom.install()         — window.phantom.solana = provider
//   phantom.installLegacy()   — ONLY window.solana (the shared
//                               slot the hook must not read)
//   phantom.uninstall()       — the extension is gone
//
// Options (all optional):
//
//   account    — the selected account (STUDENT_SOL)
//   keyAs      — 'object' | 'string' | 'toString' (see
//                publicKeyOf) for every key it hands out
//   connected  — a live session already: isConnected and
//                publicKey set before the page mounts
//   trusted    — connect({ onlyIfTrusted: true }) succeeds
//                (this origin is a Trusted App)
//   connect    — the popup's answer: 'approve' | 'reject' |
//                'no-account' | an Error | (args) => value
//   changeNetwork — 'missing' (-32601, Phantom today) |
//                'confirm' | 'reject' | an Error |
//                'absent' (no request method at all) |
//                (params) => value
//   sign       — 'approve' | 'raw' (the bare bytes) |
//                'empty' | 'no-key' (no publicKey in the
//                answer) | 'reject' | { signer: address } |
//                an Error | (bytes, display) => value
//   signature  — the bytes an approved signature carries
//   listenerApi — 'off' | 'removeListener' | 'none' — how the
//                build lets listeners go
//   isPhantom  — the brand flag (false: a squatter)
//
// The returned double: provider, calls, callsTo(method),
// listening(event), emit(event, payload), changeAccount(
// address | null), signedTexts(), install / installLegacy /
// uninstall.
//
// Used by:
//   - installPhantom (below), tests that inject late
// -----------------------------------------------------------

export function createPhantom(options = {}) {

  const {
    account = STUDENT_SOL,
    keyAs = 'object',
    connected = false,
    trusted = false,
    connect = 'approve',
    changeNetwork = 'missing',
    sign = 'approve',
    signature = SOL_SIGNATURE,
    listenerApi = 'off',
    isPhantom = true,
  } = options;

  const state = { account, connected };
  const calls = [];
  const handlers = {};

  const record = (method, args) => { calls.push({ method, args }); };
  const key = (address) => publicKeyOf(address, keyAs);

  const emit = (event, payload) => {
    for (const handler of [...(handlers[event] ?? [])]) handler(payload);
  };

  const forget = (method) => (event, handler) => {
    record(method, [event, handler]);
    handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
    return provider;
  };


  // The popup (or the silent trusted check) approved: the
  // session is live and the extension says so
  const approve = () => {
    state.connected = true;
    emit('connect', key(state.account));
    return { publicKey: key(state.account) };
  };

  const answerConnect = (answer, args) => {
    if (typeof answer === 'function') return answer(...args);
    if (answer instanceof Error) throw answer;
    if (answer === 'reject') throw rejected();
    if (answer === 'no-account') return {};
    return approve();
  };

  const answerSign = (bytes, display) => {
    if (typeof sign === 'function') return sign(bytes, display);
    if (sign instanceof Error) throw sign;
    if (sign === 'reject') throw rejected();
    if (sign === 'raw') return signature;
    if (sign === 'empty') return { signature: new Uint8Array(0), publicKey: key(state.account) };
    if (sign === 'no-key') return { signature };
    if (sign?.signer) return { signature, publicKey: key(sign.signer) };
    return { signature, publicKey: key(state.account) };
  };

  const answerChangeNetwork = (params) => {
    if (typeof changeNetwork === 'function') return changeNetwork(params);
    if (changeNetwork instanceof Error) throw changeNetwork;
    if (changeNetwork === 'reject') throw rejected();
    if (changeNetwork === 'confirm') return null;
    throw methodMissing();
  };


  const provider = {
    isPhantom,

    get isConnected() { return state.connected; },
    get publicKey() { return state.connected ? key(state.account) : null; },

    on(event, handler) {
      record('on', [event, handler]);
      (handlers[event] ??= []).push(handler);
      return provider;
    },

    // async: the answer is a promise even when it throws —
    // the hook chains .catch() on the eager reconnect
    async connect(...args) {
      record('connect', args);
      const silent = args[0]?.onlyIfTrusted === true;
      return answerConnect(silent ? (trusted ? 'approve' : 'reject') : connect, args);
    },

    async disconnect() {
      record('disconnect', []);
      state.connected = false;
      emit('disconnect');
    },

    async signMessage(bytes, display) {
      record('signMessage', [bytes, display]);
      return answerSign(bytes, display);
    },
  };

  if (changeNetwork !== 'absent') {
    provider.request = async (request) => {
      record('request', [request]);
      if (request?.method !== 'changeNetwork') throw methodMissing();
      return answerChangeNetwork(request.params);
    };
  }

  if (listenerApi === 'off') provider.off = forget('off');
  if (listenerApi === 'removeListener') provider.removeListener = forget('removeListener');


  const double = {
    provider,
    calls,

    callsTo: (method) => calls.filter((call) => call.method === method).map((call) => call.args),
    listening: (event) => (handlers[event] ?? []).length,
    emit,

    // The student picks another account inside the extension —
    // null is Phantom's "the new one is not trusted here yet"
    changeAccount(address) {
      if (address) state.account = address;
      emit('accountChanged', address ? key(address) : null);
    },

    // What the page asked Phantom to sign, as text
    signedTexts: () => double.callsTo('signMessage').map(([bytes]) => new TextDecoder().decode(bytes)),

    install() {
      vi.stubGlobal('phantom', { solana: provider });
      return double;
    },

    installLegacy() {
      vi.stubGlobal('solana', provider);
      return double;
    },

    uninstall() {
      vi.stubGlobal('phantom', undefined);
      return double;
    },
  };

  return double;
}







// -----------------------------------------------------------
// installPhantom
// -----------------------------------------------------------
//
// createPhantom(options).install() — the extension present
// before the page mounts, the common case.
//
// Used by:
//   - hooks/use-phantom-wallet.test.jsx
//   - pages/faucet-svm.test.jsx
// -----------------------------------------------------------

export const installPhantom = (options) => createPhantom(options).install();

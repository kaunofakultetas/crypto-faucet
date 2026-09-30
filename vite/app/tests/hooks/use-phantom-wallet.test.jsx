// -----------------------------------------------------------
//  [*] Tests — usePhantomWallet (Phantom on Solana)
//
//  The SVM faucet's wallet hook on its own, against the
//  Phantom double (support/wallets/phantom.js): which injected
//  provider it trusts (window.phantom.solana with isPhantom —
//  never the shared window.solana slot) and how long it keeps
//  looking for a late injection, the session it restores at
//  mount (a live one, the silent trusted reconnect, a refusal
//  swallowed), the extension's events (connect, disconnect,
//  accountChanged — with a key and with null) and their
//  removal on unmount, and the three conversations:
//  connect() with every refusal message, switchNetwork() —
//  the genesis hash per cluster, Phantom's missing method
//  passing as "assumed", a confirming wallet, refusals,
//  unknown clusters, the reset on a new cluster — and
//  signMessage() — the exact message the backend verifies,
//  the nonce, the base58 signature, the bare-bytes answer of
//  older builds, an empty signature, another account signing,
//  refusals. The derived `step` is checked at every turn: it
//  is what the page renders from.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import bs58 from 'bs58';
import {
  STUDENT_SOL, OTHER_SOL, SOL_SIGNATURE,
  createPhantom, installPhantom, publicKeyOf, phantomError,
} from '../support/wallets/phantom';
import usePhantomWallet from '@/pages/Faucet_SVM/usePhantomWallet';


// The genesis hashes of the three Solana clusters — chain
// facts, written here independently of the hook
const GENESIS = {
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

// The ownership message, word for word as the backend
// (svm_faucet.request_sol) rebuilds it before verifying
const claimMessage = (nonce) => `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// mount: the hook for a faucet network's cluster ('devnet' by
// default, null for a network without one), re-rendered with
// { expected } to change it. refusalOf: the message an action
// rejected with (null when it resolved), run inside act so the
// state it sets on the way is flushed.
// -----------------------------------------------------------

const mount = (expected = 'devnet') => renderHook(({ cluster }) => usePhantomWallet(cluster), { initialProps: { cluster: expected } });

async function refusalOf(action) {
  let message = null;
  await act(async () => {
    try {
      await action();
    } catch (e) {
      message = e.message;
    }
  });
  return message;
}

async function resultOf(action) {
  let value;
  await act(async () => { value = await action(); });
  return value;
}







// -----------------------------------------------------------
// Detection
// -----------------------------------------------------------
//
// Which provider the hook trusts, and the 250 ms look-out for
// an extension that injects after the page mounted (5 s, then
// "not installed" for good).
// -----------------------------------------------------------

describe('Detection', () => {

  it('finds Phantom at window.phantom.solana at mount: installed, on the connect step, no address yet', () => {
    installPhantom();
    const { result } = mount();
    expect(result.current.installed).toBe(true);
    expect(result.current.step).toBe(1);
    expect(result.current.address).toBeNull();
  });


  it('is on the install step when no wallet is injected', () => {
    const { result } = mount();
    expect(result.current.installed).toBe(false);
    expect(result.current.step).toBe(0);
    expect(result.current.address).toBeNull();
  });


  it('ignores the shared window.solana slot, even when the object there says isPhantom', () => {
    const squatter = createPhantom({ connected: true }).installLegacy();
    const { result } = mount();
    expect(result.current.step).toBe(0);
    expect(squatter.calls).toEqual([]);
  });


  it('ignores a provider at window.phantom.solana that lacks the isPhantom flag', () => {
    const impostor = installPhantom({ isPhantom: false, connected: true });
    const { result } = mount();
    expect(result.current.step).toBe(0);
    expect(impostor.calls).toEqual([]);
  });


  it('keeps looking every 250 ms and wires Phantom the moment it injects', () => {
    vi.useFakeTimers();
    const phantom = createPhantom();
    const { result } = mount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.step).toBe(0);

    phantom.install();
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current.installed).toBe(true);
    expect(result.current.step).toBe(1);
    expect(phantom.callsTo('on').map(([event]) => event)).toEqual(['connect', 'disconnect', 'accountChanged']);
    expect(phantom.callsTo('connect')).toEqual([[{ onlyIfTrusted: true }]]);
  });


  it('gives up after 5 s: an extension injecting later stays unnoticed', () => {
    vi.useFakeTimers();
    const phantom = createPhantom();
    const { result } = mount();
    act(() => { vi.advanceTimersByTime(5300); });
    phantom.install();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.step).toBe(0);
    expect(phantom.calls).toEqual([]);
  });


  it('stops looking once unmounted — nothing is wired to a provider that injects afterwards', () => {
    vi.useFakeTimers();
    const phantom = createPhantom();
    const { unmount } = mount();
    unmount();
    phantom.install();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(phantom.calls).toEqual([]);
  });
});







// -----------------------------------------------------------
// Restoring a session at mount
// -----------------------------------------------------------
//
// A live session is read straight off the provider; anything
// else gets ONE silent connect({ onlyIfTrusted: true }) —
// approved for a Trusted App, refused (and swallowed)
// otherwise.
// -----------------------------------------------------------

describe('Restoring a session at mount', () => {

  it('takes the address of a live session at once, without any connect call', () => {
    const phantom = installPhantom({ connected: true });
    const { result } = mount();
    expect(result.current.address).toBe(STUDENT_SOL);
    expect(result.current.step).toBe(2);
    expect(phantom.callsTo('connect')).toEqual([]);
  });


  it('asks silently once when there is no live session — a trusted origin comes back connected', () => {
    const phantom = installPhantom({ trusted: true });
    const { result } = mount();
    expect(phantom.callsTo('connect')).toEqual([[{ onlyIfTrusted: true }]]);
    expect(result.current.address).toBe(STUDENT_SOL);
    expect(result.current.step).toBe(2);
  });


  it('an origin Phantom does not trust stays on the connect step, the silent refusal swallowed', async () => {
    const phantom = installPhantom({ trusted: false });
    const { result } = mount();
    await act(async () => {});
    expect(phantom.callsTo('connect')).toEqual([[{ onlyIfTrusted: true }]]);
    expect(result.current.address).toBeNull();
    expect(result.current.step).toBe(1);
  });


  it.each([
    ['a PublicKey object (toBase58)', 'object'],
    ['a bare base58 string', 'string'],
    ['an object with only toString', 'toString'],
  ])('unwraps a key handed out as %s into the same base58 address', (_, keyAs) => {
    installPhantom({ connected: true, keyAs });
    const { result } = mount();
    expect(result.current.address).toBe(STUDENT_SOL);
  });


  it('keeps the case of the base58 address exactly — folding it would name another key', () => {
    installPhantom({ connected: true, account: OTHER_SOL });
    const { result } = mount();
    expect(result.current.address).toBe('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
  });
});







// -----------------------------------------------------------
// The extension's events
// -----------------------------------------------------------
//
// What the student does inside Phantom reaches the hook as
// events: connect, disconnect, accountChanged (a key, or null
// for an account this origin does not trust yet). The
// listeners leave with the component.
// -----------------------------------------------------------

describe("The extension's events", () => {

  it('follows the "connect" event, reading provider.publicKey when the event carries no key', async () => {
    const phantom = installPhantom({ account: OTHER_SOL });
    const { result } = mount();
    act(() => { phantom.emit('connect', publicKeyOf(STUDENT_SOL)); });
    expect(result.current.address).toBe(STUDENT_SOL);

    // A live session, then a bare event: the provider's key wins
    await act(async () => { await phantom.provider.connect(); });
    act(() => { phantom.emit('disconnect'); });
    expect(result.current.address).toBeNull();
    act(() => { phantom.emit('connect'); });
    expect(result.current.address).toBe(OTHER_SOL);
  });


  it('goes back to the connect step on "disconnect", and the cluster step must be passed again', async () => {
    const phantom = installPhantom({ connected: true });
    const { result } = mount();
    await act(async () => { await result.current.switchNetwork(); });
    expect(result.current.step).toBe(3);

    await act(async () => { await phantom.provider.disconnect(); });
    expect(result.current.address).toBeNull();
    expect(result.current.step).toBe(1);

    await act(async () => { await phantom.provider.connect(); });
    expect(result.current.address).toBe(STUDENT_SOL);
    expect(result.current.step).toBe(2);
  });


  it('switches to the account the student picks inside the extension, keeping the passed cluster step', async () => {
    const phantom = installPhantom({ connected: true });
    const { result } = mount();
    await act(async () => { await result.current.switchNetwork(); });
    act(() => { phantom.changeAccount(OTHER_SOL); });
    expect(result.current.address).toBe(OTHER_SOL);
    expect(result.current.step).toBe(3);
  });


  it('accountChanged(null) drops the address and asks Phantom to reconnect — a refusal is swallowed', async () => {
    const phantom = installPhantom({ connected: true, connect: 'reject' });
    const { result } = mount();
    await act(async () => { phantom.changeAccount(null); });
    expect(result.current.address).toBeNull();
    expect(result.current.step).toBe(1);
    // The reconnect is a plain connect() — the popup, no options
    expect(phantom.callsTo('connect')).toEqual([[]]);
  });


  it('accountChanged(null) followed by an approved reconnect lands on the account Phantom connects', async () => {
    const phantom = installPhantom({ connected: true });
    const { result } = mount();
    await act(async () => { phantom.changeAccount(null); });
    expect(phantom.callsTo('connect')).toEqual([[]]);
    expect(result.current.address).toBe(STUDENT_SOL);
  });


  it('removes exactly the three listeners it added when unmounted', () => {
    const phantom = installPhantom();
    const { unmount } = mount();
    expect(['connect', 'disconnect', 'accountChanged'].map(phantom.listening)).toEqual([1, 1, 1]);
    const added = phantom.callsTo('on');
    unmount();
    expect(['connect', 'disconnect', 'accountChanged'].map(phantom.listening)).toEqual([0, 0, 0]);
    expect(phantom.callsTo('off')).toEqual(added);
  });


  it('lets the listeners go through removeListener on builds without off', () => {
    const phantom = installPhantom({ listenerApi: 'removeListener' });
    const { unmount } = mount();
    unmount();
    expect(['connect', 'disconnect', 'accountChanged'].map(phantom.listening)).toEqual([0, 0, 0]);
    expect(phantom.callsTo('removeListener')).toHaveLength(3);
  });


  it('unmounts cleanly from a build that offers neither off nor removeListener', () => {
    const phantom = installPhantom({ listenerApi: 'none' });
    const { unmount } = mount();
    expect(() => unmount()).not.toThrow();
    // The stale listeners may still fire — into an unmounted hook
    expect(() => phantom.changeAccount(OTHER_SOL)).not.toThrow();
  });
});







// -----------------------------------------------------------
// connect()
// -----------------------------------------------------------
//
// The popup conversation: the address it resolves with, the
// fallbacks for a key-less answer, and every refusal as the
// Lithuanian sentence the page shows.
// -----------------------------------------------------------

describe('connect()', () => {

  it('opens the popup (no options), resolves with the base58 address and moves on to the cluster step', async () => {
    const phantom = installPhantom();
    const { result } = mount();
    expect(await resultOf(() => result.current.connect())).toBe(STUDENT_SOL);
    expect(phantom.callsTo('connect').at(-1)).toEqual([]);
    expect(result.current.address).toBe(STUDENT_SOL);
    expect(result.current.step).toBe(2);
  });


  it('reads provider.publicKey when the answer carries no key', async () => {
    installPhantom({ connected: true, connect: () => ({}) });
    const { result } = mount();
    expect(await resultOf(() => result.current.connect())).toBe(STUDENT_SOL);
  });


  it('refuses with "Phantom negrąžino Solana paskyros." when neither the answer nor the provider has a key', async () => {
    installPhantom({ connect: 'no-account' });
    const { result } = mount();
    expect(await refusalOf(() => result.current.connect())).toBe('Phantom negrąžino Solana paskyros.');
    expect(result.current.step).toBe(1);
  });


  it('says the popup was refused on 4001', async () => {
    installPhantom({ connect: 'reject' });
    const { result } = mount();
    expect(await refusalOf(() => result.current.connect())).toBe('Prijungimas atmestas Phantom lange.');
    expect(result.current.address).toBeNull();
  });


  it.each([
    ['in its own words', new Error('Phantom užrakinta'), 'Phantom užrakinta'],
    ['as "Nepavyko prijungti Phantom." when it has no words', phantomError(-32603, ''), 'Nepavyko prijungti Phantom.'],
  ])('passes any other failure on %s', async (_, failure, message) => {
    installPhantom({ connect: failure });
    const { result } = mount();
    expect(await refusalOf(() => result.current.connect())).toBe(message);
  });


  it('says Phantom is not loaded yet when the provider vanished before the click', async () => {
    const phantom = installPhantom();
    const { result } = mount();
    phantom.uninstall();
    expect(await refusalOf(() => result.current.connect())).toBe('Phantom dar neįkelta. Bandykite dar kartą.');
  });
});







// -----------------------------------------------------------
// switchNetwork() — the cluster step
// -----------------------------------------------------------
//
// changeNetwork({ genesisHash }) for the faucet's cluster.
// Phantom has no such method (-32601): the step passes as
// "assumed" and clusterConfirmed stays false, so the page
// keeps its Testnet Mode instructions. A wallet that performs
// the hop confirms it.
// -----------------------------------------------------------

describe('switchNetwork() — the cluster step', () => {

  it.each(Object.entries(GENESIS))('asks changeNetwork for the %s genesis hash', async (cluster, genesisHash) => {
    const phantom = installPhantom({ connected: true });
    const { result } = mount(cluster);
    await act(async () => { await result.current.switchNetwork(); });
    expect(phantom.callsTo('request')).toEqual([[{ method: 'changeNetwork', params: { genesisHash } }]]);
  });


  it("passes as assumed on Phantom's -32601 — ready (step 3), clusterConfirmed false", async () => {
    installPhantom({ connected: true, changeNetwork: 'missing' });
    const { result } = mount();
    expect(result.current.step).toBe(2);
    expect(await refusalOf(() => result.current.switchNetwork())).toBeNull();
    expect(result.current.step).toBe(3);
    expect(result.current.clusterConfirmed).toBe(false);
  });


  it('a wallet that performs the hop confirms it — ready, clusterConfirmed true', async () => {
    installPhantom({ connected: true, changeNetwork: 'confirm' });
    const { result } = mount();
    await act(async () => { await result.current.switchNetwork(); });
    expect(result.current.step).toBe(3);
    expect(result.current.clusterConfirmed).toBe(true);
  });


  it.each(['Method not found', 'changeNetwork is NOT IMPLEMENTED', 'Unsupported method: changeNetwork'])(
    'treats "%s" (no code) as the same missing method', async (message) => {
      installPhantom({ connected: true, changeNetwork: new Error(message) });
      const { result } = mount();
      expect(await refusalOf(() => result.current.switchNetwork())).toBeNull();
      expect(result.current.step).toBe(3);
      expect(result.current.clusterConfirmed).toBe(false);
    },
  );


  it('a build without request() passes as assumed without being asked anything', async () => {
    const phantom = installPhantom({ connected: true, changeNetwork: 'absent' });
    const { result } = mount();
    await act(async () => { await result.current.switchNetwork(); });
    expect(phantom.callsTo('request')).toEqual([]);
    expect(result.current.step).toBe(3);
    expect(result.current.clusterConfirmed).toBe(false);
  });


  it('a refused hop keeps the cluster step and says so', async () => {
    installPhantom({ connected: true, changeNetwork: 'reject' });
    const { result } = mount();
    expect(await refusalOf(() => result.current.switchNetwork())).toBe('Persijungimas atmestas Phantom lange.');
    expect(result.current.step).toBe(2);
  });


  it('a real failure keeps the cluster step and names what failed', async () => {
    installPhantom({ connected: true, changeNetwork: phantomError(-32603, 'Internal JSON-RPC error') });
    const { result } = mount();
    expect(await refusalOf(() => result.current.switchNetwork())).toBe('Nepavyko persijungti į tinklą: Internal JSON-RPC error');
    expect(result.current.step).toBe(2);
  });


  it('refuses a cluster it has no genesis hash for, without asking Phantom', async () => {
    const phantom = installPhantom({ connected: true });
    const { result } = mount('localnet');
    expect(await refusalOf(() => result.current.switchNetwork())).toBe('Nežinomas SVM tinklas.');
    expect(phantom.callsTo('request')).toEqual([]);
    expect(result.current.step).toBe(2);
  });


  it('says Phantom is not loaded yet when the provider vanished before the switch', async () => {
    const phantom = installPhantom({ connected: true });
    const { result } = mount();
    phantom.uninstall();
    expect(await refusalOf(() => result.current.switchNetwork())).toBe('Phantom dar neįkelta. Bandykite dar kartą.');
  });


  it('with no cluster to be wrong about, a connected wallet is ready at once', () => {
    installPhantom({ connected: true });
    const { result } = mount(null);
    expect(result.current.step).toBe(3);
  });


  it('forgets the passed step when the page moves to a network on another cluster', async () => {
    installPhantom({ connected: true, changeNetwork: 'confirm' });
    const { result, rerender } = mount('devnet');
    await act(async () => { await result.current.switchNetwork(); });
    expect(result.current.step).toBe(3);
    rerender({ cluster: 'testnet' });
    expect(result.current.step).toBe(2);
    expect(result.current.clusterConfirmed).toBe(false);
  });
});







// -----------------------------------------------------------
// signMessage() — the ownership proof
// -----------------------------------------------------------
//
// The fixed Lithuanian message with a Date.now() nonce, signed
// by the SELECTED account, sent back base58: every answer
// shape Phantom builds give, and every refusal.
// -----------------------------------------------------------

describe('signMessage() — the ownership proof', () => {

  it("signs the backend's message with a Date.now() nonce, shown as UTF-8, and returns the nonce and the base58 signature", async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1790000000000);
    const phantom = installPhantom({ connected: true });
    const { result } = mount();
    const proof = await resultOf(() => result.current.signMessage());
    expect(phantom.signedTexts()).toEqual([claimMessage('1790000000000')]);
    expect(phantom.callsTo('signMessage')[0][1]).toBe('utf8');
    expect(proof).toEqual({ nonce: '1790000000000', signature: bs58.encode(SOL_SIGNATURE) });
  });


  it('accepts the bare signature bytes older builds answer with', async () => {
    installPhantom({ connected: true, sign: 'raw' });
    const { result } = mount();
    const proof = await resultOf(() => result.current.signMessage());
    expect(proof.signature).toBe(bs58.encode(SOL_SIGNATURE));
  });


  it('refuses an empty signature', async () => {
    installPhantom({ connected: true, sign: 'empty' });
    const { result } = mount();
    expect(await refusalOf(() => result.current.signMessage())).toBe('Phantom negrąžino parašo.');
  });


  it('refuses a signature another account made — the student switched inside the popup', async () => {
    installPhantom({ connected: true, sign: { signer: OTHER_SOL } });
    const { result } = mount();
    expect(await refusalOf(() => result.current.signMessage())).toBe('Phantom pasirašė kita paskyra. Perjunkite paskyrą ir bandykite dar kartą.');
  });


  it('takes provider.publicKey as the signer when the answer names none — and refuses a mismatch', async () => {
    const phantom = installPhantom({ connected: true, account: OTHER_SOL, sign: 'no-key' });
    const { result } = mount();
    // The page believes in STUDENT_SOL; the provider still holds OTHER_SOL
    act(() => { phantom.emit('accountChanged', publicKeyOf(STUDENT_SOL)); });
    expect(await refusalOf(() => result.current.signMessage())).toBe('Phantom pasirašė kita paskyra. Perjunkite paskyrą ir bandykite dar kartą.');
  });


  it('with no key anywhere, the connected address is taken as the signer', async () => {
    const phantom = installPhantom({ sign: 'no-key' });
    const { result } = mount();
    act(() => { phantom.emit('connect', publicKeyOf(STUDENT_SOL)); });
    const proof = await resultOf(() => result.current.signMessage());
    expect(proof.signature).toBe(bs58.encode(SOL_SIGNATURE));
  });


  it('says the signing popup was refused on 4001', async () => {
    installPhantom({ connected: true, sign: 'reject' });
    const { result } = mount();
    expect(await refusalOf(() => result.current.signMessage())).toBe('Pasirašymas atmestas Phantom lange.');
  });


  it.each([
    ['in its own words', new Error('Ledger atjungtas'), 'Ledger atjungtas'],
    ['as "Nepavyko pasirašyti žinutės." when it has no words', phantomError(-32603, ''), 'Nepavyko pasirašyti žinutės.'],
  ])('passes other signing failures on %s', async (_, failure, message) => {
    installPhantom({ connected: true, sign: failure });
    const { result } = mount();
    expect(await refusalOf(() => result.current.signMessage())).toBe(message);
  });


  it('refuses before a wallet is connected, without asking Phantom', async () => {
    const phantom = installPhantom();
    const { result } = mount();
    expect(await refusalOf(() => result.current.signMessage())).toBe('Phantom piniginė neprijungta.');
    expect(phantom.callsTo('signMessage')).toEqual([]);
  });


  it('refuses when the provider vanished after connecting', async () => {
    const phantom = installPhantom({ connected: true });
    const { result } = mount();
    phantom.uninstall();
    expect(await refusalOf(() => result.current.signMessage())).toBe('Phantom piniginė neprijungta.');
  });


  it('a fresh nonce for every proof', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1790000000000).mockReturnValueOnce(1790000004321);
    installPhantom({ connected: true });
    const { result } = mount();
    const first = await resultOf(() => result.current.signMessage());
    const second = await resultOf(() => result.current.signMessage());
    expect([first.nonce, second.nonce]).toEqual(['1790000000000', '1790000004321']);
  });
});

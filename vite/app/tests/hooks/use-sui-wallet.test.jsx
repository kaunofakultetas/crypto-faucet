// -----------------------------------------------------------
//  [*] Tests — useSuiWallet (any Sui wallet, Wallet Standard)
//
//  The MOVE faucet's wallet hook on its own, against the Sui
//  wallet double (support/wallets/sui.js): Wallet Standard
//  discovery in both directions (a wallet that loaded before
//  the page answers the app-ready announcement, one that
//  loads after dispatches register-wallet), the filter that
//  keeps only wallets able to connect AND sign a Sui personal
//  message, several wallets and the first one used (handed
//  out as the object in use, so two of one name stay apart),
//  a foreign announcement that throws, unregistering (the
//  account leaving with its wallet, the next wallet still
//  announced taking over); the session restored without a
//  popup (the wallet's own account list, then the silent
//  connect — approved, empty, refused, answered too late);
//  the 'change' event (another account, a disconnect, a
//  chains-only update) and its unsubscription; connect with
//  every refusal message, the account picked out of a
//  multichain list and the chains it advertises; signMessage
//  — the backend's exact message, the nonce, the ACCOUNT
//  OBJECT handed to the wallet, the signature passed on as
//  the wallet serialized it, refusals; and selectWallet, the
//  wallet in use picked again included. There is no step 2:
//  a Sui address is the same on every network, so the step
//  goes 0 → 1 → 3.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  STUDENT_SUI, OTHER_SUI, SUI_SIGNATURE,
  createSuiWallet, installSuiWallet, suiAccount, walletError, rejected,
} from '../support/wallets/sui';
import useSuiWallet from '@/pages/Faucet_MOVE/useSuiWallet';


// The ownership message, word for word as the backend
// (move_faucet.request_move) rebuilds it before verifying
const claimMessage = (nonce) => `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;

// An account a multichain wallet may list next to the Sui one
const solanaAccount = { address: 'DGvWVvGUt92p1YiffQ69Ba75stvSRMjCo6KdUtkWayC8', publicKey: new Uint8Array(32), chains: ['solana:devnet'], features: [] };







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// mount: the hook, as the MOVE page calls it. refusalOf /
// resultOf: an action's rejection message (null when it
// resolved) or its value, run inside act so the state set on
// the way is flushed. announce: a wallet registering while
// the page is already up.
// -----------------------------------------------------------

const mount = () => renderHook(() => useSuiWallet());

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

async function announce(options) {
  let double;
  await act(async () => { double = installSuiWallet(options); });
  return double;
}







// -----------------------------------------------------------
// Discovery
// -----------------------------------------------------------
//
// The two Wallet Standard paths, the Sui filter, several
// wallets and the one in use, bad announcements,
// unregistering — the departed wallet's account goes with
// it, and the next wallet still announced takes over.
// -----------------------------------------------------------

describe('Discovery', () => {

  it('suggests Slush on the install step when no Sui wallet announces itself', () => {
    const { result } = mount();
    expect(result.current).toMatchObject({
      installed: false, walletName: 'Slush', installUrl: 'https://slush.app',
      step: 0, address: null, chains: [], wallets: [],
    });
  });


  it('finds a wallet that loaded before the page, through the app-ready announcement', async () => {
    const suiet = installSuiWallet({ name: 'Suiet' });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.installed).toBe(true);
    expect(result.current.walletName).toBe('Suiet');
    expect(result.current.step).toBe(1);
    expect(result.current.wallets).toEqual([suiet.wallet]);
  });


  it('finds a wallet that loads after the page, through its register-wallet event', async () => {
    const { result } = mount();
    expect(result.current.step).toBe(0);
    await announce({ name: 'Slush' });
    expect(result.current.installed).toBe(true);
    expect(result.current.walletName).toBe('Slush');
    expect(result.current.step).toBe(1);
  });


  it('ignores a Wallet Standard wallet that cannot sign a Sui personal message', async () => {
    const { result } = mount();
    await announce({ name: 'Solflare', sui: false });
    expect(result.current.step).toBe(0);
    expect(result.current.wallets).toEqual([]);
  });


  it('ignores a wallet that offers no standard:connect', async () => {
    const readOnly = createSuiWallet({ name: 'Viewer' });
    delete readOnly.wallet.features['standard:connect'];
    const { result } = mount();
    await act(async () => { readOnly.install(); });
    expect(result.current.step).toBe(0);
  });


  it('keeps every Sui wallet announced and talks to the first one', async () => {
    installSuiWallet({ name: 'Slush' });
    installSuiWallet({ name: 'Suiet' });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.wallets.map((w) => w.name)).toEqual(['Slush', 'Suiet']);
    expect(result.current.walletName).toBe('Slush');
  });


  it('lists a wallet that announces itself twice only once', async () => {
    const slush = createSuiWallet();
    slush.install();
    slush.install();
    const { result } = mount();
    await act(async () => {});
    expect(result.current.wallets).toEqual([slush.wallet]);
  });


  it('shrugs off a foreign announcement that is no callback, or one that throws, and still finds the real wallet', async () => {
    const { result } = mount();
    expect(() => act(() => {
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: null }));
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: () => { throw new Error('bad wallet'); } }));
    })).not.toThrow();
    await announce({ name: 'Suiet' });
    expect(result.current.walletName).toBe('Suiet');
  });


  it('forgets a wallet that unregisters — back to the install step, nothing left selected', async () => {
    const slush = installSuiWallet({ accounts: [suiAccount()] });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.step).toBe(3);
    act(() => { slush.unregister(); });
    expect(result.current).toMatchObject({ installed: false, walletName: 'Slush', step: 0, wallets: [] });
  });


  it('an unregistered wallet takes its account along — no address, no chains, nothing in use on the install step', async () => {
    const slush = installSuiWallet({ accounts: [suiAccount()] });
    const { result } = mount();
    await act(async () => {});
    act(() => { slush.unregister(); });
    expect(result.current.address).toBeNull();
    expect(result.current.chains).toEqual([]);
    expect(result.current.inUse).toBeNull();
  });


  it('an unregistering wallet that was not in use leaves the one in use alone', async () => {
    installSuiWallet({ name: 'Slush', accounts: [suiAccount()] });
    const suiet = installSuiWallet({ name: 'Suiet' });
    const { result } = mount();
    await act(async () => {});
    act(() => { suiet.unregister(); });
    expect(result.current.walletName).toBe('Slush');
    expect(result.current.address).toBe(STUDENT_SUI);
    expect(result.current.wallets.map((w) => w.name)).toEqual(['Slush']);
  });


  it('when the wallet in use unregisters, the next announced Sui wallet takes over', async () => {
    const slush = installSuiWallet({ name: 'Slush' });
    const suiet = installSuiWallet({ name: 'Suiet' });
    const { result } = mount();
    await act(async () => {});
    act(() => { slush.unregister(); });
    expect(result.current.wallets.map((w) => w.name)).toEqual(['Suiet']);
    expect(result.current.installed).toBe(true);
    expect(result.current.walletName).toBe('Suiet');
    expect(result.current.inUse).toBe(suiet.wallet);
    expect(result.current.step).toBe(1);
  });


  it("the wallet that takes over brings its own session, never the departed wallet's account", async () => {
    const slush = installSuiWallet({ name: 'Slush', accounts: [suiAccount(STUDENT_SUI, ['sui:mainnet'])] });
    installSuiWallet({ name: 'Suiet', accounts: [suiAccount(OTHER_SUI)] });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.address).toBe(STUDENT_SUI);
    act(() => { slush.unregister(); });
    await act(async () => {});
    expect(result.current.walletName).toBe('Suiet');
    expect(result.current.address).toBe(OTHER_SUI);
    expect(result.current.chains).toEqual(['sui:testnet']);
    expect(result.current.step).toBe(3);
  });


  it('a picked wallet that unregisters hands over to the first one still announced', async () => {
    installSuiWallet({ name: 'Slush' });
    const suiet = installSuiWallet({ name: 'Suiet', accounts: [suiAccount(OTHER_SUI)] });
    const { result } = mount();
    await act(async () => {});
    act(() => { result.current.selectWallet(suiet.wallet); });
    await act(async () => {});
    expect(result.current.address).toBe(OTHER_SUI);
    act(() => { suiet.unregister(); });
    await act(async () => {});
    expect(result.current.walletName).toBe('Slush');
    expect(result.current.address).toBeNull();
    expect(result.current.step).toBe(1);
  });


  it('hands out the wallet object in use, so two wallets of one name can be told apart', async () => {
    const first = installSuiWallet({ name: 'Slush' });
    const second = installSuiWallet({ name: 'Slush' });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.wallets).toHaveLength(2);
    expect(result.current.wallets[0]).toBe(first.wallet);
    expect(result.current.wallets[1]).toBe(second.wallet);
    expect(result.current.inUse).toBe(first.wallet);
    act(() => { result.current.selectWallet(second.wallet); });
    await act(async () => {});
    expect(result.current.inUse).toBe(second.wallet);
    expect(result.current.inUse).not.toBe(first.wallet);
  });
});







// -----------------------------------------------------------
// Restoring a session
// -----------------------------------------------------------
//
// No popup at mount: the wallet's own account list first,
// then a silent connect — the standard's empty answer and a
// refusal both leave the connect step; an answer for a
// wallet the student already left is dropped.
// -----------------------------------------------------------

describe('Restoring a session', () => {

  it('restores an account the wallet already lists for this origin — no popup, no silent connect', async () => {
    const slush = installSuiWallet({ accounts: [suiAccount()] });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.address).toBe(STUDENT_SUI);
    expect(result.current.step).toBe(3);
    expect(slush.callsTo('connect')).toEqual([]);
  });


  it('asks silently when nothing is listed, and an authorised origin comes back connected', async () => {
    const slush = installSuiWallet({ silent: 'approve' });
    const { result } = mount();
    await act(async () => {});
    expect(slush.callsTo('connect')).toEqual([[{ silent: true }]]);
    expect(result.current.address).toBe(STUDENT_SUI);
    expect(result.current.step).toBe(3);
  });


  it("stays on the connect step on the standard's empty silent answer", async () => {
    installSuiWallet({ silent: 'empty' });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.address).toBeNull();
    expect(result.current.step).toBe(1);
  });


  it('swallows a silent refusal and stays on the connect step', async () => {
    const slush = installSuiWallet({ silent: 'reject' });
    const { result } = mount();
    await act(async () => {});
    expect(slush.callsTo('connect')).toEqual([[{ silent: true }]]);
    expect(result.current.step).toBe(1);
  });


  it("picks the Sui account out of a multichain wallet's list", async () => {
    installSuiWallet({ accounts: [solanaAccount, suiAccount(OTHER_SUI)] });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.address).toBe(OTHER_SUI);
  });


  it('drops a silent answer that arrives after the student picked another wallet', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    installSuiWallet({ name: 'Slush', silent: () => pending });
    const suiet = installSuiWallet({ name: 'Suiet', accounts: [suiAccount(STUDENT_SUI)] });
    const { result } = mount();
    await act(async () => {});
    act(() => { result.current.selectWallet(suiet.wallet); });
    await act(async () => {});
    expect(result.current.address).toBe(STUDENT_SUI);

    await act(async () => { release({ accounts: [suiAccount(OTHER_SUI)] }); });
    expect(result.current.walletName).toBe('Suiet');
    expect(result.current.address).toBe(STUDENT_SUI);
  });
});







// -----------------------------------------------------------
// The change event
// -----------------------------------------------------------
//
// standard:events keeps the account in step with the
// extension; the subscription ends with the component or the
// wallet.
// -----------------------------------------------------------

describe('The change event', () => {

  it('follows the account the student switches to inside the extension', async () => {
    const slush = installSuiWallet({ accounts: [suiAccount()] });
    const { result } = mount();
    await act(async () => {});
    act(() => { slush.change([suiAccount(OTHER_SUI, ['sui:mainnet'])]); });
    expect(result.current.address).toBe(OTHER_SUI);
    expect(result.current.chains).toEqual(['sui:mainnet']);
    expect(result.current.step).toBe(3);
  });


  it("an empty account list is the standard's disconnect — back to the connect step", async () => {
    const slush = installSuiWallet({ accounts: [suiAccount()] });
    const { result } = mount();
    await act(async () => {});
    act(() => { slush.change([]); });
    expect(result.current.address).toBeNull();
    expect(result.current.chains).toEqual([]);
    expect(result.current.step).toBe(1);
  });


  it('a list with no Sui account left disconnects too', async () => {
    const slush = installSuiWallet({ accounts: [suiAccount()] });
    const { result } = mount();
    await act(async () => {});
    act(() => { slush.change([solanaAccount]); });
    expect(result.current.step).toBe(1);
  });


  it('keeps the account on a change that carries no account list (a chains-only update)', async () => {
    const slush = installSuiWallet({ accounts: [suiAccount()] });
    const { result } = mount();
    await act(async () => {});
    act(() => { slush.emitChange({ chains: ['sui:devnet'] }); });
    expect(result.current.address).toBe(STUDENT_SUI);
  });


  it('unsubscribes when unmounted', async () => {
    const slush = installSuiWallet();
    const { unmount } = mount();
    await act(async () => {});
    expect(slush.listening()).toBe(1);
    unmount();
    expect(slush.listening()).toBe(0);
  });


  it('moves its subscription to the wallet the student picks', async () => {
    const slush = installSuiWallet({ name: 'Slush' });
    const suiet = installSuiWallet({ name: 'Suiet' });
    const { result } = mount();
    await act(async () => {});
    act(() => { result.current.selectWallet(suiet.wallet); });
    await act(async () => {});
    expect(slush.listening()).toBe(0);
    expect(suiet.listening()).toBe(1);
  });


  it('works with a wallet that offers no standard:events', async () => {
    installSuiWallet({ events: false });
    const { result } = mount();
    await act(async () => {});
    expect(await resultOf(() => result.current.connect())).toBe(STUDENT_SUI);
    expect(result.current.step).toBe(3);
  });
});







// -----------------------------------------------------------
// connect
// -----------------------------------------------------------
//
// standard:connect, the Sui account picked out of the answer,
// and every refusal as the sentence the page shows — with the
// wallet's own name in it.
// -----------------------------------------------------------

describe('connect()', () => {

  it('opens the popup, resolves with the address and is ready at once — there is no network step', async () => {
    const slush = installSuiWallet();
    const { result } = mount();
    await act(async () => {});
    expect(await resultOf(() => result.current.connect())).toBe(STUDENT_SUI);
    expect(slush.callsTo('connect').at(-1)).toEqual([undefined]);
    expect(result.current.address).toBe(STUDENT_SUI);
    expect(result.current.step).toBe(3);
  });


  it('reports the Sui chains the account advertises, and only those', async () => {
    installSuiWallet({ accountsOnConnect: [suiAccount(STUDENT_SUI, ['sui:mainnet', 'solana:devnet', 'sui:devnet'])] });
    const { result } = mount();
    await act(async () => {});
    await resultOf(() => result.current.connect());
    expect(result.current.chains).toEqual(['sui:mainnet', 'sui:devnet']);
  });


  it('takes the first Sui account from a multichain answer', async () => {
    installSuiWallet({ accountsOnConnect: [solanaAccount, suiAccount(OTHER_SUI), suiAccount(STUDENT_SUI)] });
    const { result } = mount();
    await act(async () => {});
    expect(await resultOf(() => result.current.connect())).toBe(OTHER_SUI);
  });


  it('refuses an answer without a Sui account, naming the wallet', async () => {
    installSuiWallet({ name: 'Suiet', accountsOnConnect: [solanaAccount] });
    const { result } = mount();
    await act(async () => {});
    expect(await refusalOf(() => result.current.connect())).toBe('Suiet negrąžino Sui paskyros.');
    expect(result.current.step).toBe(1);
  });


  it.each([
    ['the words "User rejected"', rejected()],
    ['the 4001 code', walletError('Closed', 4001)],
    ['the word "denied"', walletError('Access DENIED by user')],
  ])('says the popup was refused on %s', async (_, failure) => {
    installSuiWallet({ name: 'Suiet', connect: failure });
    const { result } = mount();
    await act(async () => {});
    expect(await refusalOf(() => result.current.connect())).toBe('Prijungimas atmestas Suiet lange.');
    expect(result.current.address).toBeNull();
  });


  it.each([
    ['in its own words', walletError('Wallet is locked'), 'Wallet is locked'],
    ['as "Nepavyko prijungti <wallet>." when it has none', walletError(''), 'Nepavyko prijungti Slush.'],
  ])('passes any other failure on %s', async (_, failure, message) => {
    installSuiWallet({ connect: failure });
    const { result } = mount();
    await act(async () => {});
    expect(await refusalOf(() => result.current.connect())).toBe(message);
  });


  it('says no Sui wallet is loaded yet when there is none', async () => {
    const { result } = mount();
    expect(await refusalOf(() => result.current.connect())).toBe('Sui piniginė dar neįkelta. Bandykite dar kartą.');
  });
});







// -----------------------------------------------------------
// signMessage — the ownership proof
// -----------------------------------------------------------
//
// sui:signPersonalMessage with the connected ACCOUNT OBJECT
// and the fixed message; the signature is passed on exactly
// as the wallet serialized it.
// -----------------------------------------------------------

describe('signMessage() — the ownership proof', () => {

  it("signs the backend's message with a Date.now() nonce through the account object, and returns the wallet's signature untouched", async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1790000000000);
    const account = suiAccount();
    const slush = installSuiWallet({ accounts: [account] });
    const { result } = mount();
    await act(async () => {});
    const proof = await resultOf(() => result.current.signMessage());
    expect(slush.signedTexts()).toEqual([claimMessage('1790000000000')]);
    expect(slush.callsTo('signPersonalMessage')[0][0].account).toBe(account);
    expect(proof).toEqual({ nonce: '1790000000000', signature: SUI_SIGNATURE });
  });


  it('refuses before an account is connected, the wallet not asked', async () => {
    const slush = installSuiWallet();
    const { result } = mount();
    await act(async () => {});
    expect(await refusalOf(() => result.current.signMessage())).toBe('Sui piniginė neprijungta.');
    expect(slush.callsTo('signPersonalMessage')).toEqual([]);
  });


  it('refuses when there is no wallet at all', async () => {
    const { result } = mount();
    expect(await refusalOf(() => result.current.signMessage())).toBe('Sui piniginė neprijungta.');
  });


  it('refuses an answer without a signature, naming the wallet', async () => {
    installSuiWallet({ name: 'Suiet', accounts: [suiAccount()], sign: 'no-signature' });
    const { result } = mount();
    await act(async () => {});
    expect(await refusalOf(() => result.current.signMessage())).toBe('Suiet negrąžino parašo.');
  });


  it.each([
    ['the words "User rejected"', rejected()],
    ['the 4001 code', walletError('Closed', 4001)],
    ['the word "denied"', walletError('Signing denied')],
  ])('says the signing popup was refused on %s', async (_, failure) => {
    installSuiWallet({ name: 'Suiet', accounts: [suiAccount()], sign: failure });
    const { result } = mount();
    await act(async () => {});
    expect(await refusalOf(() => result.current.signMessage())).toBe('Pasirašymas atmestas Suiet lange.');
  });


  it.each([
    ['in its own words', walletError('Ledger disconnected'), 'Ledger disconnected'],
    ['as "Nepavyko pasirašyti žinutės." when it has none', walletError(''), 'Nepavyko pasirašyti žinutės.'],
  ])('passes other signing failures on %s', async (_, failure, message) => {
    installSuiWallet({ accounts: [suiAccount()], sign: failure });
    const { result } = mount();
    await act(async () => {});
    expect(await refusalOf(() => result.current.signMessage())).toBe(message);
  });


  it('signs with the account the student switched to inside the extension', async () => {
    const slush = installSuiWallet({ accounts: [suiAccount()] });
    const { result } = mount();
    await act(async () => {});
    const other = suiAccount(OTHER_SUI);
    act(() => { slush.change([other]); });
    await resultOf(() => result.current.signMessage());
    expect(slush.callsTo('signPersonalMessage')[0][0].account).toBe(other);
  });
});







// -----------------------------------------------------------
// selectWallet
// -----------------------------------------------------------
//
// The page's picker: another announced wallet takes over and
// ITS session is restored — the old account never carries
// over; picking the wallet already in use changes nothing.
// -----------------------------------------------------------

describe('selectWallet()', () => {

  it("switches to the picked wallet and restores that wallet's own session", async () => {
    installSuiWallet({ name: 'Slush', accounts: [suiAccount(STUDENT_SUI)] });
    const suiet = installSuiWallet({ name: 'Suiet', accounts: [suiAccount(OTHER_SUI)] });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.address).toBe(STUDENT_SUI);
    act(() => { result.current.selectWallet(suiet.wallet); });
    await act(async () => {});
    expect(result.current.walletName).toBe('Suiet');
    expect(result.current.address).toBe(OTHER_SUI);
  });


  it('a picked wallet with no session for this origin goes back to the connect step', async () => {
    installSuiWallet({ name: 'Slush', accounts: [suiAccount(STUDENT_SUI)] });
    const suiet = installSuiWallet({ name: 'Suiet' });
    const { result } = mount();
    await act(async () => {});
    act(() => { result.current.selectWallet(suiet.wallet); });
    await act(async () => {});
    expect(result.current.walletName).toBe('Suiet');
    expect(result.current.address).toBeNull();
    expect(result.current.step).toBe(1);
    expect(suiet.callsTo('connect')).toEqual([[{ silent: true }]]);
  });


  it('picking the wallet already in use keeps its session — no step back to connecting', async () => {
    const slush = installSuiWallet({ name: 'Slush', accounts: [suiAccount(STUDENT_SUI)] });
    installSuiWallet({ name: 'Suiet' });
    const { result } = mount();
    await act(async () => {});
    expect(result.current.step).toBe(3);
    act(() => { result.current.selectWallet(slush.wallet); });
    await act(async () => {});
    expect(result.current.walletName).toBe('Slush');
    expect(result.current.address).toBe(STUDENT_SUI);
    expect(result.current.step).toBe(3);
  });


  it('connects through the picked wallet, not the first one announced', async () => {
    const slush = installSuiWallet({ name: 'Slush' });
    const suiet = installSuiWallet({ name: 'Suiet', accountsOnConnect: [suiAccount(OTHER_SUI)] });
    const { result } = mount();
    await act(async () => {});
    act(() => { result.current.selectWallet(suiet.wallet); });
    expect(await resultOf(() => result.current.connect())).toBe(OTHER_SUI);
    expect(slush.callsTo('connect')).toEqual([[{ silent: true }]]);
    expect(suiet.callsTo('connect').at(-1)).toEqual([undefined]);
  });
});

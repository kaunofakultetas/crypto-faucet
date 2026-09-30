// -----------------------------------------------------------
//  [*] Tests — useMetamaskWallet (MetaMask on EVM chains)
//
//  The EVM-family wallet hook against the MetaMask double
//  (support/wallets/metamask.js), rendered with renderHook
//  inside a query client: how MetaMask is FOUND (EIP-6963
//  only — never the window.ethereum squatter; the stable build
//  over flask / mmi; a wallet that announces late; a malformed
//  announcement), the bootstrap reads and the events that keep
//  account and chain fresh, the step ladder, connect,
//  switchNetwork (the 4902 add-then-switch, the wrapped 4902,
//  every refusal, the landing check), signMessage (the exact
//  Lithuanian claim message as UTF-8 hex, the nonce) and the
//  balance poll (1 s, the chain written back, a wrong chain's
//  null, a failing RPC and its recovery).
//
//  The hook caches the first MetaMask it hears for the life of
//  its module — every test gets a fresh copy of the module
//  (vi.resetModules), so no test inherits another's wallet.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '../support/render';
import { settle } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import {
  installMetamask, installPhantomEvm, rpcError, hexChain,
  MAINNET, SEPOLIA, HOODI, OTHER_ACCOUNT, ETH, SIGNATURE, USER_REJECTED,
} from '../support/wallets/metamask';


const CLAIM_MESSAGE = 'Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ';
const NOT_LOADED = 'MetaMask dar neįkelta. Bandykite dar kartą.';
const NOT_LANDED = 'Tinklas dar neįjungtas — paspauskite mygtuką dar kartą arba perjunkite tinklą MetaMask lange.';

const sepolia = f.evmNetworksMap.sepolia;
const hoodi = f.evmNetworksMap.hoodi;


// A fresh hook module per test — its provider cache is empty
let hookModule;

beforeEach(async () => {
  vi.resetModules();
  hookModule = await import('@/hooks/useMetamaskWallet');
});







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderWallet mounts the hook for an expected chain (SEPOLIA
// when no argument is given; an explicit undefined is the
// ERC-20 page's chain-agnostic use) inside its own query
// client; rerender({ expected }) changes it. hopMethods drops the balance poll's reads from
// a call record, leaving the switch conversation.
// -----------------------------------------------------------

function renderWallet(...args) {
  const expectedChainId = args.length ? args[0] : SEPOLIA;
  const client = makeQueryClient();
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const useMetamaskWallet = hookModule.default;
  return renderHook(({ expected }) => useMetamaskWallet(expected), { initialProps: { expected: expectedChainId }, wrapper });
}

const HOP = ['wallet_switchEthereumChain', 'wallet_addEthereumChain'];

const hopMethods = (wallet) => wallet.methods().filter((m) => HOP.includes(m));







// -----------------------------------------------------------
// Finding MetaMask
// -----------------------------------------------------------
//
// EIP-6963 only: a provider announced under rdns io.metamask*
// — the stable build beats flask / mmi, otherwise the first
// one wins — and a hook that found nothing at mount is wired
// the moment one shows up.
// -----------------------------------------------------------

describe('Finding MetaMask', () => {

  it('reports no wallet at all as not installed — step 0, nothing known', async () => {
    const { result } = renderWallet();
    await settle();
    expect(result.current).toMatchObject({ installed: false, account: null, chainId: null, balance: null, balanceFailed: false, step: 0 });
    expect(hookModule.getMetamaskProvider()).toBeNull();
  });


  it('never takes the window.ethereum squatter for MetaMask — Phantom claiming isMetaMask is not installed and never asked', async () => {
    const phantom = installPhantomEvm({ connected: true, announce: false });
    expect(window.ethereum.isMetaMask).toBe(true);
    const { result } = renderWallet();
    await settle();
    expect(result.current.installed).toBe(false);
    expect(result.current.step).toBe(0);
    expect(phantom.calls).toEqual([]);
  });


  it('ignores another wallet announcing itself through EIP-6963', async () => {
    const phantom = installPhantomEvm({ connected: true });
    const { result } = renderWallet();
    await settle();
    expect(result.current.step).toBe(0);
    expect(hookModule.getMetamaskProvider()).toBeNull();
    expect(phantom.calls).toEqual([]);
  });


  it('finds MetaMask by its announcement and reads the account and the chain', async () => {
    const metamask = installMetamask({ connected: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    expect(result.current).toMatchObject({ installed: true, account: f.STUDENT_EVM, chainId: SEPOLIA });
    expect(hookModule.getMetamaskProvider()).toBe(metamask.provider);
  });


  it('asks for providers when its module loads, so a MetaMask that announced earlier is found too', async () => {
    const metamask = installMetamask();
    vi.resetModules();
    hookModule = await import('@/hooks/useMetamaskWallet');
    expect(hookModule.getMetamaskProvider()).toBe(metamask.provider);
  });


  it('asks again once the page has loaded — a wallet that only answers requests is found then', () => {
    const metamask = installMetamask({ announce: 'on-request' });
    expect(hookModule.getMetamaskProvider()).toBeNull();
    window.dispatchEvent(new Event('load'));
    expect(hookModule.getMetamaskProvider()).toBe(metamask.provider);
  });


  it('wires a MetaMask that announces only after mount — the install step does not stick', async () => {
    const metamask = installMetamask({ connected: true, announce: false });
    const { result } = renderWallet();
    await settle();
    expect(result.current.step).toBe(0);
    expect(metamask.calls).toEqual([]);

    act(() => metamask.announce());
    await waitFor(() => expect(result.current.step).toBe(3));
    expect(result.current.account).toBe(f.STUDENT_EVM);
    expect(metamask.listenerCount('accountsChanged')).toBe(1);
    expect(metamask.listenerCount('chainChanged')).toBe(1);
  });


  it('prefers the stable build: a flask build announced first is replaced when io.metamask arrives', async () => {
    const flask = installMetamask({ rdns: 'io.metamask.flask', name: 'MetaMask Flask', onWindow: false });
    expect(hookModule.getMetamaskProvider()).toBe(flask.provider);
    const stable = installMetamask({ onWindow: false });
    expect(hookModule.getMetamaskProvider()).toBe(stable.provider);

    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(1));
    expect(stable.methods()).toEqual(expect.arrayContaining(['eth_accounts', 'eth_chainId']));
    expect(flask.calls).toEqual([]);
  });


  it('keeps the stable build when a flask build announces after it', () => {
    const stable = installMetamask({ onWindow: false });
    installMetamask({ rdns: 'io.metamask.flask', name: 'MetaMask Flask', onWindow: false });
    expect(hookModule.getMetamaskProvider()).toBe(stable.provider);
  });


  it('keeps the first of two non-stable builds (mmi before flask)', () => {
    const mmi = installMetamask({ rdns: 'io.metamask.mmi', name: 'MetaMask Institutional', onWindow: false });
    installMetamask({ rdns: 'io.metamask.flask', name: 'MetaMask Flask', onWindow: false });
    expect(hookModule.getMetamaskProvider()).toBe(mmi.provider);
  });


  it('shrugs off malformed announcements — no detail, no info, no rdns', async () => {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider'));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {} }));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { name: 'MetaMask' }, provider: {} } }));
    expect(hookModule.getMetamaskProvider()).toBeNull();
    const { result } = renderWallet();
    await settle();
    expect(result.current.step).toBe(0);
  });


  it('wires a re-announcing MetaMask only once', async () => {
    const metamask = installMetamask({ connected: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    act(() => {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      metamask.announce();
    });
    await settle();
    expect(metamask.listenerCount('accountsChanged')).toBe(1);
    expect(metamask.callsTo('eth_accounts')).toHaveLength(1);
  });


  it('onMetamaskProvider calls back on the announcement, and its return value unsubscribes', () => {
    const heard = [];
    const unheard = [];
    const stop = hookModule.onMetamaskProvider((provider) => heard.push(provider));
    const stopEarly = hookModule.onMetamaskProvider((provider) => unheard.push(provider));
    stopEarly();

    const metamask = installMetamask();
    expect(heard).toEqual([metamask.provider]);
    expect(unheard).toEqual([]);
    stop();
  });


  it('forgets its wait for a late MetaMask when unmounted first — the wallet is never asked anything', async () => {
    const metamask = installMetamask({ connected: true, announce: false });
    const { unmount } = renderWallet();
    await settle();
    unmount();
    metamask.announce();
    await settle();
    expect(metamask.calls).toEqual([]);
  });


  it.fails('talks to one wallet only when the stable build announces after a flask build was wired — PINNED KNOWN BUG: the hook keeps reading and signing with flask while connect() asks the stable build', async () => {
    const flask = installMetamask({ rdns: 'io.metamask.flask', name: 'MetaMask Flask', onWindow: false });
    const { result } = renderWallet(undefined);
    await waitFor(() => expect(result.current.step).toBe(1));

    const stable = installMetamask({ onWindow: false });
    await act(() => result.current.connect());
    await waitFor(() => expect(result.current.account).toBe(f.STUDENT_EVM));

    // The account came from the stable build — so must the signature
    await expect(result.current.signMessage()).resolves.toMatchObject({ signature: SIGNATURE });
    expect(stable.signed).toHaveLength(1);
    expect(flask.callsTo('personal_sign')).toEqual([]);
  });
});







// -----------------------------------------------------------
// Account and chain — the bootstrap reads and the events
// -----------------------------------------------------------
//
// eth_accounts / eth_chainId on wiring, then accountsChanged
// and chainChanged for whatever the student does inside the
// extension; the listeners go away with the component.
// -----------------------------------------------------------

describe('Account and chain — the bootstrap reads and the events', () => {

  it('starts connected when the site is already permitted, the chain decoded from hex to a number', async () => {
    const metamask = installMetamask({ connected: true, chainId: HOODI });
    const { result } = renderWallet(HOODI);
    await waitFor(() => expect(result.current.step).toBe(3));
    expect(result.current.chainId).toBe(560048);
    expect(result.current.account).toBe(f.STUDENT_EVM);
    expect(metamask.methods().slice(0, 2)).toEqual(['eth_accounts', 'eth_chainId']);
  });


  it('starts at the connect step when the site is not permitted yet (eth_accounts is empty)', async () => {
    const metamask = installMetamask();
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.chainId).toBe(SEPOLIA));
    expect(result.current.account).toBeNull();
    expect(result.current.step).toBe(1);
    expect(metamask.callsTo('eth_requestAccounts')).toEqual([]);
  });


  it('takes the first account when the wallet exposes several', async () => {
    installMetamask({ connected: true, accounts: [OTHER_ACCOUNT, f.STUDENT_EVM] });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.account).toBe(OTHER_ACCOUNT));
  });


  it('survives an extension port that is briefly down: a failing eth_accounts is logged and the account stays unknown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installMetamask({ connected: true }).fail('eth_accounts', rpcError(-32603, 'Disconnected from MetaMask background.'));
    const { result } = renderWallet();
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[metamask] eth_accounts failed', expect.objectContaining({ message: 'Disconnected from MetaMask background.' })));
    expect(result.current.account).toBeNull();
    expect(result.current.step).toBe(1);
  });


  it('repairs a failing first eth_chainId on the balance tick', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installMetamask({ connected: true }).fail('eth_chainId', rpcError(-32603, 'Disconnected from MetaMask background.'), { once: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    expect(result.current.chainId).toBe(SEPOLIA);
    expect(warn).toHaveBeenCalledWith('[metamask] eth_chainId failed', expect.anything());
  });


  it('follows the student switching accounts inside MetaMask (accountsChanged)', async () => {
    const metamask = installMetamask({ connected: true, accounts: [f.STUDENT_EVM, OTHER_ACCOUNT] });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.account).toBe(f.STUDENT_EVM));
    act(() => metamask.changeAccounts([OTHER_ACCOUNT]));
    expect(result.current.account).toBe(OTHER_ACCOUNT);
    expect(result.current.step).toBe(3);
  });


  it('goes back to the connect step when the student disconnects the site (accountsChanged with no accounts)', async () => {
    const metamask = installMetamask({ connected: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    act(() => metamask.changeAccounts([]));
    expect(result.current.account).toBeNull();
    expect(result.current.step).toBe(1);
    expect(result.current.balance).toBeNull();
  });


  it('follows a chain switch inside MetaMask (chainChanged): another chain is step 2, back again is step 3', async () => {
    const metamask = installMetamask({ connected: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    act(() => metamask.changeChain(MAINNET));
    expect(result.current.chainId).toBe(MAINNET);
    expect(result.current.step).toBe(2);
    act(() => metamask.changeChain(SEPOLIA));
    expect(result.current.step).toBe(3);
  });


  it('does not listen for disconnect — account and chain stay as they were', async () => {
    const metamask = installMetamask({ connected: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    expect(metamask.listenerCount('disconnect')).toBe(0);
    act(() => metamask.emit('disconnect', rpcError(4900, 'The provider is disconnected from all chains.')));
    expect(result.current).toMatchObject({ account: f.STUDENT_EVM, chainId: SEPOLIA, step: 3 });
  });


  it('removes both listeners when unmounted', async () => {
    const metamask = installMetamask({ connected: true });
    const { result, unmount } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    expect(metamask.listenerCount('accountsChanged')).toBe(1);
    expect(metamask.listenerCount('chainChanged')).toBe(1);
    unmount();
    expect(metamask.listenerCount('accountsChanged')).toBe(0);
    expect(metamask.listenerCount('chainChanged')).toBe(0);
  });
});







// -----------------------------------------------------------
// The step ladder
// -----------------------------------------------------------
//
// 0 install → 1 connect → 2 switch network → 3 ready; with no
// expected chain a connected wallet is ready on any chain.
// -----------------------------------------------------------

describe('The step ladder', () => {

  it.each([
    ['no MetaMask', 0, null],
    ['MetaMask, the site not connected', 1, {}],
    ['connected, on another chain', 2, { connected: true, chainId: MAINNET }],
    ['connected, on the faucet chain', 3, { connected: true }],
  ])('%s → step %i', async (_, step, wallet) => {
    if (wallet) installMetamask(wallet);
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(step));
    await settle();
    expect(result.current.step).toBe(step);
  });


  it('with no expected chain (the ERC-20 page) a connected wallet is ready on any chain, and no balance is polled', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET });
    const { result } = renderWallet(undefined);
    await waitFor(() => expect(result.current.step).toBe(3));
    await settle(100);
    expect(result.current.chainId).toBe(MAINNET);
    expect(result.current.balance).toBeNull();
    expect(metamask.callsTo('eth_getBalance')).toEqual([]);
  });


  it('moves a ready wallet back to the switch step when the expected chain changes', async () => {
    installMetamask({ connected: true });
    const { result, rerender } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    rerender({ expected: HOODI });
    expect(result.current.step).toBe(2);
    await waitFor(() => expect(result.current.balance).toBeNull());
  });
});







// -----------------------------------------------------------
// connect()
// -----------------------------------------------------------

describe('connect()', () => {

  it('asks MetaMask for the accounts and takes the first one', async () => {
    const metamask = installMetamask({ accounts: [f.STUDENT_EVM, OTHER_ACCOUNT] });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(1));
    await act(() => result.current.connect());
    expect(result.current.account).toBe(f.STUDENT_EVM);
    expect(result.current.step).toBe(3);
    expect(metamask.callsTo('eth_requestAccounts')).toHaveLength(1);
  });


  it("connects on the answer alone when MetaMask emits no accountsChanged", async () => {
    installMetamask({ emitsAccountsChanged: false });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(1));
    await act(() => result.current.connect());
    expect(result.current.account).toBe(f.STUDENT_EVM);
  });


  it("passes MetaMask's own refusal through when the student declines", async () => {
    installMetamask().decline('eth_requestAccounts');
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(1));
    await act(() => expect(result.current.connect()).rejects.toMatchObject({ code: 4001, message: USER_REJECTED }));
    expect(result.current.account).toBeNull();
    expect(result.current.step).toBe(1);
  });


  it('stays at the connect step when MetaMask grants no account', async () => {
    installMetamask({ accounts: [] });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(1));
    await act(() => result.current.connect());
    expect(result.current.account).toBeNull();
    expect(result.current.step).toBe(1);
  });


  it('refuses with "MetaMask dar neįkelta. Bandykite dar kartą." when no MetaMask was found', async () => {
    const { result } = renderWallet();
    await expect(result.current.connect()).rejects.toThrow(NOT_LOADED);
  });


  it("a second connect while the popup is still open gets MetaMask's \"already pending\" (-32002); approving the first connects", async () => {
    const metamask = installMetamask();
    const popup = metamask.hold('eth_requestAccounts');
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(1));

    let first;
    act(() => { first = result.current.connect(); });
    await waitFor(() => expect(popup.called).toBe(true));
    await expect(result.current.connect()).rejects.toMatchObject({
      code: -32002,
      message: "Request of type 'wallet_requestPermissions' already pending for origin http://localhost:3000. Please wait.",
    });

    await act(async () => {
      popup.release();
      await first;
    });
    expect(result.current.account).toBe(f.STUDENT_EVM);
  });
});







// -----------------------------------------------------------
// switchNetwork()
// -----------------------------------------------------------
//
// wallet_switchEthereumChain with the hex id; 4902 → add from
// the network config, then switch again; the landing is read
// back with eth_chainId. Every failure is a ready-to-display
// Lithuanian sentence.
// -----------------------------------------------------------

describe('switchNetwork()', () => {

  it('switches to a known chain with its hex id and records the verified landing', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(2));

    await act(() => result.current.switchNetwork(sepolia));
    expect(metamask.callsTo('wallet_switchEthereumChain')).toEqual([{ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] }]);
    expect(metamask.chainId).toBe(SEPOLIA);
    expect(result.current.chainId).toBe(SEPOLIA);
    expect(result.current.step).toBe(3);
  });


  it('records the landing even when MetaMask stays silent (no chainChanged)', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET, emitsChainChanged: false });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(2));
    const reads = metamask.callsTo('eth_chainId').length;

    await act(() => result.current.switchNetwork(sepolia));
    expect(result.current.step).toBe(3);
    // The landing was read back, not assumed
    expect(metamask.callsTo('eth_chainId').length).toBeGreaterThan(reads);
  });


  it("adds a chain MetaMask does not know (4902) from the network config, then switches again", async () => {
    const metamask = installMetamask({ connected: true, chainId: SEPOLIA });
    const { result } = renderWallet(HOODI);
    await waitFor(() => expect(result.current.step).toBe(2));

    await act(() => result.current.switchNetwork(hoodi));
    expect(hopMethods(metamask)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    expect(metamask.added).toEqual([{
      chainId: '0x88bb0',
      chainName: 'Ethereum Hoodi',
      nativeCurrency: { decimals: 18, name: 'Ethereum', symbol: 'ETH' },
      rpcUrls: ['https://rpc.hoodi.ethpandaops.io'],
      blockExplorerUrls: ['https://light-hoodi.beaconcha.in'],
    }]);
    expect(result.current.chainId).toBe(HOODI);
    expect(result.current.step).toBe(3);
  });


  it("names the chain with the config's chain_name (what MetaMask stores), not the faucet's display name", async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET, chains: [MAINNET] });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(2));
    await act(() => result.current.switchNetwork(sepolia));
    expect(metamask.added[0].chainName).toBe('Sepolia');
    expect(metamask.added[0].chainId).toBe(hexChain(SEPOLIA));
  });


  it('falls back to the display name when the config has no chain_name', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET, chains: [MAINNET] });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(2));
    await act(() => result.current.switchNetwork({ ...sepolia, chain_name: '' }));
    expect(metamask.added[0].chainName).toBe('Ethereum Sepolia');
    expect(result.current.step).toBe(3);
  });


  it('recognises the 4902 that newer builds wrap inside an internal error', async () => {
    const metamask = installMetamask({ connected: true, wraps4902: true });
    const { result } = renderWallet(HOODI);
    await waitFor(() => expect(result.current.step).toBe(2));
    await act(() => result.current.switchNetwork(hoodi));
    expect(metamask.added).toHaveLength(1);
    expect(result.current.step).toBe(3);
  });


  it('copes with an older build that switches while adding', async () => {
    const metamask = installMetamask({ connected: true, switchesOnAdd: true });
    const { result } = renderWallet(HOODI);
    await waitFor(() => expect(result.current.step).toBe(2));
    await act(() => result.current.switchNetwork(hoodi));
    expect(metamask.chainId).toBe(HOODI);
    expect(result.current.step).toBe(3);
  });


  it('says "Nepavyko persijungti į tinklą: …" with MetaMask\'s words when the student declines the switch', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET }).decline('wallet_switchEthereumChain');
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(2));
    await act(() => expect(result.current.switchNetwork(sepolia)).rejects.toThrow(`Nepavyko persijungti į tinklą: ${USER_REJECTED}`));
    expect(metamask.added).toEqual([]);
    expect(result.current.step).toBe(2);
  });


  it('says "Nepavyko pridėti tinklo: …" when the student declines adding the chain', async () => {
    const metamask = installMetamask({ connected: true }).decline('wallet_addEthereumChain');
    const { result } = renderWallet(HOODI);
    await waitFor(() => expect(result.current.step).toBe(2));
    await act(() => expect(result.current.switchNetwork(hoodi)).rejects.toThrow(`Nepavyko pridėti tinklo: ${USER_REJECTED}`));
    expect(hopMethods(metamask)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain']);
    expect(result.current.step).toBe(2);
  });


  it('says "Tinklas dar neįjungtas — …" when the chain was added but the second switch was declined', async () => {
    const metamask = installMetamask({ connected: true })
      .fail('wallet_switchEthereumChain', rpcError(4902, 'Unrecognized chain ID "0x88bb0".'), { once: true })
      .decline('wallet_switchEthereumChain', { once: true });
    const { result } = renderWallet(HOODI);
    await waitFor(() => expect(result.current.step).toBe(2));
    await act(() => expect(result.current.switchNetwork(hoodi)).rejects.toThrow(NOT_LANDED));
    expect(metamask.added).toHaveLength(1);
    expect(result.current.step).toBe(2);
  });


  it('catches MetaMask silently staying put — "Tinklas dar neįjungtas — …"', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET }).answer('wallet_switchEthereumChain', () => null);
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(2));
    await act(() => expect(result.current.switchNetwork(sepolia)).rejects.toThrow(NOT_LANDED));
    expect(metamask.chainId).toBe(MAINNET);
    expect(result.current.step).toBe(2);
  });


  it('refuses with "MetaMask dar neįkelta. Bandykite dar kartą." when no MetaMask was found', async () => {
    const { result } = renderWallet();
    await expect(result.current.switchNetwork(sepolia)).rejects.toThrow(NOT_LOADED);
  });
});







// -----------------------------------------------------------
// signMessage()
// -----------------------------------------------------------
//
// The ownership proof both EVM-family pages send with a
// claim: the fixed Lithuanian sentence with a fresh nonce,
// UTF-8 hex, signed by the connected account.
// -----------------------------------------------------------

describe('signMessage()', () => {

  it('signs the claim message with the connected account and hands back the nonce and the signature', async () => {
    const metamask = installMetamask({ connected: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));

    const before = Date.now();
    const proof = await act(() => result.current.signMessage());
    const after = Date.now();

    expect(proof.signature).toBe(SIGNATURE);
    expect(Number(proof.nonce)).toBeGreaterThanOrEqual(before);
    expect(Number(proof.nonce)).toBeLessThanOrEqual(after);
    expect(metamask.signed).toEqual([{ message: `${CLAIM_MESSAGE}${proof.nonce}`, raw: expect.any(String), address: f.STUDENT_EVM }]);
  });


  it('sends the message as UTF-8 hex — "ž", "ė" and "š" travel as their two-byte sequences', async () => {
    const metamask = installMetamask({ connected: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    await act(() => result.current.signMessage());

    const { raw } = metamask.signed[0];
    expect(raw).toMatch(/^0x([0-9a-f]{2})+$/);
    expect(raw).toContain('c5be'); // ž
    expect(raw).toContain('c497'); // ė
    expect(raw).toContain('c5a1'); // š
  });


  it('uses a fresh nonce for every signature', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-09-30T10:00:00Z') });
    const metamask = installMetamask({ connected: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));

    const first = await act(() => result.current.signMessage());
    vi.setSystemTime(new Date('2026-09-30T10:05:00Z'));
    const second = await act(() => result.current.signMessage());
    expect(first.nonce).not.toBe(second.nonce);
    expect(Number(second.nonce)).toBeGreaterThanOrEqual(Date.parse('2026-09-30T10:05:00Z'));
    expect(metamask.signed.map((s) => s.message)).toEqual([`${CLAIM_MESSAGE}${first.nonce}`, `${CLAIM_MESSAGE}${second.nonce}`]);
  });


  it('refuses with "MetaMask piniginė neprijungta." before connecting — MetaMask is never asked', async () => {
    const metamask = installMetamask();
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(1));
    await expect(result.current.signMessage()).rejects.toThrow('MetaMask piniginė neprijungta.');
    expect(metamask.callsTo('personal_sign')).toEqual([]);
  });


  it('refuses the same way when no MetaMask was found', async () => {
    const { result } = renderWallet();
    await expect(result.current.signMessage()).rejects.toThrow('MetaMask piniginė neprijungta.');
  });


  it("passes MetaMask's refusal through when the student declines to sign", async () => {
    installMetamask({ connected: true }).decline('personal_sign');
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(3));
    await expect(result.current.signMessage()).rejects.toMatchObject({ code: 4001, message: USER_REJECTED });
  });
});







// -----------------------------------------------------------
// The balance poll
// -----------------------------------------------------------
//
// eth_chainId + eth_getBalance every second while connected
// with an expected chain: a BigInt of wei on the right chain,
// null on any other, the chain written back, balanceFailed
// when MetaMask's RPC rejects.
// -----------------------------------------------------------

describe('The balance poll', () => {

  it('reads the connected account\'s balance on the faucet chain as a BigInt of wei', async () => {
    const metamask = installMetamask({ connected: true, balance: 1234567890123456789n });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.balance).toBe(1234567890123456789n));
    expect(result.current.balanceFailed).toBe(false);
    expect(metamask.callsTo('eth_getBalance')[0].params).toEqual([f.STUDENT_EVM, 'latest']);
  });


  it('repolls every second, so coins that arrive show up without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const metamask = installMetamask({ connected: true, balance: ETH });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.balance).toBe(ETH));

    metamask.setBalance(ETH + ETH / 5n);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(result.current.balance).toBe(ETH + ETH / 5n));
  });


  it('reports null on another chain and never asks for a balance there', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET });
    const { result } = renderWallet();
    await waitFor(() => expect(metamask.callsTo('eth_chainId').length).toBeGreaterThanOrEqual(2));
    await settle();
    expect(result.current.balance).toBeNull();
    expect(result.current.step).toBe(2);
    expect(metamask.callsTo('eth_getBalance')).toEqual([]);
  });


  it('writes the chain back on every tick — a silent switch inside MetaMask still moves the step', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const metamask = installMetamask({ connected: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.balance).not.toBeNull());

    metamask.changeChain(MAINNET, { silently: true });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(result.current.step).toBe(2));
    expect(result.current.chainId).toBe(MAINNET);
    expect(result.current.balance).toBeNull();
  });


  it('a failing eth_getBalance is balanceFailed, not an endless wait', async () => {
    installMetamask({ connected: true }).fail('eth_getBalance', rpcError(-32603, 'Internal JSON-RPC error.'));
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.balanceFailed).toBe(true));
    expect(result.current.balance).toBeNull();
    expect(result.current.step).toBe(3);
  });


  it('recovers on the next tick once the RPC answers again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installMetamask({ connected: true, balance: 2n * ETH }).fail('eth_getBalance', rpcError(-32603, 'Internal JSON-RPC error.'), { once: true });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.balanceFailed).toBe(true));

    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(result.current.balance).toBe(2n * ETH));
    expect(result.current.balanceFailed).toBe(false);
  });


  it('polls nothing before the wallet is connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const metamask = installMetamask();
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.step).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(metamask.callsTo('eth_getBalance')).toEqual([]);
    expect(metamask.callsTo('eth_chainId')).toHaveLength(1);
  });


  it('asks for the new account\'s balance after an account switch', async () => {
    const metamask = installMetamask({ connected: true, accounts: [f.STUDENT_EVM, OTHER_ACCOUNT] });
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.balance).not.toBeNull());
    act(() => metamask.changeAccounts([OTHER_ACCOUNT]));
    await waitFor(() => expect(metamask.callsTo('eth_getBalance').some((call) => call.params[0] === OTHER_ACCOUNT)).toBe(true));
  });
});

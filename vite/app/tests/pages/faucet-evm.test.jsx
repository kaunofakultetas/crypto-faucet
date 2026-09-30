// -----------------------------------------------------------
//  [*] Tests — EVM faucet page (route /faucet/evm/:network)
//
//  The native-coin faucet end to end against the backend
//  double and the MetaMask double: the skeleton, the catalog's
//  error card, an unknown (or hostile) :network; the title, the
//  numbers (the chunk, the faucet's balance and its 3 s poll,
//  the student's MetaMask balance — "Kraunama…", a dash, the
//  three-decimal rounding of wei), the return address with its
//  QR code and the graph shortcut; the four-step flow — no
//  MetaMask (and the Phantom squatter), connecting, declining,
//  a popup already open, a wrong chain switched, added (4902)
//  or refused, a late MetaMask; the student's own moves inside
//  MetaMask while on the page (chain, a silent switch, account,
//  a disconnected site, a dead RPC); the claim — the signed
//  nonce and the request it rides on, the success and the
//  refreshed balance, the backend's refusals word for word
//  (cooldown 429, empty faucet 503, 400, 403, 500), a dropped
//  connection, a declined signature, a double click, a network
//  switch mid-claim; and the backend contract matrices for
//  /api/evm/networks, /api/evm/:network/faucet-balance and the
//  payout's failure answers.
//
//  Every test gets a fresh copy of the page and its wallet
//  hook (vi.resetModules) — the hook caches the first MetaMask
//  it hears for the life of its module.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { renderPage } from '../support/render';
import { server, given, url } from '../support/backend/server';
import { describeEndpointContract, settle, VARIANTS } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import {
  installMetamask, installPhantomEvm, rpcError,
  MAINNET, SEPOLIA, HOODI, OTHER_ACCOUNT, ETH, SIGNATURE, USER_REJECTED,
} from '../support/wallets/metamask';


const CLAIM_MESSAGE = 'Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ';
const SUCCESS = 'Ethereum Sepolia išsiųstas į jūsų piniginę.';
const STATE_WORDS = /^(atlikta|dabartinis žingsnis|dar neatlikta)$/;

// The payout's answers when something between the page and the
// backend breaks — the contract matrix's failure variants
const FAILURES = VARIANTS.filter((variant) => variant.expect === 'failed').map((variant) => variant.name);


// A fresh page (and wallet hook) per test
let FaucetEVM;

beforeEach(async () => {
  vi.resetModules();
  ({ default: FaucetEVM } = await import('@/pages/Faucet_EVM/Page'));
});







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderEvmFaucet mounts the page on its route pattern;
// renderWithRoutes adds what surrounds it in the app — the
// picker's links (a network switch keeps the page mounted,
// as in the navbar) and the graph route behind the shortcut.
// valueOf reads a balance row by its label. freezePolls fakes
// ONLY setInterval — the pages' polls stand still until the
// test advances them, while requests, user-event and findBy*
// (which re-checks on DOM changes) run on real time; under it
// the tests wait on the screen, never on a call count.
// -----------------------------------------------------------

const renderEvmFaucet = (network = 'sepolia') =>
  renderPage(<FaucetEVM />, { route: `/faucet/evm/${network}`, path: '/faucet/evm/:network' });

function GraphPage() {
  const { network } = useParams();
  return <p>Transakcijų srauto puslapis: {network}</p>;
}

function Picker() {
  return (
    <nav aria-label="Tinklai">
      <Link to="/faucet/evm/sepolia">Sepolia</Link>
      <Link to="/faucet/evm/hoodi">Hoodi</Link>
    </nav>
  );
}

const renderWithRoutes = (network = 'sepolia') => renderPage(
  <Routes>
    <Route path="/faucet/evm/:network" element={<><Picker /><FaucetEVM /></>} />
    <Route path="/graph/:network" element={<GraphPage />} />
  </Routes>,
  { route: `/faucet/evm/${network}` },
);

const pageLoaded = (name = 'Ethereum Sepolia') => screen.findByRole('heading', { level: 1, name: `${name} faucet'as` });
const claimButton = (name = 'Ethereum Sepolia') => screen.findByRole('button', { name: `Gauti ${name} valiutos` });
const switchButton = (name = 'Ethereum Sepolia') => screen.findByRole('button', { name: `Persijungti į ${name} tinklą` });

const valueOf = (label) => screen.getByText(label).nextElementSibling;
const walletBalance = () => valueOf('Jūsų MetaMask balansas:');
const currentStep = () => document.querySelector('[aria-current="step"]');
const stepStates = () => screen.getAllByText(STATE_WORDS).map((word) => word.textContent);

const freezePolls = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

// The page's three faces — loaded, loading, its error card —
// one of them must always be up
const pageStands = () => screen.queryByRole('heading', { level: 1 })
  ?? screen.queryByRole('status')
  ?? screen.queryByText(/^(Nepavyko gauti tinklų sąrašo|Nežinomas tinklas)/);

async function claim(user, name) {
  await user.click(await claimButton(name));
}







// -----------------------------------------------------------
// Loading, the catalog and unknown networks
// -----------------------------------------------------------

describe('Loading, the catalog and unknown networks', () => {

  it('shows the skeleton, with a status for assistive tech, while the network list loads', async () => {
    given.hang('get', '/api/evm/networks');
    renderEvmFaucet();
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('Kraunami tinklo duomenys…');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });


  it('keeps the skeleton up until the faucet balance has arrived too', async () => {
    const networks = given.capture('get', '/api/evm/networks', f.evmNetworks);
    given.hang('get', '/api/evm/:network/faucet-balance');
    renderEvmFaucet();
    await waitFor(() => expect(networks).toHaveLength(1));
    await settle(100);
    expect(screen.getByRole('status')).toHaveTextContent('Kraunami tinklo duomenys…');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });


  it('says so in an error card when the network list cannot be fetched — and asks for no balance', async () => {
    given.error('get', '/api/evm/networks', 'Vidinė serverio klaida', 500);
    const balances = given.capture('get', '/api/evm/:network/faucet-balance', f.evmBalance());
    renderEvmFaucet();
    expect(await screen.findByText('Nepavyko gauti tinklų sąrašo. Perkraukite puslapį.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(balances).toEqual([]);
  });


  it('says "Nežinomas tinklas: …" for a network the catalog does not know — no balance asked, MetaMask never prompted', async () => {
    const metamask = installMetamask();
    const balances = given.capture('get', '/api/evm/:network/faucet-balance', f.evmBalance());
    renderEvmFaucet('solana');
    expect(await screen.findByText('Nežinomas tinklas: solana')).toBeInTheDocument();
    await settle();
    expect(balances).toEqual([]);
    expect(metamask.methods().filter((method) => !['eth_accounts', 'eth_chainId'].includes(method))).toEqual([]);
  });


  it('shows a hostile :network as text in the error card', async () => {
    renderEvmFaucet('%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    expect(await screen.findByText('Nežinomas tinklas: <img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });


  it('asks for the faucet balance of the network in the URL', async () => {
    const balances = given.capture('get', '/api/evm/:network/faucet-balance', f.evmBalance());
    renderEvmFaucet('hoodi');
    await pageLoaded('Ethereum Hoodi');
    expect(balances[0].url).toBe(url('/api/evm/hoodi/faucet-balance'));
  });
});







// -----------------------------------------------------------
// The page — title, numbers, return address
// -----------------------------------------------------------

describe('The page — title, numbers, return address', () => {

  it("titles the page with the network's icon and name and says what it is for", async () => {
    renderEvmFaucet();
    const title = await pageLoaded();
    expect(title.querySelector('img')).toHaveAttribute('src', '/api/icons/evm/sepolia');
    expect(title.nextElementSibling).toHaveTextContent('Šiuo įrankiu galite gauti Ethereum Sepolia testinės kriptovaliutos laboratoriniams darbams.');
  });


  it("shows the amount per claim and the faucet's balance to three decimals in the network's short name", async () => {
    renderEvmFaucet();
    await pageLoaded();
    expect(valueOf('Išsiųsime jums:')).toHaveTextContent('0.200 SepETH');
    expect(valueOf('Čiaupo balansas:')).toHaveTextContent('41.604 SepETH');
  });


  it("uses each network's own short name — ETH on Hoodi, an empty faucet reading 0.000", async () => {
    given.json('get', '/api/evm/:network/faucet-balance', { ...f.evmBalance(), balance: 0, chunk_size: 0.05 });
    renderEvmFaucet('hoodi');
    await pageLoaded('Ethereum Hoodi');
    expect(valueOf('Išsiųsime jums:')).toHaveTextContent('0.050 ETH');
    expect(valueOf('Čiaupo balansas:')).toHaveTextContent('0.000 ETH');
  });


  it('shows the return address in lower case next to its QR code', async () => {
    given.json('get', '/api/evm/:network/faucet-balance', { ...f.evmBalance(), address: '0x87EFE7dfB3b49162385bbE36ec0F3E5f3b41ed7D' });
    renderEvmFaucet();
    await pageLoaded();
    expect(screen.getByText(/Grąžinkite nebereikalingą/)).toHaveTextContent(`Grąžinkite nebereikalingą SepETH krypto atgal:${f.FAUCET_EVM}`);
    expect(screen.queryByText(/0x87EFE7/)).toBeNull();
    expect(document.querySelector('svg[width="128"][height="128"]')).not.toBeNull();
  });


  it('opens the transaction graph of this network from "Transakcijų srautas"', async () => {
    const { user } = renderWithRoutes();
    await pageLoaded();
    await user.click(screen.getByRole('button', { name: 'Transakcijų srautas' }));
    expect(await screen.findByText('Transakcijų srauto puslapis: sepolia')).toBeInTheDocument();
  });


  it('offers no graph for a network without an explorer', async () => {
    renderEvmFaucet('arbitrumSepolia');
    await pageLoaded('Arbitrum Sepolia');
    expect(screen.queryByRole('button', { name: 'Transakcijų srautas' })).toBeNull();
  });
});







// -----------------------------------------------------------
// The MetaMask flow
// -----------------------------------------------------------
//
// install → connect → switch network → claim: the stepper,
// the gate button and what each refusal tells the student.
// -----------------------------------------------------------

describe('The MetaMask flow', () => {

  it('without MetaMask: the install step, the download link, "Piniginė neprijungta" and no claim', async () => {
    renderEvmFaucet();
    await pageLoaded();
    expect(currentStep()).toHaveTextContent('Susidiegti MetaMask');
    expect(stepStates()).toEqual(['dabartinis žingsnis', 'dar neatlikta', 'dar neatlikta', 'dar neatlikta']);
    expect(screen.getByRole('link', { name: 'Susidiegti MetaMask' })).toHaveAttribute('href', 'https://metamask.io/download/');
    expect(walletBalance()).toHaveTextContent('Piniginė neprijungta');
    expect(screen.queryByRole('button', { name: /^Gauti/ })).toBeNull();
  });


  it('takes Phantom squatting on window.ethereum for no MetaMask at all', async () => {
    const phantom = installPhantomEvm({ connected: true, announce: false });
    renderEvmFaucet();
    await pageLoaded();
    expect(screen.getByRole('link', { name: 'Susidiegti MetaMask' })).toBeInTheDocument();
    expect(phantom.calls).toEqual([]);
  });


  it('with MetaMask but the site not connected: the connect step and "Prijungti piniginę"', async () => {
    installMetamask();
    renderEvmFaucet();
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Prijungti MetaMask');
    expect(walletBalance()).toHaveTextContent('Piniginė neprijungta');
  });


  it('connects: on the faucet chain the flow reaches the claim, with the MetaMask balance', async () => {
    const metamask = installMetamask();
    const { user } = renderEvmFaucet();
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await claimButton()).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Atsisiųsti Ethereum Sepolia');
    expect(stepStates()).toEqual(['atlikta', 'atlikta', 'atlikta', 'dabartinis žingsnis']);
    expect(await screen.findByText('1.500 SepETH')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prijungti piniginę' })).toBeNull();
    expect(metamask.callsTo('eth_requestAccounts')).toHaveLength(1);
  });


  it('goes straight to the claim when the site is already connected on the faucet chain — no popup', async () => {
    const metamask = installMetamask({ connected: true });
    renderEvmFaucet();
    expect(await claimButton()).toBeInTheDocument();
    expect(metamask.callsTo('eth_requestAccounts')).toEqual([]);
  });


  it("shows MetaMask's words when the student declines to connect, and stays on the connect step", async () => {
    installMetamask().decline('eth_requestAccounts');
    const { user } = renderEvmFaucet();
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(USER_REJECTED);
    expect(screen.getByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Prijungti MetaMask');
  });


  it("passes on MetaMask's \"already pending\" when the connect popup is still open, and connects once it is approved", async () => {
    const metamask = installMetamask();
    const popup = metamask.hold('eth_requestAccounts');
    const { user } = renderEvmFaucet();
    const connect = await screen.findByRole('button', { name: 'Prijungti piniginę' });
    await user.click(connect);
    await user.click(connect);
    expect(await screen.findByRole('alert')).toHaveTextContent("Request of type 'wallet_requestPermissions' already pending for origin http://localhost:3000. Please wait.");
    await act(async () => popup.release());
    expect(await claimButton()).toBeInTheDocument();
  });


  it('on another chain: the switch step, and the switch lands on the claim', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET });
    const { user } = renderEvmFaucet();
    const button = await switchButton();
    expect(currentStep()).toHaveTextContent('Įsijungti Ethereum Sepolia tinklą');
    expect(walletBalance()).toHaveTextContent('Piniginė neprijungta');
    await user.click(button);
    expect(await claimButton()).toBeInTheDocument();
    expect(metamask.chainId).toBe(SEPOLIA);
    expect(await screen.findByText('1.500 SepETH')).toBeInTheDocument();
  });


  it('adds a chain MetaMask does not know from /api/evm/networks (4902), then switches to it', async () => {
    const metamask = installMetamask({ connected: true });
    const { user } = renderEvmFaucet('hoodi');
    await user.click(await switchButton('Ethereum Hoodi'));
    expect(await claimButton('Ethereum Hoodi')).toBeInTheDocument();
    expect(metamask.added).toEqual([{
      chainId: '0x88bb0',
      chainName: 'Ethereum Hoodi',
      nativeCurrency: { decimals: 18, name: 'Ethereum', symbol: 'ETH' },
      rpcUrls: ['https://rpc.hoodi.ethpandaops.io'],
      blockExplorerUrls: ['https://light-hoodi.beaconcha.in'],
    }]);
    expect(metamask.chainId).toBe(HOODI);
  });


  it('tells the student they declined the switch — "Nepavyko persijungti į tinklą: …" — and keeps the switch step', async () => {
    installMetamask({ connected: true, chainId: MAINNET }).decline('wallet_switchEthereumChain');
    const { user } = renderEvmFaucet();
    await user.click(await switchButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(`Nepavyko persijungti į tinklą: ${USER_REJECTED}`);
    expect(await switchButton()).toBeInTheDocument();
  });


  it('tells the student they declined adding the chain — "Nepavyko pridėti tinklo: …"', async () => {
    installMetamask({ connected: true }).decline('wallet_addEthereumChain');
    const { user } = renderEvmFaucet('hoodi');
    await user.click(await switchButton('Ethereum Hoodi'));
    expect(await screen.findByRole('alert')).toHaveTextContent(`Nepavyko pridėti tinklo: ${USER_REJECTED}`);
  });


  it('tells the student MetaMask stayed on the old chain — "Tinklas dar neįjungtas — …"', async () => {
    installMetamask({ connected: true, chainId: MAINNET }).answer('wallet_switchEthereumChain', () => null);
    const { user } = renderEvmFaucet();
    await user.click(await switchButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Tinklas dar neįjungtas — paspauskite mygtuką dar kartą arba perjunkite tinklą MetaMask lange.');
    expect(await switchButton()).toBeInTheDocument();
  });


  it('picks up a MetaMask that announces itself after the page has loaded', async () => {
    const metamask = installMetamask({ announce: false });
    renderEvmFaucet();
    await pageLoaded();
    expect(screen.getByRole('link', { name: 'Susidiegti MetaMask' })).toBeInTheDocument();
    act(() => metamask.announce());
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Susidiegti MetaMask' })).toBeNull();
  });
});







// -----------------------------------------------------------
// The student's moves inside MetaMask while on the page
// -----------------------------------------------------------

describe("The student's moves inside MetaMask while on the page", () => {

  it('a chain switch inside MetaMask brings the switch step back; switching back restores the claim', async () => {
    const metamask = installMetamask({ connected: true });
    renderEvmFaucet();
    await claimButton();
    act(() => metamask.changeChain(MAINNET));
    expect(await switchButton()).toBeInTheDocument();
    expect(walletBalance()).toHaveTextContent('Piniginė neprijungta');
    expect(screen.queryByRole('button', { name: 'Gauti Ethereum Sepolia valiutos' })).toBeNull();
    act(() => metamask.changeChain(SEPOLIA));
    expect(await claimButton()).toBeInTheDocument();
  });


  it('catches a silent chain switch (no chainChanged) on the next balance tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const metamask = installMetamask({ connected: true });
    renderEvmFaucet();
    await claimButton();
    metamask.changeChain(MAINNET, { silently: true });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(await switchButton()).toBeInTheDocument();
  });


  it("an account switch shows the new account's balance and claims for it", async () => {
    const payouts = given.capture('get', '/api/evm/:network/request', f.evmPayout());
    const metamask = installMetamask({ connected: true, accounts: [f.STUDENT_EVM, OTHER_ACCOUNT] })
      .answer('eth_getBalance', ([address]) => `0x${(address === OTHER_ACCOUNT ? 2n * ETH : ETH).toString(16)}`);
    const { user } = renderEvmFaucet();
    expect(await screen.findByText('1.000 SepETH')).toBeInTheDocument();

    act(() => metamask.changeAccounts([OTHER_ACCOUNT]));
    expect(await screen.findByText('2.000 SepETH')).toBeInTheDocument();
    await claim(user);
    await screen.findByText(SUCCESS);
    expect(payouts[0].query.address).toBe(OTHER_ACCOUNT);
    expect(metamask.signed[0].address).toBe(OTHER_ACCOUNT);
  });


  it('disconnecting the site inside MetaMask goes back to "Prijungti piniginę"', async () => {
    const metamask = installMetamask({ connected: true });
    renderEvmFaucet();
    await claimButton();
    act(() => metamask.changeAccounts([]));
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(walletBalance()).toHaveTextContent('Piniginė neprijungta');
  });


  it('a disconnect event changes nothing on screen, and a balance read that then fails shows a dash', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const metamask = installMetamask({ connected: true });
    renderEvmFaucet();
    expect(await screen.findByText('1.500 SepETH')).toBeInTheDocument();

    const disconnected = rpcError(4900, 'The provider is disconnected from all chains.');
    act(() => metamask.emit('disconnect', disconnected));
    metamask.fail('eth_getBalance', disconnected);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(walletBalance().textContent).toBe('-'));
    expect(await claimButton()).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The MetaMask balance row
// -----------------------------------------------------------
//
// Wei as a BigInt, cut to micro-ether before the float sees
// it, three decimals; "Kraunama…" while in flight, a dash when
// MetaMask's RPC fails, and a poll every second.
// -----------------------------------------------------------

describe('The MetaMask balance row', () => {

  it('says "Kraunama…" while the first balance read is in flight', async () => {
    installMetamask({ connected: true }).hold('eth_getBalance');
    renderEvmFaucet();
    await claimButton();
    expect(walletBalance()).toHaveTextContent('Kraunama…');
  });


  it("shows a dash when MetaMask's RPC fails the balance read", async () => {
    installMetamask({ connected: true }).fail('eth_getBalance', rpcError(-32603, 'Internal JSON-RPC error.'));
    renderEvmFaucet();
    await claimButton();
    await waitFor(() => expect(walletBalance().textContent).toBe('-'));
  });


  it.each([
    [0n, '0.000 SepETH'],
    [1n, '0.000 SepETH'],
    [ETH / 1000n, '0.001 SepETH'],
    [1234567890123456789n, '1.235 SepETH'],
    [123456789012345678901234n, '123456.789 SepETH'],
  ])('shows %s wei as "%s"', async (wei, text) => {
    installMetamask({ connected: true, balance: wei });
    renderEvmFaucet();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });


  it('follows the balance as coins arrive — the MetaMask poll every second', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const metamask = installMetamask({ connected: true, balance: ETH });
    renderEvmFaucet();
    expect(await screen.findByText('1.000 SepETH')).toBeInTheDocument();
    metamask.setBalance(ETH + ETH / 5n);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(await screen.findByText('1.200 SepETH')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Claiming
// -----------------------------------------------------------
//
// Sign, send, tell: GET /api/evm/<network>/request with the
// address, the signature and its nonce; the outcome as an
// alert under the button.
// -----------------------------------------------------------

describe('Claiming', () => {

  it('signs the claim message and sends the address, the signature and its nonce to /api/evm/<network>/request', async () => {
    const payouts = given.capture('get', '/api/evm/:network/request', f.evmPayout());
    const metamask = installMetamask({ connected: true });
    const { user } = renderEvmFaucet();
    await claim(user);
    await screen.findByText(SUCCESS);

    expect(payouts).toHaveLength(1);
    const { nonce } = payouts[0].query;
    expect(payouts[0].url.startsWith(url('/api/evm/sepolia/request?'))).toBe(true);
    expect(payouts[0].query).toEqual({ address: f.STUDENT_EVM, signature: SIGNATURE, nonce });
    expect(metamask.signed).toEqual([{ message: `${CLAIM_MESSAGE}${nonce}`, raw: expect.any(String), address: f.STUDENT_EVM }]);
  });


  it('tells the student the coins are on the way and frees the button for the next claim', async () => {
    installMetamask({ connected: true });
    const { user } = renderEvmFaucet();
    await claim(user);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(SUCCESS);
    expect(within(alert).getByTestId('SuccessOutlinedIcon')).toBeInTheDocument();
    expect(await claimButton()).toHaveAttribute('aria-disabled', 'false');
  });


  it("refreshes the faucet's balance right after a successful claim, before the next poll", async () => {
    freezePolls();
    let paid = false;
    given.capture('get', '/api/evm/:network/request', () => { paid = true; return f.evmPayout(); });
    const balances = given.capture('get', '/api/evm/:network/faucet-balance', () => (paid ? { ...f.evmBalance(), balance: 41.4 } : f.evmBalance()));
    installMetamask({ connected: true });
    const { user } = renderEvmFaucet();
    expect(await screen.findByText('41.604 SepETH')).toBeInTheDocument();

    await claim(user);
    expect(await screen.findByText('41.400 SepETH')).toBeInTheDocument();
    expect(balances).toHaveLength(2);
  });


  it('sends one claim for a double click — the busy button refuses the pointer and ignores a second click', async () => {
    const payouts = given.capture('get', '/api/evm/:network/request', f.evmPayout());
    const metamask = installMetamask({ connected: true });
    const signature = metamask.hold('personal_sign');
    const { user } = renderEvmFaucet();
    await claim(user);

    const busy = await screen.findByRole('button', { name: 'Siunčiama…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await expect(user.click(busy)).rejects.toThrow(/pointer-events: none/);
    fireEvent.click(busy);
    await act(async () => signature.release());

    await screen.findByText(SUCCESS);
    expect(metamask.callsTo('personal_sign')).toHaveLength(1);
    expect(payouts).toHaveLength(1);
  });


  it.each([
    ['the cooldown (429)', 429, f.COOLDOWN_MESSAGE],
    ['an empty faucet (503)', 503, f.EMPTY_FAUCET_MESSAGE],
    ['a wallet that already has enough (400)', 400, 'Jūsų piniginėje jau yra pakankamai SepETH.'],
    ['a signature from another wallet (403)', 403, 'Parašas neatitinka nurodyto adreso. Prijunkite tą pačią piniginę ir bandykite dar kartą.'],
    ['a transaction that failed to send (500)', 500, 'Nepavyko išsiųsti transakcijos. Bandykite dar kartą.'],
  ])("shows the backend's refusal word for word — %s — and frees the button", async (_, status, message) => {
    given.error('get', '/api/evm/:network/request', message, status);
    installMetamask({ connected: true });
    const { user } = renderEvmFaucet();
    await claim(user);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(within(alert).getByTestId('ErrorOutlineIcon')).toBeInTheDocument();
    expect(await claimButton()).toHaveAttribute('aria-disabled', 'false');
  });


  it('is ready for another try after a dropped connection', async () => {
    given.networkError('get', '/api/evm/:network/request');
    installMetamask({ connected: true });
    const { user } = renderEvmFaucet();
    await claim(user);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await claimButton()).toHaveAttribute('aria-disabled', 'false');
  });


  it.fails('explains a dropped connection in Lithuanian — PINNED KNOWN BUG: the alert shows axios\'s English "Network Error"; the page\'s Lithuanian fallback is unreachable', async () => {
    given.networkError('get', '/api/evm/:network/request');
    installMetamask({ connected: true });
    const { user } = renderEvmFaucet();
    await claim(user);
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Nepavyko išsiųsti kriptovaliutos/);
  });


  it.fails('explains a proxy\'s error page in Lithuanian — PINNED KNOWN BUG: the alert shows axios\'s English "Request failed with status code 502"', async () => {
    given.html('get', '/api/evm/:network/request');
    installMetamask({ connected: true });
    const { user } = renderEvmFaucet();
    await claim(user);
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Nepavyko išsiųsti kriptovaliutos/);
  });


  it("shows MetaMask's words when the student declines to sign — and asks the backend for nothing", async () => {
    const payouts = given.capture('get', '/api/evm/:network/request', f.evmPayout());
    installMetamask({ connected: true }).decline('personal_sign');
    const { user } = renderEvmFaucet();
    await claim(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(USER_REJECTED);
    expect(payouts).toEqual([]);
    expect(await claimButton()).toHaveAttribute('aria-disabled', 'false');
  });


  it("drops a claim's late answer after a network switch and leaves the new network's button free", async () => {
    let answer = null;
    server.use(http.get(url('/api/evm/:network/request'), () => new Promise((resolve) => { answer = resolve; })));
    const metamask = installMetamask({ connected: true, chains: [MAINNET, SEPOLIA, HOODI] });
    const { user } = renderWithRoutes();
    await claim(user);
    expect(await screen.findByRole('button', { name: 'Siunčiama…' })).toBeInTheDocument();
    await waitFor(() => expect(answer).not.toBeNull());

    await user.click(screen.getByRole('link', { name: 'Hoodi' }));
    await pageLoaded('Ethereum Hoodi');
    act(() => metamask.changeChain(HOODI));
    expect(await claimButton('Ethereum Hoodi')).toHaveAttribute('aria-busy', 'false');

    await act(async () => answer(HttpResponse.json(f.evmPayout())));
    await settle(100);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await claimButton('Ethereum Hoodi')).toHaveAttribute('aria-disabled', 'false');
  });


  it('shows the claim still in flight — and its answer — when the student comes back to its network', async () => {
    let answer = null;
    server.use(http.get(url('/api/evm/:network/request'), () => new Promise((resolve) => { answer = resolve; })));
    installMetamask({ connected: true });
    const { user } = renderWithRoutes();
    await claim(user);
    await waitFor(() => expect(answer).not.toBeNull());

    await user.click(screen.getByRole('link', { name: 'Hoodi' }));
    await pageLoaded('Ethereum Hoodi');
    await user.click(screen.getByRole('link', { name: 'Sepolia' }));
    expect(await screen.findByRole('button', { name: 'Siunčiama…' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => answer(HttpResponse.json(f.evmPayout())));
    expect(await screen.findByText(SUCCESS)).toBeInTheDocument();
    expect(await claimButton()).toHaveAttribute('aria-disabled', 'false');
  });


  it('drops a late refusal after a network switch too', async () => {
    let answer = null;
    server.use(http.get(url('/api/evm/:network/request'), () => new Promise((resolve) => { answer = resolve; })));
    installMetamask({ connected: true });
    const { user } = renderWithRoutes();
    await claim(user);
    await waitFor(() => expect(answer).not.toBeNull());

    await user.click(screen.getByRole('link', { name: 'Hoodi' }));
    await pageLoaded('Ethereum Hoodi');
    await act(async () => answer(HttpResponse.json({ error: f.COOLDOWN_MESSAGE }, { status: 429 })));
    await settle(100);
    expect(screen.queryByText(f.COOLDOWN_MESSAGE)).toBeNull();
  });


  it('clears the outcome alerts when the student picks another network', async () => {
    given.error('get', '/api/evm/:network/request', f.COOLDOWN_MESSAGE, 429);
    installMetamask({ connected: true });
    const { user } = renderWithRoutes();
    await claim(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(f.COOLDOWN_MESSAGE);
    await user.click(screen.getByRole('link', { name: 'Hoodi' }));
    await pageLoaded('Ethereum Hoodi');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});







// -----------------------------------------------------------
// The faucet balance poll
// -----------------------------------------------------------
//
// Every 3 s once the network is known; a failed repoll keeps
// the last number; a network switch never shows the previous
// chain's numbers. The polls are frozen and advanced by hand.
// -----------------------------------------------------------

describe('The faucet balance poll', () => {

  it("repolls the faucet's balance every 3 s and shows the new number", async () => {
    freezePolls();
    let polls = 0;
    const balances = given.capture('get', '/api/evm/:network/faucet-balance', () => {
      polls += 1;
      return polls === 1 ? f.evmBalance() : { ...f.evmBalance(), balance: 40 };
    });
    renderEvmFaucet();
    expect(await screen.findByText('41.604 SepETH')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2999));
    await settle(50);
    expect(balances).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(await screen.findByText('40.000 SepETH')).toBeInTheDocument();
    expect(balances).toHaveLength(2);
  });


  it('keeps the last number on screen when a repoll fails', async () => {
    freezePolls();
    let polls = 0;
    server.use(http.get(url('/api/evm/:network/faucet-balance'), () => {
      polls += 1;
      return polls === 1
        ? HttpResponse.json(f.evmBalance())
        : HttpResponse.json({ error: 'Nepavyko gauti čiaupo balanso' }, { status: 500 });
    }));
    renderEvmFaucet();
    expect(await screen.findByText('41.604 SepETH')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(3000));
    await settle(100);
    expect(polls).toBe(2);
    expect(screen.getByText('41.604 SepETH')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });


  it("never shows the previous network's numbers after a network switch", async () => {
    const { user } = renderWithRoutes();
    expect(await screen.findByText('41.604 SepETH')).toBeInTheDocument();
    given.hang('get', '/api/evm/:network/faucet-balance');
    await user.click(screen.getByRole('link', { name: 'Hoodi' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Kraunami tinklo duomenys…');
    expect(screen.queryByText(/SepETH/)).toBeNull();
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// The network list (catalog error card, skeleton), the
// faucet balance (the skeleton is all the page has — its
// failures and malformed bodies are pinned below) and the
// payout's failure answers, which must reach the student as
// an alert under the button.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/evm/networks',
  fixture: f.evmNetworks,
  render: () => renderEvmFaucet(),
  chrome: pageStands,
  loaded: async () => { await pageLoaded(); },
  failed: async () => { await screen.findByText('Nepavyko gauti tinklų sąrašo. Perkraukite puslapį.'); },
  loading: () => screen.getByRole('status'),
});


const BALANCE_NEVER_ARRIVES = 'a faucet balance that never arrives keeps the skeleton up forever — no error is ever shown (the UTXO page says "Nepavyko gauti čiaupo informacijos")';
const BALANCE_CRASH = 'a balance answer without a string `address` crashes the page — faucetInfo.address.toLowerCase() in FaucetEVM';

describeEndpointContract({
  path: '/api/evm/:network/faucet-balance',
  fixture: f.evmBalance(),
  render: () => renderEvmFaucet(),
  chrome: pageStands,
  loaded: async () => { await screen.findByText('41.604 SepETH'); },
  failed: async () => { await screen.findByText(/^Nepavyko/, {}, { timeout: 1500 }); },
  loading: () => screen.getByRole('status'),
  pins: {
    ...Object.fromEntries(FAILURES.map((name) => [name, BALANCE_NEVER_ARRIVES])),
    'a JSON string → page survives': BALANCE_CRASH,
    'a JSON number → page survives': BALANCE_CRASH,
    'wrong container (object for a list, list for an object) → page survives': BALANCE_CRASH,
    'every field missing → page survives': BALANCE_CRASH,
    'every leaf null → page survives': BALANCE_CRASH,
    'types swapped (numbers as strings, strings as numbers) → page survives': BALANCE_CRASH,
  },
});


describeEndpointContract({
  path: '/api/evm/:network/request',
  fixture: f.evmPayout(),
  only: FAILURES,
  render: () => {
    installMetamask({ connected: true });
    const { user } = renderEvmFaucet();
    claimButton().then((button) => user.click(button)).catch(() => {});
  },
  chrome: () => screen.getByRole('heading', { level: 1, name: "Ethereum Sepolia faucet'as" }),
  failed: async () => {
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toBe('');
    expect(within(alert).getByTestId('ErrorOutlineIcon')).toBeInTheDocument();
    expect(await claimButton()).toHaveAttribute('aria-disabled', 'false');
  },
});

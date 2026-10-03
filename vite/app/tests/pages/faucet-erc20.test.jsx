// -----------------------------------------------------------
//  [*] Tests — ERC-20 faucet page (route /faucet/erc20/:token)
//
//  The token faucet end to end against the backend double and
//  the MetaMask double: the skeleton, an unknown (or hostile)
//  :token and the backend's other failures (a 4xx stops the
//  polling, a 5xx recovers), an answer the page cannot be
//  built from (the error card, never a crash); the title, one
//  claim card per deployment (its chain, the amount, the
//  faucet balance or a dash, the contract with its copy
//  button, the "piniginėje" chip), a token deployed nowhere,
//  the return address; the five-step flow — install, connect,
//  a TOKEN chain (the switch target, a chain MetaMask must add
//  from the deployment), gas (wallet_native_wei against
//  min_native_wei, the notice card with its links to the
//  native faucets, fail-open when an amount is unknown or
//  unreadable) and the claim; claiming on one chain — the
//  signed request, the outcome inside the card that was
//  pressed (a payout with its transaction linked on that
//  chain's explorer, a 200 that names none), the reload, every
//  button waiting while one claim is in flight, the backend's
//  refusals word for word, a dropped connection and a proxy's
//  error page in Lithuanian, a declined signature; "Rodyti
//  MetaMask" (wallet_watchAsset, the hop to that chain first,
//  every refusal in its card); the student's moves inside
//  MetaMask (a lost chain read and an unannounced switch
//  repaired by the chain tick); the 10 s poll; a token switch
//  (a claim's state and outcomes stay with its token); and the
//  backend contract matrices for /api/erc20/token/:symbol
//  (with and without a connected wallet) and the payout's
//  failure answers.
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
  installMetamask, rpcError,
  MAINNET, SEPOLIA, HOODI, OTHER_ACCOUNT, SIGNATURE, USER_REJECTED,
} from '../support/wallets/metamask';


const CLAIM_MESSAGE = 'Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ';
const SUCCESS = '5 LINK išsiųsta! Jei piniginėje jų nesimato — spauskite „Rodyti MetaMask“.';
const STATE_WORDS = /^(atlikta|dabartinis žingsnis|dar neatlikta)$/;

// The payout's transaction, and the page's own sentences for
// a failed claim and a token it could not read
const TX_HASH = f.erc20Payout().transaction_hash;
const CLAIM_FAILED = 'Nepavyko išsiųsti žetonų.';
const TOKEN_FAILED = 'Nepavyko gauti žetono informacijos.';
const MALFORMED = 'Serveris atsakė netinkamo formato duomenimis.';

// The ERC-20 backend's own refusals (erc20_faucet.py)
const TOKEN_COOLDOWN = 'Žetonai jums jau išsiųsti. Daugiau galėsite pasiimti už 3500 sek.';
const TOKEN_FAUCET_EMPTY = 'Čiaupas nebeturi žetonų. Praneškite dėstytojui.';
const NO_GAS_REFUSAL = "Piniginėje per mažai SepETH tinklo mokesčiams (reikia bent 0.1 SepETH). Pirmiausia pasiimkite jų iš Ethereum Sepolia faucet'o.";

// Native balances against the fixture's min_native_wei (0.1)
const MIN = '100000000000000000';
const RICH = '41603571384332010457';
const POOR = '50000000000000000';

const SEPOLIA_CONTRACT = '0x779877A7B0D9E8603169DdbD7836e478b4624789';
const HOODI_CONTRACT = '0x5f1e8a2b9c4d7e0f3a6b9c2d5e8f1a4b7c0d3e6f';

// LINK on a second chain, shaped like the fixture's deployment
const HOODI_DEPLOYMENT = {
  network: 'hoodi',
  chain_id: HOODI,
  chain_name: f.evmNetworksMap.hoodi.chain_name,
  full_name: f.evmNetworksMap.hoodi.full_name,
  short_name: f.evmNetworksMap.hoodi.short_name,
  icon: f.evmNetworksMap.hoodi.icon,
  native_currency: f.evmNetworksMap.hoodi.native_currency,
  rpc_urls: f.evmNetworksMap.hoodi.rpc_urls,
  block_explorer_urls: f.evmNetworksMap.hoodi.block_explorer_urls,
  contract_address: HOODI_CONTRACT,
  balance: 90.5,
};

const FAILURES = VARIANTS.filter((variant) => variant.expect === 'failed').map((variant) => variant.name);


// A fresh page (and wallet hook) per test
let FaucetERC20;

beforeEach(async () => {
  vi.resetModules();
  ({ default: FaucetERC20 } = await import('@/pages/Faucet_ERC20/Page'));
});







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// serveToken answers GET /api/erc20/token/:symbol the way the
// backend does for the asking ?address= — the chains the
// token is on (the fixture's sepolia deployment, plus hoodi),
// the wallet's native balance per chain (RICH unless `gas`
// says otherwise, null without an address) and any per-chain
// `patch` — and returns the call record. cardOf finds a
// chain's card: the chain's name heads it (the name, its row,
// the card); payoutAlert finds a success alert — in one card,
// or anywhere — by the sentence that opens it. freezePolls
// fakes ONLY setInterval, like the EVM page test: the 10 s
// poll and the wallet's chain tick stand still until
// advanced, while requests and findBy* run on real time.
// -----------------------------------------------------------

function serveToken({ chains = ['sepolia'], gas = {}, patch = {} } = {}) {
  return given.capture('get', '/api/erc20/token/:symbol', ({ params, query }) => {
    const address = query.get('address');
    const token = f.erc20Token(params.symbol, address);
    const byNetwork = { sepolia: token.deployments[0], hoodi: { ...token.deployments[0], ...HOODI_DEPLOYMENT } };
    return {
      ...token,
      deployments: chains.map((network) => ({
        ...byNetwork[network],
        wallet_native_wei: address ? (network in gas ? gas[network] : RICH) : null,
        ...patch[network],
      })),
    };
  });
}

const renderTokenFaucet = (symbol = 'LINK') =>
  renderPage(<FaucetERC20 />, { route: `/faucet/erc20/${symbol}`, path: '/faucet/erc20/:token' });

function NativeFaucet() {
  const { network } = useParams();
  return <p>Vietinės valiutos čiaupas: {network}</p>;
}

function Picker() {
  return (
    <nav aria-label="Žetonai">
      <Link to="/faucet/erc20/LINK">LINK</Link>
      <Link to="/faucet/erc20/FOLD">FOLD</Link>
    </nav>
  );
}

const renderWithRoutes = (symbol = 'LINK') => renderPage(
  <Routes>
    <Route path="/faucet/erc20/:token" element={<><Picker /><FaucetERC20 /></>} />
    <Route path="/faucet/evm/:network" element={<NativeFaucet />} />
  </Routes>,
  { route: `/faucet/erc20/${symbol}` },
);

const pageLoaded = (name = 'Chainlink') => screen.findByRole('heading', { level: 1, name: `${name} faucet'as` });

const cardOf = (fullName) => screen.getByText(fullName, { selector: 'span' }).parentElement.parentElement;
const valueIn = (card, label) => within(card).getByText(label).nextElementSibling;
const claimIn = (card, symbol = 'LINK') => within(card).getByRole('button', { name: `Gauti ${symbol}` });
const showIn = (card) => within(card).getByRole('button', { name: 'Rodyti MetaMask' });
const payoutAlert = async (card) =>
  (await (card ? within(card) : screen).findByText(SUCCESS, { exact: false })).closest('[role="alert"]');

const currentStep = () => document.querySelector('[aria-current="step"]');
const stepStates = () => screen.getAllByText(STATE_WORDS).map((word) => word.textContent);
const connectedLine = () => screen.queryByText(/^Prijungta piniginė:/);

const freezePolls = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

// The claim step is reached once the connected wallet's line
// shows and the card's claim button is enabled
async function readyToClaim(fullName = 'Ethereum Sepolia') {
  await waitFor(() => expect(connectedLine()).not.toBeNull());
  await waitFor(() => expect(claimIn(cardOf(fullName))).toBeEnabled());
  return cardOf(fullName);
}

// The page's three faces — loaded, loading, its error card
// (the backend's sentence, or the page's with the reason)
const pageStands = () => screen.queryByRole('heading', { level: 1 })
  ?? screen.queryByRole('status')
  ?? screen.queryByText(/^(Nepavyko gauti žetono informacijos\. |Nepalaikomas žetonas|Vidinė serverio klaida|Nerasta|Nepalaikomas tinklas)/);







// -----------------------------------------------------------
// Loading and the backend's failures
// -----------------------------------------------------------

describe("Loading and the backend's failures", () => {

  it('shows the skeleton, with a status for assistive tech, while the token loads', async () => {
    given.hang('get', '/api/erc20/token/:symbol');
    renderTokenFaucet();
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('Kraunami tinklo duomenys…');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });


  it("asks for the token in the URL — without an address while no wallet is connected", async () => {
    const calls = serveToken();
    renderTokenFaucet('FOLD');
    await pageLoaded('Interfold');
    expect(calls[0].url).toBe(url('/api/erc20/token/FOLD'));
    expect(calls[0].query).toEqual({});
  });


  it("shows the backend's refusal of an unknown token — \"Nepalaikomas žetonas: DOGE\" — and stops asking", async () => {
    freezePolls();
    let asked = 0;
    server.use(http.get(url('/api/erc20/token/:symbol'), ({ params }) => {
      asked += 1;
      return HttpResponse.json({ error: `Nepalaikomas žetonas: ${params.symbol}` }, { status: 400 });
    }));
    renderTokenFaucet('DOGE');
    expect(await screen.findByText('Nepalaikomas žetonas: DOGE')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(60000));
    await settle(100);
    expect(asked).toBe(1);
  });


  it('shows a hostile :token as text', async () => {
    renderTokenFaucet('%3Cimg%20src%3Dx%3E');
    expect(await screen.findByText('Nepalaikomas žetonas: <img src=x>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });


  it('says the token could not be read for want of a connection when the backend cannot be reached', async () => {
    given.networkError('get', '/api/erc20/token/:symbol');
    renderTokenFaucet();
    expect(await screen.findByText(`${TOKEN_FAILED} Patikrinkite interneto ryšį.`)).toBeInTheDocument();
  });


  it("says the status a proxy's error page answered with", async () => {
    given.html('get', '/api/erc20/token/:symbol');
    renderTokenFaucet();
    expect(await screen.findByText(`${TOKEN_FAILED} Serveris grąžino klaidą (502).`)).toBeInTheDocument();
  });


  it.each([
    ['a bare string', 'netikėtas atsakymas'],
    ['a number', 42],
    ['a list', [f.erc20Token('LINK')]],
    ['JSON null', null],
    ['an empty object', {}],
    ['a token without its deployments', { ...f.erc20Token('LINK'), deployments: undefined }],
    ['deployments that are no list', { ...f.erc20Token('LINK'), deployments: { sepolia: f.erc20Token('LINK').deployments[0] } }],
    ['a deployment that is null', { ...f.erc20Token('LINK'), deployments: [null] }],
    ['a token that is a bare string', { ...f.erc20Token('LINK'), token: 'LINK' }],
  ])('says a token answer that is %s came in the wrong shape — never a crash, never an endless skeleton', async (_, body) => {
    given.json('get', '/api/erc20/token/:symbol', body);
    renderTokenFaucet();
    expect(await screen.findByText(`${TOKEN_FAILED} ${MALFORMED}`)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });


  it('keeps asking after an answer it cannot use — the token shows once the backend sends it whole', async () => {
    freezePolls();
    given.sequence('get', '/api/erc20/token/:symbol', [
      { body: { token: f.erc20Token('LINK').token } },
      { body: f.erc20Token('LINK') },
    ]);
    renderTokenFaucet();
    expect(await screen.findByText(`${TOKEN_FAILED} ${MALFORMED}`)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(await pageLoaded()).toBeInTheDocument();
  });


  it("shows a 5xx's own message and keeps asking — the page recovers once the backend is back", async () => {
    freezePolls();
    given.sequence('get', '/api/erc20/token/:symbol', [
      { status: 500, body: { error: 'Vidinė serverio klaida' } },
      { body: f.erc20Token('LINK') },
    ]);
    renderTokenFaucet();
    expect(await screen.findByText('Vidinė serverio klaida')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(await pageLoaded()).toBeInTheDocument();
  });


  it('keeps the token on screen when a repoll fails', async () => {
    freezePolls();
    let asked = 0;
    server.use(http.get(url('/api/erc20/token/:symbol'), () => {
      asked += 1;
      return asked === 1 ? HttpResponse.json(f.erc20Token('LINK')) : HttpResponse.error();
    }));
    renderTokenFaucet();
    await pageLoaded();
    await act(() => vi.advanceTimersByTimeAsync(10000));
    await settle(100);
    expect(asked).toBe(2);
    expect(screen.getByRole('heading', { level: 1, name: "Chainlink faucet'as" })).toBeInTheDocument();
    expect(screen.queryByText(/^Nepavyko gauti žetono informacijos/)).toBeNull();
  });
});







// -----------------------------------------------------------
// The page — title, chain cards, return address
// -----------------------------------------------------------

describe('The page — title, chain cards, return address', () => {

  it("titles the page with the token's icon and name and says what it is for", async () => {
    renderTokenFaucet();
    const title = await pageLoaded();
    expect(title.querySelector('img')).toHaveAttribute('src', '/api/icons/erc20/LINK');
    expect(title.nextElementSibling).toHaveTextContent('Šiuo įrankiu galite gauti LINK ERC-20 testinių žetonų laboratoriniams darbams. Tas pats žetonas veikia keliuose tinkluose — pasirinkite, kuriame jo norite.');
  });


  it('shows one claim card per deployment: the chain, the amount, the faucet balance and the contract', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    renderTokenFaucet();
    await pageLoaded();

    const sepolia = cardOf('Ethereum Sepolia');
    expect(valueIn(sepolia, 'Išsiųsime jums:')).toHaveTextContent('5 LINK');
    expect(valueIn(sepolia, 'Čiaupo balansas:')).toHaveTextContent('145.000 LINK');
    expect(within(sepolia).getByText(SEPOLIA_CONTRACT)).toBeInTheDocument();
    expect(sepolia.querySelector('img')).toHaveAttribute('src', '/api/icons/evm/sepolia');

    const hoodi = cardOf('Ethereum Hoodi');
    expect(valueIn(hoodi, 'Čiaupo balansas:')).toHaveTextContent('90.500 LINK');
    expect(within(hoodi).getByText(HOODI_CONTRACT)).toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: 'Rodyti MetaMask' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Gauti LINK' })).toHaveLength(2);
  });


  it("shows a dash for a chain whose faucet balance the backend could not read", async () => {
    serveToken({ patch: { sepolia: { balance: null } } });
    renderTokenFaucet();
    await pageLoaded();
    expect(valueIn(cardOf('Ethereum Sepolia'), 'Čiaupo balansas:')).toHaveTextContent('—');
  });


  it("says why under the dash, in the backend's words, when the backend sent the reason", async () => {
    const reason = 'Nepavyko gauti čiaupo LINK balanso: tinklo RPC serveris neatsakė per 10 s.';
    serveToken({ chains: ['sepolia', 'hoodi'], patch: { sepolia: { balance: null, balance_error: reason } } });
    renderTokenFaucet();
    await pageLoaded();
    expect(within(cardOf('Ethereum Sepolia')).getByText(reason)).toBeInTheDocument();
    expect(within(cardOf('Ethereum Hoodi')).queryByText(/^Nepavyko/)).toBeNull();
  });


  it("says, in the backend's words, that the gas check could not run on a chain", async () => {
    // The claim then goes ahead unchecked, so the student is told
    const reason = 'Nepavyko patikrinti jūsų piniginės balanso tinklo mokesčiams: nepavyko prisijungti prie tinklo RPC serverio.';
    serveToken({ patch: { sepolia: { wallet_native_wei: null, wallet_native_error: reason } } });
    installMetamask({ connected: true });
    renderTokenFaucet();
    await pageLoaded();
    expect(await within(cardOf('Ethereum Sepolia')).findByText(reason)).toBeInTheDocument();
  });


  it.each([
    ['a numeric string', '145'],
    ['a word', 'daug'],
    ['an object', { amount: 145 }],
  ])('shows a dash, not a crash, for a faucet balance sent as %s — the other cards unharmed', async (_, balance) => {
    serveToken({ chains: ['sepolia', 'hoodi'], patch: { sepolia: { balance } } });
    renderTokenFaucet();
    await pageLoaded();
    expect(valueIn(cardOf('Ethereum Sepolia'), 'Čiaupo balansas:')).toHaveTextContent('—');
    expect(valueIn(cardOf('Ethereum Hoodi'), 'Čiaupo balansas:')).toHaveTextContent('90.500 LINK');
  });


  it('says so when the token is deployed nowhere yet', async () => {
    serveToken({ chains: [] });
    installMetamask({ connected: true });
    renderTokenFaucet();
    expect(await screen.findByText('Šis žetonas kol kas nėra įdiegtas jokiame tinkle.')).toBeInTheDocument();
    expect(screen.getByText('Įsijungti tinklą')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gauti LINK' })).toBeNull();
  });


  it('shows the return address for every chain next to its QR code', async () => {
    renderTokenFaucet();
    await pageLoaded();
    expect(screen.getByText(/Grąžinkite nebereikalingus/)).toHaveTextContent(`Grąžinkite nebereikalingus LINK žetonus atgal:${f.FAUCET_EVM}`);
    expect(document.querySelector('svg[width="128"][height="128"]')).not.toBeNull();
  });


  it('copies a contract address — the button says "Nukopijuota!" for a moment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderTokenFaucet();
    await pageLoaded();
    const card = cardOf('Ethereum Sepolia');
    await user.click(within(card).getByRole('button', { name: 'Kopijuoti adresą' }));
    expect(await navigator.clipboard.readText()).toBe(SEPOLIA_CONTRACT);
    expect(await within(card).findByRole('button', { name: 'Nukopijuota!' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(await within(card).findByRole('button', { name: 'Kopijuoti adresą' })).toBeInTheDocument();
  });


  it('leaves the address selectable, without a false "Nukopijuota!", when the clipboard refuses', async () => {
    const { user } = renderTokenFaucet();
    await pageLoaded();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard write denied'));
    const card = cardOf('Ethereum Sepolia');
    await user.click(within(card).getByRole('button', { name: 'Kopijuoti adresą' }));
    await settle();
    expect(within(card).getByRole('button', { name: 'Kopijuoti adresą' })).toBeInTheDocument();
    expect(within(card).getByText(SEPOLIA_CONTRACT)).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The five-step flow
// -----------------------------------------------------------
//
// install → connect → a token network → gas → claim. Being on
// ANY of the token's chains passes the network step; the gas
// step passes once one chain clears min_native_wei (an
// unknown balance fails open).
// -----------------------------------------------------------

describe('The five-step flow', () => {

  it('without MetaMask: the install step and its download link, every claim disabled', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    renderTokenFaucet();
    await pageLoaded();
    expect(currentStep()).toHaveTextContent('Susidiegti MetaMask');
    expect(stepStates()).toEqual(['dabartinis žingsnis', 'dar neatlikta', 'dar neatlikta', 'dar neatlikta', 'dar neatlikta']);
    expect(screen.getByRole('link', { name: 'Susidiegti MetaMask' })).toHaveAttribute('href', 'https://metamask.io/download/');
    screen.getAllByRole('button', { name: 'Gauti LINK' }).forEach((button) => expect(button).toBeDisabled());
    expect(connectedLine()).toBeNull();
  });


  it('with MetaMask but not connected: "Prijungti piniginę", and connecting asks the token again with the address', async () => {
    const calls = serveToken();
    installMetamask();
    const { user } = renderTokenFaucet();
    const connect = await screen.findByRole('button', { name: 'Prijungti piniginę' });
    expect(stepStates()).toEqual(['atlikta', 'dabartinis žingsnis', 'dar neatlikta', 'dar neatlikta', 'dar neatlikta']);
    expect(currentStep()).toHaveTextContent('Prijungti MetaMask');
    await user.click(connect);
    await readyToClaim();
    expect(calls.at(-1).query).toEqual({ address: f.STUDENT_EVM });
    expect(calls[0].query).toEqual({});
  });


  it('connected on a token chain with gas: the claim step, the wallet line, the "piniginėje" chip, the claim enabled', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    installMetamask({ connected: true });
    renderTokenFaucet();
    const sepolia = await readyToClaim();
    expect(currentStep()).toHaveTextContent('Atsisiųsti Chainlink žetoną');
    expect(stepStates()).toEqual(['atlikta', 'atlikta', 'atlikta', 'atlikta', 'dabartinis žingsnis']);
    expect(connectedLine()).toHaveTextContent(`Prijungta piniginė: ${f.STUDENT_EVM}`);
    expect(within(sepolia).getByText('piniginėje')).toBeInTheDocument();
    expect(within(cardOf('Ethereum Hoodi')).queryByText('piniginėje')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Persijungti/ })).toBeNull();
  });


  it('passes the network step on ANY token chain — the chip marks the one the wallet is on', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    installMetamask({ connected: true, chainId: HOODI });
    renderTokenFaucet();
    const hoodi = await readyToClaim('Ethereum Hoodi');
    expect(within(hoodi).getByText('piniginėje')).toBeInTheDocument();
    expect(within(cardOf('Ethereum Sepolia')).queryByText('piniginėje')).toBeNull();
    expect(screen.getByText('Įsijungti Ethereum Hoodi tinklą')).toBeInTheDocument();
  });


  it('on a chain the token is not on: the network step, whose button goes to the first chain with gas', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'], gas: { sepolia: POOR, hoodi: RICH } });
    installMetamask({ connected: true, chainId: MAINNET });
    renderTokenFaucet();
    expect(await screen.findByRole('button', { name: 'Persijungti į Ethereum Hoodi tinklą' })).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Įsijungti Ethereum Hoodi tinklą');
    screen.getAllByRole('button', { name: 'Gauti LINK' }).forEach((button) => expect(button).toBeDisabled());
  });


  it('with no chain holding gas the network step goes to the first chain', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'], gas: { sepolia: POOR, hoodi: POOR } });
    installMetamask({ connected: true, chainId: MAINNET });
    renderTokenFaucet();
    expect(await screen.findByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' })).toBeInTheDocument();
  });


  it('switches to a token chain MetaMask does not know by adding it from the deployment (4902), then claims there', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'], gas: { sepolia: POOR, hoodi: RICH } });
    const metamask = installMetamask({ connected: true, chainId: MAINNET });
    const { user } = renderTokenFaucet();
    await user.click(await screen.findByRole('button', { name: 'Persijungti į Ethereum Hoodi tinklą' }));
    const hoodi = await readyToClaim('Ethereum Hoodi');
    expect(metamask.added).toEqual([{
      chainId: '0x88bb0',
      chainName: 'Ethereum Hoodi',
      nativeCurrency: { decimals: 18, name: 'Ethereum', symbol: 'ETH' },
      rpcUrls: ['https://rpc.hoodi.ethpandaops.io'],
      blockExplorerUrls: ['https://light-hoodi.beaconcha.in'],
    }]);
    expect(within(hoodi).getByText('piniginėje')).toBeInTheDocument();
    // Sepolia still lacks gas — its claim stays disabled
    expect(claimIn(cardOf('Ethereum Sepolia'))).toBeDisabled();
  });


  it("shows a refused switch in the gate card with MetaMask's words", async () => {
    installMetamask({ connected: true, chainId: MAINNET }).decline('wallet_switchEthereumChain');
    const { user } = renderTokenFaucet();
    await user.click(await screen.findByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Nepavyko persijungti į tinklą: ${USER_REJECTED}`);
    expect(within(cardOf('Ethereum Sepolia')).queryByRole('alert')).toBeNull();
  });


  it("shows a refused connect in the gate card with MetaMask's words", async () => {
    installMetamask().decline('eth_requestAccounts');
    const { user } = renderTokenFaucet();
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(USER_REJECTED);
    expect(within(cardOf('Ethereum Sepolia')).queryByRole('alert')).toBeNull();
  });


  it('stops at the gas step when no chain has enough native coin: the notice links every native faucet with its minimum', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'], gas: { sepolia: POOR, hoodi: '0' } });
    installMetamask({ connected: true });
    const { user } = renderWithRoutes();
    expect(await screen.findByText('Trūksta tinklo kriptovaliutos')).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Gauti tinklo valiutos');
    expect(screen.getByText(/Žetonų gavimas nieko nekainuoja/)).toHaveTextContent('Žetonų gavimas nieko nekainuoja, bet norint juos panaudoti reikės tinklo kriptovaliutos mokesčiams. Pirmiausia jos pasiimkite:');

    const toSepolia = screen.getByRole('link', { name: "Ethereum Sepolia faucet'as" });
    expect(toSepolia).toHaveAttribute('href', '/faucet/evm/sepolia');
    expect(toSepolia.parentElement).toHaveTextContent("Ethereum Sepolia faucet'as— reikia bent 0.1 SepETH");
    expect(screen.getByRole('link', { name: "Ethereum Hoodi faucet'as" }).parentElement).toHaveTextContent('— reikia bent 0.1 ETH');

    screen.getAllByRole('button', { name: 'Gauti LINK' }).forEach((button) => expect(button).toBeDisabled());
    expect(screen.queryByRole('button', { name: /^(Prijungti|Persijungti)/ })).toBeNull();

    await user.click(toSepolia);
    expect(await screen.findByText('Vietinės valiutos čiaupas: sepolia')).toBeInTheDocument();
  });


  it('shows the gas pump on the gas step', async () => {
    serveToken({ gas: { sepolia: POOR } });
    installMetamask({ connected: true });
    renderTokenFaucet();
    await screen.findByText('Trūksta tinklo kriptovaliutos');
    const gasStep = screen.getAllByText(STATE_WORDS)[3];
    expect(gasStep).toHaveTextContent('dabartinis žingsnis');
    expect(within(gasStep.parentElement).getByTestId('LocalGasStationIcon')).toBeInTheDocument();
  });


  it('passes the gas step with gas on one chain — the chain without keeps its claim disabled, and no notice shows', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'], gas: { sepolia: RICH, hoodi: POOR } });
    installMetamask({ connected: true });
    renderTokenFaucet();
    await readyToClaim();
    await waitFor(() => expect(claimIn(cardOf('Ethereum Hoodi'))).toBeDisabled());
    expect(screen.queryByText('Trūksta tinklo kriptovaliutos')).toBeNull();
    expect(currentStep()).toHaveTextContent('Atsisiųsti Chainlink žetoną');
  });


  it('counts exactly the minimum as enough', async () => {
    serveToken({ gas: { sepolia: MIN } });
    installMetamask({ connected: true });
    renderTokenFaucet();
    await readyToClaim();
    expect(screen.queryByText('Trūksta tinklo kriptovaliutos')).toBeNull();
  });


  it('fails open on an unknown native balance — the claim is enabled and the backend decides', async () => {
    serveToken({ gas: { sepolia: null } });
    installMetamask({ connected: true });
    renderTokenFaucet();
    await readyToClaim();
    expect(screen.queryByText('Trūksta tinklo kriptovaliutos')).toBeNull();
  });


  it.each([
    ['a fraction', '0.05'],
    ['a word', 'daug'],
    ['a bare number', 50000000000000000],
    ['a negative amount', '-1'],
  ])('fails open the same way on a native balance it cannot read — %s — never a crash', async (_, wei) => {
    serveToken({ gas: { sepolia: wei } });
    installMetamask({ connected: true });
    renderTokenFaucet();
    await readyToClaim();
    expect(screen.queryByText('Trūksta tinklo kriptovaliutos')).toBeNull();
    expect(currentStep()).toHaveTextContent('Atsisiųsti Chainlink žetoną');
  });


  it('fails open on a minimum it cannot read — the claim is enabled', async () => {
    serveToken({ gas: { sepolia: POOR }, patch: { sepolia: { min_native_wei: 'daug' } } });
    installMetamask({ connected: true });
    renderTokenFaucet();
    await readyToClaim();
    expect(screen.queryByText('Trūksta tinklo kriptovaliutos')).toBeNull();
  });


  it('asks for no gas on a chain without min_native_wei', async () => {
    serveToken({ gas: { sepolia: '0' }, patch: { sepolia: { min_native_wei: undefined } } });
    installMetamask({ connected: true });
    renderTokenFaucet();
    await readyToClaim();
  });


  it('names ETH in the notice when the deployment carries no native currency', async () => {
    serveToken({ gas: { sepolia: POOR }, patch: { sepolia: { native_currency: null } } });
    installMetamask({ connected: true });
    renderTokenFaucet();
    const link = await screen.findByRole('link', { name: "Ethereum Sepolia faucet'as" });
    expect(link.parentElement).toHaveTextContent('— reikia bent 0.1 ETH');
  });
});







// -----------------------------------------------------------
// Claiming a token
// -----------------------------------------------------------
//
// Sign, then GET /api/erc20/<network>/<symbol>/request on the
// chain whose button was pressed; the outcome inside that
// card — a payout with its transaction, linked on that
// chain's block explorer; every claim button waits while one
// is in flight.
// -----------------------------------------------------------

describe('Claiming a token', () => {

  it('signs the claim message and sends the address, the signature and its nonce to /api/erc20/<network>/LINK/request', async () => {
    const payouts = given.capture('get', '/api/erc20/:network/:symbol/request', f.erc20Payout());
    const metamask = installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    await payoutAlert(card);

    expect(payouts).toHaveLength(1);
    const { nonce } = payouts[0].query;
    expect(payouts[0].url.startsWith(url('/api/erc20/sepolia/LINK/request?'))).toBe(true);
    expect(payouts[0].query).toEqual({ address: f.STUDENT_EVM, signature: SIGNATURE, nonce });
    expect(metamask.signed).toEqual([{ message: `${CLAIM_MESSAGE}${nonce}`, raw: expect.any(String), address: f.STUDENT_EVM }]);
  });


  it("claims on the chain whose button was pressed, whatever chain the wallet is on, and tells the student in that card — the transaction on that chain's explorer", async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    const payouts = given.capture('get', '/api/erc20/:network/:symbol/request', f.erc20Payout('LINK', 'hoodi'));
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    await readyToClaim();
    const hoodi = cardOf('Ethereum Hoodi');
    await user.click(claimIn(hoodi));

    const alert = await within(hoodi).findByRole('alert');
    expect(alert.textContent).toBe(`${SUCCESS} Transakcija: ${TX_HASH}`);
    expect(within(alert).getByTestId('SuccessOutlinedIcon')).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: TX_HASH })).toHaveAttribute('href', `https://light-hoodi.beaconcha.in/tx/${TX_HASH}`);
    expect(payouts[0].params).toEqual({ network: 'hoodi', symbol: 'LINK' });
    expect(within(cardOf('Ethereum Sepolia')).queryByRole('alert')).toBeNull();
  });


  it("links the transaction to its page on the chain's block explorer, opened in a new tab", async () => {
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    const alert = await payoutAlert(card);
    expect(alert.textContent).toBe(`${SUCCESS} Transakcija: ${TX_HASH}`);
    const link = within(alert).getByRole('link', { name: TX_HASH });
    expect(link).toHaveAttribute('href', `https://sepolia.etherscan.io/tx/${TX_HASH}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });


  it('names the transaction as plain text on a chain without an explorer configured', async () => {
    serveToken({ patch: { sepolia: { block_explorer_urls: [] } } });
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    const alert = await payoutAlert(card);
    expect(alert.textContent).toBe(`${SUCCESS} Transakcija: ${TX_HASH}`);
    expect(within(alert).queryByRole('link')).toBeNull();
  });


  it.each([
    ['no transaction id', { message: 'LINK sent successfully', amount: 5.0, token: 'LINK', network: 'sepolia' }],
    ['a null transaction id', { ...f.erc20Payout(), transaction_hash: null }],
    ['a numeric transaction id', { ...f.erc20Payout(), transaction_hash: 12345 }],
    ['an empty transaction id', { ...f.erc20Payout(), transaction_hash: '' }],
    ['a bare string for a body', 'LINK sent successfully'],
    ['JSON null for a body', null],
  ])('reports a 200 with %s as a failed claim inside the card, not a payout', async (_, body) => {
    given.json('get', '/api/erc20/:network/:symbol/request', body);
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    const alert = await within(card).findByRole('alert');
    expect(alert.textContent).toBe(CLAIM_FAILED);
    expect(within(alert).getByTestId('ErrorOutlineIcon')).toBeInTheDocument();
    await waitFor(() => expect(claimIn(cardOf('Ethereum Sepolia'))).not.toHaveAttribute('aria-disabled'));
  });


  it("reloads the token right after a successful claim, so the faucet's balance drops at once", async () => {
    freezePolls();
    let paid = false;
    given.capture('get', '/api/erc20/:network/:symbol/request', () => { paid = true; return f.erc20Payout(); });
    given.capture('get', '/api/erc20/token/:symbol', ({ query }) => {
      const token = f.erc20Token('LINK', query.get('address'));
      return { ...token, deployments: [{ ...token.deployments[0], balance: paid ? 140 : 145 }] };
    });
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    expect(valueIn(card, 'Čiaupo balansas:')).toHaveTextContent('145.000 LINK');
    await user.click(claimIn(card));
    await waitFor(() => expect(valueIn(cardOf('Ethereum Sepolia'), 'Čiaupo balansas:')).toHaveTextContent('140.000 LINK'));
  });


  it('makes every claim button wait while one claim is in flight — and a second click sends nothing', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    const payouts = given.capture('get', '/api/erc20/:network/:symbol/request', f.erc20Payout());
    const metamask = installMetamask({ connected: true });
    const signature = metamask.hold('personal_sign');
    const { user } = renderTokenFaucet();
    const sepolia = await readyToClaim();
    await user.click(claimIn(sepolia));

    const busy = await within(sepolia).findByRole('button', { name: 'Siunčiama…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    const other = claimIn(cardOf('Ethereum Hoodi'));
    expect(other).toHaveAttribute('aria-disabled', 'true');
    expect(other).toHaveAttribute('aria-busy', 'false');

    await expect(user.click(busy)).rejects.toThrow(/pointer-events: none/);
    fireEvent.click(busy);
    fireEvent.click(other);
    await act(async () => signature.release());

    await payoutAlert(sepolia);
    expect(metamask.callsTo('personal_sign')).toHaveLength(1);
    expect(payouts).toHaveLength(1);
    expect(claimIn(cardOf('Ethereum Hoodi'))).not.toHaveAttribute('aria-disabled');
  });


  it.each([
    ['the cooldown (429)', 429, TOKEN_COOLDOWN],
    ['an empty token faucet (503)', 503, TOKEN_FAUCET_EMPTY],
    ["a cooldown worded like the native faucets' (429)", 429, f.COOLDOWN_MESSAGE],
    ["an empty faucet worded like the native faucets' (503)", 503, f.EMPTY_FAUCET_MESSAGE],
    ['a wallet without gas (400)', 400, NO_GAS_REFUSAL],
    ['a wallet that already has enough (400)', 400, 'Jūsų piniginėje jau yra pakankamai LINK.'],
    ['a signature from another wallet (403)', 403, 'Parašas neatitinka nurodyto adreso. Prijunkite tą pačią piniginę ir bandykite dar kartą.'],
  ])("shows the backend's refusal word for word inside the card — %s — and frees the buttons", async (_, status, message) => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    given.error('get', '/api/erc20/:network/:symbol/request', message, status);
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(claimIn(card));

    const alert = await within(card).findByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(within(alert).getByTestId('ErrorOutlineIcon')).toBeInTheDocument();
    expect(within(cardOf('Ethereum Hoodi')).queryByRole('alert')).toBeNull();
    expect(claimIn(cardOf('Ethereum Sepolia'))).not.toHaveAttribute('aria-disabled');
  });


  it('is ready for another try after a dropped connection', async () => {
    given.networkError('get', '/api/erc20/:network/:symbol/request');
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    expect(await within(card).findByRole('alert')).toBeInTheDocument();
    expect(claimIn(cardOf('Ethereum Sepolia'))).toBeEnabled();
  });


  it("explains a dropped connection in Lithuanian inside the card — the page's own sentence and a word about the connection", async () => {
    given.networkError('get', '/api/erc20/:network/:symbol/request');
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    expect((await within(card).findByRole('alert')).textContent).toBe(`${CLAIM_FAILED} Patikrinkite interneto ryšį.`);
  });


  it("explains a proxy's error page in Lithuanian inside the card — the page's own sentence and the status it answered with", async () => {
    given.html('get', '/api/erc20/:network/:symbol/request');
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    expect((await within(card).findByRole('alert')).textContent).toBe(`${CLAIM_FAILED} Serveris grąžino klaidą (502).`);
  });


  it("shows MetaMask's words in the card when the student declines to sign — and asks the backend for nothing", async () => {
    const payouts = given.capture('get', '/api/erc20/:network/:symbol/request', f.erc20Payout());
    installMetamask({ connected: true }).decline('personal_sign');
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    expect(await within(card).findByRole('alert')).toHaveTextContent(USER_REJECTED);
    expect(payouts).toEqual([]);
  });


  it('claims for the account the wallet has now', async () => {
    const payouts = given.capture('get', '/api/erc20/:network/:symbol/request', f.erc20Payout());
    const metamask = installMetamask({ connected: true, accounts: [f.STUDENT_EVM, OTHER_ACCOUNT] });
    const { user } = renderTokenFaucet();
    await readyToClaim();
    act(() => metamask.changeAccounts([OTHER_ACCOUNT]));
    await waitFor(() => expect(connectedLine()).toHaveTextContent(OTHER_ACCOUNT));
    await user.click(claimIn(cardOf('Ethereum Sepolia')));
    await payoutAlert();
    expect(payouts[0].query.address).toBe(OTHER_ACCOUNT);
  });
});







// -----------------------------------------------------------
// "Rodyti MetaMask" — importing the token
// -----------------------------------------------------------
//
// Hop to the card's chain when the wallet is elsewhere, then
// wallet_watchAsset with that chain's contract; every refusal
// lands in the card.
// -----------------------------------------------------------

describe('"Rodyti MetaMask" — importing the token', () => {

  it("on the wallet's own chain: imports the token at once — the contract, the symbol and the decimals", async () => {
    const metamask = installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(showIn(card));
    await waitFor(() => expect(metamask.watched).toHaveLength(1));
    expect(metamask.watched[0]).toEqual({ type: 'ERC20', options: { address: SEPOLIA_CONTRACT, symbol: 'LINK', decimals: 18 } });
    expect(metamask.callsTo('wallet_switchEthereumChain')).toEqual([]);
    expect(within(card).queryByRole('alert')).toBeNull();
  });


  it("on another chain: switches there first (adding it when MetaMask does not know it), then imports that chain's contract", async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    const metamask = installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    await readyToClaim();
    await user.click(showIn(cardOf('Ethereum Hoodi')));
    await waitFor(() => expect(metamask.watched).toHaveLength(1));

    expect(metamask.methods().filter((m) => m.startsWith('wallet_'))).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'wallet_watchAsset']);
    expect(metamask.watched[0].options).toEqual({ address: HOODI_CONTRACT, symbol: 'LINK', decimals: 18 });
    expect(metamask.chainId).toBe(HOODI);
    expect(await within(cardOf('Ethereum Hoodi')).findByText('piniginėje')).toBeInTheDocument();
  });


  it("hops first when MetaMask's chain read failed — an unknown chain is never taken for the card's", async () => {
    // The chain tick would repair the read on its own a second
    // later — frozen, so the student's click comes first
    freezePolls();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metamask = installMetamask({ connected: true })
      .fail('eth_chainId', rpcError(-32603, 'Disconnected from MetaMask background.'), { once: true });
    const { user } = renderTokenFaucet();
    await screen.findByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' });
    const card = cardOf('Ethereum Sepolia');
    expect(within(card).queryByText('piniginėje')).toBeNull();

    await user.click(showIn(card));
    await waitFor(() => expect(metamask.watched).toHaveLength(1));
    expect(metamask.methods().filter((m) => m.startsWith('wallet_'))).toEqual(['wallet_switchEthereumChain', 'wallet_watchAsset']);
    expect(await within(cardOf('Ethereum Sepolia')).findByText('piniginėje')).toBeInTheDocument();
  });


  it('works before connecting — importing a token needs no account', async () => {
    const metamask = installMetamask();
    const { user } = renderTokenFaucet();
    await screen.findByRole('button', { name: 'Prijungti piniginę' });
    await waitFor(() => expect(metamask.callsTo('eth_chainId')).toHaveLength(1));
    await user.click(showIn(cardOf('Ethereum Sepolia')));
    await waitFor(() => expect(metamask.watched).toHaveLength(1));
  });


  it('says "Pirmiausia įsidiekite MetaMask." inside that card without MetaMask', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    const { user } = renderTokenFaucet();
    await pageLoaded();
    await user.click(showIn(cardOf('Ethereum Hoodi')));
    expect(await within(cardOf('Ethereum Hoodi')).findByRole('alert')).toHaveTextContent('Pirmiausia įsidiekite MetaMask.');
    expect(within(cardOf('Ethereum Sepolia')).queryByRole('alert')).toBeNull();
  });


  it("shows MetaMask's words inside the card when the student declines the import", async () => {
    installMetamask({ connected: true }).decline('wallet_watchAsset');
    const { user } = renderTokenFaucet();
    const card = await readyToClaim();
    await user.click(showIn(card));
    expect(await within(card).findByRole('alert')).toHaveTextContent(USER_REJECTED);
  });


  it('shows a refused switch inside the card and imports nothing', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    const metamask = installMetamask({ connected: true, chains: [MAINNET, SEPOLIA, HOODI] }).decline('wallet_switchEthereumChain');
    const { user } = renderTokenFaucet();
    await readyToClaim();
    await user.click(showIn(cardOf('Ethereum Hoodi')));
    expect(await within(cardOf('Ethereum Hoodi')).findByRole('alert')).toHaveTextContent(`Nepavyko persijungti į tinklą: ${USER_REJECTED}`);
    expect(metamask.watched).toEqual([]);
  });


  it('shows a refused chain addition inside the card and imports nothing', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    const metamask = installMetamask({ connected: true }).decline('wallet_addEthereumChain');
    const { user } = renderTokenFaucet();
    await readyToClaim();
    await user.click(showIn(cardOf('Ethereum Hoodi')));
    expect(await within(cardOf('Ethereum Hoodi')).findByRole('alert')).toHaveTextContent(`Nepavyko pridėti tinklo: ${USER_REJECTED}`);
    expect(metamask.watched).toEqual([]);
  });
});







// -----------------------------------------------------------
// The student's moves inside MetaMask while on the page
// -----------------------------------------------------------

describe("The student's moves inside MetaMask while on the page", () => {

  it('lets the network step repair a failed first chain read — the switch finds MetaMask already there', async () => {
    // The chain tick would repair the read on its own a second
    // later (next test) — frozen, so the student's click comes
    // first
    freezePolls();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metamask = installMetamask({ connected: true })
      .fail('eth_chainId', rpcError(-32603, 'Disconnected from MetaMask background.'), { once: true });
    const { user } = renderTokenFaucet();
    const button = await screen.findByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' });
    expect(warn).toHaveBeenCalledWith('[metamask] eth_chainId failed', expect.anything());
    expect(claimIn(cardOf('Ethereum Sepolia'))).toBeDisabled();

    await user.click(button);
    await readyToClaim();
    expect(metamask.chainId).toBe(SEPOLIA);
    expect(metamask.added).toEqual([]);
  });


  it('repairs a failed first chain read on its own, as the balance tick does on the EVM page — the switch step goes, the claim opens', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installMetamask({ connected: true })
      .fail('eth_chainId', rpcError(-32603, 'Disconnected from MetaMask background.'), { once: true });
    renderTokenFaucet();
    await screen.findByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' });
    await act(() => vi.advanceTimersByTimeAsync(15000));
    await settle(100);
    expect(screen.queryByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' })).toBeNull();
    expect(claimIn(cardOf('Ethereum Sepolia'))).toBeEnabled();
  });


  it('catches a chain switch MetaMask did not announce (no chainChanged) on the next tick — the chip moves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveToken({ chains: ['sepolia', 'hoodi'] });
    const metamask = installMetamask({ connected: true, chains: [MAINNET, SEPOLIA, HOODI] });
    renderTokenFaucet();
    await readyToClaim();
    expect(within(cardOf('Ethereum Sepolia')).getByText('piniginėje')).toBeInTheDocument();

    metamask.changeChain(HOODI, { silently: true });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(await within(cardOf('Ethereum Hoodi')).findByText('piniginėje')).toBeInTheDocument();
    expect(within(cardOf('Ethereum Sepolia')).queryByText('piniginėje')).toBeNull();
  });


  it('an account switch asks the token again with the new address, keeping the cards on screen meanwhile', async () => {
    let answerOther = null;
    server.use(http.get(url('/api/erc20/token/:symbol'), ({ request }) => {
      const address = new URL(request.url).searchParams.get('address');
      if (address === OTHER_ACCOUNT) return new Promise((resolve) => { answerOther = resolve; });
      return HttpResponse.json(f.erc20Token('LINK', address));
    }));
    const metamask = installMetamask({ connected: true, accounts: [f.STUDENT_EVM, OTHER_ACCOUNT] });
    renderTokenFaucet();
    await readyToClaim();

    act(() => metamask.changeAccounts([OTHER_ACCOUNT]));
    await waitFor(() => expect(answerOther).not.toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: "Chainlink faucet'as" })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(cardOf('Ethereum Sepolia')).toBeInTheDocument();

    await act(async () => answerOther(HttpResponse.json(f.erc20Token('LINK', OTHER_ACCOUNT))));
    expect(await screen.findByText(OTHER_ACCOUNT)).toBeInTheDocument();
  });


  it('a chain switch inside MetaMask moves the chip; a chain the token is not on brings the network step back', async () => {
    serveToken({ chains: ['sepolia', 'hoodi'] });
    const metamask = installMetamask({ connected: true });
    renderTokenFaucet();
    await readyToClaim();

    act(() => metamask.changeChain(HOODI));
    expect(await within(cardOf('Ethereum Hoodi')).findByText('piniginėje')).toBeInTheDocument();
    expect(within(cardOf('Ethereum Sepolia')).queryByText('piniginėje')).toBeNull();

    act(() => metamask.changeChain(MAINNET));
    expect(await screen.findByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' })).toBeInTheDocument();
    expect(screen.queryByText('piniginėje')).toBeNull();
    screen.getAllByRole('button', { name: 'Gauti LINK' }).forEach((button) => expect(button).toBeDisabled());
  });


  it('disconnecting the site inside MetaMask brings "Prijungti piniginę" back and asks the token without an address', async () => {
    const calls = serveToken();
    const metamask = installMetamask({ connected: true });
    renderTokenFaucet();
    await readyToClaim();
    const asked = calls.length;

    act(() => metamask.changeAccounts([]));
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(connectedLine()).toBeNull();
    expect(claimIn(cardOf('Ethereum Sepolia'))).toBeDisabled();
    await waitFor(() => expect(calls.length).toBeGreaterThan(asked));
    expect(calls.at(-1).query).toEqual({});
  });
});







// -----------------------------------------------------------
// The token poll and a token switch
// -----------------------------------------------------------
//
// The 10 s poll, and the picker moving the page from LINK to
// FOLD without remounting it: the new token's skeleton, then
// its cards, while a LINK claim's state, answer and outcome
// rows stay with LINK.
// -----------------------------------------------------------

describe('The token poll and a token switch', () => {

  it('repolls the token every 10 s and shows the new balances', async () => {
    freezePolls();
    let asked = 0;
    const calls = given.capture('get', '/api/erc20/token/:symbol', () => {
      asked += 1;
      const token = f.erc20Token('LINK');
      return { ...token, deployments: [{ ...token.deployments[0], balance: asked === 1 ? 145 : 120.25 }] };
    });
    renderTokenFaucet();
    await pageLoaded();

    await act(() => vi.advanceTimersByTimeAsync(9999));
    await settle(50);
    expect(calls).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    await waitFor(() => expect(valueIn(cardOf('Ethereum Sepolia'), 'Čiaupo balansas:')).toHaveTextContent('120.250 LINK'));
    expect(calls).toHaveLength(2);
  });


  it("shows the skeleton on a token switch, never the previous token's rows", async () => {
    const { user } = renderWithRoutes();
    await pageLoaded();
    given.hang('get', '/api/erc20/token/:symbol');
    await user.click(screen.getByRole('link', { name: 'FOLD' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Kraunami tinklo duomenys…');
    expect(screen.queryByText(/Chainlink/)).toBeNull();
    expect(screen.queryByText(SEPOLIA_CONTRACT)).toBeNull();
  });


  it('shows the new token once it arrives', async () => {
    const { user } = renderWithRoutes();
    await pageLoaded();
    await user.click(screen.getByRole('link', { name: 'FOLD' }));
    expect(await pageLoaded('Interfold')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gauti FOLD' })).toBeInTheDocument();
  });


  it("keeps FOLD's claim buttons free while a LINK claim is still in flight", async () => {
    server.use(http.get(url('/api/erc20/:network/:symbol/request'), () => new Promise(() => {})));
    installMetamask({ connected: true });
    const { user } = renderWithRoutes();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    await within(card).findByRole('button', { name: 'Siunčiama…' });

    await user.click(screen.getByRole('link', { name: 'FOLD' }));
    await pageLoaded('Interfold');
    const fold = await screen.findByRole('button', { name: /^(Gauti FOLD|Siunčiama…)$/ });
    expect(fold).toHaveAccessibleName('Gauti FOLD');
    expect(fold).not.toHaveAttribute('aria-disabled');
  });


  it("drops a LINK claim's late answer after a switch to FOLD — nothing lands in FOLD's cards", async () => {
    let answer = null;
    server.use(http.get(url('/api/erc20/:network/:symbol/request'), () => new Promise((resolve) => { answer = resolve; })));
    installMetamask({ connected: true });
    const { user } = renderWithRoutes();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    await waitFor(() => expect(answer).not.toBeNull());

    await user.click(screen.getByRole('link', { name: 'FOLD' }));
    await pageLoaded('Interfold');
    await act(async () => answer(HttpResponse.json(f.erc20Payout())));
    await settle(100);
    expect(screen.queryByText(SUCCESS, { exact: false })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });


  it("clears LINK's outcome alerts when the student picks another token", async () => {
    given.error('get', '/api/erc20/:network/:symbol/request', TOKEN_COOLDOWN, 429);
    installMetamask({ connected: true });
    const { user } = renderWithRoutes();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    await within(card).findByText(TOKEN_COOLDOWN);

    await user.click(screen.getByRole('link', { name: 'FOLD' }));
    await pageLoaded('Interfold');
    expect(screen.queryByText(TOKEN_COOLDOWN)).toBeNull();
  });


  it('shows the LINK claim still in flight — and its answer — when the student comes back to LINK', async () => {
    let answer = null;
    server.use(http.get(url('/api/erc20/:network/:symbol/request'), () => new Promise((resolve) => { answer = resolve; })));
    installMetamask({ connected: true });
    const { user } = renderWithRoutes();
    const card = await readyToClaim();
    await user.click(claimIn(card));
    await waitFor(() => expect(answer).not.toBeNull());

    await user.click(screen.getByRole('link', { name: 'FOLD' }));
    await pageLoaded('Interfold');
    await user.click(screen.getByRole('link', { name: 'LINK' }));
    await pageLoaded();
    expect(await within(cardOf('Ethereum Sepolia')).findByRole('button', { name: 'Siunčiama…' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => answer(HttpResponse.json(f.erc20Payout())));
    expect(await payoutAlert(cardOf('Ethereum Sepolia'))).toHaveTextContent(`${SUCCESS} Transakcija: ${TX_HASH}`);
    await waitFor(() => expect(claimIn(cardOf('Ethereum Sepolia'))).not.toHaveAttribute('aria-disabled'));
  });


  it('drops a "Rodyti MetaMask" refusal that comes back after a switch to FOLD', async () => {
    const metamask = installMetamask({ connected: true });
    const popup = metamask.hold('wallet_watchAsset');
    const { user } = renderWithRoutes();
    const card = await readyToClaim();
    await user.click(showIn(card));
    await waitFor(() => expect(popup.called).toBe(true));

    await user.click(screen.getByRole('link', { name: 'FOLD' }));
    await pageLoaded('Interfold');
    await act(async () => popup.decline());
    await settle(100);
    expect(screen.queryByText(USER_REJECTED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// The token payload drives the whole page: its failures are
// the error card — a body of the wrong shape is one of them
// (see "Loading and the backend's failures") — and odd
// values inside a well-shaped body must not crash, once with
// no wallet (no gas numbers) and once with a connected
// wallet, whose wallet_native_wei feeds the gas gate. The
// payout's failure answers must reach the card as an alert.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/erc20/token/:symbol',
  fixture: f.erc20Token('LINK'),
  render: () => renderTokenFaucet(),
  chrome: pageStands,
  loaded: async () => { await pageLoaded(); },
  failed: async (says) => {
    await screen.findByText(says(TOKEN_FAILED));
  },
  loading: () => screen.getByRole('status'),
});


describe('with a connected wallet', () => {
  describeEndpointContract({
    path: '/api/erc20/token/:symbol',
    fixture: f.erc20Token('LINK', f.STUDENT_EVM),
    only: [
      'every leaf null → page survives',
      'types swapped (numbers as strings, strings as numbers) → page survives',
      'unknown extra fields → page survives and still shows the data',
      'hostile strings (unicode + markup) → rendered as text, never as elements',
    ],
    render: () => {
      installMetamask({ connected: true });
      renderTokenFaucet();
    },
    chrome: pageStands,
    loaded: async () => { await readyToClaim(); },
  });
});


describeEndpointContract({
  path: '/api/erc20/:network/:symbol/request',
  fixture: f.erc20Payout(),
  only: FAILURES,
  render: () => {
    installMetamask({ connected: true });
    const { user } = renderTokenFaucet();
    readyToClaim().then((card) => user.click(claimIn(card))).catch(() => {});
  },
  chrome: () => screen.getByRole('heading', { level: 1, name: "Chainlink faucet'as" }),
  failed: async () => {
    const card = cardOf('Ethereum Sepolia');
    const alert = await within(card).findByRole('alert');
    expect(alert.textContent).not.toBe('');
    expect(within(alert).getByTestId('ErrorOutlineIcon')).toBeInTheDocument();
    await waitFor(() => expect(claimIn(cardOf('Ethereum Sepolia'))).toBeEnabled());
  },
});

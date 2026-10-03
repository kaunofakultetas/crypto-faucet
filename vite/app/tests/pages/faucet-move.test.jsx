// -----------------------------------------------------------
//  [*] Tests — MOVE faucet page (/faucet/move/:network)
//
//  The Sui faucet end to end against the backend double and
//  the Sui wallet double (support/wallets/sui.js, the Wallet
//  Standard): the network's names and the faucet's numbers,
//  the loading skeleton and the 5 s repoll, faucet info that
//  could not be read (or came in another shape) said so on a
//  page whose wallet steps still work, the claim held until it
//  recovers; the three-step flow — there is no network step —
//  install (Slush suggested when nothing announces itself, a
//  wallet announced before or after the page, another chain's
//  wallet ignored, the picker for two wallets — told apart by
//  identity even under one name — a wallet going away and the
//  next one taking over), connect (a session restored without
//  a popup, the popup, refusals) and the claim (the account
//  object signing the backend's exact message, the captured
//  request with the address, the signature untouched — "+",
//  "/" and "=" intact — and the nonce inside the signed text,
//  the transaction linked to the explorer, "Siunčiama…", one
//  request per double click, both balances refetched, the
//  wallet's and the backend's refusals verbatim, a 200 that
//  names no transaction and the failures that carry no
//  sentence in Lithuanian); the network note (quiet, or a
//  warning when the account advertises another network; the
//  wallet's own label for the network); the student's own
//  balance read with one GraphQL query from the public
//  endpoint ("Kraunama…", a wallet that never held SUI as a
//  real zero, a dash for GraphQL errors with HTTP 200 / a 500
//  / a 429 / a dropped connection / an answer that is no
//  GraphQL, its repoll and recovery); account changes inside
//  the wallet; the return address card; a network switch;
//  unknown networks, a failed catalog and one answered
//  without its networks map; and the backend contract
//  matrices for /api/move/networks,
//  /api/move/:network/faucet-balance, the claim's failure
//  answers and the public GraphQL endpoint.
//
//  The page has no copy button — only what it does show is
//  asserted.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import QRCode from 'react-qr-code';
import { renderPage, renderApp } from '../support/render';
import { server, given, url } from '../support/backend/server';
import { describeEndpointContract, VARIANTS, settle } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import {
  STUDENT_SUI, OTHER_SUI, SUI_SIGNATURE, ALL_SUI_CHAINS,
  installSuiWallet, suiAccount, walletError,
} from '../support/wallets/sui';
import FaucetMOVE from '@/pages/Faucet_MOVE/Page';


// The public Sui GraphQL endpoint the catalog names — where
// the page reads the student's own balance, never the backend
const GRAPHQL = f.moveNetworksMap.suiTestnet.rpc_urls[0];

// The ownership message, word for word as the backend
// (move_faucet.request_move) rebuilds it before verifying
const claimMessage = (nonce) => `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;

// The network note's instructions, for the Testnet page
const TESTNET_NOTE = 'Atidarykite Slush ir tinklo sąraše pasirinkite „Testnet“. Čiaupo monetos visada keliauja į Testnet tinklą — jei piniginė rodo kitą tinklą, gautų monetų ten nematysite.';

// A second MOVE network, for the switch
const SUI_DEVNET = {
  ...f.moveNetworksMap.suiTestnet,
  network: 'devnet', full_name: 'Sui Devnet', short_name: 'dSUI', id: 2,
  icon: '/api/icons/move/suiDevnet', rpc_urls: ['https://graphql.devnet.sui.io/graphql'],
  block_explorer_urls: ['https://suiscan.xyz/devnet'],
};

// An account a multichain wallet may hand out instead of a Sui one
const solanaAccount = { address: 'DGvWVvGUt92p1YiffQ69Ba75stvSRMjCo6KdUtkWayC8', publicKey: new Uint8Array(32), chains: ['solana:devnet'], features: [] };

// The transaction digest every default payout answers with
const TXID = f.movePayout().transaction_id;

// What a failed claim says when nobody had words of their own
const CLAIM_FAILED = 'Nepavyko išsiųsti kriptovaliutos.';

// The page's own sentences for a failed read; the reason
// follows them when the backend sent no sentence of its own
const FAUCET_FAILED = 'Nepavyko gauti čiaupo informacijos.';
const NETWORKS_FAILED = 'Nepavyko gauti tinklų sąrašo.';
const MALFORMED = 'Serveris atsakė netinkamo formato duomenimis.';

// The student's balance row's sentence when the public GraphQL
// endpoint could not read the balance; its own reason follows
const WALLET_FAILED = 'Nepavyko gauti jūsų Slush balanso.';

// The backend's own sentence when the chain's server did not
// answer its balance read
const RPC_SILENT = 'Nepavyko gauti čiaupo balanso: Sui GraphQL serveris neatsakė per 20 s.';

// The network list's error card: the failure, closed with a
// full stop when it lacks one, then the next step
const networksCard = (failure) => `${failure.endsWith('.') ? failure : `${failure}.`} Perkraukite puslapį.`;







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderMove mounts the page on its route pattern;
// renderWithPicker adds links between two MOVE networks (the
// navbar picker's effect: the page stays mounted). row() is a
// labelled balance line as the student reads it — the
// student's own line is named after the wallet. atClaimStep
// starts from a wallet that already has a session for this
// origin, so the claim button is there at once. captureGraphql
// answers the public balance query per address and records
// every body. stepLabels / currentStep read the stepper.
// holdClaim keeps the claim's answer until the test releases
// it.
// qrCodes / qrModulesFor: the page's QR (an <svg> with no role
// or name — its 128 px size is the only handle) against a QR
// of a known value.
// -----------------------------------------------------------

const renderMove = (network = 'suiTestnet') => renderPage(<FaucetMOVE />, { route: `/faucet/move/${network}`, path: '/faucet/move/:network' });

function renderWithPicker(network = 'suiTestnet') {
  given.json('get', '/api/move/networks', { ...f.moveNetworks, networks: { ...f.moveNetworksMap, suiDevnet: SUI_DEVNET } });
  given.json('get', '/api/move/:network/faucet-balance', f.moveBalance());
  server.use(http.post(SUI_DEVNET.rpc_urls[0], () => HttpResponse.json({ data: { address: { balance: { totalBalance: '0' } } } })));
  return renderPage(
    <>
      <nav aria-label="Tinklai">
        <Link to="/faucet/move/suiTestnet">Testnet</Link>
        <Link to="/faucet/move/suiDevnet">Devnet</Link>
      </nav>
      <Routes>
        <Route path="/faucet/move/:network" element={<FaucetMOVE />} />
      </Routes>
    </>,
    { route: `/faucet/move/${network}` },
  );
}

const pageLoaded = (name = "Sui Testnet faucet'as") => screen.findByRole('heading', { level: 1, name });

const row = (label) => screen.getByText(label).parentElement;

const studentBalance = (walletName = 'Slush') => row(`Jūsų ${walletName} balansas:`);

const currentStep = () => document.querySelector('[aria-current="step"]');

// The stepper's labels in order — the install link, which
// repeats the first one, left out
const stepLabels = () => screen
  .getAllByText(/^(Susidiegti|Prijungti|Atsisiųsti) /, { ignore: 'a, button, script, style' })
  .map((label) => label.textContent);

async function atClaimStep(options = {}) {
  const sui = installSuiWallet({ accounts: [suiAccount()], ...options });
  const view = renderMove();
  const claim = await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' });
  return { ...view, sui, claim };
}

function captureGraphql(mistOf = () => f.STUDENT_SUI_MIST) {
  const bodies = [];
  server.use(http.post(GRAPHQL, async ({ request }) => {
    const body = await request.json();
    bodies.push(body);
    return HttpResponse.json({ data: { address: { balance: { totalBalance: String(mistOf(body.variables?.a)) } } } });
  }));
  return bodies;
}

// The network list with the Testnet entry changed
const networksWith = (changes) => ({ ...f.moveNetworks, networks: { suiTestnet: { ...f.moveNetworksMap.suiTestnet, ...changes } } });

// A claim answer the test releases itself, so it lands
// exactly when the test says — not when a timer happens to
// fire. release() first waits for the request to have
// arrived; `requests` counts what arrived meanwhile.
function holdClaim(body = f.movePayout()) {
  let answer;
  let arrived;
  const arrival = new Promise((resolve) => { arrived = resolve; });
  const held = {
    requests: 0,
    release: async () => {
      await arrival;
      await act(async () => { answer(HttpResponse.json(body)); });
    },
  };
  server.use(http.get(url('/api/move/:network/request'), () => {
    held.requests += 1;
    arrived();
    return new Promise((resolve) => { answer = resolve; });
  }));
  return held;
}

const qrCodes = () => [...document.querySelectorAll('svg[height="128"]')];

const modulesOf = (svg) => svg.querySelectorAll('path')[1].getAttribute('d');

function qrModulesFor(value) {
  const { container, unmount } = render(<QRCode value={value} size={128} />);
  const drawn = modulesOf(container.querySelector('svg'));
  unmount();
  return drawn;
}

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

// A sentence that runs through inline markup (<u>, <b>)
const spanning = (text) => (_, element) => element?.textContent === text && [...element.children].every((child) => child.textContent !== text);

// The whole text, nothing around it
const exactly = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);







// -----------------------------------------------------------
// The page and its numbers
// -----------------------------------------------------------
//
// The names from /api/move/networks, the faucet's payout and
// balance, the skeleton until both have arrived, the repoll —
// and faucet info that never arrives: the page says so in
// its own words, the wallet steps stay usable, the claim
// waits, the next poll recovers.
// -----------------------------------------------------------

describe('The page and its numbers', () => {

  it('names the network in the heading and the lab sentence', async () => {
    renderMove();
    expect(await pageLoaded()).toBeInTheDocument();
    expect(screen.getByText(spanning('Šiuo įrankiu galite gauti Sui Testnet testinės kriptovaliutos laboratoriniams darbams.'))).toBeInTheDocument();
  });


  it("shows the payout and the faucet's balance to three decimals, and no student balance before a wallet", async () => {
    renderMove();
    await pageLoaded();
    expect(row('Išsiųsime jums:')).toHaveTextContent(/^Išsiųsime jums:0\.500 tSUI$/);
    expect(row('Čiaupo balansas:')).toHaveTextContent(/^Čiaupo balansas:531\.000 tSUI$/);
    expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:Piniginė neprijungta$/);
  });


  it('stands on a skeleton, announced to screen readers, until the faucet info has arrived', async () => {
    given.hang('get', '/api/move/:network/faucet-balance');
    renderMove();
    expect(await screen.findByRole('status')).toHaveTextContent('Kraunami tinklo duomenys…');
    await settle(100);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });


  it("asks for the faucet's balance again every 5 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = given.capture('get', '/api/move/:network/faucet-balance', f.moveBalance());
    renderMove();
    await pageLoaded();
    expect(calls).toHaveLength(1);
    await advance(5000);
    await waitFor(() => expect(calls).toHaveLength(2));
  });


  it('shows a new balance from a repoll, and keeps the numbers when a later repoll fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers = [HttpResponse.json(f.moveBalance()), HttpResponse.json({ ...f.moveBalance(), balance: 530.5 })];
    let calls = 0;
    server.use(http.get(url('/api/move/:network/faucet-balance'), () => {
      calls += 1;
      return answers[calls - 1] ?? HttpResponse.json({ error: 'Nepavyko gauti čiaupo informacijos' }, { status: 500 });
    }));
    renderMove();
    await pageLoaded();
    await advance(5000);
    await waitFor(() => expect(row('Čiaupo balansas:')).toHaveTextContent('530.500 tSUI'));
    await advance(5000);
    await waitFor(() => expect(calls).toBe(3));
    await settle(100);
    expect(row('Čiaupo balansas:')).toHaveTextContent('530.500 tSUI');
    expect(screen.queryByRole('alert')).toBeNull();
  });


  it("says what went wrong where the numbers stand — the backend's own sentence — on a page whose wallet steps still work", async () => {
    given.error('get', '/api/move/:network/faucet-balance', RPC_SILENT, 500);
    installSuiWallet();
    const { user } = renderMove();
    expect((await screen.findByRole('alert')).textContent).toBe(RPC_SILENT);
    expect(screen.getByRole('heading', { level: 1, name: "Sui Testnet faucet'as" })).toBeInTheDocument();
    expect(screen.queryByText('Čiaupo balansas:')).toBeNull();
    // No return card for a faucet the page knows nothing about
    expect(screen.queryByText(/^Grąžinkite nebereikalingą/)).toBeNull();
    expect(qrCodes()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toBeInTheDocument();
  });


  it.each([
    ['no address', () => given.json('get', '/api/move/:network/faucet-balance', { ...f.moveBalance(), address: undefined })],
    ['an empty address', () => given.json('get', '/api/move/:network/faucet-balance', { ...f.moveBalance(), address: '' })],
    ['the balance as text', () => given.json('get', '/api/move/:network/faucet-balance', { ...f.moveBalance(), balance: '531' })],
    ['no payout size', () => given.json('get', '/api/move/:network/faucet-balance', { ...f.moveBalance(), chunk_size: null })],
    ["a proxy's page answered 200", () => given.text('get', '/api/move/:network/faucet-balance', '<html><body>Palaukite…</body></html>')],
  ])('takes faucet info of another shape for a failed read — said as the wrong shape, never a blank number: %s', async (_, answer) => {
    answer();
    renderMove();
    expect((await screen.findByRole('alert')).textContent).toBe(`${FAUCET_FAILED} ${MALFORMED}`);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(qrCodes()).toHaveLength(0);
  });


  it('holds the claim while the faucet info could not be read — the wallet is not asked to sign, nothing is sent', async () => {
    given.error('get', '/api/move/:network/faucet-balance', 'Vidinė serverio klaida', 500);
    const calls = given.capture('get', '/api/move/:network/request', f.movePayout());
    const { user, sui, claim } = await atClaimStep();
    expect(claim).toHaveAttribute('aria-disabled', 'true');
    await expect(user.click(claim)).rejects.toThrow(/pointer-events: none/);
    claim.focus();
    await user.keyboard('{Enter}');
    await settle(100);
    expect(sui.callsTo('signPersonalMessage')).toEqual([]);
    expect(calls).toHaveLength(0);
  });


  it('recovers from a failed first load on the next poll — the numbers, the return card and the claim come back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    given.sequence('get', '/api/move/:network/faucet-balance', [
      { status: 500, body: { error: 'Vidinė serverio klaida' } },
      { body: f.moveBalance() },
    ]);
    const { claim } = await atClaimStep();
    expect(claim).toHaveAttribute('aria-disabled', 'true');
    await advance(5000);
    await waitFor(() => expect(row('Čiaupo balansas:')).toHaveTextContent('531.000 tSUI'));
    expect(screen.queryByText('Vidinė serverio klaida')).toBeNull();
    expect(qrCodes()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toHaveAttribute('aria-disabled', 'false');
  });
});







// -----------------------------------------------------------
// Finding the wallet
// -----------------------------------------------------------
//
// Step one: Slush suggested when nothing announces itself,
// the discovered wallet named everywhere, the picker for two
// (by identity — two wallets may share a name), a wallet
// going away and the next one announced taking over.
// -----------------------------------------------------------

describe('Finding the wallet', () => {

  it('with no Sui wallet shows three steps — no network step — the first current, and suggests Slush', async () => {
    renderMove();
    await pageLoaded();
    expect(stepLabels()).toEqual(['Susidiegti Slush', 'Prijungti Slush', 'Atsisiųsti Sui Testnet']);
    expect(currentStep()).toHaveTextContent('Susidiegti Slush');
    const link = screen.getByRole('link', { name: 'Susidiegti Slush' });
    expect(link).toHaveAttribute('href', 'https://slush.app');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText(/Tinklas pasirenkamas|rodo kitą tinklą/)).toBeNull();
  });


  it('names a wallet that loaded before the page everywhere: the steps, the balance line, the note', async () => {
    installSuiWallet({ name: 'Suiet' });
    renderMove();
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(stepLabels()).toEqual(['Susidiegti Suiet', 'Prijungti Suiet', 'Atsisiųsti Sui Testnet']);
    expect(studentBalance('Suiet')).toHaveTextContent('Piniginė neprijungta');
    expect(screen.getByText('Tinklas pasirenkamas pačioje Suiet piniginėje.')).toBeInTheDocument();
  });


  it('picks up a wallet that announces itself after the page, without a reload', async () => {
    renderMove();
    await pageLoaded();
    expect(screen.getByRole('link', { name: 'Susidiegti Slush' })).toBeInTheDocument();
    act(() => { installSuiWallet({ name: 'Suiet' }); });
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Prijungti Suiet');
  });


  it('does not offer a Wallet Standard wallet that cannot sign for Sui', async () => {
    installSuiWallet({ name: 'Solflare', sui: false });
    renderMove();
    await pageLoaded();
    await settle();
    expect(screen.getByRole('link', { name: 'Susidiegti Slush' })).toBeInTheDocument();
    expect(screen.queryByText(/Solflare/)).toBeNull();
  });


  it('offers a picker when two Sui wallets announce themselves, the first one in use', async () => {
    installSuiWallet({ name: 'Slush' });
    installSuiWallet({ name: 'Suiet' });
    renderMove();
    expect(await screen.findByText('Piniginė:')).toBeInTheDocument();
    const slush = screen.getByRole('button', { name: 'Slush' });
    const suiet = screen.getByRole('button', { name: 'Suiet' });
    // The wallet in use is the filled button — MUI's variant
    // class is the only witness of it
    expect(slush).toHaveClass('MuiButton-contained');
    expect(suiet).toHaveClass('MuiButton-outlined');
    expect(currentStep()).toHaveTextContent('Prijungti Slush');
  });


  it("switches every label to the picked wallet and restores that wallet's own session", async () => {
    const bodies = captureGraphql((address) => (address === OTHER_SUI ? 500000000 : f.STUDENT_SUI_MIST));
    installSuiWallet({ name: 'Slush' });
    installSuiWallet({ name: 'Suiet', accounts: [suiAccount(OTHER_SUI)] });
    const { user } = renderMove();
    await user.click(await screen.findByRole('button', { name: 'Suiet' }));
    expect(await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suiet' })).toHaveClass('MuiButton-contained');
    await waitFor(() => expect(studentBalance('Suiet')).toHaveTextContent(/^Jūsų Suiet balansas:0\.500 tSUI$/));
    expect(bodies.at(-1).variables.a).toBe(OTHER_SUI);
  });


  it('tells two wallets announced under one name apart in the picker — only the one in use is filled, and React sees no duplicate keys', async () => {
    const reports = vi.spyOn(console, 'error');
    installSuiWallet({ name: 'Slush' });
    installSuiWallet({ name: 'Slush', accounts: [suiAccount(OTHER_SUI)] });
    const { user } = renderMove();
    await screen.findByText('Piniginė:');
    // The wallet in use is the filled button — MUI's variant
    // class is the only witness of it
    const slushes = () => screen.getAllByRole('button', { name: 'Slush' });
    const filled = () => slushes().filter((button) => button.classList.contains('MuiButton-contained'));
    expect(filled()).toHaveLength(1);
    expect(filled()[0]).toBe(slushes()[0]);

    // The second one has a session here: picking it is the claim at once
    await user.click(slushes()[1]);
    expect(await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toBeInTheDocument();
    expect(filled()).toHaveLength(1);
    expect(filled()[0]).toBe(slushes()[1]);
    expect(reports.mock.calls.filter((args) => /same key/.test(args.join(' ')))).toEqual([]);
  });


  it('shows no picker for a single wallet', async () => {
    installSuiWallet({ name: 'Slush' });
    renderMove();
    await screen.findByRole('button', { name: 'Prijungti piniginę' });
    expect(screen.queryByText('Piniginė:')).toBeNull();
  });


  it('goes back to the install step when the only wallet goes away', async () => {
    const slush = installSuiWallet({ accounts: [suiAccount()] });
    renderMove();
    await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' });
    act(() => { slush.unregister(); });
    expect(await screen.findByRole('link', { name: 'Susidiegti Slush' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toBeNull();
    expect(studentBalance()).toHaveTextContent('Piniginė neprijungta');
  });


  it('lets the other announced wallet take over when the one in use goes away — never "Susidiegti Slush" while a wallet is there', async () => {
    const slush = installSuiWallet({ name: 'Slush' });
    installSuiWallet({ name: 'Suiet' });
    renderMove();
    await screen.findByText('Piniginė:');
    act(() => { slush.unregister(); });
    await settle();
    expect(screen.getByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(studentBalance('Suiet')).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Prijungti Suiet');
    expect(screen.queryByRole('link', { name: 'Susidiegti Slush' })).toBeNull();
    // One wallet left — nothing to pick between
    expect(screen.queryByText('Piniginė:')).toBeNull();
  });


  it("restores the session of the wallet that takes over, never the departed wallet's account", async () => {
    const bodies = captureGraphql((address) => (address === OTHER_SUI ? 500000000 : f.STUDENT_SUI_MIST));
    const slush = installSuiWallet({ name: 'Slush', accounts: [suiAccount()] });
    installSuiWallet({ name: 'Suiet', accounts: [suiAccount(OTHER_SUI)] });
    renderMove();
    await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' });
    act(() => { slush.unregister(); });
    await waitFor(() => expect(studentBalance('Suiet')).toHaveTextContent(/^Jūsų Suiet balansas:0\.500 tSUI$/));
    expect(bodies.at(-1).variables.a).toBe(OTHER_SUI);
    expect(screen.getByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Connecting
// -----------------------------------------------------------
//
// Step two: a session the wallet already has comes back
// without a popup; the popup on the click leads straight to
// the claim — a Sui address is the same on every network.
// -----------------------------------------------------------

describe('Connecting', () => {

  it('offers "Prijungti piniginę" for a wallet with no session here, the second step current', async () => {
    installSuiWallet();
    renderMove();
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Prijungti Slush');
    expect(screen.getAllByText('atlikta')).toHaveLength(1);
  });


  it('restores the session a wallet already has for this origin — the claim at once, no popup', async () => {
    const { sui, claim } = await atClaimStep();
    expect(claim).toBeInTheDocument();
    expect(sui.callsTo('connect')).toEqual([]);
    expect(currentStep()).toHaveTextContent('Atsisiųsti Sui Testnet');
  });


  it('connects through the popup on the click and goes straight to the claim step', async () => {
    const sui = installSuiWallet();
    const { user } = renderMove();
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toBeInTheDocument();
    expect(sui.callsTo('connect')).toEqual([[{ silent: true }], [undefined]]);
    expect(currentStep()).toHaveTextContent('Atsisiųsti Sui Testnet');
    expect(screen.getAllByText('atlikta')).toHaveLength(2);
  });


  it.each([
    ['the student refuses the popup', { connect: 'reject' }, 'Prijungimas atmestas Slush lange.'],
    ['the wallet hands out no Sui account', { accountsOnConnect: [solanaAccount] }, 'Slush negrąžino Sui paskyros.'],
    ['the wallet fails in its own words', { connect: walletError('Slush užrakinta') }, 'Slush užrakinta'],
  ])('stays on the connect step and says why when %s', async (_, options, message) => {
    installSuiWallet(options);
    const { user } = renderMove();
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(screen.getByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The network note
// -----------------------------------------------------------
//
// The wallet cannot be switched from the page: the note names
// the network to pick inside it — quietly, or as a warning
// when the account advertises only another network.
// -----------------------------------------------------------

describe('The network note', () => {

  it('names the network to pick in the wallet, quietly while the account is on it', async () => {
    await atClaimStep();
    expect(screen.getByText('Tinklas pasirenkamas pačioje Slush piniginėje.')).toBeInTheDocument();
    expect(screen.getByText(TESTNET_NOTE)).toBeInTheDocument();
    expect(screen.queryByText('Slush šiuo metu rodo kitą tinklą.')).toBeNull();
  });


  it('warns when the account advertises another network only', async () => {
    await atClaimStep({ accounts: [suiAccount(STUDENT_SUI, ['sui:mainnet'])] });
    expect(screen.getByText('Slush šiuo metu rodo kitą tinklą.')).toBeInTheDocument();
    expect(screen.getByText(TESTNET_NOTE)).toBeInTheDocument();
  });


  it('stays quiet for a wallet whose account lists every network — there is nothing to check', async () => {
    await atClaimStep({ accounts: [suiAccount(STUDENT_SUI, ALL_SUI_CHAINS)] });
    expect(screen.getByText('Tinklas pasirenkamas pačioje Slush piniginėje.')).toBeInTheDocument();
  });


  it('turns into the warning when the student switches the wallet to another network', async () => {
    const { sui } = await atClaimStep();
    act(() => { sui.change([suiAccount(STUDENT_SUI, ['sui:devnet'])]); });
    expect(await screen.findByText('Slush šiuo metu rodo kitą tinklą.')).toBeInTheDocument();
  });


  it('is there already on the connect step', async () => {
    installSuiWallet();
    renderMove();
    await screen.findByRole('button', { name: 'Prijungti piniginę' });
    expect(screen.getByText('Tinklas pasirenkamas pačioje Slush piniginėje.')).toBeInTheDocument();
  });


  it.each([
    ['devnet', '„Devnet“'],
    ['mainnet', '„Mainnet“'],
    ['localnet', '„localnet“'],
  ])('names the network of a %s faucet as %s — the wallet\'s own label, or the key when there is none', async (network, label) => {
    given.json('get', '/api/move/networks', networksWith({ network }));
    await atClaimStep({ accounts: [suiAccount(STUDENT_SUI, [`sui:${network}`])] });
    expect(screen.getByText(new RegExp(`tinklo sąraše pasirinkite ${label}\\.`))).toBeInTheDocument();
    expect(screen.getByText('Tinklas pasirenkamas pačioje Slush piniginėje.')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The student's own balance
// -----------------------------------------------------------
//
// One GraphQL query against the public endpoint the catalog
// names; four states that must not blur: not connected,
// "Kraunama…", a number, a dash.
// -----------------------------------------------------------

describe("The student's own balance", () => {

  it("reads it with one GraphQL query for the address and the network's coin type", async () => {
    const bodies = captureGraphql();
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:2\.250 tSUI$/));
    expect(bodies[0].variables).toEqual({ a: STUDENT_SUI, t: '0x2::sui::SUI' });
    expect(bodies[0].query).toMatch(/address\(address: \$a\)\s*\{\s*balance\(coinType: \$t\)\s*\{\s*totalBalance\s*\}/);
  });


  it('asks the endpoint nothing before a wallet is connected', async () => {
    const bodies = captureGraphql();
    installSuiWallet();
    renderMove();
    await screen.findByRole('button', { name: 'Prijungti piniginę' });
    await settle(100);
    expect(bodies).toEqual([]);
  });


  it('says "Kraunama…" while the endpoint is thinking', async () => {
    given.hang('post', GRAPHQL);
    await atClaimStep();
    expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:Kraunama…$/);
  });


  it('shows a wallet that never held SUI (no balance in the answer) as a real 0.000', async () => {
    given.json('post', GRAPHQL, { data: { address: { balance: null } } });
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:0\.000 tSUI$/));
  });


  it.each([
    ['GraphQL errors answered with HTTP 200', () => given.json('post', GRAPHQL, { data: null, errors: [{ message: 'Invalid Sui address' }] }), 'Sui GraphQL atsakė: Invalid Sui address.'],
    ['an HTTP 500', () => given.error('post', GRAPHQL, 'Internal error', 500), 'Sui GraphQL atsakė: Internal error.'],
    ['a rate limit (429)', () => given.json('post', GRAPHQL, { errors: [{ message: 'Too many requests' }] }, { status: 429 }), 'Per daug užklausų — palaukite ir bandykite vėl.'],
    ['a dropped connection', () => given.networkError('post', GRAPHQL), 'Patikrinkite interneto ryšį.'],
  ])('shows a dash — never a zero, never a lasting "Kraunama…" — and says why under it, for %s', async (_, answer, reason) => {
    answer();
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:-$/));
    expect(await screen.findByText(`${WALLET_FAILED} ${reason}`)).toBeInTheDocument();
  });


  it('asks again every 5 s, and turns a dash back into the number when the endpoint recovers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    given.sequence('post', GRAPHQL, [
      { status: 500, body: { error: 'Internal error' } },
      { body: { data: { address: { balance: { totalBalance: String(f.STUDENT_SUI_MIST) } } } } },
    ]);
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent('Jūsų Slush balansas:-'));
    await advance(5000);
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:2\.250 tSUI$/));
  });


  it('follows the account the student switches to inside the wallet', async () => {
    const bodies = captureGraphql((address) => (address === OTHER_SUI ? 125000000 : f.STUDENT_SUI_MIST));
    const { sui } = await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent('2.250 tSUI'));
    act(() => { sui.change([suiAccount(OTHER_SUI)]); });
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:0\.125 tSUI$/));
    expect(bodies.at(-1).variables.a).toBe(OTHER_SUI);
  });


  it.each([
    ["a proxy's page answered 200", () => given.text('post', GRAPHQL, '<html><body>Palaukite…</body></html>')],
    ['an object that is no GraphQL answer', () => given.json('post', GRAPHQL, {})],
    ['a balance that is no number', () => given.json('post', GRAPHQL, { data: { address: { balance: { totalBalance: 'daug' } } } })],
  ])('shows a dash — never a made-up 0.000 tSUI — and says the answer had no readable balance, for: %s', async (_, answer) => {
    answer();
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:-$/), { timeout: 1500 });
    expect(screen.getByText(`${WALLET_FAILED} Sui GraphQL atsakė netinkamo formato duomenimis.`)).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The claim
// -----------------------------------------------------------
//
// sui:signPersonalMessage with the connected account object,
// then GET /api/move/<network>/request?address=&signature=&
// nonce= — the in-flight state, the outcome rows (the
// payout's transaction linked to the explorer), every refusal
// from the wallet and from the backend, and the failures that
// carry no sentence of their own, in Lithuanian.
// -----------------------------------------------------------

describe('The claim', () => {

  it("signs the backend's message with the account object, and sends the address, the signature untouched and the very nonce that was signed", async () => {
    const calls = given.capture('get', '/api/move/:network/request', f.movePayout());
    const account = suiAccount();
    const { user, sui, claim } = await atClaimStep({ accounts: [account] });
    await user.click(claim);
    await waitFor(() => expect(calls).toHaveLength(1));
    const { nonce } = calls[0].query;
    expect(nonce).toMatch(/^\d{13}$/);
    expect(sui.signedTexts()).toEqual([claimMessage(nonce)]);
    expect(sui.callsTo('signPersonalMessage')[0][0].account).toBe(account);
    expect(calls[0].params.network).toBe('suiTestnet');
    // "+", "/" and "=" survive the query string
    expect(SUI_SIGNATURE).toMatch(/^(?=.*\+)(?=.*\/).*=$/);
    expect(calls[0].query).toEqual({ address: STUDENT_SUI, signature: SUI_SIGNATURE, nonce });
  });


  it("says the coins are on their way and names the transaction in full, linked to the network's explorer", async () => {
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(exactly(`Sui Testnet išsiųstas į jūsų piniginę. Transakcija: ${TXID}`));
    const link = within(alert).getByRole('link', { name: TXID });
    expect(link).toHaveAttribute('href', `https://suiscan.xyz/testnet/tx/${TXID}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // A long digest wraps inside the alert instead of widening
    // the card — the class is where that lives
    expect(link).toHaveClass('break-all', 'underline');
  });


  it.each([
    ['names no explorer', { block_explorer_urls: [] }],
    ['names an explorer address that is no URL', { block_explorer_urls: ['suiscan.xyz/testnet'] }],
  ])('shows the transaction digest as plain text when the network %s', async (_, changes) => {
    given.json('get', '/api/move/networks', networksWith(changes));
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(exactly(`Sui Testnet išsiųstas į jūsų piniginę. Transakcija: ${TXID}`));
    expect(within(alert).queryByRole('link')).toBeNull();
  });


  it('asks for both balances again right after the payout', async () => {
    const balances = given.capture('get', '/api/move/:network/faucet-balance', f.moveBalance());
    const bodies = captureGraphql();
    const { user, claim } = await atClaimStep();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(balances).toHaveLength(1);
    await user.click(claim);
    await screen.findByText(/^Sui Testnet išsiųstas į jūsų piniginę\./);
    await waitFor(() => expect(balances).toHaveLength(2), { timeout: 1000 });
    await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 1000 });
  });


  it('shows "Siunčiama…" on a busy button while the claim is on its way, and neither a click nor the keyboard sends a second one', async () => {
    let count = 0;
    server.use(http.get(url('/api/move/:network/request'), () => { count += 1; return new Promise(() => {}); }));
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    const busy = await screen.findByRole('button', { name: 'Siunčiama…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    // The busy button takes no pointer (pointer-events: none) —
    // but stays focusable, so Enter and Space are the way in
    await expect(user.click(busy)).rejects.toThrow(/pointer-events: none/);
    busy.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    await settle(100);
    expect(count).toBe(1);
  });


  it('sends one claim for a double click', async () => {
    const held = holdClaim();
    const { user, claim, sui } = await atClaimStep();
    await user.dblClick(claim);
    await screen.findByRole('button', { name: 'Siunčiama…' });
    await settle(100);
    expect(held.requests).toBe(1);
    expect(sui.callsTo('signPersonalMessage')).toHaveLength(1);
    await held.release();
    expect(await screen.findByText(/^Sui Testnet išsiųstas į jūsų piniginę\./)).toBeInTheDocument();
  });


  it.each([
    ['refuses to sign', { sign: 'reject' }, 'Pasirašymas atmestas Slush lange.'],
    ['answers without a signature', { sign: 'no-signature' }, 'Slush negrąžino parašo.'],
    ['fails in its own words', { sign: walletError('Ledger atjungtas') }, 'Ledger atjungtas'],
  ])('asks the backend nothing when the wallet %s, and says why', async (_, options, message) => {
    const calls = given.capture('get', '/api/move/:network/request', f.movePayout());
    const { user, claim } = await atClaimStep(options);
    await user.click(claim);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(calls).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toHaveAttribute('aria-disabled', 'false');
  });


  it.each([
    ['the cooldown', 429, f.COOLDOWN_MESSAGE],
    ['the empty faucet', 503, f.EMPTY_FAUCET_MESSAGE],
    ['a signature that does not match the address', 403, 'Parašas neatitinka nurodyto adreso. Prijunkite tą pačią piniginę ir bandykite dar kartą.'],
    ['an account on another key scheme', 400, 'Ši piniginės paskyra pasirašo zkLogin raktu, o čiaupas priima tik įprastas Ed25519 paskyras. Pasirinkite piniginėje kitą paskyrą.'],
    ['a wallet that already has enough', 400, 'Jūsų piniginėje jau yra pakankamai SUI.'],
    ['a bad address', 400, 'Neteisingas adresas'],
    ['a failed broadcast', 500, 'Nepavyko išsiųsti transakcijos. Bandykite dar kartą.'],
  ])("shows the backend's refusal verbatim: %s", async (_, status, message) => {
    given.error('get', '/api/move/:network/request', message, status);
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(screen.queryByText(/išsiųstas į jūsų piniginę/)).toBeNull();
  });


  it.each([
    ["a proxy's HTML error page", () => given.html('get', '/api/move/:network/request'), `${CLAIM_FAILED} Serveris grąžino klaidą (502).`],
    ['a 500 with no body', () => given.empty('get', '/api/move/:network/request', 500), `${CLAIM_FAILED} Serveris grąžino klaidą (500).`],
    ['a dropped connection', () => given.networkError('get', '/api/move/:network/request'), `${CLAIM_FAILED} Patikrinkite interneto ryšį.`],
  ])("says it in Lithuanian, never in axios's English, for %s", async (_, answer, message) => {
    answer();
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
  });


  it.each([
    ['an empty object', () => given.json('get', '/api/move/:network/request', {}), CLAIM_FAILED],
    ["a proxy's page", () => given.text('get', '/api/move/:network/request', '<html><body>Palaukite…</body></html>'), CLAIM_FAILED],
    ['a transaction digest that is no string', () => given.json('get', '/api/move/:network/request', { ...f.movePayout(), transaction_id: 12345 }), CLAIM_FAILED],
    ['a refusal sent as { error }', () => given.json('get', '/api/move/:network/request', { error: f.COOLDOWN_MESSAGE }), f.COOLDOWN_MESSAGE],
  ])('treats a 200 answer that names no transaction as a failure, not a payout: %s', async (_, answer, message) => {
    answer();
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(screen.queryByText(/išsiųstas į jūsų piniginę/)).toBeNull();
    expect(document.querySelector('a[href*="/tx/"]')).toBeNull();
  });


  it('adds one outcome row per claim, and a row closes on its ×', async () => {
    given.error('get', '/api/move/:network/request', f.COOLDOWN_MESSAGE, 429);
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Gauti Sui Testnet valiutos' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    await user.click(within(screen.getAllByRole('alert')[0]).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
  });


  it('claims for the account the student switched to inside the wallet', async () => {
    const calls = given.capture('get', '/api/move/:network/request', f.movePayout());
    const { user, sui, claim } = await atClaimStep();
    const other = suiAccount(OTHER_SUI);
    act(() => { sui.change([other]); });
    await user.click(claim);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].query.address).toBe(OTHER_SUI);
    expect(sui.callsTo('signPersonalMessage')[0][0].account).toBe(other);
  });
});







// -----------------------------------------------------------
// Changes inside the wallet
// -----------------------------------------------------------

describe('Changes inside the wallet', () => {

  it('goes back to "Prijungti piniginę" when the account list empties (the standard\'s disconnect)', async () => {
    const { sui } = await atClaimStep();
    act(() => { sui.change([]); });
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toBeNull();
    expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:Piniginė neprijungta$/);
  });


  it('connects again through the popup after such a disconnect', async () => {
    const { user, sui } = await atClaimStep();
    act(() => { sui.change([]); });
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The return address card
// -----------------------------------------------------------

describe('The return address card', () => {

  it("shows the faucet's address as the backend prints it and a QR code of exactly that address", async () => {
    renderMove();
    await pageLoaded();
    expect(screen.getByText(f.FAUCET_MOVE)).toBeInTheDocument();
    expect(screen.getByText(/^Grąžinkite nebereikalingą/)).toHaveTextContent(`Grąžinkite nebereikalingą tSUI krypto atgal:${f.FAUCET_MOVE}`);
    expect(qrCodes()).toHaveLength(1);
    expect(modulesOf(qrCodes()[0])).toBe(qrModulesFor(f.FAUCET_MOVE));
    expect(modulesOf(qrCodes()[0])).not.toBe(qrModulesFor(STUDENT_SUI));
  });
});







// -----------------------------------------------------------
// Switching networks
// -----------------------------------------------------------
//
// Another MOVE network: the note names it, the previous
// outcome is dropped, a late answer stays off the new page.
// -----------------------------------------------------------

describe('Switching networks', () => {

  it('drops the previous outcome and names the new network in the note', async () => {
    installSuiWallet({ accounts: [suiAccount(STUDENT_SUI, ALL_SUI_CHAINS)] });
    const { user } = renderWithPicker();
    await user.click(await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' }));
    await screen.findByText(/^Sui Testnet išsiųstas į jūsų piniginę\./);
    await user.click(screen.getByRole('link', { name: 'Devnet' }));
    expect(await pageLoaded("Sui Devnet faucet'as")).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/tinklo sąraše pasirinkite „Devnet“\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gauti Sui Devnet valiutos' })).toBeInTheDocument();
  });


  it("never shows a claim answered after the switch on the new network's page", async () => {
    installSuiWallet({ accounts: [suiAccount()] });
    const { user } = renderWithPicker();
    const held = holdClaim();
    await user.click(await screen.findByRole('button', { name: 'Gauti Sui Testnet valiutos' }));
    await screen.findByRole('button', { name: 'Siunčiama…' });
    await user.click(screen.getByRole('link', { name: 'Devnet' }));
    await pageLoaded("Sui Devnet faucet'as");
    // Not held behind the Testnet claim still in flight
    expect(screen.getByRole('button', { name: 'Gauti Sui Devnet valiutos' })).toHaveAttribute('aria-disabled', 'false');
    await held.release();
    await settle(100);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});







// -----------------------------------------------------------
// Unknown networks and a missing network list
// -----------------------------------------------------------
//
// An unknown :network gets the error card and never polls; a
// network list that failed — or answered 200 without its
// networks map — gets the list's failure card, never a
// skeleton that does not end; the real App routes here and
// titles the tab.
// -----------------------------------------------------------

describe('Unknown networks and a missing network list', () => {

  it('gives an unknown :network the card "Nežinomas tinklas: <key>" and never polls its balance', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = given.capture('get', '/api/move/:network/faucet-balance', f.moveBalance());
    renderMove('aptosTestnet');
    expect(await screen.findByText('Nežinomas tinklas: aptosTestnet')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    await advance(11000);
    expect(calls).toHaveLength(0);
  });


  it('says why the network list could not be read instead of showing a page', async () => {
    given.error('get', '/api/move/networks', 'Vidinė serverio klaida', 500);
    renderMove();
    expect(await screen.findByText('Vidinė serverio klaida. Perkraukite puslapį.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });


  it.each([
    ["a proxy's page", () => given.text('get', '/api/move/networks', '<html><body>Palaukite…</body></html>')],
    ['an empty object', () => given.json('get', '/api/move/networks', {})],
    ['a list where the map belongs', () => given.json('get', '/api/move/networks', { ...f.moveNetworks, networks: [f.moveNetworksMap.suiTestnet] })],
  ])('says the network list could not be read when it answers 200 without a networks map, instead of a skeleton forever: %s', async (_, answer) => {
    answer();
    renderMove();
    expect(await screen.findByText(networksCard(`${NETWORKS_FAILED} ${MALFORMED}`))).toBeInTheDocument();
    expect(screen.queryByText('Kraunami tinklo duomenys…')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });


  it('the real App routes /faucet/move/suiTestnet here, under the tab title "Move čiaupas"', async () => {
    renderApp({ route: '/faucet/move/suiTestnet' });
    expect(await pageLoaded()).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Move čiaupas — VU KNF Faucet'as"));
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// Every response variant against the endpoints the page
// reads: the network list, the faucet's balance (its failure
// is the page's notice in place of the numbers, under the
// page's own title), the claim's failure answers (a render
// that clicks the claim of a restored session: the matrix
// does not await it, the click is its last step) and the
// public GraphQL balance — a restored session is at the claim
// step at once, so the row's four states need no click.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/move/networks',
  fixture: f.moveNetworks,
  render: () => renderMove(),
  loaded: async () => { await pageLoaded(); },
  failed: async (says) => { await screen.findByText(networksCard(says(NETWORKS_FAILED))); },
  loading: () => screen.getByRole('status'),
});


describeEndpointContract({
  path: '/api/move/:network/faucet-balance',
  fixture: f.moveBalance(),
  render: () => renderMove(),
  // The page's title once loaded, its loading status before
  chrome: () => screen.queryByRole('heading', { level: 1, name: "Sui Testnet faucet'as" }) ?? screen.getByRole('status'),
  loaded: async () => { await waitFor(() => expect(row('Čiaupo balansas:')).toHaveTextContent('531.000 tSUI')); },
  failed: async (says) => {
    await waitFor(() => expect(screen.queryByText('Kraunami tinklo duomenys…')).toBeNull(), { timeout: 1000 });
    expect(screen.getByText(says(FAUCET_FAILED))).toBeInTheDocument();
  },
  loading: () => screen.getByRole('status'),
});


async function claimNow() {
  const { user, claim } = await atClaimStep();
  await user.click(claim);
}

describeEndpointContract({
  path: '/api/move/:network/request',
  fixture: f.movePayout(),
  only: VARIANTS.filter((variant) => variant.expect === 'failed' || variant.expect === 'loading').map((variant) => variant.name),
  render: () => { claimNow(); },
  chrome: () => screen.getByRole('heading', { level: 1, name: "Sui Testnet faucet'as" }),
  failed: async () => {
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/\S/);
    expect(alert.textContent).not.toMatch(/Network Error|Request failed with status code/);
  },
  loading: () => screen.getByRole('button', { name: 'Siunčiama…' }),
});


describeEndpointContract({
  path: GRAPHQL,
  method: 'post',
  fixture: { data: { address: { balance: { totalBalance: String(f.STUDENT_SUI_MIST) } } } },
  render: () => {
    installSuiWallet({ accounts: [suiAccount()] });
    renderMove();
  },
  chrome: () => screen.getByRole('heading', { level: 1, name: "Sui Testnet faucet'as" }),
  loaded: async () => { await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:2\.250 tSUI$/)); },
  failed: async () => {
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Slush balansas:-$/));
    expect(await screen.findByText((text) => text.startsWith(`${WALLET_FAILED} `))).toBeInTheDocument();
  },
  loading: () => studentBalance().textContent === 'Jūsų Slush balansas:Kraunama…',
});

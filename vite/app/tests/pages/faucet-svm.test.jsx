// -----------------------------------------------------------
//  [*] Tests — SVM faucet page (/faucet/svm/:network)
//
//  The Solana faucet end to end against the backend double and
//  the Phantom double (support/wallets/phantom.js): the
//  network's names and the faucet's numbers, the loading
//  skeleton and the 5 s repoll, faucet info that could not be
//  read (or came in another shape) said so on a page whose
//  wallet steps still work, the claim held until it recovers;
//  the four-step flow — install (the download link, a
//  squatter in the shared window.solana slot ignored, a late
//  injection picked up), connect (the popup, a trusted origin
//  reconnecting silently, refusals), the cluster step (the
//  genesis hash asked for, Phantom's missing method passing
//  as "assumed" with the Testnet Mode instructions kept on
//  screen, a confirming wallet, refusals, unknown clusters, a
//  network without one, a Testnet network and its own
//  instructions, never Devnet's) and the claim (the signed
//  ownership message, the captured request with the address,
//  the base58 signature and the nonce inside the signed text,
//  the transaction linked to the explorer, "Siunčiama…", one
//  request per double click, both balances refetched, the
//  wallet's and the backend's refusals verbatim, a 200 that
//  names no transaction and the failures that carry no
//  sentence in Lithuanian); the student's own balance read
//  from the public cluster RPC (getBalance, the confirmed
//  commitment, "Kraunama…", a real zero, a dash for a
//  JSON-RPC error with HTTP 200 / a 500 / a 429 / a dropped
//  connection / an answer with no balance in it — never a
//  zero or a permanent "Kraunama…" — its repoll and its
//  recovery); account changes and disconnects inside Phantom;
//  the return address card (the base58 address as it is, its
//  QR code); a network switch; unknown networks, a failed
//  catalog and one answered without its networks map; and the
//  backend contract matrices for /api/svm/networks,
//  /api/svm/:network/faucet-balance, the claim's failure
//  answers and the public getBalance endpoint.
//
//  The page has no copy button — only what it does show is
//  asserted.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import bs58 from 'bs58';
import QRCode from 'react-qr-code';
import { renderPage, renderApp } from '../support/render';
import { server, given, url } from '../support/backend/server';
import { describeEndpointContract, VARIANTS, settle } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import { STUDENT_SOL, OTHER_SOL, SOL_SIGNATURE, createPhantom, installPhantom, phantomError } from '../support/wallets/phantom';
import FaucetSVM from '@/pages/Faucet_SVM/Page';


// The public Devnet RPC the catalog names — where the page
// reads the student's own balance, never the backend
const RPC = f.svmNetworksMap.solanaDevnet.rpc_urls[0];

// The ownership message, word for word as the backend
// (svm_faucet.request_sol) rebuilds it before verifying
const claimMessage = (nonce) => `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`;

// The Testnet Mode clicks the page lists, in order
const DEVNET_CLICKS = [
  'Atidarykite Phantom plėtinį',
  'Nustatymai (⚙️) → Developer Settings → Testnet Mode',
  'Tinklo sąraše pasirinkite „Solana Devnet“, ne „Solana“',
];

// The same clicks on a Testnet faucet, its own cluster named
const TESTNET_CLICKS = [
  'Atidarykite Phantom plėtinį',
  'Nustatymai (⚙️) → Developer Settings → Testnet Mode',
  'Tinklo sąraše pasirinkite „Solana Testnet“, ne „Solana“',
];

// The transaction id every default payout answers with
const TXID = f.svmPayout().transaction_id;

// What a failed claim says when nobody had words of their own
const CLAIM_FAILED = 'Nepavyko išsiųsti kriptovaliutos.';

// A second SVM network on another cluster, for the switch
const SOLANA_TESTNET = {
  ...f.svmNetworksMap.solanaDevnet,
  cluster: 'testnet', full_name: 'Solana Testnet', short_name: 'tSOL', id: 2,
  icon: '/api/icons/svm/solanaTestnet', rpc_urls: ['https://api.testnet.solana.com'],
  block_explorer_urls: ['https://explorer.solana.com/?cluster=testnet'],
};







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderSvm mounts the page on its route pattern;
// renderWithPicker adds links between two SVM networks (the
// navbar picker's effect: the page stays mounted). row() is a
// labelled balance line as the student reads it.
// passClusterStep clicks through the cluster step (Phantom
// answers -32601 by default, so the step passes as assumed)
// to the claim button; atClaimStep does the whole way from a
// connected Phantom. captureRpc answers the public getBalance
// per account and records every body. currentStep is the
// stepper's step marked aria-current, stepLabels its labels
// in order. holdClaim keeps the claim's answer until the test
// releases it. qrCodes / qrModulesFor: the page's QR (an <svg>
// with no role or name — its 128 px size is the only handle)
// against a QR of a known value.
// -----------------------------------------------------------

const renderSvm = (network = 'solanaDevnet') => renderPage(<FaucetSVM />, { route: `/faucet/svm/${network}`, path: '/faucet/svm/:network' });

function renderWithPicker(network = 'solanaDevnet') {
  given.json('get', '/api/svm/networks', { ...f.svmNetworks, networks: { ...f.svmNetworksMap, solanaTestnet: SOLANA_TESTNET } });
  given.json('get', '/api/svm/:network/faucet-balance', f.svmBalance());
  server.use(http.post(SOLANA_TESTNET.rpc_urls[0], () => HttpResponse.json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: 0 } })));
  return renderPage(
    <>
      <nav aria-label="Tinklai">
        <Link to="/faucet/svm/solanaDevnet">Devnet</Link>
        <Link to="/faucet/svm/solanaTestnet">Testnet</Link>
      </nav>
      <Routes>
        <Route path="/faucet/svm/:network" element={<FaucetSVM />} />
      </Routes>
    </>,
    { route: `/faucet/svm/${network}` },
  );
}

const pageLoaded = (name = "Solana Devnet faucet'as") => screen.findByRole('heading', { level: 1, name });

const row = (label) => screen.getByText(label).parentElement;

const studentBalance = () => row('Jūsų Phantom balansas:');

// A sentence that runs through inline markup (<u>, <b>)
const spanning = (text) => (_, element) => element?.textContent === text && [...element.children].every((child) => child.textContent !== text);

// The whole text, nothing around it
const exactly = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

const currentStep = () => document.querySelector('[aria-current="step"]');

// The stepper's labels in order — the install link, which
// repeats the first one, left out
const stepLabels = () => screen
  .getAllByText(/^(Susidiegti|Prijungti|Įsijungti|Atsisiųsti) /, { ignore: 'a, button, script, style' })
  .map((label) => label.textContent);

async function passClusterStep(user, name = 'Solana Devnet') {
  await user.click(await screen.findByRole('button', { name: `Persijungti į ${name} tinklą` }));
  return screen.findByRole('button', { name: `Gauti ${name} valiutos` });
}

async function atClaimStep(options = {}) {
  const phantom = installPhantom({ connected: true, ...options });
  const view = renderSvm();
  const claim = await passClusterStep(view.user);
  return { ...view, phantom, claim };
}

function captureRpc(lamportsOf = () => f.STUDENT_SVM_LAMPORTS) {
  const bodies = [];
  server.use(http.post(RPC, async ({ request }) => {
    const body = await request.json();
    bodies.push(body);
    return HttpResponse.json({ jsonrpc: '2.0', id: body.id, result: { context: { slot: 412345678 }, value: lamportsOf(body.params?.[0]) } });
  }));
  return bodies;
}

// The network list with the Devnet entry changed
const networksWith = (changes) => ({ ...f.svmNetworks, networks: { solanaDevnet: { ...f.svmNetworksMap.solanaDevnet, ...changes } } });

// A claim answer the test releases itself, so it lands
// exactly when the test says — not when a timer happens to
// fire. release() first waits for the request to have
// arrived; `requests` counts what arrived meanwhile.
function holdClaim(body = f.svmPayout()) {
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
  server.use(http.get(url('/api/svm/:network/request'), () => {
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







// -----------------------------------------------------------
// The page and its numbers
// -----------------------------------------------------------
//
// The names from /api/svm/networks, the faucet's payout and
// balance, the skeleton until both have arrived, the repoll —
// and faucet info that never arrives: the page says so in
// its own words, the wallet steps stay usable, the claim
// waits, the next poll recovers.
// -----------------------------------------------------------

describe('The page and its numbers', () => {

  it('names the network in the heading and the lab sentence', async () => {
    renderSvm();
    expect(await pageLoaded()).toBeInTheDocument();
    expect(screen.getByText(spanning('Šiuo įrankiu galite gauti Solana Devnet testinės kriptovaliutos laboratoriniams darbams.'))).toBeInTheDocument();
  });


  it("shows the payout and the faucet's balance to three decimals, and no student balance before a wallet", async () => {
    renderSvm();
    await pageLoaded();
    expect(row('Išsiųsime jums:')).toHaveTextContent(/^Išsiųsime jums:5\.000 devSOL$/);
    expect(row('Čiaupo balansas:')).toHaveTextContent(/^Čiaupo balansas:498\.250 devSOL$/);
    expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:Piniginė neprijungta$/);
  });


  it('stands on a skeleton, announced to screen readers, until the faucet info has arrived', async () => {
    given.hang('get', '/api/svm/:network/faucet-balance');
    renderSvm();
    expect(await screen.findByRole('status')).toHaveTextContent('Kraunami tinklo duomenys…');
    await settle(100);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });


  it("asks for the faucet's balance again every 5 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = given.capture('get', '/api/svm/:network/faucet-balance', f.svmBalance());
    renderSvm();
    await pageLoaded();
    expect(calls).toHaveLength(1);
    await advance(5000);
    await waitFor(() => expect(calls).toHaveLength(2));
  });


  it('shows a new balance from a repoll, and keeps the numbers when a later repoll fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers = [HttpResponse.json(f.svmBalance()), HttpResponse.json({ ...f.svmBalance(), balance: 493.25 })];
    let calls = 0;
    server.use(http.get(url('/api/svm/:network/faucet-balance'), () => {
      calls += 1;
      return answers[calls - 1] ?? HttpResponse.json({ error: 'Nepavyko gauti čiaupo informacijos' }, { status: 500 });
    }));
    renderSvm();
    await pageLoaded();
    await advance(5000);
    await waitFor(() => expect(row('Čiaupo balansas:')).toHaveTextContent('493.250 devSOL'));
    await advance(5000);
    await waitFor(() => expect(calls).toBe(3));
    await settle(100);
    expect(row('Čiaupo balansas:')).toHaveTextContent('493.250 devSOL');
    expect(screen.queryByRole('alert')).toBeNull();
  });


  it("says the faucet info could not be read — in its own words, not the backend's — on a page whose wallet steps still work", async () => {
    given.error('get', '/api/svm/:network/faucet-balance', 'Solana RPC nepasiekiamas', 500);
    installPhantom();
    const { user } = renderSvm();
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Nepavyko gauti čiaupo informacijos$/);
    expect(screen.getByRole('heading', { level: 1, name: "Solana Devnet faucet'as" })).toBeInTheDocument();
    expect(screen.queryByText('Solana RPC nepasiekiamas')).toBeNull();
    expect(screen.queryByText('Čiaupo balansas:')).toBeNull();
    // No return card for a faucet the page knows nothing about
    expect(screen.queryByText(/^Grąžinkite nebereikalingą/)).toBeNull();
    expect(qrCodes()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('button', { name: 'Persijungti į Solana Devnet tinklą' })).toBeInTheDocument();
  });


  it.each([
    ['no address', () => given.json('get', '/api/svm/:network/faucet-balance', { ...f.svmBalance(), address: undefined })],
    ['an empty address', () => given.json('get', '/api/svm/:network/faucet-balance', { ...f.svmBalance(), address: '' })],
    ['the balance as text', () => given.json('get', '/api/svm/:network/faucet-balance', { ...f.svmBalance(), balance: '498.25' })],
    ['no payout size', () => given.json('get', '/api/svm/:network/faucet-balance', { ...f.svmBalance(), chunk_size: null })],
    ["a proxy's page answered 200", () => given.text('get', '/api/svm/:network/faucet-balance', '<html><body>Palaukite…</body></html>')],
  ])('takes faucet info of another shape for a failed read, never a blank number: %s', async (_, answer) => {
    answer();
    renderSvm();
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Nepavyko gauti čiaupo informacijos$/);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(qrCodes()).toHaveLength(0);
  });


  it('holds the claim while the faucet info could not be read — Phantom is not asked to sign, nothing is sent', async () => {
    given.error('get', '/api/svm/:network/faucet-balance', 'Vidinė serverio klaida', 500);
    const calls = given.capture('get', '/api/svm/:network/request', f.svmPayout());
    const { user, phantom, claim } = await atClaimStep();
    expect(claim).toHaveAttribute('aria-disabled', 'true');
    await expect(user.click(claim)).rejects.toThrow(/pointer-events: none/);
    claim.focus();
    await user.keyboard('{Enter}');
    await settle(100);
    expect(phantom.callsTo('signMessage')).toEqual([]);
    expect(calls).toHaveLength(0);
  });


  it('recovers from a failed first load on the next poll — the numbers, the return card and the claim come back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    given.sequence('get', '/api/svm/:network/faucet-balance', [
      { status: 500, body: { error: 'Vidinė serverio klaida' } },
      { body: f.svmBalance() },
    ]);
    const { claim } = await atClaimStep();
    expect(claim).toHaveAttribute('aria-disabled', 'true');
    await advance(5000);
    await waitFor(() => expect(row('Čiaupo balansas:')).toHaveTextContent('498.250 devSOL'));
    expect(screen.queryByText('Nepavyko gauti čiaupo informacijos')).toBeNull();
    expect(qrCodes()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Gauti Solana Devnet valiutos' })).toHaveAttribute('aria-disabled', 'false');
  });
});







// -----------------------------------------------------------
// Installing Phantom
// -----------------------------------------------------------
//
// Step one: the download link, the stepper's four steps; only
// window.phantom.solana counts, and an extension that injects
// late is picked up without a reload.
// -----------------------------------------------------------

describe('Installing Phantom', () => {

  it('without Phantom shows the four steps, the first one current, and the download link', async () => {
    renderSvm();
    await pageLoaded();
    expect(stepLabels()).toEqual(['Susidiegti Phantom', 'Prijungti Phantom', 'Įsijungti Solana Devnet tinklą', 'Atsisiųsti Solana Devnet devSOL']);
    expect(currentStep()).toHaveTextContent('Susidiegti Phantom');
    const link = screen.getByRole('link', { name: 'Susidiegti Phantom' });
    expect(link).toHaveAttribute('href', 'https://phantom.com/download');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText('Phantom Solana Devnet įjungiamas taip:')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Gauti/ })).toBeNull();
  });


  it('ignores a wallet squatting the shared window.solana slot', async () => {
    const squatter = createPhantom({ connected: true }).installLegacy();
    renderSvm();
    await pageLoaded();
    expect(screen.getByRole('link', { name: 'Susidiegti Phantom' })).toBeInTheDocument();
    expect(squatter.calls).toEqual([]);
  });


  it('picks up a Phantom that injects after the page mounted, without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const phantom = createPhantom();
    renderSvm();
    await pageLoaded();
    expect(screen.getByRole('link', { name: 'Susidiegti Phantom' })).toBeInTheDocument();
    phantom.install();
    await advance(300);
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Connecting
// -----------------------------------------------------------
//
// Step two: the popup on the click, a Trusted App coming back
// without one, and the refusals as alerts.
// -----------------------------------------------------------

describe('Connecting', () => {

  it('offers "Prijungti piniginę" when Phantom is there but not connected, the second step current', async () => {
    installPhantom();
    renderSvm();
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Prijungti Phantom');
    expect(screen.getAllByText('atlikta')).toHaveLength(1);
  });


  it('connects through the popup on the click and moves on to the cluster step', async () => {
    const phantom = installPhantom();
    const { user } = renderSvm();
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('button', { name: 'Persijungti į Solana Devnet tinklą' })).toBeInTheDocument();
    expect(phantom.callsTo('connect')).toEqual([[{ onlyIfTrusted: true }], []]);
    expect(currentStep()).toHaveTextContent('Įsijungti Solana Devnet tinklą');
  });


  it('comes back connected without a click on an origin Phantom trusts', async () => {
    installPhantom({ trusted: true });
    renderSvm();
    expect(await screen.findByRole('button', { name: 'Persijungti į Solana Devnet tinklą' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prijungti piniginę' })).toBeNull();
  });


  it('says so when the student refuses the popup, and stays on the connect step', async () => {
    installPhantom({ connect: 'reject' });
    const { user } = renderSvm();
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Prijungimas atmestas Phantom lange\.$/);
    expect(screen.getByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
  });


  it("shows Phantom's own words for any other connect failure", async () => {
    installPhantom({ connect: new Error('Phantom užrakinta. Atrakinkite plėtinį.') });
    const { user } = renderSvm();
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Phantom užrakinta. Atrakinkite plėtinį.');
  });
});







// -----------------------------------------------------------
// The cluster step
// -----------------------------------------------------------
//
// Step three: Phantom has no programmatic cluster switch, so
// the step passes on the click and the Testnet Mode
// instructions stay on screen until a wallet confirms a hop.
// Devnet is the configured network; a Testnet one (the
// backend supports it) must be served the same way, its
// instructions naming Testnet — Phantom's own name for a
// cluster, or the config's key when Phantom has none.
// -----------------------------------------------------------

describe('The cluster step', () => {

  it('asks to switch to Solana Devnet and lists the Testnet Mode clicks', async () => {
    installPhantom({ connected: true });
    renderSvm();
    expect(await screen.findByRole('button', { name: 'Persijungti į Solana Devnet tinklą' })).toBeInTheDocument();
    expect(screen.getByText('Phantom Solana Devnet įjungiamas taip:')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((item) => item.textContent)).toEqual(DEVNET_CLICKS);
    expect(screen.getByText('Čiaupo monetos visada keliauja į Devnet. Jei piniginė vis dar rodo mainnet, gautų monetų ten nematysite.')).toBeInTheDocument();
  });


  it('asks Phantom to change to the Devnet genesis hash on the click', async () => {
    const phantom = installPhantom({ connected: true });
    const { user } = renderSvm();
    await passClusterStep(user);
    expect(phantom.callsTo('request')).toEqual([[{ method: 'changeNetwork', params: { genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' } }]]);
  });


  it("passes on Phantom's missing method, keeping the instructions under the claim button — the hop is unconfirmed", async () => {
    const { claim } = await atClaimStep();
    expect(claim).toBeInTheDocument();
    expect(screen.getByText('Phantom Solana Devnet įjungiamas taip:')).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Atsisiųsti Solana Devnet devSOL');
    expect(screen.getAllByText('atlikta')).toHaveLength(3);
  });


  it('drops the instructions when the wallet confirms the hop', async () => {
    await atClaimStep({ changeNetwork: 'confirm' });
    expect(screen.queryByText('Phantom Solana Devnet įjungiamas taip:')).toBeNull();
  });


  it.each([
    ['a refused switch', 'reject', 'Persijungimas atmestas Phantom lange.'],
    ['a real failure', phantomError(-32603, 'Internal JSON-RPC error'), 'Nepavyko persijungti į tinklą: Internal JSON-RPC error'],
  ])('keeps the step and says so after %s', async (_, answer, message) => {
    installPhantom({ connected: true, changeNetwork: answer });
    const { user } = renderSvm();
    await user.click(await screen.findByRole('button', { name: 'Persijungti į Solana Devnet tinklą' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(screen.getByRole('button', { name: 'Persijungti į Solana Devnet tinklą' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gauti Solana Devnet valiutos' })).toBeNull();
  });


  it('refuses a cluster it has no genesis hash for', async () => {
    given.json('get', '/api/svm/networks', networksWith({ cluster: 'localnet' }));
    const phantom = installPhantom({ connected: true });
    const { user } = renderSvm();
    await user.click(await screen.findByRole('button', { name: 'Persijungti į Solana Devnet tinklą' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Nežinomas SVM tinklas\.$/);
    expect(phantom.callsTo('request')).toEqual([]);
  });


  it('needs no cluster step — and shows no cluster help — for a network that names no cluster', async () => {
    given.json('get', '/api/svm/networks', networksWith({ cluster: undefined }));
    installPhantom({ connected: true });
    renderSvm();
    expect(await screen.findByRole('button', { name: 'Gauti Solana Devnet valiutos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Persijungti į Solana Devnet tinklą' })).toBeNull();
    expect(screen.queryByText(/įjungiamas taip:$/)).toBeNull();
  });


  it('asks for the Testnet genesis hash on a Solana Testnet faucet', async () => {
    const phantom = installPhantom({ connected: true });
    const { user } = renderWithPicker('solanaTestnet');
    await passClusterStep(user, 'Solana Testnet');
    expect(phantom.callsTo('request')).toEqual([[{ method: 'changeNetwork', params: { genesisHash: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY' } }]]);
  });


  it("names the network's own cluster in the help — a Solana Testnet faucet never sends the student to Devnet", async () => {
    installPhantom({ connected: true });
    renderWithPicker('solanaTestnet');
    expect(await screen.findByRole('button', { name: 'Persijungti į Solana Testnet tinklą' })).toBeInTheDocument();
    expect(screen.getByText('Phantom Solana Testnet įjungiamas taip:')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((item) => item.textContent)).toEqual(TESTNET_CLICKS);
    expect(screen.getByText('Čiaupo monetos visada keliauja į Testnet. Jei piniginė vis dar rodo mainnet, gautų monetų ten nematysite.')).toBeInTheDocument();
    // The picker's own "Devnet" link aside, nothing on the page may name Devnet
    expect(screen.queryAllByText(/Devnet/, { ignore: 'a, script, style' })).toEqual([]);
  });


  it('keeps the Testnet help under the claim button while the hop is unconfirmed', async () => {
    installPhantom({ connected: true });
    const { user } = renderWithPicker('solanaTestnet');
    await passClusterStep(user, 'Solana Testnet');
    expect(screen.getByText('Phantom Solana Testnet įjungiamas taip:')).toBeInTheDocument();
    expect(screen.queryAllByText(/Devnet/, { ignore: 'a, script, style' })).toEqual([]);
  });


  it("calls a cluster Phantom has no name for by the network's own key", async () => {
    given.json('get', '/api/svm/networks', networksWith({ cluster: 'localnet' }));
    installPhantom({ connected: true });
    renderSvm();
    expect(await screen.findByText('Phantom localnet įjungiamas taip:')).toBeInTheDocument();
    expect(screen.getByText('Tinklo sąraše pasirinkite „localnet“, ne „Solana“')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The student's own balance
// -----------------------------------------------------------
//
// getBalance against the public cluster RPC the catalog names,
// shown once the flow is through; four states that must not
// blur: not connected, "Kraunama…", a number, a dash.
// -----------------------------------------------------------

describe("The student's own balance", () => {

  it('reads it with getBalance from the public Devnet RPC, at the confirmed commitment', async () => {
    const bodies = captureRpc();
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:1\.500 devSOL$/));
    expect(bodies[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [STUDENT_SOL, { commitment: 'confirmed' }] });
  });


  it('asks the RPC nothing before a wallet is connected', async () => {
    const bodies = captureRpc();
    installPhantom();
    renderSvm();
    await screen.findByRole('button', { name: 'Prijungti piniginę' });
    await settle(100);
    expect(bodies).toEqual([]);
  });


  it('keeps "Piniginė neprijungta" until the cluster step is passed', async () => {
    captureRpc();
    installPhantom({ connected: true });
    renderSvm();
    await screen.findByRole('button', { name: 'Persijungti į Solana Devnet tinklą' });
    await settle(100);
    expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:Piniginė neprijungta$/);
  });


  it('says "Kraunama…" while the RPC is thinking', async () => {
    given.hang('post', RPC);
    await atClaimStep();
    expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:Kraunama…$/);
  });


  it('shows a real zero as 0.000', async () => {
    captureRpc(() => 0);
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:0\.000 devSOL$/));
  });


  it.each([
    ['a JSON-RPC error answered with HTTP 200', () => given.json('post', RPC, { jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node is behind by 42 slots' } })],
    ['an HTTP 500', () => given.error('post', RPC, 'Internal error', 500)],
    ['a rate limit (429)', () => given.json('post', RPC, { jsonrpc: '2.0', id: 1, error: { code: 429, message: 'Too many requests for a specific RPC call' } }, { status: 429 })],
    ['a dropped connection', () => given.networkError('post', RPC)],
  ])('shows a dash — never a zero, never a lasting "Kraunama…" — for %s', async (_, answer) => {
    answer();
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:-$/));
  });


  it('asks again every 5 s, and turns a dash back into the number when the RPC recovers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    given.sequence('post', RPC, [
      { status: 500, body: { error: 'Internal error' } },
      { body: { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: f.STUDENT_SVM_LAMPORTS } } },
    ]);
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent('Jūsų Phantom balansas:-'));
    await advance(5000);
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:1\.500 devSOL$/));
  });


  it('follows the account the student switches to inside Phantom', async () => {
    const bodies = captureRpc((address) => (address === OTHER_SOL ? 250000000 : f.STUDENT_SVM_LAMPORTS));
    const { phantom } = await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent('1.500 devSOL'));
    act(() => { phantom.changeAccount(OTHER_SOL); });
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:0\.250 devSOL$/));
    expect(bodies.at(-1).params[0]).toBe(OTHER_SOL);
  });


  it.each([
    ["a proxy's page answered 200", () => given.text('post', RPC, '<html><body>Palaukite…</body></html>')],
    ['a JSON-RPC answer with neither result nor error', () => given.json('post', RPC, { jsonrpc: '2.0', id: 1 })],
    ['a result without a number in it', () => given.json('post', RPC, { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: null } })],
  ])('shows a dash — never a lasting "Kraunama…" — for an RPC answer that carries no balance: %s', async (_, answer) => {
    answer();
    await atClaimStep();
    await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:-$/), { timeout: 1500 });
  });
});







// -----------------------------------------------------------
// The claim
// -----------------------------------------------------------
//
// Sign the ownership message in Phantom, then GET
// /api/svm/<network>/request?address=&signature=&nonce= — the
// in-flight state, the outcome rows (the payout's transaction
// linked to the explorer), every refusal from the wallet and
// from the backend, and the failures that carry no sentence
// of their own, in Lithuanian.
// -----------------------------------------------------------

describe('The claim', () => {

  it("signs the backend's message and sends the address, the base58 signature and the very nonce that was signed", async () => {
    const calls = given.capture('get', '/api/svm/:network/request', f.svmPayout());
    const { user, phantom, claim } = await atClaimStep();
    await user.click(claim);
    await waitFor(() => expect(calls).toHaveLength(1));
    const { nonce } = calls[0].query;
    expect(nonce).toMatch(/^\d{13}$/);
    expect(phantom.signedTexts()).toEqual([claimMessage(nonce)]);
    expect(calls[0].params.network).toBe('solanaDevnet');
    expect(calls[0].query).toEqual({ address: STUDENT_SOL, signature: bs58.encode(SOL_SIGNATURE), nonce });
  });


  it("says the coins are on their way and names the transaction in full, linked to the network's explorer", async () => {
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(exactly(`Solana Devnet išsiųstas į jūsų piniginę. Transakcija: ${TXID}`));
    const link = within(alert).getByRole('link', { name: TXID });
    // The Solana explorer learns its cluster after the question
    // mark — the transaction's path goes in front of it
    expect(link).toHaveAttribute('href', `https://explorer.solana.com/tx/${TXID}?cluster=devnet`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // An 88-character id wraps inside the alert instead of
    // widening the card — the class is where that lives
    expect(link).toHaveClass('break-all', 'underline');
    expect(screen.getByRole('button', { name: 'Gauti Solana Devnet valiutos' })).toBeInTheDocument();
  });


  it('links a Testnet payout to the Testnet explorer', async () => {
    given.json('get', '/api/svm/:network/request', f.svmPayout());
    installPhantom({ connected: true });
    const { user } = renderWithPicker('solanaTestnet');
    await user.click(await passClusterStep(user, 'Solana Testnet'));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: TXID })).toHaveAttribute('href', `https://explorer.solana.com/tx/${TXID}?cluster=testnet`);
  });


  it.each([
    ['names no explorer', { block_explorer_urls: [] }],
    ['names an explorer address that is no URL', { block_explorer_urls: ['explorer.solana.com'] }],
  ])('shows the transaction id as plain text when the network %s', async (_, changes) => {
    given.json('get', '/api/svm/networks', networksWith(changes));
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(exactly(`Solana Devnet išsiųstas į jūsų piniginę. Transakcija: ${TXID}`));
    expect(within(alert).queryByRole('link')).toBeNull();
  });


  it('asks for both balances again right after the payout', async () => {
    const balances = given.capture('get', '/api/svm/:network/faucet-balance', f.svmBalance());
    const bodies = captureRpc();
    const { user, claim } = await atClaimStep();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(balances).toHaveLength(1);
    await user.click(claim);
    await screen.findByText(/^Solana Devnet išsiųstas į jūsų piniginę\./);
    await waitFor(() => expect(balances).toHaveLength(2), { timeout: 1000 });
    await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 1000 });
  });


  it('shows "Siunčiama…" on a busy button while the claim is on its way, and neither a click nor the keyboard sends a second one', async () => {
    let count = 0;
    server.use(http.get(url('/api/svm/:network/request'), () => { count += 1; return new Promise(() => {}); }));
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
    const { user, claim, phantom } = await atClaimStep();
    await user.dblClick(claim);
    await screen.findByRole('button', { name: 'Siunčiama…' });
    await settle(100);
    expect(held.requests).toBe(1);
    expect(phantom.callsTo('signMessage')).toHaveLength(1);
    await held.release();
    expect(await screen.findByText(/^Solana Devnet išsiųstas į jūsų piniginę\./)).toBeInTheDocument();
  });


  it.each([
    ['refuses to sign', { sign: 'reject' }, 'Pasirašymas atmestas Phantom lange.'],
    ['signs with another account', { sign: { signer: OTHER_SOL } }, 'Phantom pasirašė kita paskyra. Perjunkite paskyrą ir bandykite dar kartą.'],
    ['answers an empty signature', { sign: 'empty' }, 'Phantom negrąžino parašo.'],
  ])('asks the backend nothing when Phantom %s, and says why', async (_, options, message) => {
    const calls = given.capture('get', '/api/svm/:network/request', f.svmPayout());
    const { user, claim } = await atClaimStep(options);
    await user.click(claim);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(calls).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Gauti Solana Devnet valiutos' })).toHaveAttribute('aria-disabled', 'false');
  });


  it.each([
    ['the cooldown', 429, f.COOLDOWN_MESSAGE],
    ['the empty faucet', 503, f.EMPTY_FAUCET_MESSAGE],
    ['a signature that does not match the address', 403, 'Parašas neatitinka nurodyto adreso. Prijunkite tą pačią piniginę ir bandykite dar kartą.'],
    ['a wallet that already has enough', 400, 'Jūsų piniginėje jau yra pakankamai SOL.'],
    ['a bad address', 400, 'Neteisingas adresas'],
    ['an unreachable cluster', 503, 'Tinklas nepasiekiamas. Bandykite vėliau.'],
    ['a failed broadcast', 500, 'Nepavyko išsiųsti transakcijos. Bandykite dar kartą.'],
  ])("shows the backend's refusal verbatim: %s", async (_, status, message) => {
    given.error('get', '/api/svm/:network/request', message, status);
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(screen.queryByText(/išsiųstas į jūsų piniginę/)).toBeNull();
  });


  it.each([
    ["a proxy's HTML error page", () => given.html('get', '/api/svm/:network/request'), `${CLAIM_FAILED} Serveris grąžino klaidą (502).`],
    ['a 500 with no body', () => given.empty('get', '/api/svm/:network/request', 500), `${CLAIM_FAILED} Serveris grąžino klaidą (500).`],
    ['a dropped connection', () => given.networkError('get', '/api/svm/:network/request'), `${CLAIM_FAILED} Patikrinkite interneto ryšį.`],
  ])("says it in Lithuanian, never in axios's English, for %s", async (_, answer, message) => {
    answer();
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
  });


  it.each([
    ['an empty object', () => given.json('get', '/api/svm/:network/request', {}), CLAIM_FAILED],
    ["a proxy's page", () => given.text('get', '/api/svm/:network/request', '<html><body>Palaukite…</body></html>'), CLAIM_FAILED],
    ['a transaction id that is no string', () => given.json('get', '/api/svm/:network/request', { ...f.svmPayout(), transaction_id: 12345 }), CLAIM_FAILED],
    ["a refusal sent as { error }", () => given.json('get', '/api/svm/:network/request', { error: f.COOLDOWN_MESSAGE }), f.COOLDOWN_MESSAGE],
  ])('treats a 200 answer that names no transaction as a failure, not a payout: %s', async (_, answer, message) => {
    answer();
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(screen.queryByText(/išsiųstas į jūsų piniginę/)).toBeNull();
    expect(document.querySelector('a[href*="/tx/"]')).toBeNull();
  });


  it('adds one outcome row per claim, and a row closes on its ×', async () => {
    given.error('get', '/api/svm/:network/request', f.COOLDOWN_MESSAGE, 429);
    const { user, claim } = await atClaimStep();
    await user.click(claim);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Gauti Solana Devnet valiutos' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    await user.click(within(screen.getAllByRole('alert')[0]).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
  });


  it('claims for the account the student switched to inside Phantom', async () => {
    const calls = given.capture('get', '/api/svm/:network/request', f.svmPayout());
    const { user, phantom, claim } = await atClaimStep();
    act(() => { phantom.changeAccount(OTHER_SOL); });
    await user.click(claim);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].query.address).toBe(OTHER_SOL);
  });
});







// -----------------------------------------------------------
// Changes inside Phantom
// -----------------------------------------------------------
//
// A disconnect or an untrusted account change sends the page
// back to connecting; the cluster step must then be passed
// again.
// -----------------------------------------------------------

describe('Changes inside Phantom', () => {

  it('goes back to "Prijungti piniginę" on a disconnect, hiding the claim and the student\'s balance', async () => {
    const { phantom } = await atClaimStep();
    await act(async () => { await phantom.provider.disconnect(); });
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gauti Solana Devnet valiutos' })).toBeNull();
    expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:Piniginė neprijungta$/);
  });


  it('asks for the cluster step again after reconnecting', async () => {
    const { user, phantom } = await atClaimStep();
    await act(async () => { await phantom.provider.disconnect(); });
    await user.click(await screen.findByRole('button', { name: 'Prijungti piniginę' }));
    expect(await screen.findByRole('button', { name: 'Persijungti į Solana Devnet tinklą' })).toBeInTheDocument();
  });


  it('an account Phantom does not trust yet sends the page back to connecting while Phantom is asked again', async () => {
    const { phantom } = await atClaimStep({ connect: 'reject' });
    await act(async () => { phantom.changeAccount(null); });
    expect(await screen.findByRole('button', { name: 'Prijungti piniginę' })).toBeInTheDocument();
    expect(phantom.callsTo('connect').at(-1)).toEqual([]);
  });
});







// -----------------------------------------------------------
// The return address card
// -----------------------------------------------------------
//
// The faucet's base58 address exactly as the backend sent it
// (case-sensitive — never folded) and a QR code of exactly it.
// -----------------------------------------------------------

describe('The return address card', () => {

  it("shows the faucet's address as it is and a QR code of exactly that address", async () => {
    renderSvm();
    await pageLoaded();
    const card = screen.getByText(/^Grąžinkite nebereikalingą/);
    expect(card).toHaveTextContent(`Grąžinkite nebereikalingą devSOL krypto atgal:${f.FAUCET_SVM}`);
    expect(card).toHaveTextContent('DGvWVvGUt92p1YiffQ69Ba75stvSRMjCo6KdUtkWayC8');
    expect(qrCodes()).toHaveLength(1);
    expect(modulesOf(qrCodes()[0])).toBe(qrModulesFor(f.FAUCET_SVM));
    expect(modulesOf(qrCodes()[0])).not.toBe(qrModulesFor(f.FAUCET_SVM.toLowerCase()));
  });
});







// -----------------------------------------------------------
// Switching networks
// -----------------------------------------------------------
//
// Another SVM network on another cluster: its own cluster
// step, the previous outcome dropped, a late answer kept off
// the new page.
// -----------------------------------------------------------

describe('Switching networks', () => {

  it('a network on another cluster asks for its own cluster step and drops the previous outcome', async () => {
    installPhantom({ connected: true });
    const { user } = renderWithPicker();
    await user.click(await passClusterStep(user));
    await screen.findByText(/^Solana Devnet išsiųstas į jūsų piniginę\./);
    await user.click(screen.getByRole('link', { name: 'Testnet' }));
    expect(await pageLoaded("Solana Testnet faucet'as")).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Persijungti į Solana Testnet tinklą' })).toBeInTheDocument();
    expect(screen.getByText('Phantom Solana Testnet įjungiamas taip:')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });


  it("never shows a claim answered after the switch on the new network's page", async () => {
    installPhantom({ connected: true });
    const { user } = renderWithPicker();
    const held = holdClaim();
    await user.click(await passClusterStep(user));
    await screen.findByRole('button', { name: 'Siunčiama…' });
    await user.click(screen.getByRole('link', { name: 'Testnet' }));
    await pageLoaded("Solana Testnet faucet'as");
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
    const calls = given.capture('get', '/api/svm/:network/faucet-balance', f.svmBalance());
    renderSvm('solanaMainnet');
    expect(await screen.findByText('Nežinomas tinklas: solanaMainnet')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    await advance(11000);
    expect(calls).toHaveLength(0);
  });


  it('says the network list could not be read instead of showing a page', async () => {
    given.error('get', '/api/svm/networks', 'Vidinė serverio klaida', 500);
    renderSvm();
    expect(await screen.findByText('Nepavyko gauti tinklų sąrašo. Perkraukite puslapį.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });


  it.each([
    ["a proxy's page", () => given.text('get', '/api/svm/networks', '<html><body>Palaukite…</body></html>')],
    ['an empty object', () => given.json('get', '/api/svm/networks', {})],
    ['a list where the map belongs', () => given.json('get', '/api/svm/networks', { ...f.svmNetworks, networks: [f.svmNetworksMap.solanaDevnet] })],
  ])('says the network list could not be read when it answers 200 without a networks map, instead of a skeleton forever: %s', async (_, answer) => {
    answer();
    renderSvm();
    expect(await screen.findByText('Nepavyko gauti tinklų sąrašo. Perkraukite puslapį.')).toBeInTheDocument();
    expect(screen.queryByText('Kraunami tinklo duomenys…')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });


  it('the real App routes /faucet/svm/solanaDevnet here, under the tab title "SVM čiaupas"', async () => {
    renderApp({ route: '/faucet/svm/solanaDevnet' });
    expect(await pageLoaded()).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("SVM čiaupas — VU KNF Faucet'as"));
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
// that clicks through to the claim: the matrix does not await
// it, the click is its last step) and the public getBalance,
// rendered on a network with no cluster so a connected wallet
// is at the claim step at once — the row's four states need
// no click.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/svm/networks',
  fixture: f.svmNetworks,
  render: () => renderSvm(),
  loaded: async () => { await pageLoaded(); },
  failed: async () => { await screen.findByText('Nepavyko gauti tinklų sąrašo. Perkraukite puslapį.'); },
  loading: () => screen.getByRole('status'),
});


describeEndpointContract({
  path: '/api/svm/:network/faucet-balance',
  fixture: f.svmBalance(),
  render: () => renderSvm(),
  // The page's title once loaded, its loading status before
  chrome: () => screen.queryByRole('heading', { level: 1, name: "Solana Devnet faucet'as" }) ?? screen.getByRole('status'),
  loaded: async () => { await waitFor(() => expect(row('Čiaupo balansas:')).toHaveTextContent('498.250 devSOL')); },
  failed: async () => {
    await waitFor(() => expect(screen.queryByText('Kraunami tinklo duomenys…')).toBeNull(), { timeout: 1000 });
    expect(screen.getByText(/Nepavyko/)).toBeInTheDocument();
  },
  loading: () => screen.getByRole('status'),
});


async function claimNow() {
  const phantom = installPhantom({ connected: true });
  const { user } = renderSvm();
  await user.click(await passClusterStep(user));
  return phantom;
}

describeEndpointContract({
  path: '/api/svm/:network/request',
  fixture: f.svmPayout(),
  only: VARIANTS.filter((variant) => variant.expect === 'failed' || variant.expect === 'loading').map((variant) => variant.name),
  render: () => { claimNow(); },
  chrome: () => screen.getByRole('heading', { level: 1, name: "Solana Devnet faucet'as" }),
  failed: async () => {
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/\S/);
    expect(alert.textContent).not.toMatch(/Network Error|Request failed with status code/);
  },
  loading: () => screen.getByRole('button', { name: 'Siunčiama…' }),
});


describeEndpointContract({
  path: RPC,
  method: 'post',
  fixture: { jsonrpc: '2.0', id: 1, result: { context: { slot: 412345678 }, value: f.STUDENT_SVM_LAMPORTS } },
  render: () => {
    given.json('get', '/api/svm/networks', networksWith({ cluster: undefined }));
    installPhantom({ connected: true });
    renderSvm();
  },
  chrome: () => screen.getByRole('heading', { level: 1, name: "Solana Devnet faucet'as" }),
  loaded: async () => { await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:1\.500 devSOL$/)); },
  failed: async () => { await waitFor(() => expect(studentBalance()).toHaveTextContent(/^Jūsų Phantom balansas:-$/)); },
  loading: () => studentBalance().textContent === 'Jūsų Phantom balansas:Kraunama…',
});

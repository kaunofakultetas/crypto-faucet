// -----------------------------------------------------------
//  [*] Tests — UTXO faucet page (/faucet/utxo/:network)
//
//  The UTXO faucet end to end against the backend double: the
//  network's own names from /api/utxo/networks (the generic
//  BTC labels while they load), what one request pays and
//  what the faucet holds — the spendable total, confirmed plus
//  unconfirmed — its skeletons, its failure and the silent
//  5 s repoll (a failed repoll keeps the numbers, a failed
//  first load recovers); the addresses the page accepts (it
//  checks none itself: bech32 tb1… / knf1… / tltc1…, base58
//  m… / 2…, whatever the student pasted, trimmed — the
//  backend's verdict is what the student sees); the payout —
//  the captured GET and its query, "Siunčiama…", a double
//  click sending once, the success line with the txid linked
//  to the chain's explorer (plain text without a usable one),
//  the cleared field, the balance refetched — and every
//  refusal (the cooldown, the empty faucet, the node's
//  too-long mempool chain, a bad address, a 500's extra
//  fields, a 200 carrying an error, a 200 that names no
//  transaction, a bare 429, a proxy's page, a dropped
//  connection — the page's own sentence with the reason after
//  it where the backend gave none); the return address card
//  (the address, its QR code, "Transakcijų grafikas" into
//  /graph/utxo/:network); a network switch in the picker
//  (outcomes dropped, the pasted address kept, a late answer
//  never landing on the wrong chain); unknown networks, a
//  failed catalog and one answered without its networks map;
//  and the backend contract matrices for /api/utxo/networks,
//  /api/utxo/:network/faucet-balance and the payout's failure
//  answers.
//
//  The page has no copy button — the address is plain,
//  selectable text.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import QRCode from 'react-qr-code';
import { renderPage, renderApp } from '../support/render';
import { server, given, url } from '../support/backend/server';
import { describeEndpointContract, VARIANTS, settle } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import FaucetUTXO from '@/pages/Faucet_UTXO/Page';


// What the backend answers when the node refuses to stack
// another unconfirmed payout on the faucet's chain
// (utxo_faucet.request_crypto — MempoolChainTooLong, 503)
const MEMPOOL_CHAIN_MESSAGE = 'Tinkle laukia per daug nepatvirtintų čiaupo transakcijų. Palaukite, kol bus iškastas naujas blokas, ir bandykite dar kartą.';

// Students' addresses on the other chains — Jonas's witness
// program under the knf / tltc HRPs (valid bech32) — and the
// two legacy base58 kinds testnet4 still accepts
const KNF_STUDENT = 'knf1qxc2wlcxvzcph96p4q9xn9hqpua7l3fv9mur855';
const KNF_FAUCET = 'knf1qvrzfhju72hv677g74ma5lwh4nyu50e4nhw4w5h';
const LTC_STUDENT = 'tltc1qxc2wlcxvzcph96p4q9xn9hqpua7l3fv99py8xw';
const LEGACY_P2PKH = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
const LEGACY_P2SH = '2N3oefVeg6stiTb5Kh3ozCSkaqmx91FDbsm';

// The txid every default payout answers with
const TXID = f.utxoPayout().transaction_id;

// The page's own sentences for a failed read; the reason
// follows them when the backend sent no sentence of its own
const FAUCET_FAILED = 'Nepavyko gauti čiaupo informacijos.';
const NETWORKS_FAILED = 'Nepavyko gauti tinklų sąrašo.';
const MALFORMED = 'Serveris atsakė netinkamo formato duomenimis.';

// The backend's own sentence when Electrum did not answer its
// balance read
const ELECTRUM_SILENT = 'Nepavyko gauti čiaupo balanso: Electrum serveris neatsakė per 15 s.';

// The network list's error card: the failure, closed with a
// full stop when it lacks one, then the next step
const networksCard = (failure) => `${failure.endsWith('.') ? failure : `${failure}.`} Perkraukite puslapį.`;







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderUtxo mounts the page on its route pattern, as App.jsx
// does; renderWithPicker adds links to other networks (the
// navbar picker's effect: the route changes, the page stays
// mounted) and a stand-in for the graph page. The row helper
// is a labelled line of the main card as the student reads
// it; spanning matches a sentence that runs through inline
// markup (underline, bold), exactly a whole text with nothing
// around it. requestTo pastes an address and presses the
// button — the student's own gesture. qrCodes finds the
// page's QR codes (an svg with no role or name: its 128 px
// size is the only handle) and qrModulesFor draws the QR of
// a value with the same component, so the page's QR can be
// checked for what it ENCODES. holdPayout keeps the payout's
// answer until the test releases it, for the tests about what
// happens while it is in flight.
// -----------------------------------------------------------

const renderUtxo = (network = 'btc4') => renderPage(<FaucetUTXO />, { route: `/faucet/utxo/${network}`, path: '/faucet/utxo/:network' });

function GraphProbe() {
  const { network } = useParams();
  return <p>Grafiko puslapis: {network}</p>;
}

function renderWithPicker(network = 'btc4') {
  return renderPage(
    <>
      <nav aria-label="Tinklai">
        {['btc4', 'knf', 'ltc4'].map((key) => <Link key={key} to={`/faucet/utxo/${key}`}>{key}</Link>)}
      </nav>
      <Routes>
        <Route path="/faucet/utxo/:network" element={<FaucetUTXO />} />
        <Route path="/graph/utxo/:network" element={<GraphProbe />} />
      </Routes>
    </>,
    { route: `/faucet/utxo/${network}` },
  );
}

const balancesLoaded = () => screen.findByText('Čiaupo balansas:');

const row = (label) => screen.getByText(label).parentElement;

const spanning = (text) => (_, element) => element?.textContent === text && [...element.children].every((child) => child.textContent !== text);

// The whole text, nothing around it
const exactly = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

const addressField = (short = 'tBTC4') => screen.getByRole('textbox', { name: `Jūsų ${short} adresas` });

async function requestTo(user, address, short = 'tBTC4') {
  await user.click(addressField(short));
  await user.paste(address);
  await user.click(screen.getByRole('button', { name: `Gauti ${short}` }));
}

const qrCodes = () => [...document.querySelectorAll('svg[height="128"]')];

const modulesOf = (svg) => svg.querySelectorAll('path')[1].getAttribute('d');

function qrModulesFor(value) {
  const { container, unmount } = render(<QRCode value={value} size={128} />);
  const drawn = modulesOf(container.querySelector('svg'));
  unmount();
  return drawn;
}

// The network list with one network's entry changed
const networksWith = (key, changes) => ({
  ...f.utxoNetworks,
  networks: { ...f.utxoNetworksMap, [key]: { ...f.utxoNetworksMap[key], ...changes } },
});

// A payout answer the test releases itself, so it lands
// exactly when the test says — not when a timer happens to
// fire. release() first waits for the request to have
// arrived; `requests` counts what arrived meanwhile.
function holdPayout(body = f.utxoPayout()) {
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
  server.use(http.get(url('/api/utxo/:network/request-btc'), () => {
    held.requests += 1;
    arrived();
    return new Promise((resolve) => { answer = resolve; });
  }));
  return held;
}







// -----------------------------------------------------------
// The faucet card
// -----------------------------------------------------------
//
// The names from the network list, the two numbers from the
// faucet's balance, their skeletons and their failures.
// -----------------------------------------------------------

describe('The faucet card', () => {

  it('names the network in the heading, the lab sentence and the address field', async () => {
    renderUtxo();
    expect(await screen.findByRole('heading', { level: 1, name: "Bitcoin Testnet4 faucet'as" })).toBeInTheDocument();
    expect(screen.getByText(spanning('Šiuo įrankiu galite gauti Bitcoin Testnet4 testinės kriptovaliutos laboratoriniams darbams.'))).toBeInTheDocument();
    expect(addressField()).toHaveAttribute('placeholder', 'pvz. tb1q…');
  });


  it('shows what one request pays and what the faucet holds, to three decimals with the ticker', async () => {
    renderUtxo();
    await balancesLoaded();
    expect(row('Išsiųsime jums:')).toHaveTextContent(/^Išsiųsime jums:0\.100 tBTC4$/);
    expect(row('Čiaupo balansas:')).toHaveTextContent(/^Čiaupo balansas:1250\.605 tBTC4$/);
  });


  it.each([
    ['a payout still unconfirmed (negative unconfirmed part)', { balance: 0.75, balance_confirmed: 1.0, balance_unconfirmed: -0.25 }, '0.750 tBTC4'],
    ['a return still unconfirmed (positive unconfirmed part)', { balance: 1.25, balance_confirmed: 1.0, balance_unconfirmed: 0.25 }, '1.250 tBTC4'],
  ])('shows the spendable total — confirmed plus unconfirmed — with %s', async (_, parts, shown) => {
    given.json('get', '/api/utxo/:network/faucet-balance', { ...f.utxoBalance(), ...parts });
    renderUtxo();
    await balancesLoaded();
    expect(row('Čiaupo balansas:')).toHaveTextContent(`Čiaupo balansas:${shown}`);
    expect(screen.queryByText('1.000 tBTC4')).toBeNull();
  });


  it('reads 0.000 for an empty faucet', async () => {
    given.json('get', '/api/utxo/:network/faucet-balance', { ...f.utxoBalance(), balance: 0, balance_confirmed: 0, balance_unconfirmed: 0 });
    renderUtxo();
    await balancesLoaded();
    expect(row('Čiaupo balansas:')).toHaveTextContent(/^Čiaupo balansas:0\.000 tBTC4$/);
  });


  it("speaks each chain's own ticker: KNF Coin pays out 1000 KNF", async () => {
    given.json('get', '/api/utxo/:network/faucet-balance', { ...f.utxoBalance(), address: KNF_FAUCET, balance: 250000, chunk_size: 1000 });
    renderUtxo('knf');
    expect(await screen.findByRole('heading', { level: 1, name: "KNF Coin faucet'as" })).toBeInTheDocument();
    await balancesLoaded();
    expect(row('Išsiųsime jums:')).toHaveTextContent(/^Išsiųsime jums:1000\.000 KNF$/);
    expect(row('Čiaupo balansas:')).toHaveTextContent(/^Čiaupo balansas:250000\.000 KNF$/);
    expect(addressField('KNF')).toBeInTheDocument();
  });


  it('shows skeletons and holds the button while the first balance is on its way', async () => {
    given.hang('get', '/api/utxo/:network/faucet-balance');
    const { user } = renderUtxo();
    await screen.findByRole('heading', { level: 1, name: "Bitcoin Testnet4 faucet'as" });
    await settle();
    // MUI's Skeleton has no role and no text — its class is the only handle
    expect(document.querySelector('.MuiSkeleton-root')).not.toBeNull();
    expect(screen.queryByText('Čiaupo balansas:')).toBeNull();
    expect(screen.queryByText(f.FAUCET_UTXO)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Transakcijų grafikas' })).toBeNull();
    await user.click(addressField());
    await user.paste(f.JONAS);
    expect(screen.getByRole('button', { name: 'Gauti tBTC4' })).toBeDisabled();
  });


  it("says what went wrong — the backend's own sentence — and keeps the button disabled", async () => {
    given.error('get', '/api/utxo/:network/faucet-balance', ELECTRUM_SILENT, 500);
    const { user } = renderUtxo();
    expect((await screen.findByRole('alert')).textContent).toBe(ELECTRUM_SILENT);
    await user.click(addressField());
    await user.paste(f.JONAS);
    expect(screen.getByRole('button', { name: 'Gauti tBTC4' })).toBeDisabled();
    // No return card for a faucet the page knows nothing about
    expect(screen.queryByText(f.FAUCET_UTXO)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Transakcijų grafikas' })).toBeNull();
    expect(qrCodes()).toHaveLength(0);
  });


  it('shows a balance answered as { error } with HTTP 200 as that error, and blocks the request', async () => {
    given.json('get', '/api/utxo/:network/faucet-balance', { error: 'Čiaupas laikinai išjungtas' });
    const { user } = renderUtxo();
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Čiaupas laikinai išjungtas$/);
    await user.click(addressField());
    await user.paste(f.JONAS);
    expect(screen.getByRole('button', { name: 'Gauti tBTC4' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Transakcijų grafikas' })).toBeNull();
  });
});







// -----------------------------------------------------------
// The balance repoll
// -----------------------------------------------------------
//
// Every 5 s, silently: no skeleton flash, a failed repoll
// keeps the last numbers, a first load that failed recovers.
// Fake timers that keep flowing (shouldAdvanceTime), so the
// requests in between still get their answers.
// -----------------------------------------------------------

describe('The balance repoll', () => {

  const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });


  it('asks for the balance again every 5 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = given.capture('get', '/api/utxo/:network/faucet-balance', f.utxoBalance());
    renderUtxo();
    await balancesLoaded();
    expect(calls).toHaveLength(1);
    await advance(5000);
    await waitFor(() => expect(calls).toHaveLength(2));
    await advance(5000);
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.every((call) => call.params.network === 'btc4')).toBe(true);
  });


  it('shows a new number from a repoll in place of the old one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    given.sequence('get', '/api/utxo/:network/faucet-balance', [
      { body: f.utxoBalance() },
      { body: { ...f.utxoBalance(), balance: 1249.5 } },
    ]);
    renderUtxo();
    expect(await screen.findByText('1250.605 tBTC4')).toBeInTheDocument();
    await advance(5000);
    expect(await screen.findByText('1249.500 tBTC4')).toBeInTheDocument();
  });


  it('repolls silently: the numbers stay and nothing turns to a skeleton while the next answer is on its way', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderUtxo();
    await balancesLoaded();
    given.hang('get', '/api/utxo/:network/faucet-balance');
    await advance(5000);
    await settle();
    expect(row('Čiaupo balansas:')).toHaveTextContent('1250.605 tBTC4');
    expect(document.querySelector('.MuiSkeleton-root')).toBeNull();
    await user.click(addressField());
    await user.paste(f.JONAS);
    expect(screen.getByRole('button', { name: 'Gauti tBTC4' })).toBeEnabled();
  });


  it('keeps the last numbers on screen when a repoll fails, and shows no error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = [];
    server.use(http.get(url('/api/utxo/:network/faucet-balance'), () => {
      calls.push(1);
      return calls.length === 1 ? HttpResponse.json(f.utxoBalance()) : HttpResponse.json({ error: 'Vidinė serverio klaida' }, { status: 500 });
    }));
    renderUtxo();
    await balancesLoaded();
    await advance(5000);
    await waitFor(() => expect(calls).toHaveLength(2));
    await settle();
    expect(row('Čiaupo balansas:')).toHaveTextContent('1250.605 tBTC4');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(f.FAUCET_UTXO)).toBeInTheDocument();
  });


  it('recovers from a failed first load on the next poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    given.sequence('get', '/api/utxo/:network/faucet-balance', [
      { status: 500, body: { error: 'Vidinė serverio klaida' } },
      { body: f.utxoBalance() },
    ]);
    renderUtxo();
    expect(await screen.findByText('Vidinė serverio klaida')).toBeInTheDocument();
    await advance(5000);
    expect(await screen.findByText('1250.605 tBTC4')).toBeInTheDocument();
    expect(screen.queryByText('Vidinė serverio klaida')).toBeNull();
    expect(screen.getByRole('link', { name: 'Transakcijų grafikas' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Addresses
// -----------------------------------------------------------
//
// The page checks no address itself — bech32 or base58, any
// chain's, even nonsense: it sends what was pasted, trimmed,
// and shows what the backend says about it.
// -----------------------------------------------------------

describe('Addresses', () => {

  it.each([
    ['btc4', 'a bech32 P2WPKH tb1q…', f.JONAS, 'tBTC4'],
    ['btc4', 'a bech32 P2WSH tb1q… (62 characters)', f.EGLE, 'tBTC4'],
    ['btc4', 'a legacy base58 P2PKH m…', LEGACY_P2PKH, 'tBTC4'],
    ['btc4', 'a base58 P2SH 2…', LEGACY_P2SH, 'tBTC4'],
    ['knf', 'a bech32 knf1…', KNF_STUDENT, 'KNF'],
    ['ltc4', 'a bech32 tltc1…', LTC_STUDENT, 'tLTC4'],
  ])('on %s sends %s exactly as pasted', async (network, _, address, short) => {
    const calls = given.capture('get', '/api/utxo/:network/request-btc', f.utxoPayout(network));
    const { user } = renderUtxo(network);
    await balancesLoaded();
    await requestTo(user, address, short);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].params.network).toBe(network);
    expect(calls[0].query).toEqual({ address });
  });


  it('trims the spaces and tabs a paste drags along', async () => {
    const calls = given.capture('get', '/api/utxo/:network/request-btc', f.utxoPayout());
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, `   ${f.JONAS}\t  `);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].query.address).toBe(f.JONAS);
  });


  it('asks for an address on a disabled button while the field is empty or blank', async () => {
    const { user } = renderUtxo();
    await balancesLoaded();
    expect(screen.getByRole('button', { name: 'ĮKLIJUOKITE ADRESĄ' })).toBeDisabled();
    await user.click(addressField());
    await user.paste('   ');
    expect(screen.getByRole('button', { name: 'ĮKLIJUOKITE ADRESĄ' })).toBeDisabled();
    await user.clear(addressField());
    await user.paste(f.JONAS);
    expect(screen.getByRole('button', { name: 'Gauti tBTC4' })).toBeEnabled();
  });


  it("sends even a malformed address and shows the backend's verdict", async () => {
    const calls = given.capture('get', '/api/utxo/:network/request-btc', { error: 'Neteisingas adresas' }, { status: 400 });
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, 'labas');
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Neteisingas adresas$/);
    expect(calls[0].query).toEqual({ address: 'labas' });
  });


  it("shows the backend's refusal of the faucet's own address", async () => {
    given.error('get', '/api/utxo/:network/request-btc', 'Negalima siųsti į čiaupo adresą', 400);
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.FAUCET_UTXO);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Negalima siųsti į čiaupo adresą$/);
  });
});







// -----------------------------------------------------------
// The payout
// -----------------------------------------------------------
//
// GET /api/utxo/<network>/request-btc?address=: the request,
// the in-flight state, the success line with the explorer
// link, and what follows a payout.
// -----------------------------------------------------------

describe('The payout', () => {

  it('asks GET /api/utxo/btc4/request-btc once, with the address as its only parameter', async () => {
    const calls = given.capture('get', '/api/utxo/:network/request-btc', f.utxoPayout());
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    await screen.findByText(/^Išsiųsta/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${url('/api/utxo/btc4/request-btc')}?address=${f.JONAS}`);
  });


  it("announces the payout with the amount, the ticker and the txid linked to the network's explorer", async () => {
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Išsiųsta 0.1 tBTC4. Transakcija: ${TXID}`);
    const link = within(alert).getByRole('link', { name: TXID });
    expect(link).toHaveAttribute('href', `https://mempool.space/testnet4/tx/${TXID}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });


  it.each([
    ['knf', 'KNF', KNF_STUDENT, 'https://knfcoin.knf.vu.lt/explorer'],
    ['ltc4', 'tLTC4', LTC_STUDENT, 'https://litecoinspace.org/testnet'],
  ])("links a %s payout to that chain's own explorer", async (network, short, address, explorer) => {
    const { user } = renderUtxo(network);
    await balancesLoaded();
    await requestTo(user, address, short);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: TXID })).toHaveAttribute('href', `${explorer}/tx/${TXID}`);
  });


  it('never doubles the slash of an explorer URL that ends with one', async () => {
    given.json('get', '/api/utxo/networks', networksWith('btc4', { block_explorer: 'https://mempool.space/testnet4/' }));
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: TXID })).toHaveAttribute('href', `https://mempool.space/testnet4/tx/${TXID}`);
  });


  it('shows the txid as plain text when the network names no explorer', async () => {
    given.json('get', '/api/utxo/networks', networksWith('btc4', { block_explorer: null }));
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Išsiųsta 0.1 tBTC4. Transakcija: ${TXID}`);
    expect(within(alert).queryByRole('link')).toBeNull();
  });


  it('shows the txid as plain text when the explorer address is no usable URL, never a link relative to the faucet', async () => {
    given.json('get', '/api/utxo/networks', networksWith('btc4', { block_explorer: 'mempool.space/testnet4' }));
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Išsiųsta 0.1 tBTC4. Transakcija: ${TXID}`);
    expect(within(alert).queryByRole('link')).toBeNull();
  });


  it('clears the field after a payout — the button asks for the next address', async () => {
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    await screen.findByText(/^Išsiųsta/);
    expect(addressField()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'ĮKLIJUOKITE ADRESĄ' })).toBeDisabled();
  });


  it("asks for the faucet's balance again right after a payout, not at the next 5 s poll", async () => {
    const balances = given.capture('get', '/api/utxo/:network/faucet-balance', f.utxoBalance());
    const { user } = renderUtxo();
    await balancesLoaded();
    expect(balances).toHaveLength(1);
    await requestTo(user, f.JONAS);
    await screen.findByText(/^Išsiųsta/);
    await waitFor(() => expect(balances).toHaveLength(2), { timeout: 1000 });
  });


  it('shows "Siunčiama…" on a disabled button while the payout is on its way', async () => {
    given.hang('get', '/api/utxo/:network/request-btc');
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    expect(await screen.findByRole('button', { name: 'Siunčiama…' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });


  it('sends one request for a double click', async () => {
    const held = holdPayout();
    const { user } = renderUtxo();
    await balancesLoaded();
    await user.click(addressField());
    await user.paste(f.JONAS);
    await user.dblClick(screen.getByRole('button', { name: 'Gauti tBTC4' }));
    await screen.findByRole('button', { name: 'Siunčiama…' });
    await settle(100);
    expect(held.requests).toBe(1);
    await held.release();
    expect(await screen.findByText(/^Išsiųsta/)).toBeInTheDocument();
  });


  it('drops the previous outcome the moment a new attempt starts', async () => {
    given.error('get', '/api/utxo/:network/request-btc', f.COOLDOWN_MESSAGE, 429);
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    await screen.findByText(f.COOLDOWN_MESSAGE);
    given.hang('get', '/api/utxo/:network/request-btc');
    await user.click(screen.getByRole('button', { name: 'Gauti tBTC4' }));
    await waitFor(() => expect(screen.queryByText(f.COOLDOWN_MESSAGE)).toBeNull());
    expect(screen.getByRole('button', { name: 'Siunčiama…' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Refusals
// -----------------------------------------------------------
//
// The backend's sentences shown as they are; for answers that
// carry none, the page's own sentence with the reason after
// it — no connection, or the status the server answered —
// and a 200 that names no transaction is a failure too. The
// pasted address stays for another try.
// -----------------------------------------------------------

describe('Refusals', () => {

  it.each([
    ['the cooldown (429)', 429, f.COOLDOWN_MESSAGE],
    ['the empty faucet (503)', 503, f.EMPTY_FAUCET_MESSAGE],
    ["the node's too-long mempool chain (503)", 503, MEMPOOL_CHAIN_MESSAGE],
    ['a bad address (400)', 400, 'Neteisingas adresas'],
  ])('shows %s verbatim and keeps the address for another try', async (_, status, message) => {
    given.error('get', '/api/utxo/:network/request-btc', message, status);
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(screen.queryByText(/^Išsiųsta/)).toBeNull();
    expect(addressField()).toHaveValue(f.JONAS);
    expect(screen.getByRole('button', { name: 'Gauti tBTC4' })).toBeEnabled();
  });


  it('shows only the sentence of a 500, never another field it carries', async () => {
    given.json('get', '/api/utxo/:network/request-btc', { error: 'Nepavyko išsiųsti transakcijos. Bandykite dar kartą.', details: 'electrum timeout at 10.0.0.5:50001' }, { status: 500 });
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Nepavyko išsiųsti transakcijos\. Bandykite dar kartą\.$/);
    expect(screen.queryByText(/electrum timeout/)).toBeNull();
  });


  it('treats a 200 answer carrying { error } as a refusal, not a payout', async () => {
    given.json('get', '/api/utxo/:network/request-btc', { error: f.COOLDOWN_MESSAGE });
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    expect(await screen.findByRole('alert')).toHaveTextContent(f.COOLDOWN_MESSAGE);
    expect(screen.queryByText(/^Išsiųsta/)).toBeNull();
    expect(addressField()).toHaveValue(f.JONAS);
  });


  it.each([
    ['a bare 429 from a rate-limiting proxy', () => given.empty('get', '/api/utxo/:network/request-btc', 429), 'Nepavyko išsiųsti kriptovaliutos. Per daug užklausų — palaukite ir bandykite vėl.'],
    ["a proxy's HTML error page", () => given.html('get', '/api/utxo/:network/request-btc'), 'Nepavyko išsiųsti kriptovaliutos. Serveris grąžino klaidą (502).'],
    ['a 500 with no body', () => given.empty('get', '/api/utxo/:network/request-btc', 500), 'Nepavyko išsiųsti kriptovaliutos. Serveris grąžino klaidą (500).'],
    ['a dropped connection', () => given.networkError('get', '/api/utxo/:network/request-btc'), 'Nepavyko išsiųsti kriptovaliutos. Patikrinkite interneto ryšį.'],
  ])('says it in Lithuanian for %s', async (_, answer, message) => {
    answer();
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(message));
    expect(addressField()).toHaveValue(f.JONAS);
  });


  it.each([
    ['an empty object', () => given.json('get', '/api/utxo/:network/request-btc', {})],
    ["a proxy's page", () => given.text('get', '/api/utxo/:network/request-btc', '<html><body>Palaukite…</body></html>')],
    ['a transaction id that is no string', () => given.json('get', '/api/utxo/:network/request-btc', { ...f.utxoPayout(), transaction_id: 12345 })],
  ])('treats a 200 answer that names no transaction as a failure, not a payout: %s', async (_, answer) => {
    answer();
    const { user } = renderUtxo();
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Nepavyko išsiųsti kriptovaliutos\.$/);
    expect(screen.queryByText(/^Išsiųsta/)).toBeNull();
    expect(document.querySelector('a[href*="/tx/"]')).toBeNull();
    expect(addressField()).toHaveValue(f.JONAS);
  });
});







// -----------------------------------------------------------
// The return address card
// -----------------------------------------------------------
//
// The faucet's own address, as text and as a QR code that
// encodes exactly it, and the way into this network's
// transaction graph.
// -----------------------------------------------------------

describe('The return address card', () => {

  it('shows the address to send leftovers back to, as text and as a QR code of exactly that address', async () => {
    renderUtxo();
    expect(await screen.findByText(f.FAUCET_UTXO)).toBeInTheDocument();
    expect(screen.getByText(spanning('Grąžinkite nebereikalingą tBTC4 atgal:'))).toBeInTheDocument();
    expect(qrCodes()).toHaveLength(1);
    expect(modulesOf(qrCodes()[0])).toBe(qrModulesFor(f.FAUCET_UTXO));
    expect(modulesOf(qrCodes()[0])).not.toBe(qrModulesFor(f.JONAS));
  });


  it('"Transakcijų grafikas" opens this network\'s transaction graph', async () => {
    const { user } = renderWithPicker('btc4');
    const link = await screen.findByRole('link', { name: 'Transakcijų grafikas' });
    expect(link).toHaveAttribute('href', '/graph/utxo/btc4');
    await user.click(link);
    expect(await screen.findByText('Grafiko puslapis: btc4')).toBeInTheDocument();
  });


  it("follows the network: KNF's own address, its QR code and its graph", async () => {
    given.json('get', '/api/utxo/:network/faucet-balance', { ...f.utxoBalance(), address: KNF_FAUCET, chunk_size: 1000 });
    renderUtxo('knf');
    expect(await screen.findByText(KNF_FAUCET)).toBeInTheDocument();
    expect(screen.getByText(spanning('Grąžinkite nebereikalingą KNF atgal:'))).toBeInTheDocument();
    expect(modulesOf(qrCodes()[0])).toBe(qrModulesFor(KNF_FAUCET));
    expect(screen.getByRole('link', { name: 'Transakcijų grafikas' })).toHaveAttribute('href', '/graph/utxo/knf');
  });


  it('draws no QR code for an answer without an address, the graph link still there', async () => {
    given.json('get', '/api/utxo/:network/faucet-balance', { ...f.utxoBalance(), address: '' });
    renderUtxo();
    await balancesLoaded();
    expect(qrCodes()).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Transakcijų grafikas' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Switching networks
// -----------------------------------------------------------
//
// The navbar picker changes the route and keeps the page
// mounted: the previous chain's outcome goes, the pasted
// address stays, and a request in flight belongs to the chain
// it was sent for.
// -----------------------------------------------------------

describe('Switching networks', () => {

  it("drops the previous chain's outcome but keeps the pasted address", async () => {
    given.error('get', '/api/utxo/:network/request-btc', f.COOLDOWN_MESSAGE, 429);
    const { user } = renderWithPicker('btc4');
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    await screen.findByText(f.COOLDOWN_MESSAGE);
    await user.click(screen.getByRole('link', { name: 'knf' }));
    expect(await screen.findByRole('heading', { level: 1, name: "KNF Coin faucet'as" })).toBeInTheDocument();
    expect(screen.queryByText(f.COOLDOWN_MESSAGE)).toBeNull();
    expect(addressField('KNF')).toHaveValue(f.JONAS);
  });


  it("never shows a payout answered after the switch on the new chain's page", async () => {
    const held = holdPayout(f.utxoPayout('btc4'));
    const { user } = renderWithPicker('btc4');
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    await screen.findByRole('button', { name: 'Siunčiama…' });
    await user.click(screen.getByRole('link', { name: 'knf' }));
    await screen.findByRole('heading', { level: 1, name: "KNF Coin faucet'as" });
    expect(screen.queryByRole('button', { name: 'Siunčiama…' })).toBeNull();
    await held.release();
    await settle(100);
    expect(screen.queryByText(/^Išsiųsta/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });


  it("does not hold the new chain's button behind the old chain's request", async () => {
    const calls = [];
    server.use(http.get(url('/api/utxo/:network/request-btc'), ({ params }) => {
      calls.push(params.network);
      return params.network === 'btc4' ? new Promise(() => {}) : HttpResponse.json(f.utxoPayout(params.network));
    }));
    const { user } = renderWithPicker('btc4');
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    await screen.findByRole('button', { name: 'Siunčiama…' });
    await user.click(screen.getByRole('link', { name: 'knf' }));
    await screen.findByRole('heading', { level: 1, name: "KNF Coin faucet'as" });
    await user.clear(addressField('KNF'));
    await requestTo(user, KNF_STUDENT, 'KNF');
    expect(await screen.findByRole('alert')).toHaveTextContent(`Išsiųsta 1000 KNF. Transakcija: ${TXID}`);
    expect(calls).toEqual(['btc4', 'knf']);
  });


  it('shows the answer on the chain it belongs to when the student comes back before it lands', async () => {
    const held = holdPayout(f.utxoPayout('btc4'));
    const { user } = renderWithPicker('btc4');
    await balancesLoaded();
    await requestTo(user, f.JONAS);
    await user.click(screen.getByRole('link', { name: 'knf' }));
    await screen.findByRole('heading', { level: 1, name: "KNF Coin faucet'as" });
    await user.click(screen.getByRole('link', { name: 'btc4' }));
    await screen.findByRole('heading', { level: 1, name: "Bitcoin Testnet4 faucet'as" });
    // Still its request, still in flight
    expect(screen.getByRole('button', { name: 'Siunčiama…' })).toBeDisabled();
    await held.release();
    expect(await screen.findByRole('alert')).toHaveTextContent(`Išsiųsta 0.1 tBTC4. Transakcija: ${TXID}`);
  });
});







// -----------------------------------------------------------
// Routes, unknown networks and a missing network list
// -----------------------------------------------------------
//
// An unknown :network gets the error card and never polls; a
// failed list says so, and so does an answer that is no list;
// while the list loads the page stands on generic BTC labels;
// the real App routes here and titles the tab.
// -----------------------------------------------------------

describe('Routes, unknown networks and a missing network list', () => {

  it('gives an unknown :network the card "Nežinomas tinklas: <key>", no form, and never polls its balance', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = given.capture('get', '/api/utxo/:network/faucet-balance', f.utxoBalance());
    renderUtxo('doge');
    expect(await screen.findByText('Nežinomas tinklas: doge')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(11000); });
    expect(calls).toHaveLength(0);
  });


  it('says why the network list could not be read instead of showing a page', async () => {
    given.error('get', '/api/utxo/networks', 'Vidinė serverio klaida', 500);
    renderUtxo();
    expect(await screen.findByText('Vidinė serverio klaida. Perkraukite puslapį.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });


  it('stands on generic BTC labels while the network list is on its way — no numbers, no balance request yet', async () => {
    given.hang('get', '/api/utxo/networks');
    const calls = given.capture('get', '/api/utxo/:network/faucet-balance', f.utxoBalance());
    renderUtxo();
    expect(screen.getByRole('heading', { level: 1, name: "Bitcoin faucet'as" })).toBeInTheDocument();
    expect(addressField('BTC')).toBeInTheDocument();
    await settle(100);
    expect(screen.queryByText('Čiaupo balansas:')).toBeNull();
    expect(calls).toHaveLength(0);
  });


  it.each([
    ["a proxy's page", () => given.text('get', '/api/utxo/networks', '<html><body>Palaukite…</body></html>')],
    ['an empty object', () => given.json('get', '/api/utxo/networks', {})],
    ['a list where the map belongs', () => given.json('get', '/api/utxo/networks', { ...f.utxoNetworks, networks: [f.utxoNetworksMap.btc4] })],
  ])('says the network list could not be read when it answers 200 without a networks map — never a fake Bitcoin page: %s', async (_, answer) => {
    answer();
    const calls = given.capture('get', '/api/utxo/:network/faucet-balance', f.utxoBalance());
    renderUtxo();
    expect(await screen.findByText(networksCard(`${NETWORKS_FAILED} ${MALFORMED}`))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: "Bitcoin faucet'as" })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Jūsų BTC adresas' })).toBeNull();
    expect(calls).toHaveLength(0);
  });


  it('the real App routes /faucet/utxo/ltc4 here, under the tab title "UTXO čiaupas"', async () => {
    renderApp({ route: '/faucet/utxo/ltc4' });
    expect(await screen.findByRole('heading', { level: 1, name: "Litecoin Testnet4 faucet'as" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("UTXO čiaupas — VU KNF Faucet'as"));
  });


  it("the real App shows the page's own card, not the not-found page, for an unknown UTXO network", async () => {
    renderApp({ route: '/faucet/utxo/doge' });
    expect(await screen.findByText('Nežinomas tinklas: doge')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// Every response variant against the two endpoints the page
// reads on its own — the network list (its failure is the
// catalog card, its loading the generic BTC page) and the
// faucet's balance (its failure the page's alert, its loading
// the skeletons) — and the failure answers of the payout,
// which the student triggers: its render pastes an address
// and presses the button (the matrix does not await it; the
// click is its last step, so the answer is the request's).
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/utxo/networks',
  fixture: f.utxoNetworks,
  render: () => renderUtxo(),
  loaded: async () => { await screen.findByRole('heading', { level: 1, name: "Bitcoin Testnet4 faucet'as" }); },
  failed: async (says) => { await screen.findByText(networksCard(says(NETWORKS_FAILED))); },
  loading: () => screen.getByRole('heading', { level: 1, name: "Bitcoin faucet'as" }),
});


describeEndpointContract({
  path: '/api/utxo/:network/faucet-balance',
  fixture: f.utxoBalance(),
  render: () => renderUtxo(),
  chrome: () => screen.getByRole('heading', { level: 1, name: "Bitcoin Testnet4 faucet'as" }),
  loaded: async () => { await screen.findByText('1250.605 tBTC4'); },
  failed: async (says) => { expect((await screen.findByRole('alert')).textContent).toBe(says(FAUCET_FAILED)); },
  // MUI's Skeleton has no role — its class is the only handle
  loading: () => document.querySelector('.MuiSkeleton-root'),
});


async function renderAndRequest() {
  const { user } = renderUtxo();
  await balancesLoaded();
  await requestTo(user, f.JONAS);
}

describeEndpointContract({
  path: '/api/utxo/:network/request-btc',
  fixture: f.utxoPayout(),
  only: VARIANTS.filter((variant) => variant.expect === 'failed' || variant.expect === 'loading').map((variant) => variant.name),
  render: () => { renderAndRequest(); },
  chrome: () => screen.getByRole('heading', { level: 1, name: "Bitcoin Testnet4 faucet'as" }),
  failed: async () => {
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/^(Vidinė serverio klaida|Nepalaikomas tinklas: x|Nerasta|Nepavyko išsiųsti kriptovaliutos\. Serveris grąžino klaidą \((502|500)\)\.|Nepavyko išsiųsti kriptovaliutos\. Patikrinkite interneto ryšį\.)$/);
    expect(addressField()).toHaveValue(f.JONAS);
  },
  loading: () => screen.getByRole('button', { name: 'Siunčiama…' }),
});

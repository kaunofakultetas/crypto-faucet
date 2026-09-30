// -----------------------------------------------------------
//  [*] Tests — UTXO graph: the transaction dialog (TransactionModal)
//
//  The dialog a box opens, through the page and — for the
//  shapes the fixture day has none of — on its own: the first
//  lines (the green "Patvirtinta · blokas #N" chip and the
//  local time, the amber mempool chip, the grey "Būsena
//  nežinoma" with its reason on hover, the full txid and its
//  copy button — "Nukopijuota!" and a check for 1.5 s, or
//  "Nepavyko nukopijuoti" without a clipboard — and the
//  "Siuntėjas" line, several people named as a PayJoin /
//  CoinJoin, none for a coinbase); the input and output cards
//  (who controls the address — a name, "Nežinomas valdytojas",
//  the letter avatar — the amount, the address with its copy
//  button, or why a coin has no address; the outpoint an input
//  spends, the "Grąža" chip, where an output went: a link, the
//  gold "Neišleista (UTXO)", "Nežinoma, ar išleista" with its
//  reason, "Duomenys — išleisti negalima"; a coinbase's
//  "Naujos monetos." card); the fee worked out as inputs −
//  outputs = fee with its rate per vbyte, or the sentence for
//  a coinbase and for an unknown input; walking the chain
//  (links inside the day, a transaction past the day fetched
//  with its names, a 404's "Transakcija nerasta — serveris
//  jos negrąžino.", any other failure, an answer holding no
//  transaction — pinned: "Kraunama…" for ever — Atgal back
//  through every step, a waiting transaction turning
//  confirmed in place, a fresh start on every opening);
//  naming an address
//  (the pencil, Enter or the check saving through the backend
//  and the graph asking again, trimming and the 64-character
//  cap, an empty name clearing it, a refusal keeping the
//  editor open with "Nepavyko išsaugoti — bandykite dar
//  kartą", Esc and Atšaukti dropping the edit, the wait while
//  saving, one row at a time, a link dropping the edit, a
//  fetched transaction's names refreshed); and leaving with an
//  unsaved name (the × and the backdrop — and Esc outside the
//  field — asking "Atmesti pakeitimus?", an unchanged name
//  closing at once, the footer's "Uždaryti" closing at once).
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import { renderPage } from '../../support/render';
import { given } from '../../support/backend/server';
import { mediaQueryMatches } from '../../support/setup';
import { settle } from '../../support/backend/contract';
import * as f from '../../support/backend/fixtures';
import {
  GRAPH, RENAME, TRANSACTION, pinToday, useFakeClock, advance, renderGraph, answerGraph, graphFor, findBox, getBox, rowsOf, openTransaction,
} from '../../support/graph-utxo/graph';
import { T, X, spend, coin, transaction, dayTransactions } from '../../support/graph-utxo/transactions';
import TransactionModal from '@/pages/Graph_UTXO/components/TransactionModal';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderDialog mounts the dialog on its own for a made-up
// transaction the day holds (or, known: false, one it has to
// fetch). cardsIn lists one column's cards; countOf reads the
// number its title carries. localDateTime is a time as the
// viewer's clock shows it ("2026-09-29 10:18" in the UTC
// container). namingBackend keeps an address book the way the
// backend does: set-address-name writes it (an empty name
// deletes), the graph and the transaction endpoint read it —
// and it captures all three. closeButtons are the header's ×
// and the footer's button, both named "Uždaryti".
// -----------------------------------------------------------

function renderDialog(tx, { names = f.utxoNames, known = true, renameAddress = vi.fn(async () => true), onClose = vi.fn() } = {}) {
  const rendered = renderPage(
    <TransactionModal
      network="btc4"
      txid={tx.txid}
      sourceRect={null}
      onClose={onClose}
      transactionsById={known ? { [tx.txid]: tx } : {}}
      names={names}
      renameAddress={renameAddress}
      faucetAddress={f.FAUCET_UTXO}
      unit="tBTC4"
    />,
  );
  return { ...rendered, onClose, renameAddress };
}

const findDialog = () => screen.findByRole('dialog', { name: 'Transakcija' });

const columnTitle = (dialog, title) => within(dialog).getByRole('heading', { level: 3, name: new RegExp(`^${title}`) });
const cardsIn = (dialog, title) => within(columnTitle(dialog, title).parentElement).queryAllByRole('listitem');
const countOf = (dialog, title) => columnTitle(dialog, title).lastElementChild.textContent;

const pad = (n) => String(n).padStart(2, '0');
const localDateTime = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const closeButtons = (dialog) => within(dialog).getAllByRole('button', { name: 'Uždaryti' });

const senderLine = (dialog) => within(dialog).queryByText(/^Siuntėjas:/);

function namingBackend() {
  const book = { ...f.utxoNames };
  const namesFor = (tx) => {
    const addresses = [...tx.inputs, ...tx.outputs].map((c) => c.address).filter((address) => address && book[address]);
    return Object.fromEntries(addresses.map((address) => [address, book[address]]));
  };
  const graph = given.capture('get', GRAPH, ({ query }) => graphFor(query, () => ({ names: { ...book } })));
  const fetches = given.capture('get', TRANSACTION, ({ params }) => {
    const { transaction: tx } = f.utxoTransaction(params.txid);
    return { transaction: tx, names: namesFor(tx) };
  });
  const renames = given.capture('get', RENAME, ({ query }) => {
    const name = query.get('name');
    if (name) book[query.get('address')] = name; else delete book[query.get('address')];
    return { status: 'OK' };
  });
  return { graph, fetches, renames };
}

async function startEditing(user, card) {
  await user.click(within(card).getByRole('button', { name: 'Keisti valdytojo vardą' }));
  return within(card).getByRole('textbox', { name: 'Valdytojo vardas' });
}

// The made-up shapes
const joinTx = () => transaction({
  txid: X.JOIN, block: 154391,
  inputs: [spend(T.T0, 0, f.JONAS, 1000000), spend(T.T0, 1, f.EGLE, 2000000)],
  outputs: [coin(f.PETRAS, 2998000)], fee: 2000,
});
const coinbaseTx = () => transaction({
  txid: T.COINBASE, block: 154000, time: '2026-09-27T09:00:00Z', coinbase: true, fee: null, vsize: 120,
  outputs: [coin(f.FAUCET_UTXO, 5000000000, { spentBy: { txid: T.OLD_FAUCET_COIN, vin: 0 } }), coin(null, 0, { scriptType: 'op_return' })],
});
const lostTx = () => transaction({
  txid: X.LOST, block: 154391, fee: null,
  inputs: [spend(T.T0, 4, null, null)], outputs: [coin(f.JONAS, 1000)],
});







// -----------------------------------------------------------
// Opening and closing
// -----------------------------------------------------------

describe('Opening the dialog', () => {

  it('opens "Transakcija" for the box clicked', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText(T.T1)).toBeInTheDocument();
  });


  it('opens from the keyboard too: Space on a focused box', async () => {
    const { user } = renderGraph();
    (await findBox(T.T4)).focus();
    await user.keyboard(' ');
    expect(within(await findDialog()).getByText(T.T4)).toBeInTheDocument();
  });


  it('closes with "Uždaryti", and a box opens fresh at its own transaction every time', async () => {
    const { user } = renderGraph();
    let dialog = await openTransaction(user, T.T1);
    await user.click(within(dialog).getByRole('button', { name: 'a2a2a2…a2a2' }));
    await waitFor(() => expect(within(dialog).getByText(T.T2)).toBeInTheDocument());
    await user.click(closeButtons(dialog)[1]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await openTransaction(user, T.T1);
    expect(within(dialog).getByText(T.T1)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Atgal' })).toBeNull();
  });
});







// -----------------------------------------------------------
// The first lines
// -----------------------------------------------------------
//
// Where it was mined, the txid, who sent it.
// -----------------------------------------------------------

describe('Status, txid and sender', () => {

  it('says a mined transaction is confirmed in its block, with its local time', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    expect(within(dialog).getByText('Patvirtinta · blokas #154390')).toBeInTheDocument();
    expect(within(dialog).getByText(localDateTime(f.utxoBlocks[0].time))).toBeInTheDocument();
  });


  it('says a waiting one is in the mempool, with no time', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    expect(within(dialog).getByText('Laukia patvirtinimo (mempool)')).toBeInTheDocument();
    expect(within(dialog).queryByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeNull();
  });


  it("says \"Būsena nežinoma\" for a transaction no history lists any more, the reason on hover", async () => {
    const { user } = renderDialog({ ...lostTx(), status: 'unknown', block: null, time: null });
    const dialog = await findDialog();
    await user.hover(within(dialog).getByText('Būsena nežinoma'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nė vieno perskaityto adreso istorijoje šios transakcijos nėra — ji galėjo būti pakeista kita arba išmesta iš mempool');
  });


  it('shows the full txid with a copy button', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T2);
    expect(within(dialog).getByText(T.T2)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Kopijuoti transakcijos ID' })).toBeInTheDocument();
  });


  it('copies the txid and says so — "Nukopijuota!" and a check — for a second and a half', async () => {
    useFakeClock();
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T2);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { userAgent: 'test', language: 'lt', clipboard: { writeText } });
    const copy = within(dialog).getByRole('button', { name: 'Kopijuoti transakcijos ID' });

    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith(T.T2);
    await waitFor(() => expect(within(copy).getByTestId('CheckIcon')).toBeInTheDocument());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nukopijuota!');

    await advance(1600);
    await waitFor(() => expect(within(copy).getByTestId('ContentCopyIcon')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Kopijuoti transakcijos ID'));
  });


  it('says "Nepavyko nukopijuoti" when the clipboard refuses', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T2);
    vi.stubGlobal('navigator', { userAgent: 'test', language: 'lt', clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    const copy = within(dialog).getByRole('button', { name: 'Kopijuoti transakcijos ID' });
    await user.click(copy);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nepavyko nukopijuoti');
    expect(within(copy).getByTestId('ContentCopyIcon')).toBeInTheDocument();
  });


  it('says "Nepavyko nukopijuoti" where there is no clipboard at all (no secure context)', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    vi.stubGlobal('navigator', { userAgent: 'test', language: 'lt' });
    const card = cardsIn(dialog, 'Įvestys')[0];
    await user.click(within(card).getByRole('button', { name: 'Kopijuoti adresą' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nepavyko nukopijuoti');
  });


  it('copies an address from its card', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T3);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { userAgent: 'test', language: 'lt', clipboard: { writeText } });
    await user.click(within(cardsIn(dialog, 'Įvestys')[0]).getByRole('button', { name: 'Kopijuoti adresą' }));
    expect(writeText).toHaveBeenCalledWith(f.EGLE);
  });


  it('names the sender', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T2);
    expect(senderLine(dialog)).toHaveTextContent(/^Siuntėjas: Faucet'as$/);
  });


  it('says when different people signed the inputs — how a PayJoin or a CoinJoin looks', async () => {
    renderDialog(joinTx());
    const dialog = await findDialog();
    expect(senderLine(dialog)).toHaveTextContent('Siuntėjas: Kelios pusės — įvestis pasirašė skirtingi žmonės; taip atrodo PayJoin ar CoinJoin.');
  });


  it('gives a coinbase no sender line', async () => {
    renderDialog(coinbaseTx());
    const dialog = await findDialog();
    expect(within(dialog).getByText('Patvirtinta · blokas #154000')).toBeInTheDocument();
    expect(senderLine(dialog)).toBeNull();
  });
});







// -----------------------------------------------------------
// The cards
// -----------------------------------------------------------
//
// Inputs on the left flow into outputs on the right.
// -----------------------------------------------------------

describe('Input and output cards', () => {

  it('lists every input and every output as a card, each column counting its cards', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    expect(cardsIn(dialog, 'Įvestys')).toHaveLength(1);
    expect(countOf(dialog, 'Įvestys')).toBe('1');
    expect(cardsIn(dialog, 'Išvestys')).toHaveLength(3);
    expect(countOf(dialog, 'Išvestys')).toBe('3');
  });


  it('shows on an input card who controls the address, the amount, the address to copy and the output it spends, as a link', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    const [card] = cardsIn(dialog, 'Įvestys');
    expect(within(card).getByText('Jonas')).toBeInTheDocument();
    expect(within(card).getByText('J')).toBeInTheDocument();
    expect(card).toHaveTextContent('0.01 tBTC4');
    expect(within(card).getByText(f.JONAS)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Kopijuoti adresą' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Iš išvesties');
    expect(within(card).getByRole('button', { name: 'a0a0a0…a0a0:0' })).toBeInTheDocument();
  });


  it('shows on an output card the recipient, the amount and the transaction that spent it, as a link', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    const [card] = cardsIn(dialog, 'Išvestys');
    expect(within(card).getByText("Faucet'as")).toBeInTheDocument();
    expect(within(card).getByText('F')).toBeInTheDocument();
    expect(card).toHaveTextContent("0.009'989 tBTC4");
    expect(card).toHaveTextContent('Išleista transakcijoje');
    expect(within(card).getByRole('button', { name: 'a2a2a2…a2a2' })).toBeInTheDocument();
  });


  it('says "Nežinomas valdytojas" under a "?" for an address nobody named', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    const [hub] = cardsIn(dialog, 'Išvestys');
    expect(within(hub).getByText('Nežinomas valdytojas')).toBeInTheDocument();
    expect(within(hub).getByText('?')).toBeInTheDocument();
    expect(within(hub).getByText(f.HUB)).toBeInTheDocument();
  });


  it('says what an address-less output holds instead of an address — no copy button, no pencil', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    const data = cardsIn(dialog, 'Išvestys')[1];
    expect(within(data).getByText('OP_RETURN duomenys')).toBeInTheDocument();
    expect(within(data).getByText('Adreso nėra — ši išvestis saugo duomenis, ne monetas')).toBeInTheDocument();
    expect(within(data).getByText('Duomenys — išleisti negalima')).toBeInTheDocument();
    expect(within(data).queryByRole('button', { name: 'Kopijuoti adresą' })).toBeNull();
    expect(within(data).queryByRole('button', { name: 'Keisti valdytojo vardą' })).toBeNull();
  });


  it('says a bare public key output is locked by a script no address can write', async () => {
    const tx = transaction({ txid: X.PK, block: 154391, inputs: [spend(T.T0, 0, f.JONAS, 1000000)], outputs: [coin(null, 998000, { scriptType: 'p2pk' })], fee: 2000 });
    renderDialog(tx);
    const [card] = cardsIn(await findDialog(), 'Išvestys');
    expect(within(card).getByText('Viešasis raktas (P2PK)')).toBeInTheDocument();
    expect(within(card).getByText('Adreso nėra — išvestis užrakinta scenarijumi, kuris adresu neužrašomas')).toBeInTheDocument();
  });


  it('says "Nežinomas adresas" and "?" for an input whose earlier transaction the server never gave, and why', async () => {
    renderDialog(lostTx());
    const [card] = cardsIn(await findDialog(), 'Įvestys');
    expect(within(card).getByText('Nežinomas adresas')).toBeInTheDocument();
    expect(card).toHaveTextContent('? tBTC4');
    expect(within(card).getByText('Ankstesnės transakcijos serveris negrąžino — nei adresas, nei suma nežinomi')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Keisti valdytojo vardą' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'a0a0a0…a0a0:4' })).toBeInTheDocument();
  });


  it('marks change — an output back to an address the transaction spends from — with "Grąža"', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    const [hub, data, change] = cardsIn(dialog, 'Išvestys');
    expect(within(change).getByText('Grąža')).toBeInTheDocument();
    expect(within(hub).queryByText('Grąža')).toBeNull();
    expect(within(data).queryByText('Grąža')).toBeNull();
  });


  it('says where every output went: spent, "Neišleista (UTXO)", or "Nežinoma, ar išleista" with the reason on hover', async () => {
    const { user } = renderGraph();
    let dialog = await openTransaction(user, T.T4);
    const [paid, kept] = cardsIn(dialog, 'Išvestys');
    expect(within(paid).getByRole('button', { name: 'a5a5a5…a5a5' })).toBeInTheDocument();
    expect(within(kept).getByText('Neišleista (UTXO)')).toBeInTheDocument();
    await user.click(closeButtons(dialog)[1]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await openTransaction(user, T.T5);
    const [hub] = cardsIn(dialog, 'Išvestys');
    await user.hover(within(hub).getByText('Nežinoma, ar išleista'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Šio adreso istorija neskaityta: jis per toli nuo čiaupo arba tai viešas adresas su labai ilga istorija');
  });


  it("gives a coinbase a \"Naujos monetos.\" card where the inputs would be, and counts no input", async () => {
    renderDialog(coinbaseTx());
    const dialog = await findDialog();
    const [card] = cardsIn(dialog, 'Įvestys');
    expect(card).toHaveTextContent('Naujos monetos. Coinbase transakcija nieko neišleidžia: ja bloko kasėjas gauna atlygį — bloko subsidiją ir bloko transakcijų mokesčius.');
    expect(countOf(dialog, 'Įvestys')).toBe('0');
    expect(cardsIn(dialog, 'Išvestys')).toHaveLength(2);
  });
});







// -----------------------------------------------------------
// The fee
// -----------------------------------------------------------

describe('The fee', () => {

  it('works the fee out the way the chain does — inputs − outputs = fee — with its rate per virtual byte', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T2);
    const inputs = within(dialog).getAllByText('Įvestys').find((node) => node.tagName === 'DIV');
    expect(inputs.parentElement).toHaveTextContent("Įvestys749.939'940'1 tBTC4");
    expect(within(dialog).getAllByText('Išvestys').find((node) => node.tagName === 'DIV').parentElement).toHaveTextContent("Išvestys749.939'896'5 tBTC4");
    expect(within(dialog).getByText('Mokestis kasėjui').parentElement).toHaveTextContent("Mokestis kasėjui0.000'043'6 tBTC4");
    expect(within(dialog).getByText(/^Mokesčio tarifas:/)).toHaveTextContent("Mokesčio tarifas: 4'360 sat ÷ 208 vB = 20,96 sat/vB.");
  });


  it('writes a whole rate without decimals', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    expect(within(dialog).getByText(/^Mokesčio tarifas:/)).toHaveTextContent("Mokesčio tarifas: 1'100 sat ÷ 110 vB = 10 sat/vB.");
  });


  it('leaves the rate out when the size is not known', async () => {
    renderDialog({ ...joinTx(), vsize: null });
    const dialog = await findDialog();
    expect(within(dialog).getByText('Mokestis kasėjui')).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Mokesčio tarifas:/)).toBeNull();
  });


  it('says a coinbase pays no fee — it is the miner\'s reward itself', async () => {
    renderDialog(coinbaseTx());
    const dialog = await findDialog();
    expect(within(dialog).getByText('Coinbase transakcija mokesčio nemoka — ji pati yra kasėjo atlygis.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Mokestis kasėjui')).toBeNull();
  });


  it("says the fee cannot be worked out while an input's amount is unknown", async () => {
    renderDialog(lostTx());
    const dialog = await findDialog();
    expect(within(dialog).getByText('Mokesčio apskaičiuoti negalima: nežinoma, kiek verta bent viena įvestis.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Mokestis kasėjui')).toBeNull();
  });
});







// -----------------------------------------------------------
// Walking the chain
// -----------------------------------------------------------
//
// Every transaction reference is a link that opens it in the
// dialog; Atgal walks back.
// -----------------------------------------------------------

describe('Walking the chain', () => {

  it("follows a spender's link to that transaction, and Atgal walks back", async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    expect(within(dialog).queryByRole('button', { name: 'Atgal' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'a2a2a2…a2a2' }));
    expect(within(dialog).getByText(T.T2)).toBeInTheDocument();
    expect(within(dialog).getByText('Patvirtinta · blokas #154391')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Atgal' }));
    expect(within(dialog).getByText(T.T1)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Atgal' })).toBeNull();
  });


  it('walks several steps and back through each of them', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await user.click(within(dialog).getByRole('button', { name: 'a2a2a2…a2a2' }));
    await user.click(within(cardsIn(dialog, 'Išvestys')[0]).getByRole('button', { name: 'a3a3a3…a3a3' }));
    await user.click(within(dialog).getByRole('button', { name: 'a4a4a4…a4a4' }));
    expect(within(dialog).getByText(T.T4)).toBeInTheDocument();

    for (const txid of [T.T3, T.T2, T.T1]) {
      await user.click(within(dialog).getByRole('button', { name: 'Atgal' }));
      expect(within(dialog).getByText(txid)).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole('button', { name: 'Atgal' })).toBeNull();
  });


  it('asks the backend for nothing while the links stay inside the day', async () => {
    const fetches = given.capture('get', TRANSACTION, {});
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await user.click(within(dialog).getByRole('button', { name: 'a2a2a2…a2a2' }));
    await user.click(within(dialog).getByRole('button', { name: 'a1a1a1…a1a1:0' }));
    await settle(50);
    expect(fetches).toHaveLength(0);
  });


  it('fetches a transaction from before the day, with the names of its addresses', async () => {
    const fetches = given.capture('get', TRANSACTION, ({ params }) => f.utxoTransaction(params.txid));
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await user.click(within(dialog).getByRole('button', { name: 'a0a0a0…a0a0:0' }));

    expect(await within(dialog).findByText('Patvirtinta · blokas #154300')).toBeInTheDocument();
    expect(fetches).toHaveLength(1);
    expect(fetches[0].params).toEqual({ network: 'btc4', txid: T.T0 });
    expect(within(dialog).getByText(T.T0)).toBeInTheDocument();
    expect(within(dialog).getByText(localDateTime('2026-09-28T09:00:00Z'))).toBeInTheDocument();
    const [toJonas] = cardsIn(dialog, 'Išvestys');
    expect(within(toJonas).getByText('Jonas')).toBeInTheDocument();
    expect(within(toJonas).getByRole('button', { name: 'a1a1a1…a1a1' })).toBeInTheDocument();
  });


  it('says "Kraunama…" while a transaction from past the day is on its way', async () => {
    given.hang('get', TRANSACTION);
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await user.click(within(dialog).getByRole('button', { name: 'a0a0a0…a0a0:0' }));
    expect(await within(dialog).findByText('Kraunama…')).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Atgal' })).toBeInTheDocument();
  });


  it('says "Transakcija nerasta — serveris jos negrąžino." for a transaction the backend does not have, and Atgal still walks back', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await user.click(within(dialog).getByRole('button', { name: 'a0a0a0…a0a0:0' }));
    await user.click(await within(dialog).findByRole('button', { name: '0f0f0f…0f0f:0' }));

    expect(await within(dialog).findByText('Transakcija nerasta — serveris jos negrąžino.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Atgal' }));
    expect(await within(dialog).findByText(T.T0)).toBeInTheDocument();
  });


  it('says "Nepavyko gauti transakcijos — bandykite dar kartą vėliau." for any other failure', async () => {
    given.error('get', TRANSACTION, 'Vidinė serverio klaida', 500);
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await user.click(within(dialog).getByRole('button', { name: 'a0a0a0…a0a0:0' }));
    expect(await within(dialog).findByText('Nepavyko gauti transakcijos — bandykite dar kartą vėliau.')).toBeInTheDocument();
  });


  it.fails('says the transaction cannot be shown when a 200 answer holds none — PINNED KNOWN BUG: an answer without a transaction (an empty body, {}) leaves the dialog on "Kraunama…" forever', async () => {
    given.json('get', TRANSACTION, {});
    renderDialog(lostTx(), { known: false });
    const dialog = await findDialog();
    expect(await within(dialog).findByText(
      /^(Transakcija nerasta — serveris jos negrąžino\.|Nepavyko gauti transakcijos — bandykite dar kartą vėliau\.)$/, {}, { timeout: 1000 },
    )).toBeInTheDocument();
    expect(within(dialog).queryByText('Kraunama…')).toBeNull();
  });


  it('reaches a coinbase through the output it made', async () => {
    const heir = transaction({
      txid: X.MINED, block: 154391, inputs: [spend(T.COINBASE, 0, f.FAUCET_UTXO, 5000000000)], outputs: [coin(f.JONAS, 4999990000)], fee: 10000,
    });
    answerGraph({ transactions: [heir] });
    const { user } = renderGraph();
    const dialog = await openTransaction(user, X.MINED);
    await user.click(within(dialog).getByRole('button', { name: 'cbcbcb…cbcb:0' }));

    expect(await within(dialog).findByText('Coinbase transakcija mokesčio nemoka — ji pati yra kasėjo atlygis.')).toBeInTheDocument();
    expect(cardsIn(dialog, 'Įvestys')[0]).toHaveTextContent('Naujos monetos.');
    expect(senderLine(dialog)).toBeNull();
  });


  it('turns a waiting transaction confirmed in place when a poll brings it mined', async () => {
    useFakeClock();
    const mined = { ...dayTransactions().find((tx) => tx.txid === T.T5), status: 'confirmed', block: 154396, time: '2026-09-29T11:20:00Z' };
    answerGraph({}, {
      blocks: [...f.utxoBlocks, { height: 154396, time: mined.time }],
      transactions: [...dayTransactions().filter((tx) => tx.txid !== T.T5), mined],
    });
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    expect(within(dialog).getByText('Laukia patvirtinimo (mempool)')).toBeInTheDocument();

    await advance(5000);
    expect(await within(dialog).findByText('Patvirtinta · blokas #154396')).toBeInTheDocument();
    expect(within(dialog).getByText(localDateTime(mined.time))).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Naming an address
// -----------------------------------------------------------
//
// The pencil beside a name; the backend stores it and the
// whole graph is asked again.
// -----------------------------------------------------------

describe('Naming an address', () => {

  it('saves a name with Enter: the backend stores it, the graph asks again and the name shows everywhere', async () => {
    const { graph, renames } = namingBackend();
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    const hub = cardsIn(dialog, 'Išvestys')[0];
    const field = await startEditing(user, hub);
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('placeholder', 'Kas valdo šį adresą?');
    expect(field).toHaveValue('');
    const asked = graph.length;

    await user.type(field, 'Hubas{Enter}');
    await waitFor(() => expect(renames).toHaveLength(1));
    expect(renames[0].params.network).toBe('btc4');
    expect(renames[0].query).toEqual({ address: f.HUB, name: 'Hubas' });
    await waitFor(() => expect(graph.length).toBe(asked + 1));
    await waitFor(() => expect(within(cardsIn(dialog, 'Išvestys')[0]).getByText('Hubas')).toBeInTheDocument());
    expect(within(dialog).queryByRole('textbox', { name: 'Valdytojo vardas' })).toBeNull();

    await user.click(closeButtons(dialog)[1]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(rowsOf(getBox(T.T5)).outputs[0].primary).toBe('Hubas');
  });


  it('starts the edit from the current name and saves with the check button, trimmed', async () => {
    const { renames } = namingBackend();
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    const field = await startEditing(user, cardsIn(dialog, 'Įvestys')[0]);
    expect(field).toHaveValue('Jonas');
    await user.clear(field);
    await user.type(field, '  Jonas Jonaitis  ');
    await user.click(within(dialog).getByRole('button', { name: 'Išsaugoti vardą' }));
    await waitFor(() => expect(renames).toHaveLength(1));
    expect(renames[0].query).toEqual({ address: f.JONAS, name: 'Jonas Jonaitis' });
    await waitFor(() => expect(within(dialog).queryByRole('textbox', { name: 'Valdytojo vardas' })).toBeNull());
  });


  it('caps a name at 64 characters', async () => {
    const { renames } = namingBackend();
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    const field = await startEditing(user, cardsIn(dialog, 'Išvestys')[0]);
    await user.paste('x'.repeat(70));
    expect(field).toHaveValue('x'.repeat(64));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(renames).toHaveLength(1));
    expect(renames[0].query.name).toBe('x'.repeat(64));
  });


  it('clears a name with an empty one: the card and the box fall back to the address', async () => {
    const { renames } = namingBackend();
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    const field = await startEditing(user, cardsIn(dialog, 'Įvestys')[0]);
    await user.clear(field);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(renames).toHaveLength(1));
    expect(renames[0].query).toEqual({ address: f.JONAS, name: '' });
    await waitFor(() => expect(within(cardsIn(dialog, 'Įvestys')[0]).getByText('Nežinomas valdytojas')).toBeInTheDocument());

    await user.click(closeButtons(dialog)[1]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getBox(T.T1)).toHaveAccessibleName('Transakcija a1a1a1…a1a1, siuntėjas tb1qxc2w…xek8, blokas 154390');
  });


  it('keeps the editor open with "Nepavyko išsaugoti — bandykite dar kartą" when the backend does not take the name', async () => {
    const graph = answerGraph();
    given.error('get', RENAME, 'Vidinė serverio klaida', 500);
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    const field = await startEditing(user, cardsIn(dialog, 'Išvestys')[0]);
    const asked = graph.length;
    await user.type(field, 'Hubas{Enter}');

    expect(await within(dialog).findByText('Nepavyko išsaugoti — bandykite dar kartą')).toBeInTheDocument();
    expect(field).toHaveValue('Hubas');
    expect(field).toBeEnabled();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await settle(50);
    expect(graph).toHaveLength(asked);

    // Typing on clears the refusal
    await user.type(field, '!');
    expect(within(dialog).queryByText('Nepavyko išsaugoti — bandykite dar kartą')).toBeNull();
  });


  it('makes the field and both buttons wait while the name is being saved', async () => {
    given.slow('get', RENAME, 300, { status: 'OK' });
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    const field = await startEditing(user, cardsIn(dialog, 'Išvestys')[0]);
    await user.type(field, 'Hubas{Enter}');

    await waitFor(() => expect(field).toBeDisabled());
    const save = within(dialog).getByRole('button', { name: 'Išsaugoti vardą' });
    expect(save).toBeDisabled();
    expect(within(save).getByRole('progressbar')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Atšaukti' })).toBeDisabled();
    await waitFor(() => expect(within(dialog).queryByRole('textbox', { name: 'Valdytojo vardas' })).toBeNull());
  });


  it('drops the edit with Esc, the dialog staying open and nothing sent', async () => {
    const renames = given.capture('get', RENAME, { status: 'OK' });
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    const field = await startEditing(user, cardsIn(dialog, 'Įvestys')[0]);
    await user.type(field, ' Jr.');
    await user.keyboard('{Escape}');

    expect(within(dialog).queryByRole('textbox', { name: 'Valdytojo vardas' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Transakcija' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(cardsIn(dialog, 'Įvestys')[0]).getByText('Jonas')).toBeInTheDocument();
    await settle(50);
    expect(renames).toHaveLength(0);
  });


  it('drops the edit with "Atšaukti" too', async () => {
    const renames = given.capture('get', RENAME, { status: 'OK' });
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    const field = await startEditing(user, cardsIn(dialog, 'Įvestys')[0]);
    await user.type(field, ' Jr.');
    await user.click(within(dialog).getByRole('button', { name: 'Atšaukti' }));
    expect(within(dialog).queryByRole('textbox', { name: 'Valdytojo vardas' })).toBeNull();
    expect(renames).toHaveLength(0);
  });


  it('edits one row at a time, even where two rows share an address', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    // Jonas pays in and gets his change back: two cards, one address
    const input = cardsIn(dialog, 'Įvestys')[0];
    const change = cardsIn(dialog, 'Išvestys')[2];
    await startEditing(user, input);
    expect(within(dialog).getAllByRole('textbox', { name: 'Valdytojo vardas' })).toHaveLength(1);
    expect(within(change).queryByRole('textbox')).toBeNull();

    await startEditing(user, change);
    expect(within(dialog).getAllByRole('textbox', { name: 'Valdytojo vardas' })).toHaveLength(1);
    expect(within(input).queryByRole('textbox')).toBeNull();
  });


  it('drops an unsaved edit when a link is followed', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    const field = await startEditing(user, cardsIn(dialog, 'Įvestys')[0]);
    await user.type(field, ' Jr.');
    await user.click(within(dialog).getByRole('button', { name: 'a2a2a2…a2a2' }));
    expect(within(dialog).queryByRole('textbox', { name: 'Valdytojo vardas' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Atgal' }));
    expect(within(dialog).queryByRole('textbox', { name: 'Valdytojo vardas' })).toBeNull();
    expect(within(cardsIn(dialog, 'Įvestys')[0]).getByText('Jonas')).toBeInTheDocument();
  });


  it("refreshes a fetched transaction's names after a rename", async () => {
    const { fetches, renames } = namingBackend();
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await user.click(within(dialog).getByRole('button', { name: 'a0a0a0…a0a0:0' }));
    await within(dialog).findByText('Patvirtinta · blokas #154300');
    const asked = fetches.length;

    const field = await startEditing(user, cardsIn(dialog, 'Išvestys')[0]);
    await user.clear(field);
    await user.type(field, 'Jonukas{Enter}');
    await waitFor(() => expect(renames).toHaveLength(1));
    await waitFor(() => expect(fetches.length).toBe(asked + 1));
    expect(await within(cardsIn(dialog, 'Išvestys')[0]).findByText('Jonukas')).toBeInTheDocument();
  });


  it('offers no pencil on a coin nobody can name — no address', async () => {
    renderDialog(lostTx());
    const dialog = await findDialog();
    expect(within(cardsIn(dialog, 'Įvestys')[0]).queryByRole('button', { name: 'Keisti valdytojo vardą' })).toBeNull();
    expect(within(cardsIn(dialog, 'Išvestys')[0]).getByRole('button', { name: 'Keisti valdytojo vardą' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Leaving with an unsaved name
// -----------------------------------------------------------
//
// UniversalModal's dirty guard: an implicit dismissal of a
// changed name asks first.
// -----------------------------------------------------------

describe('Leaving with an unsaved name', () => {

  it('asks before the × throws a changed name away — "Tęsti redagavimą" keeps it', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    const field = await startEditing(user, cardsIn(dialog, 'Įvestys')[0]);
    await user.type(field, ' Jr.');
    await user.click(closeButtons(dialog)[0]);

    const prompt = await screen.findByRole('alertdialog', { name: 'Atmesti pakeitimus?' });
    expect(prompt).toHaveTextContent('Viskas, kas įvesta šiame lange, bus prarasta.');
    await user.click(within(prompt).getByRole('button', { name: 'Tęsti redagavimą' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Transakcija' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Valdytojo vardas' })).toHaveValue('Jonas Jr.');
  });


  it('closes the dialog on "Atmesti", the name unsaved', async () => {
    const renames = given.capture('get', RENAME, { status: 'OK' });
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await user.type(await startEditing(user, cardsIn(dialog, 'Įvestys')[0]), ' Jr.');
    await user.click(closeButtons(dialog)[0]);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Atmesti' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(renames).toHaveLength(0);
  });


  it('asks on a backdrop click too', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    await user.type(await startEditing(user, cardsIn(dialog, 'Išvestys')[0]), 'Hubas');
    // MUI's backdrop has no role — its class is the only handle
    fireEvent.click(dialog.parentElement.querySelector('.MuiBackdrop-root'));
    expect(await screen.findByRole('alertdialog', { name: 'Atmesti pakeitimus?' })).toBeInTheDocument();
  });


  it('asks on Esc once the focus has left the name field', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T5);
    await user.type(await startEditing(user, cardsIn(dialog, 'Išvestys')[0]), 'Hubas');
    within(dialog).getByRole('button', { name: 'Kopijuoti transakcijos ID' }).focus();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog', { name: 'Atmesti pakeitimus?' })).toBeInTheDocument();
  });


  it('closes at once when the name in the field is unchanged', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await startEditing(user, cardsIn(dialog, 'Įvestys')[0]);
    await user.click(closeButtons(dialog)[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });


  it('closes at once with the footer\'s "Uždaryti" — an explicit choice — even with a changed name', async () => {
    const { user } = renderGraph();
    const dialog = await openTransaction(user, T.T1);
    await user.type(await startEditing(user, cardsIn(dialog, 'Įvestys')[0]), ' Jr.');
    await user.click(closeButtons(dialog)[1]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

// -----------------------------------------------------------
//  [*] Tests — UTXO graph: the backend contract of every endpoint
//
//  The contract matrix (support/backend/contract.js) against
//  the four endpoints the UTXO graph reads — every failure, a
//  proxy's page, a dropped connection, every broken or strange
//  body, a hang and a slow answer:
//
//    GET /api/utxo/:network/graph             — the drawing;
//        a failure is the canvas' centred message
//    GET /api/utxo/:network/transaction-days  — the day list;
//        a failure leaves today alone in the picker
//    GET /api/utxo/networks                   — display names;
//        a failure leaves the key in the title and "BTC"
//    GET /api/utxo/:network/transaction/:txid — through the
//        dialog, opened on a transaction from before the day;
//        a failure is the dialog's own sentence
//
//  The variants the page cannot meet are pinned (it.fails)
//  with what breaks: a txid that is null or not a string
//  crashes both the drawing and the dialog (shortTxid).
// -----------------------------------------------------------

import { beforeEach, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderPage } from '../../support/render';
import { mediaQueryMatches } from '../../support/setup';
import { describeEndpointContract, settle } from '../../support/backend/contract';
import * as f from '../../support/backend/fixtures';
import {
  GRAPH, DAYS, NETWORKS, TRANSACTION, GRAPH_NAME, pinToday, renderGraph, findBox, rowsOf,
} from '../../support/graph-utxo/graph';
import { T } from '../../support/graph-utxo/transactions';
import TransactionModal from '@/pages/Graph_UTXO/components/TransactionModal';


beforeEach(() => {
  pinToday();
  mediaQueryMatches('(prefers-reduced-motion: reduce)');
});


const title = () => screen.getByRole('heading', { level: 1, name: /^Transakcijų Srautas - / });
const dateField = () => screen.getByRole('combobox', { name: 'Data' });







// -----------------------------------------------------------
// GET /api/utxo/:network/graph
// -----------------------------------------------------------
//
// The canvas says what went wrong: the backend's own message,
// or "Nepavyko gauti transakcijų" when the failure has none.
// -----------------------------------------------------------

describeEndpointContract({
  path: GRAPH,
  fixture: f.utxoGraph({ live: true }),
  render: () => renderGraph(),
  chrome: title,
  loaded: async () => {
    await findBox(T.T1);
    await findBox(T.T5);
  },
  failed: async () => {
    await waitFor(() => expect(screen.getByRole('status'))
      .toHaveTextContent(/^(Vidinė serverio klaida|Nepalaikomas tinklas: x|Nerasta|Nepavyko gauti transakcijų)$/));
  },
  loading: () => screen.getByText('Kraunama…'),
  pins: {
    'every leaf null → page survives': 'a transaction whose txid is null crashes the whole drawing — shortTxid calls .slice on it for the box\'s name (TransactionBox.jsx:252)',
    'types swapped (numbers as strings, strings as numbers) → page survives': 'a txid that is not a string crashes the whole drawing — shortTxid calls .slice on a number (TransactionBox.jsx:252)',
  },
});







// -----------------------------------------------------------
// GET /api/utxo/:network/transaction-days
// -----------------------------------------------------------
//
// No message of its own: without the list the picker offers
// today alone — and the drawing is not held up.
// -----------------------------------------------------------

describeEndpointContract({
  path: DAYS,
  fixture: f.utxoTransactionDays(),
  render: () => renderGraph(),
  chrome: title,
  loaded: async () => {
    await waitFor(() => expect(screen.getByRole('slider', { name: 'Diena' })).toHaveAttribute('max', '3'));
  },
  failed: async () => {
    await findBox(T.T1);
    await settle();
    expect(dateField()).toHaveValue('2026-09-30 (šiandien)');
    expect(screen.queryByRole('button', { name: 'Ankstesnė diena' })).toBeNull();
  },
  loading: () => dateField(),
});







// -----------------------------------------------------------
// GET /api/utxo/networks
// -----------------------------------------------------------
//
// Display names only: without them the title keeps the
// network's key and amounts read plain "BTC".
// -----------------------------------------------------------

describeEndpointContract({
  path: NETWORKS,
  fixture: f.utxoNetworks,
  render: () => renderGraph(),
  chrome: () => screen.getByRole('group', { name: GRAPH_NAME }),
  loaded: async () => {
    await waitFor(() => expect(title()).toHaveTextContent('Transakcijų Srautas - Bitcoin Testnet4'));
    await waitFor(async () => expect(rowsOf(await findBox(T.T1)).inputs[0].primary).toBe('0.01 tBTC4'));
  },
  failed: async () => {
    const box = await findBox(T.T1);
    await settle();
    expect(title()).toHaveTextContent('Transakcijų Srautas - btc4');
    expect(rowsOf(box).inputs[0].primary).toBe('0.01 BTC');
  },
  loading: () => screen.getByRole('heading', { level: 1, name: 'Transakcijų Srautas - btc4' }),
});







// -----------------------------------------------------------
// GET /api/utxo/:network/transaction/:txid
// -----------------------------------------------------------
//
// Through the dialog, opened on T0 — the payout from before
// the day that a link reaches: the day does not hold it, so
// the dialog asks at once.
// -----------------------------------------------------------

describeEndpointContract({
  path: TRANSACTION,
  fixture: f.utxoTransaction(T.T0),
  render: () => renderPage(
    <TransactionModal
      network="btc4"
      txid={T.T0}
      sourceRect={null}
      onClose={() => {}}
      transactionsById={{}}
      names={f.utxoNames}
      renameAddress={async () => true}
      faucetAddress={f.FAUCET_UTXO}
      unit="tBTC4"
    />,
  ),
  chrome: () => screen.getByRole('dialog', { name: 'Transakcija' }),
  loaded: async () => {
    await screen.findByText('Patvirtinta · blokas #154300');
    await screen.findByText(T.T0);
  },
  failed: async () => {
    await screen.findByText(/^(Transakcija nerasta — serveris jos negrąžino\.|Nepavyko gauti transakcijos — bandykite dar kartą vėliau\.)$/);
  },
  loading: () => screen.getByText('Kraunama…'),
  pins: {
    'every leaf null → page survives': 'an input whose txid is null crashes the dialog — shortTxid calls .slice on it for the outpoint link (TransactionModal.jsx:710)',
    'types swapped (numbers as strings, strings as numbers) → page survives': 'a txid that is not a string crashes the dialog — shortTxid calls .slice on a number for the outpoint link (TransactionModal.jsx:710)',
  },
});

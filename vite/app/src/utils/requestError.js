// -----------------------------------------------------------
//  [*] requestError — what a student reads when a request fails
//
//  The faucet pages used to show whatever axios had put in
//  the error, so a dropped connection or a proxy's error page
//  reached the student in English, and the Lithuanian
//  sentence each page had prepared could never appear. Every
//  failed request now asks this module for its text — on the
//  faucet pages, the transaction graphs and the blockchain
//  simulator, a claim as much as a read — so the rule lives
//  in one place, and what the screen says is what went
//  wrong.
//
//  The backend writes its refusals and its failures as
//  Lithuanian sentences that name the cause — a cooldown, an
//  empty faucet, an RPC server that did not answer — so those
//  are shown as they are. A request that failed without such
//  a sentence gets the page's own sentence and a short reason
//  after it: no connection at all, too many requests (a
//  proxy's rate limit answers without the backend's
//  sentence, and the student only needs to wait), the error
//  status the server answered with, an answer that came back
//  in a shape the page cannot use, or the refusal a server or
//  a wallet answered with, in its own words and with its own
//  name. A wallet's refusal of the student's own request is
//  not a failed request — the student declined in MetaMask,
//  Phantom or Slush — and the wallet's own words say that
//  best.
// -----------------------------------------------------------

import axios from 'axios';







// -----------------------------------------------------------
// MalformedAnswerError
// -----------------------------------------------------------
//
// What a page throws when an answer arrived but is not the
// shape the page can be built from, so the failure reads as
// exactly that rather than as the check's own words.
//
// Used by:
//   - Faucet_EVM, Faucet_ERC20, Faucet_SVM, Faucet_MOVE,
//     Faucet_UTXO — the shape checks inside their queries
//   - Graph/Page.jsx, Graph/hooks/useTransactionGraph.js,
//     Graph_UTXO/Page.jsx, Graph_UTXO/hooks/useTransactionGraph.js
//     — the graphs' shape checks
//   - BlockchainSimulator/Page.jsx — the demo chain's
//   - requestErrorText (below)
// -----------------------------------------------------------

export class MalformedAnswerError extends Error {}







// -----------------------------------------------------------
// RefusalError
// -----------------------------------------------------------
//
// What a page throws when an answer arrived but carried a
// refusal instead of the data — a public JSON-RPC or GraphQL
// server's error with HTTP 200, a wallet rejecting a read —
// holding who answered and the refusal in its own words, so
// the sentence can name both.
//
// Used by:
//   - useMetamaskWallet — the student's balance read
//   - Faucet_SVM, Faucet_MOVE — the student's balance read
//   - requestErrorText (below)
// -----------------------------------------------------------

export class RefusalError extends Error {

  constructor(by, message) {
    super(message);
    this.by = by;
  }
}







// -----------------------------------------------------------
// closed
// -----------------------------------------------------------
//
// A sentence closed with a full stop when it lacks one — a
// server's or a wallet's own words do not always close
// themselves, and the sentences built here must.
//
// Used by:
//   - requestErrorText, withNextStep (below)
// -----------------------------------------------------------

const closed = (sentence) => (/[.!?…]$/.test(sentence) ? sentence : `${sentence}.`);







// -----------------------------------------------------------
// requestErrorText
// -----------------------------------------------------------
//
// Turns a caught error into the sentence for the page. The
// page passes its own sentence for the request that failed;
// it is used, with the reason after it, whenever neither the
// backend nor the wallet said anything a student can read. A
// page that only wants the reason passes an empty sentence.
//
// A read from a server that is not the faucet's own backend —
// a public JSON-RPC or GraphQL endpoint — names that server:
// its error text is its own words, not a sentence written for
// the student, so it is quoted after the server's name rather
// than shown bare, and a failure status is said to be that
// server's.
//
// Used by:
//   - Faucet_EVM, Faucet_ERC20, Faucet_SVM, Faucet_MOVE — the
//     claim handler and the failed reads of each page
//   - Faucet_UTXO — the request handler and the failed reads
//   - Graph/Page.jsx, Graph/hooks/useTransactionGraph.js,
//     Graph/components/CryptoFlowGraph.jsx — the EVM graph's
//     reads and its name saves
//   - Graph_UTXO/Page.jsx, Graph_UTXO/hooks/useTransactionGraph.js,
//     Graph_UTXO/components/TransactionModal.jsx — the UTXO
//     graph's reads and its name saves
//   - BlockchainSimulator/Page.jsx — the demo chain's load
//   - App.jsx — the home page when the catalog failed
//   - Navbar — the catalog's failure notice, the reason alone
// -----------------------------------------------------------

export function requestErrorText(error, fallback, server = null) {

  const who = server ?? 'Serveris';

  if (error instanceof MalformedAnswerError) {
    return `${fallback} ${who} atsakė netinkamo formato duomenimis.`.trim();
  }

  if (error instanceof RefusalError) {
    return `${fallback} ${error.by} atsakė: ${closed(error.message.trim() || 'be paaiškinimo')}`.trim();
  }

  if (!axios.isAxiosError(error)) {
    return (typeof error?.message === 'string' && error.message.trim()) || fallback;
  }


  const message = error.response?.data?.error;
  if (typeof message === 'string' && message.trim()) {
    return server ? `${fallback} ${server} atsakė: ${closed(message.trim())}`.trim() : message;
  }

  if (!error.response) return `${fallback} Patikrinkite interneto ryšį.`.trim();
  if (error.response.status === 429) return `${fallback} Per daug užklausų — palaukite ir bandykite vėl.`.trim();
  return `${fallback} ${who} grąžino klaidą (${error.response.status}).`.trim();
}







// -----------------------------------------------------------
// withNextStep
// -----------------------------------------------------------
//
// A failure sentence followed by what the student should do
// next, with the full stop the failure sentence may lack — a
// backend sentence does not always close itself.
//
// Used by:
//   - Faucet_EVM, Faucet_SVM, Faucet_MOVE, Faucet_UTXO — the
//     network list's error card
//   - Graph/hooks/useTransactionGraph.js — the outage notice
//   - Graph_UTXO/Page.jsx, Graph_UTXO/components/UtxoFlowGraph.jsx
//     — the failed reads' line and the status line
//   - BlockchainSimulator/Page.jsx — the demo chain's failure
// -----------------------------------------------------------

export function withNextStep(sentence, nextStep) {
  return `${closed(sentence)} ${nextStep}`;
}

// -----------------------------------------------------------
//  [*] requestError — what a student reads when a request fails
//
//  The faucet pages used to show whatever axios had put in
//  the error, so a dropped connection or a proxy's error page
//  reached the student in English, and the Lithuanian
//  sentence each page had prepared could never appear. Every
//  claim handler now asks this module for the text, so the
//  rule lives in one place.
//
//  The backend writes its refusals — a cooldown, an empty
//  faucet — as Lithuanian sentences meant for the student, so
//  those are shown as they are. A request that failed without
//  such a sentence gets the page's own sentence and a short
//  reason after it: no connection at all, too many requests
//  (a proxy's rate limit answers without the backend's
//  sentence, and the student only needs to wait), or the
//  error status the server answered with. A wallet's refusal
//  is not a failed request — the student declined in
//  MetaMask, Phantom or Slush — and the wallet's own words
//  say that best.
// -----------------------------------------------------------

import axios from 'axios';







// -----------------------------------------------------------
// requestErrorText
// -----------------------------------------------------------
//
// Turns a caught error into the sentence for the page's
// alert. The page passes its own sentence for a failed
// request; it is used whenever neither the backend nor the
// wallet said anything a student can read.
//
// Used by:
//   - Faucet_EVM, Faucet_ERC20, Faucet_SVM, Faucet_MOVE — the
//     claim handler of each page
//   - Faucet_UTXO — the request handler
// -----------------------------------------------------------

export function requestErrorText(error, fallback) {

  if (!axios.isAxiosError(error)) {
    return (typeof error?.message === 'string' && error.message.trim()) || fallback;
  }


  const message = error.response?.data?.error;
  if (typeof message === 'string' && message.trim()) return message;

  if (!error.response) return `${fallback} Patikrinkite interneto ryšį.`;
  if (error.response.status === 429) return `${fallback} Per daug užklausų — palaukite ir bandykite vėl.`;
  return `${fallback} Serveris grąžino klaidą (${error.response.status}).`;
}

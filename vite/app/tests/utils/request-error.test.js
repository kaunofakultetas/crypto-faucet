// -----------------------------------------------------------
//  [*] Tests — requestErrorText, what a failed request says
//
//  The one rule every faucet page follows when a request
//  fails: the backend's own sentence word for word — it names
//  the cause — and otherwise the page's sentence with the
//  reason after it: no connection, a rate limit, the status
//  the server answered with, an answer in a shape the page
//  cannot use, or a refusal in the answering server's or
//  wallet's own words, under its name. A read from a server
//  other than the faucet's backend names that server. A
//  wallet's refusal of the student's own request keeps the
//  wallet's words. And the error card's next step always
//  follows a closed sentence.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { AxiosError } from 'axios';
import { MalformedAnswerError, RefusalError, requestErrorText, withNextStep } from '@/utils/requestError';


// The page's own sentence, as the faucet pages pass it
const FAILED = 'Nepavyko gauti čiaupo informacijos.';

// A failed axios request: answered with a status and a body,
// or never answered at all
const answered = (status, data) => new AxiosError('Request failed', 'ERR_BAD_RESPONSE', {}, {}, { status, data });
const unanswered = () => new AxiosError('Network Error', 'ERR_NETWORK', {}, {});







// -----------------------------------------------------------
// requestErrorText
// -----------------------------------------------------------

describe('requestErrorText', () => {

  it("shows the backend's sentence word for word — it names the cause", () => {
    const sentence = 'Nepavyko gauti čiaupo balanso: tinklo RPC serveris neatsakė per 10 s.';
    expect(requestErrorText(answered(500, { error: sentence }), FAILED)).toBe(sentence);
  });

  it("says there is no connection when nothing answered", () => {
    expect(requestErrorText(unanswered(), FAILED)).toBe(`${FAILED} Patikrinkite interneto ryšį.`);
  });

  it('says to wait out a rate limit that came without a sentence', () => {
    expect(requestErrorText(answered(429, '<html>Too Many Requests</html>'), FAILED))
      .toBe(`${FAILED} Per daug užklausų — palaukite ir bandykite vėl.`);
  });

  it('names the status of any other answer without a sentence — a blank one counts as none', () => {
    expect(requestErrorText(answered(502, '<html>Bad Gateway</html>'), FAILED)).toBe(`${FAILED} Serveris grąžino klaidą (502).`);
    expect(requestErrorText(answered(500, { error: '  ' }), FAILED)).toBe(`${FAILED} Serveris grąžino klaidą (500).`);
  });

  it('says an answer came in a shape the page cannot use', () => {
    expect(requestErrorText(new MalformedAnswerError(), FAILED)).toBe(`${FAILED} Serveris atsakė netinkamo formato duomenimis.`);
  });

  it("quotes a refusal under the name of whoever answered it, closing the sentence", () => {
    expect(requestErrorText(new RefusalError('MetaMask', 'Internal JSON-RPC error.'), 'Nepavyko gauti jūsų MetaMask balanso.'))
      .toBe('Nepavyko gauti jūsų MetaMask balanso. MetaMask atsakė: Internal JSON-RPC error.');
    expect(requestErrorText(new RefusalError('Solana RPC', 'Node is behind by 42 slots'), 'Nepavyko gauti jūsų Phantom balanso.'))
      .toBe('Nepavyko gauti jūsų Phantom balanso. Solana RPC atsakė: Node is behind by 42 slots.');
  });

  it("names a foreign server: its error text quoted, its status and its shape its own", () => {
    const failed = 'Nepavyko gauti jūsų Phantom balanso.';
    expect(requestErrorText(answered(500, { error: 'Internal error' }), failed, 'Solana RPC'))
      .toBe(`${failed} Solana RPC atsakė: Internal error.`);
    expect(requestErrorText(answered(503, '<html>Unavailable</html>'), failed, 'Solana RPC'))
      .toBe(`${failed} Solana RPC grąžino klaidą (503).`);
    expect(requestErrorText(new MalformedAnswerError(), failed, 'Solana RPC'))
      .toBe(`${failed} Solana RPC atsakė netinkamo formato duomenimis.`);
  });

  it('gives the reason alone to a caller that passes no sentence of its own', () => {
    expect(requestErrorText(answered(502, '<html>Bad Gateway</html>'), '')).toBe('Serveris grąžino klaidą (502).');
    expect(requestErrorText(unanswered(), '')).toBe('Patikrinkite interneto ryšį.');
  });

  it("keeps a wallet's own words, and falls back to the page's sentence when there are none", () => {
    expect(requestErrorText(new Error('Slush užrakinta'), FAILED)).toBe('Slush užrakinta');
    expect(requestErrorText(new Error(''), FAILED)).toBe(FAILED);
    expect(requestErrorText(undefined, FAILED)).toBe(FAILED);
  });
});







// -----------------------------------------------------------
// withNextStep
// -----------------------------------------------------------

describe('withNextStep', () => {

  it('closes a sentence that lacks its full stop before the next step', () => {
    expect(withNextStep('Vidinė serverio klaida', 'Perkraukite puslapį.')).toBe('Vidinė serverio klaida. Perkraukite puslapį.');
  });

  it.each(['.', '!', '?', '…'])('leaves a sentence closed with "%s" as it is', (end) => {
    expect(withNextStep(`Klaida${end}`, 'Perkraukite puslapį.')).toBe(`Klaida${end} Perkraukite puslapį.`);
  });
});

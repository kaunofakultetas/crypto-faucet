// -----------------------------------------------------------
//  [*] clipboardError — why a copy to the clipboard failed
//
//  The pages offer copy buttons for addresses, transaction ids
//  and block texts, and a copy can fail in two ways a student
//  can act on: the browser offers no clipboard at all outside
//  a secure (HTTPS) page, or it refuses the write — a
//  permission denied, a page out of focus. Anything else is
//  told in the browser's own words. Every copy button says it
//  the same way, so the wording lives here.
// -----------------------------------------------------------







// -----------------------------------------------------------
// clipboardFailure
// -----------------------------------------------------------
//
// The reason one failed copy went wrong, as a Lithuanian
// clause to follow the button's own "could not copy" words.
// The browser's name and message for the error, when it gave
// them, are kept in parentheses.
//
// Used by:
//   - pages/Graph/components/AddressDialog.jsx — the address
//   - pages/Graph_UTXO/components/TransactionModal.jsx — the
//     txid and every address
//   - pages/BlockchainSimulator/Page.jsx — a block's text
// -----------------------------------------------------------

export function clipboardFailure(error) {

  if (!navigator.clipboard?.writeText) {
    return 'naršyklė šiame puslapyje iškarpinės nepasiekia — ji veikia tik saugiu (HTTPS) ryšiu';
  }


  const words = [error?.name, error?.message].filter((part) => typeof part === 'string' && part.trim()).join(': ');
  const quoted = words ? ` (${words})` : '';
  if (error?.name === 'NotAllowedError') return `naršyklė neleido įrašyti į iškarpinę${quoted}`;
  return `naršyklei nepavyko įrašyti į iškarpinę${quoted}`;
}

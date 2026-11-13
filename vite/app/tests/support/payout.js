// -----------------------------------------------------------
//  [*] Test support — what a payout alert shows
//
//  Every faucet page ends a successful claim with the same
//  alert (components/PayoutMessage.jsx): the page's sentence,
//  an empty line, "Transakcija:" and, on a line of its own,
//  the transaction's id. The lines are made with <br>, and an
//  element's text content carries no trace of a <br> — read
//  that way the sentence and "Transakcija:" run together into
//  words no student ever sees, and an alert that lost its
//  line breaks would read exactly the same.
//
//  So the page tests read the alert line by line, the way it
//  stands on the screen, and what a payout alert consists of
//  is written down once, here, for all five of them: a change
//  to its layout is one line of this file.
//
//  Used by:
//    - tests/pages/faucet-evm.test.jsx, faucet-erc20.test.jsx,
//      faucet-svm.test.jsx, faucet-move.test.jsx,
//      faucet-utxo.test.jsx — the claim's success alert
// -----------------------------------------------------------







// -----------------------------------------------------------
// linesOf
// -----------------------------------------------------------
//
// The lines of text an element shows: a <br> anywhere inside
// it ends a line, and nothing else does. Inside a line the
// white space collapses and the ends are trimmed, as a
// browser lays text out — a line break typed into a string
// is only a space on the screen, and a space left in front of
// a link that follows a <br> is not seen at all. Two <br> in
// a row give an empty line.
//
// Used by:
//   - the five faucet page tests (see the file header)
// -----------------------------------------------------------

export function linesOf(element) {
  const read = (node) => [...node.childNodes].map((child) => {
    if (child.nodeName === 'BR') return '\n';
    return child.nodeType === Node.TEXT_NODE ? child.textContent.replace(/\s+/g, ' ') : read(child);
  }).join('');

  return read(element).split('\n').map((line) => line.replace(/ +/g, ' ').trim());
}







// -----------------------------------------------------------
// payoutLines
// -----------------------------------------------------------
//
// The lines of a payout alert, top to bottom: the page's own
// sentence about what was sent, an empty line, "Transakcija:"
// and the transaction's id in full.
//
// Used by:
//   - the five faucet page tests (see the file header)
// -----------------------------------------------------------

export const payoutLines = (sentence, txid) => [sentence, '', 'Transakcija:', txid];

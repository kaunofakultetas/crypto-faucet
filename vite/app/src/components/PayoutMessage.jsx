// -----------------------------------------------------------
//  [*] PayoutMessage — what a faucet page says after a payout
//
//  Every faucet page ends a successful claim the same way:
//  its own sentence about what was sent, then the transaction,
//  so the student can open it on the network's block explorer
//  and watch the payout being confirmed — the point of the
//  exercise. The link opens in a new tab and leaves the faucet
//  where it was. Without a usable explorer the id is shown as
//  plain text instead, still there to copy. Transaction ids
//  are long and unbroken, so the id may wrap anywhere.
//
//  Used by:
//    - pages/Faucet_EVM, Faucet_ERC20, Faucet_SVM, Faucet_MOVE
//      — the claim's success alert
//    - pages/Faucet_UTXO — the request's success alert
// -----------------------------------------------------------

import { explorerTxUrl } from '@/utils/explorer';







// -----------------------------------------------------------
// PayoutMessage (default export)
// -----------------------------------------------------------
//
// Words only — the page's sentence, then "Transakcija:" and
// the id, linked when the network's explorer address is
// usable — so each page keeps the alert it already shows
// around it.
//
// Used by:
//   - see the file header
// -----------------------------------------------------------

export default function PayoutMessage({ sentence, txid, explorer }) {

  const href = explorerTxUrl(explorer, txid);


  return (
    <>
      {sentence} Transakcija:{' '}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="break-all underline">
          {txid}
        </a>
      ) : (
        <span className="break-all">{txid}</span>
      )}
    </>
  );
}

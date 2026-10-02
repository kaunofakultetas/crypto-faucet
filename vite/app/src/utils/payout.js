// -----------------------------------------------------------
//  [*] payout — what counts as a payout answer
//
//  A faucet's payout request answers 200 when the backend sent
//  the coins, but a 200 on its own proves nothing: the backend
//  sends some refusals as an { error } sentence with 200, and
//  a proxy's page or an empty body arrives with 200 too. None
//  of those made a transaction, and announcing one would send
//  the student looking for coins that never left the faucet.
//  So every faucet page reads its payout answer through this
//  module, and only an answer that names its transaction
//  counts as a payout.
// -----------------------------------------------------------







// -----------------------------------------------------------
// payoutTxid
// -----------------------------------------------------------
//
// The transaction id a payout answer names, read from the
// field the family's backend puts it in. Any other answer
// throws, so the claim ends in the same alert as any failed
// request: the backend's own sentence when it sent one, the
// page's sentence otherwise.
//
// Used by:
//   - Faucet_EVM, Faucet_ERC20, Faucet_SVM, Faucet_MOVE — the
//     claim handler of each page
//   - Faucet_UTXO — the request handler
// -----------------------------------------------------------

export function payoutTxid(answer, field, fallback) {

  const refusal = answer?.error;
  if (typeof refusal === 'string' && refusal.trim()) throw new Error(refusal);


  const txid = answer?.[field];
  if (typeof txid !== 'string' || !txid.trim()) throw new Error(fallback);
  return txid;
}

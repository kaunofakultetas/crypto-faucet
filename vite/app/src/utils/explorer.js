// -----------------------------------------------------------
//  [*] explorer — a transaction's page on its block explorer
//
//  After a payout the faucet pages link the student to the
//  transaction on the network's block explorer, so they can
//  watch it being confirmed. The explorer's address comes
//  from the backend's network list, and every explorer the
//  faucet uses keeps a transaction under a "tx" path below
//  that address.
//
//  Some explorer addresses end in settings after a question
//  mark that every page of the explorer needs — the Solana
//  explorer learns which cluster to show that way. Gluing the
//  path onto the end of such an address would bury it inside
//  those settings, so the path goes where it belongs and the
//  settings are kept.
// -----------------------------------------------------------







// -----------------------------------------------------------
// explorerTxUrl
// -----------------------------------------------------------
//
// The link to one transaction — or nothing when the network
// has no explorer configured, its address is not a usable
// URL, or the payout answer carried no transaction id. The
// page then shows the id as plain text, or no link at all.
//
// Used by:
//   - components/PayoutMessage.jsx — the success alert of
//     every faucet page
// -----------------------------------------------------------

export function explorerTxUrl(base, txid) {

  if (typeof base !== 'string' || !base || typeof txid !== 'string' || !txid) return null;


  try {
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/tx/${encodeURIComponent(txid)}`;
    return url.toString();
  } catch {
    // A relative or mistyped address in the operator's config
    return null;
  }
}

// -----------------------------------------------------------
//  [*] FailureNote — why a value on the card is missing
//
//  A card row that could not be read keeps its dash, so the
//  layout holds, and this short red line under it says why —
//  which read failed, and what the server or the wallet
//  answered. It is not an alert: the page's own alerts (a
//  claim's outcome, the faucet info's failure) keep that role
//  to themselves, and a missing number is not news that must
//  interrupt a screen reader.
//
//  Used by:
//    - pages/Faucet_EVM/Page.jsx, Faucet_SVM/Page.jsx,
//      Faucet_MOVE/Page.jsx — the student's balance row
//    - pages/Faucet_ERC20/Page.jsx — a chain card's faucet
//      balance and gas check
// -----------------------------------------------------------







// -----------------------------------------------------------
// FailureNote (default export)
// -----------------------------------------------------------
//
// The line itself: whatever sentence the page passes in,
// small and red, under the row it explains.
//
// Used by:
//   - see the file header
// -----------------------------------------------------------

export default function FailureNote({ children }) {
  return <p className="mb-2 text-sm text-red-600">{children}</p>;
}

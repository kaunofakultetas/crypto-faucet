// -----------------------------------------------------------
//  [*] Graph — utils
//
//  Pure helpers for the transaction graph: time formatting,
//  transaction filtering, address/label formatting and small
//  browser conveniences. No React, no vis-network.
//
//  timeSince produces the "Atnaujinta: <ago>" part of node
//  labels in abbreviated Lithuanian ("prieš 5 min.").
//
//  Used by:
//    - useTransactionGraph.js
//    - AddressDialog.jsx — copyToClipboard
// -----------------------------------------------------------







// -----------------------------------------------------------
// timeSince
// -----------------------------------------------------------
//
// "prieš X sek./min./val./d./mėn./m." from a Date — the
// largest unit that fits wins, and the abbreviations sidestep
// Lithuanian declension entirely.
//
// Used by:
//   - useTransactionGraph.js — nodeLabel, for the
//     "Atnaujinta: …" line
// -----------------------------------------------------------

export const timeSince = (date) => {
  const seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000; // seconds in a year

  if (interval > 1) {
    return "prieš " + Math.floor(interval) + " m.";
  }
  interval = seconds / 2592000; // seconds in a month
  if (interval > 1) {
    return "prieš " + Math.floor(interval) + " mėn.";
  }
  interval = seconds / 86400; // seconds in a day
  if (interval > 1) {
    return "prieš " + Math.floor(interval) + " d.";
  }
  interval = seconds / 3600; // seconds in an hour
  if (interval > 1) {
    return "prieš " + Math.floor(interval) + " val.";
  }
  interval = seconds / 60; // seconds in a minute
  if (interval > 1) {
    return "prieš " + Math.floor(interval) + " min.";
  }
  return "prieš " + Math.floor(seconds) + " sek.";
};







// -----------------------------------------------------------
// parseTimestamp
// -----------------------------------------------------------
//
// The backend sends timestamps both as ISO strings and as
// unix seconds — normalize either into a Date; anything else
// falls back to "now" (and is logged).
//
// Used by:
//   - useTransactionGraph.js — mergeTransaction
// -----------------------------------------------------------

export const parseTimestamp = (timestamp) => {
  if (typeof timestamp === 'string' || timestamp instanceof String) {
    return new Date(timestamp);
  } else if (typeof timestamp === 'number') {
    return new Date(timestamp * 1000);
  } else {
    console.error('Unrecognized timestamp format:', timestamp);
    return new Date();
  }
};







// -----------------------------------------------------------
// formatAddress
// -----------------------------------------------------------
//
// "0x1234ab...cd56" — first 6 + last 4 characters; short
// values pass through untouched.
//
// Used by:
//   - useTransactionGraph.js — nodeLabel
// -----------------------------------------------------------

export const formatAddress = (address) => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};







// -----------------------------------------------------------
// formatTransactionLabel
// -----------------------------------------------------------
//
// Edge label: the summed value plus how many transactions it
// stands for, e.g. "0.5000 ETH\n(3 txs)". The symbol is the
// viewed network's native currency from the config — every
// chain configured today uses ETH, but that's the config's
// call, not this file's.
//
// Used by:
//   - useTransactionGraph.js — syncDataSets (edge labels)
// -----------------------------------------------------------

export const formatTransactionLabel = (value, count, symbol = 'ETH') => {
  return `${value.toFixed(4)} ${symbol}\n(${count} tx${count > 1 ? 's' : ''})`;
};







// -----------------------------------------------------------
// clamp
// -----------------------------------------------------------
//
// Used by:
//   - useTransactionGraph.js — the zoom listener and setZoom
// -----------------------------------------------------------

export const clamp = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};







// -----------------------------------------------------------
// copyToClipboard
// -----------------------------------------------------------
//
// Clipboard write that reports success instead of throwing —
// callers show the "Nukopijuota" hint only when it worked.
//
// Used by:
//   - AddressDialog.jsx — the copy button
// -----------------------------------------------------------

export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text || '');
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
};

// -----------------------------------------------------------
//  [*] walletInstall — remembering that a wallet is on its way
//
//  A student who presses "Susidiegti …" leaves for the store,
//  installs the wallet and comes back — to a page that cannot
//  see it: a browser hands a newly installed extension only to
//  pages loaded afterwards. So the page reloads itself when
//  the student returns while the wallet is still missing, and
//  for that it must remember, across its own reloads, that an
//  install was started: a return before the install is done
//  reloads into the same install step, and the NEXT return
//  must still count.
//
//  The note is one localStorage entry per wallet, holding the
//  time of the press. It counts for INSTALL_WAIT_MS and is
//  dropped the moment the wallet shows up. localStorage, not
//  the tab's session store: the app keeps everything it
//  remembers in the one place the error screen's "clear
//  remembered data" empties (components/ErrorBoundary.jsx
//  lists the key). A browser that blocks storage simply
//  remembers nothing — the page then behaves as it did before.
// -----------------------------------------------------------

// What every install note's key starts with — the wallet's
// name follows
const KEY_PREFIX = 'walletInstall:';

// How long after the press a return to the page still counts
// as coming back from the install: finding the store, adding
// the extension and making a first wallet takes minutes, and
// past a quarter of an hour the student is back for something
// else
const INSTALL_WAIT_MS = 15 * 60 * 1000;







// -----------------------------------------------------------
// noteInstallStarted
// -----------------------------------------------------------
//
// Writes down that the student just set off to install this
// wallet. A later press starts the wait over.
//
// Used by:
//   - components/WalletFlow.jsx — WalletGateButton, the
//     install link's press
// -----------------------------------------------------------

export function noteInstallStarted(walletName) {
  try {
    localStorage.setItem(KEY_PREFIX + walletName, String(Date.now()));
  } catch { /* blocked storage — nothing is remembered */ }
}







// -----------------------------------------------------------
// installUnderWay
// -----------------------------------------------------------
//
// Whether an install of this wallet was started recently
// enough to still be awaited. A note that is too old, lies in
// the future or is no time at all does not count.
//
// Used by:
//   - components/WalletFlow.jsx — useReloadAfterInstall, on
//     the student's return to the page
// -----------------------------------------------------------

export function installUnderWay(walletName) {
  try {
    const started = Number(localStorage.getItem(KEY_PREFIX + walletName));
    const waited = Date.now() - started;
    return started > 0 && waited >= 0 && waited < INSTALL_WAIT_MS;
  } catch {
    return false;
  }
}







// -----------------------------------------------------------
// forgetInstall
// -----------------------------------------------------------
//
// Drops this wallet's note: the wallet is here, there is
// nothing left to wait for.
//
// Used by:
//   - components/WalletFlow.jsx — useReloadAfterInstall, once
//     the wallet is found
// -----------------------------------------------------------

export function forgetInstall(walletName) {
  try {
    localStorage.removeItem(KEY_PREFIX + walletName);
  } catch { /* blocked storage — there was no note */ }
}
